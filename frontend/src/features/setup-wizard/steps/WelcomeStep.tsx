type WelcomeStepProps = {
  onGetStarted: () => void;
  prontoGlowOverlay: string;
  prontoHeroBg: string;
  prontoRocket: string;
  prontoRocketLarge: string;
  prontoStarsOverlay: string;
};

const SUMMARY_STEPS = [
  ["01", "Jira triggers the workflow", "A ticket transition starts the automation the moment delivery work begins."],
  ["02", "A spec is generated", "The ticket context is converted into an implementation-ready plan."],
  ["03", "The repo is prepared", "The correct repository is selected, cloned, and branched automatically."],
  ["04", "Implementation runs", "The coding workflow applies changes and prepares the result for review."],
  ["05", "A PR is opened", "The branch is pushed and a pull request is created against the target base branch."],
  ["06", "Jira is updated", "The issue receives the outcome so the handoff back to review stays visible."]
] as const;

export function WelcomeStep(props: WelcomeStepProps) {
  return (
    <div className="welcome-layout">
      <section className="welcome-hero">
        <img src={props.prontoHeroBg} alt="" className="welcome-hero-art" />
        <img src={props.prontoStarsOverlay} alt="" className="welcome-stars-overlay" />
        <img src={props.prontoGlowOverlay} alt="" className="welcome-glow-overlay" />
        <div className="welcome-hero-overlay" />
        <div className="welcome-copy">
          <h3 className="welcome-headline">
            <img src={props.prontoRocketLarge} alt="" className="welcome-headline-logo welcome-headline-logo-large" />
            <span>From Ticket to PR. PRonto.</span>
          </h3>
          <p className="muted">
            Connect Jira, GitHub, and your preferred AI coding integration once. PRonto can generate the spec, prepare the repository, run the coding workflow, and open a pull request automatically when work begins.
          </p>
          <div className="welcome-primary-action">
            <div className="welcome-cta-row welcome-cta-row-prominent">
              <button className="primary hero-primary welcome-get-started" onClick={props.onGetStarted}>
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
              <img src={props.prontoRocket} alt="" className="terminal-mark-image brand-logo-terminal" />
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
            {SUMMARY_STEPS.map(([number, title, text]) => (
              <div className="summary-step" key={number}>
                <strong>{number}</strong>
                <div>
                  <h4>{title}</h4>
                  <p>{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
