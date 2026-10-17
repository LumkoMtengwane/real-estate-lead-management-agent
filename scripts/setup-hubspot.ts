/** One-off: create the custom contact properties in HubSpot. Safe to re-run. Reads HUBSPOT_TOKEN from .env. */
import { ensureProperties } from "../src/hubspot";

ensureProperties()
  .then((created) => console.log(created.length ? `Created: ${created.join(", ")}` : "Properties already exist."))
  .catch((err) => {
    console.error("Failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
