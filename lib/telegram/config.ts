// Telegram bot configuration: the BotFather token and a local bridge secret.
// Stored under data/telegram/config.json (gitignored, like all of data/). The
// token may also come from the TELEGRAM_BOT_TOKEN env var, which wins when set
// so secrets can stay out of the data dir entirely.

import crypto from "crypto";
import { readJson, writeJson } from "@/lib/store";

const CONFIG_FILE = "telegram/config.json";

export type TelegramConfig = {
  /** BotFather token; undefined until the owner saves one (or sets the env var). */
  botToken?: string;
  /** Shared secret the long-poll bridge sends so /api/telegram/update only
   *  accepts forwarded updates from the local bridge process. */
  bridgeSecret?: string;
  /** Hold coach log actions for a Confirm tap before writing. Defaults to true
   *  (safer for the remote/voice channel); the owner can disable it in Settings. */
  confirmBeforeLog?: boolean;
};

export function getTelegramConfig(): TelegramConfig {
  return readJson<TelegramConfig>(CONFIG_FILE, {});
}

/** Resolve the active bot token: env var first, then the saved config. */
export function getBotToken(): string | undefined {
  return process.env.TELEGRAM_BOT_TOKEN || getTelegramConfig().botToken || undefined;
}

export function isBotConfigured(): boolean {
  return Boolean(getBotToken());
}

export function setBotToken(token: string | undefined) {
  const cfg = getTelegramConfig();
  cfg.botToken = token?.trim() || undefined;
  writeJson(CONFIG_FILE, cfg);
}

/** Whether log actions need an explicit Confirm tap (default: true). */
export function getConfirmBeforeLog(): boolean {
  return getTelegramConfig().confirmBeforeLog ?? true;
}

export function setConfirmBeforeLog(value: boolean) {
  const cfg = getTelegramConfig();
  cfg.confirmBeforeLog = value;
  writeJson(CONFIG_FILE, cfg);
}

/** Get the bridge secret, generating and persisting one on first use. */
export function getBridgeSecret(): string {
  const cfg = getTelegramConfig();
  if (!cfg.bridgeSecret) {
    cfg.bridgeSecret = crypto.randomBytes(24).toString("hex");
    writeJson(CONFIG_FILE, cfg);
  }
  return cfg.bridgeSecret;
}
