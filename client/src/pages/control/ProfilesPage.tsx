import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import {
  Archive,
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  History,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
} from "lucide-react";
import {
  directIsoUrl,
  osCatalog as fallbackCatalog,
  type DeploymentProfile,
  type OsDefinition,
  type ProfileInput,
} from "@shared/deploymentProfiles";
import { defaultIsoUrl } from "@shared/media";
import {
  api,
  formatDate,
  loadMe,
  type Role,
} from "../../components/control/api";
import { Empty, Loading, Notice, Page, Panel } from "./ControlPrimitives";
import AnimatedButton from "../../components/vengeance/animated-button";
import { AnimatedNumber } from "../../components/vengeance/animated-number";
import { KineticTextLoader } from "../../components/vengeance/kinetic-text-loader";
import "./ProfilesPage.css";

type ProfileListResponse = {
  items?: DeploymentProfile[];
  catalog?: OsDefinition[];
};
type ProfileDetailResponse = {
  profile: DeploymentProfile;
  catalog?: OsDefinition[];
};

type ProfilesPageProps = {
  /** Optional id lets a parent route render the detail view without coupling to wouter. */
  profileId?: string;
  /** Wouter supplies route params/children when this component is used directly as a route component. */
  params?: Record<string, string | undefined>;
  children?: React.ReactNode;
};

type FormState = ProfileInput;

const EMPTY_FORM: FormState = {
  name: "",
  osId: "windows-11-pro",
  isoUrl: defaultIsoUrl,
  imageName: "",
  description: "",
  username: "Administrator",
  remotePort: 22,
  retries: 10,
};

