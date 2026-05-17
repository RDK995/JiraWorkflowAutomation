import type { ReactNode } from "react";

type ReviewStepProps = {
  launchBlockers: string[];
  launchReadyForReview: boolean;
  reviewItems: Array<[string, ReactNode]>;
};

export function ReviewStep(props: ReviewStepProps) {
  return (
    <div className="two-column">
      <div className="step-main-card">
        <p className="eyebrow">Launch Review</p>
        <h3>{props.launchReadyForReview ? "Ready to launch PRonto." : "Finish these checks before launch."}</h3>
        {!props.launchReadyForReview ? (
          <div className="guide-section guide-error-help">
            <p className="muted">PRonto should only reach the Launch Console after every required setup check has passed.</p>
            <ul className="plain-list ordered">
              {props.launchBlockers.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <dl className="review-list">
          {props.reviewItems.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="guide-card guide-card-compact">
        <h3>Next up</h3>
        <ol className="plain-list ordered">
          <li>Review the Jira webhook instructions on the next step.</li>
          <li>Launch PRonto after the webhook step is complete.</li>
          <li>
            Add <code>GitHub Repo: owner/repo</code> to the Jira ticket description.
          </li>
          <li>Move a test ticket to In Progress and watch the PRonto console.</li>
        </ol>
      </div>
    </div>
  );
}
