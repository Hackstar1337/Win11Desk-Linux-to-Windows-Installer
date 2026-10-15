import { deploymentStatusLabel } from "../../../shared/deploymentStatus";
import {
  installationDuration,
  transferProgress,
} from "../../../shared/deploymentPresentation";
import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { DeskMark } from "../components/control/ControlShell";
import { Stat, Loading } from "./control/ControlPrimitives";
import { ShieldCheck } from "lucide-react";
import { ArrowLeft, RefreshCw, Activity } from "lucide-react";
type Run = {
  runId: string;
  hostname: string;
  wholeDisk: string;
  publicIP?: string | null;
  rdpPort: number;
  stage: string;
  phase?: string | null;
  downloadedBytes?: number | null;
  totalBytes?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  updatedAt: string;
  createdAt: string;
  windowsEdition?: string | null;
  windowsBuild?: number | null;
  rdpListening?: boolean | number | null;
};
const labels: Record<string, string> = {
  starting: "Waiting for preflight",
  preflight: "Preflight passed",
  staging: "Staging boot installer",
  rebooting: "Rebooting into installer",
  installer_booted: "Temporary installer running",
  downloading: "Downloading Windows ISO",
  media_verified: "ISO checksum verified",
  preparing: "Preparing Windows and drivers",
  windows_setup: "Windows Setup",
  windows_booted: "Windows 11 Pro boot reported",
  windows_ready: "Windows 11 Pro running · local RDP listening",
  failed: "Installation error reported",
};
export default function Track() {
  const { id } = useParams<{ id: string }>();
  const [token] = useState(() => window.location.hash.slice(1));
  const [data, setData] = useState<{ runs: Run[]; expiresAt: string } | null>(
      null
    ),
    [error, setError] = useState(""),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!/^[a-f0-9]{64}$/.test(token)) {
      setError(
        "Private tracking token missing. Open the complete tracking link from the dashboard."
      );
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    async function load() {
      try {
        const r = await fetch(`/api/installer/tracking/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        if (!r.ok)
          throw new Error(
            r.status === 410
              ? "Tracker expired."
              : "Tracker unavailable or private link invalid."
          );
        const d = await r.json();
        if (!cancelled) {
          setData(d);
          setError("");
          setNow(Date.now());
        }
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Tracking unavailable.");
      }
    }
    void load();
    const timer = setInterval(() => {
      setNow(Date.now());
      void load();
    }, 5000);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [id, token]);
  return (
    <main className="tracker-page">
      <div className="tracker-topbar">
        <a href="/">
          <DeskMark /> Win11Desk<span className="brand-period">.</span>
        </a>
        <a className="tracker-back" href="/">
          <ArrowLeft size={14} /> Installer dashboard
        </a>
      </div>
      <header className="tracker-hero">
        <div>
          <div className="tracker-eyebrow">
            <Activity size={15} />
            PRIVATE INSTALLATION PROGRESS
          </div>
          <h1>Track your Windows installations.</h1>
          <p>
            See installation progress without opening a remote command session.
            This private page checks for updates every 5 seconds.
          </p>
        </div>
        <span className="tracker-polling">
          <span className="status-dot" /> Status updates · 5s refresh
        </span>
      </header>
      {data && (
        <div className="tracker-stat-strip">
          <Stat
            label="Deployments"
            value={data.runs.length}
            note="Each deployment has its own record"
          />
          <Stat
            label="Windows-ready installations"
            value={
              data.runs.filter(run => run.stage === "windows_ready").length
            }
            note="Based on a Windows status update"
          />
          <Stat
            label="Installation errors"
            value={data.runs.filter(run => run.stage === "failed").length}
            note="Installer-reported errors only"
          />
        </div>
      )}
      <div className="tracker-report-layout">
        <div>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          {!data && !error && <Loading />}
          {data && (
            <>
              <p className="tracker-meta">
                <RefreshCw size={12} />
                Updated {new Date(now).toLocaleTimeString()} · private link
                expires {new Date(data.expiresAt).toLocaleString()}
              </p>
              {!data.runs.length && (
                <article className="run-card">
                  <h2>Waiting for your deployment to start.</h2>
                  <p>
                    Paste the new automatic command into the intended VPS. Each
                    deployment gets its own record before boot changes. Older
                    deployments from before tracking was added cannot appear
                    here.
                  </p>
                </article>
              )}
              {data.runs.map(run => {
                const age = Math.max(
                  0,
                  Math.floor((now - Date.parse(run.updatedAt)) / 1000)
                );
                const stale = age > 180;
                const wasReady = run.stage === "windows_ready";
                const done = wasReady;
                const progress = transferProgress(
                  run.downloadedBytes,
                  run.totalBytes
                );
                return (
                  <article
                    className={`run-card ${done ? "ready" : ""}`}
                    key={run.runId}
                  >
                    <div className="run-title">
                      <h2>{run.hostname || "VPS"}</h2>
                      <span className="tiny-badge">
                        {done
                          ? "WINDOWS READY REPORTED"
                          : run.stage === "failed"
                            ? "ERROR"
                            : stale
                              ? deploymentStatusLabel("stale")
                              : "IN PROGRESS"}
                      </span>
                    </div>
                    <p>
                      {run.publicIP || "IP not reported"} · {run.wholeDisk} ·
                      RDP {run.rdpPort}
                    </p>
                    <h3>
                      {wasReady
                        ? "Installation complete · Windows 11 Pro / local RDP verified"
                        : labels[run.stage] || run.stage}
                    </h3>
                    <p>
                      {wasReady
                        ? `Completion reported ${new Date(run.updatedAt).toLocaleString()}. The one-time status sender stops after success; this is not ongoing uptime monitoring.`
                        : `Last update ${age}s ago (stage report or connection check)`}
                      {stale && !wasReady && run.stage !== "failed"
                        ? " — no recent update; Awaiting update; status is unknown, not confirmed failed."
                        : ""}
                    </p>
                    {stale && run.stage === "rebooting" && (
                      <p className="tracker-caution">
                        No temporary-installer status update received. An older
                        script may lack the Alpine HTTPS client repair, or the
                        VPS may not have booted the installer. Check the
                        provider console/temporary SSH. Updating this page
                        cannot patch an image already booted; do not run another
                        destructive installer blindly.
                      </p>
                    )}
                    {run.stage === "failed" && (
                      <p className="tracker-caution">
                        Check the temporary installer log for its exact error.
                        ISO_SHA256_MISMATCH means media verification failed; a
                        download error page is not an ISO. Confirm the selected
                        direct link is available and contains the intended file.
                        New scripts check media before disk changes. Do not
                        retry an old script blindly or weaken Remote Desktop
                        settings.
                      </p>
                    )}
                    <p className="mono">
                      {wasReady
                        ? "Completed in"
                        : run.stage === "failed"
                          ? "Stopped after"
                          : "Elapsed"}
                      :{" "}
                      {(wasReady || run.stage === "failed") && !run.finishedAt
                        ? "Not recorded"
                        : installationDuration(
                            run.startedAt || run.createdAt,
                            run.finishedAt,
                            now
                          )}
                    </p>
                    {run.phase && progress.downloaded !== null && (
                      <div className="deployment-progress">
                        <div className="progress-heading">
                          <span>ISO {run.phase.replaceAll("_", " ")}</span>
                          {progress.percent !== null && (
                            <strong>{progress.percent.toFixed(1)}%</strong>
                          )}
                        </div>
                        {progress.percent !== null && (
                          <div
                            className="progress-track"
                            role="progressbar"
                            aria-valuenow={progress.percent}
                            aria-valuemin={0}
                            aria-valuemax={100}
                          >
                            <span style={{ width: `${progress.percent}%` }} />
                          </div>
                        )}
                        <small>
                          {(progress.downloaded / 1048576).toFixed(1)} MiB
                          downloaded
                          {progress.total !== null
                            ? ` / ${(progress.total / 1048576).toFixed(1)} MiB`
                            : " · total size unavailable"}
                        </small>
                      </div>
                    )}
                    {run.windowsEdition && (
                      <p>
                        Reported edition {run.windowsEdition} · build{" "}
                        {run.windowsBuild}
                      </p>
                    )}
                    {wasReady && (
                      <p>
                        The completed run reported a local RDP listener. You can
                        try Remote Desktop to {run.publicIP || "your VPS IP"}:
                        {run.rdpPort} using your dashboard credentials.
                        First-login privacy setup or licensing may still need
                        your attention.
                      </p>
                    )}
                    <div className="run-id">Deployment {run.runId}</div>
                  </article>
                );
              })}
            </>
          )}
        </div>
        <aside className="tracker-context">
          <ShieldCheck size={22} />
          <h2>Review installation details.</h2>
          <p>
            ISO download or reboot is not installation success. A Windows-ready
            status update reports a running Windows installation and local
            Remote Desktop service—not provider firewall access, password
            authentication or a usable desktop.
          </p>
          <p className="tracker-footnote">
            Keep this link private. Passwords and raw installer logs are not
            shown here. If status updates stop, inspect your provider console or
            installer logs; this view cannot retry or repair a target
            automatically. Tracking depends on this server remaining online.
          </p>
        </aside>
      </div>
    </main>
  );
}
