export const CONFIG_FIELDS = [
  "PORT",
  "JIRA_BASE_URL",
  "JIRA_USER_EMAIL",
  "JIRA_API_TOKEN",
  "JIRA_WEBHOOK_SECRET",
  "READY_STATUS",
  "IN_PROGRESS_STATUS",
  "IN_REVIEW_STATUS",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "REQUIRE_GITHUB_AUTH",
  "CODEX_API_KEY",
  "OPENAI_API_KEY",
  "CODEX_BOOTSTRAP_LOGIN",
  "CODEX_DEVICE_LOGIN_ON_START",
  "WORKFLOW_BASE_BRANCH",
  "CODEX_EXEC_ARGS",
  "NGROK_ENABLE",
  "NGROK_AUTHTOKEN",
  "NGROK_API_KEY",
  "NGROK_DOMAIN"
];

export const DEFAULT_CONFIG = {
  PORT: "3000",
  JIRA_BASE_URL: "",
  JIRA_USER_EMAIL: "",
  JIRA_API_TOKEN: "",
  JIRA_WEBHOOK_SECRET: "",
  READY_STATUS: "To Do",
  IN_PROGRESS_STATUS: "In Progress",
  IN_REVIEW_STATUS: "In Review",
  GITHUB_TOKEN: "",
  GH_TOKEN: "",
  REQUIRE_GITHUB_AUTH: "true",
  CODEX_API_KEY: "",
  OPENAI_API_KEY: "",
  CODEX_BOOTSTRAP_LOGIN: "true",
  CODEX_DEVICE_LOGIN_ON_START: "false",
  WORKFLOW_BASE_BRANCH: "main",
  CODEX_EXEC_ARGS: "--full-auto",
  NGROK_ENABLE: "false",
  NGROK_AUTHTOKEN: "",
  NGROK_API_KEY: "",
  NGROK_DOMAIN: ""
};

const BOOLEAN_FIELDS = new Set([
  "REQUIRE_GITHUB_AUTH",
  "CODEX_BOOTSTRAP_LOGIN",
  "CODEX_DEVICE_LOGIN_ON_START",
  "NGROK_ENABLE"
]);

function cleanValue(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

export function normalizeConfig(input = {}) {
  const normalized = {};

  for (const [key, defaultValue] of Object.entries(DEFAULT_CONFIG)) {
    const rawValue = input[key] ?? defaultValue;
    let cleaned = cleanValue(rawValue);

    if (BOOLEAN_FIELDS.has(key)) {
      cleaned = cleaned.toLowerCase() === "true" ? "true" : "false";
    }

    normalized[key] = cleaned;
  }

  return normalized;
}

export function validateConfig(input = {}) {
  const config = normalizeConfig(input);
  const errors = {};

  const requireField = (field, message) => {
    if (!config[field]) {
      errors[field] = message;
    }
  };

  requireField("JIRA_BASE_URL", "Jira base URL is required.");
  requireField("JIRA_USER_EMAIL", "Jira user email is required.");
  requireField("JIRA_API_TOKEN", "Jira API token is required.");

  if (config.JIRA_BASE_URL && !/^https:\/\/.+/i.test(config.JIRA_BASE_URL)) {
    errors.JIRA_BASE_URL = "Use a full Jira Cloud URL like https://your-site.atlassian.net.";
  }

  if (config.JIRA_USER_EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.JIRA_USER_EMAIL)) {
    errors.JIRA_USER_EMAIL = "Enter a valid email address.";
  }

  const githubToken = config.GITHUB_TOKEN || config.GH_TOKEN;
  if (config.REQUIRE_GITHUB_AUTH === "true" && !githubToken) {
    errors.GITHUB_TOKEN = "GitHub authentication is required for push and PR creation.";
  }

  const openAiToken = config.CODEX_API_KEY || config.OPENAI_API_KEY;
  const bootstrapLogin = config.CODEX_BOOTSTRAP_LOGIN === "true";
  const deviceLogin = config.CODEX_DEVICE_LOGIN_ON_START === "true";
  if (bootstrapLogin && !openAiToken && !deviceLogin) {
    errors.CODEX_API_KEY = "Provide an API key or enable device login on start.";
  }

  if (config.NGROK_ENABLE === "true" && !config.NGROK_AUTHTOKEN) {
    errors.NGROK_AUTHTOKEN = "ngrok authtoken is required when ngrok is enabled.";
  }

  if (!config.WORKFLOW_BASE_BRANCH) {
    errors.WORKFLOW_BASE_BRANCH = "Base branch is required.";
  }

  return {
    config,
    errors,
    isValid: Object.keys(errors).length === 0
  };
}

