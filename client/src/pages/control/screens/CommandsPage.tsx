import { useMemo, useState } from "react";
import {
  ExternalLink,
  FileDown,
  Filter,
  KeyRound,
  RefreshCw,
  Search,
  ShieldCheck,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { Link } from "wouter";
import AnimatedButton from "../../../components/vengeance/animated-button";
import { AnimatedNumber } from "../../../components/vengeance/animated-number";
import GlowBorderCard from "../../../components/vengeance/glow-border-card";
import KineticTextLoader from "../../../components/vengeance/kinetic-text-loader";
import ProfileFilter from "../../../components/control/ProfileFilter";
import { api, formatDate } from "../../../components/control/api";
import { Empty, Notice, Page, StateBadge, useLoad } from "../ControlPrimitives";
import "./CommandsPage.css";

type CommandItem = {
  id: string;
  label?: string | null;
  profile?: { name?: string; revision?: number; osId?: string } | null;
  scriptHash?: string | null;
  installerDigest?: string | null;
  createdAt?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
  status?: string | null;
  downloadCount?: number;
  lastUsedAt?: string | null;
  trackingUrl?: string | null;
  tags?: string[];
};

type CommandResponse = {
  items?: CommandItem[];
  commands?: CommandItem[];
  total?: number;
  limit?: number;
  offset?: number;
};

function syncQuery(key: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  window.history.replaceState(null, "", url.pathname + url.search);
}

function commandLabel(item: CommandItem) {
  return item.label?.trim() || "Untitled command";
}

function profileLabel(item: CommandItem) {
  if (!item.profile) return "Legacy / Windows 11 Pro";
  return `${item.profile.name || item.profile.osId || "Configured profile"}${item.profile.revision ? ` · rev ${item.profile.revision}` : ""}`;
}

function isExpired(item: CommandItem) {
  return Boolean(item.expiresAt && Date.parse(item.expiresAt) <= Date.now());
}

export function CommandsPage() {
  const [profileId, setProfileId] = useState(
    () => new URLSearchParams(window.location.search).get("p") || ""
  );
  const [search, setSearch] = useState(
    () => new URLSearchParams(window.location.search).get("search") || ""
  );
  const [status, setStatus] = useState(
    () => new URLSearchParams(window.location.search).get("status") || ""
  );
  const [page, setPage] = useState(() => {
    const value = Number(
      new URLSearchParams(window.location.search).get("page")
    );
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
  });
  const [pageSize, setPageSize] = useState(() => {
    const value = Number(
      new URLSearchParams(window.location.search).get("pageSize")
    );
    return [25, 50, 100].includes(value) ? value : 25;
  });
  const [selected, setSelected] = useState<{
    id: string;
    command: string;
  } | null>(null);
  const [busy, setBusy] = useState("");
  const [revokeBusy, setRevokeBusy] = useState("");
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const path = useMemo(() => {
    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (profileId) query.set("p", profileId);
    if (search.trim()) query.set("search", search.trim());
    if (status) query.set("status", status);
    return `/api/admin/commands?${query.toString()}`;
  }, [page, pageSize, profileId, search, status]);
  const { data, loading, error, reload } = useLoad<CommandResponse>(path, [
    path,
  ]);
  const items = data?.items || data?.commands || [];
  const hasNext = items.length >= pageSize;
  const issuedCount = items.filter(
    item => (item.status || "issued") === "issued"
  ).length;

  function changeProfile(value: string) {
    setProfileId(value);
    setPage(1);
    syncQuery("p", value || null);
    syncQuery("page", null);
  }

  function changeStatus(value: string) {
    setStatus(value);
    setPage(1);
    syncQuery("status", value || null);
    syncQuery("page", null);
  }

  function changeSearch(value: string) {
    setSearch(value);
    setPage(1);
    syncQuery("search", value.trim() || null);
    syncQuery("page", null);
  }

  function changePage(next: number) {
    setPage(next);
    syncQuery("page", next > 1 ? String(next) : null);
  }

  function changePageSize(value: number) {
    setPageSize(value);
    setPage(1);
    syncQuery("pageSize", value === 25 ? null : String(value));
    syncQuery("page", null);
  }

  async function retrieve(id: string, mode: "replay" | "copy" | "download") {
    setBusy(`${mode}:${id}`);
    setMessage("");
    setActionError("");
    setSelected(null);
    try {
      const result = await api<{ command?: string }>(
        `/api/admin/commands/${id}/retrieve`,
        { method: "POST" }
      );
      if (!result.command)
        throw new Error("The original command is unavailable.");
      setSelected({ id, command: result.command });
      if (mode === "copy") {
        if (!navigator.clipboard?.writeText)
          throw new Error("Clipboard access is unavailable.");
        await navigator.clipboard.writeText(result.command);
        setMessage("Command copied to the clipboard.");
      } else if (mode === "download") {
        const blob = new Blob([result.command], {
          type: "text/plain;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `win11desk-command-${id.slice(0, 8)}.sh`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setMessage("Command downloaded as a shell script.");
      } else {
        setMessage(
          "Command ready for review. Check the command before copying."
        );
      }
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Unable to retrieve command."
      );
    } finally {
      setBusy("");
    }
  }

  async function revoke(id: string) {
    if (revokeBusy) return;
    if (
      !window.confirm(
        "Revoke this command? It will no longer be accepted by the installer."
      )
    )
      return;
    setRevokeBusy(id);
    setMessage("");
    setActionError("");
    try {
      await api(`/api/admin/commands/${id}/revoke`, { method: "POST" });
      setMessage("Command revoked.");
      reload();
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Unable to revoke command."
      );
    } finally {
      setRevokeBusy("");
    }
  }

  async function copySelectedCommand() {
    if (!selected) return;
    setMessage("");
    setActionError("");
    if (!navigator.clipboard?.writeText) {
      setActionError("Clipboard access is unavailable.");
      return;
    }
    try {
      await navigator.clipboard.writeText(selected.command);
      setMessage("Command copied to the clipboard.");
    } catch (e) {
      setActionError(
        e instanceof Error
          ? `Copy failed: ${e.message}`
          : "Copy failed; clipboard unchanged."
      );
    }
  }

  return (
    <Page
      eyebrow="INSTALLATIONS / COMMANDS"
      title="Issued commands"
      intro="Review installation commands, expiry dates, and access."
      actions={
        <Link className="commands-new-command" href="/installer">
          <KeyRound size={14} /> New command
        </Link>
      }
    >
      <div className="commands-route-root">
        <section
          className="commands-editorial-head"
          aria-label="Installer commands"
        >
          <div className="commands-rail" aria-hidden="true">
            <span> </span>
            <i />
            <span> </span>
            <i />
            <span> </span>
          </div>
          <div className="commands-editorial-copy">
            <p className="commands-kicker">
              <ShieldCheck size={13} /> INSTALLER COMMANDS
            </p>
            <h2>Manage installer commands</h2>
            <p>
              Review the command for each installation before copying it.
              Check its status and expiry, then open or revoke it when needed.
            </p>
          </div>
          <div className="commands-inventory-readout">
            <span>ISSUED COMMANDS</span>
            <AnimatedNumber value={issuedCount} className="commands-number" />
            <small>{data?.total ?? items.length} commands in this view</small>
          </div>
        </section>

        {(error || actionError) && (
          <Notice kind="error" text={error || actionError} />
        )}
        {message && (
          <Notice
            kind="success"
            text={message}
            onClose={() => setMessage("")}
          />
        )}

        <section
          className="commands-control-deck"
          aria-label="Command filters and controls"
        >
          <div className="commands-filter-intro">
            <Filter size={14} />
            <span>Command filters</span>
            <small>Search by label, ID, user or source</small>
          </div>
          <label className="commands-search-field">
            <Search size={14} aria-hidden="true" />
            <span className="commands-sr-only">Search commands</span>
            <input
              value={search}
              onChange={event => changeSearch(event.target.value)}
              placeholder="Search commands…"
              aria-label="Search commands"
            />
            {search && (
              <button
                type="button"
                onClick={() => changeSearch("")}
                aria-label="Clear command search"
              >
                <X size={13} />
              </button>
            )}
          </label>
          <div className="commands-select-wrap">
            <ProfileFilter value={profileId} onChange={changeProfile} />
          </div>
          <label className="commands-select-wrap">
            <span className="commands-sr-only">Filter by command status</span>
            <select
              aria-label="Filter by command status"
              value={status}
              onChange={event => changeStatus(event.target.value)}
            >
              <option value="">All statuses</option>
              <option value="issued">Issued</option>
              <option value="expired">Expired</option>
              <option value="revoked">Revoked</option>
            </select>
          </label>
          <AnimatedButton
            className="commands-refresh-button"
            onClick={reload}
            disabled={loading}
            aria-label="Refresh commands"
          >
            <RefreshCw size={14} className={loading ? "commands-spin" : ""} />{" "}
            Refresh
          </AnimatedButton>
        </section>

        {loading && !data ? (
          <div className="commands-loading-state">
            <KineticTextLoader
              text="Loading commands"
              className="commands-kinetic-loader"
            />
            <span>Loading your commands…</span>
          </div>
        ) : (
          <section
            className="commands-inventory-panel"
            aria-labelledby="commands-inventory-title"
          >
            <div className="commands-panel-heading">
              <div>
                <p className="commands-kicker">COMMANDS</p>
                <h3 id="commands-inventory-title">Installation commands</h3>
              </div>
              <div className="commands-panel-meta">
                <Terminal size={14} />{" "}
                {items.length
                  ? `${items.length} visible`
                  : "No matching commands"}
              </div>
            </div>
            {items.length ? (
              <div className="commands-table-scroll">
                <table className="commands-table">
                  <thead>
                    <tr>
                      <th scope="col">Command</th>
                      <th scope="col">Status</th>
                      <th scope="col">Created / expires</th>
                      <th scope="col">Connection</th>
                      <th scope="col" className="commands-actions-heading">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(item => {
                      const statusValue = item.revokedAt
                        ? "revoked"
                        : isExpired(item)
                          ? "expired"
                          : item.status || "issued";
                      return (
                        <tr key={item.id}>
                          <td>
                            <div className="commands-artifact">
                              <span className="commands-index">
                                {String(items.indexOf(item) + 1).padStart(
                                  2,
                                  "0"
                                )}
                              </span>
                              <div>
                                <strong>{commandLabel(item)}</strong>
                                <span className="commands-id mono">
                                  {item.id}
                                </span>
                                <small>{profileLabel(item)}</small>
                                {(item.scriptHash || item.installerDigest) && (
                                  <small className="commands-hash">
                                    SHA{" "}
                                    {String(
                                      item.scriptHash || item.installerDigest
                                    ).slice(0, 12)}
                                    …
                                  </small>
                                )}
                              </div>
                            </div>
                          </td>
                          <td>
                            <StateBadge value={statusValue} />
                            <small
                              className={`commands-status-note commands-status-${statusValue}`}
                            >
                              {statusValue === "issued"
                                ? "Ready for retrieval"
                                : statusValue === "expired"
                                  ? "Fresh issue required"
                                  : "Blocked from installer"}
                            </small>
                          </td>
                          <td>
                            <div className="commands-dates">
                              <span>
                                <b>Created</b>
                                {formatDate(item.createdAt)}
                              </span>
                              <span>
                                <b>Expires</b>
                                {formatDate(item.expiresAt)}
                              </span>
                            </div>
                          </td>
                          <td>
                            {item.trackingUrl ? (
                              <a
                                className="commands-tracker-link"
                                href={item.trackingUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Connection check <ExternalLink size={12} />
                              </a>
                            ) : (
                              <span className="commands-muted">Not issued</span>
                            )}
                          </td>
                          <td>
                            <div className="commands-row-actions">
                              <button
                                className="commands-action-button"
                                onClick={() => void retrieve(item.id, "replay")}
                                disabled={
                                  Boolean(item.revokedAt) ||
                                  isExpired(item) ||
                                  Boolean(busy)
                                }
                              >
                                {busy === `replay:${item.id}`
                                  ? "Loading…"
                                  : "Review"}
                              </button>
                              <button
                                className="commands-action-button"
                                onClick={() => void retrieve(item.id, "copy")}
                                disabled={
                                  Boolean(item.revokedAt) ||
                                  isExpired(item) ||
                                  Boolean(busy)
                                }
                              >
                                Copy
                              </button>
                              <button
                                className="commands-action-button"
                                onClick={() =>
                                  void retrieve(item.id, "download")
                                }
                                disabled={
                                  Boolean(item.revokedAt) ||
                                  isExpired(item) ||
                                  Boolean(busy)
                                }
                                aria-label={`Download ${commandLabel(item)}`}
                              >
                                <FileDown size={13} /> Download
                              </button>
                              <button
                                className="commands-revoke-button"
                                onClick={() => void revoke(item.id)}
                                disabled={
                                  Boolean(item.revokedAt) ||
                                  revokeBusy === item.id
                                }
                              >
                                {item.revokedAt ? (
                                  "Revoked"
                                ) : revokeBusy === item.id ? (
                                  "Revoking…"
                                ) : (
                                  <>
                                    <Trash2 size={13} /> Revoke
                                  </>
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>No commands have been generated.</Empty>
            )}
            <div className="commands-pagination">
              <label>
                Rows{" "}
                <select
                  aria-label="Rows per page"
                  value={pageSize}
                  onChange={event => changePageSize(Number(event.target.value))}
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
              <span>Page {page}</span>
              <div>
                <button
                  className="commands-page-button"
                  disabled={page <= 1 || loading}
                  onClick={() => changePage(page - 1)}
                >
                  Previous
                </button>
                <button
                  className="commands-page-button"
                  disabled={!hasNext || loading}
                  onClick={() => changePage(page + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </section>
        )}

        {selected && (
          <GlowBorderCard
            width="100%"
            height="auto"
            borderRadius="10px"
            borderWidth="1px"
            blurAmount="0.3em"
            inset="-0.3em"
            paused={false}
            gradientColors={["#A78BFA", "#5b4a9b", "#25304b", "#A78BFA"]}
            className="commands-retrieval-card"
          >
            <div className="commands-retrieval-content">
              <div className="commands-retrieval-heading">
                <div>
                  <p className="commands-kicker">
                    <Terminal size={13} /> COMMAND REVIEW
                  </p>
                  <h3>Command ready for review</h3>
                  <span className="mono">{selected.id}</span>
                </div>
                <button
                  className="commands-close-button"
                  onClick={() => setSelected(null)}
                  aria-label="Close command preview"
                >
                  <X size={15} />
                </button>
              </div>
              <p>
                Opening this command does not run the installer. Copy or
                download it only after confirming the target and expiry.
              </p>
              <pre>
                <code>{selected.command}</code>
              </pre>
              <div className="commands-retrieval-actions">
                <button
                  className="commands-action-button"
                  onClick={() => void copySelectedCommand()}
                >
                  <KeyRound size={13} /> Copy command
                </button>
                <button
                  className="commands-action-button"
                  onClick={() => {
                    setActionError("");
                    const blob = new Blob([selected.command], {
                      type: "text/plain;charset=utf-8",
                    });
                    const url = URL.createObjectURL(blob);
                    const anchor = document.createElement("a");
                    anchor.href = url;
                    anchor.download = `win11desk-command-${selected.id.slice(0, 8)}.sh`;
                    anchor.click();
                    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  <FileDown size={13} /> Download command file
                </button>
              </div>
            </div>
          </GlowBorderCard>
        )}
      </div>
    </Page>
  );
}
