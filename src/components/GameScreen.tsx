"use client";

import { useCallback, useEffect, useEffectEvent, useReducer, useRef, useState, type FormEvent } from "react";
import {
  AnswerBar,
  BombGrid,
  COUNTDOWN_FROM,
  CountdownOverlay,
  PauseButton,
  PauseOverlay,
  TOAST_MS,
  TopicPanel,
  type Toast,
} from "@/components/GameParts";
import { WinnerOverlay } from "@/components/WinnerOverlay";
import { toCanonicalId } from "@/lib/canonical";
import { gameReducer, initGame, validateMove, type Match } from "@/lib/game";

const EXPLOSION_MS = 1600;

type GameScreenProps = {
  match: Match;
  /** Quit from the pause menu. */
  onHome: () => void;
  /** Post-game: same players and settings, fresh category in the same genre. */
  onReplay: () => void;
  /** Post-game: same players, pick a new genre. */
  onNewGenre: () => void;
  /** Post-game: back to the mode select screen. */
  onLeave: () => void;
  /** Called once when the match ends (used to prefetch the next category). */
  onMatchOver: () => void;
  rematchLoading: boolean;
  rematchError: string | null;
};

export function GameScreen({
  match,
  onHome,
  onReplay,
  onNewGenre,
  onLeave,
  onMatchOver,
  rematchLoading,
  rematchError,
}: GameScreenProps) {
  const { settings, topic } = match;
  const totalMs = settings.seconds * 1000;

  const [game, dispatch] = useReducer(gameReducer, match.players, initGame);
  const [times, setTimes] = useState(() => match.players.map(() => totalMs));
  const [countdown, setCountdown] = useState(COUNTDOWN_FROM);
  const [paused, setPaused] = useState(false);
  const [validating, setValidating] = useState(false);
  const [answer, setAnswer] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);

  /** Authoritative remaining time per player; `times` is the rendered copy. */
  const timesRef = useRef(match.players.map(() => totalMs));
  const clockRef = useRef({ running: false, player: 0, lastTick: 0 });
  const requestRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toastIdRef = useRef(0);

  const showToast = useCallback((tone: Toast["tone"], text: string) => {
    toastIdRef.current += 1;
    setToast({ id: toastIdRef.current, tone, text });
  }, []);

  const explode = useCallback((player: number) => {
    dispatch({ type: "explode", player });
    setAnswer("");
    setToast(null);
  }, []);

  /**
   * Charges the running player for the time since the last tick and stops the
   * clock. Returns false if that ran their fuse out (they explode instead).
   */
  const stopClock = useCallback((): boolean => {
    const clock = clockRef.current;
    if (!clock.running) return true;
    clock.running = false;
    const remaining = timesRef.current;
    remaining[clock.player] = Math.max(0, remaining[clock.player] - (performance.now() - clock.lastTick));
    setTimes(remaining.slice());
    if (remaining[clock.player] === 0) {
      explode(clock.player);
      return false;
    }
    return true;
  }, [explode]);

  // ---------------------------------------------------------------------------
  // Delta-time chess clock. Runs only for the active player, and only while the
  // game is live, unpaused and not waiting on the referee.
  // ---------------------------------------------------------------------------
  const clockShouldRun = game.phase === "playing" && !paused && !validating;

  useEffect(() => {
    if (!clockShouldRun) return;
    const clock = clockRef.current;
    const remaining = timesRef.current;
    clock.running = true;
    clock.player = game.active;
    clock.lastTick = performance.now();
    let shownTenths = Math.ceil(remaining[clock.player] / 100);
    let frame = 0;

    const tick = () => {
      if (!clock.running) return;
      const now = performance.now();
      remaining[clock.player] = Math.max(0, remaining[clock.player] - (now - clock.lastTick));
      clock.lastTick = now;

      if (remaining[clock.player] === 0) {
        clock.running = false;
        setTimes(remaining.slice());
        explode(clock.player);
        return;
      }
      // The readout shows tenths, so only re-render when that digit changes.
      const tenths = Math.ceil(remaining[clock.player] / 100);
      if (tenths !== shownTenths) {
        shownTenths = tenths;
        setTimes(remaining.slice());
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      stopClock();
    };
  }, [clockShouldRun, game.active, stopClock, explode]);

  // 3-2-1 countdown so the first player gets to read the category too.
  useEffect(() => {
    if (game.phase !== "countdown" || paused) return;
    const timer = setTimeout(() => {
      if (countdown > 1) setCountdown(countdown - 1);
      else dispatch({ type: "start" });
    }, 900);
    return () => clearTimeout(timer);
  }, [game.phase, countdown, paused]);

  // Let the explosion play out before the next turn (or the winner screen).
  useEffect(() => {
    if (game.phase !== "exploding") return;
    const timer = setTimeout(() => dispatch({ type: "settle" }), EXPLOSION_MS);
    return () => clearTimeout(timer);
  }, [game.phase]);

  const notifyMatchOver = useEffectEvent(() => onMatchOver());
  useEffect(() => {
    if (game.phase === "over") notifyMatchOver();
  }, [game.phase]);

  // Auto-dismiss the feedback toast.
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(
      () => setToast((current) => (current?.id === toast.id ? null : current)),
      TOAST_MS[toast.tone],
    );
    return () => clearTimeout(timer);
  }, [toast]);

  // Keep the answer box focused for whoever's turn it is.
  const inputEnabled = game.phase === "playing" && !paused;
  useEffect(() => {
    if (inputEnabled && !validating) inputRef.current?.focus();
  }, [inputEnabled, validating, game.active]);

  // Drop any in-flight referee call if the screen goes away.
  useEffect(() => {
    const request = requestRef;
    return () => request.current?.abort();
  }, []);

  // ---------------------------------------------------------------------------
  // Pause
  // ---------------------------------------------------------------------------
  const canPause = game.phase === "playing" || game.phase === "countdown";

  function pause() {
    if (!canPause || paused) return;
    if (!stopClock()) return;
    setPaused(true);
  }

  function togglePause() {
    if (paused) setPaused(false);
    else pause();
  }

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape") togglePause();
  });
  // Auto-pause when the tab is hidden so nobody loses time to a backgrounded tab.
  const onVisibilityChange = useEffectEvent(() => {
    if (document.hidden) pause();
  });
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => onKeyDown(event);
    const handleVisibility = () => onVisibilityChange();
    window.addEventListener("keydown", handleKey);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Submitting an answer
  // ---------------------------------------------------------------------------
  async function submitAnswer(event: FormEvent) {
    event.preventDefault();
    if (game.phase !== "playing" || paused || requestRef.current) return;

    // Stage 1: instant client-side checks. The clock keeps running.
    const submission = answer.trim().replace(/\s+/g, " ");
    if (!submission) {
      showToast("error", "Type an answer first!");
      return;
    }
    const key = toCanonicalId(submission);
    if (key && game.usedKeys.includes(key)) {
      showToast("error", `“${submission}” was already said!`);
      return;
    }

    // Stage 2: freeze the clock while the referee thinks.
    const player = game.active;
    if (!stopClock()) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setToast(null);
    setValidating(true);

    try {
      const verdict = await validateMove(
        {
          genre: settings.genre,
          category: topic.category,
          submission,
          usedCanonicalIds: game.usedCanonicalIds,
        },
        controller.signal,
      );
      if (verdict.valid && !verdict.isDuplicate) {
        dispatch({
          type: "accept",
          player,
          canonicalId: verdict.canonicalId,
          displayName: verdict.displayName,
          submission,
        });
        setAnswer("");
        if (verdict.autoCorrected) showToast("corrected", `Auto-corrected to: ${verdict.displayName}`);
        else showToast("success", verdict.displayName);
      } else {
        showToast(
          "error",
          verdict.reason || (verdict.isDuplicate ? "That one was already used!" : "That one doesn't count."),
        );
        inputRef.current?.select();
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      showToast("error", err instanceof Error ? err.message : "The referee is unavailable. Try again!");
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      setValidating(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const activePlayer = game.players[game.active];

  const placeholder =
    game.phase === "countdown"
      ? "Get ready…"
      : game.phase === "exploding"
        ? "BOOM!"
        : game.phase === "over"
          ? "Game over"
          : `${activePlayer.name}, name one!`;

  return (
    <div className="animate-screen-in flex h-dvh flex-col overflow-hidden">
      <header className="flex items-start gap-3 p-3 sm:p-4">
        <TopicPanel
          genre={settings.genre}
          difficulty={settings.difficulty}
          topic={topic}
          feed={game.feed}
          players={game.players}
          paused={paused}
        />
        <PauseButton paused={paused} disabled={!canPause && !paused} onClick={togglePause} />
      </header>

      <BombGrid
        players={game.players}
        times={times}
        totalMs={totalMs}
        active={game.active}
        phase={game.phase}
        ticking={clockShouldRun}
        frozen={validating}
      />

      <AnswerBar
        paused={paused}
        checkingText={validating ? "Referee is checking… clock frozen" : null}
        toast={toast}
        activeName={activePlayer.name}
        activeColor={activePlayer.color}
        answer={answer}
        onAnswerChange={setAnswer}
        onSubmit={submitAnswer}
        inputEnabled={inputEnabled}
        submitting={validating}
        placeholder={placeholder}
        inputRef={inputRef}
      />

      {game.phase === "countdown" && !paused && (
        <CountdownOverlay topic={topic} count={countdown} order={game.players} />
      )}

      {paused && (
        <PauseOverlay
          subtitle="Clocks are frozen. No peeking!"
          onResume={() => setPaused(false)}
          onQuit={onHome}
          quitLabel="Quit to menu"
        />
      )}

      {game.phase === "over" && (
        <WinnerOverlay
          players={game.players}
          winner={game.winner}
          eliminated={game.eliminated}
          winnerTimeMs={game.winner === null ? 0 : times[game.winner]}
          totalAnswers={game.feed.length}
          onReplay={onReplay}
          onNewGenre={onNewGenre}
          onLeave={onLeave}
          canChoose
          loading={rematchLoading}
          error={rematchError}
        />
      )}
    </div>
  );
}
