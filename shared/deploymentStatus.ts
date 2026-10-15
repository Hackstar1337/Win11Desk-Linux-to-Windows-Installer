export function deploymentStatusLabel(value?: string | null): string {
  if (value === "stale") return "Awaiting update";
  return (value || "unknown").replaceAll("_", " ");
}
