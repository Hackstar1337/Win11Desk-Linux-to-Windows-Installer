import { FormEvent, useState } from "react";
import { Check, KeyRound, Shield, UserPlus, X } from "lucide-react";
import AnimatedButton from "../../../components/vengeance/animated-button";
import { AnimatedNumber } from "../../../components/vengeance/animated-number";
import { GlowBorderCard } from "../../../components/vengeance/glow-border-card";
import { KineticTextLoader } from "../../../components/vengeance/kinetic-text-loader";
import { api, formatDate, type User } from "../../../components/control/api";
import {
  Empty,
  Notice,
  Page,
  StepUpModal,
  StateBadge,
  useLoad,
} from "../ControlPrimitives";
import "./UsersPage.css";

type PendingAction =
  | { kind: "invite"; email: string; role: string }
  | { kind: "role"; userId: string; email: string; role: string }
  | { kind: "active"; userId: string; email: string; active: boolean }
  | { kind: "revoke"; userId: string; email: string };

const roleGuide = [
  {
    role: "Viewer",
    summary: "Review the overview, deployment history and details.",
  },
  {
    role: "Operator",
    summary: "Create commands, run installers and note work.",
  },
  {
    role: "Admin",
    summary: "Manage profiles, account access and settings.",
  },
];

function actionLabel(action: PendingAction | null) {
  if (!action) return "Confirm access change";
  if (action.kind === "invite") return "Confirm invitation";
  if (action.kind === "role") return "Confirm role change";
  if (action.kind === "active")
    return action.active ? "Confirm access restore" : "Confirm access disable";
  return "Confirm session revoke";
}

