import { Link } from "wouter";
import {
  Activity,
  ArrowUpRight,
  RefreshCw,
  Server,
  ShieldCheck,
} from "lucide-react";
import type { OperationsHealth, CheckState } from "@shared/operationsDashboard";
import { formatDate } from "../api";
import type { HealthResource } from "./types";
import { AnimatedNumber } from "../../vengeance/animated-number";
import { GlowBorderCard } from "../../vengeance/glow-border-card";
import { KineticTextLoader } from "../../vengeance/kinetic-text-loader";

type Props = HealthResource;
function StatusBadge({ state }: { state?: CheckState | string | null }) {
  const value = state || "unknown";
  return (
    <span className={`ops-status ops-status-${value}`}>
      <i />
      {value}
    </span>
  );
}
function Value({ value }: { value: unknown }) {
  return (
    <span className="ops-value">
      {value === null || value === undefined || value === ""
        ? "Not reported"
        : String(value)}
    </span>
  );
}
function CountList({
  label,
  values,
}: {
  label: string;
  values: Record<string, number> | null | undefined;
}) {
  if (!values)
    return (
      <div className="ops-fact">
        <dt>{label}</dt>
        <dd>Not available</dd>
      </div>
    );
  return (
    <div className="ops-fact ops-fact-stack">
      <dt>{label}</dt>
      <dd className="ops-counts">
        {Object.entries(values).map(([key, value]) => (
          <span key={key}>
            <b>
              <AnimatedNumber value={value} />
            </b>{" "}
            {key}
          </span>
        ))}
      </dd>
    </div>
  );
}
function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: number | string;
  note: string;
}) {
  return (
    <div className="ops-vng-metric">
      <span>{label}</span>
      <strong>
        {typeof value === "number" ? <AnimatedNumber value={value} /> : value}
      </strong>
      <small>{note}</small>
    </div>
  );
}

