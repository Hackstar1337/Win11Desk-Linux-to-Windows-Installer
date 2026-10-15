import { useEffect, useState } from "react";
import { api } from "./api";
import type { DeploymentProfile } from "../../../../shared/deploymentProfiles";
import "../../pages/control/ProfilesPage.css";

export default function ProfileFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [items, setItems] = useState<DeploymentProfile[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    api<{ items?: DeploymentProfile[] }>("/api/admin/profiles?archived=all", { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted) setItems(data.items || []);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return (
    <div className="profiles-filter-control">
      <span className="profiles-kicker">Filter / catalogue</span>
      <label className="select-wrap profiles-filter-label">
        <span>Deployment profile</span>
        <select
          aria-label="Filter by deployment profile"
          value={value}
          onChange={event => {
            onChange(event.target.value);
            const u = new URL(window.location.href);
            if (event.target.value) u.searchParams.set("p", event.target.value);
            else u.searchParams.delete("p");
            window.history.replaceState(null, "", u.pathname + u.search);
          }}
        >
          <option value="">All deployment profiles</option>
          {value && !items.some(profile => profile.id === value) && <option value={value}>Requested profile</option>}
          {items.map(profile => (
            <option key={profile.id} value={profile.id}>
              {profile.name}{profile.archivedAt ? " (archived)" : ""}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