export function UsersPage({ user: authUser }: { user: User }) {
  const { data, loading, error, reload } = useLoad<any>("/api/auth/users");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("operator");
  const [message, setMessage] = useState("");
  const [feedbackKind, setFeedbackKind] = useState<
    "info" | "error" | "success"
  >("info");
  const [stepUp, setStepUp] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null
  );
  const [committing, setCommitting] = useState(false);
  const [issuedInvite, setIssuedInvite] = useState<{
    email: string;
    role: string;
    href: string;
  } | null>(null);

  function requestAction(action: PendingAction) {
    if (committing || pendingAction) return;
    setMessage("");
    setPendingAction(action);
    setStepUp(true);
  }

  async function commitPendingAction() {
    const action = pendingAction;
    if (!action || committing) return;
    setCommitting(true);
    try {
      if (action.kind === "invite") {
        const result = await api<any>("/api/auth/users/invite", {
          method: "POST",
          body: JSON.stringify({ email: action.email, role: action.role }),
        });
        const href = result?.token
          ? `${window.location.origin}/invite#${result.token}`
          : "";
        setEmail("");
        setIssuedInvite(
          href ? { email: action.email, role: action.role, href } : null
        );
        setFeedbackKind("success");
        setMessage(href ? `Invite link: ${href}` : "Invitation created.");
      } else if (action.kind === "role") {
        await api(`/api/auth/users/${encodeURIComponent(action.userId)}`, {
          method: "PATCH",
          body: JSON.stringify({ role: action.role }),
        });
        setFeedbackKind("success");
        setMessage(`Role updated for ${action.email}.`);
      } else if (action.kind === "active") {
        await api(`/api/auth/users/${encodeURIComponent(action.userId)}`, {
          method: "PATCH",
          body: JSON.stringify({ active: action.active }),
        });
        setFeedbackKind("success");
        setMessage(
          action.active
            ? `Access restored for ${action.email}.`
            : `Access disabled for ${action.email}.`
        );
      } else {
        await api(
          `/api/auth/users/${encodeURIComponent(action.userId)}/revoke`,
          {
            method: "POST",
          }
        );
        setFeedbackKind("success");
        setMessage(`Sessions revoked for ${action.email}.`);
      }
      reload();
    } catch (err) {
      setFeedbackKind("error");
      setMessage(
        err instanceof Error
          ? err.message
          : "The access change could not be completed."
      );
    } finally {
      setStepUp(false);
      setPendingAction(null);
      setCommitting(false);
    }
  }

  const users = Array.isArray(data?.users) ? data.users : [];
  const activeUsers = users.filter((user: any) => user.active !== false).length;
  const actionBusy = committing || Boolean(pendingAction);

  return (
    <Page
      eyebrow="USERS"
      title="Users & invitations"
      intro="Invite teammates with the smallest role that fits their work."
      actions={
        <span className="users-header-status">
          <i /> Access rules active
        </span>
      }
    >
      <div className="users-workspace">
        <div className="users-editorial-grid">
          <GlowBorderCard
            className="users-vui-glow-card"
            width="100%"
            height="auto"
            borderRadius="14px"
            borderWidth="1px"
            blurAmount="10px"
            inset="-2px"
            gradientColors={["#a78bfa", "#6953a8", "#2b243f", "#a78bfa"]}
            paused
          >
            <div className="users-invite-card">
              <div className="users-workflow-rail" aria-hidden="true">
                <span className="users-rail-number">01</span>
              </div>
              <div>
                <p className="users-card-kicker">Set account access</p>
                <h2>Invite a teammate</h2>
                <p className="users-card-copy">
                  Invitations expire after 72 hours. A verification check
                  protects each new account.
                </p>
                <form
                  className="users-invite-form"
                  onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault();
                    requestAction({ kind: "invite", email, role });
                  }}
                >
                  <label className="users-field">
                    <span>Email address</span>
                    <input
                      type="email"
                      value={email}
                      onChange={event => setEmail(event.target.value)}
                      required
                      placeholder="operator@company.com"
                      autoComplete="email"
                      disabled={actionBusy}
                    />
                  </label>
                  <label className="users-field">
                    <span>Role</span>
                    <select
                      value={role}
                      onChange={event => setRole(event.target.value)}
                      disabled={actionBusy}
                    >
                      <option value="viewer">Viewer · read only</option>
                      <option value="operator">
                        Operator · run installers
                      </option>
                      <option value="admin">Admin · manage settings</option>
                    </select>
                  </label>
                  <AnimatedButton
                    type="submit"
                    className="users-primary-action"
                    disabled={actionBusy}
                  >
                    <UserPlus size={14} /> Create invitation
                  </AnimatedButton>
                </form>
                {issuedInvite && (
                  <div className="users-issued-invite" role="status">
                    <Check size={15} aria-hidden="true" />
                    <div>
                      <strong>
                        Issued invite for {issuedInvite.email} ·{" "}
                        {issuedInvite.role}
                      </strong>
                      <code>{issuedInvite.href}</code>
                    </div>
                    <button
                      type="button"
                      className="users-secondary-action"
                      aria-label="Dismiss issued invite"
                      onClick={() => setIssuedInvite(null)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                )}
                {message && (
                  <div className="users-feedback">
                    <Notice kind={feedbackKind} text={message} />
                  </div>
                )}
              </div>
            </div>
          </GlowBorderCard>

          <aside
            className="users-role-card"
            aria-labelledby="users-role-guide-title"
          >
            <p className="users-card-kicker">02 / Account access</p>
            <h2 id="users-role-guide-title">Choose the right access</h2>
            <p className="users-card-copy">
              Role changes and ending sessions require verification. Admin does
              not imply owner.
            </p>
            <div className="users-role-guide">
              {roleGuide.map(item => (
                <div className="users-role-guide-row" key={item.role}>
                  <strong>{item.role}</strong>
                  <span>{item.summary}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>

        <section
          className="users-members-panel"
          aria-labelledby="users-members-title"
        >
          <header className="users-members-heading">
            <div>
              <p className="users-card-kicker">03 / User accounts</p>
              <h2 id="users-members-title">Current access</h2>
              <p>
                Review role, MFA and recent activity. Changes take
                effect after verification.
              </p>
            </div>
            <div
              className="users-member-count"
              aria-label={`${activeUsers} active members`}
            >
              <AnimatedNumber value={activeUsers} className="users-number" />
              <span>users</span>
            </div>
          </header>

          {loading ? (
            <KineticTextLoader text="Loading users" className="users-loader" />
          ) : error && !data ? (
            <div className="users-error-state">
              <Shield size={17} aria-hidden="true" />
              <p>User list unavailable: {error}</p>
              <button type="button" className="users-retry" onClick={reload}>
                Retry loading users
              </button>
            </div>
          ) : (
            <div className="users-table-wrap">
              <table className="users-table">
                <thead>
                  <tr>
                    <th scope="col">Member</th>
                    <th scope="col">Email</th>
                    <th scope="col">Role / access</th>
                    <th scope="col">MFA</th>
                    <th scope="col">Last seen</th>
                    <th scope="col">Account actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user: any) => {
                    const isActive = user.active !== false;
                    const isCurrent = Boolean(
                      authUser.id && authUser.id === user.id
                    );
                    return (
                      <tr key={user.id}>
                        <td>
                          <div className="users-identity">
                            <strong>{user.name || "Unnamed member"}</strong>
                            <small>
                              {isCurrent ? "This session" : `ID ${user.id}`}
                            </small>
                          </div>
                        </td>
                        <td>
                          <span className="users-email">{user.email}</span>
                        </td>
                        <td>
                          <div className="users-role-cell">
                            <StateBadge value={user.role} />
                            <span
                              className={`users-access-state ${isActive ? "is-active" : "is-disabled"}`}
                            >
                              {isActive ? "Active" : "Disabled"}
                            </span>
                            <select
                              className="users-role-select"
                              value={user.role}
                              aria-label={`Role for ${user.email}`}
                              disabled={actionBusy}
                              onChange={event => {
                                if (event.target.value !== user.role) {
                                  requestAction({
                                    kind: "role",
                                    userId: user.id,
                                    email: user.email,
                                    role: event.target.value,
                                  });
                                }
                              }}
                            >
                              <option value="owner">Owner</option>
                              <option value="admin">Admin</option>
                              <option value="operator">Operator</option>
                              <option value="viewer">Viewer</option>
                            </select>
                          </div>
                        </td>
                        <td>
                          <span
                            className={`users-mfa-state ${user.mfaEnabled ? "is-enabled" : "is-disabled"}`}
                          >
                            {user.mfaEnabled ? "Enabled" : "Off"}
                          </span>
                        </td>
                        <td>
                          <span className="users-last-seen">
                            {formatDate(
                              user.last_login_at ||
                                user.lastLoginAt ||
                                user.updatedAt
                            )}
                          </span>
                        </td>
                        <td>
                          <div className="users-actions">
                            <button
                              type="button"
                              className={
                                isActive
                                  ? "users-danger-action"
                                  : "users-secondary-action"
                              }
                              aria-label={`${isActive ? "Disable" : "Enable"} ${user.email}`}
                              disabled={actionBusy || isCurrent}
                              title={
                                isCurrent
                                  ? "You cannot disable your own account"
                                  : `${isActive ? "Disable" : "Enable"} account`
                              }
                              onClick={() =>
                                requestAction({
                                  kind: "active",
                                  userId: user.id,
                                  email: user.email,
                                  active: !isActive,
                                })
                              }
                            >
                              {isActive ? "Disable" : "Enable"}
                            </button>
                            <button
                              type="button"
                              className="users-secondary-action"
                              disabled={actionBusy || isCurrent}
                              title={
                                isCurrent
                                  ? "Use logout for this session"
                                  : "Revoke all sessions"
                              }
                              onClick={() =>
                                requestAction({
                                  kind: "revoke",
                                  userId: user.id,
                                  email: user.email,
                                })
                              }
                            >
                              <KeyRound size={12} /> Revoke
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!users.length && (
                <div className="users-empty-state">
                  <Empty>No additional users have been invited.</Empty>
                </div>
              )}
            </div>
          )}
          {error && data && <Notice kind="error" text={error} />}
        </section>
      </div>
      <StepUpModal
        open={stepUp}
        title={actionLabel(pendingAction)}
        onCancel={() => {
          if (committing) return;
          setStepUp(false);
          setPendingAction(null);
        }}
        onVerified={async () => {
          await commitPendingAction();
        }}
      />
    </Page>
  );
}