function quoteIfNeeded(value) {
  if (value.includes(" ") || value.includes("#")) {
    return `"${value.replaceAll('"', '\\"')}"`;
  }

  return value;
}

export function serializeEnv(configInput = {}) {
  const config = normalizeConfig(configInput);
  const lines = [
    "PORT=" + quoteIfNeeded(config.PORT),
    "",
    "# Jira cloud base URL, e.g. https://your-domain.atlassian.net",
    "JIRA_BASE_URL=" + quoteIfNeeded(config.JIRA_BASE_URL),
    "JIRA_USER_EMAIL=" + quoteIfNeeded(config.JIRA_USER_EMAIL),
    "JIRA_API_TOKEN=" + quoteIfNeeded(config.JIRA_API_TOKEN),
    "",
    "# Optional: validate incoming webhook request header x-jira-webhook-secret",
    "JIRA_WEBHOOK_SECRET=" + quoteIfNeeded(config.JIRA_WEBHOOK_SECRET),
    "",
    "# Tune transition names if your workflow uses different labels",
    "READY_STATUS=" + quoteIfNeeded(config.READY_STATUS),
    "IN_PROGRESS_STATUS=" + quoteIfNeeded(config.IN_PROGRESS_STATUS),
    "IN_REVIEW_STATUS=" + quoteIfNeeded(config.IN_REVIEW_STATUS),
    "",
    "# GitHub authentication",
    "GITHUB_TOKEN=" + quoteIfNeeded(config.GITHUB_TOKEN),
    "GH_TOKEN=" + quoteIfNeeded(config.GH_TOKEN),
    "REQUIRE_GITHUB_AUTH=" + config.REQUIRE_GITHUB_AUTH,
    "",
    "# Codex CLI authentication",
    "CODEX_API_KEY=" + quoteIfNeeded(config.CODEX_API_KEY),
    "OPENAI_API_KEY=" + quoteIfNeeded(config.OPENAI_API_KEY),
    "CODEX_BOOTSTRAP_LOGIN=" + config.CODEX_BOOTSTRAP_LOGIN,
    "CODEX_DEVICE_LOGIN_ON_START=" + config.CODEX_DEVICE_LOGIN_ON_START,
    "WORKFLOW_BASE_BRANCH=" + quoteIfNeeded(config.WORKFLOW_BASE_BRANCH),
    "CODEX_EXEC_ARGS=" + quoteIfNeeded(config.CODEX_EXEC_ARGS),
    "",
    "# Optional: expose local webhook through ngrok from inside container",
    "NGROK_ENABLE=" + config.NGROK_ENABLE,
    "NGROK_AUTHTOKEN=" + quoteIfNeeded(config.NGROK_AUTHTOKEN),
    "NGROK_API_KEY=" + quoteIfNeeded(config.NGROK_API_KEY),
    "NGROK_DOMAIN=" + quoteIfNeeded(config.NGROK_DOMAIN),
    ""
  ];

  return lines.join("\n");
}

export function parseEnvFile(content = "") {
  const merged = { ...DEFAULT_CONFIG };

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    if (!(key in merged)) {
      continue;
    }

    let value = trimmed.slice(separator + 1).trim();
    if (value.length >= 2 && value[0] === value[value.length - 1] && [`"`, "'"].includes(value[0])) {
      value = value.slice(1, -1);
    }

    merged[key] = value;
  }

  return normalizeConfig(merged);
}
