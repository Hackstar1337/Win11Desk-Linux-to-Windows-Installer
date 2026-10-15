import { deploymentStatusLabel } from "../../../../shared/deploymentStatus";
import {
  installationDuration,
  transferProgress,
  rdpAddress,
  profileOptionLabel,
} from "../../../../shared/deploymentPresentation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  ArrowUpRight,
} from "lucide-react";
import { api, formatDate } from "./api";
import { Link } from "wouter";
import { GlowBorderCard } from "../vengeance/glow-border-card";
import AnimatedButton from "../vengeance/animated-button";
import { AnimatedNumber } from "../vengeance/animated-number";
import "../../pages/control/screens/DeploymentsPage.css";

type Deployment = {
  launchMethod?: "manual" | "ssh";
  remoteJobId?: string | null;
  profile?: { id: string; name: string; revision: number; osId: string } | null;
  os?: string;
  id?: string;
  label?: string | null;
  stage?: string | null;
  status?: string | null;
  stale?: boolean | null;
  phase?: string | null;
  downloadedBytes?: number | null;
  totalBytes?: number | null;
  createdAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  lastHeartbeatAt?: string | null;
  publicIP?: string | null;
  rdpPort?: number | string | null;
  commandRemotePort?: number | string | null;
  username?: string | null;
  hostname?: string | null;
  windowsInstallationType?: string | null;
  windowsEdition?: string | null;
  windowsBuild?: number | string | null;
  rdpListening?: boolean | number | null;
  credentialAvailable?: boolean | null;
};

function formatBytes(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(2)} GiB`;
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${Math.round(n).toLocaleString()} bytes`;
}

function stateLabel(value: string) {
  return deploymentStatusLabel(value);
}

