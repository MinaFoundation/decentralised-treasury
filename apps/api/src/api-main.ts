import { main } from "./app-api.js";

main().catch((error) => {
  console.error("[app-api] startup failed", error);
  process.exit(1);
});
