export function installationDuration(
  startedAt: string | null | undefined,
  finishedAt: string | null | undefined,
  now = Date.now()
): string {
  const start = startedAt ? Date.parse(startedAt) : NaN;
  const finish = finishedAt ? Date.parse(finishedAt) : NaN;
  if (!Number.isFinite(start)) return "—";
  const seconds = Math.max(
    0,
    Math.floor(((Number.isFinite(finish) ? finish : now) - start) / 1000)
  );
  return [
    Math.floor(seconds / 3600),
    Math.floor((seconds % 3600) / 60),
    seconds % 60,
  ]
    .map(n => String(n).padStart(2, "0"))
    .join(":");
}
export function transferProgress(
  downloadedValue: unknown,
  totalValue: unknown
) {
  const downloaded = downloadedValue == null ? null : Number(downloadedValue);
  const total = totalValue == null ? null : Number(totalValue);
  const hasDownloaded =
    downloaded !== null && Number.isFinite(downloaded) && downloaded >= 0;
  const hasTotal = total !== null && Number.isFinite(total) && total > 0;
  const percent =
    hasDownloaded && hasTotal
      ? Math.min(100, Math.max(0, (downloaded! / total!) * 100))
      : null;
  return {
    downloaded: hasDownloaded ? downloaded : null,
    total: hasTotal ? total : null,
    percent,
  };
}
export function rdpAddress(ip?: string | null, port?: number | string | null) {
  const n = Number(port);
  if (!ip || !Number.isInteger(n) || n < 1 || n > 65535) return null;
  return `${ip.includes(":") ? `[${ip}]` : ip}:${n}`;
}

/** Display the saved profile identity only; OS metadata belongs to the profile editor. */
export function profileOptionLabel(name: string, osName: string): string {
  return name.trim() || osName.trim();
}
