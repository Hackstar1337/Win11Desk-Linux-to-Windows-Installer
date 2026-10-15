import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Clock3,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { formatDate } from "../api";
import { remoteRequest } from "./remoteRequest";
import {
  remoteJobStateLabel,
  remoteJobErrorExplanation,
  type RemoteJob,
  type RemoteJobState,
} from "../../../../../shared/remoteInstall";
import AnimatedButton from "../../vengeance/animated-button";
import { KineticTextLoader } from "../../vengeance/kinetic-text-loader";
import "./remote-install.css";

type Event = {
  id?: string;
  phase?: string;
  state?: string;
  message?: string;
  code?: string;
  createdAt?: string;
};
type Props = { jobId?: string; commandId?: string; runId?: string };
type Response = { job?: RemoteJob; events?: Event[] };

function label(state: string, errorCode?: string | null) {
  return remoteJobStateLabel(state, errorCode);
}

const transportSteps = [
  {
    key: "queued",
    title: "Queued",
    detail: "The reviewed installation is waiting to start.",
  },
  {
    key: "checking",
    title: "Connection check",
    detail: "Checking the approved computer connection.",
  },
  {
    key: "launching",
    title: "Sending files",
    detail: "Installer files are being sent to the target.",
  },
  {
    key: "handed_off",
    title: "Sent to target",
    detail: "Check deployment history for Windows status.",
  },
];

function stepIndex(state?: string) {
  if (!state) return 0;
  if (["connecting", "checking"].includes(state)) return 1;
  if (["sending", "launching"].includes(state)) return 2;
  if (state === "handed_off") return 3;
  return 0;
}

function stateIcon(state: string) {
  if (state === "handed_off")
    return <CheckCircle2 size={15} aria-hidden="true" />;
  if (
    ["blocked", "connection_failed", "launch_uncertain", "cancelled"].includes(
      state
    )
  )
    return <XCircle size={15} aria-hidden="true" />;
  return <CircleDot size={15} aria-hidden="true" />;
}

