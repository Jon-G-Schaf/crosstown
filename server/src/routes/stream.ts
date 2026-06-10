import type { FastifyInstance } from "fastify";
import { getSnapshot, subscribeToSnapshots, type SnapshotPayload } from "../ingest/vehicles.js";

const HEARTBEAT_MS = 25_000;

export async function streamPlugin(app: FastifyInstance) {
  app.get("/api/stream/vehicles", (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      // hijacked replies skip the cors plugin, so set this by hand
      "access-control-allow-origin": "*",
    });

    const send = (snap: SnapshotPayload) =>
      reply.raw.write(`data: ${JSON.stringify(snap)}\n\n`);

    send(getSnapshot());
    const unsubscribe = subscribeToSnapshots(send);
    const heartbeat = setInterval(() => reply.raw.write(":hb\n\n"), HEARTBEAT_MS);

    req.raw.on("close", () => {
      unsubscribe();
      clearInterval(heartbeat);
    });
  });
}
