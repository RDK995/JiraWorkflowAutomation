type GuideChecklistProps = {
  title: string;
  items: string[];
};

export function GuideChecklist(props: GuideChecklistProps) {
  return (
    <div className="guide-section">
      <h4>{props.title}</h4>
      <ul className="plain-list guide-checklist">
        {props.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
