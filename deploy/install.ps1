# HealthTrack — Windows installer (native PowerShell). Mirrors deploy/install.sh.
#
#   irm https://raw.githubusercontent.com/mawji/HealthTrack/main/deploy/install.ps1 | iex
#
# Installs into the CURRENT directory. Re-running is safe: an existing .env is
# never overwritten. Needs Docker Desktop (Compose v2) running.
$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$Owner  = 'mawji'
$Branch = 'main'
$Raw    = "https://raw.githubusercontent.com/$Owner/HealthTrack/$Branch/deploy"
$Dir    = (Get-Location).Path
$envPath     = Join-Path $Dir '.env'
$examplePath = Join-Path $Dir '.env.example'

function Say($m)  { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "!  $m"   -ForegroundColor Yellow }
function Ask($label, $default) {
  if ($default) { $v = Read-Host "$label [$default]" } else { $v = Read-Host $label }
  if ([string]::IsNullOrWhiteSpace($v)) { return $default } else { return $v.Trim() }
}
# Write .env from the template, substituting the given keys. Always LF + UTF-8
# (no BOM, no trailing CR) so Docker reads the auth key etc. cleanly.
function Write-EnvFile($values) {
  $out = foreach ($l in (Get-Content $examplePath)) {
    if ($l -match '^([A-Z][A-Z0-9_]*)=') {
      $k = $Matches[1]
      if ($values.ContainsKey($k)) { "$k=$($values[$k])" } else { $l }
    } else { $l }
  }
  [IO.File]::WriteAllText($envPath, (($out -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false)))
}
function Set-EnvLine($key, $val) {
  $found = $false
  $out = foreach ($l in (Get-Content $envPath)) {
    if ($l -match "^$key=") { $found = $true; "$key=$val" } else { $l }
  }
  if (-not $found) { $out = @($out) + "$key=$val" }
  [IO.File]::WriteAllText($envPath, (($out -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false)))
}

# ── prerequisites ─────────────────────────────────────────────────────────────
Say 'Checking prerequisites'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker not found. Install Docker Desktop and make sure it is running, then retry.'
}
docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose v2 not available. Update Docker Desktop.' }

# ── fetch bundle ──────────────────────────────────────────────────────────────
Say "Setting up $Dir"
foreach ($f in 'compose.yml', 'serve.json', '.env.example') {
  $p = Join-Path $Dir $f
  if (-not (Test-Path $p)) { Say "Fetching $f"; Invoke-WebRequest -UseBasicParsing "$Raw/$f" -OutFile $p }
}

# ── settings (.env) ───────────────────────────────────────────────────────────
if (Test-Path $envPath) {
  Say 'Using existing .env (delete it to reconfigure)'
} else {
  Say 'Enter your settings (press Enter to accept a [default])'
  $b = New-Object 'Byte[]' 24
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  $token = -join ($b | ForEach-Object { $_.ToString('x2') })
  $vals = @{
    GOOGLE_HEALTH_CLIENT_ID     = Ask 'Google Health client ID' ''
    GOOGLE_HEALTH_CLIENT_SECRET = Ask 'Google Health client secret' ''
    APP_TZ                      = Ask 'Timezone (IANA)' 'Asia/Dubai'
    TS_HOSTNAME                 = Ask 'Tailscale machine name' 'healthtrack'
    TS_AUTHKEY                  = Ask 'Tailscale auth key' ''
    WATCHTOWER_TOKEN            = $token
    GHCR_OWNER                  = $Owner
    CHANNEL                     = 'stable'
    APP_BASE_URL                = ''
  }
  $tg = Ask 'Telegram bot token (optional, Enter to skip)' ''
  Write-EnvFile $vals
  if ($tg) { Set-EnvLine 'TELEGRAM_BOT_TOKEN' $tg }
  if (-not $vals.TS_AUTHKEY) {
    Warn "No Tailscale auth key entered. Edit $envPath (TS_AUTHKEY=...) then re-run."
    return
  }
}

Set-Location $Dir

# ── bring Tailscale up, learn the hostname, fill APP_BASE_URL ──────────────────
Say 'Starting Tailscale to obtain your HTTPS hostname'
docker compose up -d ts
if ($LASTEXITCODE -ne 0) { throw 'Failed to start Tailscale. Check .env (TS_AUTHKEY / WATCHTOWER_TOKEN) and Docker.' }

$fqdn = ''
for ($i = 0; $i -lt 30; $i++) {
  try {
    $j = docker compose exec -T ts tailscale status --json 2>$null | Out-String
    $d = ($j | ConvertFrom-Json).Self.DNSName
    if ($d) { $fqdn = ([string]$d).TrimEnd('.') }
  } catch {}
  if ($fqdn) { break }
  Start-Sleep -Seconds 2
}
if ($fqdn) { Set-EnvLine 'APP_BASE_URL' "https://$fqdn"; Say "Your app URL:  https://$fqdn" }
else { Warn 'Could not auto-detect the Tailscale hostname. Set APP_BASE_URL in .env by hand, then re-run.' }

# ── start the stack ───────────────────────────────────────────────────────────
Say 'Starting the stack'
docker compose up -d

# HTTPS needs "HTTPS Certificates" enabled on the tailnet (off by default).
if ($fqdn) {
  $certOk = $false
  try { docker compose exec -T ts tailscale cert $fqdn 2>$null | Out-Null; $certOk = ($LASTEXITCODE -eq 0) } catch {}
  if (-not $certOk) {
    Warn 'Tailscale could not provision an HTTPS cert yet. Enable it once in the admin console:'
    Warn '  https://login.tailscale.com/admin/dns  ->  HTTPS Certificates  ->  Enable'
    Warn '  then:  docker compose restart'
  }
}

# ── what's left (the inherently-manual steps) ─────────────────────────────────
$url = if ($fqdn) { "https://$fqdn" } else { '<your app URL>' }
Write-Host "`nHealthTrack is up." -ForegroundColor Green
Write-Host "`nFinish in the browser:"
Write-Host "  1. Google Cloud -> your OAuth client -> Authorized redirect URIs -> add exactly:"
Write-Host "       $url/api/googlehealth/callback"
Write-Host "  2. Open $url   (Tailscale must be running + signed in on the device)."
Write-Host "     Settings -> connect Google Health; Settings -> AI Provider -> pick your coach."
Write-Host "  3. Install the app from the browser (Install / Add to Home screen)."
Write-Host "`nUpdate later from the in-app banner, or:  docker compose pull; docker compose up -d"
