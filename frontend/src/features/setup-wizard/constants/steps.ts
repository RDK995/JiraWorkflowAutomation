export const STEPS = [
  { id: "welcome", title: "Welcome" },
  { id: "docker", title: "System Check" },
  { id: "jira", title: "Connect Jira" },
  { id: "github", title: "Connect GitHub" },
  { id: "integration", title: "Choose AI Integration" },
  { id: "ngrok", title: "Public Access" },
  { id: "review", title: "Ready For Launch" },
  { id: "run", title: "Launch Console" }
] as const;

export const STEP_FIELDS: Record<string, string[]> = {
  welcome: [],
  docker: [],
  jira: [
    "JIRA_BASE_URL",
    "JIRA_USER_EMAIL",
    "JIRA_API_TOKEN",
    "JIRA_WEBHOOK_SECRET",
    "READY_STATUS",
    "IN_PROGRESS_STATUS",
    "IN_REVIEW_STATUS"
  ],
  github: ["GITHUB_TOKEN", "GH_TOKEN", "REQUIRE_GITHUB_AUTH", "WORKFLOW_BASE_BRANCH"],
  integration: [
    "AI_AGENT",
    "CODEX_API_KEY",
    "OPENAI_API_KEY",
    "CODEX_BOOTSTRAP_LOGIN",
    "CODEX_DEVICE_LOGIN_ON_START",
    "CLAUDE_BOOTSTRAP_LOGIN",
    "CLAUDE_DEVICE_LOGIN_ON_START",
    "CODEX_EXEC_ARGS",
    "CLAUDE_EXEC_ARGS"
  ],
  ngrok: ["NGROK_ENABLE", "NGROK_AUTHTOKEN", "NGROK_API_KEY", "NGROK_DOMAIN"],
  review: [],
  run: []
};
