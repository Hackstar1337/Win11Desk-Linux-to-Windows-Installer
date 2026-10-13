import { Link } from "wouter";
import { RefreshCw } from "lucide-react";
import type { OperationsHealth, CheckState } from "@shared/operationsDashboard";
import { formatDate } from "../api";
import type { HealthResource } from "./types";

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
            <b>{value}</b> {key}
          </span>
        ))}
      </dd>
    </div>
  );
}

export default function HealthView({ data, error, loading, reload }: Props) {
  const checks = data?.checks || [];
  const pending = data?.migrations?.pending || [];
  return (
    <section className="ops-panel" aria-labelledby="operations-health-title">
      <div className="ops-panel-heading">
        <div>
          <h2 id="operations-health-title">System health</h2>
          <p>
            Read-only checks from the control plane. Each check keeps its own
            reported state.
          </p>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={reload}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? "ops-spin" : ""} /> Refresh
        </button>
      </div>
      {error && (
        <div className="ops-inline-error" role="alert">
          <span>{error}</span>
          <button className="text-button" type="button" onClick={reload}>
            Retry
          </button>
        </div>
      )}
      {loading && !data ? (
        <div className="ops-state">Loading health checks…</div>
      ) : data ? (
        <>
          <div className="ops-meta-line">
            <span>
              Last checked <strong>{formatDate(data.checkedAt)}</strong>
            </span>
            <span>{checks.length} checks reported</span>
          </div>
          <div className="ops-check-grid">
            {checks.length ? (
              checks.map(check => (
                <article className="ops-check" key={check.id}>
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
          <div className="ops-health-grid">
            <dl className="ops-facts">
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
            <dl className="ops-facts">
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
                Ready means configured for issuance, not verified ISO
                reachability or new-OS installation certification.
              </p>
              <Link className="text-button" href="/profiles">
                Manage deployment profiles
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
          <div className="ops-health-grid">
            <dl className="ops-facts">
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
            <dl className="ops-facts">
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
          <dl className="ops-facts ops-backup">
            <div className="ops-fact">
              <dt>Backup state</dt>
              <dd>
                <StatusBadge state={data.backup.state} />{" "}
                {data.backup.outcome === "not-reported"
                  ? "Not reported"
                  : data.backup.outcome}
              </dd>
            </div>
            <div className="ops-fact">
              <dt>Latest backup attempt</dt>
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
