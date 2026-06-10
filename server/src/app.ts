import Fastify from "fastify";
import cors from "@fastify/cors";
import { routesPlugin } from "./routes/routes.js";
import { vehiclesPlugin } from "./routes/vehicles.js";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(cors, { origin: true });

  app.get("/healthz", async () => ({
    ok: true,
    uptime: process.uptime(),
  }));

  app.register(routesPlugin);
  app.register(vehiclesPlugin);

  return app;
}
