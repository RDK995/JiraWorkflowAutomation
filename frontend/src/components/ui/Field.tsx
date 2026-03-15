type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
  secret?: boolean;
  required?: boolean;
  optional?: boolean;
};

export function Field(props: FieldProps) {
  return (
    <label className="field">
      <span>
        {props.label}
        {props.required ? <em className="field-required"> *</em> : null}
        {props.optional ? <em className="field-optional"> Optional</em> : null}
      </span>
      <input type={props.secret ? "password" : "text"} value={props.value} placeholder={props.placeholder} onChange={(event) => props.onChange(event.target.value)} />
      {props.error ? <small>{props.error}</small> : null}
    </label>
  );
}
