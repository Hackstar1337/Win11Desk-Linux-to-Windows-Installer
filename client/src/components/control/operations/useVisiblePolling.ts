import { useCallback, useEffect, useRef, useState } from "react";
import type { ResourceState } from "./types";

export type PollLoader<T> = (signal: AbortSignal) => Promise<T>;

/** Poll only while visible and mounted; a slow request never overlaps the next tick. */
export function useVisiblePolling<T>(
  loader: PollLoader<T>,
  intervalMs = 30_000,
  enabled = true
): ResourceState<T> {
  const loaderRef = useRef(loader);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(enabled);
  const [generation, setGeneration] = useState(0);
  loaderRef.current = loader;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    let active = true;
    let inFlight = false;
    let controller: AbortController | null = null;

    const load = async () => {
      if (!active || document.hidden || inFlight) return;
      inFlight = true;
      controller = new AbortController();
      setLoading(true);
      const timeout = window.setTimeout(() => controller?.abort(), 20_000);
      try {
        const next = await loaderRef.current(controller.signal);
        if (active) {
          setData(next);
          setError("");
          setLoading(false);
        }
      } catch (reason) {
        if (active && !document.hidden) {
          setError(
            reason instanceof Error ? reason.message : "Unable to load data."
          );
          setLoading(false);
        }
      } finally {
        window.clearTimeout(timeout);
        inFlight = false;
        controller = null;
      }
    };

    const onVisibilityChange = () => {
      if (!document.hidden) void load();
      else controller?.abort();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    void load();
    const timer = window.setInterval(() => void load(), intervalMs);

    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, generation, intervalMs, loader]);

  const reload = useCallback(() => setGeneration(value => value + 1), []);
  return { data, error, loading, reload };
}
