import { useEffect, useState } from "react";
import { api } from "./api";
import type { DeploymentProfile } from "../../../../shared/deploymentProfiles";
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
    api<any>("/api/admin/profiles?archived=all", { signal: controller.signal })
      .then(d => {
        if (!controller.signal.aborted) setItems(d.items || []);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return (
    <label className="select-wrap">
      <select
        aria-label="Filter by deployment profile"
        value={value}
        onChange={e => {
          onChange(e.target.value);
          const u = new URL(window.location.href);
          if (e.target.value) u.searchParams.set("p", e.target.value);
          else u.searchParams.delete("p");
          window.history.replaceState(null, "", u.pathname + u.search);
        }}
      >
        <option value="">All deployment profiles</option>
        {value && !items.some(p => p.id === value) && (
          <option value={value}>Requested profile</option>
        )}
        {items.map(p => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.archivedAt ? " (archived)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
