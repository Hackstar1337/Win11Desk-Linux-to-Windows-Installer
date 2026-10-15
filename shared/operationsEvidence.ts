export const RELEASE_JOURNAL_TAGS = [
  "0000_initial_users",
  "0001_lowly_giant_girl",
  "0002_fine_toro",
] as const;
export const ACTIVE_STAGES = [
  "starting",
  "preflight",
  "staging",
  "rebooting",
  "installer_booted",
  "downloading",
  "media_verified",
  "preparing",
  "windows_setup",
  "windows_booted",
] as const;
export const KNOWN_STAGES = [
  ...ACTIVE_STAGES,
  "windows_ready",
  "failed",
] as const;
export function matchesReleaseJournal(tags: string[]) {
  return (
    tags.length === RELEASE_JOURNAL_TAGS.length &&
    new Set(tags).size === tags.length &&
    RELEASE_JOURNAL_TAGS.every(t => tags.includes(t))
  );
}
export function attentionState(stage: unknown): "failed" | "stale" | "unknown" {
  return stage === "failed"
    ? "failed"
    : typeof stage === "string" &&
        (ACTIVE_STAGES as readonly string[]).includes(stage)
      ? "stale"
      : "unknown";
}
export function sourceEvidence(
  digest: string | null,
  expected: string
): "ok" | "error" | "unknown" {
  return digest === null ? "unknown" : digest === expected ? "ok" : "error";
}
