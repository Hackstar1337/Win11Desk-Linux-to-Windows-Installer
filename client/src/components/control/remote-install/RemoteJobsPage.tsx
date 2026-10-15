import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { formatDate } from "../api";
import { remoteRequest } from "./remoteRequest";
import { useLocation, useSearch } from "wouter";
import type { User } from "../api";
import {
  remoteJobStateLabel,
  type RemoteJob,
} from "../../../../../shared/remoteInstall";
import { AnimatedNumber } from "../../vengeance/animated-number";
import AnimatedButton from "../../vengeance/animated-button";
import { GlowBorderCard } from "../../vengeance/glow-border-card";
import { KineticTextLoader } from "../../vengeance/kinetic-text-loader";
import RemoteJobPanel from "./RemoteJobPanel";
import "./remote-install.css";

export type RemoteJobsPageProps = {
  user?: User | null;
  params?: Record<string, string | undefined>;
};

export default function RemoteJobsPage({ user }: RemoteJobsPageProps) {
  const search = useSearch();
  const [, navigate] = useLocation();
  const [jobs, setJobs] = useState<RemoteJob[]>([]);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | undefined>(() => {
    const id = new URLSearchParams(window.location.search).get("job");
    return id && /^[A-Za-z0-9-]{1,128}$/.test(id) ? id : undefined;
  });
  useEffect(() => {
    const id = new URLSearchParams(search).get("job");
    setSelected(id && /^[A-Za-z0-9-]{1,128}$/.test(id) ? id : undefined);
  }, [search]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(signal?: AbortSignal) {
    try {
      const result = await remoteRequest<{ items?: RemoteJob[] }>(
        "/api/admin/remote/jobs",
        { signal, headers: { "X-Admin-Polling": "1" } }
      );
      setJobs(Array.isArray(result?.items) ? result.items : []);
      setError("");
    } catch (reason) {
      if (!(reason instanceof Error && reason.name === "AbortError"))
        setError(
          reason instanceof Error
            ? reason.message
            : "Remote installations could not be loaded."
        );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(controller.signal);
    }, 5000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);
  const visible = useMemo(
    () =>
      jobs.filter(
        job =>
          !filter ||
          `${job.state} ${remoteJobStateLabel(job.state, job.errorCode)} ${job.target.host}:${job.target.port} ${job.profileName} ${job.label}`
            .toLowerCase()
            .includes(filter.toLowerCase())
      ),
    [jobs, filter]
  );
  const activeCount = jobs.filter(job =>
    ["queued", "connecting", "checking", "sending", "launching"].includes(
      job.state
    )
  ).length;
  const uncertainCount = jobs.filter(
    job => job.state === "launch_uncertain"
  ).length;
  const lastUpdated = jobs.length
    ? jobs.reduce(
        (latest, job) => (job.updatedAt > latest ? job.updatedAt : latest),
        jobs[0].updatedAt
      )
    : null;

  if (user && user.role !== "owner" && user.role !== "admin")
    return (
      <section
        className="remote-jobs-page remote-vng-page page-wrap"
        aria-label="Remote install jobs"
      >
        <div className="remote-vng-locked">
          <span className="remote-vng-kicker">REMOTE INSTALLATIONS</span>
          <ShieldCheck size={25} aria-hidden="true" />
          <strong>Remote installations are restricted</strong>
          <p>Only the owner or admin role can review remote installations.</p>
        </div>
      </section>
    );

  return (
    <section
      className="remote-jobs-page remote-vng-page page-wrap"
      aria-label="Remote install jobs"
    >
      <header className="remote-vng-hero">
        <div>
          <span className="remote-vng-kicker">REMOTE INSTALLATIONS</span>
          <h1>Remote installations</h1>
          <p>
            Track the SSH connection check and installer start. Open Deployment
            history for Windows installation progress.
          </p>
        </div>
        <div className="remote-vng-hero-meta">
          <span className="remote-vng-live-dot" aria-hidden="true" />
          <span>Polling while visible</span>
          <small>
            {lastUpdated
              ? `Updated ${formatDate(lastUpdated)}`
              : "Waiting for first response"}
          </small>
        </div>
      </header>

      <div className="remote-vng-overview">
        <GlowBorderCard
          className="remote-vng-count-card"
          width="100%"
          height="auto"
          borderRadius="18px"
          borderWidth="0.8em"
          blurAmount="1.1em"
          inset="-0.65em"
          gradientColors={["#A78BFA", "#3b2d60", "#151321", "#A78BFA"]}
          paused={loading}
        >
          <div className="remote-vng-count-inner">
            <span className="remote-vng-card-label">SSH INSTALLATION JOBS</span>
            <div className="remote-vng-count-line">
              {loading && !jobs.length ? (
                <KineticTextLoader
                  className="remote-vng-loader"
                  text="Loading"
                />
              ) : (
                <AnimatedNumber
                  value={jobs.length}
                  className="remote-vng-count"
                />
              )}
            </div>
            <span className="remote-vng-card-note">remote job records</span>
          </div>
        </GlowBorderCard>
        <div
          className="remote-vng-signal-stack"
          aria-label="Remote queue summary"
        >
          <div className="remote-vng-signal">
            <span>
              <i className="remote-vng-signal-mark is-violet" />
              In progress
            </span>
            <strong>{activeCount}</strong>
            <small>queued or being sent</small>
          </div>
          <div className="remote-vng-signal">
            <span>
              <i className="remote-vng-signal-mark is-amber" />
              Review required
            </span>
            <strong>{uncertainCount}</strong>
            <small>check before trying again</small>
          </div>
        </div>
      </div>

      <div className="remote-vng-workspace">
        <div className="remote-vng-list-column">
          <div className="remote-vng-list-toolbar">
            <div>
              <span className="remote-vng-kicker">SSH INSTALLATION JOBS</span>
              <h2>
                {visible.length} matching{" "}
                {visible.length === 1 ? "job" : "jobs"}
              </h2>
            </div>
            <div className="remote-vng-list-actions">
              <label className="remote-vng-search">
                <Search size={15} aria-hidden="true" />
                <span className="sr-only">Filter jobs</span>
                <input
                  type="search"
                  name="remote-job-search"
                  autoComplete="off"
                  aria-label="Filter jobs"
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  placeholder="target, label, state"
                />
              </label>
              <AnimatedButton
                type="button"
                className="remote-vng-icon-action"
                onClick={() => void load()}
                aria-label="Refresh remote jobs"
                title="Refresh remote jobs"
                disabled={loading}
              >
                <RefreshCw
                  size={14}
                  aria-hidden="true"
                  className={loading ? "remote-vng-spin" : ""}
                />
              </AnimatedButton>
            </div>
          </div>
          {error && (
            <div
              className="remote-message is-error remote-vng-message"
              role="alert"
            >
              {error}
            </div>
          )}
          {loading && !jobs.length ? (
            <div
              className="remote-vng-empty remote-vng-loading"
              aria-live="polite"
            >
              <KineticTextLoader text="Loading" className="remote-vng-loader" />
              <p>Reading installation progress…</p>
            </div>
          ) : (
            <div className="remote-job-list remote-vng-job-list">
              {visible.map((job, index) => (
                <button
                  type="button"
                  className={`remote-job-row remote-vng-job-row ${selected === job.id ? "is-selected" : ""}`}
                  key={job.id}
                  onClick={() => {
                    setSelected(job.id);
                    navigate(`/remote-jobs?job=${encodeURIComponent(job.id)}`);
                  }}
                  aria-pressed={selected === job.id}
                >
                  <span className="remote-vng-row-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="remote-vng-row-primary">
                    <strong>{job.label || job.target.host}</strong>
                    <small>
                      {job.target.host}:{job.target.port} · {job.profileName}
                    </small>
                  </span>
                  <span
                    className={`remote-state remote-state-${job.state} remote-vng-state`}
                  >
                    <i />
                    {remoteJobStateLabel(job.state, job.errorCode)}
                  </span>
                  <span className="remote-vng-row-time">
                    <time>{formatDate(job.updatedAt)}</time>
                    <ArrowUpRight size={13} aria-hidden="true" />
                  </span>
                </button>
              ))}
              {!visible.length && (
                <div className="remote-vng-empty">
                  <Activity size={18} aria-hidden="true" />
                  <strong>
                    {jobs.length
                      ? "No jobs match this filter."
                      : "No remote jobs yet."}
                  </strong>
                  <p>
                    {jobs.length
                      ? "Try a computer, profile, label, or status."
                      : "A reviewed installation will appear here without exposing credentials."}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
        <aside
          className="remote-vng-detail-column"
          aria-label="Selected remote job"
        >
          {selected ? (
            <RemoteJobPanel jobId={selected} />
          ) : (
            <div className="remote-vng-selection-note">
              <span className="remote-vng-kicker">SELECT A JOB</span>
              <h2>Review an installation job.</h2>
              <p>
                Choose a job to see its SSH connection, installer start, events
                and next steps.
              </p>
              <div className="remote-vng-mini-rail">
                <span>01</span>
                <span>02</span>
                <span>03</span>
              </div>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
