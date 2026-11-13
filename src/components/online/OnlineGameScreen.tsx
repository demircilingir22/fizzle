"use client";

import { Eye, KeyRound, WifiOff } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import {
  AnswerBar,
  BombGrid,
  CountdownOverlay,
  PauseButton,
  PauseOverlay,
  TOAST_MS,
  TopicPanel,
  type Toast,
} from "@/components/GameParts";
import { WinnerOverlay } from "@/components/WinnerOverlay";
import { toCanonicalId } from "@/lib/canonical";
import { MIN_PLAYERS } from "@/lib/game";
import {
  ONLINE_COUNTDOWN_STEPS,
  ONLINE_COUNTDOWN_STEP_MS,
  type MatchEvent,
  type OnlineMatch,
  type RoomView,
} from "@/lib/online";

type OnlineGameScreenProps = {
  room: RoomView;
  match: OnlineMatch;
  /** Best estimate of the server clock (Unix ms). */
  serverNow: () => number;
  offline: boolean;
  /** Each returns the updated room, or throws with a player-facing message. */
  onSubmit: (submission: string) => Promise<RoomView | null>;
  onPause: (paused: boolean) => Promise<unknown>;
  onTimeout: () => void;
  onReplay: () => void;
  onNewGenre: () => void;
  onLeave: () => void;
  /** Error from the host's last replay attempt. */
  actionError: string | null;
};

