import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { RefreshCw } from "lucide-react";
import { api } from "./api";
import type { ReadyProfile } from "../../../../shared/deploymentProfiles";
import "../../pages/control/ProfilesPage.css";

type ReadyResponse = {
  items: ReadyProfile[];
  defaultProfileId: string | null;
};

function queryProfileId() {
  return new URLSearchParams(window.location.search).get("p") || "";
}

function replaceProfileQuery(id: string) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("p", id);
  else url.searchParams.delete("p");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}

export default function ProfileSelector({
  selected,
  onSelect,
  onError,
}: {
  selected: ReadyProfile | null;
  onSelect: (profile: ReadyProfile | null) => void;
  onError: (message: string) => void;
}) {
  const [location] = useLocation();
  const [items, setItems] = useState<ReadyProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState("");
  const [loadError, setLoadError] = useState("");
  const [id, setId] = useState(queryProfileId);
  const [refreshToken, setRefreshToken] = useState(0);
  const initialized = useRef(false);
  const selectedRef = useRef(selected);
  const onSelectRef = useRef(onSelect);
  const onErrorRef = useRef(onError);
  selectedRef.current = selected;
  onSelectRef.current = onSelect;
  onErrorRef.current = onError;

  const resolveSelection = useCallback(
    (
      requested: string,
      available: ReadyProfile[],
      initial: boolean,
      defaultId?: string | null
    ) => {
      const chosenId =
        requested ||
        (initial ? defaultId || "" : selectedRef.current?.id || "");
      const chosen = chosenId
        ? available.find(item => item.id === chosenId)
        : null;
      setId(chosen?.id || chosenId);
      if (chosen) {
        setFailed("");
        onErrorRef.current("");
        onSelectRef.current(chosen);
        return;
      }
      onSelectRef.current(null);
      if (requested || chosenId) {
        const message =
          "The requested operating system is unavailable. Choose an available operating system.";
        setFailed(message);
        onErrorRef.current(message);
      } else {
        const message = available.length
          ? "Choose an operating system to continue."
          : "No operating systems are ready. Configure an ISO link in Deployment profiles.";
        setFailed(message);
        onErrorRef.current(message);
      }
    },
    []
  );

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    const initial = !initialized.current;
    setLoading(true);
    setFailed("");
    setLoadError("");
    onErrorRef.current("Loading available operating systems…");
    void api<ReadyResponse>("/api/admin/profiles/ready", {
      signal: controller.signal,
    })
      .then(data => {
        if (!active) return;
        const available = Array.isArray(data?.items) ? data.items : [];
        setItems(available);
        resolveSelection(
          queryProfileId(),
          available,
          initial,
          data?.defaultProfileId
        );
        initialized.current = true;
      })
      .catch(error => {
        if (!active) return;
        const message =
          error instanceof Error && error.name !== "AbortError"
            ? error.message
            : "Operating systems could not be loaded.";
        setFailed(message);
        setLoadError(message);
        onErrorRef.current(message);
        onSelectRef.current(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [refreshToken, resolveSelection]);

  useEffect(() => {
    const syncQuery = () => {
      const requested = queryProfileId();
      setId(requested);
      if (!initialized.current || loading) return;
      resolveSelection(requested, items, false);
    };
    window.addEventListener("popstate", syncQuery);
    return () => window.removeEventListener("popstate", syncQuery);
  }, [items, loading, resolveSelection]);

  useEffect(() => {
    if (!initialized.current || loading) return;
    const requested = queryProfileId();
    setId(requested);
    resolveSelection(requested, items, false);
  }, [items, location, loading, resolveSelection]);

  const refresh = useCallback(() => setRefreshToken(value => value + 1), []);
  const groups = ["Windows 11", "Windows 10", "Windows Server"] as const;

  return (
    <div
      className="profiles-selector-field os-profile-field span-2"
      aria-busy={loading}
    >
      <div className="profiles-selector-toolbar os-profile-toolbar">
        <label className="profiles-selector-label field">
          <span>
            <span className="profiles-kicker">01 / target definition</span>
            Operating system
          </span>
          <select
            aria-label="Operating system"
            value={items.some(item => item.id === id) ? id : ""}
            disabled={
              loading || Boolean(loadError) || (!loading && items.length === 0)
            }
            onChange={event => {
              const next = event.target.value;
              const nextProfile = items.find(item => item.id === next) || null;
              setId(next);
              if (nextProfile) {
                setFailed("");
                onErrorRef.current("");
                onSelectRef.current(nextProfile);
                replaceProfileQuery(next);
              } else {
                const message = "Choose an operating system to continue.";
                setFailed(message);
                onErrorRef.current(message);
                onSelectRef.current(null);
                replaceProfileQuery("");
              }
            }}
          >
            <option value="">Choose OS</option>
            {groups.map(group => {
              const groupItems = items.filter(item => item.group === group);
              return groupItems.length ? (
                <optgroup key={group} label={group}>
                  {groupItems.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </select>
        </label>
        <button
          type="button"
          className="secondary-button profiles-selector-refresh"
          onClick={refresh}
          disabled={loading}
          aria-label="Refresh available operating systems"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      {loading && (
        <small className="profiles-selector-hint" role="status">
          Loading available operating systems…
        </small>
      )}
      {failed && (
        <small
          className="profiles-selector-hint profiles-selector-error"
          role="alert"
        >
          {failed}
        </small>
      )}
      {selected && !failed && (
        <small className="profiles-selector-hint form-hint">
          Revision {selected.revision} ·{" "}
          {selected.tested
            ? "Previously tested installer path"
            : "Configured ready profile"}
          . <Link href={`/profiles/${selected.id}`}>Edit profile</Link>
        </small>
      )}
      <Link className="profiles-selector-hint" href="/profiles">
        Manage deployment profiles <span aria-hidden="true">↗</span>
      </Link>
    </div>
  );
}
