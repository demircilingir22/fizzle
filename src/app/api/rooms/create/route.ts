import { handleRoomRequest, createRoom } from "@/lib/rooms";

export async function POST(request: Request) {
  return handleRoomRequest(request, (playerId, body) => createRoom(playerId, body));
}
