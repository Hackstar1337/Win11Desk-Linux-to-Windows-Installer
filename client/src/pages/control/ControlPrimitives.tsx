import { FormEvent, useEffect, useState, useRef } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  LoaderCircle,
  Shield,
  X,
} from "lucide-react";
import { GlowBorderCard } from "../../components/vengeance/glow-border-card";
import { AnimatedNumber } from "../../components/vengeance/animated-number";
import { KineticTextLoader } from "../../components/vengeance/kinetic-text-loader";
import AnimatedButton from "../../components/vengeance/animated-button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";
import { useReducedMotion } from "framer-motion";
import { api } from "../../components/control/api";
import { deploymentStatusLabel } from "../../../../shared/deploymentStatus";
export function formatBytes(n: number) {
  if (!Number.isFinite(n) || n < 0) return "unknown";
  return n >= 1073741824
    ? `${(n / 1073741824).toFixed(2)} GiB`
    : n >= 1048576
      ? `${(n / 1048576).toFixed(1)} MiB`
      : `${n.toLocaleString()} bytes`;
}

export function Page({
  eyebrow,
  title,
  intro,
  actions,
  children,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="page-wrap vengeance-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">
            <span className="eyebrow-rule" />
            {eyebrow}
          </span>
          <h1>{title}</h1>
          {intro && <p>{intro}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel vengeance-panel">
      <div className="panel-edge" aria-hidden="true" />
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Notice({
  text,
  kind = "info",
  onClose,
}: {
  text: string;
  kind?: "info" | "error" | "success";
  onClose?: () => void;
}) {
  return (
    <div
      className={`notice ${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      <span>
        {kind === "error" ? <AlertTriangle size={15} /> : <Shield size={15} />}
      </span>
      <span>{text}</span>
      {onClose && (
        <button className="icon-button" onClick={onClose} aria-label="Dismiss">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: React.ReactNode;
  note?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <GlowBorderCard
      className="stat vengeance-stat"
      width="100%"
      height="auto"
      borderRadius="14px"
      gradientColors={["var(--primary)", "var(--border)", "var(--border)"]}
      borderWidth="1px"
      blurAmount="0px"
      inset="0"
      paused={true}
    >
      <div className="stat-content">
        <span>{label}</span>
        <strong>
          {typeof value === "number" && Number.isFinite(value) && !reduced ? (
            <AnimatedNumber value={value} />
          ) : (
            value
          )}
        </strong>
        {note && <small>{note}</small>}
      </div>
    </GlowBorderCard>
  );
}

export function StateBadge({ value }: { value?: string | null }) {
  const safe = value || "unknown";
  return (
    <span
      className={`state-badge state-${safe.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
    >
      <i />
      {deploymentStatusLabel(safe)}
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-mark">
        <Shield size={22} />
      </span>
      <p>{children}</p>
    </div>
  );
}

export function Loading() {
  return (
    <div className="loading" role="status" aria-label="Loading data">
      <KineticTextLoader text="Loading" className="workspace-loader" />
      <span className="loading-detail">Fetching your workspace data…</span>
    </div>
  );
}

export function CopyButton({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  async function copy() {
    setCopyError("");
    if (!navigator.clipboard?.writeText) {
      setCopyError("Clipboard access is unavailable.");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (error) {
      setCopyError(
        error instanceof Error
          ? `Copy failed: ${error.message}`
          : "Copy failed; clipboard unchanged."
      );
    }
  }
  return (
    <span className="copy-control">
      <button
        className="text-button"
        onClick={() => void copy()}
        disabled={!value}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? "Copied" : label}
      </button>
      {copyError && <small className="field-error">{copyError}</small>}
    </span>
  );
}

export function useLoad<T>(path: string, deps: any[] = [], poll = false) {
  const [state, setState] = useState<{
    path: string;
    data: T | null;
    error: string;
    loading: boolean;
  }>({ path, data: null, error: "", loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true,
      pending = false;
    const controller = new AbortController();
    async function load(initial: boolean) {
      if (pending) return;
      pending = true;
      if (initial)
        setState(s => ({
          path,
          data: s.path === path ? s.data : null,
          error: "",
          loading: true,
        }));
      const request = new AbortController();
      const cancel = () => request.abort();
      controller.signal.addEventListener("abort", cancel, { once: true });
      const timeout = window.setTimeout(cancel, 20000);
      try {
        const data = await api<T>(path, {
          signal: request.signal,
          headers: poll ? { "X-Admin-Polling": "1" } : undefined,
        });
        if (active && !request.signal.aborted)
          setState({ path, data, error: "", loading: false });
      } catch (e) {
        if (active)
          setState(s => ({
            path,
            data: s.path === path ? s.data : null,
            error:
              e instanceof Error && e.name !== "AbortError"
                ? e.message
                : "Request timed out. Refresh to retry.",
            loading: false,
          }));
      } finally {
        window.clearTimeout(timeout);
        controller.signal.removeEventListener("abort", cancel);
        pending = false;
      }
    }
    void load(true);
    const timer = poll
      ? window.setInterval(() => {
          if (!document.hidden) void load(false);
        }, 5000)
      : undefined;
    return () => {
      active = false;
      controller.abort();
      if (timer) window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, poll, ...deps]);
  return {
    ...(state.path === path
      ? state
      : { path, data: null, error: "", loading: true }),
    reload: () => setTick(v => v + 1),
  };
}

export function StepUpModal({
  open,
  title = "Confirm sensitive action",
  description = "Enter your current password. If MFA is enabled, enter the current authenticator code too.",
  onCancel,
  onVerified,
}: {
  open: boolean;
  title?: string;
  description?: string;
  onCancel: () => void;
  onVerified: (password: string, code?: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const openRef = useRef(open);
  const verificationId = useRef(0);
  openRef.current = open;
  useEffect(() => {
    if (!open) {
      setPassword("");
      setCode("");
      setError("");
      setBusy(false);
    }
    return () => {
      verificationId.current++;
    };
  }, [open]);
  if (!open) return null;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const requestId = ++verificationId.current;
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/step-up", {
        method: "POST",
        body: JSON.stringify({ password, ...(code ? { code } : {}) }),
      });
      if (!openRef.current || requestId !== verificationId.current) return;
      await onVerified(password, code || undefined);
      if (openRef.current && requestId === verificationId.current) onCancel();
    } catch (err) {
      if (openRef.current && requestId === verificationId.current)
        setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      if (openRef.current && requestId === verificationId.current)
        setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={value => {
        if (!value) onCancel();
      }}
    >
      <DialogContent className="panel stepup-modal" showCloseButton={false}>
        <div className="panel-heading">
          <div>
            <span className="dialog-eyebrow">
              <Shield size={14} /> SECURE VERIFICATION
            </span>
            <DialogTitle id="stepup-title">{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </div>
          <button
            className="icon-button"
            onClick={onCancel}
            aria-label="Cancel"
          >
            <X size={15} />
          </button>
        </div>
        <form className="stack-form" onSubmit={submit}>
          <label className="field">
            <span>Current password</span>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <label className="field">
            <span>MFA code (if enabled)</span>
            <input
              value={code}
              onChange={e => setCode(e.target.value)}
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
            />
          </label>
          {error && <Notice kind="error" text={error} />}
          <div className="form-foot">
            <button
              type="button"
              className="secondary-button"
              onClick={onCancel}
            >
              Cancel
            </button>
            <AnimatedButton
              className="primary-button"
              disabled={busy}
              type="submit"
            >
              {busy ? "Verifying…" : "Verify and continue"}
            </AnimatedButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export const statuses = ["", "completed", "failed", "installing", "stale"];
