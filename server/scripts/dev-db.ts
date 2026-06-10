// Local Postgres without Docker: runs an embedded server against ./.pgdata.
// Usage: npm run db:dev -w server (Ctrl+C to stop).
import EmbeddedPostgres from "embedded-postgres";

const pg = new EmbeddedPostgres({
  databaseDir: "./.pgdata",
  user: "postgres",
  password: "postgres",
  port: 5432,
  persistent: true,
});

const url = "postgres://postgres:postgres@localhost:5432/crosstown";

async function main() {
  const { access } = await import("node:fs/promises");
  const fresh = !(await access("./.pgdata").then(() => true).catch(() => false));

  if (fresh) {
    await pg.initialise();
  }
  await pg.start();
  if (fresh) {
    await pg.createDatabase("crosstown");
  }
  console.log(`Postgres running, DATABASE_URL=${url}`);

  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
