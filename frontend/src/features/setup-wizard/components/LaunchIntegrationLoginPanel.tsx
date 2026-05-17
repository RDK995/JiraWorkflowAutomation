import type { MouseEvent } from "react";
import { ConnectionTestPanel } from "../../../components/ui/ConnectionTestPanel";
import { Field } from "../../../components/ui/Field";
import type { DeviceLoginPrompt } from "../domain/deviceLogin";
import type { AuthProvider, AuthSessionResponse, ReadinessCheckResponse } from "../types/api";

type LaunchIntegrationLoginPanelProps = {
  authCodeInput: string;
  authCodeSubmissionResult: AuthSessionResponse | null;
  authSession: AuthSessionResponse | null;
  claudeCodeSubmissionRequired: boolean;
  claudeLoginPendingLabel: string;
  copiedDeviceCode: boolean;
  deviceLogin: DeviceLoginPrompt | null;
  hasSubmittedClaudeAuthCode: boolean;
  integrationContainerCheck: ReadinessCheckResponse | null;
  integrationLoginConfirmed: boolean;
  isCheckingAuthPreflight: boolean;
  isCheckingIntegrationContainer: boolean;
  isSubmittingAuthCode: boolean;
  isVerifyingAuthSession: boolean;
  launchIntegrationLabel: string;
  launchSucceeded: boolean;
  onAuthCodeInputChange: (value: string) => void;
  onCopyDeviceCode: () => void;
  onDismiss: () => void;
  onRunIntegrationContainerCheck: () => void;
  onSubmitProviderAuthCode: () => void;
  selectedAiAgent: AuthProvider;
};

