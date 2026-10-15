import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  KeyRound,
  LoaderCircle,
  Search,
  Shield,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { api, loadMe, newIdempotencyKey } from "../api";
import type { User } from "../api";
import RemoteJobPanel from "./RemoteJobPanel";
import type {
  RemoteReview,
  RemoteSettings,
  RemoteTarget,
  TargetInventory,
} from "../../../../../shared/remoteInstall";
import AnimatedButton from "../../vengeance/animated-button";
import { GlowBorderCard } from "../../vengeance/glow-border-card";
import { KineticTextLoader } from "../../vengeance/kinetic-text-loader";
import "./remote-install.css";

export type RemoteInstallPanelProps = {
  settings: RemoteSettings | null;
  user?: User | null;
  profileName?: string;
  onSubmitted?: (jobId: string) => void;
  onBusyChange?: (busy: boolean) => void;
};

type Discovery = { fingerprint: string; keyType: string };
type CheckResponse = {
  checkId: string;
  fingerprint?: string;
  keyType?: string;
  inventory: TargetInventory;
};
type ReviewResponse = { review: RemoteReview } | RemoteReview;
type FeatureUser = {
  role?: string;
  permissions?: string[];
  featureConfig?: Record<string, unknown>;
  features?: Record<string, unknown>;
};

function featureEnabled(user: unknown) {
  const value = (user || {}) as FeatureUser;
  const config = value.featureConfig || value.features;
  if (
    !config ||
    !(
      "remoteInstall" in config ||
      "remote_install" in config ||
      "remote" in config
    )
  )
    return true;
  return Boolean(
    config.remoteInstall ?? config.remote_install ?? config.remote
  );
}

