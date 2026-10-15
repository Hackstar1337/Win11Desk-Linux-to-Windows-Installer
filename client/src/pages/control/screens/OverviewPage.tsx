import { useMemo } from "react";
import { Link } from "wouter";
import { useReducedMotion } from "framer-motion";
import {
  Activity,
  ArrowUpRight,
  Clock3,
  Command,
  ExternalLink,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
  UserPlus,
} from "lucide-react";
import AnimatedButton from "../../../components/vengeance/animated-button";
import { AnimatedNumber } from "../../../components/vengeance/animated-number";
import { GlowBorderCard } from "../../../components/vengeance/glow-border-card";
import {
  Empty,
  formatBytes,
  Loading,
  Notice,
  Page,
  StateBadge,
  useLoad,
} from "../ControlPrimitives";
import { formatDate } from "../../../components/control/api";
import "./OverviewPage.css";

type OverviewDeployment = {
  id?: string;
  label?: string | null;
  stage?: string | null;
  status?: string | null;
  stale?: boolean | null;
  phase?: string | null;
  downloadedBytes?: number | null;
  totalBytes?: number | null;
  createdAt?: string | null;
  publicIP?: string | null;
  rdpPort?: number | string | null;
  username?: string | null;
  profile?: { name?: string | null; osId?: string | null } | null;
  os?: string | null;
};

type OverviewData = {
  counts?: Record<string, number | null | undefined>;
  recent?: OverviewDeployment[];
  notifications?: Array<{
    id?: string | number;
    title?: string | null;
    message?: string | null;
    body?: string | null;
    createdAt?: string | null;
  }>;
  notices?: OverviewData["notifications"];
};

function countValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function deploymentProgress(item: OverviewDeployment) {
  const downloaded = Number(item.downloadedBytes);
  const total = Number(item.totalBytes);
  if (!Number.isFinite(downloaded) || !Number.isFinite(total) || total <= 0) {
    return null;
  }
  return Math.min(100, Math.max(0, Math.round((downloaded / total) * 100)));
}

function deploymentLabel(item: OverviewDeployment) {
  return (
    item.label?.trim() || item.publicIP || item.id || "Unnamed deployment"
  );
}

function OverviewNumber({
  value,
  reducedMotion,
  className,
}: {
  value: number;
  reducedMotion: boolean;
  className?: string;
}) {
  return reducedMotion ? (
    <span className={className}>{value}</span>
  ) : (
    <AnimatedNumber value={value} className={className} />
  );
}

