import { useEffect, useState } from "react";
import { Copy, KeyRound, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { COOKIE_NAME, startLogin } from "@/const";
import type { DeploymentConfig } from "@shared/deployment";
import type { InstallTarget } from "@shared/installer";

type Ticket = {
  id: string;
  command: string;
  expiresAt: string;
  scriptHash: string;
};
function headers(): Record<string, string> {
  const result: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Win11Desk-Request": "1",
  };
  try {
    const pair = sessionStorage
      .getItem("manus-cookie")
      ?.split(";")
      .find(s => s.trim().startsWith(`${COOKIE_NAME}=`));
    if (pair)
      result.Authorization = `Bearer ${pair.trim().slice(COOKIE_NAME.length + 1)}`;
  } catch {}
  return result;
}
export default function OneCommandInstaller({
  config,
  target,
  ready,
}: {
  config: DeploymentConfig;
  target: InstallTarget;
  ready: boolean;
}) {
  const { user, loading } = useAuth();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState("");
  const [now, setNow] = useState(Date.now());
  const fingerprint = JSON.stringify({ config, target });
  const stale = !!ticket && snapshot !== fingerprint;
  const expired = !!ticket && new Date(ticket.expiresAt).getTime() <= now;
  useEffect(() => {
    if (!ticket) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticket]);
  const eligible = ready && config.password.length >= 8 && !!user && !busy;
  async function generate() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/installer/commands", {
        method: "POST",
        headers: headers(),
        credentials: "include",
        body: JSON.stringify({
          config,
          target: { ...target, autoReboot: true },
          origin: window.location.origin,
        }),
      });
      const result = await res.json();
      if (!res.ok)
        throw new Error(result.error || "Command generation failed.");
      setTicket(result);
      setSnapshot(fingerprint);
      setNow(Date.now());
      toast.success(
        "Private command generated. Paste it in root SSH on the intended VPS."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Command generation failed.");
    } finally {
      setBusy(false);
    }
  }
  async function revoke() {
    if (!ticket) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/installer/commands/${ticket.id}`, {
        method: "DELETE",
        headers: headers(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Sign in to revoke this command.");
      setTicket(null);
      toast.success(
        "Command revoked. Already downloaded installers are not recalled."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Revocation failed.");
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (!ticket || stale || expired) return;
    try {
      await navigator.clipboard.writeText(ticket.command);
      toast.success(
        "Command copied. Login to the VPS over SSH, use sudo -i, then paste."
      );
    } catch {
      toast.error("Clipboard unavailable. Select the command text instead.");
    }
  }
  return (
    <section className="one-command-panel" aria-label="Copy and run installer">
      <div className="section-heading">
        <div>
          <p className="eyebrow">TINYINSTALLER-STYLE WORKFLOW</p>
          <h2>Alternative: use the page password.</h2>
        </div>
        <KeyRound size={18} />
      </div>
      <p className="section-description">
        Set your username, password and RDP port above. Generate the command,
        log into your Linux VPS as root over SSH, and paste it. The script
        downloads your exact settings, checks the target, stages Windows 11 Pro,
        and offers to reboot after your final confirmation.
      </p>
      <div className="one-command-summary">
        <span>
          OS <strong>Windows 11 Pro</strong>
        </span>
        <span>
          User <strong>{config.username}</strong>
        </span>
        <span>
          RDP <strong>{config.remotePort}</strong>
        </span>
        <span>
          Disk{" "}
          <strong>
            {target.targetDisk === "auto"
              ? "Auto-detect root disk"
              : target.targetDisk}
          </strong>
        </span>
      </div>
      <p className="field-hint">
        Port 22 becomes Windows RDP after installation, not SSH. Temporary Linux
        installer SSH can also use 22 because they run at different stages.
        Allow the RDP port in the provider firewall and restrict source IPs.
      </p>
      {!user && (
        <p className="inline-warning">
          {loading
            ? "Checking your sign-in…"
            : "Sign in to create a private installer command. Manual downloads below remain available."}
        </p>
      )}
      {config.password.length < 8 && (
        <p className="inline-warning">
          Enter a Windows password of 8–128 characters above. It is sent over
          HTTPS for encrypted ticket delivery, never saved in browser drafts or
          printed in the command.
        </p>
      )}
      <p className="field-hint">
        <ShieldCheck size={12} /> Command expires after 30 minutes and allows up
        to 5 retrievals for download retries. Anyone holding it can retrieve the
        installer, including your password: keep it private. The database stores
        only encrypted script content; the decryption key is in this command. Up
        to 10 active commands per account; generating a new one does not revoke
        previously copied commands. Use the reusable SSH-password option above
        for unrestricted repeated generation.
      </p>
      {error && (
        <p className="inline-warning" role="alert">
          {error}
        </p>
      )}
      <div className="command-actions">
        {!user && !loading ? (
          <button
            className="copy-button"
            onClick={() => {
              try {
                startLogin();
              } catch {
                setError(
                  "Sign-in could not start. Open the dashboard in a standalone browser tab and sign in."
                );
              }
            }}
          >
            Sign in to generate
          </button>
        ) : (
          <button
            className="copy-button"
            onClick={generate}
            disabled={!eligible}
          >
            {busy ? "Preparing…" : "Generate install command"}
          </button>
        )}
        {ticket && (
          <>
            <button
              className="text-button"
              onClick={copy}
              disabled={stale || expired || busy}
            >
              <Copy size={14} />
              Copy command
            </button>
            <button className="text-button" onClick={revoke} disabled={busy}>
              Revoke command
            </button>
          </>
        )}
      </div>
      {ticket && (
        <>
          {stale || expired ? (
            <p className="inline-warning">
              {stale
                ? "Settings changed: regenerate to apply the current values. The previous ticket remains valid until revoked or expired."
                : "Command expired: generate a new command."}
            </p>
          ) : (
            <>
              <p className="field-hint">
                Expires {new Date(ticket.expiresAt).toLocaleTimeString()} · No
                installation has started.
              </p>
              <div className="code-shell">
                <div className="code-caption">
                  <span>Paste in root SSH · no SCP needed</span>
                  <span className="code-badge">PRIVATE BEARER COMMAND</span>
                </div>
                <pre>
                  <code>{ticket.command}</code>
                </pre>
              </div>
            </>
          )}
        </>
      )}
      <p className="inline-warning">
        This workflow replaces the VPS system disk. Read-only checks run first;
        type the exact actual hostname/disk erasure phrase before staging, then
        the exact reboot phrase to start installation. Boot and RDP were tested
        on one Vultr VPS, not every target. Preview is temporary hosting, not a
        permanent installer service.
      </p>
    </section>
  );
}
