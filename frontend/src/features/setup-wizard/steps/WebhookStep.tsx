import { GuideLinkCard } from "../components/GuideLinkCard";

type WebhookStepProps = {
  configuredWebhookUrl: string;
  inProgressStatus: string;
  isNgrokEnabled: boolean;
  jiraBaseUrl: string;
  readyStatus: string;
};

export function WebhookStep(props: WebhookStepProps) {
  const jiraWebhookUrl = props.jiraBaseUrl
    ? `${props.jiraBaseUrl.replace(/\/+$/, "")}/plugins/servlet/webhooks`
    : "https://support.atlassian.com/jira-cloud-administration/docs/manage-webhooks/";

  return (
    <div className="two-column webhook-page">
      <div className="step-main-card">
        <p className="eyebrow">Jira Webhook</p>
        <h3>Prepare the Jira transition webhook.</h3>
        <p className="muted webhook-hero-copy">
          This step gathers the exact webhook settings Jira needs before you move into the Launch Console.
        </p>
        {!props.isNgrokEnabled ? (
          <div className="guide-section guide-error-help">
            <h4>Public access is disabled</h4>
            <p className="muted">
              Jira cannot send webhooks to PRonto until public access is enabled. Go back to <strong>Public Access</strong>, turn on ngrok, and run the public access check before configuring the Jira webhook.
            </p>
          </div>
        ) : null}
        <div className="guide-section">
          <h4>Webhook URL</h4>
          {!props.isNgrokEnabled ? (
            <div className="webhook-url-card">
              <span className="webhook-url-chip">Unavailable</span>
              <p className="muted">No public webhook URL is available while ngrok is disabled.</p>
            </div>
          ) : props.configuredWebhookUrl ? (
            <div className="webhook-url-card is-ready">
              <span className="webhook-url-chip">Ready now</span>
              <p className="muted">A reserved ngrok domain is configured, so you can use this final webhook URL in Jira right now.</p>
              <p className="webhook-url-value">
                <code>{props.configuredWebhookUrl}</code>
              </p>
            </div>
          ) : (
            <div className="webhook-url-card">
              <span className="webhook-url-chip">Available after launch</span>
              <p className="muted">You are using an ephemeral ngrok URL, so the final webhook URL will appear in the Launch Console after PRonto starts.</p>
              <p className="muted">You can still open Jira webhook settings now, then paste the live URL in after launch.</p>
            </div>
          )}
        </div>
        <div className="guide-section jira-webhook-example">
          <h4>Jira example</h4>
          <p className="muted">Use this as a visual reference when configuring the webhook in Jira.</p>
          <div className="jira-webhook-shot">
            <div className="jira-webhook-shot-header">
              <strong>Issue related events</strong>
              <p>You can specify a JQL query to send only events triggered by matching issues.</p>
            </div>
            <div className="jira-webhook-shot-query">
              <span className="jira-webhook-shot-check">✓</span>
              <code>
                project = KAN AND status changed from "{props.readyStatus}" to "{props.inProgressStatus}"
              </code>
            </div>
            <div className="jira-webhook-shot-link">Syntax help</div>
            <div className="jira-webhook-shot-grid">
              <div className="jira-webhook-shot-column">
                <span className="jira-webhook-shot-label">Issue</span>
                <div className="jira-webhook-shot-option is-checked">updated</div>
                <div className="jira-webhook-shot-option">created</div>
                <div className="jira-webhook-shot-option">deleted</div>
              </div>
              <div className="jira-webhook-shot-column">
                <span className="jira-webhook-shot-label">Worklog</span>
                <div className="jira-webhook-shot-option">created</div>
                <div className="jira-webhook-shot-option">updated</div>
                <div className="jira-webhook-shot-option">deleted</div>
              </div>
              <div className="jira-webhook-shot-column">
                <span className="jira-webhook-shot-label">Comment</span>
                <div className="jira-webhook-shot-option">created</div>
                <div className="jira-webhook-shot-option">updated</div>
                <div className="jira-webhook-shot-option">deleted</div>
              </div>
              <div className="jira-webhook-shot-column">
                <span className="jira-webhook-shot-label">Attachment</span>
                <div className="jira-webhook-shot-option">created</div>
                <div className="jira-webhook-shot-option">deleted</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="guide-card guide-card-compact">
        <div className="guide-section">
          <h4>Before you continue</h4>
          <ol className="plain-list ordered webhook-side-list">
            {!props.isNgrokEnabled ? (
              <li>Enable public access first so Jira has a public URL to call.</li>
            ) : (
              <li>If you use a reserved ngrok domain, add the webhook URL in Jira now.</li>
            )}
            {!props.isNgrokEnabled ? (
              <li>Run the public access check after enabling ngrok.</li>
            ) : (
              <li>If you use an ephemeral ngrok URL, continue to Launch Console, then copy the live URL into Jira after PRonto starts.</li>
            )}
            {!props.isNgrokEnabled ? (
              <li>Return here after public access is enabled and tested.</li>
            ) : (
              <li>After launch, use the webhook delivery test to confirm Jira can reach PRonto.</li>
            )}
          </ol>
        </div>
        <div aria-hidden="true" style={{ height: "0.5rem" }} />
        <GuideLinkCard
          title="Open Jira webhook settings"
          description="Open Jira's webhook configuration page and create or update the webhook that points at PRonto."
          href={jiraWebhookUrl}
          linkLabel={props.jiraBaseUrl ? "Open webhook settings in Jira" : "Open Jira webhook docs"}
        />
      </div>
    </div>
  );
}
