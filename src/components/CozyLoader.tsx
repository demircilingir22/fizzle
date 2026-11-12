"use client";

import { useEffect, useState } from "react";
import { BombMascot } from "@/components/Logo";

const MESSAGES = [
  "Cooking up a category…",
  "Asking the referee nicely…",
  "Polishing the bombs…",
  "Trimming the fuses…",
  "Brewing some cocoa…",
];

/** Bobbing bomb with rotating cozy status lines. */
export function CozyLoader({ title, onCancel }: { title?: string; onCancel?: () => void }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % MESSAGES.length), 1800);
    return () => clearInterval(timer);
  }, []);

  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-4 text-center">
      <BombMascot className="animate-float size-28" color="#bfead5" />
      {title && <p className="font-display text-2xl font-semibold">{title}</p>}
      <p key={index} className="animate-toast-in text-ink-soft text-lg font-bold">
        {MESSAGES[index]}
      </p>
      <div className="flex gap-1.5" aria-hidden="true">
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className="bg-lavender-deep size-2.5 animate-bounce rounded-full"
            style={{ animationDelay: `${dot * 0.15}s` }}
          />
        ))}
      </div>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="text-ink-soft hover:text-ink mt-1 text-sm font-bold underline underline-offset-4"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
