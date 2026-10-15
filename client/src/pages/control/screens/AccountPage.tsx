import { FormEvent, useState } from "react";
import {
  CheckCircle2,
  KeyRound,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
} from "lucide-react";
import AnimatedButton from "../../../components/vengeance/animated-button";
import { AnimatedNumber } from "../../../components/vengeance/animated-number";
import { GlowBorderCard } from "../../../components/vengeance/glow-border-card";
import { KineticTextLoader } from "../../../components/vengeance/kinetic-text-loader";
import ThemeColour from "../../../components/control/ThemeColour";
import { api, formatDate } from "../../../components/control/api";
import {
  CopyButton,
  Empty,
  Loading,
  Notice,
  Page,
  StepUpModal,
  useLoad,
} from "../ControlPrimitives";
import "./AccountPage.css";

type StepUpAction = "disable" | "recovery" | "enroll" | "sessions";

const MFA_CODE_PATTERN = /^\d{6}$/;

export function AccountPage() {
  const sessions = useLoad<any>("/api/auth/account/sessions");
  const [oldPassword, setOldPassword] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [enrollment, setEnrollment] = useState<any>(null);
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [confirmingMfa, setConfirmingMfa] = useState(false);
  const [revokingSessions, setRevokingSessions] = useState<Set<string>>(
    () => new Set()
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [stepUp, setStepUp] = useState<StepUpAction | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  function clearNotices() {
    setMessage("");
    setError("");
  }

  function requestStepUp(action: StepUpAction) {
    clearNotices();
    setStepUp(action);
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    clearNotices();
    try {
      await api("/api/auth/account/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: oldPassword, password }),
      });
      setOldPassword("");
      setPassword("");
      setMessage("Password changed. Other sessions may need to sign in again.");
      sessions.reload();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Password could not be changed."
      );
    }
  }

  async function revokeSession(id: string) {
    if (revokingSessions.has(id)) return;
    clearNotices();
    setRevokingSessions(current => new Set(current).add(id));
    try {
      await api(`/api/auth/account/sessions/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      setMessage("Session revoked.");
      sessions.reload();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Session could not be revoked."
      );
    } finally {
      setRevokingSessions(current => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  function enroll() {
    requestStepUp("enroll");
  }

  async function beginEnrollment() {
    clearNotices();
    try {
      setEnrollment(
        await api<any>("/api/auth/account/mfa/enroll", { method: "POST" })
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "MFA enrollment unavailable."
      );
    }
  }

  async function confirmMfa() {
    if (confirmingMfa) return;
    clearNotices();
    if (!MFA_CODE_PATTERN.test(mfaCode)) {
      setError("Enter the six-digit authenticator code.");
      return;
    }
    setConfirmingMfa(true);
    try {
      const result = await api<any>("/api/auth/account/mfa/confirm", {
        method: "POST",
        body: JSON.stringify({ code: mfaCode }),
      });
      setMfaEnabled(result.enabled === true);
      setEnrollment(null);
      setMfaCode("");
      setRecoveryCodes(result.recoveryCodes || []);
      setMessage("MFA enabled. Save the one-time recovery codes shown below.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "MFA code could not be confirmed."
      );
    } finally {
      setConfirmingMfa(false);
    }
  }

  async function sensitiveAfterStepUp() {
    clearNotices();
    try {
      if (stepUp === "sessions") {
        const result = await api<any>(
          "/api/auth/account/sessions/clear-others",
          { method: "POST", body: JSON.stringify({ confirm: true }) }
        );
        setMessage(
          `Cleared ${result.cleared} other login sessions. This browser remains signed in.`
        );
        sessions.reload();
      } else if (stepUp === "enroll") {
        await beginEnrollment();
      } else if (stepUp === "disable") {
        await api("/api/auth/account/mfa/disable", { method: "POST" });
        setMfaEnabled(false);
        setEnrollment(null);
        setRecoveryCodes([]);
        setMessage("MFA disabled.");
      } else if (stepUp === "recovery") {
        const result = await api<any>("/api/auth/account/recovery", {
          method: "POST",
        });
        setRecoveryCodes(result.recoveryCodes || []);
        setMessage("New recovery codes generated. Store them offline.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Security action failed.");
    } finally {
      setStepUp(null);
    }
  }

  const sessionItems = sessions.data?.sessions || [];

  return (
    <Page
      eyebrow="ACCOUNT / SECURITY"
      title="Account security"
      intro="Manage your password, set up two-step verification, and review where your account is signed in."
    >
      <div className="account-workspace">
        <div className="account-hero">
          <div>
            <div className="account-kicker">Account settings</div>
            <h2>Keep your account secure.</h2>
            <p>
              Manage your password, verification, recovery options, and signed-in
              sessions in one place.
            </p>
          </div>
          <div
            className="account-command-mark"
            aria-label="Account security status"
          >
            <ShieldCheck size={19} />
            <div>
              <span>Account security</span>
              <strong>Review access</strong>
            </div>
          </div>
        </div>

        {(message || error) && (
          <div className="account-notices">
            {message && <Notice text={message} />}
            {error && <Notice kind="error" text={error} />}
          </div>
        )}

        <div className="account-layout">
          <aside
            className="account-rail"
            aria-label="Account settings sections"
          >
            <div className="account-rail-label">Account settings</div>
            <div className="account-rail-item is-active">
              <span className="account-step-index">01</span>
              <span className="account-rail-copy">
                <strong>Identity</strong>
                <small>Password</small>
              </span>
            </div>
            <div className="account-rail-item is-active">
              <span className="account-step-index">02</span>
              <span className="account-rail-copy">
                <strong>Verification</strong>
                <small>Authenticator app</small>
              </span>
            </div>
            <div className="account-rail-item">
              <span className="account-step-index">03</span>
              <span className="account-rail-copy">
                <strong>Recovery</strong>
                <small>Recovery codes</small>
              </span>
            </div>
            <div className="account-rail-item">
              <span className="account-step-index">04</span>
              <span className="account-rail-copy">
                <strong>Sessions</strong>
                <small>Signed-in devices</small>
              </span>
            </div>
            <div className="account-rail-fact">
              Active sessions
              <strong>
                <AnimatedNumber value={sessionItems.length} />
              </strong>
              <span>currently signed-in sessions</span>
            </div>
          </aside>

          <div className="account-main">
            <div className="account-security-grid">
              <section className="account-card account-card--primary">
                <header className="account-card__header">
                  <div>
                    <div className="account-section-label">01 / identity</div>
                    <h3>Change password</h3>
                    <p>
                      Change your password without storing it in this browser.
                    </p>
                  </div>
                  <span className="account-card__icon" aria-hidden="true">
                    <KeyRound size={16} />
                  </span>
                </header>
                <form className="account-field-grid" onSubmit={changePassword}>
                  <label className="field">
                    <span>Current password</span>
                    <input
                      type="password"
                      value={oldPassword}
                      onChange={e => setOldPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                    />
                  </label>
                  <label className="field">
                    <span>New password</span>
                    <input
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      autoComplete="new-password"
                    />
                  </label>
                  <div className="account-form-foot">
                    <span className="account-meta">
                      Applies to future sign-ins
                    </span>
                    <AnimatedButton
                      type="submit"
                      className="account-primary-action"
                    >
                      Update password
                    </AnimatedButton>
                  </div>
                </form>
              </section>

              <div className="account-glow-wrap">
                <GlowBorderCard
                  width="100%"
                  height="auto"
                  borderRadius="16px"
                  borderWidth="1px"
                  blurAmount="8px"
                  inset="0"
                  paused={false}
                  gradientColors={["#a78bfa", "#6f58b7", "#252038", "#a78bfa"]}
                  className="account-vng-card"
                >
                  <section className="account-card">
                    <header className="account-card__header">
                      <div>
                        <div className="account-section-label">
                          02 / verification
                        </div>
                        <h3>Authenticator app</h3>
                        <p>
                          Enroll a second factor, then confirm its six-digit
                          code before MFA is enabled.
                        </p>
                      </div>
                      <span
                        className="account-security-glyph account-security-glyph--green"
                        aria-hidden="true"
                      >
                        <Smartphone size={16} />
                      </span>
                    </header>
                    <div
                      className={`account-status-line${enrollment ? " is-pending" : ""}`}
                    >
                      <i aria-hidden="true" />
                      {mfaEnabled
                        ? "Enabled"
                        : enrollment
                          ? "Authenticator setup ready for confirmation"
                          : "Ready to set up an authenticator"}
                    </div>
                    {!enrollment && !mfaEnabled && (
                      <AnimatedButton
                        type="button"
                        className="account-secondary-action"
                        onClick={enroll}
                      >
                        <KeyRound size={14} /> Start MFA enrollment
                      </AnimatedButton>
                    )}
                    {enrollment && (
                      <div className="account-mfa-flow">
                        <div className="account-mfa-payload">
                          <span>Secret</span>
                          <code>
                            {enrollment.secret || "Enrollment started"}
                          </code>
                          {enrollment.uri && (
                            <>
                              <span>URI</span>
                              <code>{enrollment.uri}</code>
                            </>
                          )}
                        </div>
                        <label className="field">
                          <span>Authenticator code</span>
                          <input
                            value={mfaCode}
                            onChange={e => setMfaCode(e.target.value)}
                            inputMode="numeric"
                            pattern="[0-9]{6}"
                            required
                            maxLength={6}
                            placeholder="123456"
                            autoComplete="one-time-code"
                          />
                        </label>
                        <div className="account-card-actions">
                          <AnimatedButton
                            type="button"
                            className="account-primary-action"
                            onClick={() => void confirmMfa()}
                            disabled={
                              confirmingMfa || !MFA_CODE_PATTERN.test(mfaCode)
                            }
                          >
                            <CheckCircle2 size={14} />
                            {confirmingMfa ? "Confirming…" : "Confirm MFA"}
                          </AnimatedButton>
                        </div>
                      </div>
                    )}
                    {recoveryCodes.length > 0 && (
                      <div
                        className="account-recovery-output"
                        role="region"
                        aria-label="New recovery codes"
                      >
                        <div>
                          <strong>Recovery codes — store offline</strong>
                          <code>{recoveryCodes.join(" ")}</code>
                        </div>
                        <CopyButton value={recoveryCodes.join("\n")} />
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => setRecoveryCodes([])}
                        >
                          Dismiss recovery codes
                        </button>
                      </div>
                    )}
                    <div
                      className="account-card-actions"
                      style={{ marginTop: 15 }}
                    >
                      <button
                        className="account-text-action"
                        onClick={() => requestStepUp("recovery")}
                      >
                        Regenerate offline recovery codes
                      </button>
                      <button
                        className="account-danger-action"
                        onClick={() => requestStepUp("disable")}
                      >
                        <Trash2 size={13} /> Disable MFA
                      </button>
                    </div>
                  </section>
                </GlowBorderCard>
              </div>
            </div>

            <section className="account-session-panel">
              <header className="account-session-header">
                <div>
                  <div className="account-section-label">
                    03 / 04 — recovery + sessions
                  </div>
                  <h3>Active sessions</h3>
                  <p>
                    Only unexpired, non-revoked, recently active logins are
                    shown. This browser stays signed in when other sessions are
                    cleared.
                  </p>
                </div>
                <div className="account-session-actions">
                  <button
                    className="account-secondary-action"
                    onClick={() => requestStepUp("sessions")}
                    disabled={sessions.loading}
                  >
                    <RefreshCw size={14} /> Clear other sessions — keep this
                    browser
                  </button>
                </div>
              </header>
              {sessions.loading ? (
                <div
                  className="account-loading"
                  role="status"
                  aria-live="polite"
                >
                  <KineticTextLoader
                    text="Loading"
                    className="kinetic-loader"
                  />
                  <span className="loading-copy">
                    Reading protected session state…
                  </span>
                </div>
              ) : (
                <div className="account-session-list">
                  {sessionItems.map((item: any) => (
                    <div className="account-session-row" key={item.id}>
                      <div className="account-session-row__identity">
                        {item.current ? (
                          <Monitor size={15} />
                        ) : (
                          <Smartphone size={15} />
                        )}
                        <div className="account-session-row__identity-copy">
                          <strong
                            title={
                              item.current
                                ? "This browser"
                                : item.user_agent || "Other device"
                            }
                          >
                            {item.current
                              ? "This browser"
                              : item.user_agent || "Browser session"}
                          </strong>
                          <div className="account-session-metadata">
                            <small>
                              <span>{item.ip_address || "IP unavailable"}</span>{" "}
                              · last seen{" "}
                              {formatDate(item.last_seen_at || item.lastSeenAt)}
                            </small>
                          </div>
                        </div>
                      </div>
                      {item.current ? (
                        <span className="account-current-badge">
                          <i aria-hidden="true" /> Current
                        </span>
                      ) : (
                        <button
                          className="account-danger-action"
                          onClick={() => void revokeSession(item.id)}
                          disabled={revokingSessions.has(item.id)}
                        >
                          {revokingSessions.has(item.id)
                            ? "Revoking…"
                            : "Revoke"}
                        </button>
                      )}
                    </div>
                  ))}
                  {!sessionItems.length && (
                    <div className="account-empty">
                      <Empty>No active sessions were returned.</Empty>
                    </div>
                  )}
                </div>
              )}
              {sessions.error && <Notice kind="error" text={sessions.error} />}
              <p className="account-privacy-note">
                Session details come from your account. This list does not include
                other device information.
              </p>
            </section>

            <section className="account-appearance-panel">
              <div className="account-appearance-copy">
                <header className="account-appearance-header">
                  <div>
                    <div className="account-section-label">04 / appearance</div>
                    <h3>Appearance</h3>
                    <p>
                      Choose the accent used across your account pages. The
                      preference is saved in this browser only.
                    </p>
                  </div>
                  <span
                    className="account-security-glyph account-security-glyph--amber"
                    aria-hidden="true"
                  >
                    <Sparkles size={16} />
                  </span>
                </header>
                <p className="account-appearance-note">
                  Quiet ultraviolet is the default accent. Select another saved
                  accent to change the page style.
                </p>
              </div>
              <div className="account-theme-well">
                <ThemeColour />
              </div>
            </section>
          </div>
        </div>

        <StepUpModal
          open={Boolean(stepUp)}
          title={
            stepUp === "sessions"
              ? "Clear other login sessions"
              : stepUp === "disable"
                ? "Disable MFA"
                : stepUp === "enroll"
                  ? "Start MFA enrollment"
                  : "Regenerate recovery codes"
          }
          onCancel={() => setStepUp(null)}
          onVerified={async () => sensitiveAfterStepUp()}
        />
      </div>
    </Page>
  );
}
