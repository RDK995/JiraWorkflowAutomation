import type { AuthProvider, ReadinessCheckResponse } from "../types/api";

export function getJiraErrorHelp(jiraCheck: ReadinessCheckResponse | null): string {
  const output = jiraCheck?.checks?.[0]?.output?.toLowerCase() || "";
  if (!output || jiraCheck?.ok) {
    return "";
  }
  if (output.includes("missing required fields")) {
    return "Fill in the Jira site URL, account email, and API token before testing.";
  }
  if (output.includes("401") || output.includes("403") || output.includes("unauthorized") || output.includes("forbidden")) {
    return "Jira rejected the credentials. Double-check the account email and API token.";
  }
  if (output.includes("404")) {
    return "The Jira URL looks wrong. Use your full site URL, for example https://your-site.atlassian.net.";
  }
  if (output.includes("fetch failed") || output.includes("network") || output.includes("failed to fetch")) {
    return "Could not reach Jira. Check the site URL and make sure this machine can access Jira Cloud.";
  }
  return "The Jira check failed. Review the URL, email, token, and network access, then try again.";
}

export function getJiraWebhookErrorHelp(jiraWebhookCheck: ReadinessCheckResponse | null): string {
  const output = jiraWebhookCheck?.checks?.find((check) => !check.ok)?.output?.toLowerCase() || "";
  if (!output || jiraWebhookCheck?.ok) {
    return "";
  }
  if (output.includes("launch pronto before testing webhook delivery") || output.includes("not reachable on localhost:3000")) {
    return "This test works after PRonto is running. Launch the service first, then rerun the webhook delivery check.";
  }
  if (output.includes("could not determine the public webhook url") || output.includes("ngrok url appears in the logs")) {
    return "PRonto is running, but the setup flow could not find the public ngrok URL yet. Check the Public Access step and confirm ngrok started successfully.";
  }
  if (output.includes("401") || output.includes("invalid webhook secret")) {
    return "The webhook secret on this screen does not match what PRonto is expecting. Make sure Jira and PRonto use the same secret value.";
  }
  if (output.includes("404")) {
    return "The public URL responded, but not with the expected webhook path. Recheck the webhook URL and make sure it ends with /webhooks/jira-transition.";
  }
  return "The webhook did not make it through the public route cleanly. Check the public URL, secret, and PRonto launch logs, then retry.";
}

export function getGitHubErrorHelp(gitHubCheck: ReadinessCheckResponse | null): string {
  const output = gitHubCheck?.checks?.[0]?.output?.toLowerCase() || "";
  if (!output || gitHubCheck?.ok) {
    return "";
  }
  if (output.includes("missing required field")) {
    return "Add a GitHub token before testing access.";
  }
  if (output.includes("401") || output.includes("403") || output.includes("bad credentials")) {
    return "GitHub rejected the token. Make sure it is valid and has repository contents and pull request access.";
  }
  if (output.includes("fetch failed") || output.includes("network") || output.includes("failed to fetch")) {
    return "Could not reach GitHub. Check this machine's network access and try again.";
  }
  return "The GitHub check failed. Review the token and network access, then try again.";
}

export function getIntegrationErrorHelp(integrationCheck: ReadinessCheckResponse | null, selectedAiAgent: AuthProvider): string {
  const output = integrationCheck?.checks?.[0]?.output?.toLowerCase() || "";
  if (!output || integrationCheck?.ok) {
    return "";
  }
  if (selectedAiAgent === "claude") {
    if (output.includes("provide anthropic_api_key when ai_agent is set to claude")) {
      return "This response came from an outdated local services process. Restart setup-api and auth-broker so Claude device-login checks are used.";
    }
    if (output.includes("enable claude_device_login_on_start")) {
      return "Enable Claude device login on start, or select persisted login if a Claude session already exists in the shared volume.";
    }
    if (output.includes("device login")) {
      return "Claude Code is set to device login. Launch the container and complete authentication when prompted.";
    }
    return "The Claude Code check failed. Review the selected integration settings and try again.";
  }
  if (output.includes("codex_api_key or openai_api_key")) {
    return "Enable Codex device login on start, or choose persisted login if a Codex session already exists in the shared volume.";
  }
  if (output.includes("device login")) {
    return "Codex is set to device login. Launch the container and complete device authentication when prompted.";
  }
  return "The Codex check failed. Use device login or persisted login and try again.";
}

export function getNgrokErrorHelp(ngrokCheck: ReadinessCheckResponse | null): string {
  const output = ngrokCheck?.checks?.find((check) => !check.ok)?.output?.toLowerCase() || "";
  if (!output || ngrokCheck?.ok) {
    return "";
  }
  if (output.includes("ngrok_authtoken")) {
    return "Add an ngrok authtoken before testing public webhook access.";
  }
  if (output.includes("ngrok_api_key is missing")) {
    return "A reserved domain needs an ngrok API key so PRonto can verify it now and provision it during startup if needed.";
  }
  if (output.includes("401") || output.includes("403") || output.includes("unauthorized")) {
    return "ngrok rejected the API key. Make sure the API key is valid for the account that owns the reserved domain.";
  }
  if (output.includes("fetch failed") || output.includes("network") || output.includes("failed to fetch")) {
    return "Could not reach ngrok. Check this machine's network access and try again.";
  }
  return "The ngrok check failed. Review the authtoken, reserved domain, and API key settings, then try again.";
}
