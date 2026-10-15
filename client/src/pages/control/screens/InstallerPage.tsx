import { RemoteInstallPanel } from "../../../components/control/remote-install";
import { remoteSettingsSchema } from "@shared/remoteInstall";
import PostInstallOptions from "../../../components/control/PostInstallOptions";
import {
  defaultPostInstallOptions,
  scriptCompatible,
  type PostInstallOptions as PostOptions,
} from "../../../../../shared/postInstall";
import ProfileSelector from "../../../components/control/ProfileSelector";
import type { ReadyProfile } from "../../../../../shared/deploymentProfiles";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Shield,
  Terminal,
  WandSparkles,
} from "lucide-react";
import {
  api,
  formatDate,
  generateSecurePassword,
  newIdempotencyKey,
} from "../../../components/control/api";
import {
  CopyButton,
  Notice,
  Page,
  Panel,
  StateBadge,
} from "../ControlPrimitives";
import AnimatedButton from "../../../components/vengeance/animated-button";
import { AnimatedNumber } from "../../../components/vengeance/animated-number";
import { GlowBorderCard } from "../../../components/vengeance/glow-border-card";
import { KineticTextLoader } from "../../../components/vengeance/kinetic-text-loader";
import "./InstallerPage.css";

export function InstallerPage() {
  const [, navigate] = useLocation();
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [installMode, setInstallMode] = useState<"manual" | "ssh">("manual");
  const [postOptions, setPostOptions] = useState<PostOptions>({
    ...defaultPostInstallOptions,
    apps: [],
  });
  const [profile, setProfile] = useState<ReadyProfile | null>(null);
  const [profileError, setProfileError] = useState(
    "Loading available operating systems…"
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remotePort, setRemotePort] = useState("");
  const [retries, setRetries] = useState("");
  const [label, setLabel] = useState("");
  const [tags, setTags] = useState("");
  const [count, setCount] = useState("1");
  const [uniquePasswords, setUniquePasswords] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setResult(null);
  }, [
    profile,
    username,
    remotePort,
    retries,
    label,
    tags,
    count,
    uniquePasswords,
    postOptions,
  ]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (profileError || !profile) {
      setError(profileError || "Choose an operating system to continue.");
      return;
    }
    const port = Number(remotePort);
    const retryCount = Number(retries);
    const batchCount = Number(count);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError("RDP port must be a whole number from 1–65535.");
      return;
    }
    if (!Number.isInteger(retryCount) || retryCount < 1 || retryCount > 20) {
      setError("Download retries must be a whole number from 1–20.");
      return;
    }
    if (!Number.isInteger(batchCount) || batchCount < 1 || batchCount > 20) {
      setError("Batch count must be a whole number from 1–20.");
      return;
    }
    if (!uniquePasswords && (password.length < 8 || password.length > 128)) {
      setError("Windows password must be 8–128 characters.");
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const n = Number(count);
      const data = await api<any>("/api/admin/commands", {
        method: "POST",
        body: JSON.stringify({
          profileId: profile.id,
          profileRevision: profile.revision,
          ...(postOptions.getFiles || postOptions.runAttachedScript
            ? {
                postInstall: {
                  ...postOptions,
                  apps: postOptions.getFiles ? postOptions.apps : [],
                  customFileUrl: postOptions.getFiles
                    ? postOptions.customFileUrl
                    : "",
                },
              }
            : {}),
          username,
          ...(uniquePasswords ? {} : { password }),
          remotePort: Number(remotePort),
          retries: Number(retries),
          label,
          tags: tags
            .split(",")
            .map(x => x.trim())
            .filter(Boolean),
          count: n,
          uniquePasswords,
          idempotencyKey: newIdempotencyKey(),
        }),
      });
      setResult(data);
      setPassword("");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Installer command could not be generated."
      );
    } finally {
      setBusy(false);
    }
  }

  const remoteParsed =
    profile && !profileError
      ? remoteSettingsSchema.safeParse({
          profileId: profile.id,
          profileRevision: profile.revision,
          username,
          password,
          remotePort: Number(remotePort),
          retries: Number(retries),
          label,
          postInstall: postOptions,
        })
      : null;
  const remoteSettings = remoteParsed?.success ? remoteParsed.data : null;
  const profileReady = Boolean(profile && !profileError);
  const batchSize = Number(count) || 0;

  return (
    <Page
      eyebrow="INSTALLER"
      title="Create a Windows installation"
      intro="Choose a profile, set the installation options, and create a command for manual setup or review a remote target."
    >
      <div className="installer-vng-route">
        <div
          className="installer-vng-commandbar"
          aria-label="Installer context"
        >
          <div className="installer-vng-commandbar-copy">
            <span className="installer-vng-kicker">NEW INSTALLATION</span>
            <span className="installer-vng-commandbar-title">
              Installation setup
            </span>
          </div>
          <div className="installer-vng-commandbar-meta">
            <span className="installer-vng-live-dot" aria-hidden="true" />
            <span>Selected profile</span>
            <code>{profile?.id || "select a profile"}</code>
          </div>
        </div>

        <div
          className="installer-vng-modebar"
          role="tablist"
          aria-label="Installation method"
          onKeyDown={event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? "manual"
                : event.key === "End"
                  ? "ssh"
                  : installMode === "manual"
                    ? "ssh"
                    : "manual";
            setInstallMode(next);
            event.currentTarget
              .querySelector<HTMLButtonElement>(
                `[aria-label="${next === "manual" ? "Manual command" : "Install via SSH"}"]`
              )
              ?.focus();
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={installMode === "manual"}
            tabIndex={installMode === "manual" ? 0 : -1}
            className={installMode === "manual" ? "is-active" : ""}
            aria-label="Manual command"
            onClick={() => setInstallMode("manual")}
          >
            <Terminal size={15} />
            Manual command
            <span>copy + paste</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={installMode === "ssh"}
            tabIndex={installMode === "ssh" ? 0 : -1}
            className={installMode === "ssh" ? "is-active" : ""}
            aria-label="Install via SSH"
            onClick={() => setInstallMode("ssh")}
          >
            <KeyRound size={15} />
            Install via SSH
            <span>reviewed target</span>
          </button>
        </div>

        <div className="installer-vng-workspace installer-layout">
          <div className="installer-vng-flow">
            <Panel
              title="01 / Set up the installation"
              description="The server uses the selected profile. Ready means the profile can be used, not that the target machine is ready."
              actions={
                <span className="installer-vng-panel-index">
                  {profileReady ? "PROFILE READY" : "REQUIRES INPUT"}
                </span>
              }
            >
              <form
                className="stack-form installer-form installer-vng-form"
                onSubmit={event => {
                  if (installMode === "manual") void submit(event);
                  else event.preventDefault();
                }}
              >
                <fieldset
                  className="form-grid installer-fields"
                  disabled={busy || remoteBusy}
                >
                  <div className="installer-vng-section-intro span-2">
                    <span className="installer-vng-step-mark">01</span>
                    <div>
                      <strong>Operating system profile</strong>
                      <p>
                        Use a configured profile. The server controls the source
                        and image details.
                      </p>
                    </div>
                    {profileError ===
                      "Loading available operating systems…" && (
                      <KineticTextLoader
                        text="Loading profiles"
                        className="installer-vng-loader"
                      />
                    )}
                  </div>

                  <ProfileSelector
                    selected={profile}
                    onError={message => {
                      setProfileError(message);
                      if (message) setResult(null);
                    }}
                    onSelect={p => {
                      const changed =
                        p?.id !== profile?.id ||
                        p?.revision !== profile?.revision;
                      setProfile(p);
                      if (!p || !scriptCompatible(p.osId))
                        setPostOptions(v => ({
                          ...v,
                          runAttachedScript: false,
                        }));
                      if (changed) {
                        setResult(null);
                        if (p) {
                          setUsername(p.username || "");
                          setRemotePort(String(p.remotePort));
                          setRetries(String(p.retries));
                        }
                      }
                    }}
                  />

                  <div className="installer-vng-section-intro span-2 installer-vng-access-heading">
                    <span className="installer-vng-step-mark">02</span>
                    <div>
                      <strong>Windows access</strong>
                      <p>
                        These credentials are included in the generated command
                        and are not shown after generation.
                      </p>
                    </div>
                  </div>

                  <label className="field">
                    <span>Windows username</span>
                    <input
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      required
                      autoComplete="username"
                    />
                  </label>
                  <label className="field">
                    <span>Windows password</span>
                    <div className="password-inline">
                      <input
                        value={password}
                        onChange={e => {
                          setPassword(e.target.value);
                          setResult(null);
                        }}
                        type={showPassword ? "text" : "password"}
                        required={!uniquePasswords}
                        disabled={uniquePasswords}
                        minLength={8}
                        maxLength={128}
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setShowPassword(v => !v)}
                      >
                        {showPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                    <small className="form-hint">
                      {uniquePasswords
                        ? "A unique secure password will be generated for each batch item."
                        : "8–128 printable characters for Windows RDP."}
                    </small>
                    <button
                      type="button"
                      disabled={uniquePasswords}
                      className="text-button installer-vng-generate-password"
                      onClick={() => {
                        setPassword(generateSecurePassword());
                        setResult(null);
                        setShowPassword(true);
                      }}
                    >
                      <WandSparkles size={13} /> Generate random password
                    </button>
                  </label>
                  <label className="field">
                    <span>RDP port</span>
                    <input
                      value={remotePort}
                      onChange={e => setRemotePort(e.target.value)}
                      type="number"
                      min="1"
                      max="65535"
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Label (optional)</span>
                    <input
                      value={label}
                      onChange={e => setLabel(e.target.value)}
                      placeholder="e.g. eu-west build host"
                    />
                  </label>

                  <div className="installer-vng-section-intro span-2 installer-vng-options-heading">
                    <span className="installer-vng-step-mark">03</span>
                    <div>
                      <strong>Optional files and setup</strong>
                      <p>
                        Files are downloaded only; the Windows install result
                        stays independent.
                      </p>
                    </div>
                  </div>
                  <PostInstallOptions
                    value={postOptions}
                    onChange={setPostOptions}
                    osId={profile?.osId}
                  />

                  <details className="advanced-fields span-2 installer-vng-advanced">
                    <summary>
                      <span>Advanced</span>
                      <small>Retries, batch behavior and tags</small>
                    </summary>
                    <div className="form-grid">
                      <label className="field">
                        <span>Download retries</span>
                        <input
                          value={retries}
                          onChange={e => setRetries(e.target.value)}
                          type="number"
                          min="1"
                          max="20"
                        />
                      </label>
                      <label className="field">
                        <span>Batch count</span>
                        <input
                          value={count}
                          onChange={e => setCount(e.target.value)}
                          type="number"
                          min="1"
                          max="20"
                        />
                      </label>
                      <label className="checkbox-field">
                        <input
                          type="checkbox"
                          checked={uniquePasswords}
                          onChange={e => setUniquePasswords(e.target.checked)}
                        />
                        <span>
                          Generate a unique password for each batch item
                        </span>
                      </label>
                      <label className="field span-2">
                        <span>Tags (comma separated)</span>
                        <input
                          value={tags}
                          onChange={e => setTags(e.target.value)}
                          placeholder="production, eu-west"
                        />
                      </label>
                    </div>
                  </details>

                  <div className="form-foot span-2 installer-vng-submit-row">
                    <div>
                      <span className="form-hint">
                        Revision {profile?.revision ?? "—"} · repeated batch
                        requests will not create duplicates.
                      </span>
                      <span className="installer-vng-sensitive-note">
                        <Shield size={12} /> Never paste credentials into chat
                        or tickets.
                      </span>
                    </div>
                    {installMode === "manual" && (
                      <AnimatedButton
                        type="submit"
                        className="installer-vng-generate vng-motion"
                        disabled={busy || Boolean(profileError) || !profile}
                      >
                        {busy ? (
                          <LoaderCircle size={15} className="spin" />
                        ) : (
                          <ArrowRight size={15} />
                        )}
                        {busy
                          ? "Creating securely…"
                          : `Generate ${count} command${batchSize === 1 ? "" : "s"}`}
                      </AnimatedButton>
                    )}
                  </div>
                </fieldset>
              </form>
            </Panel>
          </div>

          <aside className="installer-vng-context">
            <GlowBorderCard
              width="100%"
              height="auto"
              aspectRatio="unset"
              borderRadius="12px"
              borderWidth="1px"
              blurAmount="18px"
              inset="-18px"
              animationDuration={7}
              gradientColors={["#A78BFA", "#25213d", "#3a2c66", "#15131f"]}
              paused={busy}
              className="installer-vng-signal-card"
            >
              <div className="installer-vng-signal-content">
                <span className="installer-vng-kicker">INSTALLATION PROGRESS</span>
                <div className="installer-vng-signal-value">
                  <AnimatedNumber value={batchSize} />
                  <span>
                    command{batchSize === 1 ? "" : "s"}
                    <br />
                    in this batch
                  </span>
                </div>
                <div className="installer-vng-signal-rule" />
                <p>
                  {profileReady
                    ? `${profile?.name} is ready for a private command.`
                    : "Select a profile to create a command."}
                </p>
              </div>
            </GlowBorderCard>

            <Panel
              title="Before you run this command"
              description="This operation changes the target machine."
            >
              <ul className="safety-list installer-vng-safety">
                <li>
                  <AlertTriangle size={14} />
                  <span>
                    The installer automatically selects and{" "}
                    <strong>erases the target disk</strong>.
                  </span>
                </li>
                <li>
                  <AlertTriangle size={14} />
                  <span>
                    The Windows install <strong>reboots the machine</strong> and
                    interrupts the current OS.
                  </span>
                </li>
                <li>
                  <Check size={14} />
                  <span>
                    The command expires and can be revoked; run history
                    persists.
                  </span>
                </li>
                <li>
                  <Check size={14} />
                  <span>
                    SSH approval and confirmations on the target machine remain
                    explicit.
                  </span>
                </li>
              </ul>
              <Link href="/profiles" className="installer-vng-profile-link">
                Manage installation profiles <ExternalLink size={13} />
              </Link>
            </Panel>
          </aside>
        </div>

        {installMode === "ssh" && (
          <div className="installer-vng-remote">
            <RemoteInstallPanel
              settings={remoteSettings}
              profileName={profile?.name}
              onBusyChange={setRemoteBusy}
              onSubmitted={jobId => {
                setPassword("");
                setResult(null);
                navigate(`/deployments?job=${encodeURIComponent(jobId)}`, {
                  state: { installationStarted: jobId },
                });
              }}
            />
          </div>
        )}

        {error && <Notice kind="error" text={error} />}

        {installMode === "manual" && result && (
          <Panel
            title="Command generated"
            description="Copy your private setup command. It downloads your settings securely; keep the command and private status page confidential."
          >
            <div className="generated-list installer-vng-generated-list">
              {(result.items || [result]).map((item: any) => (
                <div
                  className="generated installer-vng-generated"
                  key={item.id}
                >
                  <div className="generated-head">
                    <span className="mono">{item.id}</span>
                    {item.profile && (
                      <span>
                        {item.profile.name} · revision {item.profile.revision}
                      </span>
                    )}
                    <StateBadge value="ready" />
                  </div>
                  <code>
                    {item.command ||
                      "Command available from the generated response."}
                  </code>
                  <div className="generated-meta">
                    <span>Created {formatDate(item.createdAt)}</span>
                    <span>Expires {formatDate(item.expiresAt)}</span>
                    {item.trackingUrl && (
                      <a
                        href={item.trackingUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open private status page <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                  <CopyButton value={item.command || ""} />
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </Page>
  );
}
