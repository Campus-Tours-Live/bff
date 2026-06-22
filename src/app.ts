import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { config } from "./config.js";
import { authRouter } from "./auth/routes.js";
import { apiRouter } from "./api/index.js";
import { coreProxy } from "./proxy/coreProxy.js";
import { sendProblem } from "./util/problem.js";

/**
 * The Express application — built here and exported so tests (supertest) can
 * exercise it without binding a port. `index.ts` imports this and listens.
 */
export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

// --- Correlation id on every request/response ---
app.use((req: Request, res: Response, next: NextFunction) => {
  const id = req.header("X-Request-Id") ?? crypto.randomUUID();
  res.setHeader("X-Request-Id", id);
  next();
});

// --- CORS (only needed when the web app calls the BFF cross-origin; when the
//     Next.js rewrite proxies same-origin this is a harmless no-op). ---
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.header("Origin");
  if (origin && origin === config.webOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key, X-Request-Id");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "1mb" }));

// --- Health ---
app.get("/health", (_req, res) => {
  res.json({ status: "ok", auth: "google" });
});

// --- Auth (Google sign-in session lifecycle) ---
app.use("/auth", authRouter);

// --- BFF API: own aggregation endpoints first (front-end-shaped composites),
//     then proxy everything else under /v1/* to the Core API. ---
app.use("/v1", apiRouter);
app.use("/v1", coreProxy);

// --- 404 + error handler (problem+json) ---
app.use((_req, res) => sendProblem(res, 404, "Not found", { code: "NOT_FOUND" }));
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  // Express forwards Error instances to this handler; the non-Error arm is defensive (unreachable here).
  /* istanbul ignore next */
  const detail = err instanceof Error ? err.message : undefined;
  sendProblem(res, 500, "Internal server error", { code: "INTERNAL", detail });
});