type LocalToast = Toast & { afterEvent: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Live fuse of the active player, from the server's clock start. */
function liveRemaining(remainingMs: number, turnStartedAt: number | null, now: number) {
  if (turnStartedAt === null) return remainingMs;
  return Math.max(0, remainingMs - Math.max(0, now - turnStartedAt));
}

export function OnlineGameScreen({
  room,
  match,
  serverNow,
  offline,
  onSubmit,
  onPause,
  onTimeout,
  onReplay,
  onNewGenre,
  onLeave,
  actionError,
}: OnlineGameScreenProps) {
  const { settings, topic, phase } = match;
  const totalMs = settings.seconds * 1000;
  const me = room.you;
  const myIndex = match.players.findIndex((p) => p.id === me);
  const activePlayer = match.players[match.active];
  const isMyTurn = activePlayer.id === me;
  const isHost = me === room.hostId;

  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  /** Server-time estimate, refreshed by the animation loop whenever the shown time changes. */
  const [now, setNow] = useState(0);
  const [localToast, setLocalToast] = useState<LocalToast | null>(null);
  const [dismissedEvent, setDismissedEvent] = useState(0);
  /** Events from before this screen mounted are old news. */
  const [firstEvent] = useState(() => match.event?.id ?? 0);
  const inputRef = useRef<HTMLInputElement>(null);
  const toastIdRef = useRef(0);
  const reportedTimeoutRef = useRef<number | null>(null);

  const canAnswer = isMyTurn && phase === "playing" && !match.paused && !match.validating;
  // Freeze the shown clock the moment we hit Enter; the server freezes it on receipt.
  const clockRunning = phase === "playing" && match.turnStartedAt !== null && !submitting;
  const counting = phase === "countdown" && match.phaseEndsAt !== null;

  // ---------------------------------------------------------------------------
  // Clock: everything is derived from server timestamps, so all screens agree.
  // ---------------------------------------------------------------------------
  const activeRemainingMs = activePlayer.remainingMs;
  const { turnStartedAt, phaseEndsAt } = match;

  const reportTimeout = useEffectEvent(() => onTimeout());

  useEffect(() => {
    if (!clockRunning && !counting) return;
    let frame = 0;
    let shown = Number.NaN;

    const tick = () => {
      const t = serverNow();
      // Re-render only when the visible digit changes (tenths of the fuse, or the 3-2-1).
      const digit = clockRunning
        ? Math.ceil(liveRemaining(activeRemainingMs, turnStartedAt, t) / 100)
        : Math.ceil(((phaseEndsAt ?? t) - t) / ONLINE_COUNTDOWN_STEP_MS);
      if (digit !== shown) {
        shown = digit;
        setNow(t);
      }
      // Nudge the server once when a fuse runs out; it checks the time itself.
      if (clockRunning && digit <= 0 && reportedTimeoutRef.current !== turnStartedAt) {
        reportedTimeoutRef.current = turnStartedAt;
        reportTimeout();
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [clockRunning, counting, activeRemainingMs, turnStartedAt, phaseEndsAt, serverNow]);

  const times = match.players.map((p, i) =>
    i === match.active ? liveRemaining(p.remainingMs, turnStartedAt, now) : p.remainingMs,
  );
  const countdown = clamp(
    Math.ceil(((phaseEndsAt ?? 0) - now) / ONLINE_COUNTDOWN_STEP_MS),
    1,
    ONLINE_COUNTDOWN_STEPS,
  );

  // ---------------------------------------------------------------------------
  // Toasts: referee outcomes come from the server so every screen sees them.
  // ---------------------------------------------------------------------------
  const event = match.event;
  const eventToast =
    event && event.id > firstEvent && event.id > dismissedEvent ? eventToToast(event, match, myIndex) : null;
  const toast = localToast && localToast.afterEvent >= (event?.id ?? 0) ? localToast : eventToast;

  const eventToastId = eventToast?.id ?? null;
  const eventToastTone = eventToast?.tone ?? null;
  useEffect(() => {
    if (eventToastId === null || eventToastTone === null) return;
    const timer = setTimeout(() => setDismissedEvent(eventToastId), TOAST_MS[eventToastTone]);
    return () => clearTimeout(timer);
  }, [eventToastId, eventToastTone]);

  useEffect(() => {
    if (!localToast) return;
    const timer = setTimeout(
      () => setLocalToast((current) => (current?.id === localToast.id ? null : current)),
      TOAST_MS[localToast.tone],
    );
    return () => clearTimeout(timer);
  }, [localToast]);

  function showError(text: string) {
    toastIdRef.current += 1;
    setLocalToast({ id: -toastIdRef.current, tone: "error", text, afterEvent: match.event?.id ?? 0 });
  }

  // Keep the answer box focused when it's this screen's turn.
  useEffect(() => {
    if (canAnswer && !submitting) inputRef.current?.focus();
  }, [canAnswer, submitting, match.active]);

  // ---------------------------------------------------------------------------
  // Pause (synced across the room)
  // ---------------------------------------------------------------------------
  const canPause = phase === "playing" || phase === "countdown";

  async function setPaused(paused: boolean) {
    try {
      await onPause(paused);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Couldn't pause. Try again!");
    }
  }

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (match.paused) setPaused(false);
    else if (canPause) setPaused(true);
  });
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // ---------------------------------------------------------------------------
  // Submitting
  // ---------------------------------------------------------------------------
  async function submitAnswer(e: FormEvent) {
    e.preventDefault();
    if (!canAnswer || submitting) return;

    const submission = answer.trim().replace(/\s+/g, " ");
    if (!submission) {
      showError("Type an answer first!");
      return;
    }
    const key = toCanonicalId(submission);
    if (key && match.usedKeys.includes(key)) {
      showError(`“${submission}” was already said!`);
      return;
    }

    setSubmitting(true);
    try {
      const view = await onSubmit(submission);
      const result = view?.match?.event;
      if (result && result.player === myIndex && result.tone !== "error" && result.id > (event?.id ?? 0)) {
        setAnswer("");
      } else {
        inputRef.current?.select();
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : "The referee is unavailable. Try again!");
    } finally {
      setSubmitting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const checkingOwn = submitting || (match.validating && isMyTurn);
  const checkingText = checkingOwn
    ? "Referee is checking… clock frozen"
    : match.validating
      ? `Checking ${activePlayer.name}'s “${match.checking ?? "…"}”… clock frozen`
      : null;

  const placeholder =
    phase === "countdown"
      ? "Get ready…"
      : phase === "exploding"
        ? "BOOM!"
        : phase === "over"
          ? "Game over"
          : isMyTurn
            ? "Your turn, name one!"
            : `Waiting for ${activePlayer.name} to answer...`;

  const spectating = myIndex === -1;
  const out = !spectating && match.players[myIndex].eliminated;
  const host = room.players.find((p) => p.isHost);

  return (
    <div className="animate-screen-in flex h-dvh flex-col overflow-hidden">
      <header className="flex items-start gap-3 p-3 sm:p-4">
        <TopicPanel
          genre={settings.genre}
          difficulty={settings.difficulty}
          topic={topic}
          feed={match.feed}
          players={match.players}
          paused={match.paused}
          chips={
            <>
              <span className="bg-sky flex items-center gap-1 rounded-full px-2.5 py-0.5 tracking-wider">
                <KeyRound className="size-3.5" strokeWidth={2.5} />
                {room.code}
              </span>
              {(spectating || out) && (
                <span className="bg-cream-deep flex items-center gap-1 rounded-full px-2.5 py-0.5">
                  <Eye className="size-3.5" strokeWidth={2.5} />
                  {spectating ? "Watching: you'll play next round" : "You're out, cheer them on!"}
                </span>
              )}
            </>
          }
        />
        <PauseButton
          paused={match.paused}
          disabled={!canPause && !match.paused}
          onClick={() => setPaused(!match.paused)}
        />
      </header>

      <BombGrid
        players={match.players}
        times={times}
        totalMs={totalMs}
        active={match.active}
        phase={phase}
        // A handed-over clock starts a poll interval late (see rooms.ts): no ticking until then.
        ticking={clockRunning && turnStartedAt !== null && now >= turnStartedAt}
        frozen={match.validating || (submitting && isMyTurn)}
        turnLabel={isMyTurn ? "Your turn!" : "Answering…"}
      />

      <AnswerBar
        paused={match.paused}
        checkingText={checkingText}
        toast={toast}
        activeName={isMyTurn ? "You" : activePlayer.name}
        activeColor={activePlayer.color}
        answer={answer}
        onAnswerChange={setAnswer}
        onSubmit={submitAnswer}
        inputEnabled={canAnswer || submitting}
        submitting={!!checkingOwn}
        placeholder={placeholder}
        locked={!isMyTurn}
        inputRef={inputRef}
      />

      {offline && (
        <p
          role="status"
          className="bg-blush fixed top-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border-[3px] border-ink px-4 py-1.5 text-sm font-extrabold"
        >
          <WifiOff className="size-4" strokeWidth={3} /> Reconnecting…
        </p>
      )}

      {phase === "countdown" && !match.paused && (
        <CountdownOverlay
          topic={topic}
          count={countdown}
          order={match.players}
          firstLabel={match.players[0]?.id === me ? "You go first!" : undefined}
        />
      )}

      {match.paused && (
        <PauseOverlay
          subtitle={`${match.pausedBy ?? "Someone"} paused the game. Clocks are frozen for everyone.`}
          onResume={() => setPaused(false)}
          onQuit={onLeave}
          quitLabel="Leave Lobby"
        />
      )}

      {phase === "over" && (
        <WinnerOverlay
          players={match.players}
          winner={match.winner}
          eliminated={match.eliminated}
          winnerTimeMs={match.winner === null ? 0 : match.players[match.winner].remainingMs}
          totalAnswers={match.feed.length}
          onReplay={onReplay}
          onNewGenre={onNewGenre}
          onLeave={onLeave}
          canChoose={isHost}
          waitingText={`Waiting for ${host?.name ?? "the host"} to choose what's next…`}
          blockedReason={
            room.players.length < MIN_PLAYERS ? `Waiting for at least ${MIN_PLAYERS} players in the room.` : null
          }
          loading={room.status === "loading"}
          error={room.notice ?? actionError}
        />
      )}
    </div>
  );
}

function eventToToast(event: MatchEvent, match: OnlineMatch, myIndex: number): Toast {
  const mine = event.player === myIndex;
  const name = match.players[event.player]?.name ?? "Someone";
  const text =
    event.tone === "corrected"
      ? mine
        ? `Auto-corrected to: ${event.text}`
        : `${name}: auto-corrected to ${event.text}`
      : mine
        ? event.text
        : `${name}: ${event.text}`;
  return { id: event.id, tone: event.tone, text };
}
