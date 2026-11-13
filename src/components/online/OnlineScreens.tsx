"use client";

import { ArrowRight, DoorOpen, Hourglass, KeyRound, LoaderCircle, LogOut, Plus } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { BombMascot, GameLogo } from "@/components/Logo";
import { BackButton, ChoiceCard, ErrorBanner } from "@/components/ui";
import { MAX_NAME_LENGTH } from "@/lib/game";
import { ROOM_CODE_LENGTH, cleanRoomCode } from "@/lib/online";

/** Create a room or join one with a code. */
export function OnlineEntryScreen({
  onCreate,
  onJoin,
  onBack,
  notice,
}: {
  onCreate: () => void;
  onJoin: () => void;
  onBack: () => void;
  /** Why we landed back here (e.g. the room closed). */
  notice: string | null;
}) {
  return (
    <main className="animate-screen-in mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-8 px-4 py-10">
      <div className="-mb-4 w-full">
        <BackButton onClick={onBack} />
      </div>
      <div className="flex flex-col items-center gap-3 text-center">
        <GameLogo />
        <p className="text-ink-soft text-base font-semibold sm:text-lg">
          Online Multiplayer: everyone plays from their own screen.
        </p>
      </div>

      {notice && <ErrorBanner>{notice}</ErrorBanner>}

      <div className="grid w-full gap-4 sm:grid-cols-2">
        <ChoiceCard
          icon={Plus}
          title="Create Room"
          description="Pick the genre, then share a 4-letter code."
          color="bg-peach"
          onClick={onCreate}
          autoFocus
        />
        <ChoiceCard
          icon={DoorOpen}
          title="Join Room"
          description="Got a code from a friend? Hop in."
          color="bg-sky"
          onClick={onJoin}
        />
      </div>
    </main>
  );
}

/** Shared frame for the small one-question screens. */
function PromptScreen({
  onBack,
  title,
  subtitle,
  children,
}: {
  onBack: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="animate-screen-in mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="-mb-2 w-full">
        <BackButton onClick={onBack} />
      </div>
      <BombMascot className="animate-float size-24" color="#bfe0fa" />
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="font-display text-4xl font-bold sm:text-5xl">{title}</h2>
        {subtitle}
      </div>
      {children}
    </main>
  );
}

const submitButtonClass =
  "press bg-coral flex size-14 shrink-0 items-center justify-center rounded-full border-[3px] border-ink text-ink disabled:cursor-not-allowed disabled:opacity-40 sm:size-16";

/** Step A of joining: the 4-letter room code. */
export function JoinCodeScreen({
  initialCode,
  onSubmit,
  onBack,
  loading,
  error,
}: {
  /** Pre-filled code (from an invite link, or coming back from the name step). */
  initialCode?: string;
  onSubmit: (code: string) => void;
  onBack: () => void;
  loading: boolean;
  error: string | null;
}) {
  const inputId = useId();
  const [code, setCode] = useState(() => cleanRoomCode(initialCode ?? ""));
  const complete = code.length === ROOM_CODE_LENGTH;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (complete && !loading) onSubmit(code);
  }

  return (
    <PromptScreen
      onBack={onBack}
      title="Join a room"
      subtitle={<p className="text-ink-soft font-semibold">Type the 4-letter code the host shared.</p>}
    >
      <form onSubmit={handleSubmit} className="flex w-full flex-col items-center gap-4">
        <label htmlFor={inputId} className="sr-only">
          Room code
        </label>
        <div className="bg-paper focus-within:border-lavender-deep flex w-full max-w-sm items-center gap-2 rounded-full border-[3px] border-ink p-2 pl-6 shadow-[0_6px_0_0_rgb(61_44_70/0.2)] transition-colors">
          <KeyRound className="text-ink-soft size-6 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <input
            id={inputId}
            value={code}
            // No maxLength: a rejected character (e.g. "1") would otherwise eat a slot and block
            // the last letter. cleanRoomCode filters and caps the code at 4 letters itself.
            onChange={(e) => setCode(cleanRoomCode(e.target.value))}
            placeholder="ABCD"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            disabled={loading}
            className="placeholder:text-ink-soft/35 font-display min-w-0 flex-1 bg-transparent text-center text-4xl font-bold tracking-[0.35em] uppercase outline-none sm:text-5xl"
          />
          <button type="submit" disabled={!complete || loading} aria-label="Find room" className={submitButtonClass}>
            {loading ? (
              <LoaderCircle className="size-7 animate-spin" strokeWidth={3} />
            ) : (
              <ArrowRight className="size-7" strokeWidth={3} />
            )}
          </button>
        </div>
        {error && <ErrorBanner>{error}</ErrorBanner>}
      </form>
    </PromptScreen>
  );
}

/** The player's name, before creating or joining a room. */
export function NameEntryScreen({
  title,
  summary,
  submitLabel,
  onSubmit,
  onBack,
  loading,
  error,
}: {
  title: string;
  /** Room details shown under the title. */
  summary: ReactNode;
  submitLabel: string;
  onSubmit: (name: string) => void;
  onBack: () => void;
  loading: boolean;
  error: string | null;
}) {
  const inputId = useId();
  const [name, setName] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() && !loading) onSubmit(name.trim());
  }

  return (
    <PromptScreen onBack={onBack} title={title} subtitle={summary}>
      <form onSubmit={handleSubmit} className="flex w-full flex-col items-center gap-4">
        <label htmlFor={inputId} className="text-ink-soft -mb-2 block w-full pl-3 text-sm font-bold tracking-wide uppercase">
          Your name
        </label>
        <div className="bg-paper focus-within:border-lavender-deep flex w-full items-center gap-2 rounded-full border-[3px] border-ink p-2 pl-6 shadow-[0_6px_0_0_rgb(61_44_70/0.2)] transition-colors">
          <input
            id={inputId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_NAME_LENGTH}
            placeholder="e.g. Sam"
            autoComplete="nickname"
            autoFocus
            disabled={loading}
            className="placeholder:text-ink-soft/50 font-display min-w-0 flex-1 bg-transparent text-2xl font-medium outline-none sm:text-3xl"
          />
          <button type="submit" disabled={!name.trim() || loading} aria-label={submitLabel} className={submitButtonClass}>
            {loading ? (
              <LoaderCircle className="size-7 animate-spin" strokeWidth={3} />
            ) : (
              <ArrowRight className="size-7" strokeWidth={3} />
            )}
          </button>
        </div>
        {error && <ErrorBanner>{error}</ErrorBanner>}
      </form>
    </PromptScreen>
  );
}

/** Cozy holding screen (e.g. while the host picks a new genre). */
export function WaitingScreen({
  title,
  children,
  onLeave,
}: {
  title: string;
  children?: ReactNode;
  onLeave: () => void;
}) {
  return (
    <main className="animate-screen-in mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-6 px-4 py-10 text-center">
      <BombMascot className="animate-float size-28" color="#d8cbf6" />
      <p
        role="status"
        className="bg-paper font-display flex items-center gap-2 rounded-full border-[3px] border-ink px-5 py-2 text-xl font-semibold shadow-[0_5px_0_0_rgb(61_44_70/0.18)] motion-safe:animate-pulse sm:text-2xl"
      >
        <Hourglass className="size-5 shrink-0" strokeWidth={2.5} />
        {title}
      </p>
      {children}
      <button
        type="button"
        onClick={onLeave}
        className="text-ink-soft hover:text-ink flex items-center gap-1.5 text-sm font-bold underline underline-offset-4"
      >
        <LogOut className="size-4" strokeWidth={2.5} /> Leave Lobby
      </button>
    </main>
  );
}
