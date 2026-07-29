import crypto from "node:crypto";
import type { Request, Response } from "express";
import { config } from "../config.js";
import { clearSession } from "../session.js";
import { sendProblem } from "../util/problem.js";
import {
  requireReauth,
  authUpstreamUnavailable,
  resolveBearer,
  PendingSessionExpiredError,
  TransientAuthError,
} from "../api/_shared/index.js";
import { isCrossSiteMutation } from "../util/csrf.js";

/**
 * Public marketplace reads — the tour catalog + reference-data lookups are readable without a
 * session (Core permits these GETs anonymously). Everything else requires a bearer.
 */
/** The `/v1`-stripped request path in CANONICAL form (query removed). The WHATWG URL parser
 *  collapses any `.`/`..` segments BEFORE we use it, so a traversal like `/v1/tours/../guide/...`
 *  cannot masquerade as a path that `startsWith("/tours/")`. Used for BOTH the public-GET /
 *  cacheability classification and the upstream target, so the path we authorize is exactly the
 *  path we forward (a `?cache-buster` must not change any decision). */
function canonicalPath(req: Request): string {
  return new URL(req.originalUrl, "http://x").pathname.replace(/^\/v1/, "");
}

/** Split the raw request-target into its un-normalised path and query halves. The path half feeds
 *  the traversal guard; the query half is forwarded to Core byte-for-byte (a transparent proxy must
 *  not re-encode it — `new URL().search` would percent-encode bare `<`, `"`, … ). */
function splitRaw(req: Request): { rawPath: string; rawQuery: string } {
  const q = req.originalUrl.indexOf("?");
  return q === -1
    ? { rawPath: req.originalUrl, rawQuery: "" }
    : { rawPath: req.originalUrl.slice(0, q), rawQuery: req.originalUrl.slice(q) };
}

function isPublicGet(req: Request): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const path = canonicalPath(req);
  return path === "/tours" || path.startsWith("/tours/") || path.startsWith("/meta/");
}

/**
 * Static, single-key reference vocabularies (Phase 1B of the meta-api-call-reduction plan): public
 * and near-immutable, so their 200 responses are safe for the browser to cache by path.
 * `universities?q=` / `majors?schoolId=` are deliberately excluded (high-cardinality + mutable); a
 * query string bypasses too, since a parameterised request is not the static resource.
 */
const CACHEABLE_STATIC_META = new Set(["/meta/tour-topics", "/meta/tour-features"]);

function isCacheableStaticMeta(req: Request): boolean {
  if (req.method !== "GET") return false;
  if (req.originalUrl.includes("?")) return false;
  return CACHEABLE_STATIC_META.has(canonicalPath(req));
}

/**
 * Proxy /v1/* to the Core API. The BFF strips the /v1 prefix (Core owns the bare
 * resource paths), attaches a correlation id, and normalises transport errors to
 * problem+json. A Bearer token is attached to everything EXCEPT the public reads
 * (GET/HEAD on /tours and /meta), which forward anonymously. It forwards the
 * client's Idempotency-Key on mutations when one was sent, and never mints one --
 * see the note at the header-building step below.
 */
export async function coreProxy(req: Request, res: Response): Promise<void> {
  if (isCrossSiteMutation(req)) {
    sendProblem(res, 403, "Cross-site request blocked", { code: "CSRF_BLOCKED" });
    return;
  }

  // A `..` SEGMENT is never a legitimate Core resource; reject it outright rather than
  // canonicalising-and-serving a normalized path. Segment-aware on purpose: a slug that merely
  // *contains* dots (`/tours/foo..bar`) is a legitimate resource and must pass. Most HTTP clients
  // collapse `..` before sending (so this rarely fires), but a raw client can put it on the wire
  // verbatim. `canonicalPath` is the general defense — it also covers encoded (`%2e%2e`) and `.`.
  const { rawPath, rawQuery } = splitRaw(req);
  if (rawPath.split("/").some((segment) => segment === "..")) {
    sendProblem(res, 400, "Invalid request path", { code: "BAD_PATH" });
    return;
  }

  // Public reads forward anonymously (no session needed); everything else requires a bearer.
  const publicGet = isPublicGet(req);
  let bearer: string | null = null;
  if (!publicGet) {
    try {
      bearer = await resolveBearer(req, res);
    } catch (err) {
      // Google unreachable ≠ session dead. Keep the session and ask for a retry, so a
      // Google blip can't log the user out irrecoverably (the refresh token survives).
      if (err instanceof TransientAuthError) {
        authUpstreamUnavailable(res);
        return;
      }
      // The pending session's 24h absolute lifetime is up: destroy the cookie (expiring
      // Set-Cookie) and answer 401 SESSION_EXPIRED WITHOUT ever calling Core (CTL-97 Task 4
      // review fix — this proxy is a third `resolveBearer` call site and must enforce the
      // same guard `withSession` does).
      if (err instanceof PendingSessionExpiredError) {
        clearSession(res);
        sendProblem(res, 401, "Session expired", { code: err.code });
        return;
      }
      throw err;
    }
  }
  if (!bearer && !publicGet) {
    // No session, or the grant is genuinely dead → real re-auth required.
    requireReauth(res);
    return;
  }

  // /v1/participant/profile -> {core}/participant/profile. Canonical path (so the forwarded target
  // matches the path we just authorized) + the RAW query, forwarded verbatim.
  const target = `${config.coreApiBaseUrl}${canonicalPath(req)}${rawQuery}`;
  const requestId = res.getHeader("X-Request-Id")?.toString() ?? crypto.randomUUID();

  const headers: Record<string, string> = {
    "X-Request-Id": requestId,
    Accept: "application/json",
  };
  if (bearer) headers["Authorization"] = `Bearer ${bearer}`;
  if (req.method !== "GET" && req.method !== "HEAD") {
    headers["Content-Type"] = "application/json";
    // Idempotency-Key: forward the client's if — and only if — it sent one. The BFF must NOT mint
    // a key: a fresh UUID per request is unique every time, so the Core would record a row per
    // mutation and never dedupe, defeating its idempotency filter. Absent key → no header → Core
    // passes through (best-effort dedupe is opt-in; the Core's natural-key constraints still reject
    // a real duplicate write). The client is the source of truth for a stable retry key.
    const clientKey = req.header("Idempotency-Key");
    if (clientKey) headers["Idempotency-Key"] = clientKey as string;
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
    // Let the browser cache the static reference vocabularies (Phase 1B). Deterministically owns
    // the policy for these paths (overrides any upstream Cache-Control). Browser leg only for now —
    // s-maxage/CDN + a BFF in-memory cache are deferred until a shared cache actually exists.
    if (upstream.status === 200 && isCacheableStaticMeta(req)) {
      res.setHeader("Cache-Control", "public, max-age=300");
    }
    res.send(text);
  } catch {
    sendProblem(res, 502, "Upstream service unavailable", { code: "CORE_UNAVAILABLE" });
  }
}
