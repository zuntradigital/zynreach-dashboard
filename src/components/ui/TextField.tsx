import { useId } from "react";

interface TextFieldProps {
  label: string;
  name: string;
  type?: "text" | "email" | "password";
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  autoComplete?: string;
  autoFocus?: boolean;
  inputMode?: "text" | "numeric";
  maxLength?: number;
  disabled?: boolean;
  dir?: "ltr" | "rtl";
  /** Wires an HTML5 <datalist> id for input suggestions (e.g. existing category names) without forcing the value to match one. */
  list?: string;
}

export function TextField({
  label,
  name,
  type = "text",
  value,
  onChange,
  error,
  required,
  autoComplete,
  autoFocus,
  inputMode,
  maxLength,
  disabled,
  dir,
  list,
}: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-neutral-700">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        inputMode={inputMode}
        maxLength={maxLength}
        disabled={disabled}
        dir={dir}
        list={list}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={`mt-1.5 block min-h-11 w-full rounded-md border bg-surface px-3 text-sm text-neutral-900 focus-visible:outline-none disabled:bg-neutral-50 disabled:text-neutral-500 ${
          error ? "border-error" : "border-neutral-300 focus-visible:border-primary-600"
        }`}
      />
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
