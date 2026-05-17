import { ConnectionTestPanel } from "../../../components/ui/ConnectionTestPanel";
import { Field } from "../../../components/ui/Field";
import { Toggle } from "../../../components/ui/Toggle";
import { FieldGuide } from "../components/FieldGuide";
import { GuideChecklist } from "../components/GuideChecklist";
import { GuideLinkCard } from "../components/GuideLinkCard";
import { StepLayout } from "../components/StepLayout";
import type { ReadinessCheckResponse } from "../types/api";
import type { Config, ConfigField } from "../types/config";

type GitHubStepProps = {
  config: Config;
  errors: Record<string, string>;
  gitHubCheck: ReadinessCheckResponse | null;
  gitHubErrorHelp: string;
  isCheckingGitHub: boolean;
  onRunGitHubCheck: () => void;
  updateField: (field: ConfigField, value: string) => void;
};

export function GitHubStep(props: GitHubStepProps) {
  return (
    <StepLayout
      title="Connect GitHub"
      description="Give PRonto the GitHub access it needs to clone repositories, push branches, and open pull requests automatically."
      asideContent={
        <>
          <GuideChecklist title="Need these values" items={["GitHub personal access token", "Target base branch"]} />
          <GuideLinkCard
            title="Create GitHub token"
            description="Use a token with repository contents read/write and pull request read/write access."
            href="https://github.com/settings/tokens"
            linkLabel="Open GitHub token settings"
          />
          <FieldGuide
            items={[
              ["GitHub token", "Your main token for clone, push, and PR creation"],
              ["Base branch", <>The branch new pull requests should target, usually <code>main</code>.</>]
            ]}
          />
        </>
      }
    >
      <Toggle label="Require GitHub authentication" required value={props.config.REQUIRE_GITHUB_AUTH} onChange={(value) => props.updateField("REQUIRE_GITHUB_AUTH", value)} error={props.errors.REQUIRE_GITHUB_AUTH} />
      <Field label="GitHub token" required value={props.config.GITHUB_TOKEN} onChange={(value) => props.updateField("GITHUB_TOKEN", value)} error={props.errors.GITHUB_TOKEN} secret />
      <Field label="Base branch" required value={props.config.WORKFLOW_BASE_BRANCH} onChange={(value) => props.updateField("WORKFLOW_BASE_BRANCH", value)} error={props.errors.WORKFLOW_BASE_BRANCH} placeholder="main" />
      <ConnectionTestPanel
        buttonClassName={`primary github-check-button ${props.gitHubCheck ? (props.gitHubCheck.ok ? "is-pass" : "is-fail") : ""}`}
        buttonLabel={props.isCheckingGitHub ? "Testing GitHub..." : "Test GitHub Access"}
        onClick={props.onRunGitHubCheck}
        disabled={props.isCheckingGitHub}
        readyLabel="✓ GitHub ready"
        resultTitle="GitHub test result"
        result={props.gitHubCheck}
        errorHelp={props.gitHubErrorHelp}
      />
    </StepLayout>
  );
}
