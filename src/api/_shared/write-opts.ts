import type { Request, Response } from "express";

/**
 * Header options for a Core write: forward the client's Idempotency-Key (absent → omitted, so the
 * Core passes through without deduping; the BFF never mints one — a per-request key would be unique
 * every time and defeat the Core's idempotency filter), and the canonical X-Request-Id that app.ts
 * echoes to the browser (read from `res`, NOT `req` — inbound may be absent).
 */
export function writeOpts(
  req: Request,
  res: Response,
): { idempotencyKey?: string; correlationId?: string } {
  return {
    idempotencyKey: (req.header("Idempotency-Key") as string) ?? undefined,
    correlationId: res.getHeader("X-Request-Id")?.toString(),
  };
}
