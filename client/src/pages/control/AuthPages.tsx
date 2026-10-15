import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import {
  ArrowLeft,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { DeskMark } from "../../components/control/ControlShell";
import AnimatedButton from "../../components/vengeance/animated-button";
import { api, loadMe } from "../../components/control/api";
import {
  ADMIN_PASSWORD_HINT,
  ADMIN_PASSWORD_MAX_LENGTH,
  ADMIN_PASSWORD_MIN_LENGTH,
  adminPasswordIssue,
} from "../../../../shared/adminPassword";

function AuthFrame({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <main className="auth-page vengeance-auth">
      <aside className="auth-story" aria-label="Win11Desk administration">
        <Link href="/login" className="auth-brand">
          <DeskMark />
          <span>
            <strong>
              Win11Desk<span className="brand-period">.</span>
            </strong>
            <small>WINDOWS INSTALLATIONS</small>
          </span>
        </Link>
        <div className="auth-story-content">
          <span className="eyebrow">
            <span className="eyebrow-rule" /> WINDOWS INSTALLATION DASHBOARD
          </span>
          <h2>
            Install Windows.
            <br />
            <span>Track your installations.</span>
          </h2>
          <p>
            Choose a profile, install Windows on your VPS, and follow its
            progress from one dashboard.
          </p>
          <div className="auth-workflow" aria-label="Deployment workflow">
            <div>
              <span>01</span>
              <strong>Configure</strong>
              <small>Profiles & credentials</small>
            </div>
            <div>
              <span>02</span>
              <strong>Deploy</strong>
              <small>Command or SSH</small>
            </div>
            <div>
              <span>03</span>
              <strong>Track</strong>
              <small>Reported installation progress</small>
            </div>
          </div>
        </div>
        <div className="auth-trust">
          <ShieldCheck size={17} />
          <span>
            Encrypted credentials. Role-based access.
            <br />
            <small>
              Self-hosted administration, without a shared installer account.
            </small>
          </span>
        </div>
      </aside>
      <section className="auth-login-column">
        <div className="auth-session-label">
          <LockKeyhole size={13} />
          <span>PRIVATE ADMINISTRATION</span>
        </div>
        <div className="auth-card">
          <div className="auth-card-heading">
            <span className="eyebrow">
              <span className="eyebrow-rule" />
              {eyebrow}
            </span>
            <h1>{title}</h1>
            <p>{intro}</p>
          </div>
          {children}
        </div>
        <p className="auth-footer">
          Session cookies only · no credentials stored in browser drafts
        </p>
      </section>
    </main>
  );
}
function Field({
  label,
  name,
  type = "text",
  value,
  onChange,
  placeholder,
  autoComplete,
  inputMode,
  required = true,
}: any) {
  const hintId = useId();
  const isNewPassword = type === "password" && autoComplete === "new-password";
  return (
    <label className="field">
      <span>{label}</span>
      <input
        required={required}
        name={name}
        type={type}
        value={value}
        onChange={event => {
          if (isNewPassword) event.currentTarget.setCustomValidity("");
          onChange(event);
        }}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        minLength={isNewPassword ? ADMIN_PASSWORD_MIN_LENGTH : undefined}
        maxLength={isNewPassword ? ADMIN_PASSWORD_MAX_LENGTH : undefined}
        aria-describedby={isNewPassword ? hintId : undefined}
        onInvalid={event => {
          if (isNewPassword) {
            event.currentTarget.setCustomValidity(
              adminPasswordIssue(event.currentTarget.value)?.message || ""
            );
          }
        }}
      />
      {isNewPassword && <small id={hintId}>{ADMIN_PASSWORD_HINT}</small>}
    </label>
  );
}
function ErrorNote({ value }: { value: string }) {
  return value ? (
    <p className="form-error" role="alert">
      {value}
    </p>
  ) : null;
}

export function LoginPage({
  onAuthenticated,
}: {
  onAuthenticated: () => void;
}) {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, ...(code ? { code } : {}) }),
      });
      await loadMe();
      onAuthenticated();
      navigate("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthFrame
      eyebrow="SECURE ADMIN ACCESS"
      title="Sign in to Win11Desk"
      intro="Use your administrator credentials to manage installers, history, and installation settings."
    >
      <form onSubmit={submit} className="auth-form">
        <Field
          label="Email address"
          name="email"
          value={email}
          onChange={(e: any) => setEmail(e.target.value)}
          autoComplete="username"
          placeholder="you@company.com"
          type="email"
        />
        <Field
          label="Password"
          name="password"
          type="password"
          value={password}
          onChange={(e: any) => setPassword(e.target.value)}
          autoComplete="current-password"
          placeholder="••••••••••••"
        />
        <Field
          label="Authenticator code (optional)"
          name="code"
          value={code}
          onChange={(e: any) => setCode(e.target.value)}
          inputMode="numeric"
          placeholder="123456"
          autoComplete="one-time-code"
          required={false}
        />
        <ErrorNote value={error} />
        <AnimatedButton className="primary-button full-width" disabled={busy}>
          {busy ? "Checking credentials…" : "Sign in"}
        </AnimatedButton>
      </form>
      <div className="auth-links">
        <Link href="/recovery">Forgot password or recovery code?</Link>
        <Link href="/setup">First-time setup</Link>
      </div>
    </AuthFrame>
  );
}

