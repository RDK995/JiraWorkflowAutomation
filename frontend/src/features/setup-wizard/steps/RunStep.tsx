import type { Ref } from "react";
import { ConnectionTestPanel } from "../../../components/ui/ConnectionTestPanel";
import { LaunchIntegrationLoginPanel } from "../components/LaunchIntegrationLoginPanel";
import type { DeviceLoginPrompt } from "../domain/deviceLogin";
import type { AuthPreflightResponse, AuthProvider, AuthSessionResponse, ReadinessCheckResponse, StatusResponse } from "../types/api";

type RunStepProps = {
  activity: string[];
  authCodeInput: string;
  authCodeSubmissionResult: AuthSessionResponse | null;
  authPreflight: AuthPreflightResponse | null;
  authSession: AuthSessionResponse | null;
  authSessionStatusMessage: string;
  claudeCodeSubmissionRequired: boolean;
  claudeLoginPendingLabel: string;
  consoleOutputRef: Ref<HTMLPreElement>;
  copiedDeviceCode: boolean;
  createdPullRequests: string[];
  deviceLogin: DeviceLoginPrompt | null;
  hasSubmittedClaudeAuthCode: boolean;
  hideJiraWebhookSection: boolean;
  integrationContainerCheck: ReadinessCheckResponse | null;
  integrationLoginConfirmed: boolean;
  isBusy: boolean;
  isCheckingAuthPreflight: boolean;
  isCheckingIntegrationContainer: boolean;
  isCheckingJiraWebhook: boolean;
  isSubmittingAuthCode: boolean;
  isVerifyingAuthSession: boolean;
  jiraWebhookCheck: ReadinessCheckResponse | null;
  jiraWebhookErrorHelp: string;
  launchIntegrationLabel: string;
  launchReadyForReview: boolean;
  launchSucceeded: boolean;
  prontoRocket: string;
  selectedAiAgent: AuthProvider;
  showIntegrationLoginPanel: boolean;
  status: StatusResponse | null;
  onAuthCodeInputChange: (value: string) => void;
  onConsoleScroll: () => void;
  onCopyDeviceCode: () => void;
  onDismissIntegrationLogin: () => void;
  onDismissJiraWebhook: () => void;
  onRunIntegrationContainerCheck: () => void;
  onRunJiraWebhookCheck: () => void;
  onRunSetup: () => void;
  onStopSetup: () => void;
  onSubmitProviderAuthCode: () => void;
};

