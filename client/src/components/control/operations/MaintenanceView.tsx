import { useEffect, useRef, useState } from "react";
import { AlertTriangle, LockKeyhole, ShieldCheck } from "lucide-react";
import type { User } from "../api";
import { api } from "../api";
import { StepUpModal } from "../../../pages/control/ControlPages";
import type {
  MaintenancePreview,
  MaintenanceClearResult as MaintenanceResult,
  MaintenanceMode,
} from "@shared/operationsMaintenance";
import "./MaintenanceView.css";

const names: Record<string, string> = {
  wc_sessions: "Your other login sessions",
  wc_commands: "Commands",
  wc_command_profiles: "Profile snapshots",
  wc_delivery_secrets: "Delivery tickets",
  wc_run_meta: "Deployments",
  wc_events: "Deployment events",
  wc_run_labels: "Custom labels",
  wc_post_install_runs: "Post-install results",
  wc_notifications: "Notifications",
  wc_remote_jobs: "Remote installations",
  wc_remote_job_events: "Remote job events",
  wc_remote_secrets: "Encrypted SSH/review data",
  wc_remote_reviews: "Install reviews",
  wc_remote_checks: "Preflight checks",
  wc_remote_trust: "Trusted target fingerprints",
  installerTickets: "Legacy delivery tickets",
  installerTrackingRuns: "Tracker executions",
  installerTrackingGroups: "Tracker groups",
};
const label = (key: string) =>
  names[key] ||
  key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^./, value => value.toUpperCase());

