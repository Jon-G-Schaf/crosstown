import { buildApp } from "./app.js";
import { runMigrations } from "./db/index.js";

try {
  process.loadEnvFile("../.env");
} catch {
  // no .env file; rely on real env vars
}

const port = Number(process.env.PORT ?? 4000);

const app = buildApp();

try {
  await runMigrations();
  await app.listen({ port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
