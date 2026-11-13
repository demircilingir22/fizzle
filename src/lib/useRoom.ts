"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getPlayerId } from "@/lib/identity";
import { POLL_MS, isGoneError, roomApi, type RoomView } from "@/lib/online";

/** Round-trip samples kept for the clock-offset estimate. */
const OFFSET_SAMPLES = 16;
/** Time without a successful poll before showing "Reconnecting…". */
const OFFLINE_AFTER_MS = 3_000;

type Sample = { rtt: number; offset: number };

/**
 * Keeps a room in sync by polling GET /api/rooms/[code] (as often as the
 * server's `pollMs` says), and estimates the server clock so countdowns render
 * smoothly at 60fps.
 *
 * `code` must not change for the lifetime of the component (key it by code).
 */
export function useRoom(code: string, initial: RoomView | null, onGone: (message: string) => void) {
  const [room, setRoom] = useState<RoomView | null>(initial);
  const [offline, setOffline] = useState(false);
  const versionRef = useRef(initial?.version ?? -1);
  /** The server picks the interval: faster during a match, slower in the lobby and on results. */
  const pollMsRef = useRef(initial?.pollMs ?? POLL_MS);
  const samplesRef = useRef<Sample[]>([]);
  /** Server Unix ms minus local performance.now(); defaults to assuming synced wall clocks. */
  const offsetRef = useRef<number | null>(null);
  const goneRef = useRef(false);
  const onGoneRef = useRef(onGone);
  useEffect(() => {
    onGoneRef.current = onGone;
  });

  /** Reports (once) that the room closed or we were removed from it. */
  const gone = useCallback((message: string) => {
    if (goneRef.current) return;
    goneRef.current = true;
    onGoneRef.current(message);
  }, []);

  /** Applies a view from any response, unless a newer one already arrived. */
  const apply = useCallback(
    (view: RoomView, sentAt: number, receivedAt: number) => {
      // Offset from the fastest recent round trip: the midpoint is closest to when the server built the view.
      const samples = samplesRef.current;
      samples.push({ rtt: receivedAt - sentAt, offset: view.serverNow - (sentAt + receivedAt) / 2 });
      if (samples.length > OFFSET_SAMPLES) samples.shift();
      offsetRef.current = samples.reduce((best, s) => (s.rtt < best.rtt ? s : best)).offset;

      if (view.you === null) {
        gone("You're no longer in this room.");
        return;
      }
      if (view.version < versionRef.current) return;
      versionRef.current = view.version;
      if (Number.isFinite(view.pollMs) && view.pollMs > 0) pollMsRef.current = view.pollMs;
      setRoom(view);
    },
    [gone],
  );

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    let lastSuccess = performance.now();

    async function poll() {
      controller = new AbortController();
      const sentAt = performance.now();
      try {
        const view = await roomApi.get(code, getPlayerId(), controller.signal);
        if (cancelled) return;
        lastSuccess = performance.now();
        setOffline(false);
        apply(view, sentAt, performance.now());
      } catch (err) {
        if (cancelled) return;
        if (isGoneError(err)) {
          gone(err instanceof Error ? err.message : "The room closed.");
          return;
        }
        if (performance.now() - lastSuccess > OFFLINE_AFTER_MS) setOffline(true);
      }
      timer = setTimeout(poll, pollMsRef.current);
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [code, apply, gone]);

  /** Runs a room action and applies the room it returns. */
  const act = useCallback(
    async (run: (code: string, playerId: string) => Promise<RoomView>): Promise<RoomView | null> => {
      const sentAt = performance.now();
      try {
        const view = await run(code, getPlayerId());
        apply(view, sentAt, performance.now());
        return view;
      } catch (err) {
        if (isGoneError(err)) {
          gone(err instanceof Error ? err.message : "The room closed.");
          return null;
        }
        throw err;
      }
    },
    [code, apply, gone],
  );

  /** Best estimate of the server's Unix ms right now. */
  const serverNow = useCallback(
    () => performance.now() + (offsetRef.current ?? Date.now() - performance.now()),
    [],
  );

  return { room, offline, act, serverNow };
}