function StateBadge({ value }: { value?: string | null }) {
  const safe = value || "unknown";
  return (
    <span
      className={`state-badge state-${safe.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
    >
      <i /> {stateLabel(safe)}
    </span>
  );
}

function CopyValueButton({
  value,
  label = "Copy",
  onError,
}: {
  value?: string | null;
  label?: string;
  onError: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);
  async function copy() {
    if (!value) return;
    if (!navigator.clipboard?.writeText) {
      onError("Clipboard access is unavailable in this browser.");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch (error) {
      onError(
        error instanceof Error
          ? `Copy failed: ${error.message}`
          : "Copy failed; the clipboard was not changed."
      );
    }
  }
  return (
    <button
      className="text-button"
      type="button"
      onClick={() => void copy()}
      disabled={!value}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}{" "}
      {copied ? "Copied" : label}
    </button>
  );
}

function isCredentialCancellation(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? error.name : undefined;
  const message = "message" in error ? error.message : undefined;
  return (
    name === "AbortError" ||
    message === "Credential request cancelled because the page changed."
  );
}

function useElapsed(startedAt?: string | null, finishedAt?: string | null) {
  const [now, setNow] = useState(Date.now());
  const start = startedAt ? Date.parse(startedAt) : NaN;
  const finish = finishedAt ? Date.parse(finishedAt) : NaN;
  useEffect(() => {
    if (Number.isFinite(finish)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [finish]);
  return installationDuration(startedAt, finishedAt, now);
}

function CredentialControls({
  deployment,
  onError,
  passwordOnly = false,
}: {
  deployment: Deployment;
  onError: (message: string) => void;
  passwordOnly?: boolean;
}) {
  const [credential, setCredential] = useState<{
    username: string;
    password: string;
    expiresAt: number;
  } | null>(null);
  const [busy, setBusy] = useState<"copy" | "reveal" | null>(null);
  const [copied, setCopied] = useState<"username" | "password" | null>(null);
  const [remaining, setRemaining] = useState(0);
  const available = Boolean(deployment.credentialAvailable && deployment.id);
  const requestGeneration = useRef(0);
  const pendingRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    const clear = () => {
      requestGeneration.current++;
      pendingRequest.current?.abort();
      pendingRequest.current = null;
      setCredential(null);
      setCopied(null);
      setBusy(null);
    };
    const onVisibility = () => {
      if (document.hidden) clear();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clear();
    };
  }, [deployment.id, available]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);
  useEffect(() => {
    if (!credential) {
      setRemaining(0);
      return;
    }
    const update = () =>
      setRemaining(
        Math.max(0, Math.ceil((credential.expiresAt - Date.now()) / 1000))
      );
    update();
    const timer = window.setInterval(update, 1000);
    const expiry = window.setTimeout(
      () => setCredential(null),
      Math.max(0, credential.expiresAt - Date.now())
    );
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(expiry);
    };
  }, [credential]);
  async function fetchCredential() {
    pendingRequest.current?.abort();
    const generation = ++requestGeneration.current;
    const controller = new AbortController();
    pendingRequest.current = controller;
    if (!deployment.id)
      throw new Error("Deployment identifier is unavailable.");
    const result = await api<any>(
      `/api/admin/deployments/${encodeURIComponent(deployment.id)}/reveal`,
      { method: "POST", signal: controller.signal }
    );
    if (
      generation !== requestGeneration.current ||
      controller.signal.aborted ||
      document.hidden
    )
      throw new Error("Credential request cancelled because the page changed.");
    const username = result?.username || deployment.username;
    const password = result?.password;
    if (!password || typeof password !== "string")
      throw new Error("No Windows credential is currently available.");
    return { username: String(username || ""), password };
  }
  async function copyCredential(kind: "username" | "password") {
    if (!available) return;
    setBusy("copy");
    onError("");
    try {
      const value = credential || (await fetchCredential());
      if (document.hidden) return;
      const text = kind === "username" ? value.username : value.password;
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard access is unavailable in this browser.");
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      // Do not populate credential state for a copy-only request: Copy never reveals the password visually.
    } catch (error) {
      if (!isCredentialCancellation(error))
        onError(
          error instanceof Error
            ? `Copy failed: ${error.message}`
            : "Copy failed; the clipboard was not changed."
        );
    } finally {
      setBusy(null);
    }
  }
  async function reveal() {
    if (!available) return;
    if (credential) {
      setCredential(null);
      return;
    }
    setBusy("reveal");
    onError("");
    try {
      const value = await fetchCredential();
      if (document.hidden) return;
      setCredential({ ...value, expiresAt: Date.now() + 30000 });
    } catch (error) {
      if (!isCredentialCancellation(error))
        onError(
          error instanceof Error ? error.message : "Credential reveal failed."
        );
    } finally {
      setBusy(null);
    }
  }
  const username = credential?.username || deployment.username || "Unavailable";
  const passwordValue = (
    <>
      <code>{credential ? credential.password : "********"}</code>
      <button
        className="text-button"
        type="button"
        onClick={() => void copyCredential("password")}
        disabled={!available || busy !== null}
      >
        {copied === "password" ? <Check size={13} /> : <Copy size={13} />}
        {copied === "password" ? "Copied" : "Copy"}
      </button>
      <button
        className="text-button"
        type="button"
        onClick={() => void reveal()}
        disabled={!available || busy !== null}
      >
        {busy === "reveal" ? (
          <LoaderCircle size={13} className="spin" />
        ) : (
          <KeyRound size={13} />
        )}
        {credential ? "Hide" : "Reveal"}
      </button>
    </>
  );
  return (
    <div className="credential-controls">
      {!passwordOnly && (
        <div className="credential-line">
          <span className="credential-label">Username</span>
          <div className="connection-value">
            <code>
              {credential ? username : deployment.username || "Unavailable"}
            </code>
            <CopyValueButton value={deployment.username} onError={onError} />
          </div>
        </div>
      )}
      <div className="credential-line credential-password">
        {!passwordOnly && (
          <span className="credential-label">RDP password</span>
        )}
        {passwordOnly ? (
          passwordValue
        ) : (
          <div className="connection-value">{passwordValue}</div>
        )}
      </div>
      {credential && (
        <small className="credential-expiry">visible for {remaining}s</small>
      )}
    </div>
  );
}

export default function DeploymentPresentation({
  deployment,
  trackerUrl,
  onRdpDownload,
  compact = false,
}: {
  deployment: Deployment;
  trackerUrl?: string | null;
  onRdpDownload?: () => void;
  compact?: boolean;
}) {
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const measuredElapsed = useElapsed(
    deployment.startedAt,
    deployment.finishedAt
  );
  const terminalStage =
    deployment.stage === "windows_ready" ||
    deployment.stage === "failed" ||
    deployment.status === "completed" ||
    deployment.status === "failed";
  const elapsed =
    terminalStage && !deployment.finishedAt ? "Not recorded" : measuredElapsed;
  const heartbeatAge = useMemo(() => {
    if (!deployment.lastHeartbeatAt) return "—";
    const seconds = Math.max(
      0,
      Math.floor((now - Date.parse(deployment.lastHeartbeatAt)) / 1000)
    );
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  }, [deployment.lastHeartbeatAt, now]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const status =
    deployment.status ||
    (deployment.stage === "windows_ready"
      ? "completed"
      : deployment.stage === "failed"
        ? "failed"
        : "installing");
  const stale = Boolean(deployment.stale || status === "stale");
  const {
    downloaded,
    total,
    percent: measuredPercent,
  } = transferProgress(deployment.downloadedBytes, deployment.totalBytes);
  const hasDownloaded = downloaded !== null;
  const hasTotal = total !== null;
  const percent = deployment.phase ? measuredPercent : null;
  const port = deployment.rdpPort || deployment.commandRemotePort;
  const address = rdpAddress(deployment.publicIP, port) || "Unavailable";
  const isTerminal = status === "completed" || status === "failed";
  const railStages = [
    { number: "01", label: "Preflight", key: "preflight" },
    { number: "02", label: "Transfer", key: "download" },
    { number: "03", label: "Windows ready", key: "windows_ready" },
  ];
  const railIndex = deployment.stage
    ? railStages.findIndex(item => deployment.stage?.includes(item.key))
    : -1;
  return (
    <div
      className={`deployment-presentation vng-presentation ${compact ? "is-compact" : ""}`}
    >
      <GlowBorderCard
        className="vng-presentation__glow"
        width="100%"
        height="auto"
        aspectRatio="unset"
        borderRadius="12px"
        borderWidth="1px"
        blurAmount="10px"
        inset="-1px"
        animationDuration={7}
        gradientColors={["#2b2149", "#a78bfa", "#252038", "#4b3b76", "#2b2149"]}
        paused={compact}
      >
        <div className="vng-presentation__body">
          {deployment.profile && (
            <p className="vng-presentation__profile">
              <Link href={`/profiles/${deployment.profile.id}`}>
                {profileOptionLabel(
                  deployment.profile.name,
                  deployment.os || deployment.profile.name
                )}
              </Link>{" "}
              · issued revision {deployment.profile.revision}
            </p>
          )}
          <div className="vng-presentation__head">
            <div className="vng-presentation__identity">
              <span className="vng-history__overline">
                run / {deployment.id || "unassigned"}
              </span>
              <h3>
                {deployment.label ||
                  deployment.hostname ||
                  deployment.id ||
                  "Deployment"}
              </h3>
              <div className="vng-presentation__badges deployment-status-row">
                <StateBadge value={status} />
                {deployment.stage && (
                  <span className="stage-name">
                    {stateLabel(deployment.stage)}
                  </span>
                )}
                {stale && status !== "stale" && <StateBadge value="stale" />}
              </div>
            </div>
            <div className="vng-presentation__elapsed deployment-timer">
              <span>
                {status === "completed"
                  ? "Completed in"
                  : status === "failed"
                    ? "Stopped after"
                    : "Elapsed"}
              </span>
              <strong>{elapsed}</strong>
            </div>
          </div>
          <div
            className="vng-presentation__rail"
            aria-label="Deployment workflow stages"
          >
            {railStages.map((item, index) => {
              const current = index === railIndex;
              const terminal = index === 2 && status === "completed";
              return (
                <div
                  className={`vng-presentation__rail-step ${current ? "is-current" : ""} ${terminal ? "is-terminal" : ""}`}
                  key={item.key}
                >
                  <b>{item.number}</b>
                  <strong>{item.label}</strong>
                  <small>
                    {current
                      ? "Current evidence"
                      : terminal
                        ? "Recorded"
                        : "Awaiting evidence"}
                  </small>
                </div>
              );
            })}
          </div>
          <div className="vng-presentation__measurements">
            {(!isTerminal || (downloaded !== null && downloaded > 0)) && (
              <div className="vng-presentation__progress">
                <div className="vng-presentation__progress-head">
                  <span>
                    {deployment.phase
                      ? stateLabel(String(deployment.phase))
                      : "ISO download"}
                  </span>
                  {percent !== null && (
                    <span className="vng-progress-number">
                      <span className="sr-only">{percent.toFixed(1)}%</span>
                      <span
                        aria-hidden="true"
                        className="inline-flex items-center"
                      >
                        <AnimatedNumber
                          value={Number(percent.toFixed(1).split(".")[0])}
                        />
                        <span>.{percent.toFixed(1).split(".")[1]}%</span>
                      </span>
                    </span>
                  )}
                </div>
                {percent !== null ? (
                  <div
                    className="progress-track"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                    aria-label={`${percent.toFixed(1)} percent for ${deployment.phase}`}
                  >
                    <span style={{ width: `${percent}%` }} />
                  </div>
                ) : (
                  <p className="form-hint">
                    Transfer percentage unavailable until both downloaded and
                    total bytes are reported.
                  </p>
                )}
                {hasDownloaded && (
                  <small>
                    {formatBytes(downloaded)} downloaded
                    {hasTotal
                      ? ` / ${formatBytes(total)}`
                      : " · total size unavailable"}
                  </small>
                )}
              </div>
            )}
            <div className="vng-presentation__facts deployment-facts">
              <div className="vng-presentation__fact">
                <span>Created</span>
                <strong>{formatDate(deployment.createdAt)}</strong>
              </div>
              <div className="vng-presentation__fact">
                <span>Started</span>
                <strong>{formatDate(deployment.startedAt)}</strong>
              </div>
              <div className="vng-presentation__fact">
                <span>{status === "failed" ? "Stopped" : "Completed"}</span>
                <strong>{formatDate(deployment.finishedAt)}</strong>
              </div>
              <div className="vng-presentation__fact">
                <span>Timer</span>
                <strong>{elapsed}</strong>
              </div>
              <div className="vng-presentation__fact">
                <span>Heartbeat</span>
                <strong className={stale ? "awaiting-update-hint" : ""}>
                  {isTerminal ? "Reporter finished" : heartbeatAge}
                  {stale && !isTerminal ? " · Awaiting update" : ""}
                </strong>
              </div>
              <div className="vng-presentation__fact">
                <span>Windows evidence</span>
                <strong>
                  {deployment.windowsEdition
                    ? `${deployment.windowsEdition}${deployment.windowsBuild ? ` · build ${deployment.windowsBuild}` : ""}${deployment.windowsInstallationType ? ` · ${deployment.windowsInstallationType}` : ""}`
                    : "Not reported"}
                </strong>
              </div>
            </div>
          </div>
          <div className="vng-presentation__connection">
            <div className="vng-presentation__connection-heading">
              <span>Connection & credentials</span>
              {deployment.rdpListening != null && (
                <small>
                  {deployment.rdpListening
                    ? "RDP listener reported"
                    : "RDP listener not confirmed"}
                </small>
              )}
            </div>
            <div className="connection-line">
              <span>IP ADDRESS:</span>
              <div className="connection-value">
                <code>{address}</code>
                <CopyValueButton
                  value={deployment.publicIP && port ? address : undefined}
                  onError={setError}
                />
              </div>
            </div>
            <CredentialControls deployment={deployment} onError={setError} />
            {error && (
              <p className="field-error vng-presentation__error" role="alert">
                {error}
              </p>
            )}
            <div className="vng-presentation__actions">
              {onRdpDownload && deployment.publicIP && (
                <AnimatedButton
                  className="vng-action"
                  type="button"
                  onClick={onRdpDownload}
                >
                  <ExternalLink size={13} /> RDP helper
                </AnimatedButton>
              )}
              {trackerUrl && (
                <a
                  className="text-button"
                  href={trackerUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={13} /> Open tracker
                </a>
              )}
            </div>
          </div>
        </div>
      </GlowBorderCard>
    </div>
  );
}

export function DeploymentTableRow({
  deployment,
  label,
  selected,
  onSelect,
  onRdpDownload,
}: {
  deployment: Deployment;
  label?: string | null;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  onRdpDownload?: () => void;
}) {
  const [error, setError] = useState("");
  const elapsedLive = useElapsed(deployment.startedAt, deployment.finishedAt);
  const terminal =
    deployment.stage === "windows_ready" ||
    deployment.stage === "failed" ||
    deployment.status === "completed" ||
    deployment.status === "failed";
  const elapsed =
    terminal && !deployment.finishedAt ? "Not recorded" : elapsedLive;
  const status =
    deployment.status ||
    (deployment.stage === "windows_ready"
      ? "completed"
      : deployment.stage === "failed"
        ? "failed"
        : "installing");
  const progress = transferProgress(
    deployment.downloadedBytes,
    deployment.totalBytes
  );
  const address = rdpAddress(
    deployment.publicIP,
    deployment.rdpPort || deployment.commandRemotePort
  );
  const humanLabel =
    label && !/^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(label)
      ? label
      : deployment.hostname || "Deployment";
  return (
    <tr className="deployment-table-row" data-run-id={deployment.id}>
      <td className="row-select">
        <input
          type="checkbox"
          checked={selected}
          onChange={e => onSelect(e.target.checked)}
          aria-label={`Select ${deployment.id}`}
        />
      </td>
      <td className="row-created">
        <Link
          className="table-link row-label"
          title={label || deployment.id || undefined}
          href={`/deployments/${deployment.id}`}
        >
          {humanLabel}
          {deployment.profile &&
            humanLabel.trim().toLowerCase() !==
              deployment.profile.name.trim().toLowerCase() && (
              <span
                className="row-profile"
                title={`${deployment.profile.name} · revision ${deployment.profile.revision}`}
              >
                {deployment.profile.name}
              </span>
            )}
        </Link>
        <time dateTime={deployment.createdAt || undefined}>
          {formatDate(deployment.createdAt)} ·{" "}
          {deployment.launchMethod === "ssh" ? "SSH" : "Manual"}
        </time>
      </td>
      <td className="row-address">
        <div className="connection-line">
          <code>{address || "Not reported"}</code>
          <CopyValueButton value={address} onError={setError} />
        </div>
      </td>
      <td className="row-username">
        <div className="credential-line">
          <code title={deployment.username || undefined}>
            {deployment.username || "Not reported"}
          </code>
          <CopyValueButton value={deployment.username} onError={setError} />
        </div>
      </td>
      <td className="row-password">
        <CredentialControls
          deployment={deployment}
          onError={setError}
          passwordOnly
        />
        {error && (
          <span className="row-error" role="alert">
            {error}
          </span>
        )}
      </td>
      <td className="row-state">
        <StateBadge value={status} />
        <span className="row-stage">
          {stateLabel(deployment.stage || "starting")}
        </span>
        {!terminal && deployment.phase && (
          <div className="row-progress">
            <span>
              {stateLabel(deployment.phase)}
              {progress.percent !== null
                ? ` · ${progress.percent.toFixed(1)}%`
                : progress.downloaded !== null
                  ? ` · ${formatBytes(progress.downloaded)}`
                  : " · waiting for bytes"}
            </span>
            {progress.percent !== null && (
              <div
                className="progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress.percent}
                aria-label={`${progress.percent.toFixed(1)} percent for ${deployment.phase}`}
              >
                <span style={{ width: `${progress.percent}%` }} />
              </div>
            )}
          </div>
        )}
      </td>
      <td className="row-duration">
        <div className="deployment-timer">
          <strong
            title={
              terminal
                ? status === "completed"
                  ? "Completed in"
                  : "Stopped after"
                : "Elapsed"
            }
          >
            {elapsed}
          </strong>
        </div>
      </td>
      <td className="row-actions">
        <Link
          className="text-button"
          href={`/deployments/${deployment.id}`}
          aria-label={`Details for ${address || humanLabel}`}
          title="Full details and tracker"
        >
          <ArrowUpRight size={14} />
          <span>Details</span>
        </Link>
        {onRdpDownload && address && (
          <button
            className="text-button"
            type="button"
            onClick={onRdpDownload}
            title="Download RDP helper"
            aria-label={`RDP helper for ${address}`}
          >
            <ExternalLink size={13} />
            <span>RDP</span>
          </button>
        )}
      </td>
    </tr>
  );
}
