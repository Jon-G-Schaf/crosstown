import Fastify from "fastify";
import cors from "@fastify/cors";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(cors, { origin: true });

  app.get("/healthz", async () => ({
    ok: true,
    uptime: process.uptime(),
  }));

  return app;
}
