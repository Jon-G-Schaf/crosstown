import { buildApp } from "./app.js";
import { runMigrations, tuneTables } from "./db/index.js";
import { startTripUpdateIngest } from "./ingest/trip-updates.js";
import { startVehicleIngest } from "./ingest/vehicles.js";
import { startDiskGuard } from "./jobs/disk-guard.js";
import { startRollupJob } from "./jobs/rollup.js";

try {
  process.loadEnvFile("../.env");
} catch {
  // no .env file; rely on real env vars
}

const port = Number(process.env.PORT ?? 4000);

const app = buildApp();

try {
  await runMigrations();
  await tuneTables().catch((err) => app.log.warn({ err }, "table tuning failed"));
  await app.listen({ port, host: "0.0.0.0" });
  if (process.env.DISABLE_INGEST !== "1") {
    startVehicleIngest(app.log);
    startTripUpdateIngest(app.log);
    startRollupJob(app.log);
    startDiskGuard(app.log);
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
