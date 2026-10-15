import { api } from "../api";

/** A timeout never retries a cancellation, reconciliation or installation action. */
export async function remoteRequest<T = unknown>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 75000
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await api<T>(path, { ...options, signal: controller.signal });
  } catch (error) {
    if (timedOut)
      throw new Error(
        "The request timed out. Refresh the job details to check its current state before repeating any action."
      );
    throw error;
  } finally {
    window.clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
