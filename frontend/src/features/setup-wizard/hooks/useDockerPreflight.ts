import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { apiGet, apiPost } from "../api/setupApi";
import { getAuthBrokerHealth } from "../api/authBroker";
import { getDockerBuildElapsedLabel, getDockerBuildProgressLabel, getDockerGuidance } from "../domain/dockerGuidance";
import type { DockerContextResponse, DockerNetworkCheckResponse, DockerRecoveryResponse, ReadinessCheckResponse, StatusResponse } from "../types/api";

type UseDockerPreflightOptions = {
  currentStepId: string;
  setStatus: Dispatch<SetStateAction<StatusResponse | null>>;
  status: StatusResponse | null;
};

export function useDockerPreflight(options: UseDockerPreflightOptions) {
  const { currentStepId, setStatus, status } = options;
  const [dockerCheck, setDockerCheck] = useState<ReadinessCheckResponse | null>(null);
  const [dockerBuildCheck, setDockerBuildCheck] = useState<DockerRecoveryResponse | null>(null);
  const [dockerNetworkCheck, setDockerNetworkCheck] = useState<DockerNetworkCheckResponse | null>(null);
  const [isCheckingDocker, setIsCheckingDocker] = useState(false);
  const [isCheckingDockerBuild, setIsCheckingDockerBuild] = useState(false);
  const [isCheckingDockerNetwork, setIsCheckingDockerNetwork] = useState(false);
  const [isResettingDockerBuilderCache, setIsResettingDockerBuilderCache] = useState(false);
  const [isCheckingSetupApi, setIsCheckingSetupApi] = useState(false);
  const [isStartingColima, setIsStartingColima] = useState(false);
  const [isOpeningDockerDesktop, setIsOpeningDockerDesktop] = useState(false);
  const [isPollingDockerRecovery, setIsPollingDockerRecovery] = useState(false);
  const [isLoadingDockerContexts, setIsLoadingDockerContexts] = useState(false);
  const [isSwitchingDockerContext, setIsSwitchingDockerContext] = useState(false);
  const [setupApiReachable, setSetupApiReachable] = useState<boolean | null>(null);
  const [setupApiError, setSetupApiError] = useState("");
  const [setupApiActionLabel, setSetupApiActionLabel] = useState("Start Local Services");
  const [dockerRecoveryMessage, setDockerRecoveryMessage] = useState("");
  const [dockerBuildStartedAt, setDockerBuildStartedAt] = useState<number | null>(null);
  const [dockerBuildElapsedMs, setDockerBuildElapsedMs] = useState(0);
  const [dockerContexts, setDockerContexts] = useState<DockerContextResponse["contexts"]>([]);
  const [selectedDockerContext, setSelectedDockerContext] = useState("");

  const refreshStatus = async () => {
    const latestStatus = await apiGet<StatusResponse>("/api/status");
    setStatus(latestStatus);
    return latestStatus;
  };

  const checkSetupApiReachability = async (): Promise<boolean> => {
    setIsCheckingSetupApi(true);
    setSetupApiError("");
    try {
      await Promise.all([
        apiGet<StatusResponse>("/api/status"),
        getAuthBrokerHealth()
      ]);
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

  const runDockerBuildCheck = async () => {
    setIsCheckingDockerBuild(true);
    setDockerBuildStartedAt(Date.now());
    setDockerRecoveryMessage("");
    setDockerNetworkCheck(null);
    try {
      const result = await apiPost<DockerRecoveryResponse>("/api/docker/build", {});
      setDockerBuildCheck(result);
      await refreshStatus().catch(() => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setDockerBuildCheck({
        ok: false,
        output: message,
        diagnosis: {
          code: "docker_build_failed",
          title: "Docker image build failed",
          message
        }
      });
    } finally {
      setIsCheckingDockerBuild(false);
      setDockerBuildStartedAt(null);
    }
  };

  const runDockerNetworkDiagnostics = async () => {
    setIsCheckingDockerNetwork(true);
    try {
      setDockerNetworkCheck(await apiPost<DockerNetworkCheckResponse>("/api/docker/network-check", {}));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setDockerNetworkCheck({
        ok: false,
        checks: [{ command: "docker network diagnostics", ok: false, output: message }],
        diagnosis: {
          code: "docker_network_check_failed",
          title: "Docker network diagnostics failed",
          message
        }
      });
    } finally {
      setIsCheckingDockerNetwork(false);
    }
  };

  const resetDockerBuilderFromUi = async () => {
    setIsResettingDockerBuilderCache(true);
    setDockerRecoveryMessage("");
    try {
      const result = await apiPost<DockerRecoveryResponse>("/api/docker/reset-builder-cache", {});
      setDockerRecoveryMessage(result.output || "Docker builder cache was cleared.");
      if (!result.ok) {
        setDockerCheck((current) => current ?? {
          ok: false,
          checks: [{ command: "docker builder prune", ok: false, output: "" }],
          diagnosis: result.diagnosis
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setDockerRecoveryMessage(`Could not reset the Docker builder cache: ${message}`);
    } finally {
      setIsResettingDockerBuilderCache(false);
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
          await refreshStatus().catch(() => undefined);
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
      const result = await apiPost<DockerRecoveryResponse>("/api/docker/start-colima", {});
      if (!result.ok) {
        setDockerRecoveryMessage(result.diagnosis?.message || result.output || "Colima failed to start.");
        setDockerCheck({
          ok: false,
          checks: [{ command: "colima start", ok: false, output: "" }],
          diagnosis: result.diagnosis
        });
        return;
      }
      setDockerRecoveryMessage(result.output || "Colima started. Waiting for Docker to become ready...");
      setIsStartingColima(false);
      await pollDockerRecovery("Colima started and Docker is now ready.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setDockerRecoveryMessage(`Could not start Colima: ${message}`);
    } finally {
      setIsStartingColima(false);
    }
  };

  const openDockerDesktopFromUi = async () => {
    setIsOpeningDockerDesktop(true);
    setDockerRecoveryMessage("");
    try {
      const result = await apiPost<DockerRecoveryResponse>("/api/docker/open-docker-desktop", {});
      setDockerRecoveryMessage(result.output || "Docker Desktop launched. Waiting for Docker to become ready...");
      if (!result.ok) {
        setDockerCheck({
          ok: false,
          checks: [{ command: "open Docker Desktop", ok: false, output: "" }],
          diagnosis: result.diagnosis
        });
        return;
      }
      await pollDockerRecovery("Docker Desktop finished starting and Docker is now ready.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setDockerRecoveryMessage(`Could not open Docker Desktop: ${message}`);
    } finally {
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

  const handleStartSetupApi = async () => {
    const command = "npm run dev:setup-api && npm run dev:auth-broker";
    try {
      setSetupApiActionLabel("Starting...");
      const response = await fetch("/__local/start-setup-api", { method: "POST" });
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

      setSetupApiActionLabel("Starting local services...");
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 700));
        const reachable = await checkSetupApiReachability();
        if (reachable) {
          setSetupApiActionLabel("Local services running");
          window.setTimeout(() => setSetupApiActionLabel("Start Local Services"), 1800);
          return;
        }
      }

      setSetupApiActionLabel("Could not start");
      window.setTimeout(() => setSetupApiActionLabel("Start Local Services"), 1800);
    } catch {
      try {
        await navigator.clipboard.writeText(command);
        setSetupApiActionLabel("Command copied");
      } catch {
        setSetupApiActionLabel(command);
      }
      window.setTimeout(() => setSetupApiActionLabel("Start Local Services"), 2200);
    }
  };

  useEffect(() => {
    if (!isCheckingDockerBuild || !dockerBuildStartedAt) {
      setDockerBuildElapsedMs(0);
      return;
    }

    setDockerBuildElapsedMs(Date.now() - dockerBuildStartedAt);
    const interval = window.setInterval(() => {
      setDockerBuildElapsedMs(Date.now() - dockerBuildStartedAt);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [dockerBuildStartedAt, isCheckingDockerBuild]);

  useEffect(() => {
    if (currentStepId !== "docker") {
      return;
    }

    void checkSetupApiReachability();
  }, [currentStepId]);

  useEffect(() => {
    if (currentStepId !== "docker" || !dockerCheck || dockerCheck.ok) {
      return;
    }

    if (dockerCheck.diagnosis?.code === "docker_not_installed") {
      return;
    }

    if (dockerContexts.length > 0) {
      return;
    }

    void loadDockerContexts();
  }, [currentStepId, dockerCheck, dockerContexts.length]);

  const dockerGuidance = useMemo(() => getDockerGuidance(dockerCheck), [dockerCheck]);
  const dockerBuildElapsedLabel = useMemo(() => getDockerBuildElapsedLabel(dockerBuildElapsedMs), [dockerBuildElapsedMs]);
  const dockerBuildProgressLabel = useMemo(() => getDockerBuildProgressLabel(dockerBuildElapsedMs), [dockerBuildElapsedMs]);
  const dockerImageReady = Boolean(status?.docker.imageExists) || Boolean(dockerBuildCheck?.ok);
  const shouldOfferDockerBuildRecovery =
    dockerBuildCheck?.ok === false &&
    (dockerBuildCheck.diagnosis?.code === "docker_build_dependency_error" || dockerBuildCheck.diagnosis?.code === "docker_build_failed");

  return {
    checkSetupApiReachability,
    dockerBuildCheck,
    dockerBuildElapsedLabel,
    dockerBuildProgressLabel,
    dockerCheck,
    dockerContexts,
    dockerGuidance,
    dockerImageReady,
    dockerNetworkCheck,
    dockerRecoveryMessage,
    handleStartSetupApi,
    isCheckingDocker,
    isCheckingDockerBuild,
    isCheckingDockerNetwork,
    isCheckingSetupApi,
    isLoadingDockerContexts,
    isOpeningDockerDesktop,
    isPollingDockerRecovery,
    isResettingDockerBuilderCache,
    isStartingColima,
    isSwitchingDockerContext,
    loadDockerContexts,
    openDockerDesktopFromUi,
    resetDockerBuilderFromUi,
    runDockerBuildCheck,
    runDockerCheck,
    runDockerNetworkDiagnostics,
    selectedDockerContext,
    setSelectedDockerContext,
    setupApiActionLabel,
    setupApiError,
    setupApiReachable,
    shouldOfferDockerBuildRecovery,
    startColimaFromUi,
    switchDockerContextFromUi
  };
}
