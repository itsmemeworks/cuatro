import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/session";
import { NotMemberError, getCirclesStore, subscribeToCircleMessages } from "@/server/circles";

// SSE over poll: chosen because chat only needs one-way, append-only
// delivery and Next 16 route handlers can return a raw ReadableStream
// without any extra infra (no websocket upgrade, works through Fly's
// http_service as-is). New messages are pushed the moment postMessage()
// writes them (in-process listener map — see server/circles.ts's header
// comment for the single-Fly-machine assumption that makes this safe
// without a real pub/sub). If that assumption stops holding, the client
// side (components/circles/circle-chat.tsx) already tolerates gaps via
// EventSource's built-in reconnect plus GET .../messages?after= to backfill.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response("unauthenticated", { status: 401 });
  const { id: circleId } = await params;

  const store = await getCirclesStore();
  try {
    // Membership check — throws NotMemberError before we open the stream.
    await store.listMessages(circleId, user.id, { limit: 1 });
  } catch (err) {
    if (err instanceof NotMemberError) return new Response("forbidden", { status: 403 });
    throw err;
  }

  const encoder = new TextEncoder();
  let unsubscribe: () => void = () => {};
  let keepAlive: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      unsubscribe = subscribeToCircleMessages(circleId, (message) => {
        controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(message)}\n\n`));
      });
      // Keeps intermediary proxies from closing an idle connection.
      keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(`: ping\n\n`));
      }, 15000);
    },
    cancel() {
      unsubscribe();
      if (keepAlive) clearInterval(keepAlive);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