export function LaunchIntegrationLoginPanel(props: LaunchIntegrationLoginPanelProps) {
  const {
    authCodeInput,
    authCodeSubmissionResult,
    authSession,
    claudeCodeSubmissionRequired,
    claudeLoginPendingLabel,
    copiedDeviceCode,
    deviceLogin,
    hasSubmittedClaudeAuthCode,
    integrationContainerCheck,
    integrationLoginConfirmed,
    isCheckingAuthPreflight,
    isCheckingIntegrationContainer,
    isSubmittingAuthCode,
    isVerifyingAuthSession,
    launchIntegrationLabel,
    launchSucceeded,
    onAuthCodeInputChange,
    onCopyDeviceCode,
    onDismiss,
    onRunIntegrationContainerCheck,
    onSubmitProviderAuthCode,
    selectedAiAgent
  } = props;

  const handleOpenSignInPage = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!deviceLogin?.url) {
      event.preventDefault();
    }
  };

  return (
    <div className="activity-card launch-activity">
      <div className="activity-card-header">
        <h4>Connect {launchIntegrationLabel}</h4>
        {integrationLoginConfirmed ? (
          <button
            className="activity-card-close"
            onClick={onDismiss}
            aria-label={`Dismiss ${launchIntegrationLabel} login section`}
            type="button"
          >
            ×
          </button>
        ) : null}
      </div>
      {!integrationLoginConfirmed ? (
        <>
          <p className="muted">
            {!deviceLogin
              ? isCheckingAuthPreflight
                ? `Running ${launchIntegrationLabel} auth preflight checks now. This panel will update as soon as the sign-in session is ready.`
                : `Preparing the ${launchIntegrationLabel} sign-in session now. This panel will update as soon as the browser sign-in page is ready.`
              : <>Click <strong>Open Sign-In Page</strong> to continue the device login in your browser, then return here and wait for PRonto to continue.</>}
          </p>
          <ol className="plain-list ordered">
            <li>{!deviceLogin ? `Wait for PRonto to prepare the ${launchIntegrationLabel} sign-in page.` : <>Click <strong>Open Sign-In Page</strong>.</>}</li>
            {deviceLogin?.code ? <li>Enter the one-time code shown below.</li> : <li>Follow the sign-in flow shown in your browser.</li>}
            <li>Return to this screen after signing in.</li>
          </ol>
          <div className="action-row">
            <a className={`secondary button-link ${deviceLogin ? "" : "is-disabled"}`} href={deviceLogin?.url || "#"} target="_blank" rel="noreferrer" onClick={handleOpenSignInPage}>
              Open Sign-In Page
            </a>
            {deviceLogin?.code ? (
              <button className="secondary" onClick={onCopyDeviceCode} type="button">
                {copiedDeviceCode ? "Code Copied" : "Copy Code"}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
      {selectedAiAgent === "claude" && claudeCodeSubmissionRequired && !integrationLoginConfirmed ? (
        <div className="guide-section">
          <h4>Paste code from Claude Code</h4>
          <p className="muted">
            After authorizing in your browser, copy the code Claude Code gives you and paste it below so PRonto can finish the login in the same local auth session.
          </p>
          <Field
            label="Claude Code authorization code"
            value={authCodeInput}
            onChange={onAuthCodeInputChange}
            placeholder="Paste the code from Claude Code"
          />
          <div className="action-row launch-auth-actions">
            <button
              className="secondary"
              type="button"
              onClick={onSubmitProviderAuthCode}
              disabled={isSubmittingAuthCode || isVerifyingAuthSession || !authCodeInput.trim() || !authSession?.session?.id}
            >
              {isSubmittingAuthCode ? "Submitting Code..." : isVerifyingAuthSession ? "Verifying Login..." : "Submit Code"}
            </button>
          </div>
          {authCodeSubmissionResult ? (
            <div className="activity-card">
              <h4>{launchIntegrationLabel} submission result</h4>
              <p className={authCodeSubmissionResult.ok ? "status-ok" : "status-error"}>
                {authCodeSubmissionResult.session?.error?.message || authCodeSubmissionResult.error?.message || (authCodeSubmissionResult.ok ? `${launchIntegrationLabel} login step completed.` : `${launchIntegrationLabel} login step failed.`)}
              </p>
              {authCodeSubmissionResult.session?.error?.remediation || authCodeSubmissionResult.error?.remediation ? (
                <p className="muted">{authCodeSubmissionResult.session?.error?.remediation || authCodeSubmissionResult.error?.remediation}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {deviceLogin?.code && !integrationLoginConfirmed ? (
        <div className="guide-section">
          <h4>One-time code</h4>
          <p><code>{deviceLogin.code}</code></p>
          <p className="muted">{deviceLogin.expiryText || "This code expires shortly."}</p>
          <p className="muted">Only enter this code on the sign-in page opened from PRonto.</p>
        </div>
      ) : null}
      {selectedAiAgent === "claude" ? (
        <ConnectionTestPanel
          hideButton
          pendingLabel={claudeLoginPendingLabel}
          readyLabel={`✓ ${launchIntegrationLabel} login confirmed`}
          resultTitle={`${launchIntegrationLabel} container login result`}
          result={integrationContainerCheck}
        />
      ) : (
        <ConnectionTestPanel
          buttonClassName={`primary github-check-button ${integrationContainerCheck ? (integrationContainerCheck.ok ? "is-pass" : "is-fail") : ""}`}
          buttonLabel={isCheckingIntegrationContainer ? `Testing ${launchIntegrationLabel} login...` : `Test ${launchIntegrationLabel} Login`}
          onClick={onRunIntegrationContainerCheck}
          disabled={isCheckingIntegrationContainer || !launchSucceeded}
          readyLabel={`✓ ${launchIntegrationLabel} login confirmed`}
          resultTitle={`${launchIntegrationLabel} container login result`}
          result={integrationContainerCheck}
        />
      )}
      {selectedAiAgent === "claude" && claudeCodeSubmissionRequired && !hasSubmittedClaudeAuthCode ? (
        <p className="muted">
          Complete the browser sign-in, then submit the Claude Code authorization code.
        </p>
      ) : null}
    </div>
  );
}
