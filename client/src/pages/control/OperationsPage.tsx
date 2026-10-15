import StorageView from "../../components/control/operations/StorageView";
import MaintenanceView from "../../components/control/operations/MaintenanceView";
import type { OperationsStorage } from "@shared/operationsStorage";
import { RemoteWorkerHealth } from "../../components/control/remote-install";
import { useCallback, useEffect, useState } from "react";
import { Bell, RefreshCw, ShieldCheck } from "lucide-react";
import { useLocation } from "wouter";
import type { User } from "../../components/control/api";
import { api } from "../../components/control/api";
import type {
  OperationsAttention,
  OperationsHealth,
} from "@shared/operationsDashboard";
import AttentionView from "../../components/control/operations/AttentionView";
import HealthView from "../../components/control/operations/HealthView";
import NotificationsPanel from "../../components/control/operations/NotificationsPanel";
import RecoveryView from "../../components/control/operations/RecoveryView";
import { useVisiblePolling } from "../../components/control/operations/useVisiblePolling";
import { SpotlightNavbar } from "../../components/vengeance/spotlight-navbar";
import "../../components/control/operations/OperationsPage.css";

interface Props {
  user: User;
}
type Tab = "health" | "attention" | "recovery" | "maintenance";

export default function OperationsPage({ user }: Props) {
  const [location] = useLocation();
  const [tab, setTab] = useState<Tab>("health");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [redirectNotice, setRedirectNotice] = useState("");
  const isAdmin = user.role === "owner" || user.role === "admin";

  const healthLoader = useCallback(
    (signal: AbortSignal) =>
      api<OperationsHealth>("/api/admin/operations/health", { signal }),
    []
  );
  const attentionLoader = useCallback(
    (signal: AbortSignal) =>
      api<OperationsAttention>("/api/admin/operations/attention", { signal }),
    []
  );
  const storageLoader = useCallback(
    (signal: AbortSignal) =>
      api<OperationsStorage>("/api/admin/operations/storage", { signal }),
    []
  );
  const storage = useVisiblePolling(storageLoader, 15_000, tab === "health");
  const health = useVisiblePolling(healthLoader);
  const attention = useVisiblePolling(attentionLoader);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("removed") === "activity") {
      setRedirectNotice(
        "The standalone Activity section was removed. Security audit records are retained internally; Operations focuses on health, attention, recovery and installation notices."
      );
      params.delete("removed");
      const query = params.toString();
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
      );
    }
  }, [location]);

  useEffect(() => {
    if (!isAdmin) setNotificationsOpen(false);
  }, [isAdmin]);

  const refreshCurrent = () => {
    if (tab === "health" || tab === "recovery") health.reload();
    if (tab === "health") storage.reload();
    if (tab === "attention") attention.reload();
  };
  const navItems = [
    { label: "01 / Health", href: "#health" },
    { label: "02 / Attention", href: "#attention" },
    { label: "03 / Recovery", href: "#recovery" },
    ...(user.role === "owner"
      ? [{ label: "04 / Maintenance", href: "#maintenance" }]
      : []),
  ];

  return (
    <section
      className="operations-page operations-vng"
      aria-label="Operations workspace"
    >
      <header className="ops-header ops-vng-hero">
        <div className="ops-vng-title-block">
          <div className="ops-vng-kicker">
            <span className="ops-vng-index">SERVER</span>
            <span>STATUS & MAINTENANCE</span>
          </div>
          <h1>
            Operations<span className="ops-vng-cursor">_</span>
          </h1>
          <p>Check server health, storage usage and installation issues.</p>
        </div>
        <div className="ops-header-actions ops-vng-actions">
          {tab !== "maintenance" && (
            <button
              className="secondary-button ops-vng-button"
              type="button"
              onClick={refreshCurrent}
            >
              <RefreshCw size={14} aria-hidden="true" /> Refresh current
            </button>
          )}
          {isAdmin && (
            <button
              className="secondary-button ops-vng-button"
              type="button"
              onClick={() => setNotificationsOpen(value => !value)}
            >
              <Bell size={14} aria-hidden="true" />{" "}
              {notificationsOpen ? "Hide notifications" : "Notifications"}
            </button>
          )}
        </div>
      </header>

      <div className="ops-vng-rail-meta">
        <span>
          <ShieldCheck size={13} /> PORTAL CHECKS
        </span>
        <span className="mono">POLL / VISIBLE ONLY</span>
      </div>
      {redirectNotice && (
        <div className="ops-inline-success ops-vng-notice" role="status">
          <span>{redirectNotice}</span>
          <button
            className="text-button"
            type="button"
            onClick={() => setRedirectNotice("")}
          >
            Dismiss
          </button>
        </div>
      )}
      {isAdmin && (
        <NotificationsPanel
          open={notificationsOpen}
          onToggle={() => setNotificationsOpen(value => !value)}
        />
      )}

      <SpotlightNavbar
        className="ops-tabs ops-vng-nav"
        items={navItems}
        defaultActiveIndex={0}
        onItemClick={item => setTab(item.href.slice(1) as Tab)}
      />

      <div className="ops-vng-context">
        <span className="ops-vng-context-line" />
        {tab === "health"
          ? "SYSTEM HEALTH CHECKS"
          : tab === "attention"
            ? "REVIEW DEPLOYMENT PROBLEMS"
            : tab === "recovery"
              ? "RECOVERY PROCEDURES AND FILES"
              : "OWNER-ONLY DATA MANAGEMENT"}
      </div>
      {tab === "health" && isAdmin && <RemoteWorkerHealth />}
      {tab === "health" && <StorageView {...storage} />}
      {tab === "health" && <HealthView {...health} />}
      {tab === "maintenance" && (
        <MaintenanceView
          user={user}
          onChanged={() => {
            health.reload();
            attention.reload();
            storage.reload();
          }}
        />
      )}
      {tab === "attention" && <AttentionView {...attention} />}
      {tab === "recovery" && (
        <RecoveryView
          user={user}
          health={health.data}
          healthLoading={health.loading}
          healthError={health.error}
          reloadHealth={health.reload}
        />
      )}
    </section>
  );
}
