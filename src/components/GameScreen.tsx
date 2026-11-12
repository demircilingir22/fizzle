"use client";

import {
  CircleCheck,
  CornerDownLeft,
  LoaderCircle,
  LogOut,
  Pause,
  Play,
  Snowflake,
  Sparkles,
  TriangleAlert,
  WandSparkles,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { PlayerBomb } from "@/components/PlayerBomb";
import { WinnerOverlay } from "@/components/WinnerOverlay";
import { toCanonicalId } from "@/lib/canonical";
import {
  MAX_ANSWER_LENGTH,
  gameReducer,
  gridShape,
  initGame,
  playerColor,
  validateMove,
  type Match,
} from "@/lib/game";

const COUNTDOWN_FROM = 3;
const EXPLOSION_MS = 1600;

type Toast = { id: number; tone: "error" | "success" | "corrected"; text: string };

const TOAST_MS: Record<Toast["tone"], number> = { error: 3800, success: 1600, corrected: 2600 };

type GameScreenProps = {
  match: Match;
  onHome: () => void;
  onPlayAgain: () => void;
  /** Called once when the match ends (used to prefetch the next category). */
  onMatchOver: () => void;
  rematchLoading: boolean;
  rematchError: string | null;
};

export function GameScreen({ match, onHome, onPlayAgain, onMatchOver, rematchLoading, rematchError }: GameScreenProps) {
  const { settings, topic } = match;
  const totalMs = settings.seconds * 1000;

  const [game, dispatch] = useReducer(gameReducer, match.playerNames, initGame);
  const [times, setTimes] = useState(() => match.playerNames.map(() => totalMs));
  const [countdown, setCountdown] = useState(COUNTDOWN_FROM);
  const [paused, setPaused] = useState(false);
  const [validating, setValidating] = useState(false);
  const [answer, setAnswer] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);

  /** Authoritative remaining time per player; `times` is the rendered copy. */
  const timesRef = useRef(match.playerNames.map(() => totalMs));
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
  const activeColor = playerColor(game.active);
  const grid = gridShape(game.players.length);
  const gridVars = {
    "--nc": grid.narrow[0],
    "--nr": grid.narrow[1],
    "--wc": grid.wide[0],
    "--wr": grid.wide[1],
  } as CSSProperties;

  const placeholder =
    game.phase === "countdown"
      ? "Get ready…"
      : game.phase === "exploding"
        ? "BOOM!"
        : game.phase === "over"
          ? "Game over"
          : `${activePlayer.name}, name one!`;

  const hidden = paused ? "pointer-events-none blur-[10px] select-none" : "";

  return (
    <div className="animate-screen-in flex h-dvh flex-col overflow-hidden">
      {/* Top bar */}
      <header className="flex items-start gap-3 p-3 sm:p-4">
        <div
          aria-hidden={paused}
          className={`bg-paper/90 min-w-0 flex-1 rounded-[1.75rem] border-[3px] border-ink/10 px-4 py-3 transition-[filter] duration-200 ${hidden}`}
        >
          <div className="flex flex-wrap items-center gap-2 text-xs font-extrabold">
            <span className="bg-lavender flex max-w-full items-center gap-1 rounded-full px-2.5 py-0.5">
              <Sparkles className="size-3.5 shrink-0" strokeWidth={2.5} />
              <span className="truncate">{settings.genre}</span>
            </span>
            <span className="bg-butter rounded-full px-2.5 py-0.5">{settings.difficulty}</span>
            <span className="text-ink-soft">
              {game.feed.length} named
            </span>
          </div>
          <h1 className="font-display mt-1 text-2xl leading-tight font-bold sm:text-3xl">{topic.category}</h1>
          <p className="text-ink-soft text-sm font-semibold sm:text-base">{topic.description}</p>
          <ul aria-label="Accepted answers" className="feed-scroll mt-2 flex gap-1.5 overflow-x-auto pb-1">
            {game.feed.length === 0 ? (
              <li className="text-ink-soft/70 text-sm font-bold">No answers yet. Be the first!</li>
            ) : (
              game.feed.map((item) => (
                <li
                  key={item.canonicalId}
                  className="animate-pop-in shrink-0 rounded-full border-2 border-ink/15 px-3 py-0.5 text-sm font-bold whitespace-nowrap"
                  style={{ backgroundColor: playerColor(item.player).base }}
                >
                  {item.displayName}
                </li>
              ))
            )}
          </ul>
        </div>

        <button
          type="button"
          onClick={togglePause}
          disabled={!canPause && !paused}
          aria-label={paused ? "Resume game" : "Pause game"}
          className="press bg-butter flex size-14 shrink-0 items-center justify-center rounded-full border-[3px] border-ink disabled:opacity-40 sm:size-16"
        >
          {paused ? (
            <Play className="size-7 fill-current" strokeWidth={2.5} />
          ) : (
            <Pause className="size-7 fill-current" strokeWidth={2.5} />
          )}
        </button>
      </header>

      {/* Bombs */}
      <section
        aria-label="Players"
        className={`min-h-0 flex-1 px-2 ${game.phase === "exploding" ? "animate-quake" : ""}`}
      >
        <div className="flex h-full flex-wrap justify-center" style={gridVars}>
          {game.players.map((player, index) => {
            const isActive = index === game.active && (game.phase === "playing" || game.phase === "countdown");
            return (
              <div
                key={index}
                className="flex h-[calc(100%/var(--nr))] shrink-0 basis-[calc(100%/var(--nc))] items-center justify-center md:h-[calc(100%/var(--wr))] md:basis-[calc(100%/var(--wc))]"
                style={{ containerType: "size" }}
              >
                <PlayerBomb
                  index={index}
                  name={player.name}
                  remainingMs={times[index]}
                  totalMs={totalMs}
                  lastAnswer={player.lastAnswer}
                  active={isActive}
                  ticking={isActive && clockShouldRun}
                  frozen={isActive && validating}
                  eliminated={player.eliminated}
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* Answer input */}
      <footer className={`p-3 transition-[filter] duration-200 sm:p-4 ${hidden}`} aria-hidden={paused}>
        <div className="relative mx-auto max-w-3xl">
          <div
            aria-live="polite"
            className="pointer-events-none absolute inset-x-0 bottom-full mb-3 flex justify-center px-2"
          >
            {validating ? (
              <p className="animate-toast-in bg-sky flex items-center gap-2 rounded-full border-[3px] border-ink px-4 py-2 font-bold shadow-[0_4px_0_0_rgb(61_44_70/0.18)]">
                <Snowflake className="size-5 animate-spin [animation-duration:3s]" strokeWidth={2.5} />
                Referee is checking… clock frozen
              </p>
            ) : toast ? (
              <p
                key={toast.id}
                role={toast.tone === "error" ? "alert" : undefined}
                className={`animate-toast-in flex max-w-full items-center gap-2 rounded-3xl border-[3px] px-4 py-2 font-bold shadow-[0_4px_0_0_rgb(61_44_70/0.18)] ${
                  toast.tone === "error"
                    ? "bg-blush border-crimson/60"
                    : toast.tone === "corrected"
                      ? "bg-lavender border-lavender-deep/50 text-sm"
                      : "bg-mint border-mint-deep/60"
                }`}
              >
                {toast.tone === "error" ? (
                  <TriangleAlert className="text-crimson size-5 shrink-0" strokeWidth={2.5} />
                ) : toast.tone === "corrected" ? (
                  <WandSparkles className="text-lavender-deep size-5 shrink-0" strokeWidth={2.5} />
                ) : (
                  <CircleCheck className="text-mint-deep size-5 shrink-0" strokeWidth={2.5} />
                )}
                <span className="min-w-0">{toast.text}</span>
              </p>
            ) : null}
          </div>

          <form
            onSubmit={submitAnswer}
            className="bg-paper flex items-center gap-2 rounded-full border-[3px] p-2 pl-3 shadow-[0_6px_0_0_rgb(61_44_70/0.2)] transition-colors sm:pl-2"
            style={{ borderColor: inputEnabled ? activeColor.deep : "var(--color-ink)" }}
          >
            <span
              className="font-display hidden max-w-40 shrink-0 truncate rounded-full border-2 border-ink/20 px-4 py-2 text-lg font-semibold sm:block"
              style={{ backgroundColor: activeColor.base }}
            >
              {activePlayer.name}
            </span>
            <input
              ref={inputRef}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              disabled={!inputEnabled}
              readOnly={validating}
              maxLength={MAX_ANSWER_LENGTH}
              placeholder={placeholder}
              aria-label={`Answer for ${activePlayer.name}`}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              className="placeholder:text-ink-soft/55 font-display min-w-0 flex-1 bg-transparent px-2 text-xl font-medium outline-none disabled:cursor-not-allowed sm:text-2xl"
            />
            <button
              type="submit"
              disabled={!inputEnabled || validating}
              aria-label="Submit answer"
              className="press bg-mint flex size-12 shrink-0 items-center justify-center rounded-full border-[3px] border-ink disabled:opacity-50 sm:size-14"
            >
              {validating ? (
                <LoaderCircle className="size-6 animate-spin" strokeWidth={3} />
              ) : (
                <CornerDownLeft className="size-6" strokeWidth={3} />
              )}
            </button>
          </form>
        </div>
      </footer>

      {/* Countdown */}
      {game.phase === "countdown" && !paused && (
        <div className="bg-cream/75 fixed inset-0 z-20 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="animate-pop-in flex max-w-lg flex-col items-center gap-3 text-center">
            <p className="text-ink-soft text-sm font-extrabold tracking-widest uppercase">Your category</p>
            <h2 className="font-display text-4xl leading-tight font-bold sm:text-5xl">{topic.category}</h2>
            <p className="text-ink-soft text-lg font-semibold">{topic.description}</p>
            <p
              key={countdown}
              className="animate-count font-display text-coral mt-2 text-8xl font-bold [text-shadow:0_5px_0_var(--color-ink)]"
            >
              {countdown}
            </p>
            <p className="font-bold">
              <span
                className="rounded-full border-2 border-ink/20 px-3 py-1"
                style={{ backgroundColor: playerColor(0).base }}
              >
                {game.players[0].name}
              </span>{" "}
              goes first
            </p>
          </div>
        </div>
      )}

      {/* Pause menu */}
      {paused && (
        <div className="animate-screen-in fixed inset-0 z-30 flex items-center justify-center bg-cream/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pause-title"
            className="bg-paper animate-pop-in flex w-full max-w-sm flex-col items-center gap-4 rounded-[2.5rem] border-[3px] border-ink p-7 text-center shadow-[0_10px_0_0_rgb(61_44_70/0.2)]"
          >
            <div className="bg-butter flex size-16 items-center justify-center rounded-full border-[3px] border-ink">
              <Pause className="size-8 fill-current" strokeWidth={2.5} />
            </div>
            <div>
              <h2 id="pause-title" className="font-display text-4xl font-bold">
                Paused
              </h2>
              <p className="text-ink-soft mt-1 font-semibold">Clocks are frozen. No peeking!</p>
            </div>
            <button
              type="button"
              onClick={() => setPaused(false)}
              autoFocus
              className="press bg-mint font-display flex h-14 w-full items-center justify-center gap-2 rounded-full border-[3px] border-ink text-xl font-bold"
            >
              <Play className="size-5 fill-current" strokeWidth={3} /> Resume
            </button>
            <button
              type="button"
              onClick={onHome}
              className="text-ink-soft hover:text-ink flex items-center gap-1.5 text-sm font-bold underline underline-offset-4"
            >
              <LogOut className="size-4" strokeWidth={2.5} /> Quit to menu
            </button>
          </div>
        </div>
      )}

      {game.phase === "over" && (
        <WinnerOverlay
          players={game.players}
          winner={game.winner}
          eliminated={game.eliminated}
          winnerTimeMs={game.winner === null ? 0 : times[game.winner]}
          totalAnswers={game.feed.length}
          onPlayAgain={onPlayAgain}
          onHome={onHome}
          loading={rematchLoading}
          error={rematchError}
        />
      )}
    </div>
  );
}
