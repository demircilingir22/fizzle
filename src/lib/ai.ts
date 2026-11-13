import OpenAI from "openai";

/**
 * Shared AI client for Fizzle. Server-only: import this from route
 * handlers (src/app/api/**), never from client components.
 *
 * All config comes from .env.local — model names are never hardcoded.
 */

export class AiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiConfigError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || value === "PASTE_KEY_HERE") {
    throw new AiConfigError(`Missing environment variable ${name} (set it in .env.local)`);
  }
  return value;
}

let client: OpenAI | null = null;

export function getAiClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: requireEnv("GROQ_API_KEY"),
      baseURL: requireEnv("AI_BASE_URL"),
    });
  }
  return client;
}

export const getTopicModel = () => requireEnv("AI_TOPIC_MODEL");
export const getRefereeModel = () => requireEnv("AI_REFEREE_MODEL");

/** Referee calls must use this temperature (see CLAUDE.md). */
export const REFEREE_TEMPERATURE = 0.1;

type ChatJsonOptions = {
  model: string;
  system: string;
  user: string;
  temperature: number;
  maxTokens?: number;
};

/**
 * Runs a chat completion in JSON mode and returns the parsed object.
 * Retries once if the model returns something that isn't a JSON object.
 * Callers must still validate the shape of the result.
 */
export async function chatJson({
  model,
  system,
  user,
  temperature,
  maxTokens = 1024,
}: ChatJsonOptions): Promise<Record<string, unknown>> {
  const ai = getAiClient();
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    let completion: OpenAI.Chat.Completions.ChatCompletion;
    try {
      completion = await ai.chat.completions.create({
        model,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
    } catch (err) {
      // Groq reports malformed JSON-mode output as a 400 (code json_validate_failed); retry those.
      if (err instanceof OpenAI.APIError && err.status === 400 && err.code === "json_validate_failed") {
        lastError = err;
        continue;
      }
      throw err;
    }

    const content = completion.choices[0]?.message?.content ?? "";
    try {
      const parsed: unknown = JSON.parse(content);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      lastError = new Error("Model returned JSON that is not an object");
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(`AI returned invalid JSON: ${String(lastError)}`);
}

/** A player-facing message for an AI failure (used by the online room routes). */
export function aiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof AiConfigError) return err.message;
  if (err instanceof OpenAI.APIError) {
    console.error("[ai] provider error", err.status, err.message);
    return err.status === 429 ? "AI rate limit reached, try again shortly." : fallback;
  }
  console.error("[ai]", err);
  return fallback;
}

/** Maps errors from AI routes to a JSON error response. */
export function aiErrorResponse(err: unknown): Response {
  if (err instanceof AiConfigError) {
    return Response.json({ error: err.message }, { status: 500 });
  }
  if (err instanceof OpenAI.APIError) {
    console.error("[ai] provider error", err.status, err.message);
    const status = err.status === 429 ? 429 : 502;
    return Response.json(
      { error: status === 429 ? "AI rate limit reached, try again shortly" : "AI provider error" },
      { status },
    );
  }
  console.error("[ai]", err);
  return Response.json({ error: "AI request failed" }, { status: 502 });
}

/** Reads a JSON request body, returning null if it isn't a JSON object. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// Lives in its own module so client components can use it without pulling in the OpenAI SDK.
export { toCanonicalId } from "./canonical";
