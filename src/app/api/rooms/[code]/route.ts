import { handleRoomRequest, getRoom } from "@/lib/rooms";

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handleRoomRequest(request, (playerId) => getRoom(code, playerId));
}
