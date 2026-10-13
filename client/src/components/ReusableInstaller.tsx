import { useState } from "react";
import { Copy, Terminal } from "lucide-react";
import { toast } from "sonner";
import type { DeploymentConfig } from "@shared/deployment";
import type { InstallTarget } from "@shared/installer";
import { reusableSettings } from "@shared/reusableInstaller";

export default function ReusableInstaller({
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
    fingerprint: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  let settings: ReturnType<typeof reusableSettings> | null = null;
  try {
    settings = reusableSettings(config, target);
  } catch {}
  const fingerprint = JSON.stringify(settings);
  const current = !!output && output.fingerprint === fingerprint && ready;
  async function generate() {
    setBusy(true);
    setError("");
    setOutput(null);
    try {
      const res = await fetch("/api/installer/reusable-command", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Win11Desk-Request": "1",
        },
        body: JSON.stringify({ settings, origin: window.location.origin }),
      });
      const result = await res.json();
      if (!res.ok)
        throw new Error(result.error || "Unable to generate command.");
      setOutput({ command: result.command, fingerprint });
      toast.success(
        "Reusable command ready. Password will be requested privately in SSH."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (!current || !output) return;
    try {
      await navigator.clipboard.writeText(output.command);
      toast.success("Copied. Run in root SSH on each intended VPS.");
    } catch {
      toast.error("Select the command text to copy.");
    }
  }
  return (
    <section className="one-command-panel" aria-label="Reusable VPS installer">
      <div className="section-heading">
        <div>
          <p className="eyebrow">REUSABLE / NO SIGN-IN NEEDED</p>
          <h2>One script. Every compatible VPS.</h2>
        </div>
        <Terminal size={20} />
      </div>
      <p className="section-description">
        Generate once and paste in each Linux VPS's root SSH session. With
        hostname and disk set to <code>auto</code>, every run detects its own
        target. Set a fresh password privately in SSH; this mode does not use or
        send the page password.
      </p>
      <p className="field-hint">
        Windows 11 Pro · {config.username} · RDP TCP {config.remotePort}. The
        webpage imposes no total VPS quota. Hardware, provider permission,
        backups and licensing still apply to every VPS. The same command works
        only while its ISO link remains valid and this dashboard endpoint is
        reachable.
      </p>
      <div className="command-actions">
        <button
          className="copy-button"
          onClick={generate}
          disabled={!ready || !settings || busy}
        >
          {busy ? "Preparing…" : "Generate reusable command"}
        </button>
        {output && (
          <button
            className="text-button"
            disabled={!current || busy}
            onClick={copy}
          >
            <Copy size={14} />
            Copy reusable command
          </button>
        )}
      </div>
      {error && (
        <p className="inline-warning" role="alert">
          {error}
        </p>
      )}
      {output && !current && (
        <p className="inline-warning">
          Installation settings changed. Regenerate before copying; existing
          commands retain their previous settings.
        </p>
      )}
      {current && output && (
        <div className="code-shell">
          <div className="code-caption">
            <span>Root SSH · password prompt on each VPS</span>
            <span className="code-badge">REAL INSTALLER</span>
          </div>
          <pre>
            <code>{output.command}</code>
          </pre>
        </div>
      )}
      <p className="inline-warning">
        Each execution erases its detected system disk after typed confirmation
        and asks for a final reboot confirmation. Settings in the command are
        encoded, not encrypted; private ISO URLs remain private information.
        Passwords and private app/file settings are never included. Do not run
        this on the dashboard host.
      </p>
    </section>
  );
}
