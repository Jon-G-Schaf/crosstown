import { buildApp } from "./app.js";
import { runMigrations } from "./db/index.js";
import { startVehicleIngest } from "./ingest/vehicles.js";

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
  if (process.env.DISABLE_INGEST !== "1") {
    startVehicleIngest(app.log);
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