export function SetupPage({
  onAuthenticated,
}: {
  onAuthenticated: () => void;
}) {
  const [, navigate] = useLocation();
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [secret, setSecret] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [setupAvailable, setSetupAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api<any>("/api/auth/setup/status", { signal: controller.signal })
      .then(x => {
        if (!controller.signal.aborted) setSetupAvailable(x.available);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Could not check setup availability");
      });
    return () => controller.abort();
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const passwordIssue = adminPasswordIssue(password);
    if (passwordIssue) {
      setError(passwordIssue.message);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result: any = await api("/api/auth/setup", {
        method: "POST",
        body: JSON.stringify({ secret, email, name, password }),
      });
      await loadMe();
      setPassword("");
      setSecret("");
      setRecoveryCodes(result.recoveryCodes || []);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Setup could not be completed."
      );
    } finally {
      setBusy(false);
    }
  }
  if (setupAvailable === false && !recoveryCodes.length)
    return (
      <AuthFrame
        eyebrow="SETUP COMPLETE"
        title="Owner already configured"
        intro="Use your existing email/password, or your offline recovery code."
      >
        <Link href="/login">Go to login</Link>
        <Link href="/recovery">Recover account</Link>
      </AuthFrame>
    );
  if (recoveryCodes.length)
    return (
      <AuthFrame
        eyebrow="OWNER CREATED"
        title="Save your recovery codes"
        intro="These single-use codes replace a forgotten password. Store them offline; they will not be shown again."
      >
        <pre className="generated">{recoveryCodes.join("\n")}</pre>
        <AnimatedButton
          className="primary-button"
          onClick={() => {
            setRecoveryCodes([]);
            onAuthenticated();
            navigate("/");
          }}
        >
          I saved these codes — continue
        </AnimatedButton>
      </AuthFrame>
    );
  return (
    <AuthFrame
      eyebrow="CREATE ADMIN ACCOUNT"
      title="Create the first owner"
      intro="The bootstrap secret is provided by your operator. The first account is always created as the owner; later access is invitation-only."
    >
      <form onSubmit={submit} className="auth-form">
        <Field
          label="Bootstrap secret"
          name="secret"
          type="password"
          value={secret}
          onChange={(e: any) => setSecret(e.target.value)}
          autoComplete="off"
        />
        <Field
          label="Full name"
          name="name"
          value={name}
          onChange={(e: any) => setName(e.target.value)}
          autoComplete="name"
        />
        <Field
          label="Email address"
          name="email"
          type="email"
          value={email}
          onChange={(e: any) => setEmail(e.target.value)}
          autoComplete="email"
        />
        <Field
          label="Owner password"
          name="password"
          type="password"
          value={password}
          onChange={(e: any) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
        <ErrorNote value={error} />
        <AnimatedButton className="primary-button full-width" disabled={busy}>
          {busy ? "Creating owner…" : "Create owner account"}
        </AnimatedButton>
      </form>
      <div className="auth-links">
        <Link href="/login">
          <ArrowLeft size={14} /> Back to sign in
        </Link>
      </div>
    </AuthFrame>
  );
}

