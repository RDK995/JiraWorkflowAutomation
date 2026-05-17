import { ConnectionTestPanel } from "../../../components/ui/ConnectionTestPanel";
import { Field } from "../../../components/ui/Field";
import { FieldGuide } from "../components/FieldGuide";
import { GuideChecklist } from "../components/GuideChecklist";
import { StepLayout } from "../components/StepLayout";
import type { AuthProvider, ReadinessCheckResponse } from "../types/api";
import type { Config, ConfigField } from "../types/config";

type IntegrationStepProps = {
  claudeAuthMode: string;
  codexAuthMode: string;
  config: Config;
  errors: Record<string, string>;
  integrationCheck: ReadinessCheckResponse | null;
  integrationDisplayLabel: string;
  integrationErrorHelp: string;
  isCheckingIntegration: boolean;
  selectedAiAgent: AuthProvider;
  onRunIntegrationCheck: () => void;
  updateAiAgent: (value: string) => void;
  updateClaudeAuthMode: (value: string) => void;
  updateCodexAuthMode: (value: string) => void;
  updateField: (field: ConfigField, value: string) => void;
};

export function IntegrationStep(props: IntegrationStepProps) {
  return (
    <StepLayout
      title="Choose AI Integration"
      description="Select which coding integration PRonto should run in automation, then configure that integration's authentication."
      asideContent={
        <>
          <GuideChecklist
            title="Integration options"
            items={[
              "Codex: device login or persisted login",
              "Claude Code: device login or persisted login"
            ]}
          />
          <FieldGuide
            items={[
              ["Integration", "Choose Codex or Claude Code for workflow implementation."],
              ["Codex auth", "Device login (recommended) or persisted login session."],
              ["Claude auth", "Device login (recommended) or persisted login session."]
            ]}
          />
        </>
      }
    >
      <label className="field">
        <span>
          AI integration
          <em className="field-required"> *</em>
        </span>
        <select value={props.selectedAiAgent} onChange={(event) => props.updateAiAgent(event.target.value)}>
          <option value="codex">Codex</option>
          <option value="claude">Claude Code</option>
        </select>
      </label>

      {props.selectedAiAgent === "codex" ? (
        <>
          <label className="field">
            <span>
              Codex authentication method
              <em className="field-required"> *</em>
            </span>
            <select value={props.codexAuthMode} onChange={(event) => props.updateCodexAuthMode(event.target.value)}>
              <option value="device">Device login</option>
              <option value="persisted">Use existing persisted login</option>
            </select>
          </label>
          {props.codexAuthMode === "device" ? (
            <div className="guide-section guide-link-card">
              <h4>What happens next</h4>
              <p className="muted">PRonto will trigger Codex device authentication when the container starts, so you can complete login interactively.</p>
            </div>
          ) : null}
          {props.codexAuthMode === "persisted" ? (
            <div className="guide-section guide-link-card">
              <h4>What happens next</h4>
              <p className="muted">PRonto will reuse the Codex session already stored in the shared container volume and skip bootstrap login.</p>
            </div>
          ) : null}
          <details className="guide-section codex-advanced">
            <summary>Advanced settings</summary>
            <Field
              label="Codex exec args"
              optional
              value={props.config.CODEX_EXEC_ARGS}
              onChange={(value) => props.updateField("CODEX_EXEC_ARGS", value)}
              error={props.errors.CODEX_EXEC_ARGS}
            />
          </details>
        </>
      ) : null}

      {props.selectedAiAgent === "claude" ? (
        <>
          <label className="field">
            <span>
              Claude authentication method
              <em className="field-required"> *</em>
            </span>
            <select value={props.claudeAuthMode} onChange={(event) => props.updateClaudeAuthMode(event.target.value)}>
              <option value="device">Device login</option>
              <option value="persisted">Use existing persisted login</option>
            </select>
          </label>
          {props.claudeAuthMode === "device" ? (
            <div className="guide-section guide-link-card">
              <h4>What happens next</h4>
              <p className="muted">PRonto will trigger Claude Code device authentication when the container starts, so you can complete login interactively.</p>
            </div>
          ) : null}
          {props.claudeAuthMode === "persisted" ? (
            <div className="guide-section guide-link-card">
              <h4>What happens next</h4>
              <p className="muted">PRonto will reuse the Claude Code session already stored in the shared container volume and skip bootstrap login.</p>
            </div>
          ) : null}
          <details className="guide-section codex-advanced">
            <summary>Advanced settings</summary>
            <Field
              label="Claude exec args"
              optional
              value={props.config.CLAUDE_EXEC_ARGS}
              onChange={(value) => props.updateField("CLAUDE_EXEC_ARGS", value)}
              error={props.errors.CLAUDE_EXEC_ARGS}
            />
          </details>
        </>
      ) : null}
      <ConnectionTestPanel
        buttonClassName={`primary github-check-button ${props.integrationCheck ? (props.integrationCheck.ok ? "is-pass" : "is-fail") : ""}`}
        buttonLabel={props.isCheckingIntegration ? `Testing ${props.integrationDisplayLabel}...` : `Test ${props.integrationDisplayLabel} Access`}
        onClick={props.onRunIntegrationCheck}
        disabled={props.isCheckingIntegration}
        readyLabel={`✓ ${props.integrationDisplayLabel} ready`}
        resultTitle="Integration test result"
        result={props.integrationCheck}
        errorHelp={props.integrationErrorHelp}
      />
    </StepLayout>
  );
}
