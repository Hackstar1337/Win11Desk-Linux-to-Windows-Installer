import { useEffect, useRef, useState } from "react";
import { Download, FileCheck2, LockKeyhole } from "lucide-react";
import type { User } from "../api";
import { api, downloadApiFile, formatDate } from "../api";
import { StepUpModal } from "../../../pages/control/ControlPages";

import type { OperationsHealth } from "@shared/operationsDashboard";
interface Props {
  user: User;
  health: OperationsHealth | null;
  healthLoading: boolean;
  healthError: string;
  reloadHealth: () => void;
}
interface DiagnosticPreview {
  versions: Array<[string, string]>;
  checks: Array<[string, string, string]>;
  counts: Array<[string, string]>;
  failureCodes: string[];
}
const guideItems = [
  [
    "deploy",
    "Deploy guide",
    "Prepare and verify a deployment without exposing credentials.",
  ],
  [
    "backup",
    "Backup guide",
    "Download the bounded control-plane backup procedure.",
  ],
  ["restore", "Restore guide", "Download the restore verification procedure."],
] as const;

function text(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}
function safeText(value: unknown) {
  return text(value)
    .replace(/https?:\/\/\S+/gi, "[URL omitted]")
    .replace(
      /\b(password|token|secret|credential|authorization|bearer)\b[^.;,]*/gi,
      "[sensitive value omitted]"
    )
    .slice(0, 240);
}
function previewDiagnostics(raw: unknown): DiagnosticPreview {
  const root =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const versionsRoot =
    root.versions && typeof root.versions === "object"
      ? (root.versions as Record<string, unknown>)
      : {};
  const versions = (["app", "installer", "launcher"] as const)
    .filter(key => versionsRoot[key] != null)
    .map(key => [key, safeText(versionsRoot[key])] as [string, string]);
  const checksRoot = Array.isArray(root.checks) ? root.checks : [];
  const checks = checksRoot.slice(0, 30).map((entry, index) => {
    const value =
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>)
        : {};
    return [
      safeText(value.label || value.id || `Check ${index + 1}`),
      safeText(value.state || "unknown"),
      safeText(value.detail || "No detail reported."),
    ] as [string, string, string];
  });
  const counts: Array<[string, string]> = [];
  for (const section of ["profiles", "commands", "deployments"]) {
    const value = root[section];
    if (value && typeof value === "object")
      for (const key of [
        "ready",
        "needsSource",
        "archived",
        "available",
        "expired",
        "revoked",
        "total",
        "batchCommands",
        "active",
        "completed",
        "failed",
        "stale",
      ])
        if (typeof (value as Record<string, unknown>)[key] === "number")
          counts.push([
            `${section}.${key === "stale" ? "awaitingUpdate" : key}`,
            String((value as Record<string, unknown>)[key]),
          ]);
  }
  const codeSource = root.failureCodes || root.failedCodes || [];
  const failureCodes = Array.isArray(codeSource)
    ? codeSource
        .filter(value => /^[A-Z0-9_-]{1,96}$/.test(text(value)))
        .slice(0, 30)
        .map(value => text(value))
    : [];
  return { versions, checks, counts, failureCodes };
}

