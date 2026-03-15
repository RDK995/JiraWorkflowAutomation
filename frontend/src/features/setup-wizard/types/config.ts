export type Config = Record<string, string>;

export const DEFAULT_CONFIG: Config = {
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
