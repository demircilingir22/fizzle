import { aiErrorResponse, readJsonBody } from "@/lib/ai";
import {
  MAX_PREVIOUS_CATEGORIES,
  TOPIC_DIFFICULTIES,
  generateTopic,
  type GenerateTopicResponse,
  type TopicDifficulty,
} from "@/lib/topic";

export type { GenerateTopicResponse } from "@/lib/topic";

export async function POST(request: Request) {
  const body = await readJsonBody(request);
  const genre = typeof body?.genre === "string" ? body.genre.trim() : "";
  const difficulty = body?.difficulty as TopicDifficulty;
  const rawPrevious = body?.previousCategories ?? [];

  if (!genre || genre.length > 100) {
    return Response.json({ error: "genre must be a non-empty string (max 100 chars)" }, { status: 400 });
  }
  if (!TOPIC_DIFFICULTIES.includes(difficulty)) {
    return Response.json({ error: `difficulty must be one of ${TOPIC_DIFFICULTIES.join(", ")}` }, { status: 400 });
  }
  if (
    !Array.isArray(rawPrevious) ||
    rawPrevious.length > MAX_PREVIOUS_CATEGORIES ||
    !rawPrevious.every((c) => typeof c === "string" && c.length <= 100)
  ) {
    return Response.json(
      {
        error: `previousCategories must be an array of at most ${MAX_PREVIOUS_CATEGORIES} strings (max 100 chars each)`,
      },
      { status: 400 },
    );
  }

  try {
    const topic = await generateTopic({ genre, difficulty, previousCategories: rawPrevious as string[] });
    if (!topic) {
      return Response.json({ error: "AI returned an incomplete topic" }, { status: 502 });
    }
    return Response.json(topic satisfies GenerateTopicResponse);
  } catch (err) {
    return aiErrorResponse(err);
  }
}
