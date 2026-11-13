/** A 4-point sparkle centered on 0,0. */
const star = (r: number) => {
  const k = r * 0.32;
  return `M0 ${-r} L${k} ${-k} L${r} 0 L${k} ${k} L0 ${r} L${-k} ${k} L${-r} 0 L${-k} ${-k} Z`;
};

const TWINKLES = [
  { x: 116, y: 5, size: 3.6, delay: "0s" },
  { x: 95, y: 3, size: 2.8, delay: "0.45s" },
  { x: 115, y: 21, size: 2.4, delay: "0.9s" },
];

type BombMascotProps = {
  className?: string;
  /** Body color of the bomb. */
  color?: string;
};

/** Cute pastel bomb with a face and a sparking fuse. */
export function BombMascot({ className, color = "#cdbcf6" }: BombMascotProps) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden="true">
      <ellipse cx="58" cy="112" rx="30" ry="5" fill="#3d2c46" opacity="0.1" />

      {/* Fuse */}
      <path
        d="M86 28 C 92 14, 104 24, 105 11"
        fill="none"
        stroke="#3d2c46"
        strokeWidth="7"
        strokeLinecap="round"
      />
      {/* Dashes creep toward the bomb: the fuse is burning down. */}
      <path
        d="M86 28 C 92 14, 104 24, 105 11"
        fill="none"
        stroke="#d9a877"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray="4 3"
        className="fuse-burn"
      />

      {/* Cap */}
      <rect
        x="72"
        y="26"
        width="22"
        height="12"
        rx="4"
        transform="rotate(35 83 32)"
        fill="#8f7bd6"
        stroke="#3d2c46"
        strokeWidth="3.5"
      />

      {/* Body */}
      <circle cx="58" cy="68" r="40" fill={color} stroke="#3d2c46" strokeWidth="3.5" />
      <ellipse cx="40" cy="47" rx="11" ry="6" transform="rotate(-35 40 47)" fill="#fff" opacity="0.65" />

      {/* Face */}
      <ellipse cx="46" cy="66" rx="3.8" ry="5.2" fill="#3d2c46" />
      <ellipse cx="68" cy="66" rx="3.8" ry="5.2" fill="#3d2c46" />
      <circle cx="47.3" cy="64.2" r="1.3" fill="#fff" />
      <circle cx="69.3" cy="64.2" r="1.3" fill="#fff" />
      <ellipse cx="37" cy="77" rx="6.5" ry="3.6" fill="#ff9fb8" opacity="0.75" />
      <ellipse cx="77" cy="77" rx="6.5" ry="3.6" fill="#ff9fb8" opacity="0.75" />
      <path d="M51 77 Q57 83 63 77" fill="none" stroke="#3d2c46" strokeWidth="3" strokeLinecap="round" />

      {/* Spark */}
      <g transform="translate(105 11)">
        <g className="animate-spark" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
          <circle r="9" fill="#ffd36b" opacity="0.45" />
          <path
            d="M0 -10 L2.6 -2.6 L10 0 L2.6 2.6 L0 10 L-2.6 2.6 L-10 0 L-2.6 -2.6 Z"
            fill="#ffb347"
            stroke="#3d2c46"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <circle r="2.4" fill="#fff7c2" />
        </g>
      </g>

      {/* Twinkles thrown off by the spark */}
      {TWINKLES.map(({ x, y, size, delay }) => (
        <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
          <path
            d={star(size)}
            fill="#ffd36b"
            stroke="#3d2c46"
            strokeWidth="0.8"
            strokeLinejoin="round"
            className="twinkle"
            style={{ animationDelay: delay }}
          />
        </g>
      ))}
    </svg>
  );
}

const WORDMARK = [
  { letter: "F", color: "text-coral", tilt: "-rotate-6" },
  { letter: "i", color: "text-coral", tilt: "rotate-3 -translate-y-1" },
  { letter: "z", color: "text-coral", tilt: "-rotate-3" },
  { letter: "z", color: "text-coral", tilt: "rotate-6 translate-y-0.5" },
  { letter: "l", color: "text-lavender-deep", tilt: "-rotate-3 -translate-y-1" },
  { letter: "e", color: "text-lavender-deep", tilt: "rotate-6" },
];

/** Mascot + bouncy "Fizzle" wordmark. */
export function GameLogo() {
  return (
    <div className="flex flex-col items-center gap-1 sm:flex-row sm:gap-3">
      <BombMascot className="animate-float size-24 sm:size-28" />
      <h1 className="font-display text-7xl leading-none font-bold sm:text-8xl">
        {WORDMARK.map(({ letter, color, tilt }, i) => (
          <span key={i} className={`inline-block [text-shadow:0_4px_0_var(--color-ink)] ${color} ${tilt}`}>
            {letter}
          </span>
        ))}
      </h1>
    </div>
  );
}
