@AGENTS.md

# Fizzle

Live at [fizzlegame.com](https://fizzlegame.com) (`SITE_URL` in `src/lib/site.ts`).


A 2-8 player naming duel. Players take turns naming items in a topic against chess clocks; an AI referee validates each move. Two modes: **Local** (pass-and-play on one screen) and **Online** (each player on their own screen, joined by a 4-letter room code). Turn order is Fisher-Yates shuffled (`src/lib/shuffle.ts`) at the start of every match in both modes.

## Stack

- Next.js (App Router, `src/` dir, TypeScript, Tailwind), import alias `@/*`
- `openai` SDK pointed at Groq's OpenAI-compatible API (free tier)
- `lucide-react` for icons

## Config (`.env.local`, template in `.env.example`)

| Var | Purpose |
| --- | --- |
| `GROQ_API_KEY` | API key (server-only) |
| `AI_BASE_URL` | OpenAI-compatible base URL (`https://api.groq.com/openai/v1`) |
| `AI_REFEREE_MODEL` | Model that validates moves (currently `openai/gpt-oss-120b`) |
| `AI_TOPIC_MODEL` | Model that generates topics (currently `openai/gpt-oss-120b`) |
| `UPSTASH_REDIS_REST_URL` | Optional, production: Upstash Redis REST URL for online rooms (`KV_REST_API_URL` also works) |
| `UPSTASH_REDIS_REST_TOKEN` | Optional, production: Upstash Redis REST token (`KV_REST_API_TOKEN` also works) |
| `ROOM_POLL_MS` | Optional: online poll interval during a match, 100-2000ms (default 250 in memory, 500 with Redis; idle screens poll at least every 1000ms) |

- **Never hardcode model names.** Always read them from `process.env.AI_REFEREE_MODEL` / `process.env.AI_TOPIC_MODEL`.
- AI calls run only on the server: route handlers (`src/app/api/**/route.ts`) and the server-only modules they use (`src/lib/topic.ts`, `src/lib/referee.ts`, `src/lib/rooms.ts`). Never use `NEXT_PUBLIC_` for these vars, and never expose the key to the client.

## Clocks

- Use delta-time from `performance.now()` for the dual chess clocks so they never drift: on each tick subtract `now - lastTick` from the active player's remaining time. Never decrement a fixed amount per `setInterval` tick.
- **Freeze the active player's clock while waiting for `/api/validate-move` to return.** Stop the clock when the move is submitted, then resume it (reset `lastTick`) or switch turns based on the verdict. Network latency must never cost a player time.

- Online clocks are server-authoritative (`src/lib/rooms.ts`): the server stores each player's `remainingMs` plus `turnStartedAt` (Unix ms, null whenever the clock is stopped). Clients only render `remainingMs - (serverNow - turnStartedAt)` using a clock-offset estimate (`src/lib/useRoom.ts`). On `/api/rooms/[code]/submit` the clock stops at the server receive time and restarts after the verdict, so referee time is never charged.
- Players learn about a turn handover on their next poll, so a handed-over clock (accepted answer, explosion settled, resume, forfeit) starts one poll interval in the future (`handoffGraceMs()`); `turnStartedAt` can be ahead of `serverNow`. Only a rejected answer resumes immediately, because the answerer gets the response directly.

## Online rooms

- Hybrid store in `src/lib/rooms.ts`: with the Upstash vars set, each room is a Redis hash at `fizzle:room:${code}` (`rev`, JSON `state`, `seen:<playerId>` heartbeats) with a 2-hour TTL; without them it falls back to the in-memory `globalThis.__fizzleRooms` Map, so local dev needs no setup. Room state must stay plain JSON: no Promises, class instances or functions.
- Change room state only through `updateRoom(code, now, change)`: it loads, runs `change`, and saves with a compare-and-set on `rev`, re-running `change` on conflict. `change` must be safe to re-run and free of side effects; work that has to happen after a save (background category generation) is scheduled with `after()` from `next/server`.
- No timers: every request calls `catchUp()` first, which drops stale players and applies countdown end, fuse expiry, explosion settle and the loading/referee timeouts at the exact time each was due, so concurrent requests agree. Clients poll `GET /api/rooms/[code]` at the `pollMs` each response carries (`ROOM_POLL_MS` during a match, slower on idle screens), which drives the state machine.
- Identity: each tab's secret `playerId` lives in `sessionStorage` (`src/lib/identity.ts`) and is sent as the `x-player-id` header. It is never sent to other clients; they see a public seat `id`. Status 404 = room gone, 410 = no longer a member, 403 = not allowed (host-only / not your turn).
- Shared UI: `src/components/GameParts.tsx` holds the topic panel, bomb grid, answer bar and overlays used by both `GameScreen` (local) and `OnlineGameScreen`.

## AI referee calls

Every referee call must use:

```ts
response_format: { type: "json_object" },
temperature: 0.1,
```

The prompt must ask for JSON explicitly, and the route must parse and validate the response before trusting it.
