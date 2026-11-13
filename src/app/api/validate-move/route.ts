import { aiErrorResponse, readJsonBody } from "@/lib/ai";
import { MAX_USED_IDS, judgeMove, type ValidateMoveResponse } from "@/lib/referee";

export type { ValidateMoveResponse } from "@/lib/referee";

export async function POST(request: Request) {
  const body = await readJsonBody(request);
  const genre = typeof body?.genre === "string" ? body.genre.trim() : "";
  const category = typeof body?.category === "string" ? body.category.trim() : "";
  const submission = typeof body?.submission === "string" ? body.submission.trim() : "";
  const rawUsed = body?.usedCanonicalIds;

  if (!genre || genre.length > 100 || !category || category.length > 200) {
    return Response.json({ error: "genre and category must be non-empty strings" }, { status: 400 });
  }
  if (!submission || submission.length > 120) {
    return Response.json({ error: "submission must be a non-empty string (max 120 chars)" }, { status: 400 });
  }
  if (
    !Array.isArray(rawUsed) ||
    rawUsed.length > MAX_USED_IDS ||
    !rawUsed.every((id) => typeof id === "string")
  ) {
    return Response.json({ error: "usedCanonicalIds must be an array of strings" }, { status: 400 });
  }

  try {
    const verdict = await judgeMove({ genre, category, submission, usedCanonicalIds: rawUsed as string[] });
    if (!verdict) {
      return Response.json({ error: "AI returned an incomplete verdict" }, { status: 502 });
    }
    return Response.json(verdict satisfies ValidateMoveResponse);
  } catch (err) {
    return aiErrorResponse(err);
  }
}