export default function RemoteJobPanel({ jobId, commandId, runId }: Props) {
  const [data, setData] = useState<(Response & { requestedId: string }) | null>(
    null
  );
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const id = jobId || commandId || runId;
  async function load(signal?: AbortSignal) {
    if (!id) return;
    try {
      setData({
        ...(await remoteRequest<Response>(
          `/api/admin/remote/jobs/${encodeURIComponent(id)}`,
          { signal, headers: { "X-Admin-Polling": "1" } }
        )),
        requestedId: id,
      });
      setError("");
    } catch (reason) {
      if (!(reason instanceof Error && reason.name === "AbortError"))
        setError(
          reason instanceof Error
            ? reason.message
            : "Remote installation could not be loaded."
        );
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    setPassword("");
    setBusy(false);
    void load(controller.signal);
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(controller.signal);
    }, 5000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [id]);
  async function cancel() {
    if (
      !id ||
      !window.confirm("Cancel this queued installation before it starts?")
    )
      return;
    setBusy(true);
    setError("");
    try {
      await remoteRequest(
        `/api/admin/remote/jobs/${encodeURIComponent(id)}/cancel`,
        {
          method: "POST",
        }
      );
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The installation could not be cancelled."
      );
    } finally {
      setBusy(false);
    }
  }
  async function reconcile() {
    if (!id || !password) {
      setError("Re-enter the SSH password to check installation records.");
      return;
    }
    const submittedPassword = password;
    setPassword("");
    setBusy(true);
    setError("");
    try {
      await remoteRequest(
        `/api/admin/remote/jobs/${encodeURIComponent(id)}/reconcile`,
        {
          method: "POST",
          body: JSON.stringify({ password: submittedPassword }),
        }
      );
      setPassword("");
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The records could not be checked."
      );
    } finally {
      setBusy(false);
    }
  }
  if (!id)
    return (
      <div className="remote-muted remote-vng-empty">
        No remote installation selected.
      </div>
    );
  const currentData = data?.requestedId === id ? data : null;
  const job = currentData?.job;
  const uncertain = job?.state === "launch_uncertain";
  const currentStep = stepIndex(job?.state);
  const terminalRisk =
    job &&
    ["blocked", "connection_failed", "launch_uncertain", "cancelled"].includes(
      job.state
    );

  return (
    <article
      className="remote-job-panel remote-vng-job-panel"
      aria-label="Remote job detail"
    >
      <div className="remote-vng-detail-header">
        <div>
          <span className="remote-vng-kicker">
            SELECTED JOB / {id.slice(0, 8)}
          </span>
          <h2>Installation progress</h2>
          <p>
            Connection and file transfer progress are shown separately from
            Windows status.
          </p>
        </div>
        {job && (
          <span
            className={`remote-state remote-state-${job.state} remote-vng-state remote-vng-state-large`}
          >
            {stateIcon(job.state)} {label(job.state, job.errorCode)}
          </span>
        )}
      </div>
      {error && (
        <div
          className="remote-message is-error remote-vng-message"
          role="alert"
        >
          <AlertTriangle size={15} aria-hidden="true" /> {error}
        </div>
      )}
      {job ? (
        <>
          <div className="remote-vng-rail" aria-label="Remote launch workflow">
            {transportSteps.map((step, index) => {
              const complete = !terminalRisk && index < currentStep;
              const active = !terminalRisk && index === currentStep;
              return (
                <div
                  className={`remote-vng-rail-step ${complete ? "is-complete" : ""} ${active ? "is-active" : ""}`}
                  key={step.key}
                >
                  <span className="remote-vng-rail-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="remote-vng-rail-copy">
                    <strong>{step.title}</strong>
                    <small>{step.detail}</small>
                  </span>
                </div>
              );
            })}
          </div>
          <dl className="remote-facts remote-vng-facts">
            <div>
              <dt>Target connection</dt>
              <dd className="remote-vng-mono">
                {job.target.host}:{job.target.port} · root
              </dd>
            </div>
            <div>
              <dt>Installation profile</dt>
              <dd>{job.profileName}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatDate(job.createdAt)}</dd>
            </div>
            <div>
              <dt>Last update</dt>
              <dd>{formatDate(job.updatedAt)}</dd>
            </div>
            <div>
              <dt>Installation state</dt>
              <dd>{label(job.state, job.errorCode)}</dd>
            </div>
            <div>
              <dt>Windows status</dt>
              <dd>
                {job.state === "handed_off"
                  ? "Not reported here — check deployment history"
                  : "Windows is not confirmed ready"}
              </dd>
            </div>
          </dl>
          <div
            className={`remote-vng-boundary ${terminalRisk ? "is-caution" : ""}`}
          >
            {terminalRisk ? (
              <AlertTriangle size={16} aria-hidden="true" />
            ) : (
              <ShieldCheck size={16} aria-hidden="true" />
            )}
            <p>
              A successful connection, reboot disconnect, or queued state never
              proves Windows is ready. Check deployment history for the target
              computer's Windows status.
            </p>
          </div>
          {job.errorCode && job.errorCode !== "RECONCILE_NOT_DISPATCHED" && (
            <div
              className="remote-message is-error remote-vng-message"
              role="alert"
            >
              <p>{remoteJobErrorExplanation(job.errorCode)}</p>
              <small>Reference: {job.errorCode}</small>
            </div>
          )}
          {job.errorCode === "RECONCILE_NOT_DISPATCHED" && (
            <div className="remote-message remote-vng-message" role="status">
              The read-only check found no installer receipt or installation
              records. This deployment is closed without running an installer.
              Create a fresh connection check and review the installation
              settings before trying again.
            </div>
          )}
          {job.canCancel &&
            (job.state === "queued" ||
              job.state === "connecting" ||
              job.state === "checking") && (
              <AnimatedButton
                type="button"
                className="secondary-button remote-vng-action"
                onClick={() => void cancel()}
                disabled={busy}
              >
                <XCircle size={14} aria-hidden="true" /> Cancel before it starts
              </AnimatedButton>
            )}
          {uncertain && (
            <div className="remote-reconcile remote-vng-reconcile">
              <div className="remote-vng-reconcile-heading">
                <RotateCcw size={16} aria-hidden="true" />
                <div>
                  <strong>Check the installation outcome</strong>
                  <p>
                    Do not send the installer again. Re-enter the SSH password
                    only to check installation records.
                  </p>
                </div>
              </div>
              <label className="field">
                <span>SSH password</span>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <AnimatedButton
                type="button"
                className="secondary-button remote-vng-action"
                onClick={() => void reconcile()}
                disabled={busy || !password}
              >
                <RotateCcw size={14} aria-hidden="true" /> Check records
                (read-only)
              </AnimatedButton>
            </div>
          )}
          <div className="remote-events remote-vng-events">
            <div className="remote-vng-events-heading">
              <div>
                <span className="remote-vng-kicker">INSTALLATION EVENTS</span>
                <h3>Safe installation events</h3>
              </div>
              <Clock3 size={15} aria-hidden="true" />
            </div>
            {currentData?.events?.length ? (
              <ul>
                {currentData.events.map((event, index) => (
                  <li key={event.id || index}>
                    <span
                      className="remote-vng-event-marker"
                      aria-hidden="true"
                    />
                    <span className="remote-vng-event-copy">
                      <strong>{event.phase || event.state || "event"}</strong>
                      <span>
                        {event.message || event.code || "Status updated."}
                      </span>
                    </span>
                    <time>{formatDate(event.createdAt)}</time>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="remote-muted">No installation events reported.</p>
            )}
          </div>
        </>
      ) : (
        !error && (
          <div className="remote-vng-empty remote-vng-loading">
            <KineticTextLoader text="Loading" className="remote-vng-loader" />
            <p>Reading protected installation details…</p>
          </div>
        )
      )}
    </article>
  );
}
