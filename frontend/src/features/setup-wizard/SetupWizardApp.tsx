import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ConnectionTestPanel } from "../../components/ui/ConnectionTestPanel";
import { Field } from "../../components/ui/Field";
import { ResultList } from "../../components/ui/ResultList";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { Toggle } from "../../components/ui/Toggle";
import prontoConsoleIllustration from "../../assets/pronto_design_kit/pronto-console-illustration.png";
import prontoGlowOverlay from "../../assets/pronto_design_kit/pronto-glow-overlay.png";
import prontoHeroBg from "../../assets/pronto_design_kit/pronto-hero-bg.png";
import prontoRocketLarge from "../../assets/pronto_design_kit/pronto-rocket-large.png";
import prontoRocket from "../../assets/pronto_design_kit/pronto-rocket.png";
import prontoStarsOverlay from "../../assets/pronto_design_kit/pronto-stars-overlay.png";
import { apiGet, apiPost, getApiBase } from "./api/setupApi";
import { STEP_FIELDS, STEPS } from "./constants/steps";
import type { DockerContextResponse, PrereqResponse, ReadinessCheckResponse, StatusResponse, ValidationResponse } from "./types/api";
import { DEFAULT_CONFIG, type Config } from "./types/config";

function SetupWizardApp() {
  const apiBase = getApiBase();
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [checks, setChecks] = useState<PrereqResponse | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [activity, setActivity] = useState<string[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [dockerCheck, setDockerCheck] = useState<ReadinessCheckResponse | null>(null);
  const [jiraCheck, setJiraCheck] = useState<ReadinessCheckResponse | null>(null);
  const [gitHubCheck, setGitHubCheck] = useState<ReadinessCheckResponse | null>(null);
  const [integrationCheck, setIntegrationCheck] = useState<ReadinessCheckResponse | null>(null);
  const [ngrokCheck, setNgrokCheck] = useState<ReadinessCheckResponse | null>(null);
  const [isCheckingDocker, setIsCheckingDocker] = useState(false);
  const [isCheckingJira, setIsCheckingJira] = useState(false);
  const [isCheckingGitHub, setIsCheckingGitHub] = useState(false);
  const [isCheckingIntegration, setIsCheckingIntegration] = useState(false);
  const [isCheckingNgrok, setIsCheckingNgrok] = useState(false);
  const [isCheckingSetupApi, setIsCheckingSetupApi] = useState(false);
  const [isStartingColima, setIsStartingColima] = useState(false);
  const [isOpeningDockerDesktop, setIsOpeningDockerDesktop] = useState(false);
  const [isPollingDockerRecovery, setIsPollingDockerRecovery] = useState(false);
  const [isLoadingDockerContexts, setIsLoadingDockerContexts] = useState(false);
  const [isSwitchingDockerContext, setIsSwitchingDockerContext] = useState(false);
  const [setupApiReachable, setSetupApiReachable] = useState<boolean | null>(null);
  const [setupApiError, setSetupApiError] = useState<string>("");
  const [setupApiActionLabel, setSetupApiActionLabel] = useState("Start Setup API");
  const [dockerRecoveryMessage, setDockerRecoveryMessage] = useState<string>("");
  const [dockerContexts, setDockerContexts] = useState<DockerContextResponse["contexts"]>([]);
  const [selectedDockerContext, setSelectedDockerContext] = useState("");
  const [completedStepIndexes, setCompletedStepIndexes] = useState<number[]>([]);
  const [isNavigationLocked, setIsNavigationLocked] = useState(false);
  const [hasLaunchedThisSession, setHasLaunchedThisSession] = useState(false);

  useEffect(() => {
    document.title = "PRonto";

    let favicon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!favicon) {
      favicon = document.createElement("link");
      favicon.rel = "icon";
      document.head.appendChild(favicon);
    }
    favicon.href = prontoRocket;
  }, []);

  useEffect(() => {
    void Promise.all([
      apiGet<{ config: Config }>("/api/config"),
      apiGet<PrereqResponse>("/api/checks/prerequisites"),
      apiGet<StatusResponse>("/api/status")
    ])
      .then(([configResponse, prereqResponse, statusResponse]) => {
        setConfig({ ...DEFAULT_CONFIG, ...configResponse.config });
        setChecks(prereqResponse);
        setStatus(statusResponse);
      })
      .catch((error: Error) => {
        setActivity((current) => [...current, `Failed to load setup state: ${error.message}`]);
      });
  }, []);

  useEffect(() => {
    if (STEPS[stepIndex].id !== "run") {
      return;
    }

    const interval = window.setInterval(() => {
      void apiGet<StatusResponse>("/api/status").then(setStatus).catch(() => undefined);
    }, 4000);

    return () => window.clearInterval(interval);
  }, [stepIndex]);

  const checkSetupApiReachability = async (): Promise<boolean> => {
    setIsCheckingSetupApi(true);
    setSetupApiError("");
    try {
      await apiGet<StatusResponse>("/api/status");
      setSetupApiReachable(true);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setSetupApiReachable(false);
      setSetupApiError(message);
      return false;
    } finally {
      setIsCheckingSetupApi(false);
    }
  };

  useEffect(() => {
    if (STEPS[stepIndex].id !== "docker") {
      return;
    }

    void checkSetupApiReachability();
  }, [stepIndex]);

  useEffect(() => {
    if (STEPS[stepIndex].id !== "docker" || !dockerCheck || dockerCheck.ok) {
      return;
    }

    if (dockerCheck.diagnosis?.code === "docker_not_installed") {
      return;
    }

    if (dockerContexts.length > 0) {
      return;
    }

    void loadDockerContexts();
  }, [stepIndex, dockerCheck, dockerContexts.length]);

  const currentStep = STEPS[stepIndex];

  const codexAuthMode = useMemo(() => {
    if (config.CODEX_DEVICE_LOGIN_ON_START === "true") {
      return "device";
    }
    if (config.CODEX_BOOTSTRAP_LOGIN === "false") {
      return "persisted";
    }
    return "device";
  }, [config.CODEX_BOOTSTRAP_LOGIN, config.CODEX_DEVICE_LOGIN_ON_START]);
  const claudeAuthMode = useMemo(() => {
    if (config.CLAUDE_DEVICE_LOGIN_ON_START === "true") {
      return "device";
    }
    if (config.CLAUDE_BOOTSTRAP_LOGIN === "false") {
      return "persisted";
    }
    return "device";
  }, [config.CLAUDE_BOOTSTRAP_LOGIN, config.CLAUDE_DEVICE_LOGIN_ON_START]);
  const selectedAiAgent = config.AI_AGENT === "claude" ? "claude" : "codex";
  const integrationDisplayLabel = selectedAiAgent === "claude" ? "Claude Code" : "Codex";

  const reviewItems = useMemo(
    () => [
      ["Jira base URL", config.JIRA_BASE_URL || "Missing"],
      ["Jira user", config.JIRA_USER_EMAIL || "Missing"],
      ["GitHub token", config.GITHUB_TOKEN ? "Configured" : config.GH_TOKEN ? "Configured via GH_TOKEN" : "Missing"],
      ["AI integration", integrationDisplayLabel],
      [
        "Integration auth",
        selectedAiAgent === "claude"
          ? (claudeAuthMode === "device" ? "Device login" : "Persisted login")
          : codexAuthMode === "device"
              ? "Device login"
              : "Persisted login"
      ],
      ["Base branch", config.WORKFLOW_BASE_BRANCH || "Missing"],
      ["ngrok", config.NGROK_ENABLE === "true" ? "Enabled" : "Disabled"]
    ],
    [claudeAuthMode, codexAuthMode, config, integrationDisplayLabel, selectedAiAgent]
  );

  const launchSucceeded = Boolean(status?.docker.container.running);
  const runStepIndex = STEPS.findIndex((step) => step.id === "run");

  useEffect(() => {
    if (launchSucceeded && hasLaunchedThisSession) {
      setIsNavigationLocked(true);
      setStepIndex(runStepIndex);
      return;
    }

    setIsNavigationLocked(false);
  }, [launchSucceeded, hasLaunchedThisSession, runStepIndex]);

  const updateField = (field: string, value: string) => {
    setConfig((current) => ({ ...current, [field]: value }));
    if (["JIRA_BASE_URL", "JIRA_USER_EMAIL", "JIRA_API_TOKEN"].includes(field)) {
      setJiraCheck(null);
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
    setErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const updateCodexAuthMode = (mode: string) => {
    setConfig((current) => {
      if (mode === "device") {
        return {
          ...current,
          CODEX_BOOTSTRAP_LOGIN: "true",
          CODEX_DEVICE_LOGIN_ON_START: "true",
          CODEX_API_KEY: "",
          OPENAI_API_KEY: ""
        };
      }

      if (mode === "persisted") {
        return {
          ...current,
          CODEX_BOOTSTRAP_LOGIN: "false",
          CODEX_DEVICE_LOGIN_ON_START: "false",
          CODEX_API_KEY: "",
          OPENAI_API_KEY: ""
        };
      }

      return {
        ...current,
        CODEX_BOOTSTRAP_LOGIN: "true",
        CODEX_DEVICE_LOGIN_ON_START: "true",
        CODEX_API_KEY: "",
        OPENAI_API_KEY: ""
      };
    });
    setIntegrationCheck(null);
    setErrors((current) => {
      const next = { ...current };
      delete next.CODEX_API_KEY;
      delete next.OPENAI_API_KEY;
      delete next.CODEX_BOOTSTRAP_LOGIN;
      delete next.CODEX_DEVICE_LOGIN_ON_START;
      return next;
    });
  };

  const updateAiAgent = (agent: string) => {
    if (agent === "claude") {
      setConfig((current) => ({
        ...current,
        AI_AGENT: "claude",
        CLAUDE_BOOTSTRAP_LOGIN: "true",
        CLAUDE_DEVICE_LOGIN_ON_START: "true",
        ANTHROPIC_API_KEY: ""
      }));
      setIntegrationCheck(null);
      setErrors((current) => {
        const next = { ...current };
        delete next.AI_AGENT;
        delete next.CLAUDE_BOOTSTRAP_LOGIN;
        delete next.CLAUDE_DEVICE_LOGIN_ON_START;
        delete next.ANTHROPIC_API_KEY;
        return next;
      });
      return;
    }
    setConfig((current) => ({
      ...current,
      AI_AGENT: "codex",
      CODEX_BOOTSTRAP_LOGIN: "true",
      CODEX_DEVICE_LOGIN_ON_START: "true",
      CODEX_API_KEY: "",
      OPENAI_API_KEY: ""
    }));
    setIntegrationCheck(null);
    setErrors((current) => {
      const next = { ...current };
      delete next.AI_AGENT;
      delete next.CODEX_API_KEY;
      delete next.OPENAI_API_KEY;
      delete next.CODEX_BOOTSTRAP_LOGIN;
      delete next.CODEX_DEVICE_LOGIN_ON_START;
      delete next.CLAUDE_BOOTSTRAP_LOGIN;
      delete next.CLAUDE_DEVICE_LOGIN_ON_START;
      delete next.ANTHROPIC_API_KEY;
      return next;
    });
  };

  const updateClaudeAuthMode = (mode: string) => {
    setConfig((current) => {
      if (mode === "persisted") {
        return {
          ...current,
          CLAUDE_BOOTSTRAP_LOGIN: "false",
          CLAUDE_DEVICE_LOGIN_ON_START: "false",
          ANTHROPIC_API_KEY: ""
        };
      }
      return {
        ...current,
        CLAUDE_BOOTSTRAP_LOGIN: "true",
        CLAUDE_DEVICE_LOGIN_ON_START: "true",
        ANTHROPIC_API_KEY: ""
      };
    });
    setIntegrationCheck(null);
    setErrors((current) => {
      const next = { ...current };
      delete next.CLAUDE_BOOTSTRAP_LOGIN;
      delete next.CLAUDE_DEVICE_LOGIN_ON_START;
      delete next.ANTHROPIC_API_KEY;
      return next;
    });
  };

  const validate = async () => {
    const result = await apiPost<ValidationResponse>("/api/config/validate", { config });
    setErrors(result.errors);
    return result.isValid;
  };

  const validateStep = async (stepId: string) => {
    const result = await apiPost<ValidationResponse>("/api/config/validate", { config });
    const fields = new Set(STEP_FIELDS[stepId] || []);
    const visibleErrors = Object.fromEntries(Object.entries(result.errors).filter(([field]) => fields.has(field)));
    setErrors((current) => {
      const next = { ...current };
      for (const field of fields) {
        delete next[field];
      }
      return { ...next, ...visibleErrors };
    });
    return Object.keys(visibleErrors).length === 0;
  };

  const saveConfig = async () => {
    const valid = await validate();
    if (!valid) {
      setActivity((current) => [...current, "Config validation failed. Fix the highlighted fields before launching PRonto."]);
      return false;
    }

    const result = await apiPost<ValidationResponse & { saved: boolean }>("/api/config/save", { config });
    setErrors(result.errors);
    setActivity((current) => [...current, "Generated the PRonto environment configuration."]);
    return result.saved;
  };

  const runSetup = async () => {
    setIsBusy(true);
    setActivity([]);

    try {
      const saved = await saveConfig();
      if (!saved) {
        return;
      }

      setActivity((current) => [...current, "Building the PRonto automation image."]);
      await apiPost("/api/docker/build", {});

      setActivity((current) => [...current, "Starting the PRonto service container."]);
      setHasLaunchedThisSession(true);
      await apiPost("/api/docker/run", {});

      const latestStatus = await apiGet<StatusResponse>("/api/status");
      setStatus(latestStatus);
      if (latestStatus.docker.container.running) {
        setIsNavigationLocked(true);
        setStepIndex(runStepIndex);
      }
      setActivity((current) => [...current, "Container started"]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setActivity((current) => [...current, `Launch failed: ${message}`]);
    } finally {
      setIsBusy(false);
    }
  };

  const stopSetup = async () => {
    try {
      await apiPost("/api/docker/stop", {});
      const latestStatus = await apiGet<StatusResponse>("/api/status");
      setStatus(latestStatus);
      setHasLaunchedThisSession(false);
      setIsNavigationLocked(false);
      setActivity((current) => [...current, "Container stopped"]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setActivity((current) => [...current, `Stop failed: ${message}`]);
    }
  };

  const runDockerCheck = async () => {
    if (setupApiReachable === false) {
      setDockerCheck({
        ok: false,
        checks: [
          {
            command: "setup api reachability",
            ok: false,
            output: setupApiError || "Setup API is offline. Start the Setup API before running Docker readiness."
          }
        ]
      });
      return;
    }

    setIsCheckingDocker(true);
    try {
      setDockerCheck(await apiPost<ReadinessCheckResponse>("/api/checks/docker-readiness", {}));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setDockerCheck({ ok: false, checks: [{ command: "docker readiness", ok: false, output: message }] });
    } finally {
      setIsCheckingDocker(false);
    }
  };

  const loadDockerContexts = async () => {
    setIsLoadingDockerContexts(true);
    try {
      const response = await apiGet<DockerContextResponse>("/api/docker/contexts");
      setDockerContexts(response.contexts);
      const currentContext = response.contexts.find((context) => context.current)?.name || response.contexts[0]?.name || "";
      setSelectedDockerContext((current) => current || currentContext);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setDockerRecoveryMessage(`Could not load Docker contexts: ${message}`);
    } finally {
      setIsLoadingDockerContexts(false);
    }
  };

  const pollDockerRecovery = async (successMessage: string) => {
    setIsPollingDockerRecovery(true);
    try {
      for (let attempt = 0; attempt < 36; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2500));
        const result = await apiPost<ReadinessCheckResponse>("/api/checks/docker-readiness", {});
        setDockerCheck(result);
        if (result.ok) {
          setDockerRecoveryMessage(successMessage);
          await apiGet<StatusResponse>("/api/status").then(setStatus).catch(() => undefined);
          return;
        }
      }
      setDockerRecoveryMessage("Docker recovery was started, but the runtime did not become ready yet. Review the latest diagnosis below and try another action if needed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setDockerRecoveryMessage(`Docker recovery check failed: ${message}`);
    } finally {
      setIsPollingDockerRecovery(false);
    }
  };

  const startColimaFromUi = async () => {
    setIsStartingColima(true);
    setDockerRecoveryMessage("");
    try {
      const result = await apiPost<{ ok: boolean; output: string }>("/api/docker/start-colima", {});
      setDockerRecoveryMessage(result.output || "Colima started. Waiting for Docker to become ready...");
      setIsStartingColima(false);
      await pollDockerRecovery("Colima started and Docker is now ready.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setDockerRecoveryMessage(`Could not start Colima: ${message}`);
      setIsStartingColima(false);
    }
  };

  const openDockerDesktopFromUi = async () => {
    setIsOpeningDockerDesktop(true);
    setDockerRecoveryMessage("");
    try {
      const result = await apiPost<{ ok: boolean; output: string }>("/api/docker/open-docker-desktop", {});
      setDockerRecoveryMessage(result.output || "Docker Desktop launched. Waiting for Docker to become ready...");
      setIsOpeningDockerDesktop(false);
      await pollDockerRecovery("Docker Desktop finished starting and Docker is now ready.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setDockerRecoveryMessage(`Could not open Docker Desktop: ${message}`);
      setIsOpeningDockerDesktop(false);
    }
  };

  const switchDockerContextFromUi = async () => {
    if (!selectedDockerContext) {
      return;
    }
    setIsSwitchingDockerContext(true);
    setDockerRecoveryMessage("");
    try {
      const result = await apiPost<{ ok: boolean; output: string }>("/api/docker/context/use", { name: selectedDockerContext });
      setDockerRecoveryMessage(result.output || `Switched Docker context to ${selectedDockerContext}. Rechecking Docker...`);
      await runDockerCheck();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setDockerRecoveryMessage(`Could not switch Docker context: ${message}`);
    } finally {
      setIsSwitchingDockerContext(false);
    }
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

  const handleStartSetupApi = async () => {
    const command = "npm run dev:setup-api";
    try {
      setSetupApiActionLabel("Starting...");
      const response = await fetch("/__local/start-setup-api", { method: "POST" });
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

      setSetupApiActionLabel("Starting Setup API...");
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 700));
        const reachable = await checkSetupApiReachability();
        if (reachable) {
          setSetupApiActionLabel("Setup API running");
          window.setTimeout(() => setSetupApiActionLabel("Start Setup API"), 1800);
          return;
        }
      }

      setSetupApiActionLabel("Could not start");
      window.setTimeout(() => setSetupApiActionLabel("Start Setup API"), 1800);
    } catch {
      try {
        await navigator.clipboard.writeText(command);
        setSetupApiActionLabel("Command copied");
      } catch {
        setSetupApiActionLabel(command);
      }
      window.setTimeout(() => setSetupApiActionLabel("Start Setup API"), 2200);
    }
  };

  const jiraErrorHelp = useMemo(() => {
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
  }, [jiraCheck]);

  const gitHubErrorHelp = useMemo(() => {
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
  }, [gitHubCheck]);

  const integrationErrorHelp = useMemo(() => {
    const output = integrationCheck?.checks?.[0]?.output?.toLowerCase() || "";
    if (!output || integrationCheck?.ok) {
      return "";
    }
    if (selectedAiAgent === "claude") {
      if (output.includes("provide anthropic_api_key when ai_agent is set to claude")) {
        return "This response came from an outdated Setup API process. Restart setup-api so Claude device-login checks are used.";
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
  }, [integrationCheck, selectedAiAgent]);

  const ngrokErrorHelp = useMemo(() => {
    const output = ngrokCheck?.checks?.find((check) => !check.ok)?.output?.toLowerCase() || "";
    if (!output || ngrokCheck?.ok) {
      return "";
    }
    if (output.includes("ngrok_authtoken")) {
      return "Turn ngrok on only if you want public webhook access, and add an ngrok authtoken before testing.";
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
  }, [ngrokCheck]);

  const dockerErrorHelp = useMemo(() => {
    const diagnosisCode = dockerCheck?.diagnosis?.code || "";
    const output = dockerCheck?.checks?.[0]?.output?.toLowerCase() || "";
    if ((!output && !diagnosisCode) || dockerCheck?.ok) {
      return "";
    }
    if (diagnosisCode === "docker_not_installed") {
      return "Docker is not installed yet. Install Docker Desktop or another supported Docker runtime before continuing.";
    }
    if (diagnosisCode === "colima_not_installed") {
      return "Docker is pointed at a Colima context, but Colima is not installed. Install Colima or switch Docker to a different runtime.";
    }
    if (diagnosisCode === "colima_broken") {
      return "The active Colima profile looks broken. Switch Docker to another context, or repair and recreate the Colima profile before retrying.";
    }
    if (diagnosisCode === "colima_stopped" || diagnosisCode === "colima_socket_missing") {
      return "Docker is using Colima, but the Colima runtime is not available. Start Colima from the UI, then rerun the check.";
    }
    if (diagnosisCode === "docker_context_misconfigured") {
      return "Docker is installed, but the active Docker context does not look healthy. Switch to a working context or restart the selected runtime.";
    }
    if (diagnosisCode === "docker_permission_denied") {
      return "Docker is installed, but this user cannot access the Docker socket. Fix local Docker permissions, then retry.";
    }
    if (diagnosisCode === "docker_runtime_not_running") {
      return "Docker is installed but the selected runtime is not running. Start Docker Desktop or Colima, then retry.";
    }
    if (output.includes("failed to fetch") || output.includes("fetch failed") || output.includes("networkerror")) {
      return "PRonto could not reach the local Setup API. This is usually not a Docker problem. Start the Setup API and verify the API URL is reachable from your browser.";
    }
    if (output.includes("request failed: 5")) {
      return "The Setup API is reachable but returned a server error. Restart the Setup API and run the check again.";
    }
    if (output.includes("docker: command not found")) {
      return "Docker CLI is not installed or not in PATH. Install Docker Desktop and reopen your terminal.";
    }
    if (output.includes("cannot connect") || output.includes("is the docker daemon running")) {
      return "Docker is installed but the engine is not running. Open Docker Desktop (or start Colima) and retry.";
    }
    return "The system check failed. Use the options below to verify Setup API connectivity and Docker runtime.";
  }, [dockerCheck]);

  const dockerDiagnosis = dockerCheck?.diagnosis;
  const dockerPlatform = dockerDiagnosis?.platform || "";
  const dockerFailureOutput = useMemo(
    () => dockerCheck?.checks?.find((check) => !check.ok)?.output?.toLowerCase() || "",
    [dockerCheck]
  );
  const dockerLooksLikeColima =
    dockerDiagnosis?.runtime === "colima" || dockerFailureOutput.includes(".colima") || dockerFailureOutput.includes("colima");
  const canStartColima =
    dockerDiagnosis?.code !== "colima_broken" &&
    (
      dockerDiagnosis?.code === "colima_stopped" ||
      dockerDiagnosis?.code === "colima_socket_missing" ||
      dockerLooksLikeColima
    );
  const canOpenDockerDesktop =
    dockerPlatform === "darwin" &&
    (dockerDiagnosis?.code === "docker_runtime_not_running" ||
      dockerDiagnosis?.code === "docker_context_misconfigured" ||
      !dockerDiagnosis);
  const shouldOfferContextSwitch =
    dockerDiagnosis?.code === "colima_broken" ||
    dockerDiagnosis?.code === "docker_context_misconfigured" ||
    dockerDiagnosis?.code === "colima_socket_missing" ||
    dockerDiagnosis?.code === "docker_runtime_not_running";
  const dockerInstallLink =
    dockerPlatform === "win32"
      ? "https://www.docker.com/products/docker-desktop/"
      : dockerPlatform === "linux"
        ? "https://docs.docker.com/engine/install/"
        : "https://www.docker.com/products/docker-desktop/";
  const dockerInstallLabel =
    dockerPlatform === "linux" ? "Open Docker Engine install guide" : "Open Docker Desktop install guide";
  const dockerPlatformHelp =
    dockerPlatform === "win32"
      ? "On Windows, start Docker Desktop and wait for the engine to finish initializing."
      : dockerPlatform === "linux"
        ? "On Linux, start your Docker daemon or service, then rerun the system check."
        : "On macOS, start Docker Desktop or Colima, then rerun the system check.";
  const requiresGitHubAuth = config.REQUIRE_GITHUB_AUTH === "true";
  const stepTestPassed = {
    docker: Boolean(dockerCheck?.ok),
    jira: Boolean(jiraCheck?.ok),
    github: !requiresGitHubAuth || Boolean(gitHubCheck?.ok),
    integration: Boolean(integrationCheck?.ok),
    ngrok: Boolean(ngrokCheck?.ok)
  } as const;
  const currentStepRequiresPassingTest = ["docker", "jira", "github", "integration", "ngrok"].includes(currentStep.id);
  const currentStepHasPassingTest = currentStep.id in stepTestPassed
    ? stepTestPassed[currentStep.id as keyof typeof stepTestPassed]
    : true;
  const createdPullRequests = useMemo(() => extractPullRequestUrls(status?.logs || ""), [status?.logs]);

  const nextStep = async () => {
    if (currentStep.id === "docker" && !stepTestPassed.docker) {
      setActivity((current) => [...current, "Run the system check successfully before continuing."]);
      return;
    }
    if (["jira", "github", "integration", "ngrok"].includes(currentStep.id)) {
      const valid = await validateStep(currentStep.id);
      if (!valid) {
        return;
      }
      if (!currentStepHasPassingTest) {
        const labels: Record<string, string> = {
          jira: "Test Jira Connection",
          github: "Test GitHub Access",
          integration: "Test Integration Access",
          ngrok: "Test Public Access"
        };
        setActivity((current) => [...current, `Run ${labels[currentStep.id]} successfully before continuing.`]);
        return;
      }
    }
    if (currentStep.id === "review") {
      const valid = await validate();
      if (!valid) {
        setActivity((current) => [...current, "Complete the remaining required fields before launching PRonto."]);
        return;
      }
    }
    setCompletedStepIndexes((current) => (current.includes(stepIndex) ? current : [...current, stepIndex]));
    setStepIndex((current) => Math.min(current + 1, STEPS.length - 1));
  };

  const previousStep = () => {
    if (isNavigationLocked) {
      return;
    }
    setStepIndex((current) => Math.max(current - 1, 0));
  };

  const goToStep = (index: number) => {
    if (isNavigationLocked) {
      setStepIndex(runStepIndex);
      return;
    }
    if (index === stepIndex) {
      return;
    }
    if (!completedStepIndexes.includes(index)) {
      return;
    }
    setStepIndex(index);
  };

  return (
    <div className="app-shell">
      <div className="bg-orb bg-orb-left" />
      <div className="bg-orb bg-orb-right" />
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-lockup">
            <img src={prontoRocket} alt="PRonto logo" className="brand-mark-image brand-logo-sidebar" />
            <div>
              <p className="eyebrow">PRonto</p>
              <h1>PRonto</h1>
            </div>
          </div>
          <p className="lede">From ticket to PR. PRonto.</p>
          <p className="sidebar-copy">
            A premium launch flow for connecting Jira, GitHub, and your AI coding integration, then moving from active ticket to pull request with less friction.
          </p>
        </div>

        <ol className="step-list">
          {STEPS.map((step, index) => (
            <li
              key={step.id}
              className={`step-item ${index === stepIndex ? "active" : ""} ${completedStepIndexes.includes(index) ? "completed" : ""} ${!completedStepIndexes.includes(index) && index !== stepIndex ? "locked" : ""}`}
            >
              <button className="step-item-button" type="button" onClick={() => goToStep(index)} disabled={isNavigationLocked || (!completedStepIndexes.includes(index) && index !== stepIndex)}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{step.title}</strong>
              </button>
            </li>
          ))}
        </ol>
      </aside>

      <main className="content">
        {currentStep.id !== "welcome" ? (
          <section className="panel hero-panel">
            <div className="hero-copy">
              <p className="eyebrow">PRonto Launch Setup</p>
              <h2>{currentStep.title}</h2>
              <p className="hero-detail">Connect services, validate access, and launch the automation service from one polished control surface.</p>
            </div>
            <div className="status-grid">
              <StatusBadge label="System Check" value={checks?.dockerInstalled ? "Ready" : "Missing"} tone={checks?.dockerInstalled ? "good" : "warn"} />
              <StatusBadge label="Config" value={status?.config.exists ? "Primed" : "Not saved"} tone={status?.config.exists ? "good" : "neutral"} />
              <StatusBadge label="Service" value={status?.docker.container.running ? "Running" : status?.docker.container.status || "Unknown"} tone={status?.docker.container.running ? "good" : "neutral"} />
              <StatusBadge label="Health" value={status?.health.reachable ? "Healthy" : "Offline"} tone={status?.health.reachable ? "good" : "warn"} />
            </div>
          </section>
        ) : null}

        <section className="panel content-stage">
          {currentStep.id === "welcome" && (
            <div className="welcome-layout">
              <section className="welcome-hero">
                <img src={prontoHeroBg} alt="" className="welcome-hero-art" />
                <img src={prontoStarsOverlay} alt="" className="welcome-stars-overlay" />
                <img src={prontoGlowOverlay} alt="" className="welcome-glow-overlay" />
                <div className="welcome-hero-overlay" />
                <div className="welcome-copy">
                  <h3 className="welcome-headline">
                    <img src={prontoRocketLarge} alt="" className="welcome-headline-logo welcome-headline-logo-large" />
                    <span>From Ticket to PR. PRonto.</span>
                  </h3>
                  <p className="muted">
                    Connect Jira, GitHub, and your preferred AI coding integration once. PRonto can generate the spec, prepare the repository, run the coding workflow, and open a pull request automatically when work begins.
                  </p>
                  <div className="welcome-primary-action">
                    <div className="welcome-cta-row welcome-cta-row-prominent">
                      <button
                        className="primary hero-primary welcome-get-started"
                        onClick={() => {
                          setCompletedStepIndexes((current) => (current.includes(0) ? current : [...current, 0]));
                          setStepIndex(1);
                        }}
                      >
                        Get Started
                      </button>
                      <button className="secondary hero-secondary" onClick={() => document.getElementById("welcome-story")?.scrollIntoView({ behavior: "smooth" })}>
                        Learn More
                      </button>
                    </div>
                    <p className="welcome-action-hint">Start with a quick system check, then connect Jira, GitHub, and your AI integration.</p>
                  </div>
                  <div className="welcome-actions">
                    <div className="welcome-chip">Less manual handoff</div>
                    <div className="welcome-chip">Jira and GitHub stay connected</div>
                    <div className="welcome-chip">Built for fast review loops</div>
                  </div>
                  <p className="welcome-subnote">From ticket to PR. PRonto.</p>
                </div>

                <div className="terminal-panel" aria-hidden="true">
                  <div className="terminal-header">
                    <span className="terminal-dot terminal-dot-red" />
                    <span className="terminal-dot terminal-dot-amber" />
                    <span className="terminal-dot terminal-dot-green" />
                    <div className="terminal-title">
                      <img src={prontoRocket} alt="" className="terminal-mark-image brand-logo-terminal" />
                      <span>PRonto</span>
                    </div>
                  </div>
                  <div className="terminal-body">
                    <p><span className="terminal-prompt">$</span> pronto JIRA-123</p>
                    <p className="terminal-muted">Initializing automation pipeline...</p>
                    <p><span className="terminal-icon">✓</span> Jira issue moved to In Progress</p>
                    <p><span className="terminal-icon">✓</span> Spec generated and repository prepared</p>
                    <p><span className="terminal-icon">✓</span> AI understands requirements and code is generated and pushed</p>
                    <p><span className="terminal-icon">✓</span> PR created successfully</p>
                  </div>
                </div>
              </section>

              <section className="welcome-summary" id="welcome-story">
                <div className="guide-card welcome-summary-card">
                  <p className="eyebrow">What Happens After Setup</p>
                  <div className="summary-steps">
                    <SummaryStep number="01" title="Jira triggers the workflow" text="A ticket transition starts the automation the moment delivery work begins." />
                    <SummaryStep number="02" title="A spec is generated" text="The ticket context is converted into an implementation-ready plan." />
                    <SummaryStep number="03" title="The repo is prepared" text="The correct repository is selected, cloned, and branched automatically." />
                    <SummaryStep number="04" title="Implementation runs" text="The coding workflow applies changes and prepares the result for review." />
                    <SummaryStep number="05" title="A PR is opened" text="The branch is pushed and a pull request is created against the target base branch." />
                    <SummaryStep number="06" title="Jira is updated" text="The issue receives the outcome so the handoff back to review stays visible." />
                  </div>
                </div>
              </section>
            </div>
          )}

          {currentStep.id === "docker" && (
            <div className="two-column">
              <div className="step-main-card">
                <p className="eyebrow">Preflight</p>
                <h3>Run the PRonto system check.</h3>
                <p className="muted">
                  PRonto launches through Docker. Install Docker, open it once, and confirm the engine is ready before connecting the rest of the stack.
                </p>
                <div className="guide-stack">
                  <ol className="plain-list ordered">
                    <li>Install Docker Desktop for your platform and open it once.</li>
                    <li>Wait for the dashboard to load and the Docker whale to appear active.</li>
                    <li>Run the PRonto system check below before moving on.</li>
                  </ol>
                  <div className="action-row">
                    <button
                      className={`primary docker-check-button ${dockerCheck ? (dockerCheck.ok ? "is-pass" : "is-fail") : ""}`}
                      onClick={() => void runDockerCheck()}
                      disabled={isCheckingDocker || isCheckingSetupApi || setupApiReachable === false}
                    >
                      {isCheckingDocker ? "Running System Check..." : "Run System Check"}
                    </button>
                    {dockerCheck?.ok ? <span className="check-pass">✓ System ready</span> : null}
                  </div>
                </div>
              </div>
              <div className="guide-card terminal-side-panel">
                <h3>System output</h3>
                {isCheckingSetupApi ? <p className="muted">Checking Setup API reachability...</p> : null}
                {setupApiReachable === false ? (
                  <div className="guide-section guide-error-help docker-troubleshooting">
                    <h4>Setup API offline</h4>
                    <p>PRonto cannot run Docker checks until the local Setup API is reachable.</p>
                    {setupApiError ? <p className="muted"><code>{setupApiError}</code></p> : null}
                    <ol className="plain-list ordered">
                      <li>Start Setup API: <code>npm run dev:setup-api</code></li>
                      <li>
                        Open and verify:{" "}
                        <a href={`${apiBase}/api/status`} target="_blank" rel="noreferrer">
                          {apiBase}/api/status
                        </a>
                      </li>
                      <li>If localhost fails, use <code>VITE_SETUP_API_BASE_URL=http://127.0.0.1:3010</code></li>
                    </ol>
                    <div className="action-row">
                      <button className="primary" onClick={() => void handleStartSetupApi()}>
                        {setupApiActionLabel}
                      </button>
                      <button
                        className="secondary"
                        onClick={() => void checkSetupApiReachability()}
                        disabled={isCheckingSetupApi}
                      >
                        Recheck Setup API
                      </button>
                    </div>
                  </div>
                ) : null}
                <ResultList result={dockerCheck} emptyMessage="Run the system check to confirm this machine is ready for launch." />
                {dockerCheck && !dockerCheck.ok ? (
                  <div className="guide-section guide-error-help docker-troubleshooting">
                    <h4>{dockerDiagnosis?.title || "Fix options"}</h4>
                    <p>{dockerErrorHelp}</p>
                    {dockerDiagnosis?.context ? <p className="muted">Active Docker context: <code>{dockerDiagnosis.context}</code></p> : null}
                    <p className="muted">{dockerPlatformHelp}</p>
                    {dockerDiagnosis?.code === "docker_not_installed" ? (
                      <p className="muted">
                        Install Docker from{" "}
                        <a href={dockerInstallLink} target="_blank" rel="noreferrer">
                          {dockerInstallLink}
                        </a>
                        .
                      </p>
                    ) : null}
                    {dockerDiagnosis?.code === "colima_not_installed" ? (
                      <p className="muted">Install Colima or switch Docker to a different context before continuing.</p>
                    ) : null}
                    {dockerDiagnosis?.code === "colima_broken" ? (
                      <p className="muted">This usually needs a Colima profile repair or recreation outside PRonto, or a switch to a different Docker context.</p>
                    ) : null}
                    {dockerDiagnosis?.code === "docker_context_misconfigured" ? (
                      <p className="muted">Switch to a working Docker context such as <code>default</code> or the active Desktop context, then retry.</p>
                    ) : null}
                    {dockerDiagnosis?.code === "docker_permission_denied" ? (
                      <p className="muted">Fix local Docker socket permissions for this user account, then rerun the system check.</p>
                    ) : null}
                    {dockerRecoveryMessage ? <p className="muted">{dockerRecoveryMessage}</p> : null}
                    {isPollingDockerRecovery ? <p className="muted">Waiting for Docker to become ready...</p> : null}
                    {canStartColima || canOpenDockerDesktop ? (
                      <div className="action-row">
                        {canStartColima ? (
                          <button className="primary" onClick={() => void startColimaFromUi()} disabled={isStartingColima || isCheckingDocker || isPollingDockerRecovery}>
                            {isStartingColima ? "Starting Colima..." : "Start Colima"}
                          </button>
                        ) : null}
                        {canOpenDockerDesktop ? (
                          <button className="secondary" onClick={() => void openDockerDesktopFromUi()} disabled={isOpeningDockerDesktop || isPollingDockerRecovery}>
                            {isOpeningDockerDesktop ? "Opening Docker Desktop..." : "Open Docker Desktop"}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {shouldOfferContextSwitch ? (
                      <div className="guide-section">
                        <h4>Switch Docker context</h4>
                        <p className="muted">If Docker is pointed at the wrong runtime, switch to another available context and rerun the check.</p>
                        <div className="action-row">
                          <label className="field docker-context-field">
                            <span>Docker context</span>
                            <select value={selectedDockerContext} onChange={(event) => setSelectedDockerContext(event.target.value)}>
                              {dockerContexts.map((context) => (
                                <option key={context.name} value={context.name}>
                                  {context.name}{context.current ? " (current)" : ""}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="action-row">
                          <button className="secondary" onClick={() => void loadDockerContexts()} disabled={isLoadingDockerContexts}>
                            {isLoadingDockerContexts ? "Loading Contexts..." : dockerContexts.length > 0 ? "Refresh Contexts" : "Load Contexts"}
                          </button>
                          <button className="primary" onClick={() => void switchDockerContextFromUi()} disabled={!selectedDockerContext || isSwitchingDockerContext}>
                            {isSwitchingDockerContext ? "Switching Context..." : "Use Selected Context"}
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {dockerDiagnosis?.code === "docker_not_installed" ? (
                      <div className="action-row">
                        <a className="secondary button-link" href={dockerInstallLink} target="_blank" rel="noreferrer">
                          {dockerInstallLabel}
                        </a>
                      </div>
                    ) : null}
                    <div className="action-row">
                      <button className="secondary" onClick={() => void runDockerCheck()} disabled={isCheckingDocker || isPollingDockerRecovery}>
                        {isCheckingDocker ? "Retrying..." : "Retry System Check"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {currentStep.id === "jira" && (
            <StepLayout
              title="Connect Jira"
              description="Provide the Jira connection PRonto will use to read issues, generate specs, and post results back into the ticket."
              asideClassName="guide-card guide-card-compact"
              asideContent={
                <>
                  <GuideChecklist title="Need these 3 values" items={["Jira site URL", "Jira account email", "Jira API token"]} />
                  <GuideLinkCard
                    title="Create API token"
                    description="Open Atlassian API token settings and create a token for the Jira account you want PRonto to use."
                    href="https://id.atlassian.com/manage-profile/security/api-tokens"
                    linkLabel="Open Atlassian token settings"
                  />
                  <GuideLinkCard
                    title="Open Jira webhook settings"
                    description="After the connection test passes, open your Jira webhook admin page to create the transition webhook PRonto listens for."
                    href={config.JIRA_BASE_URL ? `${config.JIRA_BASE_URL.replace(/\/+$/, "")}/secure/admin/Webhooks.jspa` : "https://support.atlassian.com/jira-cloud-administration/docs/manage-webhooks/"}
                    linkLabel={config.JIRA_BASE_URL ? "Open webhook settings in Jira" : "Open Jira webhook docs"}
                  />
                  <FieldGuide
                    items={[
                      ["Base URL", <code key="base">https://your-site.atlassian.net</code>],
                      ["User email", "The email tied to your Jira account"],
                      ["API token", "Paste the token you created in Atlassian"],
                      ["Webhook secret", "Optional. Use only if your Jira webhook is configured with one."],
                      ["Webhook URL", <code key="webhook-url">https://&lt;public-url&gt;/webhooks/jira-transition</code>],
                      ["Webhook event", "Use Issue updated, or the transition event if your Jira UI offers that directly."],
                      ["JQL filter", <code key="jql-filter">status CHANGED FROM &quot;To Do&quot; TO &quot;In Progress&quot;</code>],
                      ["Status fields", "Only change these if your Jira workflow uses different status names."]
                    ]}
                  />
                  <details className="guide-section codex-advanced">
                    <summary>Additional information</summary>
                    <div className="guide-stack">
                      <p className="muted">
                        Use these Jira docs if you need the full webhook setup flow, help creating API tokens, or more detail on webhook administration.
                      </p>
                      <ul className="plain-list guide-checklist">
                        <li>
                          <a href="https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/" target="_blank" rel="noreferrer">
                            Atlassian API token docs
                          </a>
                        </li>
                        <li>
                          <a href="https://support.atlassian.com/jira-cloud-administration/docs/manage-webhooks/" target="_blank" rel="noreferrer">
                            Jira Cloud webhook docs
                          </a>
                        </li>
                        <li>
                          <a href="https://support.atlassian.com/jira-software-cloud/docs/use-advanced-search-with-jira-query-language-jql/" target="_blank" rel="noreferrer">
                            JQL search and filter docs
                          </a>
                        </li>
                      </ul>
                      <ol className="plain-list ordered">
                        <li>Run <strong>Test Jira Connection</strong> first to confirm the base URL, email, and API token are correct.</li>
                        <li>Open <strong>Jira Settings → System → Webhooks</strong>. You may need Jira admin access for this page.</li>
                        <li>Create a webhook and set the URL to your public PRonto address plus <code>/webhooks/jira-transition</code>.</li>
                        <li>Select <strong>Issue updated</strong> as the trigger, or a transition-specific event if your Jira instance exposes one.</li>
                        <li>Add a JQL filter that matches the transition which should start PRonto, usually Ready to In Progress.</li>
                        <li>If you use a Jira webhook secret, paste the same secret into the <strong>Webhook secret</strong> field here.</li>
                      </ol>
                      <p className="muted">
                        If your workflow starts when a ticket moves from <strong>{config.READY_STATUS || "To Do"}</strong> to{" "}
                        <strong>{config.IN_PROGRESS_STATUS || "In Progress"}</strong>, a good starting filter is:
                      </p>
                      <pre className="inline-code-block">
{`project = ABC AND status CHANGED FROM "${config.READY_STATUS || "To Do"}" TO "${config.IN_PROGRESS_STATUS || "In Progress"}"`}
                      </pre>
                      <p className="muted">
                        After launch, move a test issue through that transition and watch the PRonto launch console to confirm the webhook is reaching the container.
                      </p>
                    </div>
                  </details>
                </>
              }
            >
              <Field label="Jira base URL" required value={config.JIRA_BASE_URL} onChange={(value) => updateField("JIRA_BASE_URL", value)} error={errors.JIRA_BASE_URL} placeholder="https://your-site.atlassian.net" />
              <Field label="Jira user email" required value={config.JIRA_USER_EMAIL} onChange={(value) => updateField("JIRA_USER_EMAIL", value)} error={errors.JIRA_USER_EMAIL} placeholder="name@example.com" />
              <Field label="Jira API token" required value={config.JIRA_API_TOKEN} onChange={(value) => updateField("JIRA_API_TOKEN", value)} error={errors.JIRA_API_TOKEN} secret />
              <Field label="Webhook secret" optional value={config.JIRA_WEBHOOK_SECRET} onChange={(value) => updateField("JIRA_WEBHOOK_SECRET", value)} error={errors.JIRA_WEBHOOK_SECRET} secret />
              <Field label="Ready status" required value={config.READY_STATUS} onChange={(value) => updateField("READY_STATUS", value)} error={errors.READY_STATUS} />
              <Field label="In progress status" required value={config.IN_PROGRESS_STATUS} onChange={(value) => updateField("IN_PROGRESS_STATUS", value)} error={errors.IN_PROGRESS_STATUS} />
              <Field label="In review status" required value={config.IN_REVIEW_STATUS} onChange={(value) => updateField("IN_REVIEW_STATUS", value)} error={errors.IN_REVIEW_STATUS} />
              <ConnectionTestPanel
                buttonClassName={`primary jira-check-button ${jiraCheck ? (jiraCheck.ok ? "is-pass" : "is-fail") : ""}`}
                buttonLabel={isCheckingJira ? "Testing Jira..." : "Test Jira Connection"}
                onClick={() => void runJiraCheck()}
                disabled={isCheckingJira}
                readyLabel="✓ Jira ready"
                resultTitle="Jira test result"
                result={jiraCheck}
                errorHelp={jiraErrorHelp}
              />
            </StepLayout>
          )}

          {currentStep.id === "github" && (
            <StepLayout
              title="Connect GitHub"
              description="Give PRonto the GitHub access it needs to clone repositories, push branches, and open pull requests automatically."
              asideContent={
                <>
                  <GuideChecklist title="Need these values" items={["GitHub personal access token", "Target base branch"]} />
                  <GuideLinkCard
                    title="Create GitHub token"
                    description="Use a token with repository contents read/write and pull request read/write access."
                    href="https://github.com/settings/tokens"
                    linkLabel="Open GitHub token settings"
                  />
                  <FieldGuide
                    items={[
                      ["GitHub token", "Your main token for clone, push, and PR creation"],
                      ["GH token alias", <>Optional. Use this only if you prefer the <code>GH_TOKEN</code> env var.</>],
                      ["Base branch", <>The branch new pull requests should target, usually <code>main</code>.</>]
                    ]}
                  />
                </>
              }
            >
              <Toggle label="Require GitHub authentication" required value={config.REQUIRE_GITHUB_AUTH} onChange={(value) => updateField("REQUIRE_GITHUB_AUTH", value)} error={errors.REQUIRE_GITHUB_AUTH} />
              <Field label="GitHub token" required value={config.GITHUB_TOKEN} onChange={(value) => updateField("GITHUB_TOKEN", value)} error={errors.GITHUB_TOKEN} secret />
              <Field label="GH token alias" optional value={config.GH_TOKEN} onChange={(value) => updateField("GH_TOKEN", value)} error={errors.GH_TOKEN} secret />
              <Field label="Base branch" required value={config.WORKFLOW_BASE_BRANCH} onChange={(value) => updateField("WORKFLOW_BASE_BRANCH", value)} error={errors.WORKFLOW_BASE_BRANCH} placeholder="main" />
              <ConnectionTestPanel
                buttonClassName={`primary github-check-button ${gitHubCheck ? (gitHubCheck.ok ? "is-pass" : "is-fail") : ""}`}
                buttonLabel={isCheckingGitHub ? "Testing GitHub..." : "Test GitHub Access"}
                onClick={() => void runGitHubCheck()}
                disabled={isCheckingGitHub}
                readyLabel="✓ GitHub ready"
                resultTitle="GitHub test result"
                result={gitHubCheck}
                errorHelp={gitHubErrorHelp}
              />
            </StepLayout>
          )}

          {currentStep.id === "integration" && (
            <StepLayout
              title="Choose AI Integration"
              description="Select which coding integration PRonto should run in automation, then configure that integration's authentication."
              asideContent={
                <>
                  <GuideChecklist
                    title="Integration options"
                    items={[
                      "Codex: device login or persisted login",
                      "Claude Code: device login or persisted login"
                    ]}
                  />
                  <FieldGuide
                    items={[
                      ["Integration", "Choose Codex or Claude Code for workflow implementation."],
                      ["Codex auth", "Device login (recommended) or persisted login session."],
                      ["Claude auth", "Device login (recommended) or persisted login session."]
                    ]}
                  />
                </>
              }
            >
              <label className="field">
                <span>
                  AI integration
                  <em className="field-required"> *</em>
                </span>
                <select value={selectedAiAgent} onChange={(event) => updateAiAgent(event.target.value)}>
                  <option value="codex">Codex</option>
                  <option value="claude">Claude Code</option>
                </select>
              </label>

              {selectedAiAgent === "codex" ? (
                <>
                  <label className="field">
                    <span>
                      Codex authentication method
                      <em className="field-required"> *</em>
                    </span>
                    <select value={codexAuthMode} onChange={(event) => updateCodexAuthMode(event.target.value)}>
                      <option value="device">Device login</option>
                      <option value="persisted">Use existing persisted login</option>
                    </select>
                  </label>
                  {codexAuthMode === "device" ? (
                    <div className="guide-section guide-link-card">
                      <h4>What happens next</h4>
                      <p className="muted">PRonto will trigger Codex device authentication when the container starts, so you can complete login interactively.</p>
                    </div>
                  ) : null}
                  {codexAuthMode === "persisted" ? (
                    <div className="guide-section guide-link-card">
                      <h4>What happens next</h4>
                      <p className="muted">PRonto will reuse the Codex session already stored in the shared container volume and skip bootstrap login.</p>
                    </div>
                  ) : null}
                  <details className="guide-section codex-advanced">
                    <summary>Advanced settings</summary>
                    <Field
                      label="Codex exec args"
                      optional
                      value={config.CODEX_EXEC_ARGS}
                      onChange={(value) => updateField("CODEX_EXEC_ARGS", value)}
                      error={errors.CODEX_EXEC_ARGS}
                    />
                  </details>
                </>
              ) : null}

              {selectedAiAgent === "claude" ? (
                <>
                  <label className="field">
                    <span>
                      Claude authentication method
                      <em className="field-required"> *</em>
                    </span>
                    <select value={claudeAuthMode} onChange={(event) => updateClaudeAuthMode(event.target.value)}>
                      <option value="device">Device login</option>
                      <option value="persisted">Use existing persisted login</option>
                    </select>
                  </label>
                  {claudeAuthMode === "device" ? (
                    <div className="guide-section guide-link-card">
                      <h4>What happens next</h4>
                      <p className="muted">PRonto will trigger Claude Code device authentication when the container starts, so you can complete login interactively.</p>
                    </div>
                  ) : null}
                  {claudeAuthMode === "persisted" ? (
                    <div className="guide-section guide-link-card">
                      <h4>What happens next</h4>
                      <p className="muted">PRonto will reuse the Claude Code session already stored in the shared container volume and skip bootstrap login.</p>
                    </div>
                  ) : null}
                  <details className="guide-section codex-advanced">
                    <summary>Advanced settings</summary>
                    <Field
                      label="Claude exec args"
                      optional
                      value={config.CLAUDE_EXEC_ARGS}
                      onChange={(value) => updateField("CLAUDE_EXEC_ARGS", value)}
                      error={errors.CLAUDE_EXEC_ARGS}
                    />
                  </details>
                </>
              ) : null}
              <ConnectionTestPanel
                buttonClassName={`primary github-check-button ${integrationCheck ? (integrationCheck.ok ? "is-pass" : "is-fail") : ""}`}
                buttonLabel={isCheckingIntegration ? `Testing ${integrationDisplayLabel}...` : `Test ${integrationDisplayLabel} Access`}
                onClick={() => void runIntegrationCheck()}
                disabled={isCheckingIntegration}
                readyLabel={`✓ ${integrationDisplayLabel} ready`}
                resultTitle="Integration test result"
                result={integrationCheck}
                errorHelp={integrationErrorHelp}
              />
            </StepLayout>
          )}

          {currentStep.id === "ngrok" && (
            <StepLayout
              title="Public Webhook Access"
              description="Enable this only if you want PRonto to expose the local webhook through ngrok."
              asideContent={
                <>
                  <GuideChecklist title="Optional capability" items={["Create an ngrok account", "Add your authtoken", "Optionally reserve a domain", "Use the generated URL in Jira"]} />
                  <GuideLinkCard
                    title="Open ngrok dashboard"
                    description="Use the ngrok dashboard to copy your authtoken, create an API key, and optionally reserve a static domain."
                    href="https://dashboard.ngrok.com/"
                    linkLabel="Open ngrok dashboard"
                  />
                  <FieldGuide
                    items={[
                      ["ngrok enable", "Turn this on only if you want PRonto to expose the local Jira webhook publicly."],
                      ["Authtoken", "Required when ngrok is enabled. Copy it from the Getting Started section of your ngrok dashboard."],
                      ["API key", "Needed only if you want PRonto to verify or auto-provision a reserved domain."],
                      ["Reserved domain", "Optional. Leave blank for an ephemeral URL, or enter your reserved ngrok domain if you want a stable webhook URL."],
                      ["Webhook path", <code>/webhooks/jira-transition</code>]
                    ]}
                  />
                  <details className="guide-section codex-advanced">
                    <summary>Additional information</summary>
                    <div className="guide-stack">
                      <p className="muted">
                        Use these docs if you need the full ngrok setup flow, help with reserved domains, or a refresher on where to find your credentials.
                      </p>
                      <ul className="plain-list guide-checklist">
                        <li>
                          <a href="https://ngrok.com/docs/getting-started/" target="_blank" rel="noreferrer">
                            ngrok getting started
                          </a>
                        </li>
                        <li>
                          <a href="https://ngrok.com/docs/universal-gateway/domains/" target="_blank" rel="noreferrer">
                            Reserved domains and static URLs
                          </a>
                        </li>
                        <li>
                          <a href="https://ngrok.com/docs/agent/" target="_blank" rel="noreferrer">
                            ngrok agent and authtoken docs
                          </a>
                        </li>
                        <li>
                          <a href="https://ngrok.com/docs/api/" target="_blank" rel="noreferrer">
                            ngrok API docs
                          </a>
                        </li>
                      </ul>
                      <ol className="plain-list ordered">
                        <li>Create or sign in to your ngrok account.</li>
                        <li>Copy your authtoken from the dashboard and paste it here.</li>
                        <li>If you want a stable webhook URL, reserve a domain and add both the domain and an ngrok API key here.</li>
                        <li>Run <strong>Test Public Access</strong> before launch.</li>
                        <li>After launch, use the ngrok URL plus <code>/webhooks/jira-transition</code> in Jira.</li>
                      </ol>
                      <p className="muted">
                        If you leave the reserved domain blank, PRonto will use an ephemeral ngrok URL. You can copy that live URL from the launch logs and then paste it into Jira.
                      </p>
                    </div>
                  </details>
                </>
              }
            >
              <Toggle label="Enable ngrok in container" optional value={config.NGROK_ENABLE} onChange={(value) => updateField("NGROK_ENABLE", value)} error={errors.NGROK_ENABLE} />
              <Field label="ngrok authtoken" optional value={config.NGROK_AUTHTOKEN} onChange={(value) => updateField("NGROK_AUTHTOKEN", value)} error={errors.NGROK_AUTHTOKEN} secret />
              <Field label="ngrok API key" optional value={config.NGROK_API_KEY} onChange={(value) => updateField("NGROK_API_KEY", value)} error={errors.NGROK_API_KEY} secret />
              <Field label="ngrok reserved domain" optional value={config.NGROK_DOMAIN} onChange={(value) => updateField("NGROK_DOMAIN", value)} error={errors.NGROK_DOMAIN} placeholder="your-domain.ngrok-free.app" />
              <ConnectionTestPanel
                buttonClassName={`primary github-check-button ${ngrokCheck ? (ngrokCheck.ok ? "is-pass" : "is-fail") : ""}`}
                buttonLabel={isCheckingNgrok ? "Testing ngrok..." : "Test Public Access"}
                onClick={() => void runNgrokCheck()}
                disabled={isCheckingNgrok}
                readyLabel="✓ ngrok ready"
                resultTitle="ngrok test result"
                result={ngrokCheck}
                errorHelp={ngrokErrorHelp}
              />
            </StepLayout>
          )}

          {currentStep.id === "review" && (
            <div className="two-column">
              <div className="step-main-card">
                <p className="eyebrow">Launch Review</p>
                <h3>Ready to launch PRonto.</h3>
                <dl className="review-list">
                  {reviewItems.map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="guide-card guide-card-compact">
                <h3>After launch</h3>
                <ol className="plain-list ordered">
                  <li>Create the Jira webhook pointing to <code>/webhooks/jira-transition</code>.</li>
                  <li>Use a JQL filter matching your Ready to In Progress transition.</li>
                  <li>Add <code>GitHub Repo: owner/repo</code> to the Jira ticket description.</li>
                  <li>Move a test ticket to In Progress and watch the PRonto console.</li>
                </ol>
              </div>
            </div>
          )}

          {currentStep.id === "run" && (
            <div className="run-grid">
              <div className="step-main-card terminal-side-panel">
                <p className="eyebrow">Launch PRonto</p>
                <h3>Bring the service online.</h3>
                <p className="muted">
                  Generate the environment config, build the image, replace the running container if needed, and check service health from one launch sequence.
                </p>
                <div className="action-row">
                  <button className={`primary hero-primary launch-button ${launchSucceeded ? "is-pass" : ""}`} onClick={() => void runSetup()} disabled={isBusy}>
                    {isBusy ? "Launching..." : "Launch PRonto"}
                  </button>
                  <button
                    className="secondary hero-secondary"
                    onClick={() => void stopSetup()}
                    disabled={isBusy}
                  >
                    Stop Service
                  </button>
                </div>
                <div className="activity-card launch-activity">
                  <h4>Launch sequence</h4>
                  <ul className="plain-list">
                    {activity.length === 0 ? <li>No actions yet.</li> : activity.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
                <div className="activity-card launch-activity">
                  <h4>Created pull requests</h4>
                  <ul className="plain-list pr-link-list">
                    {createdPullRequests.length === 0 ? (
                      <li>No pull requests detected yet.</li>
                    ) : (
                      createdPullRequests.map((url) => (
                        <li key={url}>
                          <a href={url} target="_blank" rel="noreferrer">
                            {url}
                          </a>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </div>
              <div className="guide-card terminal-side-panel">
                <div className="run-console-brand">
                  <img src={prontoRocket} alt="" className="run-console-mark brand-logo-inline" />
                  <h3>Console output</h3>
                </div>
                <pre>{status?.logs || "No logs yet."}</pre>
              </div>
            </div>
          )}
        </section>

        {stepIndex > 0 ? (
          <footer className="footer-nav">
            <button className="secondary" onClick={previousStep} disabled={isBusy || isNavigationLocked}>Back</button>
            {stepIndex < STEPS.length - 1 && !isNavigationLocked ? (
              <button
                className="primary hero-primary"
                onClick={() => void nextStep()}
                disabled={isBusy || (currentStepRequiresPassingTest && !currentStepHasPassingTest)}
              >
                Next
              </button>
            ) : null}
          </footer>
        ) : null}
      </main>
    </div>
  );
}

function SummaryStep(props: { number: string; title: string; text: string }) {
  return (
    <div className="summary-step">
      <strong>{props.number}</strong>
      <div>
        <h4>{props.title}</h4>
        <p>{props.text}</p>
      </div>
    </div>
  );
}

function extractPullRequestUrls(text: string): string[] {
  const matches = text.match(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/g) || [];
  return Array.from(new Set(matches));
}

function GuideChecklist(props: { title: string; items: string[] }) {
  return (
    <div className="guide-section">
      <h4>{props.title}</h4>
      <ul className="plain-list guide-checklist">
        {props.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function GuideLinkCard(props: { title: string; description: string; href: string; linkLabel: string }) {
  return (
    <div className="guide-section guide-link-card">
      <h4>{props.title}</h4>
      <p className="muted">{props.description}</p>
      <a href={props.href} target="_blank" rel="noreferrer">
        {props.linkLabel}
      </a>
    </div>
  );
}

function FieldGuide(props: { items: Array<[string, ReactNode]> }) {
  return (
    <div className="guide-section">
      <h4>Field guide</h4>
      <dl className="mini-guide-list">
        {props.items.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function StepLayout(props: {
  title: string;
  description: string;
  children: ReactNode;
  asideContent?: ReactNode;
  asideClassName?: string;
}) {
  return (
    <div className="two-column">
      <div className="step-main-card">
        <h3>{props.title}</h3>
        <p className="muted">{props.description}</p>
        <div className="form-grid">{props.children}</div>
      </div>
      <div className={props.asideClassName || "guide-card"}>{props.asideContent ? <div className="guide-extra">{props.asideContent}</div> : null}</div>
    </div>
  );
}

export default SetupWizardApp;
