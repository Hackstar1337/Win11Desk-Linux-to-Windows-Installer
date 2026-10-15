import { useCallback, useState } from "react";
import { Bell, Check, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { api, formatDate } from "../api";
import type { KindFilter, NotificationsResponse, ReadFilter } from "./types";
import { useVisiblePolling } from "./useVisiblePolling";

interface Props {
  open: boolean;
  onToggle: () => void;
}
export default function NotificationsPanel({ open, onToggle }: Props) {
  const [read, setRead] = useState<ReadFilter>("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [actionError, setActionError] = useState("");
  const path = `/api/admin/notifications?read=${read}&kind=${kind}`;
  const loader = useCallback(
    (signal: AbortSignal) => api<NotificationsResponse>(path, { signal }),
    [path]
  );
  const resource = useVisiblePolling(loader);
  const items = resource.data?.items || resource.data?.notifications || [];
  async function markRead(id: string) {
    setActionError("");
    try {
      await api(`/api/admin/notifications/${id}/read`, { method: "POST" });
      resource.reload();
    } catch (reason) {
      setActionError(
        reason instanceof Error
          ? reason.message
          : "Unable to mark notification read."
      );
    }
  }
  async function markAllRead() {
    setActionError("");
    try {
      await api("/api/admin/notifications/read-all", {
        method: "POST",
        body: JSON.stringify({}),
      });
      resource.reload();
    } catch (reason) {
      setActionError(
        reason instanceof Error
          ? reason.message
          : "Unable to mark notifications read."
      );
    }
  }
  return (
    <section
      className={`ops-panel ops-vng-panel ops-notifications ${open ? "is-open" : "is-collapsed"}`}
      aria-labelledby="operations-notifications-title"
    >
      <div className="ops-panel-heading ops-vng-heading">
        <div>
          <span className="ops-vng-section-no">INBOX / SIGNALS</span>
          <h2 id="operations-notifications-title">
            <Bell size={15} /> Notifications{" "}
            {resource.data?.unreadCount ? (
              <span className="ops-unread">
                {resource.data.unreadCount} unread
              </span>
            ) : null}
          </h2>
          <p>
            Completion and failure notices only. Administrative audit records
            remain internal.
          </p>
        </div>
        <div className="ops-notification-actions">
          <button
            className="secondary-button ops-vng-button"
            type="button"
            onClick={onToggle}
          >
            {open ? "Hide" : "Show"}
          </button>
          {open && (
            <button
              className="text-button"
              type="button"
              onClick={() => void markAllRead()}
              disabled={!items.some(item => !item.readAt)}
            >
              <Check size={13} /> Mark all read
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="ops-notification-body">
          <div className="ops-filter-row">
            <label>
              Read
              <select
                value={read}
                onChange={event => setRead(event.target.value as ReadFilter)}
              >
                <option value="all">All</option>
                <option value="unread">Unread</option>
                <option value="read">Read</option>
              </select>
            </label>
            <label>
              Kind
              <select
                value={kind}
                onChange={event => setKind(event.target.value as KindFilter)}
              >
                <option value="all">All kinds</option>
                <option value="failed">Failed</option>
                <option value="completed">Completed</option>
              </select>
            </label>
            <button
              className="secondary-button ops-vng-button"
              type="button"
              onClick={resource.reload}
              disabled={resource.loading}
            >
              <RefreshCw
                size={13}
                className={resource.loading ? "ops-spin" : ""}
              />{" "}
              Refresh
            </button>
          </div>
          {(resource.error || actionError) && (
            <div className="ops-inline-error ops-vng-inline" role="alert">
              <span>{resource.error || actionError}</span>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setActionError("");
                  resource.reload();
                }}
              >
                Retry
              </button>
            </div>
          )}
          {resource.loading && !resource.data ? (
            <div className="ops-state">Loading notifications…</div>
          ) : items.length ? (
            <div className="ops-notification-list">
              {items.map(item => (
                <article
                  className={`ops-notification ${item.readAt ? "is-read" : "is-unread"}`}
                  key={item.id}
                >
                  <span className="ops-notification-dot" />
                  <div>
                    <div className="ops-notification-title">
                      <strong>{item.title}</strong>
                      <time>{formatDate(item.createdAt)}</time>
                    </div>
                    <p>{item.body}</p>
                    {item.runId && (
                      <Link
                        className="text-button"
                        href={`/deployments/${item.runId}`}
                      >
                        Open deployment
                      </Link>
                    )}
                  </div>
                  {!item.readAt && (
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => void markRead(item.id)}
                    >
                      Mark read
                    </button>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="ops-state">
              No notifications match these filters.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