export default function RecoveryView({
  user,
  health,
  healthLoading,
  healthError,
  reloadHealth,
}: Props) {
  const canManage = user.role === "owner" || user.role === "admin";
  const requests = useRef<AbortController | null>(null);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    requests.current = new AbortController();
    return () => {
      active.current = false;
      requests.current?.abort();
    };
  }, []);
  const [advanced, setAdvanced] = useState(false);
  const [stepUp, setStepUp] = useState(false);
  const [group, setGroup] = useState("");
  const [token, setToken] = useState("");
  const [diagnostics, setDiagnostics] = useState<DiagnosticPreview | null>(
    null
  );
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const clear = () => {
      if (document.hidden) {
        setToken("");
        setStepUp(false);
      }
    };
    document.addEventListener("visibilitychange", clear);
    return () => document.removeEventListener("visibilitychange", clear);
  }, []);
  function hideAdvanced() {
    setAdvanced(false);
    setStepUp(false);
    setToken("");
  }
  async function getDiagnostics() {
    setLoadingDiagnostics(true);
    setError("");
    try {
      const result = await api("/api/admin/operations/diagnostics", {
        signal: requests.current?.signal,
      });
      if (active.current) setDiagnostics(previewDiagnostics(result));
    } catch (reason) {
      if (!active.current) return;
      setError(
        reason instanceof Error ? reason.message : "Unable to load diagnostics."
      );
    } finally {
      if (active.current) setLoadingDiagnostics(false);
    }
  }
  async function downloadGuide(kind: string, filename: string) {
    setError("");
    try {
      await downloadApiFile(
        kind === "diagnostics"
          ? "/api/admin/operations/diagnostics"
          : `/api/admin/operations/guides/${kind}`,
        filename,
        requests.current?.signal
      );
      if (!active.current) return;
      setMessage(`${filename} downloaded.`);
    } catch (reason) {
      if (!active.current) return;
      setError(reason instanceof Error ? reason.message : "Download failed.");
    }
  }
  async function importLegacy() {
    try {
      const result = await api<{ imported?: number; skipped?: number }>(
        "/api/admin/legacy-import",
        {
          method: "POST",
          signal: requests.current?.signal,
          body: JSON.stringify({
            groupId: group,
            readToken: token,
            confirm: true,
          }),
        }
      );
      if (!active.current) return;
      setMessage(
        `Legacy import finished: ${result.imported ?? 0} added, ${result.skipped ?? 0} skipped.`
      );
    } catch (reason) {
      if (!active.current) return;
      setError(
        reason instanceof Error ? reason.message : "Legacy import failed."
      );
    } finally {
      if (active.current) {
        setToken("");
        setStepUp(false);
      }
    }
  }
  return (
    <section className="ops-panel" aria-labelledby="operations-recovery-title">
      <div className="ops-panel-heading">
        <div>
          <h2 id="operations-recovery-title">Recovery & evidence</h2>
          <p>
            Download procedures and inspect bounded diagnostic evidence.
            Recovery actions never show secrets or raw logs.
          </p>
        </div>
      </div>
      <div className="ops-subheading">
        <h3>Backup & restore evidence</h3>
        <button
          className="secondary-button"
          onClick={reloadHealth}
          disabled={healthLoading}
        >
          Refresh evidence
        </button>
      </div>
      {healthError && (
        <p className="ops-inline-error">Evidence unavailable: {healthError}</p>
      )}
      <dl className="ops-facts">
        <div className="ops-fact">
          <dt>Latest backup attempt</dt>
          <dd>
            {health?.backup.lastBackupAt
              ? formatDate(health.backup.lastBackupAt)
              : "Not reported"}
          </dd>
        </div>
        <div className="ops-fact">
          <dt>Latest attempt outcome</dt>
          <dd>
            {health?.backup.outcome === "not-reported"
              ? "Not reported"
              : health?.backup.outcome || "Not reported"}
          </dd>
        </div>
        <div className="ops-fact">
          <dt>Archive verification</dt>
          <dd>
            {health?.backup.checksumVerified === true
              ? "Encrypted archive checksum verified — not a restore test"
              : "Not reported"}
          </dd>
        </div>
        <div className="ops-fact">
          <dt>Restore verification</dt>
          <dd>
            {health?.backup.lastRestoreVerifiedAt
              ? formatDate(health.backup.lastRestoreVerifiedAt)
              : "Not tested / not reported"}
          </dd>
        </div>
      </dl>
      {error && (
        <div className="ops-inline-error" role="alert">
          <span>{error}</span>
          <button
            className="text-button"
            type="button"
            onClick={() => setError("")}
          >
            Dismiss
          </button>
        </div>
      )}
      {message && (
        <div className="ops-inline-success" role="status">
          {message}
        </div>
      )}
      <div className="ops-guide-list">
        {guideItems.map(([kind, title, description]) => (
          <div className="ops-guide" key={kind}>
            <FileCheck2 size={16} />
            <div>
              <strong>{title}</strong>
              <span>{description}</span>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                void downloadGuide(kind, `win11desk-${kind}-guide.json`)
              }
            >
              <Download size={14} /> Download
            </button>
          </div>
        ))}
      </div>
      {canManage && (
        <div className="ops-diagnostics">
          <div className="ops-subheading">
            <div>
              <h3>Diagnostics snapshot</h3>
              <p>
                Preview is intentionally limited to versions, check states,
                counts, and safe failure codes.
              </p>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void getDiagnostics()}
              disabled={loadingDiagnostics}
            >
              {loadingDiagnostics ? "Loading…" : "Load preview"}
            </button>
          </div>
          {diagnostics && (
            <div className="ops-diagnostic-preview">
              <dl className="ops-facts">
                <div className="ops-fact ops-fact-stack">
                  <dt>Versions</dt>
                  <dd>
                    {diagnostics.versions.length
                      ? diagnostics.versions.map(([key, value]) => (
                          <span key={key}>
                            {key}: <Value value={value} />
                          </span>
                        ))
                      : "Not reported"}
                  </dd>
                </div>
                <div className="ops-fact ops-fact-stack">
                  <dt>Counts</dt>
                  <dd>
                    {diagnostics.counts.length
                      ? diagnostics.counts.map(([key, value]) => (
                          <span key={key}>
                            {key}: <Value value={value} />
                          </span>
                        ))
                      : "Not reported"}
                  </dd>
                </div>
              </dl>
              <div>
                <h4>Checks</h4>
                {diagnostics.checks.length ? (
                  <ul className="ops-compact-list">
                    {diagnostics.checks.map(([label, state, detail]) => (
                      <li key={label}>
                        <strong>{label}</strong>{" "}
                        <span className="ops-status ops-status-neutral">
                          {state}
                        </span>
                        <small>{detail}</small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ops-muted">No checks reported.</p>
                )}
              </div>
              <div>
                <h4>Failure codes</h4>
                {diagnostics.failureCodes.length ? (
                  <div className="ops-code-list">
                    {diagnostics.failureCodes.map(code => (
                      <code key={code}>{code}</code>
                    ))}
                  </div>
                ) : (
                  <p className="ops-muted">No failure codes reported.</p>
                )}
              </div>
              <button
                className="primary-button"
                type="button"
                onClick={() =>
                  void downloadGuide(
                    "diagnostics",
                    "win11desk-diagnostics.json"
                  )
                }
              >
                <Download size={14} /> Download diagnostics JSON
              </button>
            </div>
          )}
        </div>
      )}
      {canManage && (
        <details
          className="ops-advanced"
          open={advanced}
          onToggle={event => {
            const open = (event.currentTarget as HTMLDetailsElement).open;
            setAdvanced(open);
            if (!open) {
              setStepUp(false);
              setToken("");
            }
          }}
        >
          <summary>Advanced: import a local legacy tracker</summary>
          {advanced && (
            <div className="ops-advanced-body">
              <div className="ops-advanced-note">
                <LockKeyhole size={15} />
                <span>
                  Owner/admin only. This uses the existing local tracker
                  endpoint; it never contacts a caller-supplied URL or displays
                  credentials.
                </span>
              </div>
              <form
                className="ops-form"
                onSubmit={event => {
                  event.preventDefault();
                  setError("");
                  setStepUp(true);
                }}
              >
                <label className="field">
                  <span>Legacy group ID</span>
                  <input
                    value={group}
                    onChange={event => setGroup(event.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  <span>Private tracker read token (after #)</span>
                  <input
                    type="password"
                    value={token}
                    onChange={event => setToken(event.target.value)}
                    required
                    autoComplete="off"
                  />
                </label>
                <div className="ops-form-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={hideAdvanced}
                  >
                    Cancel
                  </button>
                  <button className="primary-button">
                    Verify and import records
                  </button>
                </div>
              </form>
              <StepUpModal
                open={stepUp}
                title="Authorize legacy import"
                onCancel={() => {
                  setStepUp(false);
                  setToken("");
                }}
                onVerified={importLegacy}
              />
            </div>
          )}
        </details>
      )}
    </section>
  );
}
function Value({ value }: { value: string }) {
  return <span className="ops-value">{value || "Not reported"}</span>;
}
