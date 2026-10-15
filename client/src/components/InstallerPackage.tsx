import { useState } from "react";
import type { DeploymentConfig } from "@shared/deployment";
import { installerIssues, installTargetSchema } from "@shared/installer";
import { automaticTarget, defaultIsoUrl } from "@shared/media";
import { mediaExpiry } from "@shared/reusableInstaller";
import { Field } from "./DeploymentControls";
import PageSettingsInstaller from "./PageSettingsInstaller";
const mediaKey = "win11desk-iso-v3-direct";
function initialIso() {
  try {
    return localStorage.getItem(mediaKey) || defaultIsoUrl;
  } catch {
    return defaultIsoUrl;
  }
}
export default function InstallerPackage({
  config,
  valid,
}: {
  config: DeploymentConfig;
  valid: boolean;
}) {
  const [isoUrl, setIsoUrl] = useState(initialIso);
  const target = automaticTarget(isoUrl);
  const issues = installerIssues(config, target);
  const mediaValid = installTargetSchema.safeParse(target).success;
  const expiry = mediaExpiry(isoUrl);
  const expired = expiry !== null && expiry <= Date.now();
  function change(value: string) {
    setIsoUrl(value);
    try {
      localStorage.setItem(mediaKey, value);
    } catch {}
  }
  return (
    <div className="simple-install" id="command">
      <Field label="Windows ISO" htmlFor="iso-url">
        <input
          id="iso-url"
          type="url"
          value={isoUrl}
          onChange={e => change(e.target.value)}
          placeholder="Direct HTTPS Windows ISO link"
          aria-invalid={!mediaValid}
        />
        <div className="source-meta">
          <span>Windows 11 Pro · x64</span>
          <button
            type="button"
            onClick={() => change("")}
            className="text-button"
          >
            Clear ISO URL
          </button>
        </div>
        <p className="helper-text">
          Your VPS downloads directly from this link. Change it if needed; no
          alternate source is used. ISO integrity is checked automatically.
        </p>
        {expired && (
          <p className="field-error">
            This download link expired. Change the ISO source.
          </p>
        )}
        {!mediaValid && (
          <p className="field-error">Enter a valid HTTPS ISO link.</p>
        )}
      </Field>
      {mediaValid && valid && issues.length > 0 && (
        <p className="field-error">{issues[0]}</p>
      )}
      <PageSettingsInstaller
        config={config}
        target={target}
        ready={valid && issues.length === 0 && !expired}
      />
    </div>
  );
}
