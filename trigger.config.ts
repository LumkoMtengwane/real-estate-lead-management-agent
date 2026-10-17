import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  // Not a secret: identifies the Trigger.dev project.
  project: "proj_sxyftwpcqbgcfscanxdc",
  dirs: ["./trigger"],
  maxDuration: 300,
  retries: {
    enabledInDev: false,
    default: { maxAttempts: 3, minTimeoutInMs: 5000, maxTimeoutInMs: 60000, factor: 2, randomize: true },
  },
  runtime: "node-22",
});
