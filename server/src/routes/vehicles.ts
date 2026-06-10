import type { FastifyInstance } from "fastify";
import { getSnapshot } from "../ingest/vehicles.js";

export async function vehiclesPlugin(app: FastifyInstance) {
  app.get("/api/vehicles", async () => getSnapshot());
}