export function RunStep(props: RunStepProps) {
  return (
    <div className="run-grid">
      <div className="step-main-card terminal-side-panel">
        <p className="eyebrow">Launch PRonto</p>
        <h3>Bring the service online.</h3>
        <p className="muted">
          Generate the environment config, build the image, replace the running container if needed, and check service health from one launch sequence.
        </p>
        <div className="action-row">
          <button className={`primary hero-primary launch-button ${props.launchSucceeded ? "is-pass" : ""}`} onClick={props.onRunSetup} disabled={props.isBusy || !props.launchReadyForReview || props.launchSucceeded}>
            {props.isBusy ? "Launching..." : "Launch PRonto"}
          </button>
          <button className="primary hero-danger stop-button" onClick={props.onStopSetup} disabled={props.isBusy || !props.launchSucceeded}>
            Stop Service
          </button>
        </div>
        <div className="activity-card launch-activity">
          <h4>Launch sequence</h4>
          {!props.launchReadyForReview ? <p className="muted">Return to the previous steps and complete the remaining checks before launch.</p> : null}
          <ul className="plain-list">
            {props.activity.length === 0 ? <li>No actions yet.</li> : props.activity.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
        <div className="activity-card launch-activity">
          <h4>Created pull requests</h4>
          <ul className="plain-list pr-link-list">
            {props.createdPullRequests.length === 0 ? (
              <li>No pull requests detected yet.</li>
            ) : (
              props.createdPullRequests.map((url) => (
                <li key={url}>
                  <a href={url} target="_blank" rel="noreferrer">
                    {url}
                  </a>
                </li>
              ))
            )}
          </ul>
        </div>
        {props.showIntegrationLoginPanel ? (
          <LaunchIntegrationLoginPanel
            authCodeInput={props.authCodeInput}
            authCodeSubmissionResult={props.authCodeSubmissionResult}
            authSession={props.authSession}
            claudeCodeSubmissionRequired={props.claudeCodeSubmissionRequired}
            claudeLoginPendingLabel={props.claudeLoginPendingLabel}
            copiedDeviceCode={props.copiedDeviceCode}
            deviceLogin={props.deviceLogin}
            hasSubmittedClaudeAuthCode={props.hasSubmittedClaudeAuthCode}
            integrationContainerCheck={props.integrationContainerCheck}
            integrationLoginConfirmed={props.integrationLoginConfirmed}
            isCheckingAuthPreflight={props.isCheckingAuthPreflight}
            isCheckingIntegrationContainer={props.isCheckingIntegrationContainer}
            isSubmittingAuthCode={props.isSubmittingAuthCode}
            isVerifyingAuthSession={props.isVerifyingAuthSession}
            launchIntegrationLabel={props.launchIntegrationLabel}
            launchSucceeded={props.launchSucceeded}
            onAuthCodeInputChange={props.onAuthCodeInputChange}
            onCopyDeviceCode={props.onCopyDeviceCode}
            onDismiss={props.onDismissIntegrationLogin}
            onRunIntegrationContainerCheck={props.onRunIntegrationContainerCheck}
            onSubmitProviderAuthCode={props.onSubmitProviderAuthCode}
            selectedAiAgent={props.selectedAiAgent}
          />
        ) : null}
        {!props.hideJiraWebhookSection ? (
          <div className="activity-card launch-activity">
            <div className="activity-card-header">
              <h4>Webhook delivery</h4>
              {props.jiraWebhookCheck?.ok ? (
                <button className="activity-card-close" onClick={props.onDismissJiraWebhook} aria-label="Dismiss webhook delivery section" title="Dismiss" type="button">
                  ×
                </button>
              ) : null}
            </div>
            <p className="muted">
              After PRonto is running, send a safe test webhook through the public URL to confirm routing and secret handling before trying a real Jira transition.
            </p>
            <ConnectionTestPanel
              buttonClassName={`primary jira-check-button ${props.jiraWebhookCheck ? (props.jiraWebhookCheck.ok ? "is-pass" : "is-fail") : ""}`}
              buttonLabel={props.isCheckingJiraWebhook ? "Testing webhook..." : "Test Jira Webhook Delivery"}
              onClick={props.onRunJiraWebhookCheck}
              disabled={props.isCheckingJiraWebhook || !props.launchSucceeded}
              readyLabel="✓ webhook delivery confirmed"
              resultTitle="Jira webhook delivery result"
              result={props.jiraWebhookCheck}
              errorHelp={props.jiraWebhookErrorHelp}
            />
          </div>
        ) : null}
      </div>
      <div className="guide-card terminal-side-panel">
        <div className="run-console-brand">
          <img src={props.prontoRocket} alt="" className="run-console-mark brand-logo-inline" />
          <h3>Console output</h3>
        </div>
        <pre ref={props.consoleOutputRef} onScroll={props.onConsoleScroll}>{props.status?.logs || "No logs yet."}</pre>
        {!props.deviceLogin && props.authSessionStatusMessage ? (
          <div className="guide-section guide-error-help">
            <h4>{props.launchIntegrationLabel} sign-in status</h4>
            <p className="muted">{props.authSessionStatusMessage}</p>
            {props.authPreflight?.checks?.length ? (
              <ul className="plain-list">
                {props.authPreflight.checks.filter((check) => check.severity !== "pass").map((check) => (
                  <li key={`${check.name}-${check.code}`}>
                    {check.summary}
                    {check.remediation ? ` ${check.remediation}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
