/** A choice of the new-game form as radio buttons, one per name (values without a name are not offered), boxed like the dojo's 設定. */
export function RadioGroup<T extends string>({
  label,
  name,
  value,
  names,
  onChange,
}: {
  label: string;
  name: string;
  value: T;
  names: Partial<Record<T, string>>;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset class="dojo-settings-group option-group">
      <legend>{label}</legend>
      {(Object.keys(names) as T[]).map((k) => (
        <label key={k}>
          <input type="radio" name={name} value={k} checked={value === k} onChange={() => onChange(k)} />
          {names[k]}
        </label>
      ))}
    </fieldset>
  );
}
