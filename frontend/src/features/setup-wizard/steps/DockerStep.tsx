import { ResultList } from "../../../components/ui/ResultList";
import type { DockerContextResponse, DockerNetworkCheckResponse, DockerRecoveryResponse, ReadinessCheckResponse, StatusResponse } from "../types/api";

type DockerStepProps = {
  apiBase: string;
  canOpenDockerDesktop: boolean;
  canStartColima: boolean;
  colimaInstallLink: string;
  dockerBuildCheck: DockerRecoveryResponse | null;
  dockerBuildElapsedLabel: string;
  dockerBuildProgressLabel: string;
  dockerCheck: ReadinessCheckResponse | null;
  dockerContexts: DockerContextResponse["contexts"];
  dockerDiagnosis: ReadinessCheckResponse["diagnosis"];
  dockerErrorHelp: string;
  dockerImageReady: boolean;
  dockerInstallLabel: string;
  dockerInstallLink: string;
  dockerNetworkCheck: DockerNetworkCheckResponse | null;
  dockerPlatform: string;
  dockerPlatformHelp: string;
  dockerRecoveryMessage: string;
  isCheckingDocker: boolean;
  isCheckingDockerBuild: boolean;
  isCheckingDockerNetwork: boolean;
  isCheckingSetupApi: boolean;
  isLoadingDockerContexts: boolean;
  isOpeningDockerDesktop: boolean;
  isPollingDockerRecovery: boolean;
  isResettingDockerBuilderCache: boolean;
  isStartingColima: boolean;
  isSwitchingDockerContext: boolean;
  selectedDockerContext: string;
  setupApiActionLabel: string;
  setupApiError: string;
  setupApiReachable: boolean | null;
  shouldOfferColimaInstall: boolean;
  shouldOfferContextSwitch: boolean;
  shouldOfferDockerBuildRecovery: boolean;
  status: StatusResponse | null;
  onCheckSetupApiReachability: () => void;
  onLoadDockerContexts: () => void;
  onOpenDockerDesktop: () => void;
  onResetDockerBuilder: () => void;
  onRunDockerBuildCheck: () => void;
  onRunDockerCheck: () => void;
  onRunDockerNetworkDiagnostics: () => void;
  onSelectedDockerContextChange: (value: string) => void;
  onStartColima: () => void;
  onStartSetupApi: () => void;
  onSwitchDockerContext: () => void;
};

export function DockerStep(props: DockerStepProps) {
  return (
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
            <li>Run the PRonto system check and verify the PRonto image build before moving on.</li>
          </ol>
          <div className="action-row">
            <button
              className={`primary docker-check-button ${props.dockerCheck ? (props.dockerCheck.ok ? "is-pass" : "is-fail") : ""}`}
              onClick={props.onRunDockerCheck}
              disabled={props.isCheckingDocker || props.isCheckingSetupApi || props.setupApiReachable === false}
            >
              {props.isCheckingDocker ? "Running System Check..." : "Run System Check"}
            </button>
            {props.dockerCheck?.ok ? <span className="check-pass">✓ Docker runtime ready</span> : null}
          </div>
          <div className="action-row">
            <button
              className={`primary docker-check-button ${props.dockerImageReady ? "is-pass" : props.dockerBuildCheck && !props.dockerBuildCheck.ok ? "is-fail" : ""}`}
              onClick={props.onRunDockerBuildCheck}
              disabled={!props.dockerCheck?.ok || props.isCheckingDockerBuild || props.isCheckingDocker}
            >
              {props.isCheckingDockerBuild ? "Building PRonto image..." : props.status?.docker.imageExists ? "Rebuild PRonto Image" : "Verify PRonto Image Build"}
            </button>
            {props.dockerImageReady ? <span className="check-pass">✓ PRonto image ready</span> : null}
          </div>
          {props.isCheckingDockerBuild ? (
            <p className="muted">
              {props.dockerBuildProgressLabel} Building for {props.dockerBuildElapsedLabel}.
            </p>
          ) : null}
        </div>
      </div>
      <div className="guide-card terminal-side-panel">
        <h3>System output</h3>
        {props.isCheckingSetupApi ? <p className="muted">Checking Setup API reachability...</p> : null}
        {props.setupApiReachable === false ? (
          <div className="guide-section guide-error-help docker-troubleshooting">
            <h4>Setup API offline</h4>
            <p>PRonto cannot run Docker checks until the local Setup API is reachable.</p>
            {props.setupApiError ? (
              <p className="muted">
                <code>{props.setupApiError}</code>
              </p>
            ) : null}
            <ol className="plain-list ordered">
              <li>
                Start setup-api: <code>npm run dev:setup-api</code>
              </li>
              <li>
                Start auth-broker: <code>npm run dev:auth-broker</code>
              </li>
              <li>
                Open and verify:{" "}
                <a href={`${props.apiBase}/api/status`} target="_blank" rel="noreferrer">
                  {props.apiBase}/api/status
                </a>
              </li>
              <li>
                If localhost fails, use <code>VITE_SETUP_API_BASE_URL=http://127.0.0.1:3010</code>
              </li>
            </ol>
            <div className="action-row">
              <button className="primary" onClick={props.onStartSetupApi}>
                {props.setupApiActionLabel}
              </button>
              <button className="secondary" onClick={props.onCheckSetupApiReachability} disabled={props.isCheckingSetupApi}>
                Recheck Setup API
              </button>
            </div>
          </div>
        ) : null}
        <ResultList result={props.dockerCheck} emptyMessage="Run the system check to confirm this machine is ready for launch." />
        {props.dockerCheck?.ok ? <DockerBuildStatus {...props} /> : null}
        {props.dockerCheck && !props.dockerCheck.ok ? <DockerTroubleshooting {...props} /> : null}
      </div>
    </div>
  );
}

