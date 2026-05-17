import type { ReactNode } from "react";

type StepLayoutProps = {
  title: string;
  description: string;
  children: ReactNode;
  asideContent?: ReactNode;
  asideClassName?: string;
};

export function StepLayout(props: StepLayoutProps) {
  return (
    <div className="two-column">
      <div className="step-main-card">
        <h3>{props.title}</h3>
        <p className="muted">{props.description}</p>
        <div className="form-grid">{props.children}</div>
      </div>
      <div className={props.asideClassName || "guide-card"}>{props.asideContent ? <div className="guide-extra">{props.asideContent}</div> : null}</div>
    </div>
  );
}
