import { useState } from "react";
import {
  Check,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  LockKeyhole,
  RotateCcw,
  Save,
  Settings2,
  Terminal,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  defaults,
  deploymentSchema,
  nonSensitiveConfig,
  osOnlyConfig,
  randomName,
  randomPassword,
  type DeploymentConfig,
} from "@shared/deployment";
import { postInstallScript } from "@shared/installer";
import {
  AppSelector,
  CheckOption,
  Field,
  RandomizeButton,
  Toggle,
} from "@/components/DeploymentControls";
import InstallerPackage from "@/components/InstallerPackage";
const draftKey = "win11desk-draft-v2";
function initialConfig(): DeploymentConfig {
  try {
    const s = localStorage.getItem(draftKey);
    if (s) {
      const r = deploymentSchema.safeParse({
        ...defaults,
        ...JSON.parse(s),
        os: defaults.os,
        password: "",
        preConfirmed: false,
        initScript: true,
      });
      if (r.success) return r.data;
    }
  } catch {}
  return { ...defaults, initScript: true };
}
export default function Home() {
  const [config, setConfig] = useState(initialConfig),
    [showPassword, setShowPassword] = useState(false),
    [extras, setExtras] = useState(false),
    [help, setHelp] = useState(false),
    [resetCount, setResetCount] = useState(0),
    [saved, setSaved] = useState(false);
  const valid = deploymentSchema.safeParse(config);
  const installConfig = osOnlyConfig(config);
  const installValid = deploymentSchema.safeParse(installConfig);
  const errors: Record<string, string> = {};
  if (!valid.success)
    for (const e of valid.error.issues) errors[String(e.path[0])] ??= e.message;
  function update<K extends keyof DeploymentConfig>(
    key: K,
    value: DeploymentConfig[K]
  ) {
    setConfig(c => ({ ...c, [key]: value }));
    setSaved(false);
  }
  function randomUser() {
    setConfig(c => ({ ...c, username: randomName(), randomUsername: true }));
    setSaved(false);
  }
  function reset() {
    setConfig({ ...defaults, initScript: true });
    setShowPassword(false);
    setSaved(false);
    setResetCount(x => x + 1);
    try {
      localStorage.removeItem(draftKey);
      localStorage.removeItem("win11desk-iso-v2");
      localStorage.removeItem("win11desk-iso-v3-direct");
    } catch {}
    toast.success("Default settings restored.");
  }
  function save() {
    if (!valid.success) return;
    try {
      const { preConfirmed: _, ...safe } = nonSensitiveConfig(config);
      localStorage.setItem(draftKey, JSON.stringify(safe));
      setSaved(true);
      toast.success("Preferences saved. Password not saved.");
    } catch {
      toast.error("Browser storage is unavailable.");
    }
  }
  function downloadSettings() {
    if (!valid.success) return;
    const u = URL.createObjectURL(
      new Blob([postInstallScript(config)], { type: "text/plain" })
    );
    const a = document.createElement("a");
    a.href = u;
    a.download = "win11pro-settings.ps1";
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  }
  return (
    <div className="app-frame">
      <header className="topbar">
        <a href="#" className="brand" aria-label="Win11Desk home">
          <span className="brand-mark">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            win11<span className="brand-light">desk</span>
            <span className="brand-dot">.</span>
          </span>
        </a>
        <span className="header-tag">VPS INSTALLER</span>
        <button className="text-button" onClick={() => setHelp(true)}>
          How it works
        </button>
      </header>
      <main className="workspace">
        <div className="page-heading">
          <div>
            <p className="eyebrow">
              <span className="status-dot" />
              WINDOWS 11 PRO ONLY
            </p>
            <h1>
              Your Windows.
              <br />
              Your settings.
            </h1>
            <p>Configure once. Copy the script. Install over SSH.</p>
          </div>
          <div className="page-actions">
            <button
              className="icon-button"
              onClick={reset}
              aria-label="Reset settings"
              title="Reset settings"
            >
              <RotateCcw size={17} />
            </button>
            <button
              className="secondary-button"
              onClick={save}
              disabled={!valid.success}
            >
              <Save size={14} />
              {saved ? "Saved" : "Save preferences"}
            </button>
          </div>
        </div>
        <section className="configuration-card" id="configuration">
          <div className="card-header">
            <div className="card-title">
              <img src="/icons/windows.svg" alt="" />
              <div>
                <h2>Windows 11 Pro</h2>
                <span>x64 · automatic VPS detection</span>
              </div>
            </div>
            <span className="profile-pill">
              <span className="status-dot" />
              Ready to configure
            </span>
          </div>
          <div className="deployment-form">
            <Field label="Remote port" htmlFor="remote-port">
              <div className="input-with-addon">
                <input
                  id="remote-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={
                    Number.isNaN(config.remotePort) ? "" : config.remotePort
                  }
                  onChange={e =>
                    update(
                      "remotePort",
                      e.target.value === "" ? NaN : Number(e.target.value)
                    )
                  }
                  aria-invalid={!!errors.remotePort}
                />
                <span>RDP / TCP</span>
              </div>
              {errors.remotePort && (
                <p className="field-error">{errors.remotePort}</p>
              )}
            </Field>
            <Field label="Username" htmlFor="username">
              <div className="username-row">
                <label className="random-control">
                  Random
                  <Toggle
                    label="Random username"
                    checked={config.randomUsername}
                    onChange={v =>
                      v ? randomUser() : update("randomUsername", false)
                    }
                  />
                </label>
                <div className="input-with-addon">
                  <input
                    id="username"
                    autoComplete="off"
                    value={config.username}
                    maxLength={20}
                    disabled={config.randomUsername}
                    onChange={e => update("username", e.target.value)}
                    aria-invalid={!!errors.username}
                  />
                  <RandomizeButton
                    onClick={randomUser}
                    label="Generate random username"
                  />
                </div>
              </div>
              {errors.username && (
                <p className="field-error">{errors.username}</p>
              )}
            </Field>
            <Field label="Password" htmlFor="password">
              <div className="input-with-addon">
                <LockKeyhole size={15} className="input-leading" />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="At least 12 characters"
                  maxLength={128}
                  value={config.password}
                  onChange={e => update("password", e.target.value)}
                />
                <button
                  className="icon-button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
                <RandomizeButton
                  onClick={() => update("password", randomPassword())}
                  label="Generate secure password"
                />
              </div>
            </Field>
            <Field label="Command options">
              <div className="command-options">
                <span className="fixed-choice">
                  <Check size={13} />
                  Windows 11 Pro selected
                </span>
                <CheckOption
                  label="Init script"
                  checked={config.initScript}
                  onChange={v => update("initScript", v)}
                />
              </div>
              {config.initScript && (
                <div className="context-field">
                  <label htmlFor="retries">Download attempts</label>
                  <input
                    id="retries"
                    type="number"
                    min={1}
                    max={20}
                    value={config.retries}
                    onChange={e => update("retries", Number(e.target.value))}
                  />
                  {errors.retries && (
                    <p className="field-error">Choose 1–20 attempts.</p>
                  )}
                </div>
              )}
            </Field>
            <InstallerPackage
              key={resetCount}
              config={installConfig}
              valid={installValid.success}
            />
            <div className="advanced-wrapper">
              <button
                className={`advanced-toggle ${extras ? "expanded" : ""}`}
                aria-expanded={extras}
                onClick={() => setExtras(!extras)}
              >
                <span>
                  <Settings2 size={15} />
                  Optional Windows extras
                </span>
                <ChevronDown size={16} />
              </button>
              {extras && (
                <div className="advanced-fields">
                  <p className="field-hint extras-note">
                    Run this separate settings script after Windows
                    installation. These extras are not part of the OS installer.
                  </p>
                  <Field label="Applications">
                    <AppSelector
                      value={config.apps}
                      onChange={v => update("apps", v)}
                    />
                  </Field>
                  <Field label="Get file" htmlFor="file-url">
                    <input
                      id="file-url"
                      type="url"
                      value={config.fileUrl}
                      placeholder="Direct HTTPS .zip or .iso file"
                      onChange={e => update("fileUrl", e.target.value)}
                    />
                    {errors.fileUrl && (
                      <p className="field-error">{errors.fileUrl}</p>
                    )}
                  </Field>
                  <Field label="Windows name" htmlFor="hostname">
                    <input
                      id="hostname"
                      value={config.hostname}
                      placeholder="Optional computer name"
                      onChange={e => update("hostname", e.target.value)}
                    />
                    {errors.hostname && (
                      <p className="field-error">{errors.hostname}</p>
                    )}
                  </Field>
                  <Field label="Time zone" htmlFor="timezone">
                    <select
                      id="timezone"
                      value={config.timezone}
                      onChange={e =>
                        update(
                          "timezone",
                          e.target.value as DeploymentConfig["timezone"]
                        )
                      }
                    >
                      <option value="UTC">UTC</option>
                      <option value="India Standard Time">
                        India Standard Time
                      </option>
                      <option value="Pacific Standard Time">
                        Pacific Standard Time
                      </option>
                      <option value="GMT Standard Time">
                        GMT Standard Time
                      </option>
                    </select>
                  </Field>
                  <button
                    className="secondary-button"
                    onClick={downloadSettings}
                    disabled={!valid.success}
                  >
                    <Download size={14} />
                    Download Windows settings
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>
        <footer className="page-footer">
          <span>
            OS deployment only. No activation or Windows license included.
          </span>
          <a href="/api/installer/license" target="_blank" rel="noreferrer">
            GPL v3
          </a>
        </footer>
      </main>
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section
            className="help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onClick={e => e.stopPropagation()}
          >
            <button
              className="icon-button modal-close"
              onClick={() => setHelp(false)}
              aria-label="Close guide"
            >
              <X size={18} />
            </button>
            <Terminal size={24} />
            <h2 id="help-title">Copy. SSH. Windows.</h2>
            <p>
              Set your username, password and Remote Desktop port. Keep the
              default direct ISO or change its link. Generate and copy the
              script, log into your Linux VPS as root and paste it.
            </p>
            <p>
              The script automatically detects the system disk and hostname. It
              checks hardware, verifies media, replaces the system disk and
              reboots without terminal prompts. Pasting authorizes erasure and
              reboot. Back up your VPS and keep provider console access. Windows
              11 requires compatible virtualization; upstream bypasses some
              hardware checks and needs Secure Boot disabled.
            </p>
            <p>
              Connect using Remote Desktop to your VPS IP and chosen port after
              Windows boots. Keep generated scripts private: they carry your
              initial credentials. The page is currently temporary Preview
              hosting.
            </p>
            <button className="primary-button" onClick={() => setHelp(false)}>
              Got it
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
