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

export function DeploymentDetailPage({ user }: { user?: User }) {
  const { id = "" } = useParams<{ id: string }>();
  const { data, loading, error, reload } = useLoad<any>(
    `/api/admin/deployments/${encodeURIComponent(id)}`,
    [id],
    true
  );
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [label, setLabel] = useState("");
  const [labelSaving, setLabelSaving] = useState(false);
  const canEdit = user ? user.role !== "viewer" : false;
  const routeId = useRef(id);
  routeId.current = id;
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const initialized = useRef("");
  useEffect(() => {
    initialized.current = "";
    setDraftReady(false);
    setLabel("");
    setLabelSaving(false);
    setNotes("");
    setTags("");
    setNotice("");
    setActionError("");
  }, [id]);
  useEffect(() => {
    if (data?.deployment?.id === id && initialized.current !== id) {
      initialized.current = id;
      setLabel(data.deployment.label || "");
      setNotes(data.deployment.notes || "");
      setTags((data.deployment.tags || []).join(", "));
      setDraftReady(true);
    }
  }, [data, id]);
  const [saving, setSaving] = useState(false);
  async function save() {
    if (saving || !draftReady) return;
    const editingId = id;
    setSaving(true);
    setActionError("");
    setNotice("");
    try {
      await api(`/api/admin/deployments/${encodeURIComponent(editingId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          notes,
          tags: tags
            .split(",")
            .map(v => v.trim())
            .filter(Boolean),
        }),
      });
      if (routeId.current !== editingId) return;
      setNotice("Deployment notes saved.");
      reload();
    } catch (e) {
      if (routeId.current === editingId)
        setActionError(
          e instanceof Error ? e.message : "Notes could not be saved."
        );
    } finally {
      if (routeId.current === editingId) setSaving(false);
    }
  }
  async function saveLabel(reset = false) {
    if (!canEdit || labelSaving || !draftReady) return;
    const editingId = id;
    setLabelSaving(true);
    setActionError("");
    setNotice("");
    try {
      await api(`/api/admin/deployments/${encodeURIComponent(editingId)}`, {
        method: "PATCH",
        body: JSON.stringify({ label: reset ? "" : label.trim() }),
      });
      if (routeId.current !== editingId) return;
      setLabel(reset ? data.deployment.originalLabel || "" : label.trim());
      setNotice(
        reset
          ? "Original deployment label restored."
          : "Deployment label saved."
      );
      reload();
    } catch (e) {
      if (routeId.current === editingId)
        setActionError(
          e instanceof Error ? e.message : "Label could not be saved."
        );
    } finally {
      if (routeId.current === editingId) setLabelSaving(false);
    }
  }
  if (loading && !data)
    return (
      <Page eyebrow="INSTALLATIONS / DEPLOYMENT" title="Deployment detail">
        <Loading />
      </Page>
    );
  const d = data?.deployment || data || {};
  const events = data?.events || [];
  return (
    <Page
      eyebrow="INSTALLATIONS / DEPLOYMENT"
      title={d.label || d.hostname || "Deployment detail"}
      intro={`Created ${formatDate(d.createdAt)} · ${d.id || id}`}
      actions={
        <Link className="secondary-button" href="/deployments">
          ← Back to history
        </Link>
      }
    >
      <div className="vng-detail">
        <div className="vng-detail__hero">
          <div>
            <span className="vng-detail__overline">Deployment details</span>
            <h2>{d.label || d.hostname || "Deployment detail"}</h2>
            <p>
              Review status, account access, notes and installation events in
              one place.
            </p>
          </div>
          <div className="vng-detail__hero-meta">
            <span>RUN ID</span>
            <strong>{d.id || id}</strong>
            <span>{formatDate(d.createdAt)}</span>
          </div>
        </div>
        {(error || actionError) && (
          <Notice kind="error" text={error || actionError} />
        )}
        {notice && (
          <Notice kind="success" text={notice} onClose={() => setNotice("")} />
        )}
        <Panel
          title="Deployment label"
          description="Rename this deployment without changing its profile, installer or credentials."
        >
          <form
            className="deployment-label-form"
            onSubmit={e => {
              e.preventDefault();
              void saveLabel();
            }}
          >
            <label className="field">
              <span>Label name</span>
              <input
                value={label}
                maxLength={160}
                onChange={e => setLabel(e.target.value)}
                disabled={!canEdit || !draftReady || labelSaving}
                placeholder={d.hostname || "Deployment"}
              />
            </label>
            <div className="deployment-label-actions">
              <button
                type="submit"
                className="primary-button"
                disabled={!canEdit || !draftReady || labelSaving}
              >
                {labelSaving ? "Saving…" : "Save label"}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={!canEdit || labelSaving}
                onClick={() => setLabel(d.label || "")}
              >
                Cancel
              </button>
              <button
                type="button"
                className="text-button"
                disabled={!canEdit || labelSaving}
                onClick={() => void saveLabel(true)}
              >
                Restore original label
              </button>
            </div>
          </form>
          {!canEdit && (
            <small className="form-hint">
              Read-only access. An owner, admin or operator can edit this label.
            </small>
          )}
        </Panel>
        <Panel
          title="Deployment status"
          description="Transfer progress, timestamps and status updates."
        >
          <DeploymentPresentation
            key={id}
            deployment={d}
            trackerUrl={data?.trackingUrl}
            onRdpDownload={
              d.publicIP
                ? () =>
                    void downloadApiFile(
                      `/api/admin/deployments/${encodeURIComponent(id)}/rdp`,
                      `${d.hostname || id}.rdp`
                    )
                : undefined
            }
          />
        </Panel>
        {d.postInstall && (
          <Panel title="Post-install actions">
            <PostInstallResults value={d.postInstall} />
          </Panel>
        )}
        {data?.deployment?.remoteJobId &&
          (user?.role === "owner" || user?.role === "admin") && (
            <RemoteJobPanel jobId={data.deployment.remoteJobId} />
          )}
        <div className="detail-grid">
          <Panel title="Notes & tags">
            <form
              className="stack-form deployment-notes"
              onSubmit={event => {
                event.preventDefault();
                void save();
              }}
            >
              <label className="field">
                <span>Internal notes</span>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={5}
                  placeholder="Add context for the next person…"
                  disabled={saving || !draftReady}
                />
              </label>
              <label className="field">
                <span>Tags</span>
                <input
                  value={tags}
                  onChange={e => setTags(e.target.value)}
                  placeholder="production, handoff"
                  disabled={saving || !draftReady}
                />
              </label>
              <div className="form-foot">
                <button
                  type="submit"
                  className="primary-button"
                  disabled={saving || !draftReady}
                >
                  {saving ? "Saving…" : "Save notes"}
                </button>
              </div>
            </form>
          </Panel>
          <Panel title="Deployment details">
            <div className="detail-facts">
              <div>
                <span>Deployment ID</span>
                <strong className="mono">{d.id || id}</strong>
              </div>
              <div>
                <span>Hostname</span>
                <strong>{d.hostname || "Not reported"}</strong>
              </div>
              <div>
                <span>Username</span>
                <strong>{d.username || "Not reported"}</strong>
              </div>
              <div>
                <span>RDP port</span>
                <strong>
                  {d.rdpPort || d.commandRemotePort || "Not reported"}
                </strong>
              </div>
            </div>
          </Panel>
        </div>
        <Panel
          title="Timeline"
          description="Events are recorded by installer callbacks and server hooks."
        >
          <div className="timeline">
            {events.map((event: any, index: number) => (
              <div
                className="timeline-item"
                data-step={String(index + 1).padStart(2, "0")}
                key={event.eventId || event.id || index}
              >
                <span className="timeline-dot" />
                <div>
                  <strong>
                    {event.stage?.replaceAll("_", " ") || "event"}
                  </strong>
                  <time>{formatDate(event.receivedAt || event.createdAt)}</time>
                  <p>
                    {typeof event.payload === "string"
                      ? event.payload
                      : event.payload?.message ||
                        "Stage reported by installer."}
                  </p>
                  {event.safeCode && <code>{event.safeCode}</code>}
                  {event.payload?.downloadedBytes != null && (
                    <p>
                      {formatBytes(event.payload.downloadedBytes)} downloaded
                      {event.payload.totalBytes != null
                        ? ` / ${formatBytes(event.payload.totalBytes)}`
                        : " (total not reported)"}
                    </p>
                  )}
                </div>
              </div>
            ))}
            {!events.length && (
              <Empty>No timeline events have been recorded.</Empty>
            )}
          </div>
        </Panel>
      </div>
    </Page>
  );
}