export function RecoveryPage() {
  const [, navigate] = useLocation();
  const mounted = useRef(false);
  const redirectTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (redirectTimer.current) window.clearTimeout(redirectTimer.current);
    };
  }, []);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api("/api/auth/recovery", {
        method: "POST",
        body: JSON.stringify({ email, code, password }),
      });
      if (!mounted.current) return;
      setCode("");
      setPassword("");
      setMessage(
        "Recovery accepted. You can now sign in with the new password."
      );
      redirectTimer.current = window.setTimeout(() => {
        if (mounted.current) navigate("/login");
      }, 900);
    } catch (e) {
      if (!mounted.current) return;
      setError(
        e instanceof Error ? e.message : "Recovery could not be completed."
      );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <AuthFrame
      eyebrow="ACCOUNT RECOVERY"
      title="Regain access securely"
      intro="Enter a single-use recovery code supplied by your administrator. Recovery codes are never displayed again after use."
    >
      <form onSubmit={submit} className="auth-form">
        <Field
          label="Account email"
          name="email"
          type="email"
          value={email}
          onChange={(e: any) => setEmail(e.target.value)}
          autoComplete="email"
        />
        <Field
          label="Recovery code"
          name="code"
          value={code}
          onChange={(e: any) => setCode(e.target.value)}
          autoComplete="one-time-code"
          placeholder="XXXX-XXXX-XXXX"
        />
        <Field
          label="New password"
          name="password"
          type="password"
          value={password}
          onChange={(e: any) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
        <ErrorNote value={error} />
        {message && <p className="form-success">{message}</p>}
        <AnimatedButton className="primary-button full-width" disabled={busy}>
          {busy ? "Verifying code…" : "Reset password"}
        </AnimatedButton>
      </form>
      <div className="auth-links">
        <Link href="/login">
          <ArrowLeft size={14} /> Back to sign in
        </Link>
      </div>
    </AuthFrame>
  );
}

export function InvitePage({
  onAuthenticated,
}: {
  onAuthenticated: () => void;
}) {
  const { token: routeToken = "" } = useParams<{ token: string }>();
  const [, navigate] = useLocation();
  const [token, setToken] = useState(routeToken);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!routeToken && typeof window !== "undefined" && window.location.hash)
      setToken(decodeURIComponent(window.location.hash.slice(1)));
  }, [routeToken]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/invites/accept", {
        method: "POST",
        body: JSON.stringify({ token, name, password }),
      });
      await loadMe();
      onAuthenticated();
      navigate("/");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Invitation is invalid or expired."
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthFrame
      eyebrow="TEAM INVITATION"
      title="Join Win11Desk"
      intro="Finish creating your invited account. Access is scoped to the role granted by the inviter."
    >
      <form onSubmit={submit} className="auth-form">
        <Field
          label="Full name"
          name="name"
          value={name}
          onChange={(e: any) => setName(e.target.value)}
          autoComplete="name"
        />
        <Field
          label="Password"
          name="password"
          type="password"
          value={password}
          onChange={(e: any) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
        <ErrorNote value={error} />
        {!token && (
          <p className="form-error">
            This invitation link has no token. Use the complete link from your
            administrator.
          </p>
        )}
        <AnimatedButton
          className="primary-button full-width"
          disabled={busy || !token}
        >
          {busy ? "Activating account…" : "Accept invitation"}
        </AnimatedButton>
      </form>
      <div className="auth-links">
        <Link href="/login">
          <ArrowLeft size={14} /> Already have an account?
        </Link>
      </div>
    </AuthFrame>
  );
}
export const authIcons = { ShieldCheck, LockKeyhole, KeyRound, UserPlus };
