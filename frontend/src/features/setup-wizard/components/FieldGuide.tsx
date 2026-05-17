import type { ReactNode } from "react";

type FieldGuideProps = {
  items: Array<[string, ReactNode]>;
};

export function FieldGuide(props: FieldGuideProps) {
  return (
    <div className="guide-section">
      <h4>Field guide</h4>
      <dl className="mini-guide-list">
        {props.items.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
