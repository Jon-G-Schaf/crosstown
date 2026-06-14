import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    // The integration tests (rollup, trip-updates, replay) all run against one
    // shared crosstown_test database, truncating tables and running migrations.
    // Run test files serially so they can't race each other on that DB.
    fileParallelism: false,
    // Never pick up compiled test copies from a local server build.
    exclude: [...configDefaults.exclude, "**/dist/**"],
  },
});