export default function MaintenanceView({
  user,
  onChanged,
}: {
  user: User;
  onChanged: () => void;
}) {
  const [preview, setPreview] = useState<MaintenancePreview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [verify, setVerify] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<MaintenanceResult | null>(null);
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) {
        setVerify(false);
        setConfirmation("");
      }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, []);
  if (user.role !== "owner") return null;
  async function loadPreview(mode: MaintenanceMode) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setPreview(null);
    setConfirmation("");
    setError("");
    setResult(null);
    try {
      const next = await api<MaintenancePreview>(
        `/api/admin/operations/maintenance/preview?mode=${mode}`,
        { signal: controller.signal }
      );
      if (mounted.current && !controller.signal.aborted) setPreview(next);
    } catch (reason) {
      if (mounted.current && !controller.signal.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : "Cleanup preview unavailable."
        );
    } finally {
      if (mounted.current && !controller.signal.aborted) setBusy(false);
    }
  }
  async function clearData() {
    if (
      !preview ||
      !preview.canClear ||
      confirmation !== preview.confirmPhrase ||
      busy
    )
      return;
    setBusy(true);
    setError("");
    try {
      const next = await api<MaintenanceResult>(
        "/api/admin/operations/maintenance/clear",
        {
          method: "POST",
          body: JSON.stringify({
            mode: preview.mode,
            confirm: confirmation,
            previewDigest: preview.previewDigest,
          }),
        }
      );
      if (mounted.current) {
        setResult(next);
        setPreview(null);
        setConfirmation("");
        setVerify(false);
        onChanged();
      }
    } catch (reason) {
      if (mounted.current) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Cleanup was not confirmed. Refresh the preview before trying again."
        );
        setPreview(null);
        setConfirmation("");
        setVerify(false);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section
      className="ops-panel ops-vng-panel ops-maintenance"
      aria-labelledby="ops-maintenance-title"
    >
      <div className="ops-panel-heading ops-vng-heading">
        <div>
          <span className="ops-vng-section-no">04 / OWNER ACTION</span>
          <h2 id="ops-maintenance-title">Data maintenance</h2>
          <p>
            Owner only. These actions clear records in this account — never files or
            disks on your servers.
          </p>
        </div>
        <div className="ops-vng-readonly">
          <ShieldCheck size={13} /> STEP-UP REQUIRED
        </div>
      </div>
      <div className="ops-maintenance-body">
        <div className="ops-maintenance-choices">
          <div className="ops-maintenance-choice">
            <span className="ops-vng-step">01</span>
            <h3>Clear finished history</h3>
            <p>
              Remove eligible finished deployments, expired commands, and closed
              remote jobs. Running, awaiting-update, and uncertain installations
              stay protected.
            </p>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => void loadPreview("finished")}
            >
              Preview finished cleanup
            </button>
          </div>
          <div className="ops-maintenance-choice ops-maintenance-choice-danger">
            <span className="ops-vng-step">02</span>
            <h3>Clear All Data</h3>
            <p>
              Empty Commands, Remote Installations, deployment history, saved
              installation credentials, pending reviews, and notifications.
              Includes active, handed-off, and post-install records; this does
              not stop work already launched on a VPS.
            </p>
            <button
              type="button"
              className="secondary-button ops-maintenance-danger"
              disabled={busy}
              onClick={() => void loadPreview("all")}
            >
              Preview Clear All Data
            </button>
          </div>
        </div>
        <p className="ops-muted ops-maintenance-retained">
          Always retained: admin accounts, this browser and other accounts’
          login sessions, deployment profiles, settings/presets, security audit,
          server configuration, installer assets, and backups.
        </p>
        {busy && !verify && <p role="status">Loading cleanup preview…</p>}
        {error && (
          <p className="ops-inline-error ops-vng-inline" role="alert">
            <AlertTriangle size={15} /> {error} No automatic retry is performed.
          </p>
        )}
        {result && (
          <div className="ops-inline-success ops-vng-inline" role="status">
            <strong>Cleanup completed.</strong>
            <p>Your admin access, profiles, and settings are unchanged.</p>
            <CountList counts={result.counts} />
          </div>
        )}
        {preview && (
          <div className="ops-maintenance-preview">
            <div className="ops-vng-review-head">
              <span className="ops-vng-section-no">
                REVIEW / CURRENT PREVIEW
              </span>
              <h3>
                {preview.mode === "all"
                  ? "Clear All Data — review"
                  : "Finished history — review"}
              </h3>
            </div>
            <p>
              {preview.mode === "all"
                ? "Records currently selected for removal (new installation activity is included at confirmation):"
                : "Exact records eligible for removal:"}
            </p>
            <CountList counts={preview.counts} />
            {Object.values(preview.protectedCounts).some(
              value => value > 0
            ) && (
              <>
                <h4>Protected / retained work</h4>
                <CountList counts={preview.protectedCounts} />
              </>
            )}
            {preview.blockers.length > 0 && (
              <div className="ops-inline-error ops-vng-inline" role="alert">
                <strong>Cannot clear safely:</strong>
                <ul>
                  {preview.blockers.map(item => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="ops-muted">
              {preview.mode === "all"
                ? "Clear All removes all installation records present at confirmation, even if status or counts change. Previously launched Windows work may continue, but its account records and unused commands will no longer work."
                : "Finished cleanup rechecks this exact preview; changes invalidate it."}{" "}
              Deleted records cannot be restored from the portal; host backups
              are separate.
            </p>
            {preview.canClear && (
              <label className="field">
                <span>
                  Type {preview.confirmPhrase} to confirm permanent deletion
                </span>
                <input
                  value={confirmation}
                  onChange={event => setConfirmation(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy}
                />
              </label>
            )}
            <div className="ops-maintenance-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  setPreview(null);
                  setConfirmation("");
                }}
              >
                Cancel
              </button>
              {preview.canClear && (
                <button
                  type="button"
                  className="secondary-button ops-maintenance-danger"
                  disabled={busy || confirmation !== preview.confirmPhrase}
                  onClick={() => setVerify(true)}
                >
                  Verify and clear{" "}
                  {preview.mode === "all"
                    ? "all installation data"
                    : "finished history"}
                </button>
              )}
            </div>
          </div>
        )}
        <StepUpModal
          open={verify}
          title="Authorize permanent data cleanup"
          description="Verify your administrator password and MFA, if enabled. Clear All removes all installation records present at confirmation; finished cleanup removes only its reviewed records."
          onCancel={() => {
            setVerify(false);
            setConfirmation("");
          }}
          onVerified={clearData}
        />
      </div>
    </section>
  );
}
function CountList({ counts }: { counts: Record<string, number> }) {
  return (
    <dl className="ops-maintenance-counts">
      {Object.entries(counts).map(([key, value]) => (
        <div key={key}>
          <dt>{label(key)}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
