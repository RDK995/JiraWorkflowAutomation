type ToggleProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  optional?: boolean;
};

export function Toggle(props: ToggleProps) {
  return (
    <label className="field toggle">
      <span>
        {props.label}
        {props.required ? <em className="field-required"> *</em> : null}
        {props.optional ? <em className="field-optional"> Optional</em> : null}
      </span>
      <select value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
      {props.error ? <small>{props.error}</small> : null}
    </label>
  );
}
