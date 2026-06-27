# HealthTrack one-line installer (Windows PowerShell).
#
#   irm https://raw.githubusercontent.com/mawji/HealthTrack/main/install.ps1 | iex
#
# Clones the public repo, runs first-run setup, and builds for production.
# It does NOT start a long-running server and never touches anything outside the
# target directory. Override the defaults with env vars:
#   $env:HEALTHTRACK_REPO = '<git url>'   $env:HEALTHTRACK_DIR = '<folder name>'
$ErrorActionPreference = 'Stop'

$repo = if ($env:HEALTHTRACK_REPO) { $env:HEALTHTRACK_REPO } else { 'https://github.com/mawji/HealthTrack.git' }
$dir  = if ($env:HEALTHTRACK_DIR)  { $env:HEALTHTRACK_DIR }  else { 'HealthTrack' }

function Say($m) { Write-Host "[install] $m" }
function Invoke-Checked($exe, [string[]]$exeArgs) {
  & $exe @exeArgs
  if ($LASTEXITCODE -ne 0) { throw "$exe $($exeArgs -join ' ') failed (exit $LASTEXITCODE)." }
}

foreach ($c in 'git', 'node', 'npm') {
  if (-not (Get-Command $c -ErrorAction SilentlyContinue)) {
    throw "$c is required but was not found. Install it (Node.js from https://nodejs.org) and re-run."
  }
}

$major = [int](node -p 'process.versions.node.split(".")[0]')
if ($major -lt 20) { throw "Node $(node -v) is too old. Use Node 20 or newer (LTS 20, 22, 24)." }
if (Test-Path $dir) { throw "'$dir' already exists. Remove it, or set `$env:HEALTHTRACK_DIR and re-run." }

Say "cloning $repo -> $dir ..."
Invoke-Checked 'git' @('clone', $repo, $dir)
Set-Location $dir

Say "first-run setup (deps, .env.local, data/) ..."
Invoke-Checked 'npm' @('run', 'setup')

Say "building for production ..."
Invoke-Checked 'npm' @('run', 'build')

Say "done."
Say "start it:  cd $dir; npm run start"
Say "then open http://localhost:3210  (demo mode until you add credentials)"
