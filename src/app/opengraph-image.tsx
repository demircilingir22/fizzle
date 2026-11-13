import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cacheLife } from "next/cache";
import { ImageResponse } from "next/og";
import { SITE_HOST } from "@/lib/site";

/**
 * The link-preview card for iMessage, Discord, WhatsApp, Slack, X...
 * Prerendered at build time (1200×630 PNG).
 */

export const alt = "Fizzle: a cute pastel bomb with a lit fuse beside the Fizzle logo";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#3d2c46";
const TAGLINE = "The Pastel Bomb Naming Game";
const PITCH = "Name it before your fuse runs out!";
const CTA = `Play free at ${SITE_HOST}`;

const WORDMARK = [
  { letter: "F", color: "#ff8a73", tilt: -6, lift: 0 },
  { letter: "i", color: "#ff8a73", tilt: 3, lift: -6 },
  { letter: "z", color: "#ff8a73", tilt: -3, lift: 0 },
  { letter: "z", color: "#ff8a73", tilt: 6, lift: 3 },
  { letter: "l", color: "#6d55c4", tilt: -3, lift: -6 },
  { letter: "e", color: "#6d55c4", tilt: 6, lift: 0 },
];

// Read at module load (as in the Next docs): file I/O inside the handler would end the prerender early.
const bombSrc = `data:image/svg+xml;base64,${(await readFile(join(process.cwd(), "src/app/icon.svg"))).toString("base64")}`;

type FontWeight = 500 | 700;

/**
 * Fredoka, subset to just the characters drawn here, as TTF (the renderer can't
 * read the woff2 that next/font uses). Cached so the image stays prerendered.
 */
async function loadFredoka(text: string): Promise<{ weight: FontWeight; data: ArrayBuffer }[]> {
  "use cache";
  cacheLife("max");
  const url = `https://fonts.googleapis.com/css2?family=Fredoka:wght@500;700&text=${encodeURIComponent(text)}`;
  // Without a browser User-Agent, Google Fonts serves TrueType.
  const css = await (await fetch(url)).text();
  const faces = [...css.matchAll(/font-weight:\s*(\d+);[\s\S]*?src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/g)];
  return Promise.all(
    faces.map(async ([, weight, src]) => {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`Font download failed (${response.status})`);
      return { weight: Number(weight) as FontWeight, data: await response.arrayBuffer() };
    }),
  );
}

export default async function OpengraphImage() {
  const glyphs = [...new Set(["Fizzle", TAGLINE, PITCH, CTA].join(""))].join("");
  // Offline builds still produce a card, just in the default font.
  const fonts = await loadFredoka(glyphs).catch((err) => {
    console.warn("[opengraph-image] Falling back to the default font:", err instanceof Error ? err.message : err);
    return [];
  });
  const fontFamily = fonts.length ? "Fredoka" : undefined;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 44,
          padding: "0 64px",
          backgroundColor: "#fff7ec",
          fontFamily,
          color: INK,
        }}
      >
        <img src={bombSrc} width={370} height={370} alt="" style={{ transform: "rotate(-8deg)" }} />

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <div style={{ display: "flex", fontSize: 196, fontWeight: 700, lineHeight: 1, marginBottom: 18 }}>
            {WORDMARK.map(({ letter, color, tilt, lift }, i) => (
              <span
                key={i}
                style={{
                  color,
                  transform: `translateY(${lift}px) rotate(${tilt}deg)`,
                  textShadow: `0 10px 0 ${INK}`,
                }}
              >
                {letter}
              </span>
            ))}
          </div>
          <div style={{ display: "flex", fontSize: 46, fontWeight: 700 }}>{TAGLINE}</div>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 500, color: "#7b6a85", marginTop: 8 }}>{PITCH}</div>
          <div
            style={{
              display: "flex",
              marginTop: 34,
              padding: "12px 30px",
              fontSize: 34,
              fontWeight: 700,
              backgroundColor: "#bfe0fa",
              border: `5px solid ${INK}`,
              borderRadius: 999,
              boxShadow: `0 7px 0 0 rgba(61, 44, 70, 0.2)`,
            }}
          >
            {CTA}
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: fonts.map(({ weight, data }) => ({ name: "Fredoka", data, weight, style: "normal" as const })) },
  );
}
