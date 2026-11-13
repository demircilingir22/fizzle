"use client";

import { ArrowLeft, Gauge, Sparkles, Timer, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Small pill button for going back a screen. */
export function BackButton({ onClick, label = "Back" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press bg-paper flex items-center gap-1.5 rounded-full border-[3px] border-ink px-4 py-1.5 text-sm font-extrabold"
    >
      <ArrowLeft className="size-4" strokeWidth={3} />
      {label}
    </button>
  );
}

export function SummaryChip({
  icon,
  className,
  children,
}: {
  icon: ReactNode;
  className: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`flex max-w-full items-center gap-1.5 rounded-full border-2 border-ink/20 px-3 py-1 text-sm font-extrabold ${className}`}
    >
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Genre / difficulty / timer chips. */
export function SettingsSummary({
  genre,
  difficulty,
  seconds,
}: {
  genre: string;
  difficulty: string;
  seconds: number;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      <SummaryChip icon={<Sparkles className="size-4" strokeWidth={2.5} />} className="bg-lavender">
        {genre}
      </SummaryChip>
      <SummaryChip icon={<Gauge className="size-4" strokeWidth={2.5} />} className="bg-butter">
        {difficulty}
      </SummaryChip>
      <SummaryChip icon={<Timer className="size-4" strokeWidth={2.5} />} className="bg-peach">
        {seconds}s each
      </SummaryChip>
    </div>
  );
}

export function ErrorBanner({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div
      role="alert"
      className="animate-toast-in bg-blush flex w-full items-center gap-3 rounded-3xl border-[3px] border-crimson/40 px-4 py-3"
    >
      <TriangleAlert className="text-crimson size-6 shrink-0" strokeWidth={2.5} />
      <p className="flex-1 font-bold">{children}</p>
      {action}
    </div>
  );
}

/** Big pastel card button used on the mode and online entry screens. */
export function ChoiceCard({
  icon: Icon,
  title,
  description,
  color,
  onClick,
  autoFocus,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Tailwind background class, e.g. "bg-mint". */
  color: string;
  onClick: () => void;
  autoFocus?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      autoFocus={autoFocus}
      className={`press group flex w-full items-center gap-4 rounded-[2rem] border-[3px] border-ink p-5 text-left sm:flex-col sm:items-center sm:gap-3 sm:p-7 sm:text-center ${color}`}
    >
      <span className="bg-paper flex size-16 shrink-0 items-center justify-center rounded-[38%] border-[3px] border-ink shadow-[0_3px_0_0_rgb(61_44_70/0.2)] transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:-rotate-6 sm:size-20">
        <Icon className="size-8 sm:size-10" strokeWidth={2.5} />
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="font-display text-2xl leading-tight font-bold sm:text-3xl">{title}</span>
        <span className="text-ink/75 text-sm font-semibold sm:text-base">{description}</span>
      </span>
    </button>
  );
}
