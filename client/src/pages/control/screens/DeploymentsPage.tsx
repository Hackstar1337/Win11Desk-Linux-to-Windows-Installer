import { statuses } from "../ControlPrimitives";
import {
  RemoteInstallPanel,
  RemoteJobPanel,
} from "../../../components/control/remote-install";
import { remoteSettingsSchema } from "@shared/remoteInstall";
import PostInstallOptions, {
  PostInstallResults,
} from "../../../components/control/PostInstallOptions";
import {
  defaultPostInstallOptions,
  scriptCompatible,
  type PostInstallOptions as PostOptions,
} from "../../../../../shared/postInstall";
import { deploymentStatusLabel } from "../../../../../shared/deploymentStatus";
import ProfileSelector from "../../../components/control/ProfileSelector";
import ProfileFilter from "../../../components/control/ProfileFilter";
import type { ReadyProfile } from "../../../../../shared/deploymentProfiles";
import { FormEvent, useEffect, useRef, useState } from "react";
import "./DeploymentsPage.css";
import { Link, useParams } from "wouter";
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  ExternalLink,
  Filter,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Shield,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import DeploymentPresentation, {
  DeploymentTableRow,
} from "../../../components/control/DeploymentPresentation";
import {
  api,
  type User,
  downloadApiFile,
  formatDate,
  generateSecurePassword,
  newIdempotencyKey,
} from "../../../components/control/api";
import {
  formatBytes,
  Page,
  Panel,
  Notice,
  Stat,
  StateBadge,
  Empty,
  Loading,
  CopyButton,
  useLoad,
  StepUpModal,
} from "../ControlPrimitives";
import AnimatedButton from "../../../components/vengeance/animated-button";
import { AnimatedNumber } from "../../../components/vengeance/animated-number";
import { KineticTextLoader } from "../../../components/vengeance/kinetic-text-loader";