export function OverviewPage() {
  const reducedMotion = useReducedMotion() ?? false;
  const { data, loading, error, reload } = useLoad<OverviewData>(
    "/api/admin/overview"
  );
  const counts = data?.counts || {};
  const recent = useMemo(
    () => (Array.isArray(data?.recent) ? data.recent : []),
    [data?.recent]
  );
  const notices = Array.isArray(data?.notifications)
    ? data.notifications
    : Array.isArray(data?.notices)
      ? data.notices
      : [];
  const attention = countValue(
    counts.attention,
    countValue(counts.failed) + countValue(counts.stale)
  );

  return (
    <Page
      eyebrow="INSTALLATIONS / OVERVIEW"
      title="Installation overview"
      intro="Track your Windows installations, review progress, and manage commands and account access."
      actions={
        reducedMotion ? (
          <button
            className="overview-vng-refresh secondary-button"
            type="button"
            onClick={reload}
            aria-label="Refresh overview"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        ) : (
          <AnimatedButton
            className="overview-vng-refresh secondary-button"
            type="button"
            onClick={reload}
            aria-label="Refresh overview"
          >
            <RefreshCw size={14} /> Refresh
          </AnimatedButton>
        )
      }
    >
      <div className="overview-vng" data-route="overview">
        {error && <Notice kind="error" text={error} />}
        {loading && !data ? (
          <div className="overview-vng-loading" role="status">
            <Loading />
          </div>
        ) : (
          <>
            <GlowBorderCard
              className="overview-vng-hero"
              width="100%"
              height="auto"
              aspectRatio="unset"
              borderRadius="18px"
              borderWidth="1px"
              blurAmount="18px"
              inset="-2px"
              gradientColors={["#a78bfa", "#6d5ad5", "#27213d", "#a78bfa"]}
              paused
            >
              <div className="overview-vng-hero-inner">
                <div className="overview-vng-hero-copy">
                  <span className="overview-vng-kicker">
                    <span className="overview-vng-signal" />
                    WORKSPACE / INSTALLATION OVERVIEW
                  </span>
                  <h2>Track your Windows installations</h2>
                  <p>
                    Progress, commands, and items needing review from saved
                    installation records.
                  </p>
                  <div className="overview-vng-hero-actions">
                    <Link className="overview-vng-primary" href="/installer">
                      <Terminal size={15} /> Generate installer
                      <ArrowUpRight size={14} />
                    </Link>
                    <Link
                      className="overview-vng-quiet-link"
                      href="/deployments"
                    >
                      Open deployment history <ExternalLink size={13} />
                    </Link>
                  </div>
                </div>
                <div
                  className="overview-vng-hero-aside"
                  aria-label="Installation status"
                >
                  <span className="overview-vng-aside-label">
                    CONNECTED NOW
                  </span>
                  <strong>
                    <OverviewNumber
                      value={countValue(
                        counts.reporting,
                        countValue(counts.active)
                      )}
                      reducedMotion={reducedMotion}
                      className="overview-vng-hero-number"
                    />
                  </strong>
                  <span className="overview-vng-aside-note">
                    {attention
                      ? `${attention} need attention`
                      : "Nothing needs attention"}
                  </span>
                </div>
              </div>
            </GlowBorderCard>

            <section
              className="stat-strip overview-vng-metrics"
              aria-label="Installation metrics"
            >
              <div className="stat overview-vng-metric">
                <span>Active deployments</span>
                <strong>
                  <OverviewNumber
                    value={countValue(
                      counts.active ?? counts.activeDeployments
                    )}
                    reducedMotion={reducedMotion}
                  />
                </strong>
                <small>currently reporting</small>
              </div>
              <div className="stat overview-vng-metric">
                <span>Completed</span>
                <strong>
                  <OverviewNumber
                    value={countValue(counts.completed)}
                    reducedMotion={reducedMotion}
                  />
                </strong>
                <small>Windows ready</small>
              </div>
              <div className="stat overview-vng-metric overview-vng-metric-alert">
                <span>Needs attention</span>
                <strong>
                  <OverviewNumber
                    value={attention}
                    reducedMotion={reducedMotion}
                  />
                </strong>
                <small>failed or awaiting update</small>
              </div>
              <div className="stat overview-vng-metric">
                <span>Commands</span>
                <strong>
                  <OverviewNumber
                    value={countValue(counts.commands)}
                    reducedMotion={reducedMotion}
                  />
                </strong>
                <small>generated</small>
              </div>
            </section>

            <div className="overview-vng-workbench two-column">
              <section
                className="overview-vng-surface overview-vng-deployments"
                aria-labelledby="overview-recent-title"
              >
                <div className="overview-vng-section-heading">
                  <div>
                    <span className="overview-vng-index">DEPLOYMENTS</span>
                    <h2 id="overview-recent-title">Recent deployments</h2>
                    <p>
                      Latest deployments, with progress and transfer details
                      where available.
                    </p>
                  </div>
                  <Link
                    className="overview-vng-icon-link"
                    href="/deployments"
                    aria-label="Open deployment history"
                  >
                    <ExternalLink size={15} />
                  </Link>
                </div>
                {recent.length ? (
                  <div className="overview-vng-deployment-list">
                    {recent.map((item, index) => {
                      const progress = deploymentProgress(item);
                      const state = item.stale
                        ? "stale"
                        : item.stage || item.status || "unknown";
                      return (
                        <Link
                          className="overview-vng-deployment-row"
                          href={
                            item.id
                              ? `/deployments/${encodeURIComponent(item.id)}`
                              : "/deployments"
                          }
                          key={item.id || `${deploymentLabel(item)}-${index}`}
                        >
                          <span
                            className="overview-vng-row-mark"
                            aria-hidden="true"
                          >
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span className="overview-vng-row-main">
                            <strong>{deploymentLabel(item)}</strong>
                            <span>
                              {item.profile?.name ||
                                item.os ||
                                "Windows profile"}
                              {item.publicIP
                                ? ` · ${item.publicIP}${item.rdpPort ? `:${item.rdpPort}` : ""}`
                                : ""}
                            </span>
                          </span>
                          <span className="overview-vng-row-meta">
                            <StateBadge value={state} />
                            <small>
                              {item.createdAt
                                ? formatDate(item.createdAt)
                                : "Created date unavailable"}
                            </small>
                          </span>
                          <span className="overview-vng-row-progress">
                            {progress !== null ? (
                              <>
                                <span className="overview-vng-progress-track">
                                  <i style={{ width: `${progress}%` }} />
                                </span>
                                <small>
                                  {progress}% ·{" "}
                                  {formatBytes(Number(item.downloadedBytes))}
                                </small>
                              </>
                            ) : (
                              <small>
                                {item.phase || "Transfer details unavailable"}
                              </small>
                            )}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                ) : (
                  <Empty>No deployments have been recorded yet.</Empty>
                )}
              </section>

              <aside
                className="overview-vng-rail"
                aria-label="Installation activity"
              >
                <section className="overview-vng-surface overview-vng-picture">
                  <div className="overview-vng-section-heading compact">
                    <div>
                      <span className="overview-vng-index">STATUS</span>
                      <h2>Current status</h2>
                    </div>
                    <Activity size={16} aria-hidden="true" />
                  </div>
                  <dl className="overview-list overview-vng-facts">
                    <div>
                      <dt>Reporting now</dt>
                      <dd>
                        {countValue(
                          counts.reporting,
                          countValue(counts.active)
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Awaiting first connection</dt>
                      <dd>{countValue(counts.pending)}</dd>
                    </div>
                    <div>
                      <dt>Archived history</dt>
                      <dd>{countValue(counts.archived)}</dd>
                    </div>
                  </dl>
                </section>

                <section className="overview-vng-surface overview-vng-notices">
                  <div className="overview-vng-section-heading compact">
                    <div>
                      <span className="overview-vng-index">NOTICES</span>
                      <h2>Shared notices</h2>
                    </div>
                    <ShieldCheck size={16} aria-hidden="true" />
                  </div>
                  {notices.length ? (
                    <div className="overview-vng-notice-list notice-list">
                      {notices.slice(0, 4).map((notice, index) => (
                        <div
                          className="overview-vng-notice notice-row"
                          key={notice.id || index}
                        >
                          <span className="overview-vng-notice-dot notice-dot" />
                          <span>
                            <strong>
                              {notice.title ||
                                notice.message ||
                                "Account notice"}
                            </strong>
                            <small>
                              {notice.createdAt
                                ? formatDate(notice.createdAt)
                                : notice.body || "Shared notice"}
                            </small>
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty>No notices are waiting for review.</Empty>
                  )}
                </section>
              </aside>
            </div>

            <section
              className="overview-vng-entrypoints"
              aria-labelledby="overview-entrypoints-title"
            >
              <div className="overview-vng-entry-heading">
                <div>
                  <span className="overview-vng-index">ACTIONS</span>
                  <h2 id="overview-entrypoints-title">Quick actions</h2>
                </div>
                <span className="overview-vng-mono">
                  QUICK LINKS
                </span>
              </div>
              <div className="overview-vng-entry-grid quick-actions">
                <Link
                  className="overview-vng-entry quick-action"
                  href="/installer"
                >
                  <span className="overview-vng-entry-number">01</span>
                  <span className="overview-vng-entry-icon">
                    <Command size={16} />
                  </span>
                  <span>
                    <strong>Generate installer</strong>
                    <small>Windows installer with standard file settings</small>
                  </span>
                  <ArrowUpRight
                    size={15}
                    className="overview-vng-entry-arrow"
                  />
                </Link>
                <Link
                  className="overview-vng-entry quick-action"
                  href="/deployments"
                >
                  <span className="overview-vng-entry-number">02</span>
                  <span className="overview-vng-entry-icon">
                    <Server size={16} />
                  </span>
                  <span>
                    <strong>Review deployments</strong>
                    <small>Filter deployments, notes, and status</small>
                  </span>
                  <ArrowUpRight
                    size={15}
                    className="overview-vng-entry-arrow"
                  />
                </Link>
                <Link className="overview-vng-entry quick-action" href="/users">
                  <span className="overview-vng-entry-number">03</span>
                  <span className="overview-vng-entry-icon">
                    <UserPlus size={16} />
                  </span>
                  <span>
                    <strong>Manage account access</strong>
                    <small>Invite a teammate and set access</small>
                  </span>
                  <ArrowUpRight
                    size={15}
                    className="overview-vng-entry-arrow"
                  />
                </Link>
              </div>
            </section>

            <div className="overview-vng-footer-note">
              <Clock3 size={13} /> Counts come from saved deployment records;
              refresh to see the latest status.
            </div>
          </>
        )}
      </div>
    </Page>
  );
}
