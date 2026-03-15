type StatusBadgeProps = {
  label: string;
  value: string;
  tone: "good" | "warn" | "neutral";
};

export function StatusBadge(props: StatusBadgeProps) {
  return (
    <div className={`status-badge ${props.tone}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}