export default function HealthView({ data, error, loading, reload }: Props) {
  const checks = data?.checks || [];
  const pending = data?.migrations?.pending || [];
  const ready = data?.profiles?.ready ?? 0;
  const active = data?.deployments?.active ?? 0;
  return (
    <section
      className="ops-panel ops-vng-panel ops-health-panel"
      aria-labelledby="operations-health-title"
    >
      <div className="ops-panel-heading ops-vng-heading">
        <div>
          <span className="ops-vng-section-no">01 / HEALTH</span>
          <h2 id="operations-health-title">System health</h2>
          <p>
            Read-only checks for the service. Each check shows its reported
            state.
          </p>
        </div>
        <button
          className="secondary-button ops-vng-button"
          type="button"
          onClick={reload}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? "ops-spin" : ""} /> Refresh
        </button>
      </div>
      {error && (
        <div className="ops-inline-error ops-vng-inline" role="alert">
          <span>{error}</span>
          <button className="text-button" type="button" onClick={reload}>
            Retry
          </button>
        </div>
      )}
      {loading && !data ? (
        <div className="ops-state ops-vng-loading">
          <KineticTextLoader text="SYNC" />
          <span>Loading health checks…</span>
        </div>
      ) : data ? (
        <>
          <div className="ops-meta-line ops-vng-meta">
            <span>
              Last checked <strong>{formatDate(data.checkedAt)}</strong>
            </span>
            <span className="mono">{checks.length} CHECKS REPORTED</span>
          </div>
          <GlowBorderCard
            width="100%"
            height="auto"
            borderRadius="12px"
            borderWidth="0.3em"
            blurAmount="0.8em"
            paused
            gradientColors={["#a78bfa", "#4338ca", "#14111f", "#a78bfa"]}
            className="ops-vng-signal-card"
          >
            <div className="ops-vng-signal-inner">
              <div className="ops-vng-signal-mark">
                <Activity size={18} />
                <span>
                  SYSTEM HEALTH
                  <br />
                  <b>CHECK RESULTS</b>
                </span>
              </div>
              <div className="ops-vng-metrics">
                <Metric
                  label="PROFILES READY"
                  value={ready}
                  note="configured for use"
                />
                <Metric
                  label="ACTIVE DEPLOYMENTS"
                  value={active}
                  note="reported by database"
                />
                <Metric
                  label="CHECKS"
                  value={checks.length}
                  note="separate checks"
                />
              </div>
            </div>
          </GlowBorderCard>
          <div className="ops-vng-subgrid ops-check-grid">
            {checks.length ? (
              checks.map(check => (
                <article className="ops-check ops-vng-check" key={check.id}>
                  <div>
                    <strong>{check.label}</strong>
                    <StatusBadge state={check.state} />
                  </div>
                  <p>{check.detail || "No detail reported."}</p>
                  <small>
                    {check.checkedAt
                      ? formatDate(check.checkedAt)
                      : "Not checked"}
                  </small>
                </article>
              ))
            ) : (
              <div className="ops-state">No health checks reported.</div>
            )}
          </div>
          <div className="ops-health-grid ops-vng-fact-grid">
            <dl className="ops-facts ops-vng-facts">
              <div className="ops-fact">
                <dt>Database migrations</dt>
                <dd>
                  <StatusBadge state={data.migrations.state} />{" "}
                  {data.migrations.applied}/{data.migrations.expected} applied
                </dd>
              </div>
              <div className="ops-fact ops-fact-stack">
                <dt>Pending migrations</dt>
                <dd>
                  {pending.length ? (
                    <ul className="ops-compact-list">
                      {pending.map(item => (
                        <li key={item}>
                          <code>{item}</code>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    "None reported"
                  )}
                </dd>
              </div>
            </dl>
            <dl className="ops-facts ops-vng-facts">
              <div className="ops-fact ops-fact-stack">
                <dt>Versions</dt>
                <dd>
                  <span>
                    App <Value value={data.versions.app} />
                  </span>
                  <span>
                    Installer <Value value={data.versions.installer} />
                  </span>
                  <span>
                    Launcher <Value value={data.versions.launcher} />
                  </span>
                </dd>
              </div>
              <CountList label="Configured profiles" values={data.profiles} />
              <p className="ops-muted">
                Ready means configured for use, not verified ISO access or a
                completed Windows installation.
              </p>
              <Link className="text-button ops-vng-link" href="/profiles">
                Manage installation profiles <ArrowUpRight size={13} />
              </Link>
              <CountList
                label="Commands permitted"
                values={
                  data.commands
                    ? {
                        available: data.commands.available,
                        expired: data.commands.expired,
                        revoked: data.commands.revoked,
                        total: data.commands.total,
                        batch: data.commands.batchCommands,
                      }
                    : null
                }
              />
            </dl>
          </div>
          <div className="ops-health-grid ops-vng-fact-grid">
            <dl className="ops-facts ops-vng-facts">
              <div className="ops-fact">
                <dt>Configured callback origin</dt>
                <dd>
                  <Value value={data.callback.origin} />{" "}
                  <span
                    className={
                      data.callback.httpsConfigured
                        ? "ops-good-text"
                        : "ops-warning-text"
                    }
                  >
                    {data.callback.httpsConfigured
                      ? "HTTPS configured"
                      : "HTTPS not configured"}
                  </span>
                </dd>
              </div>
              <div className="ops-fact">
                <dt>Observed current browser</dt>
                <dd>
                  {typeof window !== "undefined" &&
                  window.location.protocol === "https:"
                    ? "HTTPS"
                    : "Not HTTPS"}{" "}
                  <small>
                    (browser observation only; no certificate claim)
                  </small>
                </dd>
              </div>
            </dl>
            <dl className="ops-facts ops-vng-facts">
              <div className="ops-fact">
                <dt>Active deployments</dt>
                <dd>
                  {data.deployments ? (
                    <span>
                      {data.deployments.active} active ·{" "}
                      {data.deployments.stale} awaiting update ·{" "}
                      {data.deployments.failed} failed
                    </span>
                  ) : (
                    "Not available"
                  )}
                </dd>
              </div>
              <div className="ops-fact">
                <dt>Completed deployments</dt>
                <dd>{data.deployments?.completed ?? "Not available"}</dd>
              </div>
            </dl>
          </div>
          <dl className="ops-facts ops-backup ops-vng-backup">
            <div className="ops-fact">
              <dt>
                <ShieldCheck size={13} /> Backup state
              </dt>
              <dd>
                <StatusBadge state={data.backup.state} />{" "}
                {data.backup.outcome === "not-reported"
                  ? "Not reported"
                  : data.backup.outcome}
              </dd>
            </div>
            <div className="ops-fact">
              <dt>Latest attempt</dt>
              <dd>
                {data.backup.lastBackupAt
                  ? formatDate(data.backup.lastBackupAt)
                  : "Not reported"}
              </dd>
            </div>
            <div className="ops-fact">
              <dt>Encrypted size</dt>
              <dd>
                {data.backup.encryptedBytes == null
                  ? "Not reported"
                  : `${data.backup.encryptedBytes.toLocaleString()} bytes`}
              </dd>
            </div>
            <div className="ops-fact">
              <dt>Restore verification</dt>
              <dd>
                {data.backup.lastRestoreVerifiedAt
                  ? formatDate(data.backup.lastRestoreVerifiedAt)
                  : "Restore not tested"}
              </dd>
            </div>
          </dl>
        </>
      ) : (
        <div className="ops-state">
          Health data is not available.{" "}
          <button className="text-button" type="button" onClick={reload}>
            Retry
          </button>
        </div>
      )}
    </section>
  );
}
