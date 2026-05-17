type GuideLinkCardProps = {
  title: string;
  description: string;
  href: string;
  linkLabel: string;
};

export function GuideLinkCard(props: GuideLinkCardProps) {
  return (
    <div className="guide-section guide-link-card">
      <h4>{props.title}</h4>
      <p className="muted">{props.description}</p>
      <a href={props.href} target="_blank" rel="noreferrer">
        {props.linkLabel}
      </a>
    </div>
  );
}
