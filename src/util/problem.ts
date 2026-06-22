import type { Response } from "express";

/**
 * RFC 7807 `application/problem+json` — the single error shape the BFF normalises
 * every failure to, so the web app can handle errors uniformly. `code` is a stable
 * machine-readable string (e.g. SESSION_EXPIRED) and `requestId` echoes the
 * per-request correlation id for tracing.
 */
export interface Problem {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  code?: string;
  requestId?: string;
}

export function sendProblem(
  res: Response,
  status: number,
  title: string,
  opts: Partial<Problem> = {},
): void {
  const body: Problem = {
    type: opts.type ?? "about:blank",
    title,
    status,
    ...(opts.detail ? { detail: opts.detail } : {}),
    ...(opts.code ? { code: opts.code } : {}),
    requestId: res.getHeader("X-Request-Id")?.toString(),
  };
  res.status(status).type("application/problem+json").send(JSON.stringify(body));
}