function DockerBuildStatus(props: DockerStepProps) {
  return (
    <div className="guide-section">
      <h4>PRonto image build</h4>
      <p className={props.dockerImageReady ? "check-pass" : "muted"}>
        {props.dockerImageReady
          ? "✓ PRonto image build completed successfully."
          : "Build the Docker image now so package installation issues are caught during System Check instead of at launch."}
      </p>
      {props.dockerBuildCheck ? (
        <ul className="plain-list">
          <li className={props.dockerBuildCheck.ok ? "result-pass" : "result-fail"}>
            <strong>{props.dockerBuildCheck.ok ? "✓" : "✕"} docker build</strong>
            <span>
              {props.dockerBuildCheck.ok
                ? "PRonto image built successfully."
                : props.dockerBuildCheck.diagnosis?.message || props.dockerBuildCheck.output || "Docker image build failed."}
            </span>
          </li>
        </ul>
      ) : props.status?.docker.imageExists ? (
        <ul className="plain-list">
          <li className="result-pass">
            <strong>✓ docker build</strong>
            <span>The PRonto image already exists on this machine.</span>
          </li>
        </ul>
      ) : (
        <p className="muted">Run the build verification once Docker is ready.</p>
      )}
      {props.shouldOfferDockerBuildRecovery ? (
        <div className="guide-section">
          <h4>Build recovery</h4>
          <p className="muted">If the image build fails during package installation, check Docker networking and optionally clear the builder cache before retrying.</p>
          <div className="action-row">
            <button className="secondary" onClick={props.onRunDockerNetworkDiagnostics} disabled={props.isCheckingDockerNetwork || props.isCheckingDockerBuild}>
              {props.isCheckingDockerNetwork ? "Running Docker Network Check..." : "Run Docker Network Check"}
            </button>
            <button className="secondary" onClick={props.onResetDockerBuilder} disabled={props.isResettingDockerBuilderCache || props.isCheckingDockerBuild}>
              {props.isResettingDockerBuilderCache ? "Resetting Builder Cache..." : "Reset Builder Cache"}
            </button>
          </div>
          {props.dockerNetworkCheck ? <ResultList result={props.dockerNetworkCheck} /> : null}
          {props.dockerNetworkCheck?.diagnosis?.message ? <p className="muted">{props.dockerNetworkCheck.diagnosis.message}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function DockerTroubleshooting(props: DockerStepProps) {
  return (
    <div className="guide-section guide-error-help docker-troubleshooting">
      <h4>{props.dockerDiagnosis?.title || "Fix options"}</h4>
      <p>{props.dockerErrorHelp}</p>
      {props.dockerDiagnosis?.context ? (
        <p className="muted">
          Active Docker context: <code>{props.dockerDiagnosis.context}</code>
        </p>
      ) : null}
      <p className="muted">{props.dockerPlatformHelp}</p>
      {props.dockerDiagnosis?.code === "docker_not_installed" ? (
        <p className="muted">
          Install Docker from{" "}
          <a href={props.dockerInstallLink} target="_blank" rel="noreferrer">
            {props.dockerInstallLink}
          </a>
          .
        </p>
      ) : null}
      {props.dockerDiagnosis?.code === "docker_desktop_not_installed" || props.dockerDiagnosis?.code === "docker_desktop_open_failed" ? (
        <p className="muted">Use the install guide below if Docker Desktop is missing, then come back and retry from this screen.</p>
      ) : null}
      {props.dockerDiagnosis?.code === "colima_not_installed" ? (
        <p className="muted">Install Colima or switch Docker to a different context before continuing.</p>
      ) : null}
      {props.dockerDiagnosis?.code === "colima_broken" ? (
        <p className="muted">This usually needs a Colima profile repair or recreation outside PRonto, or a switch to a different Docker context.</p>
      ) : null}
      {props.dockerDiagnosis?.code === "colima_start_failed" || props.dockerDiagnosis?.code === "colima_vm_config_error" ? (
        <p className="muted">If Colima keeps failing, use Docker Desktop or switch to another healthy Docker context from this screen so a new user can continue setup without terminal commands.</p>
      ) : null}
      {props.dockerDiagnosis?.code === "docker_context_misconfigured" ? (
        <p className="muted">
          Switch to a working Docker context such as <code>default</code> or the active Desktop context, then retry.
        </p>
      ) : null}
      {props.dockerDiagnosis?.code === "docker_permission_denied" ? (
        <p className="muted">Fix local Docker socket permissions for this user account, then rerun the system check.</p>
      ) : null}
      {props.dockerRecoveryMessage ? <p className="muted">{props.dockerRecoveryMessage}</p> : null}
      {props.isPollingDockerRecovery ? <p className="muted">Waiting for Docker to become ready...</p> : null}
      {props.canStartColima || props.canOpenDockerDesktop ? <DockerRuntimeActions {...props} /> : null}
      {props.shouldOfferContextSwitch ? <DockerContextSwitch {...props} /> : null}
      {props.dockerDiagnosis?.code === "docker_not_installed" || props.dockerDiagnosis?.code === "docker_desktop_not_installed" || props.dockerDiagnosis?.code === "docker_desktop_open_failed" ? (
        <div className="action-row">
          <a className="secondary button-link" href={props.dockerInstallLink} target="_blank" rel="noreferrer">
            {props.dockerInstallLabel}
          </a>
        </div>
      ) : null}
      {props.shouldOfferColimaInstall || props.dockerDiagnosis?.code === "colima_start_failed" || props.dockerDiagnosis?.code === "colima_vm_config_error" ? (
        <div className="action-row">
          {props.shouldOfferColimaInstall ? (
            <a className="secondary button-link" href={props.colimaInstallLink} target="_blank" rel="noreferrer">
              Open Colima install guide
            </a>
          ) : null}
          {props.dockerPlatform === "darwin" ? (
            <a className="secondary button-link" href={props.dockerInstallLink} target="_blank" rel="noreferrer">
              Open Docker Desktop install guide
            </a>
          ) : null}
        </div>
      ) : null}
      <div className="action-row">
        <button className="secondary" onClick={props.onRunDockerCheck} disabled={props.isCheckingDocker || props.isPollingDockerRecovery}>
          {props.isCheckingDocker ? "Retrying..." : "Retry System Check"}
        </button>
      </div>
    </div>
  );
}

function DockerRuntimeActions(props: DockerStepProps) {
  return (
    <div className="action-row">
      {props.canStartColima ? (
        <button className="primary" onClick={props.onStartColima} disabled={props.isStartingColima || props.isCheckingDocker || props.isPollingDockerRecovery}>
          {props.isStartingColima ? "Starting Colima..." : "Start Colima"}
        </button>
      ) : null}
      {props.canOpenDockerDesktop ? (
        <button className="secondary" onClick={props.onOpenDockerDesktop} disabled={props.isOpeningDockerDesktop || props.isPollingDockerRecovery}>
          {props.isOpeningDockerDesktop ? "Opening Docker Desktop..." : "Open Docker Desktop"}
        </button>
      ) : null}
    </div>
  );
}

function DockerContextSwitch(props: DockerStepProps) {
  return (
    <div className="guide-section">
      <h4>Switch Docker context</h4>
      <p className="muted">If Docker is pointed at the wrong runtime, switch to another available context and rerun the check.</p>
      <div className="action-row">
        <label className="field docker-context-field">
          <span>Docker context</span>
          <select value={props.selectedDockerContext} onChange={(event) => props.onSelectedDockerContextChange(event.target.value)}>
            {props.dockerContexts.map((context) => (
              <option key={context.name} value={context.name}>
                {context.name}
                {context.current ? " (current)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="action-row">
        <button className="secondary" onClick={props.onLoadDockerContexts} disabled={props.isLoadingDockerContexts}>
          {props.isLoadingDockerContexts ? "Loading Contexts..." : props.dockerContexts.length > 0 ? "Refresh Contexts" : "Load Contexts"}
        </button>
        <button className="primary" onClick={props.onSwitchDockerContext} disabled={!props.selectedDockerContext || props.isSwitchingDockerContext}>
          {props.isSwitchingDockerContext ? "Switching Context..." : "Use Selected Context"}
        </button>
      </div>
    </div>
  );
}
