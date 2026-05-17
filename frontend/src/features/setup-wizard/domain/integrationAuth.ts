import type { AuthProvider } from "../types/api";
import type { Config } from "../types/config";

export type IntegrationAuthMode = "device" | "persisted";

export function getCodexAuthMode(config: Config): IntegrationAuthMode {
  if (config.CODEX_DEVICE_LOGIN_ON_START === "true") {
    return "device";
  }
  if (config.CODEX_BOOTSTRAP_LOGIN === "false") {
    return "persisted";
  }
  return "device";
}

export function getClaudeAuthMode(config: Config): IntegrationAuthMode {
  if (config.CLAUDE_DEVICE_LOGIN_ON_START === "true") {
    return "device";
  }
  if (config.CLAUDE_BOOTSTRAP_LOGIN === "false") {
    return "persisted";
  }
  return "device";
}

export function getIntegrationDisplayLabel(agent: AuthProvider): string {
  return agent === "claude" ? "Claude Code" : "Codex";
}
