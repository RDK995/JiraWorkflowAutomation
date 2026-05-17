import { ConnectionTestPanel } from "../../../components/ui/ConnectionTestPanel";
import { Field } from "../../../components/ui/Field";
import { Toggle } from "../../../components/ui/Toggle";
import { FieldGuide } from "../components/FieldGuide";
import { GuideChecklist } from "../components/GuideChecklist";
import { GuideLinkCard } from "../components/GuideLinkCard";
import { StepLayout } from "../components/StepLayout";
import type { ReadinessCheckResponse } from "../types/api";
import type { Config, ConfigField } from "../types/config";

type NgrokStepProps = {
  config: Config;
  errors: Record<string, string>;
  isCheckingNgrok: boolean;
  ngrokCheck: ReadinessCheckResponse | null;
  ngrokErrorHelp: string;
  onRunNgrokCheck: () => void;
  updateField: (field: ConfigField, value: string) => void;
};

export function NgrokStep(props: NgrokStepProps) {
  return (
    <StepLayout
      title="Public Webhook Access"
      description="Enable this only if you want PRonto to expose the local webhook through ngrok."
      asideContent={
        <>
          <GuideChecklist title="Optional capability" items={["Create an ngrok account", "Add your authtoken", "Optionally reserve a domain", "Use the generated URL in Jira"]} />
          <GuideLinkCard
            title="Open ngrok dashboard"
            description="Use the ngrok dashboard to copy your authtoken, create an API key, and optionally reserve a static domain."
            href="https://dashboard.ngrok.com/"
            linkLabel="Open ngrok dashboard"
          />
          <FieldGuide
            items={[
              ["Authtoken", "Required for public webhook access. Copy it from the Getting Started section of your ngrok dashboard."],
              ["API key", "Needed only if you want PRonto to verify or auto-provision a reserved domain."],
              ["Reserved domain", "Optional. Leave blank for an ephemeral URL, or enter your reserved ngrok domain if you want a stable webhook URL."],
              ["Webhook path", <code>/webhooks/jira-transition</code>]
            ]}
          />
          <details className="guide-section codex-advanced">
            <summary>Additional information</summary>
            <div className="guide-stack">
              <p className="muted">
                Use these docs if you need the full ngrok setup flow, help with reserved domains, or a refresher on where to find your credentials.
              </p>
              <ul className="plain-list guide-checklist">
                <li>
                  <a href="https://ngrok.com/docs/getting-started/" target="_blank" rel="noreferrer">
                    ngrok getting started
                  </a>
                </li>
                <li>
                  <a href="https://dashboard.ngrok.com/api-keys" target="_blank" rel="noreferrer">
                    Create or manage ngrok API keys
                  </a>
                </li>
                <li>
                  <a href="https://ngrok.com/docs/universal-gateway/domains/" target="_blank" rel="noreferrer">
                    Reserved domains and static URLs
                  </a>
                </li>
                <li>
                  <a href="https://ngrok.com/docs/agent/" target="_blank" rel="noreferrer">
                    ngrok agent and authtoken docs
                  </a>
                </li>
                <li>
                  <a href="https://ngrok.com/docs/api/" target="_blank" rel="noreferrer">
                    ngrok API docs
                  </a>
                </li>
              </ul>
              <h4>Authtoken</h4>
              <ol className="plain-list ordered">
                <li>Create or sign in to your ngrok account.</li>
                <li>Copy your authtoken from the dashboard and paste it here.</li>
              </ol>
              <h4>API key</h4>
              <ol className="plain-list ordered">
                <li>Sign in to ngrok.</li>
                <li>Open the dashboard API page.</li>
                <li>Create a new API key.</li>
                <li>Copy it and store it safely.</li>
              </ol>
              <h4>Reserved domain</h4>
              <ol className="plain-list ordered">
                <li>Sign in to your ngrok dashboard.</li>
                <li>Open Domains in the dashboard.</li>
                <li>Click New Domain or + New.</li>
                <li>Copy the domain name.</li>
              </ol>
              <h4>Finish setup</h4>
              <ol className="plain-list ordered">
                <li>Turn on public access if you want Jira to reach PRonto from the internet.</li>
                <li>
                  Run <strong>Test Public Access</strong> before launch when ngrok is enabled.
                </li>
                <li>
                  After launch, use the ngrok URL plus <code>/webhooks/jira-transition</code> in Jira.
                </li>
              </ol>
              <p className="muted">
                If you leave the reserved domain blank, PRonto will use an ephemeral ngrok URL. You can copy that live URL from the launch logs and then paste it into Jira.
              </p>
            </div>
          </details>
        </>
      }
    >
      <Toggle label="Enable ngrok in container" optional value={props.config.NGROK_ENABLE} onChange={(value) => props.updateField("NGROK_ENABLE", value)} error={props.errors.NGROK_ENABLE} />
      <Field label="ngrok authtoken" optional value={props.config.NGROK_AUTHTOKEN} onChange={(value) => props.updateField("NGROK_AUTHTOKEN", value)} error={props.errors.NGROK_AUTHTOKEN} secret />
      <Field label="ngrok API key" optional value={props.config.NGROK_API_KEY} onChange={(value) => props.updateField("NGROK_API_KEY", value)} error={props.errors.NGROK_API_KEY} secret />
      <Field label="ngrok reserved domain" optional value={props.config.NGROK_DOMAIN} onChange={(value) => props.updateField("NGROK_DOMAIN", value)} error={props.errors.NGROK_DOMAIN} placeholder="your-domain.ngrok-free.app" />
      <ConnectionTestPanel
        buttonClassName={`primary github-check-button ${props.ngrokCheck ? (props.ngrokCheck.ok ? "is-pass" : "is-fail") : ""}`}
        buttonLabel={props.isCheckingNgrok ? "Testing ngrok..." : "Test Public Access"}
        onClick={props.onRunNgrokCheck}
        disabled={props.isCheckingNgrok}
        readyLabel="✓ ngrok ready"
        resultTitle="ngrok test result"
        result={props.ngrokCheck}
        errorHelp={props.ngrokErrorHelp}
      />
    </StepLayout>
  );
}
