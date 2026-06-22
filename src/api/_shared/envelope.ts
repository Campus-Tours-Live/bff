import type { Response } from "express";
import { sendProblem } from "../../util/problem.js";

/** Wrap an aggregated payload in the standard { data, meta } success envelope.
 *  `meta.requestId` echoes the per-request correlation id for tracing. */
export function sendData(res: Response, data: unknown): void {
  res
    .type("application/json")
    .send(JSON.stringify({ data, meta: { requestId: res.getHeader("X-Request-Id")?.toString() } }));
}

export function coreUnavailable(res: Response): void {
  sendProblem(res, 502, "Upstream service unavailable", { code: "CORE_UNAVAILABLE" });
}
