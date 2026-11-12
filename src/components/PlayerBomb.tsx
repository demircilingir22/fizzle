"use client";

import { Snowflake } from "lucide-react";
import { memo, type CSSProperties } from "react";
import { bombColors, formatClock, playerColor } from "@/lib/game";

type Point = [number, number];

// Fuse geometry in the bomb's 100 × 118 viewBox. The body square starts at y = 18.
const FUSE: [Point, Point, Point, Point] = [
  [50, 11],
  [48, 2],
  [67, 14],
  [74, 3],
];

const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** The unburnt part of the fuse: the cubic split at `t` (de Casteljau), plus its tip. */
function fuseUpTo(t: number): { d: string; tip: Point } {
  const [p0, p1, p2, p3] = FUSE;
  const a = lerp(p0, p1, t);
  const b = lerp(p1, p2, t);
  const c = lerp(p2, p3, t);
  const ab = lerp(a, b, t);
  const bc = lerp(b, c, t);
  const tip = lerp(ab, bc, t);
  const f = (p: Point) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`;
  return { d: `M${f(p0)} C${f(a)}, ${f(ab)}, ${f(tip)}`, tip };
}

const FULL_FUSE = `M${FUSE[0].join(" ")} C${FUSE[1].join(" ")}, ${FUSE[2].join(" ")}, ${FUSE[3].join(" ")}`;

// Deterministic explosion particles (no Math.random so renders stay pure).
const PARTICLE_COLORS = ["#ff8a73", "#ffd36b", "#ffb08a", "#e03c4f", "#fffaf0", "#d8cbf6"];
const PARTICLES = Array.from({ length: 18 }, (_, i) => {
  const angle = (i / 18) * Math.PI * 2 + (i % 3) * 0.18;
  const distance = 62 + ((i * 37) % 30);
  return {
    "--tx": `${(Math.cos(angle) * distance).toFixed(1)}cqi`,
    "--ty": `${(Math.sin(angle) * distance).toFixed(1)}cqi`,
    "--size": `${5 + ((i * 7) % 6)}cqi`,
    "--color": PARTICLE_COLORS[i % PARTICLE_COLORS.length],
    "--delay": `${(i % 4) * 0.03}s`,
  } as CSSProperties;
});
const SMOKE = [
  { "--x": "30%", "--y": "40%", "--delay": "0.15s" },
  { "--x": "68%", "--y": "35%", "--delay": "0.25s" },
  { "--x": "50%", "--y": "60%", "--delay": "0.05s" },
].map((vars) => vars as CSSProperties);

type PlayerBombProps = {
  index: number;
  name: string;
  remainingMs: number;
  totalMs: number;
  lastAnswer: string | null;
  /** It is this player's turn. */
  active: boolean;
  /** Their clock is running right now (active, not paused, not waiting on the referee). */
  ticking: boolean;
  /** Their clock is frozen while the referee checks their answer. */
  frozen: boolean;
  eliminated: boolean;
};

export const PlayerBomb = memo(function PlayerBomb({
  index,
  name,
  remainingMs,
  totalMs,
  lastAnswer,
  active,
  ticking,
  frozen,
  eliminated,
}: PlayerBombProps) {
  const fraction = Math.max(0, Math.min(1, remainingMs / totalMs));
  const color = playerColor(index);
  const { fill, text } = eliminated ? { fill: "var(--color-ash)", text: "#fff7ec" } : bombColors(color.base, fraction);
  const fuse = fuseUpTo(fraction);
  const clock = formatClock(remainingMs);

  const motion = eliminated
    ? ""
    : ticking && remainingMs < 5_000
      ? "animate-shake-hard"
      : ticking && remainingMs < 10_000
        ? "animate-shake"
        : active && !frozen
          ? "animate-breathe"
          : "";

  return (
    <div
      role="group"
      aria-label={`${name}: ${eliminated ? "exploded" : `${clock} seconds left`}${active && !eliminated ? ", current turn" : ""}`}
      className={`relative transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
        active && !eliminated ? "z-10 scale-100" : eliminated ? "scale-[0.86] opacity-90" : "scale-[0.9] opacity-85"
      }`}
      style={{ width: "min(94cqw, calc(90cqh * 100 / 118))", aspectRatio: "100 / 118" }}
    >
      <div className={`absolute inset-0 ${motion}`}>
        {/* Cap + fuse + spark */}
        <svg viewBox="0 0 100 118" className="absolute inset-0 size-full overflow-visible" aria-hidden="true">
          {!eliminated && (
            <>
              <path d={FULL_FUSE} fill="none" stroke="#3d2c46" strokeOpacity="0.12" strokeWidth="3" strokeLinecap="round" />
              {fraction > 0 && (
                <>
                  <path d={fuse.d} fill="none" stroke="#3d2c46" strokeWidth="4.6" strokeLinecap="round" />
                  <path
                    d={fuse.d}
                    fill="none"
                    stroke="#e0b07f"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeDasharray="2.5 2"
                  />
                </>
              )}
            </>
          )}
          <rect
            x="38"
            y="9.5"
            width="24"
            height="11"
            rx="3"
            fill={eliminated ? "#3a3142" : color.deep}
            stroke="#3d2c46"
            strokeWidth="2.6"
          />
          {active && !eliminated && (
            <g transform={`translate(${fuse.tip[0]} ${fuse.tip[1]})`}>
              <g
                className={ticking ? "animate-spark" : ""}
                style={{ transformBox: "fill-box", transformOrigin: "center" }}
              >
                <circle r="6.5" fill={frozen ? "#bfe0fa" : "#ffd36b"} opacity="0.5" />
                <path
                  d="M0 -7 L1.8 -1.8 L7 0 L1.8 1.8 L0 7 L-1.8 1.8 L-7 0 L-1.8 -1.8 Z"
                  fill={frozen ? "#8ec5f0" : "#ffb347"}
                  stroke="#3d2c46"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
                <circle r="1.6" fill="#fffaf0" />
              </g>
            </g>
          )}
        </svg>

        {/* Body */}
        <div
          className={`absolute inset-x-0 bottom-0 h-[84.75%] rounded-[30%] border-[3px] border-ink transition-[background-color,color,box-shadow] duration-150 ${
            active && !eliminated
              ? "shadow-[0_0_0_5px_var(--color-cream),0_0_0_9px_var(--color-ink),0_12px_0_6px_rgb(61_44_70/0.18)]"
              : "shadow-[0_7px_0_0_rgb(61_44_70/0.16)]"
          }`}
          style={{ backgroundColor: fill, color: text, containerType: "size" }}
        >
          {/* Glossy highlight */}
          <span className="absolute top-[7%] left-[10%] h-[8%] w-[20%] -rotate-[28deg] rounded-full bg-white/45" />

          <div className="absolute inset-0 flex flex-col items-center justify-between px-[9cqi] pt-[9cqi] pb-[8cqi] text-center">
            <p
              className={`font-display w-full truncate text-[10cqi] leading-tight font-semibold ${eliminated ? "line-through opacity-70" : ""}`}
            >
              {name}
            </p>

            {eliminated ? (
              <p className="font-display text-[8cqi] font-semibold opacity-70">exploded</p>
            ) : (
              <p
                className={`font-display text-[23cqi] leading-none font-bold tabular-nums transition-opacity ${frozen ? "opacity-60" : ""}`}
              >
                {clock}
                <span className="text-[12cqi]">s</span>
              </p>
            )}

            <p
              className="max-w-full truncate rounded-full px-[4cqi] py-[1.2cqi] text-[6.5cqi] font-extrabold"
              style={{ backgroundColor: eliminated ? "rgb(255 255 255 / 0.12)" : "rgb(255 255 255 / 0.55)", color: eliminated ? undefined : "#3d2c46" }}
              title={lastAnswer ?? undefined}
            >
              {lastAnswer ?? (eliminated ? "no answers" : "no answer yet")}
            </p>
          </div>

          {/* Turn / referee sticker */}
          {active && !eliminated && (
            <span
              className={`font-display animate-pop-in absolute -top-[6%] -left-[5%] flex -rotate-[9deg] items-center gap-[1.5cqi] rounded-full border-[3px] border-ink px-[3.5cqi] py-[1cqi] text-[6.5cqi] font-bold whitespace-nowrap text-ink shadow-[0_3px_0_0_rgb(61_44_70/0.2)] ${
                frozen ? "bg-sky" : "bg-butter"
              }`}
            >
              {frozen ? (
                <>
                  <Snowflake className="size-[7cqi]" strokeWidth={3} /> Checking…
                </>
              ) : (
                "Your turn!"
              )}
            </span>
          )}

          {/* Explosion */}
          {eliminated && (
            <>
              <span className="burst-flash" />
              {SMOKE.map((style, i) => (
                <span key={`smoke-${i}`} className="burst-smoke" style={style} />
              ))}
              {PARTICLES.map((style, i) => (
                <span key={i} className="burst-particle" style={style} />
              ))}
              <span className="font-display animate-boom text-coral absolute top-1/2 left-1/2 text-[20cqi] font-bold whitespace-nowrap [text-shadow:0_0.6cqi_0_#3d2c46,0_-0.6cqi_0_#3d2c46,0.6cqi_0_0_#3d2c46,-0.6cqi_0_0_#3d2c46,0_1.8cqi_0_#3d2c46]">
                BOOM!
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
});
