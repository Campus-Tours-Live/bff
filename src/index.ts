/**
 * Server entry point. `app.ts` builds the Express app (and is imported directly by
 * tests, which drive it without a port); this file is the only place that actually
 * binds a port and listens. Kept thin on purpose: just startup + a friendly
 * "port already in use" message.
 */
import { config } from "./config.js";
import { app } from "./app.js";

const server = app.listen(config.port, () => {
  console.log(`[bff] listening on http://localhost:${config.port} (auth: google)`);
});

// Turn the common EADDRINUSE crash into actionable guidance; rethrow anything else.
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `[bff] port ${config.port} is already in use.\n` +
        `      Stop the other process:  lsof -ti tcp:${config.port} | xargs kill\n` +
        `      Or run on another port:  PORT=4001 npm run dev`,
    );
    process.exit(1);
  }
  throw err;
});
