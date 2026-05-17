import { StatusBadge } from "../../../components/ui/StatusBadge";
import { STEPS } from "../constants/steps";
import type { PrereqResponse, StatusResponse } from "../types/api";

type WizardSidebarProps = {
  completedStepIndexes: number[];
  currentStepIndex: number;
  isNavigationLocked: boolean;
  onStepClick: (index: number) => void;
  prontoRocket: string;
};

export function WizardSidebar(props: WizardSidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand-block">
        <div className="brand-lockup">
          <img src={props.prontoRocket} alt="PRonto logo" className="brand-mark-image brand-logo-sidebar" />
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
        {STEPS.map((step, index) => {
          const isCompleted = props.completedStepIndexes.includes(index);
          const isCurrent = index === props.currentStepIndex;
          return (
            <li key={step.id} className={`step-item ${isCurrent ? "active" : ""} ${isCompleted ? "completed" : ""} ${!isCompleted && !isCurrent ? "locked" : ""}`}>
              <button className="step-item-button" type="button" onClick={() => props.onStepClick(index)} disabled={props.isNavigationLocked || (!isCompleted && !isCurrent)}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{step.title}</strong>
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

export function WizardHero(props: { checks: PrereqResponse | null; status: StatusResponse | null; title: string }) {
  return (
    <section className="panel hero-panel">
      <div className="hero-copy">
        <p className="eyebrow">PRonto Launch Setup</p>
        <h2>{props.title}</h2>
        <p className="hero-detail">Connect services, validate access, and launch the automation service from one polished control surface.</p>
      </div>
      <div className="status-grid">
        <StatusBadge label="System Check" value={props.checks?.dockerInstalled ? "Ready" : "Missing"} tone={props.checks?.dockerInstalled ? "good" : "warn"} />
        <StatusBadge label="Config" value={props.status?.config.exists ? "Primed" : "Not saved"} tone={props.status?.config.exists ? "good" : "neutral"} />
        <StatusBadge label="Service" value={props.status?.docker.container.running ? "Running" : props.status?.docker.container.status || "Unknown"} tone={props.status?.docker.container.running ? "good" : "neutral"} />
        <StatusBadge label="Health" value={props.status?.health.reachable ? "Healthy" : "Offline"} tone={props.status?.health.reachable ? "good" : "warn"} />
      </div>
    </section>
  );
}

export function WizardNavigation(props: {
  canGoNext: boolean;
  canGoPrevious: boolean;
  showNext: boolean;
  onNext: () => void;
  onPrevious: () => void;
}) {
  return (
    <footer className="footer-nav">
      <button className="secondary" onClick={props.onPrevious} disabled={!props.canGoPrevious}>Back</button>
      {props.showNext ? (
        <button className="primary hero-primary" onClick={props.onNext} disabled={!props.canGoNext}>
          Next
        </button>
      ) : null}
    </footer>
  );
}
