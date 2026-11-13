"use client";

/**
 * Building blocks of the game screen, shared by the local (pass-and-play)
 * GameScreen and the online OnlineGameScreen so both look identical.
 */

import {
  ArrowRight,
  CircleCheck,
  CornerDownLeft,
  Dices,
  Lock,
  LoaderCircle,
  LogOut,
  Pause,
  Play,
  Snowflake,
  Sparkles,
  TriangleAlert,
  WandSparkles,
} from "lucide-react";
import { Fragment, type CSSProperties, type FormEvent, type ReactNode, type Ref } from "react";
import { PlayerBomb } from "@/components/PlayerBomb";
import { MAX_ANSWER_LENGTH, gridShape, playerColor, type FeedItem, type GamePhase, type Topic } from "@/lib/game";

/** Countdown step for the 3-2-1 before the first turn. */
export const COUNTDOWN_FROM = 3;

export type BoardPlayer = {
  name: string;
  /** Index into PLAYER_COLORS. */
  color: number;
  lastAnswer: string | null;
  eliminated: boolean;
};

export type Toast = { id: number; tone: "error" | "success" | "corrected"; text: string };

export const TOAST_MS: Record<Toast["tone"], number> = { error: 3800, success: 1600, corrected: 2600 };

/** Blur applied to the category and input while paused, so nobody gets free thinking time. */
export const pausedBlur = (paused: boolean) => (paused ? "pointer-events-none blur-[10px] select-none" : "");

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

type TopicPanelProps = {
  genre: string;
  difficulty: string;
  topic: Topic;
  feed: FeedItem[];
  players: BoardPlayer[];
  paused: boolean;
  /** Extra chips after the difficulty (e.g. the room code). */
  chips?: ReactNode;
};

