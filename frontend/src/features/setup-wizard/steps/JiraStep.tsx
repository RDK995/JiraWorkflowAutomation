import { ConnectionTestPanel } from "../../../components/ui/ConnectionTestPanel";
import { Field } from "../../../components/ui/Field";
import { FieldGuide } from "../components/FieldGuide";
import { GuideLinkCard } from "../components/GuideLinkCard";
import { StepLayout } from "../components/StepLayout";
import type { ReadinessCheckResponse } from "../types/api";
import type { Config, ConfigField } from "../types/config";

type JiraStepProps = {
  config: Config;
  errors: Record<string, string>;
  isCheckingJira: boolean;
  jiraCheck: ReadinessCheckResponse | null;
  jiraErrorHelp: string;
  onRunJiraCheck: () => void;
  updateField: (field: ConfigField, value: string) => void;
};

export function JiraStep(props: JiraStepProps) {
  return (
    <StepLayout
      title="Connect Jira"
      description="Provide the Jira connection PRonto will use to read issues, generate specs, and post results back into the ticket."
      asideClassName="guide-card guide-card-compact"
      asideContent={
        <>
          <GuideLinkCard
            title="Create fine-grained personal access token"
            description="Open Atlassian token settings and create a fine-grained personal access token for the Jira account you want PRonto to use. Fine-grained tokens offer scoped permissions and are the recommended authentication method."
            href="https://id.atlassian.com/manage-profile/security/api-tokens"
            linkLabel="Open Atlassian token settings"
          />
          <FieldGuide
            items={[
              ["Base URL", <code key="base">https://your-site.atlassian.net</code>],
              ["User email", "The email tied to your Jira account"],
              ["Personal access token", "Your fine-grained personal access token created in Atlassian"],
              ["Webhook secret", "Optional. Use only if your Jira webhook is configured with one."],
              ["Webhook URL", <code key="webhook-url">https://&lt;public-url&gt;/webhooks/jira-transition</code>],
              ["Webhook event", "Use Issue updated, or the transition event if your Jira UI offers that directly."],
              ["JQL filter", <code key="jql-filter">status CHANGED FROM &quot;To Do&quot; TO &quot;In Progress&quot;</code>],
              ["Status fields", "Only change these if your Jira workflow uses different status names."]
            ]}
          />
          <details className="guide-section codex-advanced">
            <summary>Additional information</summary>
            <div className="guide-stack">
              <h4>About fine-grained personal access tokens</h4>
              <p className="muted">
                Fine-grained personal access tokens (PATs) are the recommended Atlassian authentication method. They offer scoped permissions and can be restricted to specific projects, improving security over legacy API tokens. Create your token with permissions for the Jira projects PRonto needs to access.
              </p>
              <p className="muted">
                Use these Jira docs if you need the full webhook setup flow, help creating fine-grained personal access tokens, or more detail on webhook administration.
              </p>
              <ul className="plain-list guide-checklist">
                <li>
                  <a href="https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/" target="_blank" rel="noreferrer">
                    Managing personal access tokens for Atlassian
                  </a>
                </li>
                <li>
                  <a href="https://support.atlassian.com/jira-cloud-administration/docs/manage-webhooks/" target="_blank" rel="noreferrer">
                    Jira Cloud webhook docs
                  </a>
                </li>
                <li>
                  <a href="https://support.atlassian.com/jira-software-cloud/docs/use-advanced-search-with-jira-query-language-jql/" target="_blank" rel="noreferrer">
                    JQL search and filter docs
                  </a>
                </li>
              </ul>
              <ol className="plain-list ordered">
                <li>
                  Run <strong>Test Jira Connection</strong> first to confirm the base URL, email, and API token are correct.
                </li>
                <li>
                  Open <strong>Jira Settings → System → Webhooks</strong>. You may need Jira admin access for this page.
                </li>
                <li>
                  Create a webhook and set the URL to your public PRonto address plus <code>/webhooks/jira-transition</code>.
                </li>
                <li>
                  Select <strong>Issue updated</strong> as the trigger, or a transition-specific event if your Jira instance exposes one.
                </li>
                <li>Add a JQL filter that matches the transition which should start PRonto, usually Ready to In Progress.</li>
                <li>
                  If you use a Jira webhook secret, paste the same secret into the <strong>Webhook secret</strong> field here.
                </li>
              </ol>
              <p className="muted">
                If your workflow starts when a ticket moves from <strong>{props.config.READY_STATUS || "To Do"}</strong> to{" "}
                <strong>{props.config.IN_PROGRESS_STATUS || "In Progress"}</strong>, a good starting filter is:
              </p>
              <pre className="inline-code-block">
{`project = ABC AND status CHANGED FROM "${props.config.READY_STATUS || "To Do"}" TO "${props.config.IN_PROGRESS_STATUS || "In Progress"}"`}
              </pre>
              <p className="muted">
                After launch, move a test issue through that transition and watch the PRonto launch console to confirm the webhook is reaching the container.
              </p>
            </div>
          </details>
        </>
      }
    >
      <Field label="Jira base URL" required value={props.config.JIRA_BASE_URL} onChange={(value) => props.updateField("JIRA_BASE_URL", value)} error={props.errors.JIRA_BASE_URL} placeholder="https://your-site.atlassian.net" />
      <Field label="Jira user email" required value={props.config.JIRA_USER_EMAIL} onChange={(value) => props.updateField("JIRA_USER_EMAIL", value)} error={props.errors.JIRA_USER_EMAIL} placeholder="name@example.com" />
      <Field label="Jira personal access token" required value={props.config.JIRA_API_TOKEN} onChange={(value) => props.updateField("JIRA_API_TOKEN", value)} error={props.errors.JIRA_API_TOKEN} secret />
      <Field label="Webhook secret" optional value={props.config.JIRA_WEBHOOK_SECRET} onChange={(value) => props.updateField("JIRA_WEBHOOK_SECRET", value)} error={props.errors.JIRA_WEBHOOK_SECRET} secret />
      <Field label="Ready status" required value={props.config.READY_STATUS} onChange={(value) => props.updateField("READY_STATUS", value)} error={props.errors.READY_STATUS} />
      <Field label="In progress status" required value={props.config.IN_PROGRESS_STATUS} onChange={(value) => props.updateField("IN_PROGRESS_STATUS", value)} error={props.errors.IN_PROGRESS_STATUS} />
      <Field label="In review status" required value={props.config.IN_REVIEW_STATUS} onChange={(value) => props.updateField("IN_REVIEW_STATUS", value)} error={props.errors.IN_REVIEW_STATUS} />
      <ConnectionTestPanel
        buttonClassName={`primary jira-check-button ${props.jiraCheck ? (props.jiraCheck.ok ? "is-pass" : "is-fail") : ""}`}
        buttonLabel={props.isCheckingJira ? "Testing Jira..." : "Test Jira Connection"}
        onClick={props.onRunJiraCheck}
        disabled={props.isCheckingJira}
        readyLabel="✓ Jira ready"
        resultTitle="Jira test result"
        result={props.jiraCheck}
        errorHelp={props.jiraErrorHelp}
      />
    </StepLayout>
  );
}
