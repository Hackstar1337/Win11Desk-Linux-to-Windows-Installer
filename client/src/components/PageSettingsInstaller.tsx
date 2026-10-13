import { useEffect, useState } from "react";
import { Copy, Download, Terminal } from "lucide-react";
import { toast } from "sonner";
import type { DeploymentConfig } from "@shared/deployment";
import type { InstallTarget } from "@shared/installer";
import { reusableSettings } from "@shared/reusableInstaller";
export default function PageSettingsInstaller({
  config,
  target,
  ready,
}: {
  config: DeploymentConfig;
  target: InstallTarget;
  ready: boolean;
}) {
  const [output, setOutput] = useState<{
    command: string;
    expiresAt: string;
    snapshot: string;
    trackingUrl: string;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [now, setNow] = useState(Date.now());
  let settings: ReturnType<typeof reusableSettings> | null = null;
  try {
    settings = reusableSettings(config, target);
  } catch {}
  const snapshot = JSON.stringify({ settings, password: config.password });
  const usable =
    !!output &&
    output.snapshot === snapshot &&
    Date.parse(output.expiresAt) > now &&
    ready;
  useEffect(() => {
    if (!output) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [output]);
  async function generate() {
    setBusy(true);
    setError("");
    setOutput(null);
    try {
      const r = await fetch("/api/installer/page-command", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Win11Desk-Request": "1",
        },
        body: JSON.stringify({
          input: { settings, password: config.password },
          origin: window.location.origin,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Could not generate script.");
      setOutput({ ...data, snapshot });
      setNow(Date.now());
      try {
        const old = JSON.parse(
          localStorage.getItem("win11desk-trackers") || "[]"
        );
        localStorage.setItem(
          "win11desk-trackers",
          JSON.stringify(
            [
              { url: data.trackingUrl, createdAt: new Date().toISOString() },
              ...(Array.isArray(old) ? old : []),
            ].slice(0, 20)
          )
        );
      } catch {}
      toast.success("Automatic script ready. Private tracker link saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (!usable || !output) return;
    try {
      await navigator.clipboard.writeText(output.command);
      toast.success(
        "Copied. Paste only in the intended disposable/backed-up VPS root SSH."
      );
    } catch {
      toast.error("Select the script text to copy.");
    }
  }
  function download() {
    if (!usable || !output) return;
    const url = URL.createObjectURL(
      new Blob([output.command], { type: "text/plain" })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "win11desk-auto-install.sh";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section
      className="compact-command"
      aria-label="Install using page settings"
    >
      <div className="command-heading">
        <span>
          <Terminal size={16} /> Installation command
        </span>
        <span className="tiny-badge">Automatic · Linux → Windows 11 Pro</span>
      </div>
      <p className="command-intro">
        Paste once in root SSH. Checks, installation and reboot run
        automatically—no terminal questions.
      </p>
      <p className="field-error">
        Pasting authorizes erasing every partition on the detected VPS system
        disk and rebooting. Use only a backed-up or disposable compatible VPS.
      </p>
      <div className="command-actions">
        <button
          className="primary-button"
          onClick={generate}
          disabled={!ready || !settings || config.password.length < 8 || busy}
        >
          {busy ? "Generating…" : "Generate automatic script"}
        </button>
        {output && (
          <>
            <button
              className="secondary-button"
              onClick={copy}
              disabled={!usable || busy}
            >
              <Copy size={14} />
              Copy script
            </button>
            <button
              className="icon-button"
              onClick={download}
              disabled={!usable || busy}
              aria-label="Download automatic script"
            >
              <Download size={16} />
            </button>
          </>
        )}
      </div>
      {output?.trackingUrl && (
        <p className="tracker-link">
          <a href={output.trackingUrl} target="_blank" rel="noreferrer">
            Track this installation →
          </a>
          <span>
            Private link · each VPS execution appears as a separate run
          </span>
        </p>
      )}
      <details className="tracker-history">
        <summary>Recent installation trackers on this browser</summary>
        <TrackerHistory />
      </details>
      {config.password.length < 8 && (
        <p className="field-hint">
          Enter a password of at least 8 characters to generate.
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {output && !usable && (
        <p className="field-error">
          Settings changed or script expired. Generate again.
        </p>
      )}
      <div className="code-shell">
        <div className="code-caption">
          <span className="terminal-dots">
            <i />
            <i />
            <i />
          </span>
          <span>root@your-vps</span>
          <span className="code-badge">BASH</span>
        </div>
        <pre>
          <code>
            {usable && output
              ? output.command
              : "# Your automatic installation script appears here.\n# Set your password, then click Generate automatic script."}
          </code>
        </pre>
      </div>
      <p className="command-note">
        Private script · paste within 30 minutes · automatic disk erasure and
        reboot · tracker needs this website online. Windows first-login privacy
        settings remain yours.
      </p>
    </section>
  );
}
function TrackerHistory() {
  try {
    const entries = JSON.parse(
      localStorage.getItem("win11desk-trackers") || "[]"
    );
    if (!Array.isArray(entries) || !entries.length)
      return <p>No tracked scripts generated in this browser yet.</p>;
    return (
      <ul>
        {entries
          .filter(
            x =>
              typeof x?.url === "string" &&
              x.url.startsWith(window.location.origin + "/track/")
          )
          .map((x, i) => (
            <li key={x.url}>
              <a href={x.url} target="_blank" rel="noreferrer">
                Tracker {i + 1} — {new Date(x.createdAt).toLocaleString()}
              </a>
            </li>
          ))}
      </ul>
    );
  } catch {
    return <p>Tracking history unavailable.</p>;
  }
}
