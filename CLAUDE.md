@AGENTS.md

# BlitzDuel

A 2-player local hot-seat naming duel. Two players share one screen and take turns naming items in a topic against dual chess clocks; an AI referee validates each move.

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

- **Never hardcode model names.** Always read them from `process.env.AI_REFEREE_MODEL` / `process.env.AI_TOPIC_MODEL`.
- AI calls run only in server route handlers (`src/app/api/**/route.ts`). Never use `NEXT_PUBLIC_` for these vars, and never expose the key to the client.

## Clocks

- Use delta-time from `performance.now()` for the dual chess clocks so they never drift: on each tick subtract `now - lastTick` from the active player's remaining time. Never decrement a fixed amount per `setInterval` tick.
- **Freeze the active player's clock while waiting for `/api/validate-move` to return.** Stop the clock when the move is submitted, then resume it (reset `lastTick`) or switch turns based on the verdict. Network latency must never cost a player time.

## AI referee calls

Every referee call must use:

```ts
response_format: { type: "json_object" },
temperature: 0.1,
```

The prompt must ask for JSON explicitly, and the route must parse and validate the response before trusting it.
