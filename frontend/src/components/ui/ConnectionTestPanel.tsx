import type { ReadinessCheckResponse } from "../../features/setup-wizard/types/api";
import { ResultList } from "./ResultList";

type ConnectionTestPanelProps = {
  buttonClassName?: string;
  buttonLabel?: string;
  onClick?: () => void;
  disabled?: boolean;
  hideButton?: boolean;
  pendingLabel?: string;
  readyLabel: string;
  resultTitle: string;
  result: ReadinessCheckResponse | null;
  errorHelp?: string;
};

export function ConnectionTestPanel(props: ConnectionTestPanelProps) {
  return (
    <div className="check-block">
      <div className="action-row">
        {!props.hideButton ? (
          <button className={props.buttonClassName} onClick={props.onClick} disabled={props.disabled} type="button">
            {props.buttonLabel}
          </button>
        ) : null}
        {props.result?.ok ? <span className="check-pass">{props.readyLabel}</span> : null}
        {!props.result?.ok && props.pendingLabel ? <span className="check-pending">{props.pendingLabel}</span> : null}
      </div>
      {props.result ? (
        <div className="activity-card">
          <h4>{props.resultTitle}</h4>
          <ResultList result={props.result} />
        </div>
      ) : null}
      {props.errorHelp ? (
        <div className="guide-section guide-error-help">
          <h4>What this usually means</h4>
          <p>{props.errorHelp}</p>
        </div>
      ) : null}
    </div>
  );
}