export function DeploymentsPage() {
  const [submittedJobId] = useState(() => {
    const value = new URLSearchParams(window.location.search).get("job") || "";
    return /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : "";
  });
  const [profileId, setProfileId] = useState(
    () => new URLSearchParams(window.location.search).get("p") || ""
  );
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [trash, setTrash] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState("created_desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState(() =>
    submittedJobId &&
    window.history.state?.installationStarted === submittedJobId
      ? "Installation started. Your request was accepted. Follow the job below; deployment rows appear when the VPS begins reporting."
      : ""
  );
  const [actionError, setActionError] = useState("");
  const [stepUp, setStepUp] = useState(false);
  const path = `/api/admin/deployments?${profileId ? "p=" + encodeURIComponent(profileId) + "&" : ""}page=${page}&pageSize=${pageSize}&status=${encodeURIComponent(status)}&q=${encodeURIComponent(query)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&sort=${encodeURIComponent(sort)}&trash=${encodeURIComponent(trash)}`;
  const { data, loading, error, reload } = useLoad<any>(
    path,
    [page, pageSize, status, query, trash, from, to, sort, profileId],
    true
  );
  const items = data?.items || [];
  async function bulk(action: "trash" | "restore" | "purge") {
    if (!selected.length) return;
    if (action === "purge") {
      setStepUp(true);
      return;
    }
    if (
      window.prompt(
        `Type confirm to ${action} ${selected.length} deployment(s).`
      ) !== "confirm"
    )
      return;
    try {
      await api("/api/admin/deployments/actions", {
        method: "POST",
        body: JSON.stringify({ action, ids: selected, confirm: true }),
      });
      setSelected([]);
      setNotice(action === "trash" ? "Moved to trash." : "Restored.");
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Bulk action failed.");
    }
  }
  async function purgeAfterStepUp() {
    if (
      window.prompt(
        `Type PURGE to permanently delete ${selected.length} deployment(s).`
      ) !== "PURGE"
    )
      return;
    try {
      await api("/api/admin/deployments/actions", {
        method: "POST",
        body: JSON.stringify({ action: "purge", ids: selected, confirm: true }),
      });
      setSelected([]);
      setNotice("Deployments purged.");
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Purge failed.");
    }
  }
  return (
    <Page
      eyebrow="INSTALLATIONS / HISTORY"
      title="Deployment history"
      intro="See when each deployment was created, its current progress, and any missing updates."
      actions={
        <>
          <button
            className="secondary-button"
            onClick={() =>
              void downloadApiFile(
                `/api/admin/deployments/export${profileId ? "?p=" + encodeURIComponent(profileId) : ""}`,
                "win11desk-deployments.csv"
              )
            }
          >
            <Download size={14} /> CSV
          </button>
          <button className="secondary-button" onClick={reload}>
            <RefreshCw size={14} /> Refresh
          </button>
        </>
      }
    >
      <div className="vng-history">
        {(error || actionError) && (
          <Notice kind="error" text={error || actionError} />
        )}
        {notice && <Notice text={notice} onClose={() => setNotice("")} />}
        {submittedJobId && (
          <Panel
            title="Installation progress"
            description="Live remote launch progress is available here while the target starts reporting its Windows deployment."
          >
            <RemoteJobPanel jobId={submittedJobId} />
            <Link
              className="panel-link"
              href={`/remote-jobs?job=${encodeURIComponent(submittedJobId)}`}
            >
              Open remote job <ExternalLink size={12} />
            </Link>
          </Panel>
        )}
        <div className="vng-history__intro">
          <div className="vng-history__signal">
            <div className="vng-history__signal-copy">
              <span className="vng-history__overline">DEPLOYMENT HISTORY</span>
              <h2>Your deployments</h2>
              <p>
                Review progress, status updates, commands and files for each
                installation.
              </p>
            </div>
            <div
              className="vng-history__count"
              aria-label={`${data?.total ?? 0} deployments`}
            >
              <AnimatedNumber value={Number(data?.total ?? 0)} />
              <small>deployments</small>
            </div>
          </div>
          <div className="vng-history__tools">
            <span className="vng-history__overline">
              Helpful actions
            </span>
            <p className="form-hint">
              Exports use the selected profile. Remote launch issues appear in
              the remote jobs list.
            </p>
            <div className="page-actions">
              <AnimatedButton
                className="vng-action"
                onClick={() =>
                  void downloadApiFile(
                    `/api/admin/deployments/export${profileId ? "?p=" + encodeURIComponent(profileId) : ""}`,
                    "win11desk-deployments.csv"
                  )
                }
              >
                <Download size={14} /> CSV
              </AnimatedButton>
              <AnimatedButton className="vng-action" onClick={reload}>
                <RefreshCw size={14} /> Refresh
              </AnimatedButton>
              <Link className="panel-link" href="/remote-jobs">
                Remote launch jobs <ExternalLink size={12} />
              </Link>
            </div>
          </div>
        </div>
        <Panel
          title="Find deployments"
          description="Filter the deployment history, then select rows for a protected bulk action."
        >
          <div className="vng-history__table-panel">
            <div className="filter-bar">
              <ProfileFilter
                value={profileId}
                onChange={v => {
                  setProfileId(v);
                  setPage(1);
                  setSelected([]);
                }}
              />
              <label className="search-box">
                <Search size={15} />
                <input
                  value={query}
                  onChange={e => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search label, hostname, IP or user"
                />
              </label>
              <label className="select-wrap">
                <Filter size={14} />
                <select
                  value={status}
                  onChange={e => {
                    setStatus(e.target.value);
                    setPage(1);
                  }}
                >
                  {statuses.map(s => (
                    <option key={s} value={s}>
                      {s
                        ? s === "stale"
                          ? deploymentStatusLabel(s)
                          : s[0].toUpperCase() + s.slice(1)
                        : "All statuses"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="select-wrap">
                <select
                  value={trash}
                  onChange={e => {
                    setTrash(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">Active history</option>
                  <option value="true">Trash</option>
                  <option value="archive">Archived</option>
                </select>
              </label>
              <label className="field compact">
                <span>Created from</span>
                <input
                  type="date"
                  value={from}
                  onChange={e => {
                    setFrom(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <label className="field compact">
                <span>Created to</span>
                <input
                  type="date"
                  value={to}
                  onChange={e => {
                    setTo(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <label className="select-wrap">
                <select value={sort} onChange={e => setSort(e.target.value)}>
                  <option value="created_desc">Newest</option>
                  <option value="created_asc">Oldest</option>
                  <option value="stage_desc">Stage</option>
                </select>
              </label>
            </div>
            {selected.length > 0 && (
              <div className="bulk-bar">
                <span>{selected.length} selected</span>
                <button
                  className="text-button"
                  onClick={() => void bulk("restore")}
                >
                  <RotateCcw size={13} />{" "}
                  {trash === "archive" ? "Restore to active" : "Restore"}
                </button>
                <button
                  className="text-button"
                  onClick={() => void bulk("trash")}
                >
                  <Trash2 size={13} /> Move to trash
                </button>
                <button
                  className="text-danger"
                  onClick={() => void bulk("purge")}
                >
                  Purge permanently
                </button>
              </div>
            )}
            <label className="deployment-select-all">
              <input
                type="checkbox"
                checked={Boolean(
                  items.length && selected.length === items.length
                )}
                onChange={e =>
                  setSelected(
                    e.target.checked ? items.map((item: any) => item.id) : []
                  )
                }
                aria-label="Select all visible deployments"
              />
              <span>Select all visible deployments</span>
            </label>
            <div
              className="deployment-table-wrap"
              role="region"
              aria-label="Deployment history rows"
              tabIndex={0}
            >
              <table className="deployment-history-table">
                <thead>
                  <tr>
                    <th aria-label="Select" />
                    <th>Created / label</th>
                    <th>IP address : port</th>
                    <th>Username</th>
                    <th>RDP password</th>
                    <th>Status / download</th>
                    <th>Elapsed</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item: any) => (
                    <DeploymentTableRow
                      key={item.id}
                      deployment={item}
                      label={item.label}
                      selected={selected.includes(item.id)}
                      onSelect={checked =>
                        setSelected(
                          checked
                            ? [...selected, item.id]
                            : selected.filter(id => id !== item.id)
                        )
                      }
                      onRdpDownload={
                        item.publicIP
                          ? () =>
                              void downloadApiFile(
                                `/api/admin/deployments/${encodeURIComponent(item.id)}/rdp`,
                                `${item.hostname || item.id}.rdp`
                              )
                          : undefined
                      }
                    />
                  ))}
                </tbody>
              </table>
              {loading && (
                <KineticTextLoader
                  text="Loading history"
                  className="vng-history__loader"
                />
              )}
              {!loading && !items.length && (
                <Empty>No deployments match these filters.</Empty>
              )}
            </div>
            <div className="pagination">
              <span>
                {data?.total ?? 0} total · page {data?.page ?? page}
              </span>
              <label className="history-page-size">
                Rows per page{" "}
                <select
                  aria-label="Rows per page"
                  value={pageSize}
                  onChange={e => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                    setSelected([]);
                  }}
                >
                  {[25, 50, 100].map(size => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <button
                  className="secondary-button"
                  disabled={page <= 1}
                  onClick={() => setPage(v => v - 1)}
                >
                  Previous
                </button>
                <button
                  className="secondary-button"
                  disabled={items.length < (data?.pageSize || pageSize)}
                  onClick={() => setPage(v => v + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </Panel>
      </div>
      <StepUpModal
        open={stepUp}
        title="Confirm purge"
        onCancel={() => setStepUp(false)}
        onVerified={async () => {
          setStepUp(false);
          await purgeAfterStepUp();
        }}
      />
    </Page>
  );
}
