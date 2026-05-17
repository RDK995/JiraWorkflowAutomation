import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { getAuthBrokerHealth, getAuthSessionStatus, runAuthPreflight, startAuthSession, submitAuthCode } from "../api/authBroker";
import { apiGet, apiPost } from "../api/setupApi";
import { extractDeviceLogin } from "../domain/deviceLogin";
import type { AuthBrokerHealthResponse, AuthPreflightResponse, AuthProvider, AuthSessionResponse, ReadinessCheckResponse, StatusResponse } from "../types/api";
import type { Config } from "../types/config";

type UseProviderAuthSessionOptions = {
  config: Config;
  currentStepId: string;
  launchSucceeded: boolean;
  selectedAiAgent: AuthProvider;
  setStatus: Dispatch<SetStateAction<StatusResponse | null>>;
  status: StatusResponse | null;
  onShowIntegrationLogin: () => void;
};

export function useProviderAuthSession(options: UseProviderAuthSessionOptions) {
  const {
    config,
    currentStepId,
    launchSucceeded,
    selectedAiAgent,
    setStatus,
    status,
    onShowIntegrationLogin
  } = options;
  const [authBrokerHealth, setAuthBrokerHealth] = useState<AuthBrokerHealthResponse | null>(null);
  const [authPreflight, setAuthPreflight] = useState<AuthPreflightResponse | null>(null);
  const [authSession, setAuthSession] = useState<AuthSessionResponse | null>(null);
  const [authCodeSubmissionResult, setAuthCodeSubmissionResult] = useState<AuthSessionResponse | null>(null);
  const [integrationContainerCheck, setIntegrationContainerCheck] = useState<ReadinessCheckResponse | null>(null);
  const [isCheckingAuthPreflight, setIsCheckingAuthPreflight] = useState(false);
  const [isCheckingIntegrationContainer, setIsCheckingIntegrationContainer] = useState(false);
  const [isSubmittingAuthCode, setIsSubmittingAuthCode] = useState(false);
  const [isVerifyingAuthSession] = useState(false);
  const [hasSubmittedClaudeAuthCode, setHasSubmittedClaudeAuthCode] = useState(false);
  const [copiedDeviceCode, setCopiedDeviceCode] = useState(false);
  const [authCodeInput, setAuthCodeInput] = useState("");
  const [observedDeviceLogin, setObservedDeviceLogin] = useState<ReturnType<typeof extractDeviceLogin>>(null);
  const integrationLoginConfirmed = Boolean(integrationContainerCheck?.ok);

  const refreshStatus = async () => {
    const latestStatus = await apiGet<StatusResponse>("/api/status");
    setStatus(latestStatus);
    return latestStatus;
  };

  const resetProviderAuth = () => {
    setAuthPreflight(null);
    setAuthSession(null);
    setAuthCodeSubmissionResult(null);
    setAuthCodeInput("");
    setIntegrationContainerCheck(null);
    setObservedDeviceLogin(null);
    setHasSubmittedClaudeAuthCode(false);
  };

  const runIntegrationContainerCheck = async () => {
    setIsCheckingIntegrationContainer(true);
    onShowIntegrationLogin();
    try {
      setIntegrationContainerCheck(await apiPost<ReadinessCheckResponse>("/api/checks/integration-container-auth", { config }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setIntegrationContainerCheck({
        ok: false,
        checks: [{ command: `${selectedAiAgent} login`, ok: false, output: message }]
      });
    } finally {
      setIsCheckingIntegrationContainer(false);
    }
  };

  const submitProviderAuthCode = async () => {
    if (!authSession?.session?.id) {
      return;
    }

    setIsSubmittingAuthCode(true);
    try {
      const result = await submitAuthCode(authSession.session.id, authCodeInput);
      setAuthCodeSubmissionResult(result);
      setAuthSession(result);
      if (selectedAiAgent === "claude" && result.ok) {
        setHasSubmittedClaudeAuthCode(true);
      }

      await refreshStatus().catch(() => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setAuthCodeSubmissionResult({
        ok: false,
        session: authSession.session,
        error: {
          code: "auth_code_submission_failed",
          message,
          remediation: "Retry the provider auth code submission from the wizard."
        }
      });
    } finally {
      setIsSubmittingAuthCode(false);
    }
  };

  useEffect(() => {
    if (!status) {
      return;
    }

    setObservedDeviceLogin(extractDeviceLogin(status.logs || "", selectedAiAgent));
  }, [selectedAiAgent, status]);

  useEffect(() => {
    let cancelled = false;

    const loadBrokerHealth = async () => {
      try {
        const health = await getAuthBrokerHealth();
        if (!cancelled) {
          setAuthBrokerHealth(health);
        }
      } catch {
        if (!cancelled) {
          setAuthBrokerHealth(null);
        }
      }
    };

    void loadBrokerHealth();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (currentStepId !== "run" || !launchSucceeded || integrationLoginConfirmed) {
      return;
    }

    let cancelled = false;

    const runPreflightAndStart = async () => {
      setIsCheckingAuthPreflight(true);
      try {
        const preflight = await runAuthPreflight(selectedAiAgent, { config });
        if (cancelled) {
          return;
        }
        setAuthPreflight(preflight);

        const shouldStartSession = preflight.ok || selectedAiAgent === "codex";
        if (!shouldStartSession) {
          return;
        }

        const started = await startAuthSession(selectedAiAgent, { config });
        if (cancelled) {
          return;
        }
        setAuthSession(started);
        onShowIntegrationLogin();
        if (started.session?.state === "authenticated") {
          await runIntegrationContainerCheck();
        }
      } catch {
        if (!cancelled) {
          setAuthPreflight(null);
          setAuthSession(null);
        }
      } finally {
        if (!cancelled) {
          setIsCheckingAuthPreflight(false);
        }
      }
    };

    const pollSession = async () => {
      if (!authSession?.session?.id) {
        return;
      }
      try {
        const latest = await getAuthSessionStatus(authSession.session.id);
        if (cancelled) {
          return;
        }
        setAuthSession(latest);
        if (latest.session?.state === "authenticated") {
          await runIntegrationContainerCheck();
        }
      } catch {
        if (!cancelled) {
          setAuthSession(null);
        }
      }
    };

    if (!authSession?.session?.id || authSession.session.provider !== selectedAiAgent) {
      void runPreflightAndStart();
      return () => {
        cancelled = true;
      };
    }

    const interval = window.setInterval(() => {
      void pollSession();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [authSession?.session?.id, authSession?.session?.provider, config, currentStepId, integrationLoginConfirmed, launchSucceeded, selectedAiAgent]);

  useEffect(() => {
    setHasSubmittedClaudeAuthCode(false);
  }, [selectedAiAgent, authSession?.session?.id]);

  const brokerManagedDeviceLogin = authSession?.session?.browserUrl
    ? {
        url: authSession.session.browserUrl,
        code: authSession.session.code,
        expiryText: authSession.session.state === "waiting_for_browser" ? "This sign-in page expires shortly." : ""
      }
    : null;
  const deviceLogin = selectedAiAgent === "claude" && authSession
    ? brokerManagedDeviceLogin
    : (brokerManagedDeviceLogin || observedDeviceLogin);
  const authSessionStatusMessage = authSession?.error?.message
    || authSession?.session?.error?.message
    || authPreflight?.checks?.find((check) => check.severity !== "pass")?.summary
    || (authBrokerHealth ? "" : "Auth broker is not reachable yet. Start the local auth broker service before trying provider login.")
    || "";
  const launchIntegrationLabel = selectedAiAgent === "claude" ? "Claude Code" : "Codex";
  const claudeCodeSubmissionRequired = selectedAiAgent === "claude" && Boolean(authSession?.session?.requiresCode);
  const claudeLoginPendingLabel = selectedAiAgent === "claude" && (hasSubmittedClaudeAuthCode || !claudeCodeSubmissionRequired)
    ? (isCheckingIntegrationContainer ? "Claude Code login is being confirmed..." : "Claude Code is logging in...")
    : "";

  const copyDeviceCode = async () => {
    if (!deviceLogin?.code) {
      return;
    }

    try {
      await navigator.clipboard.writeText(deviceLogin.code);
      setCopiedDeviceCode(true);
      window.setTimeout(() => setCopiedDeviceCode(false), 2500);
    } catch {
      setCopiedDeviceCode(false);
    }
  };

  return {
    authCodeInput,
    authCodeSubmissionResult,
    authPreflight,
    authSession,
    authSessionStatusMessage,
    claudeCodeSubmissionRequired,
    claudeLoginPendingLabel,
    copiedDeviceCode,
    copyDeviceCode,
    deviceLogin,
    hasSubmittedClaudeAuthCode,
    integrationContainerCheck,
    isCheckingAuthPreflight,
    isCheckingIntegrationContainer,
    isSubmittingAuthCode,
    isVerifyingAuthSession,
    launchIntegrationLabel,
    resetProviderAuth,
    runIntegrationContainerCheck,
    setAuthCodeInput,
    submitProviderAuthCode
  };
}
