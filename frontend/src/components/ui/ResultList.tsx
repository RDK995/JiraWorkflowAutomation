import type { ReadinessCheckResponse } from "../../features/setup-wizard/types/api";

type ResultListProps = {
  result: ReadinessCheckResponse | null;
  emptyMessage?: string;
};

export function ResultList(props: ResultListProps) {
  if (!props.result) {
    return props.emptyMessage ? <p className="muted">{props.emptyMessage}</p> : null;
  }

  return (
    <ul className="plain-list">
      {props.result.checks.map((check) => (
        <li key={check.command} className={check.ok ? "result-pass" : "result-fail"}>
          <strong>{check.ok ? "✓" : "✕"} {check.command}</strong>
          <span>{check.output}</span>
        </li>
      ))}
    </ul>
  );
}
