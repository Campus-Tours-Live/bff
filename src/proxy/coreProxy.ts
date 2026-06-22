import crypto from "node:crypto";
import type { Request, Response } from "express";
import { config } from "../config.js";
import { sendProblem } from "../util/problem.js";
import { requireReauth, resolveBearer } from "../api/_shared/index.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence-in-depth (on top of the SameSite=Lax cookie): for state-changing
 * methods, reject when the Origin (or, failing that, Referer) is a different
 * site from the web app. Requests with no Origin/Referer are allowed (typical
 * same-origin fetches) — the SameSite cookie still guards those.
 */
function isCrossSiteMutation(req: Request): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return false;
  const origin = req.header("origin");
  if (origin) return origin !== config.webOrigin;
  const referer = req.header("referer");
  if (referer) {
    try {
      return new URL(referer).origin !== config.webOrigin;
    } catch {
      return true;
    }
  }
  return false;
}

/**
 * Proxy /v1/* to the Core API. The BFF strips the /v1 prefix (Core owns the bare
 * resource paths), attaches the Bearer token, a correlation id, and an
 * Idempotency-Key for mutations, and normalises transport errors to problem+json.
 */
export async function coreProxy(req: Request, res: Response): Promise<void> {
  if (isCrossSiteMutation(req)) {
    sendProblem(res, 403, "Cross-site request blocked", { code: "CSRF_BLOCKED" });
    return;
  }

  const bearer = await resolveBearer(req, res);
  if (!bearer) {
    // No session / silent refresh failed → genuine re-auth required.
    requireReauth(res);
    return;
  }

  // /v1/participant/profile -> {core}/participant/profile
  const corePath = req.originalUrl.replace(/^\/v1/, "");
  const target = `${config.coreApiBaseUrl}${corePath}`;
  const requestId = res.getHeader("X-Request-Id")?.toString() ?? crypto.randomUUID();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${bearer}`,
    "X-Request-Id": requestId,
    Accept: "application/json",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    headers["Content-Type"] = "application/json";
    // Idempotency-Key: forward the client's, else generate one — lets the Core dedupe a
    // retried mutation (the BFF itself does not retry).
    headers["Idempotency-Key"] = (req.header("Idempotency-Key") as string) ?? crypto.randomUUID();
  }

  const hasBody =
    req.method !== "GET" && req.method !== "HEAD" && req.body && Object.keys(req.body).length > 0;

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? JSON.stringify(req.body) : undefined,
    });

    // Core rejected the token (expired/invalid/revoked) → re-auth required.
    // (403 from Core = authorization failure; leave it to pass through.)
    if (upstream.status === 401) {
      requireReauth(res);
      return;
    }

    const text = await upstream.text();
    res.status(upstream.status);
    const contentType = upstream.headers.get("content-type");
    if (contentType) res.type(contentType);
    res.send(text);
  } catch {
    sendProblem(res, 502, "Upstream service unavailable", { code: "CORE_UNAVAILABLE" });
  }
}