function canInstall(user: unknown) {
  const value = (user || {}) as FeatureUser;
  const permission =
    !value.permissions || value.permissions.includes("remote:install");
  return (
    (value.role === "owner" || value.role === "admin") &&
    permission &&
    featureEnabled(user)
  );
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function targetOf(host: string, port: string): RemoteTarget {
  return { host: host.trim(), port: Number(port) || 22, username: "root" };
}

function withoutPassword(settings: RemoteSettings | null) {
  if (!settings) return null;
  const { password: _password, ...safe } = settings;
  return safe;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value < 0) return "Unknown";
  const units = ["bytes", "KiB", "MiB", "GiB", "TiB"];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(index ? 1 : 0)} ${units[index]}`;
}

export default function RemoteInstallPanel({
  settings,
  profileName,
  user,
  onSubmitted,
  onBusyChange,
}: RemoteInstallPanelProps) {
  const [loadedUser, setLoadedUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(!user);
  const [featureAllowed, setFeatureAllowed] = useState(false);
  useEffect(() => {
    if (user) {
      setLoadedUser(user);
      setAuthLoading(false);
      return;
    }
    let active = true;
    void loadMe()
      .then(result => {
        if (active) setLoadedUser(result.user);
      })
      .catch(() => {
        if (active) setLoadedUser(null);
      })
      .finally(() => {
        if (active) setAuthLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user]);
  const effectiveUser = user ?? loadedUser;
  useEffect(() => {
    if (!effectiveUser) return;
    let active = true;
    void api<{ enabled?: boolean }>("/api/admin/remote/config")
      .then(config => {
        if (active && typeof config?.enabled === "boolean")
          setFeatureAllowed(config.enabled);
      })
      .catch(() => {
        if (active) setFeatureAllowed(false);
      });
    return () => {
      active = false;
    };
  }, [effectiveUser]);
  const allowed = canInstall(effectiveUser) && featureAllowed;
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [sshPassword, setSshPassword] = useState("");
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [trustHostKey, setTrustHostKey] = useState(false);
  const [inventory, setInventory] = useState<TargetInventory | null>(null);
  const [checkId, setCheckId] = useState("");
  const [review, setReview] = useState<RemoteReview | null>(null);
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [eraseConfirmed, setEraseConfirmed] = useState(false);
  const [busy, setBusy] = useState<
    "discover" | "check" | "review" | "install" | "health" | ""
  >("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submittedJobId, setSubmittedJobId] = useState("");
  useEffect(() => {
    onBusyChange?.(busy !== "");
  }, [busy, onBusyChange]);
  const jobKey = useRef({ reviewId: "", key: "" });
  const generation = useRef(0);
  const requests = useRef<AbortController[]>([]);
  const previousSettingsKey = useRef("");
  const previousTargetKey = useRef("");

  const target = useMemo(() => targetOf(host, port), [host, port]);
  const targetKey = useMemo(() => JSON.stringify(target), [target]);
  const settingsKey = useMemo(() => JSON.stringify(settings), [settings]);
  const windowsSummary = useMemo(
    () =>
      settings
        ? `${settings.username} · RDP ${settings.remotePort}`
        : "Choose a ready profile and complete Windows settings first.",
    [settings]
  );

  const invalidate = useCallback((message = "", preserveHost = false) => {
    generation.current += 1;
    setBusy("");
    requests.current.forEach(controller => controller.abort());
    requests.current = [];
    if (!preserveHost) {
      setDiscovery(null);
      setTrustHostKey(false);
    }
    setInventory(null);
    setCheckId("");
    setReview(null);
    setBackupConfirmed(false);
    setEraseConfirmed(false);
    setError("");
    setNotice(message);
  }, []);

  useEffect(() => {
    if (previousTargetKey.current && previousTargetKey.current !== targetKey)
      invalidate("VPS address or port changed. Discover and check it again.");
    previousTargetKey.current = targetKey;
  }, [targetKey, invalidate]);

  useEffect(() => {
    if (
      previousSettingsKey.current &&
      previousSettingsKey.current !== settingsKey
    )
      invalidate(
        "Windows settings changed. Run the connection check and review again."
      );
    previousSettingsKey.current = settingsKey;
  }, [settingsKey, invalidate]);

  useEffect(
    () => () => requests.current.forEach(controller => controller.abort()),
    []
  );

  async function request<T>(
    path: string,
    options: RequestInit,
    kind: typeof busy
  ) {
    const controller = new AbortController();
    const requestGeneration = generation.current;
    requests.current.push(controller);
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 75000);
    setBusy(kind);
    setError("");
    try {
      const value = await api<T>(path, {
        ...options,
        signal: controller.signal,
      });
      if (requestGeneration !== generation.current) return null;
      return value;
    } catch (reason) {
      if (requestGeneration === generation.current) {
        if (timedOut)
          setError(
            kind === "install"
              ? "The install request timed out. Check Remote installations before trying again; do not repeat an uncertain launch."
              : "The connection request timed out. Check the VPS SSH service, SSH port and firewall, then enter its password again to test."
          );
        else if (!(reason instanceof Error && reason.name === "AbortError"))
          setError(errorText(reason, "Remote request failed."));
      }
      return null;
    } finally {
      window.clearTimeout(timeout);
      requests.current = requests.current.filter(item => item !== controller);
      if (requestGeneration === generation.current) setBusy("");
    }
  }

  async function discover() {
    if (
      !target.host ||
      !Number.isInteger(target.port) ||
      target.port < 1 ||
      target.port > 65535
    ) {
      setError("Enter a public IP address and valid SSH port.");
      return;
    }
    const result = await request<Discovery>(
      "/api/admin/remote/discover",
      { method: "POST", body: JSON.stringify({ target }) },
      "discover"
    );
    if (result) {
      setDiscovery({
        fingerprint: result.fingerprint,
        keyType: result.keyType || "SSH host key",
      });
      setNotice(
        "Host identity discovered. Compare it with your provider console before trusting it."
      );
    }
  }

  async function testConnection() {
    if (!settings) {
      setError(
        "Complete the Windows settings and choose a ready profile first."
      );
      return;
    }
    if (!discovery || !trustHostKey) {
      setError(
        "Discover the host and explicitly trust its displayed host key before testing."
      );
      return;
    }
    if (!sshPassword) {
      setError("Enter the SSH password for this one-time connection.");
      return;
    }
    const submittedPassword = sshPassword;
    setSshPassword("");
    const result = await request<CheckResponse>(
      "/api/admin/remote/checks",
      {
        method: "POST",
        body: JSON.stringify({
          target,
          password: submittedPassword,
          fingerprint: discovery.fingerprint,
          trustHostKey: true,
        }),
      },
      "check"
    );
    if (result) {
      setCheckId(result.checkId);
      setInventory(result.inventory);
      setNotice(
        "Read-only target check passed. No installer was sent and the target was not changed."
      );
      setSshPassword("");
    }
  }

  async function createReview() {
    if (!settings || !checkId || !inventory || !discovery) {
      setError(
        "Run a successful target check before reviewing the installation."
      );
      return;
    }
    const result = await request<ReviewResponse>(
      "/api/admin/remote/reviews",
      { method: "POST", body: JSON.stringify({ checkId, settings }) },
      "review"
    );
    if (result) {
      const value = "review" in result ? result.review : result;
      setReview(value);
      setNotice(
        "Settings reviewed. Changing the VPS or Windows settings requires a new connection check and review."
      );
    }
  }

  async function install() {
    if (!review || !backupConfirmed || !eraseConfirmed) {
      setError(
        "Confirm backup/recovery and whole-disk erasure before installing."
      );
      return;
    }
    if (jobKey.current.reviewId !== review.id)
      jobKey.current = { reviewId: review.id, key: newIdempotencyKey() };
    const result = await request<{ id?: string; job?: { id: string } }>(
      "/api/admin/remote/jobs",
      {
        method: "POST",
        body: JSON.stringify({
          reviewId: review.id,
          approvalDigest: review.approvalDigest,
          idempotencyKey: jobKey.current.key,
          backupConfirmed: true,
          recoveryConfirmed: true,
          eraseConfirmed: true,
        }),
      },
      "install"
    );
    if (result) {
      const submittedId = result.job?.id || result.id || "";
      if (!submittedId) {
        setError(
          "The server did not return a job ID. Check Remote installations before retrying."
        );
        return;
      }
      setSubmittedJobId(submittedId);
      setNotice(
        "Installation started. Your approved job was accepted and queued; follow its reported progress in Deployment history."
      );
      setSshPassword("");
      onSubmitted?.(submittedId);
    }
  }

  if (authLoading)
    return (
      <section
        className="remote-install remote-vng-page panel"
        aria-label="Install via SSH"
      >
        <div className="remote-vng-loading-screen">
          <KineticTextLoader text="Loading" className="remote-vng-loader" />
          <p>Checking remote-install permission…</p>
        </div>
      </section>
    );
  if (!allowed)
    return (
      <section
        className="remote-install remote-vng-page panel"
        aria-label="Install via SSH"
      >
        <div className="remote-vng-locked">
          <span className="remote-vng-kicker">
            REMOTE INSTALLATIONS / ACCESS
          </span>
          <Shield size={23} aria-hidden="true" />
          <strong>Install via SSH is unavailable</strong>
          <p>
            Remote installation requires the owner/admin role and the enabled
            remote-install feature. Ordinary preview environments do not contact
            real SSH hosts.
          </p>
        </div>
      </section>
    );

  const inventoryWithNominal = inventory as
    | (TargetInventory & { nominalMemoryMiB?: number })
    | null;
  const reviewInventory = review?.inventory as
    | (TargetInventory & { nominalMemoryMiB?: number })
    | undefined;
  const activeStep = submittedJobId
    ? 5
    : review
      ? 4
      : inventory
        ? 3
        : discovery
          ? 2
          : 1;
  const busyLabel =
    busy === "discover"
      ? "Discovering host…"
      : busy === "check"
        ? "Running read-only check…"
        : busy === "review"
          ? "Freezing review…"
          : busy === "install"
            ? "Queueing install…"
            : "Working…";

  return (
    <section
      className="remote-install remote-vng-page panel"
      aria-labelledby="remote-install-title"
    >
      <header className="remote-vng-hero remote-vng-install-hero">
        <div>
          <span className="remote-vng-kicker">
            REMOTE INSTALLATIONS / SSH CONTROL
          </span>
          <h1 id="remote-install-title">Install Windows on your VPS</h1>
          <p>
            Enter your Linux VPS details, check the connection, then review the
            disk and Windows settings before installing.
          </p>
        </div>
        <div className="remote-vng-hero-meta remote-vng-hero-meta-stack">
          <span className="remote-vng-protocol">
            <i />
            SSH / ROOT ONLY
          </span>
          <small>
            The one-time SSH password is cleared before the connection request
            is sent.
          </small>
        </div>
      </header>

      <div className="remote-vng-install-layout">
        <aside
          className="remote-vng-workflow-rail"
          aria-label="Remote installation steps"
        >
          <span className="remote-vng-kicker">INSTALLATION STEPS</span>
          {[
            [1, "Target", "Host and port"],
            [2, "Trust", "Fingerprint"],
            [3, "Preflight", "Read-only check"],
            [4, "Review", "Confirmed settings"],
            [5, "Launch", "Start once"],
          ].map(([number, title, detail]) => (
            <div
              className={`remote-vng-workflow-step ${activeStep >= Number(number) ? "is-reached" : ""} ${activeStep === Number(number) ? "is-active" : ""}`}
              key={number}
            >
              <span>{String(number).padStart(2, "0")}</span>
              <div>
                <strong>{title}</strong>
                <small>{detail}</small>
              </div>
            </div>
          ))}
          <div className="remote-vng-rail-boundary">
            <Shield size={14} aria-hidden="true" />
            <span>
              Approved target only.
              <br />
              No worker contact before you act.
            </span>
          </div>
        </aside>

        <div className="remote-install-body remote-vng-install-body">
          <div className="remote-vng-section-intro">
            <span className="remote-vng-kicker">01 / TARGET + TRUST</span>
            <h2>Connect to your Linux VPS</h2>
            <p>
              Discovering a host never logs in. The fingerprint must be compared
              with your provider console before the one-time password is
              submitted.
            </p>
          </div>
          <div className="remote-section remote-vng-section">
            <div className="remote-vng-section-heading">
              <div>
                <span className="remote-vng-section-number">01</span>
                <div>
                  <h3>Target VPS</h3>
                  <p>
                    Use the root login for your Linux VPS. Its password is
                    cleared from this form after sending and temporarily
                    encrypted for your approved installation.
                  </p>
                </div>
              </div>
              <span className="remote-vng-chip">
                {discovery ? "IDENTITY FOUND" : "NOT CONNECTED"}
              </span>
            </div>
            <div className="remote-grid remote-vng-grid">
              <label className="field">
                <span>Public IP address</span>
                <input
                  aria-label="Public IP address"
                  value={host}
                  onChange={e => setHost(e.target.value)}
                  placeholder="203.0.113.20"
                  autoComplete="off"
                  disabled={busy !== ""}
                />
              </label>
              <label className="field">
                <span>SSH port</span>
                <input
                  aria-label="SSH port"
                  type="number"
                  min="1"
                  max="65535"
                  disabled={busy !== ""}
                  value={port}
                  onChange={e => setPort(e.target.value)}
                />
              </label>
              <label className="field">
                <span>SSH username</span>
                <input aria-label="SSH username" value="root" readOnly />
              </label>
              <label className="field">
                <span>SSH password</span>
                <input
                  aria-label="SSH password"
                  type="password"
                  value={sshPassword}
                  onChange={e => {
                    setSshPassword(e.target.value);
                    invalidate(
                      "SSH password changed. Test the connection again.",
                      true
                    );
                  }}
                  autoComplete="off"
                  disabled={busy !== ""}
                />
              </label>
            </div>
            <div className="remote-vng-action-row">
              <AnimatedButton
                type="button"
                className="secondary-button remote-vng-action"
                onClick={() => void discover()}
                disabled={busy !== "" || !host.trim()}
              >
                <Search size={14} aria-hidden="true" /> Discover host
              </AnimatedButton>
              <span className="remote-inline-note">
                No login is attempted during discovery.
              </span>
            </div>
            {discovery && (
              <GlowBorderCard
                className="remote-fingerprint remote-vng-fingerprint"
                width="100%"
                height="auto"
                borderRadius="13px"
                borderWidth="0.4em"
                blurAmount="0.7em"
                inset="-0.35em"
                gradientColors={["#A78BFA", "#313047", "#12111a", "#A78BFA"]}
                paused={!trustHostKey}
              >
                <div>
                  <span className="remote-vng-kicker">
                    HOST KEY / {discovery.keyType}
                  </span>
                  <code>{discovery.fingerprint}</code>
                </div>
                <label className="checkbox-field remote-vng-check-row">
                  <input
                    type="checkbox"
                    checked={trustHostKey}
                    disabled={busy !== ""}
                    onChange={e => {
                      if (!e.target.checked)
                        invalidate("Host trust cleared. Test again.", true);
                      setTrustHostKey(e.target.checked);
                    }}
                  />
                  <span>
                    I compared this fingerprint and explicitly trust this
                    existing host key for this target.
                  </span>
                </label>
              </GlowBorderCard>
            )}
            <div className="remote-vng-action-row">
              <AnimatedButton
                type="button"
                className="primary-button remote-vng-action"
                onClick={() => void testConnection()}
                disabled={
                  busy !== "" || !discovery || !trustHostKey || !settings
                }
              >
                <ShieldCheck size={14} aria-hidden="true" /> Test connection
              </AnimatedButton>
              <span className="remote-inline-note">
                Checks the VPS without changing its disk or installing Windows.
              </span>
            </div>
          </div>

          <div className="remote-vng-split-sections">
            <div className="remote-section remote-vng-section remote-vng-settings-card">
              <div className="remote-vng-section-heading">
                <div>
                  <span className="remote-vng-section-number">02</span>
                  <div>
                    <h3>Windows installation settings</h3>
                    <p>
                      These are your selected Windows settings. Neither password
                      is shown in the review.
                    </p>
                  </div>
                </div>
              </div>
              <div className="remote-settings-summary remote-vng-settings-summary">
                <span>
                  <b>Profile</b>
                  {settings
                    ? `${profileName || "Selected deployment profile"} · version ${settings.profileRevision}`
                    : "Not selected"}
                </span>
                <span>
                  <b>Windows access</b>
                  {windowsSummary}
                </span>
                <span>
                  <b>Optional actions</b>
                  {settings?.postInstall
                    ? "Configured in installer form"
                    : "Off"}
                </span>
              </div>
            </div>
            <div className="remote-vng-scope-note">
              <KeyRound size={15} aria-hidden="true" />
              <div>
                <strong>Private login details</strong>
                <p>
                  Your SSH password is temporarily encrypted for the checked
                  target and approved installation, then cleared after use or
                  expiry. Windows login details stay in the encrypted credential
                  vault.
                </p>
              </div>
            </div>
          </div>

          {inventory && (
            <div
              className="remote-section remote-check-result remote-vng-section remote-vng-check-result"
              aria-label="Target check result"
            >
              <div className="remote-vng-section-heading">
                <div>
                  <span className="remote-vng-section-number">03</span>
                  <div>
                    <h3>VPS connection check</h3>
                    <p>
                      The target has not been staged, installed, or rebooted.
                      Review the detected disk before continuing.
                    </p>
                  </div>
                </div>
                <span className="remote-vng-chip is-success">
                  <CheckCircle2 size={13} aria-hidden="true" /> PASSED
                </span>
              </div>
              <dl className="remote-facts remote-vng-facts">
                <div>
                  <dt>Linux hostname</dt>
                  <dd>{inventory.hostname}</dd>
                </div>
                <div>
                  <dt>Architecture</dt>
                  <dd>{inventory.architecture}</dd>
                </div>
                <div>
                  <dt>Usable Linux memory</dt>
                  <dd>{formatBytes(inventory.memoryMiB * 1024 * 1024)}</dd>
                </div>
                {inventoryWithNominal?.nominalMemoryMiB !== undefined && (
                  <div>
                    <dt>Nominal memory (includes crash reservation)</dt>
                    <dd>
                      {formatBytes(
                        inventoryWithNominal.nominalMemoryMiB * 1024 * 1024
                      )}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Whole disk</dt>
                  <dd className="remote-vng-mono">
                    {inventory.disk} · {formatBytes(inventory.diskBytes)}
                  </dd>
                </div>
                <div>
                  <dt>Virtualization / CPUs</dt>
                  <dd>
                    {inventory.virtualization} · {inventory.cpuCount}
                  </dd>
                </div>
                <div>
                  <dt>Disk serial</dt>
                  <dd>{inventory.diskSerial || "Unavailable"}</dd>
                </div>
                <div>
                  <dt>Dashboard HTTPS</dt>
                  <dd>
                    {inventory.httpsReachable ? "Reachable" : "Unavailable"}
                  </dd>
                </div>
                <div>
                  <dt>Boot mode</dt>
                  <dd>{inventory.bootMode || "Unknown"}</dd>
                </div>
                <div>
                  <dt>Root / runner</dt>
                  <dd>
                    {inventory.root ? "root" : "not root"} · {inventory.runner}
                  </dd>
                </div>
              </dl>
              <div className="remote-vng-action-row">
                <AnimatedButton
                  type="button"
                  className="primary-button remote-vng-action"
                  onClick={() => void createReview()}
                  disabled={busy !== "" || !checkId}
                >
                  <ClipboardCheck size={14} aria-hidden="true" /> Create
                  installation review
                </AnimatedButton>
                <span className="remote-inline-note">
                  Freezes target, disk, fingerprint, profile revision, and
                  settings.
                </span>
              </div>
            </div>
          )}

          {review && (
            <GlowBorderCard
              className="remote-section remote-review remote-vng-review-card"
              aria-label="Final installation review"
              width="100%"
              height="auto"
              borderRadius="16px"
              borderWidth="0.55em"
              blurAmount="0.8em"
              inset="-0.45em"
              gradientColors={["#A78BFA", "#6b3f56", "#23131c", "#A78BFA"]}
              paused={!backupConfirmed || !eraseConfirmed}
            >
              <div className="remote-vng-section-heading">
                <div>
                  <span className="remote-vng-section-number is-danger">
                    04
                  </span>
                  <div>
                    <h3>Final installation review</h3>
                    <p>
                      Check this VPS, its disk and Windows settings. Changing
                      them requires a new connection check and review.
                    </p>
                  </div>
                </div>
                <span className="remote-vng-review-digest">
                  Digest {review.approvalDigest.slice(0, 12)}…
                </span>
              </div>
              <dl className="remote-facts remote-review-facts remote-vng-facts">
                <div>
                  <dt>Target / SSH</dt>
                  <dd className="remote-vng-mono">
                    {review.target.host}:{review.target.port} · root
                  </dd>
                </div>
                <div>
                  <dt>Fingerprint</dt>
                  <dd className="remote-vng-mono">{review.fingerprint}</dd>
                </div>
                <div>
                  <dt>Linux hostname</dt>
                  <dd>{review.inventory.hostname}</dd>
                </div>
                <div>
                  <dt>Whole disk to erase</dt>
                  <dd className="remote-vng-mono">
                    {review.inventory.disk} ·{" "}
                    {formatBytes(review.inventory.diskBytes)}
                  </dd>
                </div>
                <div>
                  <dt>Disk serial</dt>
                  <dd>{review.inventory.diskSerial || "Unavailable"}</dd>
                </div>
                <div>
                  <dt>Preflight evidence</dt>
                  <dd>
                    {review.inventory.architecture} ·{" "}
                    {review.inventory.virtualization} ·{" "}
                    {review.inventory.cpuCount} CPUs ·{" "}
                    {formatBytes(review.inventory.memoryMiB * 1024 * 1024)}{" "}
                    usable · HTTPS{" "}
                    {review.inventory.httpsReachable
                      ? "reachable"
                      : "unavailable"}
                  </dd>
                </div>
                <div>
                  <dt>Profile / revision</dt>
                  <dd>
                    {review.profileName} · {review.settings.profileRevision}
                  </dd>
                </div>
                <div>
                  <dt>Windows access</dt>
                  <dd>
                    {review.settings.username} · RDP{" "}
                    {review.settings.remotePort}
                  </dd>
                </div>
                <div>
                  <dt>Optional choices</dt>
                  <dd>
                    {review.settings.postInstall?.getFiles
                      ? `Files: ${review.settings.postInstall.apps.join(", ") || "none"}${review.settings.postInstall.customFileUrl ? "; custom ZIP/ISO selected" : ""}`
                      : "Get files Off"}
                    ; attached script{" "}
                    {review.settings.postInstall?.runAttachedScript
                      ? "On"
                      : "Off"}
                  </dd>
                </div>
              </dl>
              <div className="remote-confirmations remote-vng-confirmations">
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={backupConfirmed}
                    disabled={busy !== ""}
                    onChange={e => setBackupConfirmed(e.target.checked)}
                  />
                  <span>
                    I have a backup or this is a disposable target, and I can
                    recover through the provider console.
                  </span>
                </label>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={eraseConfirmed}
                    disabled={busy !== ""}
                    onChange={e => setEraseConfirmed(e.target.checked)}
                  />
                  <span>
                    I understand Install and reboot erases the whole selected
                    disk and interrupts the current OS.
                  </span>
                </label>
              </div>
              <div className="remote-vng-destructive-line">
                <AlertTriangle size={15} aria-hidden="true" />
                <span>
                  Installing Windows erases{" "}
                  <strong>{review.inventory.disk}</strong>. It will queue one
                  approved installation.
                </span>
              </div>
              <AnimatedButton
                type="button"
                className="danger-button remote-vng-action remote-vng-launch"
                onClick={() => void install()}
                disabled={busy !== "" || !backupConfirmed || !eraseConfirmed}
              >
                <Zap size={14} aria-hidden="true" />{" "}
                {busy === "install"
                  ? "Queueing install…"
                  : "Install and reboot"}
              </AnimatedButton>
            </GlowBorderCard>
          )}

          {(notice || error) && (
            <div
              className={`remote-message remote-vng-message ${error ? "is-error" : "is-success"}`}
              role={error ? "alert" : "status"}
            >
              {error || notice}
            </div>
          )}
          {busy && (
            <div className="remote-vng-busy" role="status">
              <LoaderCircle
                size={14}
                className="remote-vng-spin"
                aria-hidden="true"
              />{" "}
              {busyLabel}
            </div>
          )}
          <p className="remote-footnote remote-vng-footnote">
            A lost SSH connection does not confirm Windows is ready. Follow
            Deployment history, and check an uncertain job before trying to
            install again.
          </p>
          {submittedJobId && (
            <div
              className="remote-section remote-vng-submitted"
              aria-label="Submitted remote installation"
            >
              <div>
                <span className="remote-vng-kicker">05 / QUEUED</span>
                <h3>Installation submitted</h3>
                <p>
                  Your submitted job remains tracked after passwords are
                  cleared.
                </p>
              </div>
              <a
                className="remote-vng-inline-link"
                href={`/remote-jobs?job=${encodeURIComponent(submittedJobId)}`}
              >
                Open remote job <ArrowUpRight size={13} aria-hidden="true" />
              </a>
              <RemoteJobPanel jobId={submittedJobId} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export { withoutPassword };