export function TopicPanel({ genre, difficulty, topic, feed, players, paused, chips }: TopicPanelProps) {
  return (
    <div
      aria-hidden={paused}
      className={`bg-paper/90 min-w-0 flex-1 rounded-[1.75rem] border-[3px] border-ink/10 px-4 py-3 transition-[filter] duration-200 ${pausedBlur(paused)}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs font-extrabold">
        <span className="bg-lavender flex max-w-full items-center gap-1 rounded-full px-2.5 py-0.5">
          <Sparkles className="size-3.5 shrink-0" strokeWidth={2.5} />
          <span className="truncate">{genre}</span>
        </span>
        <span className="bg-butter rounded-full px-2.5 py-0.5">{difficulty}</span>
        {chips}
        <span className="text-ink-soft">{feed.length} named</span>
      </div>
      <h1 className="font-display mt-1 text-2xl leading-tight font-bold sm:text-3xl">{topic.category}</h1>
      <p className="text-ink-soft text-sm font-semibold sm:text-base">{topic.description}</p>
      <ul aria-label="Accepted answers" className="feed-scroll mt-2 flex gap-1.5 overflow-x-auto pb-1">
        {feed.length === 0 ? (
          <li className="text-ink-soft/70 text-sm font-bold">No answers yet. Be the first!</li>
        ) : (
          feed.map((item) => (
            <li
              key={item.canonicalId}
              className="animate-pop-in shrink-0 rounded-full border-2 border-ink/15 px-3 py-0.5 text-sm font-bold whitespace-nowrap"
              style={{ backgroundColor: playerColor(players[item.player]?.color ?? item.player).base }}
            >
              {item.displayName}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

export function PauseButton({ paused, disabled, onClick }: { paused: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={paused ? "Resume game" : "Pause game"}
      className="press bg-butter flex size-14 shrink-0 items-center justify-center rounded-full border-[3px] border-ink disabled:opacity-40 sm:size-16"
    >
      {paused ? (
        <Play className="size-7 fill-current" strokeWidth={2.5} />
      ) : (
        <Pause className="size-7 fill-current" strokeWidth={2.5} />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Bombs
// ---------------------------------------------------------------------------

type BombGridProps = {
  players: BoardPlayer[];
  times: number[];
  totalMs: number;
  active: number;
  phase: GamePhase;
  /** The active clock is running right now. */
  ticking: boolean;
  /** The active clock is frozen while the referee checks an answer. */
  frozen: boolean;
  /** Sticker text on the active bomb. */
  turnLabel?: string;
};

/** Bombs laid out in turn order, so play visibly moves left to right, top to bottom. */
export function BombGrid({ players, times, totalMs, active, phase, ticking, frozen, turnLabel }: BombGridProps) {
  const grid = gridShape(players.length);
  const gridVars = {
    "--nc": grid.narrow[0],
    "--nr": grid.narrow[1],
    "--wc": grid.wide[0],
    "--wr": grid.wide[1],
  } as CSSProperties;

  return (
    <section aria-label="Players" className={`min-h-0 flex-1 px-2 ${phase === "exploding" ? "animate-quake" : ""}`}>
      <div className="flex h-full flex-wrap justify-center" style={gridVars}>
        {players.map((player, index) => {
          const isActive = index === active && (phase === "playing" || phase === "countdown");
          return (
            <div
              key={index}
              className="flex h-[calc(100%/var(--nr))] shrink-0 basis-[calc(100%/var(--nc))] items-center justify-center md:h-[calc(100%/var(--wr))] md:basis-[calc(100%/var(--wc))]"
              style={{ containerType: "size" }}
            >
              <PlayerBomb
                color={player.color}
                name={player.name}
                remainingMs={times[index]}
                totalMs={totalMs}
                lastAnswer={player.lastAnswer}
                active={isActive}
                ticking={isActive && ticking}
                frozen={isActive && frozen}
                eliminated={player.eliminated}
                turnLabel={turnLabel}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Answer input
// ---------------------------------------------------------------------------

type AnswerBarProps = {
  paused: boolean;
  /** Shown above the input while the referee is thinking (takes priority over the toast). */
  checkingText: string | null;
  toast: Toast | null;
  /** Name chip on the left of the input, and the active border color. */
  activeName: string;
  activeColor: number;
  answer: string;
  onAnswerChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  /** This screen may type right now. */
  inputEnabled: boolean;
  /** An answer from this screen is being checked. */
  submitting: boolean;
  placeholder: string;
  /** Shows a lock instead of the name chip (online, when it's someone else's turn). */
  locked?: boolean;
  inputRef?: Ref<HTMLInputElement>;
};

export function AnswerBar({
  paused,
  checkingText,
  toast,
  activeName,
  activeColor,
  answer,
  onAnswerChange,
  onSubmit,
  inputEnabled,
  submitting,
  placeholder,
  locked = false,
  inputRef,
}: AnswerBarProps) {
  const color = playerColor(activeColor);
  return (
    <footer className={`p-3 transition-[filter] duration-200 sm:p-4 ${pausedBlur(paused)}`} aria-hidden={paused}>
      <div className="relative mx-auto max-w-3xl">
        <div
          aria-live="polite"
          className="pointer-events-none absolute inset-x-0 bottom-full mb-3 flex justify-center px-2"
        >
          {checkingText ? (
            <p className="animate-toast-in bg-sky flex max-w-full items-center gap-2 rounded-full border-[3px] border-ink px-4 py-2 font-bold shadow-[0_4px_0_0_rgb(61_44_70/0.18)]">
              <Snowflake className="size-5 shrink-0 animate-spin [animation-duration:3s]" strokeWidth={2.5} />
              <span className="min-w-0 truncate">{checkingText}</span>
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
          onSubmit={onSubmit}
          className={`flex items-center gap-2 rounded-full border-[3px] p-2 pl-3 shadow-[0_6px_0_0_rgb(61_44_70/0.2)] transition-colors sm:pl-2 ${
            locked ? "bg-cream-deep/70" : "bg-paper"
          }`}
          style={{ borderColor: inputEnabled ? color.deep : "var(--color-ink)" }}
        >
          <span
            className="font-display hidden max-w-40 shrink-0 items-center gap-1.5 truncate rounded-full border-2 border-ink/20 px-4 py-2 text-lg font-semibold sm:flex"
            style={{ backgroundColor: color.base }}
          >
            {locked && <Lock className="size-4 shrink-0" strokeWidth={3} aria-hidden="true" />}
            <span className="truncate">{activeName}</span>
          </span>
          <input
            ref={inputRef}
            value={answer}
            onChange={(e) => onAnswerChange(e.target.value)}
            disabled={!inputEnabled}
            readOnly={submitting}
            maxLength={MAX_ANSWER_LENGTH}
            placeholder={placeholder}
            aria-label={locked ? placeholder : `Answer for ${activeName}`}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="send"
            className="placeholder:text-ink-soft/55 font-display min-w-0 flex-1 bg-transparent px-2 text-xl font-medium outline-none disabled:cursor-not-allowed sm:text-2xl"
          />
          <button
            type="submit"
            disabled={!inputEnabled || submitting}
            aria-label="Submit answer"
            className="press bg-mint flex size-12 shrink-0 items-center justify-center rounded-full border-[3px] border-ink disabled:opacity-50 sm:size-14"
          >
            {submitting ? (
              <LoaderCircle className="size-6 animate-spin" strokeWidth={3} />
            ) : locked ? (
              <Lock className="size-6" strokeWidth={3} />
            ) : (
              <CornerDownLeft className="size-6" strokeWidth={3} />
            )}
          </button>
        </form>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

type CountdownOverlayProps = {
  topic: Topic;
  count: number;
  /** Players in this match's shuffled turn order; the first one goes first. */
  order: { name: string; color: number }[];
  /** Label for the first player (e.g. "You go first!"); defaults to "<name> goes first". */
  firstLabel?: string;
};

/** 3-2-1 with the category, plus a banner revealing the randomly shuffled turn order. */
export function CountdownOverlay({ topic, count, order, firstLabel }: CountdownOverlayProps) {
  const first = order[0];
  return (
    <div className="bg-cream/75 fixed inset-0 z-20 flex items-center justify-center overflow-y-auto p-4 backdrop-blur-sm">
      <div className="animate-pop-in flex max-w-lg flex-col items-center gap-3 text-center">
        <p className="text-ink-soft text-sm font-extrabold tracking-widest uppercase">Your category</p>
        <h2 className="font-display text-4xl leading-tight font-bold sm:text-5xl">{topic.category}</h2>
        <p className="text-ink-soft text-lg font-semibold">{topic.description}</p>
        <p
          key={count}
          className="animate-count font-display text-coral mt-1 text-8xl font-bold [text-shadow:0_5px_0_var(--color-ink)]"
        >
          {count}
        </p>

        {first && (
          <div className="bg-paper flex w-full flex-col items-center gap-2 rounded-[1.75rem] border-[3px] border-ink px-4 py-3 shadow-[0_5px_0_0_rgb(61_44_70/0.18)]">
            <p className="text-ink-soft flex items-center gap-1.5 text-xs font-extrabold tracking-widest uppercase">
              <Dices className="size-4" strokeWidth={2.5} /> Turn order shuffled
            </p>
            <p className="font-display text-2xl font-bold">
              {firstLabel ?? (
                <>
                  <span
                    className="animate-pop-in inline-block rounded-full border-[3px] border-ink px-3"
                    style={{ backgroundColor: playerColor(first.color).base }}
                  >
                    {first.name}
                  </span>{" "}
                  goes first!
                </>
              )}
            </p>
            {order.length > 1 && (
              <ol aria-label="Turn order" className="flex flex-wrap items-center justify-center gap-1">
                {order.map((player, i) => (
                  <Fragment key={i}>
                    {i > 0 && <ArrowRight className="text-ink-soft size-3.5" strokeWidth={3} aria-hidden="true" />}
                    <li
                      className={`max-w-32 truncate rounded-full border-2 px-2.5 py-0.5 text-sm font-bold ${
                        i === 0 ? "border-ink" : "border-ink/15"
                      }`}
                      style={{ backgroundColor: playerColor(player.color).base }}
                    >
                      {player.name}
                    </li>
                  </Fragment>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

type PauseOverlayProps = {
  subtitle: string;
  onResume: () => void;
  onQuit: () => void;
  quitLabel: string;
};

export function PauseOverlay({ subtitle, onResume, onQuit, quitLabel }: PauseOverlayProps) {
  return (
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
          <p className="text-ink-soft mt-1 font-semibold">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onResume}
          autoFocus
          className="press bg-mint font-display flex h-14 w-full items-center justify-center gap-2 rounded-full border-[3px] border-ink text-xl font-bold"
        >
          <Play className="size-5 fill-current" strokeWidth={3} /> Resume
        </button>
        <button
          type="button"
          onClick={onQuit}
          className="text-ink-soft hover:text-ink flex items-center gap-1.5 text-sm font-bold underline underline-offset-4"
        >
          <LogOut className="size-4" strokeWidth={2.5} /> {quitLabel}
        </button>
      </div>
    </div>
  );
}