function isEditor(role?: Role | null) {
  return role === "owner" || role === "admin";
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function osName(id: string, catalog: OsDefinition[]) {
  return catalog.find(item => item.id === id)?.name || id;
}

function isDeployable(profile: Pick<DeploymentProfile, "isoUrl">) {
  return Boolean(profile.isoUrl.trim());
}

function catalogFrom(value?: OsDefinition[]) {
  return value?.length ? value : fallbackCatalog;
}

function profileStatus(
  profile: Pick<DeploymentProfile, "isoUrl" | "archivedAt">
) {
  if (profile.archivedAt) return { label: "Archived", tone: "archived" };
  if (isDeployable(profile)) return { label: "Ready", tone: "ready" };
  return { label: "Needs ISO URL", tone: "needs-url" };
}

function ProfileForm({
  initial,
  catalog,
  editable,
  revision,
  saving,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: FormState;
  catalog: OsDefinition[];
  editable: boolean;
  revision?: number;
  saving: boolean;
  submitLabel: string;
  onSubmit: (value: FormState) => Promise<void>;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [validation, setValidation] = useState("");

  useEffect(() => {
    setForm(initial);
    setValidation("");
  }, [initial]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(current => ({ ...current, [key]: value }));
  }

  function selectOperatingSystem(nextOsId: string) {
    if (nextOsId === form.osId) return;
    // A URL and image override are media-specific; do not carry either across OS changes.
    setForm(current => ({
      ...current,
      osId: nextOsId,
      isoUrl: "",
      imageName: "",
    }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editable) return;
    setValidation("");
    if (!form.name.trim()) {
      setValidation("Name is required.");
      return;
    }
    if (!form.osId) {
      setValidation("Choose a supported operating system.");
      return;
    }
    if (form.isoUrl && !directIsoUrl(form.isoUrl)) {
      setValidation(
        "Use a direct HTTPS ISO URL without embedded credentials or fragments."
      );
      return;
    }
    if (
      form.imageName &&
      !/^[A-Za-z0-9 ._()\-]{0,160}$/.test(form.imageName.trim())
    ) {
      setValidation(
        "Exact ISO image name may use letters, numbers, spaces, periods, hyphens, underscores, or parentheses."
      );
      return;
    }
    if (
      !/^[A-Za-z][A-Za-z0-9._-]{0,19}$/.test(form.username) ||
      form.username.toLowerCase() === "none"
    ) {
      setValidation(
        "Username must be 1–20 characters and use letters, numbers, dot, underscore, or hyphen."
      );
      return;
    }
    if (
      !Number.isInteger(Number(form.remotePort)) ||
      Number(form.remotePort) < 1 ||
      Number(form.remotePort) > 65535
    ) {
      setValidation("Port must be an integer from 1 to 65535.");
      return;
    }
    if (
      !Number.isInteger(Number(form.retries)) ||
      Number(form.retries) < 1 ||
      Number(form.retries) > 20
    ) {
      setValidation("Retries must be an integer from 1 to 20.");
      return;
    }
    await onSubmit({
      ...form,
      name: form.name.trim(),
      isoUrl: form.isoUrl.trim(),
      imageName: form.imageName.trim(),
      description: form.description.trim(),
      username: form.username.trim(),
      remotePort: Number(form.remotePort),
      retries: Number(form.retries),
    });
  }

  return (
    <form className="stack-form profiles-form" onSubmit={submit}>
      <div className="profiles-form-intro">
        <span className="profiles-section-index">01</span>
        <div>
          <p className="profiles-kicker">Profile settings</p>
          <h3>Set the deployment details</h3>
          <p>
            Keep media and runtime defaults together. Secrets never enter this
            record.
          </p>
        </div>
      </div>
      <div className="profiles-form-grid">
        <label className="field profiles-field-wide">
          <span>Profile name</span>
          <input
            value={form.name}
            onChange={event => update("name", event.target.value)}
            maxLength={160}
            placeholder="Windows 11 Pro production"
            disabled={!editable || saving}
            required
          />
          <small className="form-hint">
            A name that is easy to recognize in the deployment history.
          </small>
        </label>
        <label className="field profiles-field-wide">
          <span>Operating system</span>
          <select
            value={form.osId}
            onChange={event => selectOperatingSystem(event.target.value)}
            disabled={!editable || saving}
            required
          >
            {["Windows client", "Windows Server"].map(family => (
              <optgroup label={family} key={family}>
                {catalog
                  .filter(item => item.family === family)
                  .map(item => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <small className="form-hint">
            {catalog.find(item => item.id === form.osId)?.note}
          </small>
        </label>
        <label className="field profiles-field-wide profiles-source-field">
          <span>
            Direct ISO URL <small>(optional)</small>
          </span>
          <input
            type="url"
            value={form.isoUrl}
            onChange={event => update("isoUrl", event.target.value)}
            maxLength={4096}
            placeholder="https://host.example/windows.iso"
            disabled={!editable || saving}
            autoComplete="off"
          />
          <small className="form-hint">
            Leave blank to save as <strong>Needs ISO URL</strong>; reachability
            is not checked here.
          </small>
        </label>
        <label className="field profiles-field-wide">
          <span>
            Exact ISO image name <small>(advanced, optional)</small>
          </span>
          <input
            value={form.imageName}
            onChange={event => update("imageName", event.target.value)}
            maxLength={160}
            placeholder={catalog.find(item => item.id === form.osId)?.imageName}
            disabled={!editable || saving}
            autoComplete="off"
          />
          <small className="form-hint">
            Default:{" "}
            <code>
              {catalog.find(item => item.id === form.osId)?.imageName}
            </code>
            . Override only when the media uses a different WIM name.
          </small>
        </label>
        <label className="field profiles-field-wide">
          <span>
            Description <small>(optional)</small>
          </span>
          <textarea
            value={form.description}
            onChange={event => update("description", event.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="Purpose, licensing context, or provider notes"
            disabled={!editable || saving}
          />
        </label>
        <div className="profiles-form-divider profiles-field-wide">
          <span className="profiles-section-index">02</span>
          <span>Runtime defaults</span>
        </div>
        <label className="field">
          <span>Windows username</span>
          <input
            value={form.username}
            onChange={event => update("username", event.target.value)}
            maxLength={20}
            placeholder="Administrator"
            disabled={!editable || saving}
            autoComplete="off"
            required
          />
        </label>
        <label className="field">
          <span>Port</span>
          <input
            type="number"
            min={1}
            max={65535}
            value={form.remotePort}
            onChange={event => update("remotePort", Number(event.target.value))}
            disabled={!editable || saving}
            required
          />
        </label>
        <label className="field">
          <span>Download retries</span>
          <input
            type="number"
            min={1}
            max={20}
            value={form.retries}
            onChange={event => update("retries", Number(event.target.value))}
            disabled={!editable || saving}
            required
          />
        </label>
      </div>
      <div className="profiles-form-safety">
        <ShieldCheck size={15} />
        <p>
          Profiles store installer settings only. Passwords, capabilities, and
          other secrets are never stored here.
        </p>
      </div>
      {revision !== undefined && (
        <p className="form-hint">
          Current revision {revision}; saves use optimistic concurrency.
        </p>
      )}
      {validation && <p className="field-error">{validation}</p>}
      {editable && (
        <div className="form-foot profiles-form-foot">
          <span className="profiles-form-footnote">
            Changes create a new revision.
          </span>
          <div className="row-actions">
            {onCancel && (
              <button
                type="button"
                className="secondary-button"
                onClick={onCancel}
                disabled={saving}
              >
                Cancel
              </button>
            )}
            <AnimatedButton
              type="submit"
              className="primary-button profiles-animated-button"
              disabled={saving}
            >
              {saving ? (
                <LoaderCircle size={14} className="profiles-spin" />
              ) : (
                <Check size={14} />
              )}
              {saving ? "Saving…" : submitLabel}
            </AnimatedButton>
          </div>
        </div>
      )}
    </form>
  );
}

function ProfileRow({
  profile,
  catalog,
  canEdit,
  busy,
  onArchive,
  onRestore,
  onDuplicate,
}: {
  profile: DeploymentProfile;
  catalog: OsDefinition[];
  canEdit: boolean;
  busy: boolean;
  onArchive: (profile: DeploymentProfile) => void;
  onRestore: (profile: DeploymentProfile) => void;
  onDuplicate: (profile: DeploymentProfile) => void;
}) {
  const status = profileStatus(profile);
  return (
    <article
      className={`profiles-row${profile.archivedAt ? " is-archived" : ""}`}
    >
      <div className="profiles-row-rail" aria-hidden="true">
        <span>PROFILE</span>
        <strong>{String(profile.revision).padStart(2, "0")}</strong>
      </div>
      <div className="profiles-row-main">
        <div className="profiles-row-title">
          <Link
            href={`/profiles/${encodeURIComponent(profile.id)}`}
            className="profiles-name"
          >
            {profile.name}
          </Link>
          <span className={`profiles-status ${status.tone}`}>
            {status.label}
          </span>
        </div>
        <div className="profiles-row-meta">
          <span>{osName(profile.osId, catalog)}</span>
          <span>Rev {profile.revision}</span>
          <span>Updated {formatDate(profile.updatedAt)}</span>
        </div>
        {profile.description && (
          <p className="profiles-description">{profile.description}</p>
        )}
        <code className="profiles-url" title={profile.isoUrl}>
          {profile.isoUrl || "No ISO URL saved"}
        </code>
      </div>
      <dl className="profiles-row-stats" aria-label={`${profile.name} usage`}>
        <div className="profiles-usage-count">
          <dt>Commands</dt>
          <dd>
            <AnimatedNumber value={profile.commandCount ?? 0} />
          </dd>
        </div>
        <div className="profiles-usage-count">
          <dt>Deployments</dt>
          <dd>
            <AnimatedNumber value={profile.deploymentCount ?? 0} />
          </dd>
        </div>
      </dl>
      <div className="profiles-row-actions">
        <Link
          className="text-button"
          href={`/profiles/${encodeURIComponent(profile.id)}`}
        >
          <Pencil size={13} /> Edit
        </Link>
        {canEdit && (
          <button
            className="text-button"
            onClick={() => onDuplicate(profile)}
            disabled={busy}
          >
            <Copy size={13} /> Duplicate
          </button>
        )}
        {canEdit && !profile.archivedAt && (
          <button
            className="text-button profiles-danger-button"
            onClick={() => onArchive(profile)}
            disabled={busy}
          >
            <Archive size={13} /> Archive
          </button>
        )}
        {canEdit && profile.archivedAt && (
          <button
            className="text-button"
            onClick={() => onRestore(profile)}
            disabled={busy}
          >
            <RotateCcw size={13} /> Restore
          </button>
        )}
        {!profile.archivedAt && isDeployable(profile) && (
          <Link
            className="text-button profiles-use-button"
            href={`/installer?p=${encodeURIComponent(profile.id)}`}
          >
            <ExternalLink size={13} /> Use profile
          </Link>
        )}
        <Link
          className="text-button"
          href={`/deployments?p=${encodeURIComponent(profile.id)}`}
        >
          <History size={13} /> History
        </Link>
      </div>
    </article>
  );
}

function ProfileEditor({
  profile,
  catalog,
  canEdit,
  onSaved,
  onCancel,
}: {
  profile?: DeploymentProfile;
  catalog: OsDefinition[];
  canEdit: boolean;
  onSaved: (message: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const initial = useMemo(
    () =>
      profile
        ? {
            name: profile.name,
            osId: profile.osId,
            isoUrl: profile.isoUrl,
            imageName: profile.imageName,
            description: profile.description,
            username: profile.username,
            remotePort: profile.remotePort,
            retries: profile.retries,
          }
        : EMPTY_FORM,
    [profile]
  );

  async function save(value: FormState) {
    setSaving(true);
    setError("");
    try {
      const path = profile
        ? `/api/admin/profiles/${encodeURIComponent(profile.id)}`
        : "/api/admin/profiles";
      await api(path, {
        method: profile ? "PUT" : "POST",
        body: JSON.stringify(
          profile ? { ...value, revision: profile.revision } : value
        ),
      });
      await onSaved(profile ? "Profile saved." : "Profile created.");
    } catch (err) {
      setError(errorMessage(err, "Profile could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {error && (
        <Notice kind="error" text={error} onClose={() => setError("")} />
      )}
      <ProfileForm
        initial={initial}
        catalog={catalog}
        editable={canEdit}
        revision={profile?.revision}
        saving={saving}
        submitLabel={profile ? "Save changes" : "Create profile"}
        onSubmit={save}
        onCancel={onCancel}
      />
    </>
  );
}

function ProfilesSignal({
  items,
  catalog,
}: {
  items: DeploymentProfile[];
  catalog: OsDefinition[];
}) {
  const ready = items.filter(
    item => !item.archivedAt && isDeployable(item)
  ).length;
  const archived = items.filter(item => Boolean(item.archivedAt)).length;
  const configured = catalog.length;
  return (
    <div className="profiles-signal-card" aria-label="Ready profile summary">
      <div className="profiles-signal-inner">
        <span className="profiles-kicker">Ready profiles</span>
        <strong>{ready}</strong>
        <small>
          {archived} archived · {configured} operating systems
        </small>
      </div>
    </div>
  );
}

export function ProfilesPage({ profileId }: ProfilesPageProps = {}) {
  const [, navigate] = useLocation();
  const [data, setData] = useState<ProfileListResponse | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const canEdit = isEditor(role);
  const catalog = catalogFrom(data?.catalog);
  const items = data?.items || [];
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter(profile =>
      [
        profile.name,
        profile.osId,
        profile.isoUrl,
        profile.description,
        osName(profile.osId, catalog),
      ].some(value => value.toLowerCase().includes(query))
    );
  }, [catalog, items, search]);

  useEffect(() => {
    let active = true;
    Promise.all([
      api<ProfileListResponse>("/api/admin/profiles?archived=all"),
      loadMe(),
    ])
      .then(([profiles, me]) => {
        if (!active) return;
        setData(profiles);
        setRole(me.user?.role || null);
        setError("");
      })
      .catch(err => {
        if (active)
          setError(errorMessage(err, "Profiles could not be loaded."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadToken]);

  async function changeArchive(
    profile: DeploymentProfile,
    action: "archive" | "restore"
  ) {
    if (!canEdit) return;
    const verb = action === "archive" ? "Archive" : "Restore";
    if (!window.confirm(`${verb} profile “${profile.name}”?`)) return;
    setBusyId(profile.id);
    setError("");
    try {
      await api(
        `/api/admin/profiles/${encodeURIComponent(profile.id)}/${action}`,
        {
          method: "POST",
          body: JSON.stringify({ revision: profile.revision }),
        }
      );
      setMessage(`Profile ${action === "archive" ? "archived" : "restored"}.`);
      setReloadToken(token => token + 1);
    } catch (err) {
      setError(errorMessage(err, `Profile could not be ${action}d.`));
    } finally {
      setBusyId("");
    }
  }

  async function duplicate(profile: DeploymentProfile) {
    if (!canEdit) return;
    setBusyId(profile.id);
    setError("");
    try {
      const result = await api<{ profile?: DeploymentProfile }>(
        "/api/admin/profiles",
        {
          method: "POST",
          body: JSON.stringify({
            name: `${profile.name} (copy)`.slice(0, 160),
            osId: profile.osId,
            isoUrl: profile.isoUrl,
            imageName: profile.imageName,
            description: profile.description,
            username: profile.username,
            remotePort: profile.remotePort,
            retries: profile.retries,
          }),
        }
      );
      setMessage("Profile duplicated.");
      if (result.profile?.id)
        navigate(`/profiles/${encodeURIComponent(result.profile.id)}`);
      else setReloadToken(token => token + 1);
    } catch (err) {
      setError(errorMessage(err, "Profile could not be duplicated."));
    } finally {
      setBusyId("");
    }
  }

  async function afterCreate(messageText: string) {
    setShowCreate(false);
    setMessage(messageText);
    setReloadToken(token => token + 1);
  }

  const pageActions = (
    <div className="profiles-page-actions">
      {canEdit && (
        <AnimatedButton
          className="primary-button profiles-animated-button"
          onClick={() => setShowCreate(value => !value)}
        >
          <Plus size={14} /> {showCreate ? "Close new profile" : "New profile"}
        </AnimatedButton>
      )}
      <button
        className="secondary-button"
        onClick={() => setReloadToken(token => token + 1)}
        disabled={loading}
      >
        <RefreshCw size={14} /> Refresh
      </button>
    </div>
  );

  return (
    <Page
      eyebrow="DEPLOYMENT PROFILES"
      title="Deployment profiles"
      intro="Set up reusable profiles for your Windows installations without storing secrets."
      actions={pageActions}
    >
      <div className="profiles-page">
        <div className="profiles-command-strip">
          <div className="profiles-command-copy">
            <span className="profiles-kicker">Deployment workspace</span>
            <strong>Choose a profile for an installation.</strong>
            <span>
              Clear status and a record of each deployment.
            </span>
          </div>
          <ProfilesSignal items={items} catalog={catalog} />
        </div>
        <div className="profiles-certification-note">
          <ShieldCheck size={16} />
          <span>
            <strong>Testing note:</strong> only historical Windows 11
            Pro deployment is E2E tested. Other catalogue entries have an
            implemented ISO path but are not E2E certified.
          </span>
        </div>
        {error && (
          <Notice kind="error" text={error} onClose={() => setError("")} />
        )}
        {message && (
          <Notice
            kind="success"
            text={message}
            onClose={() => setMessage("")}
          />
        )}
        {showCreate && canEdit && (
          <div className="profiles-panel-host profiles-create-host profiles-editor-panel">
            <Panel
              title="Create profile"
              description="Add a named, non-secret deployment definition. Save a direct HTTPS source only when you own the media path."
            >
              <ProfileEditor
                catalog={catalog}
                canEdit={canEdit}
                onSaved={afterCreate}
                onCancel={() => setShowCreate(false)}
              />
            </Panel>
          </div>
        )}
        <div className="profiles-panel-host profiles-list-panel">
          <Panel
            title="Profile catalogue"
            description={`${items.length} profile${items.length === 1 ? "" : "s"} including archived records.`}
            actions={
              <label className="profiles-search">
                <Search size={15} />
                <span className="sr-only">Search profiles</span>
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Search name, OS, URL…"
                />
              </label>
            }
          >
            {loading ? (
              <div className="profiles-loading-frame">
                <KineticTextLoader
                  text="Loading"
                  className="profiles-kinetic-loader"
                />
              </div>
            ) : filtered.length ? (
              <div className="profiles-list">
                {filtered.map(profile => (
                  <ProfileRow
                    key={profile.id}
                    profile={profile}
                    catalog={catalog}
                    canEdit={canEdit}
                    busy={busyId === profile.id}
                    onArchive={profileItem =>
                      void changeArchive(profileItem, "archive")
                    }
                    onRestore={profileItem =>
                      void changeArchive(profileItem, "restore")
                    }
                    onDuplicate={profileItem => void duplicate(profileItem)}
                  />
                ))}
              </div>
            ) : (
              <Empty>
                {search
                  ? "No profiles match this search."
                  : "No profiles yet. Create one to make installer settings reusable."}
              </Empty>
            )}
          </Panel>
        </div>
        <p className="profiles-permission-note">
          {canEdit
            ? "Owner/admin editing enabled."
            : "Read-only access. Owner/admin roles can create, edit, archive, restore, or duplicate profiles."}
        </p>
        {profileId && (
          <span className="profiles-route-hint" aria-hidden="true">
            {profileId}
          </span>
        )}
      </div>
    </Page>
  );
}

export function ProfileDetailPage({ profileId }: ProfilesPageProps = {}) {
  const params = useParams<{ id?: string }>();
  const id = profileId || params.id || "";
  const [, navigate] = useLocation();
  const [profile, setProfile] = useState<DeploymentProfile | null>(null);
  const [catalog, setCatalog] = useState<OsDefinition[]>(fallbackCatalog);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const canEdit = isEditor(role);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      api<ProfileDetailResponse>(
        `/api/admin/profiles/${encodeURIComponent(id)}`
      ),
      loadMe(),
    ])
      .then(([result, me]) => {
        if (!active) return;
        setProfile(result.profile);
        setCatalog(catalogFrom(result.catalog));
        setRole(me.user?.role || null);
        setError("");
      })
      .catch(err => {
        if (active) setError(errorMessage(err, "Profile could not be loaded."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, reloadToken]);

  async function saved(messageText: string) {
    setMessage(messageText);
    setReloadToken(token => token + 1);
  }

  if (!id) {
    return (
      <Page eyebrow="DEPLOYMENT PROFILES / PROFILE DETAIL" title="Profile detail">
        <Notice kind="error" text="A profile id is required." />
      </Page>
    );
  }

  const status = profile ? profileStatus(profile) : null;
  const detailActions = (
    <div className="profiles-page-actions">
      {profile && !profile.archivedAt && isDeployable(profile) && (
        <Link
          className="primary-button"
          href={`/installer?p=${encodeURIComponent(profile.id)}`}
        >
          <ExternalLink size={14} /> Use profile
        </Link>
      )}
      {profile && (
        <Link
          className="secondary-button"
          href={`/deployments?p=${encodeURIComponent(profile.id)}`}
        >
          <History size={14} /> History
        </Link>
      )}
    </div>
  );

  return (
    <Page
      eyebrow="DEPLOYMENT PROFILES / PROFILE DETAIL"
      title={profile?.name || "Profile detail"}
      intro="Review the installer settings, revision, media status, and recorded usage."
      actions={detailActions}
    >
      <div className="profiles-page profiles-detail-page">
        <Link href="/profiles" className="profiles-back-link">
          <ArrowLeft size={14} /> All profiles
        </Link>
        <div className="profiles-command-strip profiles-detail-strip">
          <div className="profiles-command-copy">
            <span className="profiles-kicker">Profile details</span>
            <strong>
              {profile
                ? `Revision ${profile.revision} is the current definition.`
                : "Loading the current definition."}
            </strong>
            <span>
              Use the editor to make changes; past commands keep the settings
              used at that time.
            </span>
          </div>
          {status && (
            <span
              className={`profiles-status profiles-detail-status ${status.tone}`}
            >
              {status.label}
            </span>
          )}
        </div>
        <div className="profiles-certification-note">
          <ShieldCheck size={16} />
          <span>
            <strong>Testing note:</strong> only historical Windows 11
            Pro deployment is E2E tested. Other catalogue entries have an
            implemented ISO path but are not E2E certified.
          </span>
        </div>
        {error && (
          <Notice kind="error" text={error} onClose={() => setError("")} />
        )}
        {message && (
          <Notice
            kind="success"
            text={message}
            onClose={() => setMessage("")}
          />
        )}
        {loading ? (
          <div className="profiles-loading-frame">
            <Loading />
          </div>
        ) : profile ? (
          <div className="profiles-detail-layout">
            <div className="profiles-panel-host profiles-editor-panel">
              <Panel
                title={canEdit ? "Edit profile" : "Profile settings"}
                description={
                  profile.archivedAt
                    ? `Archived ${formatDate(profile.archivedAt)}.`
                    : "Changes are revision-checked to prevent overwriting another operator's work."
                }
              >
                <ProfileEditor
                  profile={profile}
                  catalog={catalog}
                  canEdit={canEdit}
                  onSaved={saved}
                />
              </Panel>
            </div>
            <aside
              className="profiles-detail-rail profiles-metadata-panel"
              aria-label="Profile metadata"
            >
              <div className="profiles-rail-heading">
                <span className="profiles-section-index">03</span>
                <div>
                  <p className="profiles-kicker">Record context</p>
                  <h2>Snapshot & usage</h2>
                </div>
              </div>
              <div className="profiles-metadata-grid">
                <div>
                  <span>Profile id</span>
                  <code className="profiles-url">{profile.id}</code>
                </div>
                <div>
                  <span>Revision</span>
                  <strong>{profile.revision}</strong>
                </div>
                <div>
                  <span>Created</span>
                  <strong>{formatDate(profile.createdAt)}</strong>
                </div>
                <div>
                  <span>Updated</span>
                  <strong>{formatDate(profile.updatedAt)}</strong>
                </div>
                <div>
                  <span>Commands using profile</span>
                  <strong>
                    <AnimatedNumber value={profile.commandCount ?? 0} />
                  </strong>
                </div>
                <div>
                  <span>Deployments using profile</span>
                  <strong>
                    <AnimatedNumber value={profile.deploymentCount ?? 0} />
                  </strong>
                </div>
              </div>
              <div className="profiles-rail-callout">
                <span>Operational note</span>
                <p>
                  Usage is recorded from deployments; history is never inferred
                  from the ISO URL.
                </p>
              </div>
            </aside>
          </div>
        ) : null}
        <p className="profiles-permission-note">
          {canEdit
            ? "Owner/admin editing enabled."
            : "Read-only access. Owner/admin roles can modify this profile."}
        </p>
        <button
          className="profiles-hidden-navigate"
          onClick={() => navigate("/profiles")}
          aria-hidden="true"
          tabIndex={-1}
        >
          Back
        </button>
      </div>
    </Page>
  );
}

export default ProfilesPage;
