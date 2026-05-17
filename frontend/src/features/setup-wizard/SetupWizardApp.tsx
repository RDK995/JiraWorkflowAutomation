import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import prontoGlowOverlay from "../../assets/pronto_design_kit/pronto-glow-overlay.png";
import prontoHeroBg from "../../assets/pronto_design_kit/pronto-hero-bg.png";
import prontoRocketLarge from "../../assets/pronto_design_kit/pronto-rocket-large.png";
import prontoRocket from "../../assets/pronto_design_kit/pronto-rocket.png";
import prontoStarsOverlay from "../../assets/pronto_design_kit/pronto-stars-overlay.png";
import { apiGet, apiPost, getApiBase } from "./api/setupApi";
import { WizardHero, WizardNavigation, WizardSidebar } from "./components/WizardChrome";
import { STEPS } from "./constants/steps";
import { getClaudeAuthMode, getCodexAuthMode, getIntegrationDisplayLabel } from "./domain/integrationAuth";
import { extractPullRequestUrls } from "./domain/pullRequests";
import { getConfiguredWebhookUrl } from "./domain/webhookUrl";
import { useConfigForm } from "./hooks/useConfigForm";
import { useDockerPreflight } from "./hooks/useDockerPreflight";
import { useProviderAuthSession } from "./hooks/useProviderAuthSession";
import { useReadinessChecks } from "./hooks/useReadinessChecks";
import { DockerStep } from "./steps/DockerStep";
import { GitHubStep } from "./steps/GitHubStep";
import { IntegrationStep } from "./steps/IntegrationStep";
import { JiraStep } from "./steps/JiraStep";
import { NgrokStep } from "./steps/NgrokStep";
import { ReviewStep } from "./steps/ReviewStep";
import { RunStep } from "./steps/RunStep";
import { WelcomeStep } from "./steps/WelcomeStep";
import { WebhookStep } from "./steps/WebhookStep";
import type { DockerRecoveryResponse, PrereqResponse, StatusResponse } from "./types/api";
import type { Config, ConfigField } from "./types/config";

