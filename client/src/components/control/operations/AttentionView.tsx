import { deploymentStatusLabel } from "@shared/deploymentStatus";
import { useState } from "react";
import { Link } from "wouter";
import type { OperationsAttention } from "@shared/operationsDashboard";
import { formatAge, formatDate } from "../api";
import { safeFailureGuidance } from "@shared/operationsDashboard";
import type { AttentionResource } from "./types";

function elapsed(createdAt: string, finishedAt?: string | null) {
  const end = finishedAt ? Date.parse(finishedAt) : Date.now();
  const start = Date.parse(createdAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "—";
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export default function AttentionView({
  data,
  error,
  loading,
  reload,
}: AttentionResource) {
  const [details, setDetails] = useState<string | null>(null);
  const items = data?.items || [];
  return (
    <section className="ops-panel" aria-labelledby="operations-attention-title">
      <div className="ops-panel-heading">
        <div>
          <h2 id="operations-attention-title">Needs attention</h2>
          <p>
            Failed deployments or deployments awaiting update, bounded to the
            server-provided limit. This view offers inspection, never remote
            action.
          </p>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={reload}
          disabled={loading}
        >
          Refresh
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
        <div className="ops-state">Loading attention items…</div>
      ) : data && items.length ? (
        <>
          <div className="ops-meta-line">
            <span>
              Last checked <strong>{formatDate(data.checkedAt)}</strong>
            </span>
            <span>
              Showing {items.length} of {data.limit}
            </span>
          </div>
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Deployment / IP</th>
                  <th>Profile</th>
                  <th>Heartbeat</th>
                  <th>Created</th>
                  <th>Elapsed</th>
                  <th>Safe code</th>
                  <th>Next step</th>
                  <th>Inspect</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id}>
                    <td>
                      <span className={`ops-status ops-status-${item.status}`}>
                        {item.status === "unknown"
                          ? "Unknown evidence"
                          : item.status === "stale"
                            ? deploymentStatusLabel(item.status)
                            : item.stage}
                      </span>
                      {item.status === "stale" && (
                        <small>
                          Last stage: {deploymentStatusLabel(item.stage)}
                        </small>
                      )}
                    </td>
                    <td>
                      <strong>{item.label}</strong>
                      <small className="mono">
                        {item.publicIP || "Not reported"}
                      </small>
                    </td>
                    <td>
                      {item.profileName || "Legacy / custom"}
                      <small>{item.os}</small>
                    </td>
                    <td>
                      {item.lastHeartbeatAt
                        ? formatAge(item.lastHeartbeatAt)
                        : "No heartbeat"}
                    </td>
                    <td>{formatDate(item.createdAt)}</td>
                    <td>
                      {item.status === "failed" && !item.finishedAt
                        ? "Not reported"
                        : elapsed(
                            item.startedAt || item.createdAt,
                            item.finishedAt
                          )}
                    </td>
                    <td className="mono">{item.safeCode || "—"}</td>
                    <td className="ops-next-step">
                      {item.nextStep || safeFailureGuidance(item.safeCode)}
                    </td>
                    <td>
                      <div className="ops-row-actions">
                        <button
                          className="text-button"
                          type="button"
                          onClick={() =>
                            setDetails(details === item.id ? null : item.id)
                          }
                        >
                          {details === item.id ? "Hide" : "Details"}
                        </button>
                        <Link
                          className="text-button"
                          href={`/deployments/${item.id}`}
                        >
                          Open timeline
                        </Link>
                        {item.profileId && (
                          <Link
                            className="text-button"
                            href={`/deployments?p=${encodeURIComponent(item.profileId)}`}
                          >
                            Profile history
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {details &&
            (() => {
              const item = items.find(value => value.id === details);
              return item ? (
                <div
                  className="ops-detail"
                  role="region"
                  aria-label={`Details for ${item.id}`}
                >
                  <div>
                    <strong>{item.label}</strong>
                    <span className="mono">{item.id}</span>
                  </div>
                  <dl className="ops-detail-grid">
                    <div>
                      <dt>Operating system</dt>
                      <dd>{item.os || "Not reported"}</dd>
                    </div>
                    <div>
                      <dt>Username</dt>
                      <dd>{item.username || "Not reported"}</dd>
                    </div>
                    <div>
                      <dt>Started</dt>
                      <dd>{formatDate(item.startedAt)}</dd>
                    </div>
                    <div>
                      <dt>Finished</dt>
                      <dd>{formatDate(item.finishedAt)}</dd>
                    </div>
                    <div>
                      <dt>Heartbeat</dt>
                      <dd>{formatDate(item.lastHeartbeatAt)}</dd>
                    </div>
                    <div>
                      <dt>Guidance</dt>
                      <dd>{safeFailureGuidance(item.safeCode)}</dd>
                    </div>
                  </dl>
                  <p className="ops-muted">
                    Credentials, raw logs, and remote controls are intentionally
                    not displayed here.
                  </p>
                </div>
              ) : null;
            })()}
        </>
      ) : data ? (
        <div className="ops-state">
          <strong>Nothing needs attention.</strong>
          <span>
            Failed deployments and deployments awaiting update will appear here
            when reported.
          </span>
        </div>
      ) : (
        <div className="ops-state">
          Attention data is not available.{" "}
          <button className="text-button" type="button" onClick={reload}>
            Retry
          </button>
        </div>
      )}
    </section>
  );
}
