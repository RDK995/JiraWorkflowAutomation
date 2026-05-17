import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { apiPost } from "../api/setupApi";
import { getGitHubErrorHelp, getIntegrationErrorHelp, getJiraErrorHelp, getJiraWebhookErrorHelp, getNgrokErrorHelp } from "../domain/checkGuidance";
import type { AuthProvider, ReadinessCheckResponse, StatusResponse } from "../types/api";
import type { Config, ConfigField } from "../types/config";

type UseReadinessChecksOptions = {
  config: Config;
  refreshStatus: () => Promise<StatusResponse>;
  selectedAiAgent: AuthProvider;
  setHideJiraWebhookSection: Dispatch<SetStateAction<boolean>>;
};

export function useReadinessChecks(options: UseReadinessChecksOptions) {
  const { config, refreshStatus, selectedAiAgent, setHideJiraWebhookSection } = options;
  const [jiraCheck, setJiraCheck] = useState<ReadinessCheckResponse | null>(null);
  const [jiraWebhookCheck, setJiraWebhookCheck] = useState<ReadinessCheckResponse | null>(null);
  const [gitHubCheck, setGitHubCheck] = useState<ReadinessCheckResponse | null>(null);
  const [integrationCheck, setIntegrationCheck] = useState<ReadinessCheckResponse | null>(null);
  const [ngrokCheck, setNgrokCheck] = useState<ReadinessCheckResponse | null>(null);
  const [isCheckingJira, setIsCheckingJira] = useState(false);
  const [isCheckingJiraWebhook, setIsCheckingJiraWebhook] = useState(false);
  const [isCheckingGitHub, setIsCheckingGitHub] = useState(false);
  const [isCheckingIntegration, setIsCheckingIntegration] = useState(false);
  const [isCheckingNgrok, setIsCheckingNgrok] = useState(false);

  const clearChecksForField = (field: ConfigField) => {
    if (["JIRA_BASE_URL", "JIRA_USER_EMAIL", "JIRA_API_TOKEN"].includes(field)) {
      setJiraCheck(null);
    }
    if (["JIRA_BASE_URL", "JIRA_USER_EMAIL", "JIRA_API_TOKEN", "JIRA_WEBHOOK_SECRET", "READY_STATUS", "IN_PROGRESS_STATUS", "NGROK_DOMAIN"].includes(field)) {
      setJiraWebhookCheck(null);
    }
    if (["GITHUB_TOKEN", "GH_TOKEN"].includes(field)) {
      setGitHubCheck(null);
    }
    if (["AI_AGENT", "CODEX_API_KEY", "OPENAI_API_KEY", "CODEX_BOOTSTRAP_LOGIN", "CODEX_DEVICE_LOGIN_ON_START", "CLAUDE_BOOTSTRAP_LOGIN", "CLAUDE_DEVICE_LOGIN_ON_START", "CLAUDE_EXEC_ARGS", "ANTHROPIC_API_KEY"].includes(field)) {
      setIntegrationCheck(null);
    }
    if (["NGROK_ENABLE", "NGROK_AUTHTOKEN", "NGROK_API_KEY", "NGROK_DOMAIN"].includes(field)) {
      setNgrokCheck(null);
    }
  };

  const clearIntegrationCheck = () => {
    setIntegrationCheck(null);
  };

  const runJiraCheck = async () => {
    setIsCheckingJira(true);
    try {
      setJiraCheck(await apiPost<ReadinessCheckResponse>("/api/checks/jira-readiness", { config }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setJiraCheck({ ok: false, checks: [{ command: "jira connectivity", ok: false, output: message }] });
    } finally {
      setIsCheckingJira(false);
    }
  };

  const runJiraWebhookCheck = async () => {
    setIsCheckingJiraWebhook(true);
    setHideJiraWebhookSection(false);
    try {
      const result = await apiPost<ReadinessCheckResponse>("/api/checks/jira-webhook-delivery", { config });
      setJiraWebhookCheck(result);
      await refreshStatus().catch(() => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setJiraWebhookCheck({ ok: false, checks: [{ command: "jira webhook delivery", ok: false, output: message }] });
      await refreshStatus().catch(() => undefined);
    } finally {
      setIsCheckingJiraWebhook(false);
    }
  };

  const runGitHubCheck = async () => {
    setIsCheckingGitHub(true);
    try {
      setGitHubCheck(await apiPost<ReadinessCheckResponse>("/api/checks/github-readiness", { config }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setGitHubCheck({ ok: false, checks: [{ command: "github connectivity", ok: false, output: message }] });
    } finally {
      setIsCheckingGitHub(false);
    }
  };

  const runIntegrationCheck = async () => {
    setIsCheckingIntegration(true);
    try {
      setIntegrationCheck(await apiPost<ReadinessCheckResponse>("/api/checks/codex-readiness", { config }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setIntegrationCheck({ ok: false, checks: [{ command: "integration readiness", ok: false, output: message }] });
    } finally {
      setIsCheckingIntegration(false);
    }
  };

  const runNgrokCheck = async () => {
    setIsCheckingNgrok(true);
    try {
      setNgrokCheck(await apiPost<ReadinessCheckResponse>("/api/checks/ngrok-readiness", { config }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setNgrokCheck({ ok: false, checks: [{ command: "ngrok readiness", ok: false, output: message }] });
    } finally {
      setIsCheckingNgrok(false);
    }
  };

  return {
    clearChecksForField,
    clearIntegrationCheck,
    gitHubCheck,
    gitHubErrorHelp: useMemo(() => getGitHubErrorHelp(gitHubCheck), [gitHubCheck]),
    integrationCheck,
    integrationErrorHelp: useMemo(() => getIntegrationErrorHelp(integrationCheck, selectedAiAgent), [integrationCheck, selectedAiAgent]),
    isCheckingGitHub,
    isCheckingIntegration,
    isCheckingJira,
    isCheckingJiraWebhook,
    isCheckingNgrok,
    jiraCheck,
    jiraErrorHelp: useMemo(() => getJiraErrorHelp(jiraCheck), [jiraCheck]),
    jiraWebhookCheck,
    jiraWebhookErrorHelp: useMemo(() => getJiraWebhookErrorHelp(jiraWebhookCheck), [jiraWebhookCheck]),
    ngrokCheck,
    ngrokErrorHelp: useMemo(() => getNgrokErrorHelp(ngrokCheck), [ngrokCheck]),
    runGitHubCheck,
    runIntegrationCheck,
    runJiraCheck,
    runJiraWebhookCheck,
    runNgrokCheck
  };
}