function SetupWizardApp() {
  const apiBase = getApiBase();
  const consoleOutputRef = useRef<HTMLPreElement | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [checks, setChecks] = useState<PrereqResponse | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [activity, setActivity] = useState<string[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [hideJiraWebhookSection, setHideJiraWebhookSection] = useState(false);
  const [hideIntegrationLoginSection, setHideIntegrationLoginSection] = useState(false);
  const [isConsolePinnedToBottom, setIsConsolePinnedToBottom] = useState(true);
  const [observedPullRequests, setObservedPullRequests] = useState<string[]>([]);
  const [completedStepIndexes, setCompletedStepIndexes] = useState<number[]>([]);
  const [isNavigationLocked, setIsNavigationLocked] = useState(false);
  const [hasLaunchedThisSession, setHasLaunchedThisSession] = useState(false);
  const launchSucceeded = Boolean(status?.docker.container.running);
  const runStepIndex = STEPS.findIndex((step) => step.id === "run");
  const addActivity = (message: string) => {
    setActivity((current) => [...current, message]);
  };
  const readinessCallbacksRef = useRef({
    clearChecksForField: (_field: ConfigField): void => undefined,
    clearIntegrationCheck: (): void => undefined
  });
  const resetProviderAuthRef = useRef<() => void>(() => undefined);
  const {
    applyLoadedConfig,
    config,
    errors,
    saveConfig,
    updateAiAgent,
    updateClaudeAuthMode,
    updateCodexAuthMode,
    updateField,
    validate,
    validateStep
  } = useConfigForm({
    onActivity: addActivity,
    onFieldChanged: (field) => readinessCallbacksRef.current.clearChecksForField(field),
    onIntegrationChanged: () => readinessCallbacksRef.current.clearIntegrationCheck(),
    onProviderAuthReset: () => resetProviderAuthRef.current(),
    onShowIntegrationLogin: () => setHideIntegrationLoginSection(false)
  });
  const selectedAiAgent = config.AI_AGENT === "claude" ? "claude" : "codex";
  const {
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
  } = useDockerPreflight({
    currentStepId: STEPS[stepIndex].id,
    setStatus,
    status
  });
  const {
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
  } = useProviderAuthSession({
    config,
    currentStepId: STEPS[stepIndex].id,
    launchSucceeded,
    selectedAiAgent,
    setStatus,
    status,
    onShowIntegrationLogin: () => setHideIntegrationLoginSection(false)
  });
  resetProviderAuthRef.current = resetProviderAuth;
  const {
    clearChecksForField,
    clearIntegrationCheck,
    gitHubCheck,
    gitHubErrorHelp,
    integrationCheck,
    integrationErrorHelp,
    isCheckingGitHub,
    isCheckingIntegration,
    isCheckingJira,
    isCheckingJiraWebhook,
    isCheckingNgrok,
    jiraCheck,
    jiraErrorHelp,
    jiraWebhookCheck,
    jiraWebhookErrorHelp,
    ngrokCheck,
    ngrokErrorHelp,
    runGitHubCheck,
    runIntegrationCheck,
    runJiraCheck,
    runJiraWebhookCheck,
    runNgrokCheck
  } = useReadinessChecks({
    config,
    refreshStatus,
    selectedAiAgent,
    setHideJiraWebhookSection
  });
  readinessCallbacksRef.current = { clearChecksForField, clearIntegrationCheck };
  const integrationLoginConfirmed = Boolean(integrationContainerCheck?.ok);

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
        applyLoadedConfig(configResponse.config);
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

  useEffect(() => {
    if (STEPS[stepIndex].id !== "run" || !isConsolePinnedToBottom || !consoleOutputRef.current) {
      return;
    }

    const node = consoleOutputRef.current;
    node.scrollTop = node.scrollHeight;
  }, [isConsolePinnedToBottom, stepIndex, status?.logs]);

  useEffect(() => {
    if (!status) {
      return;
    }

    if (status.createdPullRequests?.length) {
      setObservedPullRequests((current) => Array.from(new Set([...current, ...status.createdPullRequests])));
    }

  }, [status]);

  async function refreshStatus() {
    const latestStatus = await apiGet<StatusResponse>("/api/status");
    setStatus(latestStatus);
    return latestStatus;
  }

  const currentStep = STEPS[stepIndex];

  const codexAuthMode = useMemo(() => getCodexAuthMode(config), [config]);
  const claudeAuthMode = useMemo(() => getClaudeAuthMode(config), [config]);
  const integrationDisplayLabel = getIntegrationDisplayLabel(selectedAiAgent);
  const isNgrokEnabled = config.NGROK_ENABLE === "true";

  const reviewItems = useMemo<Array<[string, ReactNode]>>(
    () => [
      ["Jira base URL", config.JIRA_BASE_URL || "Missing"],
      ["Jira user", config.JIRA_USER_EMAIL || "Missing"],
      ["GitHub token", config.GITHUB_TOKEN || config.GH_TOKEN ? "Configured" : "Missing"],
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
      ["ngrok", isNgrokEnabled ? "Enabled" : "Disabled"]
    ],
    [claudeAuthMode, codexAuthMode, config, integrationDisplayLabel, isNgrokEnabled, selectedAiAgent]
  );
  const configuredWebhookUrl = useMemo(() => getConfiguredWebhookUrl(isNgrokEnabled, config.NGROK_DOMAIN), [config.NGROK_DOMAIN, isNgrokEnabled]);

  useEffect(() => {
    if (launchSucceeded && hasLaunchedThisSession) {
      setIsNavigationLocked(true);
      setStepIndex(runStepIndex);
      return;
    }

    setIsNavigationLocked(false);
  }, [launchSucceeded, hasLaunchedThisSession, runStepIndex]);

  const runSetup = async () => {
    if (!launchReadyForReview) {
      setActivity((current) => [...current, "Launch is blocked until all required setup checks pass."]);
      return;
    }

    setIsBusy(true);
    setActivity([]);
    setHideIntegrationLoginSection(false);

    try {
      const saved = await saveConfig();
      if (!saved) {
        return;
      }

      if (!status?.docker.imageExists) {
        setActivity((current) => [...current, "Building the PRonto automation image."]);
        const buildResult = await apiPost<DockerRecoveryResponse>("/api/docker/build", {});
        if (!buildResult.ok) {
          setActivity((current) => [...current, `Launch failed: ${buildResult.diagnosis?.message || buildResult.output || "Docker image build failed."}`]);
          return;
        }
      }

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
      resetProviderAuth();
      setHideIntegrationLoginSection(false);
      setActivity((current) => [...current, "Container stopped"]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setActivity((current) => [...current, `Stop failed: ${message}`]);
    }
  };

  const dockerDiagnosis = dockerCheck?.diagnosis;
  const requiresGitHubAuth = config.REQUIRE_GITHUB_AUTH === "true";
  const stepTestPassed = {
    docker: Boolean(dockerCheck?.ok) && dockerImageReady,
    jira: Boolean(jiraCheck?.ok),
    github: !requiresGitHubAuth || Boolean(gitHubCheck?.ok),
    integration: Boolean(integrationCheck?.ok),
    ngrok: Boolean(ngrokCheck?.ok)
  } as const;
  const launchBlockers = useMemo(() => {
    const blockers = [];
    if (!stepTestPassed.docker) {
      blockers.push(dockerCheck?.ok ? "Build the PRonto Docker image successfully." : "Run the System Check successfully.");
    }
    if (!stepTestPassed.jira) {
      blockers.push("Test the Jira connection successfully.");
    }
    if (!stepTestPassed.github) {
      blockers.push(requiresGitHubAuth ? "Test GitHub access successfully." : "Complete the GitHub setup requirements.");
    }
    if (!stepTestPassed.integration) {
      blockers.push("Test the AI integration successfully.");
    }
    if (!stepTestPassed.ngrok) {
      blockers.push("Test Public Access successfully.");
    }
    return blockers;
  }, [requiresGitHubAuth, stepTestPassed.docker, stepTestPassed.github, stepTestPassed.integration, stepTestPassed.jira, stepTestPassed.ngrok]);
  const launchReadyForReview = launchBlockers.length === 0;
  const currentStepRequiresPassingTest = ["docker", "jira", "github", "integration", "ngrok"].includes(currentStep.id);
  const currentStepHasPassingTest = currentStep.id in stepTestPassed
    ? stepTestPassed[currentStep.id as keyof typeof stepTestPassed]
    : true;
  const createdPullRequests = observedPullRequests;
  const showIntegrationLoginPanel = (Boolean(deviceLogin) || launchSucceeded) && !hideIntegrationLoginSection;

  const handleConsoleScroll = () => {
    const node = consoleOutputRef.current;
    if (!node) {
      return;
    }

    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    setIsConsolePinnedToBottom(distanceFromBottom < 24);
  };

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
      if (!launchReadyForReview) {
        setActivity((current) => [...current, "Finish the remaining setup checks before opening the Launch Console."]);
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
      <WizardSidebar
        completedStepIndexes={completedStepIndexes}
        currentStepIndex={stepIndex}
        isNavigationLocked={isNavigationLocked}
        onStepClick={goToStep}
        prontoRocket={prontoRocket}
      />

      <main className="content">
        {currentStep.id !== "welcome" ? (
          <WizardHero checks={checks} status={status} title={currentStep.title} />
        ) : null}

        <section className="panel content-stage">
          {currentStep.id === "welcome" && (
            <WelcomeStep
              onGetStarted={() => {
                setCompletedStepIndexes((current) => (current.includes(0) ? current : [...current, 0]));
                setStepIndex(1);
              }}
              prontoGlowOverlay={prontoGlowOverlay}
              prontoHeroBg={prontoHeroBg}
              prontoRocket={prontoRocket}
              prontoRocketLarge={prontoRocketLarge}
              prontoStarsOverlay={prontoStarsOverlay}
            />
          )}

          {currentStep.id === "docker" && (
            <DockerStep
              apiBase={apiBase}
              canOpenDockerDesktop={dockerGuidance.canOpenDockerDesktop}
              canStartColima={dockerGuidance.canStartColima}
              colimaInstallLink={dockerGuidance.colimaInstallLink}
              dockerBuildCheck={dockerBuildCheck}
              dockerBuildElapsedLabel={dockerBuildElapsedLabel}
              dockerBuildProgressLabel={dockerBuildProgressLabel}
              dockerCheck={dockerCheck}
              dockerContexts={dockerContexts}
              dockerDiagnosis={dockerDiagnosis}
              dockerErrorHelp={dockerGuidance.dockerErrorHelp}
              dockerImageReady={dockerImageReady}
              dockerInstallLabel={dockerGuidance.dockerInstallLabel}
              dockerInstallLink={dockerGuidance.dockerInstallLink}
              dockerNetworkCheck={dockerNetworkCheck}
              dockerPlatform={dockerGuidance.dockerPlatform}
              dockerPlatformHelp={dockerGuidance.dockerPlatformHelp}
              dockerRecoveryMessage={dockerRecoveryMessage}
              isCheckingDocker={isCheckingDocker}
              isCheckingDockerBuild={isCheckingDockerBuild}
              isCheckingDockerNetwork={isCheckingDockerNetwork}
              isCheckingSetupApi={isCheckingSetupApi}
              isLoadingDockerContexts={isLoadingDockerContexts}
              isOpeningDockerDesktop={isOpeningDockerDesktop}
              isPollingDockerRecovery={isPollingDockerRecovery}
              isResettingDockerBuilderCache={isResettingDockerBuilderCache}
              isStartingColima={isStartingColima}
              isSwitchingDockerContext={isSwitchingDockerContext}
              selectedDockerContext={selectedDockerContext}
              setupApiActionLabel={setupApiActionLabel}
              setupApiError={setupApiError}
              setupApiReachable={setupApiReachable}
              shouldOfferColimaInstall={dockerGuidance.shouldOfferColimaInstall}
              shouldOfferContextSwitch={dockerGuidance.shouldOfferContextSwitch}
              shouldOfferDockerBuildRecovery={shouldOfferDockerBuildRecovery}
              status={status}
              onCheckSetupApiReachability={() => void checkSetupApiReachability()}
              onLoadDockerContexts={() => void loadDockerContexts()}
              onOpenDockerDesktop={() => void openDockerDesktopFromUi()}
              onResetDockerBuilder={() => void resetDockerBuilderFromUi()}
              onRunDockerBuildCheck={() => void runDockerBuildCheck()}
              onRunDockerCheck={() => void runDockerCheck()}
              onRunDockerNetworkDiagnostics={() => void runDockerNetworkDiagnostics()}
              onSelectedDockerContextChange={setSelectedDockerContext}
              onStartColima={() => void startColimaFromUi()}
              onStartSetupApi={() => void handleStartSetupApi()}
              onSwitchDockerContext={() => void switchDockerContextFromUi()}
            />
          )}

          {currentStep.id === "jira" && (
            <JiraStep
              config={config}
              errors={errors}
              isCheckingJira={isCheckingJira}
              jiraCheck={jiraCheck}
              jiraErrorHelp={jiraErrorHelp}
              onRunJiraCheck={() => void runJiraCheck()}
              updateField={updateField}
            />
          )}

          {currentStep.id === "github" && (
            <GitHubStep
              config={config}
              errors={errors}
              gitHubCheck={gitHubCheck}
              gitHubErrorHelp={gitHubErrorHelp}
              isCheckingGitHub={isCheckingGitHub}
              onRunGitHubCheck={() => void runGitHubCheck()}
              updateField={updateField}
            />
          )}

          {currentStep.id === "integration" && (
            <IntegrationStep
              claudeAuthMode={claudeAuthMode}
              codexAuthMode={codexAuthMode}
              config={config}
              errors={errors}
              integrationCheck={integrationCheck}
              integrationDisplayLabel={integrationDisplayLabel}
              integrationErrorHelp={integrationErrorHelp}
              isCheckingIntegration={isCheckingIntegration}
              selectedAiAgent={selectedAiAgent}
              onRunIntegrationCheck={() => void runIntegrationCheck()}
              updateAiAgent={updateAiAgent}
              updateClaudeAuthMode={updateClaudeAuthMode}
              updateCodexAuthMode={updateCodexAuthMode}
              updateField={updateField}
            />
          )}

          {currentStep.id === "ngrok" && (
            <NgrokStep
              config={config}
              errors={errors}
              isCheckingNgrok={isCheckingNgrok}
              ngrokCheck={ngrokCheck}
              ngrokErrorHelp={ngrokErrorHelp}
              onRunNgrokCheck={() => void runNgrokCheck()}
              updateField={updateField}
            />
          )}

          {currentStep.id === "review" && (
            <ReviewStep
              launchBlockers={launchBlockers}
              launchReadyForReview={launchReadyForReview}
              reviewItems={reviewItems}
            />
          )}

          {currentStep.id === "webhook" && (
            <WebhookStep
              configuredWebhookUrl={configuredWebhookUrl}
              inProgressStatus={config.IN_PROGRESS_STATUS}
              isNgrokEnabled={isNgrokEnabled}
              jiraBaseUrl={config.JIRA_BASE_URL}
              readyStatus={config.READY_STATUS}
            />
          )}

          {currentStep.id === "run" && (
            <RunStep
              activity={activity}
              authCodeInput={authCodeInput}
              authCodeSubmissionResult={authCodeSubmissionResult}
              authPreflight={authPreflight}
              authSession={authSession}
              authSessionStatusMessage={authSessionStatusMessage}
              claudeCodeSubmissionRequired={claudeCodeSubmissionRequired}
              claudeLoginPendingLabel={claudeLoginPendingLabel}
              consoleOutputRef={consoleOutputRef}
              copiedDeviceCode={copiedDeviceCode}
              createdPullRequests={createdPullRequests}
              deviceLogin={deviceLogin}
              hasSubmittedClaudeAuthCode={hasSubmittedClaudeAuthCode}
              hideJiraWebhookSection={hideJiraWebhookSection}
              integrationContainerCheck={integrationContainerCheck}
              integrationLoginConfirmed={integrationLoginConfirmed}
              isBusy={isBusy}
              isCheckingAuthPreflight={isCheckingAuthPreflight}
              isCheckingIntegrationContainer={isCheckingIntegrationContainer}
              isCheckingJiraWebhook={isCheckingJiraWebhook}
              isSubmittingAuthCode={isSubmittingAuthCode}
              isVerifyingAuthSession={isVerifyingAuthSession}
              jiraWebhookCheck={jiraWebhookCheck}
              jiraWebhookErrorHelp={jiraWebhookErrorHelp}
              launchIntegrationLabel={launchIntegrationLabel}
              launchReadyForReview={launchReadyForReview}
              launchSucceeded={launchSucceeded}
              prontoRocket={prontoRocket}
              selectedAiAgent={selectedAiAgent}
              showIntegrationLoginPanel={showIntegrationLoginPanel}
              status={status}
              onAuthCodeInputChange={setAuthCodeInput}
              onConsoleScroll={handleConsoleScroll}
              onCopyDeviceCode={() => void copyDeviceCode()}
              onDismissIntegrationLogin={() => setHideIntegrationLoginSection(true)}
              onDismissJiraWebhook={() => setHideJiraWebhookSection(true)}
              onRunIntegrationContainerCheck={() => void runIntegrationContainerCheck()}
              onRunJiraWebhookCheck={() => void runJiraWebhookCheck()}
              onRunSetup={() => void runSetup()}
              onStopSetup={() => void stopSetup()}
              onSubmitProviderAuthCode={() => void submitProviderAuthCode()}
            />
          )}
        </section>

        {stepIndex > 0 ? (
          <WizardNavigation
            canGoNext={!isBusy && !(currentStepRequiresPassingTest && !currentStepHasPassingTest) && !(currentStep.id === "review" && !launchReadyForReview)}
            canGoPrevious={!isBusy && !isNavigationLocked}
            showNext={stepIndex < STEPS.length - 1 && !isNavigationLocked}
            onNext={() => void nextStep()}
            onPrevious={previousStep}
          />
        ) : null}
      </main>
    </div>
  );
}

export default SetupWizardApp;
