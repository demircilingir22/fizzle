import { handleRoomRequest, reportTimeout } from "@/lib/rooms";

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handleRoomRequest(request, (playerId) => reportTimeout(code, playerId));
}
