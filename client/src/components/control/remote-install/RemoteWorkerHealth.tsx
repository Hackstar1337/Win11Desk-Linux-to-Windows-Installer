import { useEffect, useState } from "react";
import { api, formatDate } from "../api";
import type { RemoteHealth } from "../../../../../shared/remoteInstall";
import "./remote-install.css";

export default function RemoteWorkerHealth() {
  const [health, setHealth] = useState<RemoteHealth | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  async function load(signal?: AbortSignal) {
    try {
      setHealth(
        await api<RemoteHealth>("/api/admin/remote/health", {
          signal,
          headers: { "X-Admin-Polling": "1" },
        })
      );
      setError("");
    } catch (reason) {
      if (!(reason instanceof Error && reason.name === "AbortError"))
        setError(
          reason instanceof Error
            ? reason.message
            : "Worker health could not be loaded."
        );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(controller.signal);
    }, 5000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);
  return (
    <section
      className="remote-worker-health"
      aria-labelledby="remote-worker-health-title"
    >
      <div className="remote-section-heading">
        <div>
          <h3 id="remote-worker-health-title">Remote worker health</h3>
          <p>
            Read-only queue and heartbeat evidence. This panel has no hidden
            write or control action.
          </p>
        </div>
      </div>
      {error && (
        <div className="remote-message is-error" role="alert">
          {error}
        </div>
      )}
      {loading && !health ? (
        <div className="remote-muted">Loading worker health…</div>
      ) : health ? (
        <>
          {!health.enabled && (
            <div className="remote-message">
              Remote install is disabled in this ordinary preview. No real SSH
              connection is made.
            </div>
          )}
          <dl className="remote-health-grid">
            <div>
              <dt>Worker</dt>
              <dd>{health.workerAlive ? "Alive" : "Not reporting"}</dd>
            </div>
            <div>
              <dt>Heartbeat</dt>
              <dd>{formatDate(health.workerHeartbeatAt)}</dd>
            </div>
            <div>
              <dt>Queued</dt>
              <dd>{health.queued}</dd>
            </div>
            <div>
              <dt>Oldest queued</dt>
              <dd>{formatDate(health.oldestQueuedAt)}</dd>
            </div>
            <div>
              <dt>Uncertain launches</dt>
              <dd>{health.uncertain}</dd>
            </div>
          </dl>
        </>
      ) : null}
    </section>
  );
}
