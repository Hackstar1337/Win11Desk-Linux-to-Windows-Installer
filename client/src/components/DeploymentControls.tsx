import type { ReactNode } from "react";
import { Check, Shuffle } from "lucide-react";
import { appChoices, type AppChoice } from "@shared/deployment";

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="form-row">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      <div className="field-body">
        {children}
        {hint && <p className="field-hint">{hint}</p>}
      </div>
    </div>
  );
}
export function Toggle({
  checked,
  onChange,
  label,
  id,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`toggle ${checked ? "is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
export function CheckOption({
  label,
  checked,
  onChange,
  hint,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="check-option">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
      />
      <span>{label}</span>
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function AppSelector({
  value,
  onChange,
}: {
  value: AppChoice[];
  onChange: (apps: AppChoice[]) => void;
}) {
  const names: Record<AppChoice, string> = {
    chrome: "Chrome",
    firefox: "Firefox",
    edge: "Edge",
    brave: "Brave",
    "7zip": "7-Zip",
  };
  return (
    <div className="app-selectors" aria-label="Optional applications">
      {appChoices.map(app => (
        <button
          key={app}
          type="button"
          className={`app-choice ${value.includes(app) ? "selected" : ""}`}
          aria-pressed={value.includes(app)}
          aria-label={`Select ${names[app]}`}
          onClick={() =>
            onChange(
              value.includes(app)
                ? value.filter(a => a !== app)
                : [...value, app]
            )
          }
        >
          {app === "7zip" ? (
            <span className="sevenzip">
              7<span>zip</span>
            </span>
          ) : (
            <img src={`/icons/${app}.svg`} alt="" />
          )}
          <span className="app-name">{names[app]}</span>
          {value.includes(app) && <Check size={11} className="app-check" />}
        </button>
      ))}
    </div>
  );
}
export function RandomizeButton({
  onClick,
  label = "Generate",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      className="icon-button"
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <Shuffle size={16} />
    </button>
  );
}
