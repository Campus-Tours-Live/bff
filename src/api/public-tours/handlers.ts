import crypto from "node:crypto";
import type { Request, Response } from "express";
import { config } from "../../config.js";
import { sendProblem } from "../../util/problem.js";

/**
 * Relay an explicitly allowed public discovery read to Core. This intentionally does not resolve
 * a BFF session or forward client cookies / Authorization headers: Core independently permits
 * only the corresponding public GET endpoints.
 */
async function relayPublicTourRead(req: Request, res: Response, corePath: string): Promise<void> {
  const queryIndex = req.originalUrl.indexOf("?");
  const query = queryIndex === -1 ? "" : req.originalUrl.slice(queryIndex);
  const requestId = res.getHeader("X-Request-Id")?.toString() ?? crypto.randomUUID();

  try {
    const upstream = await fetch(`${config.coreApiBaseUrl}${corePath}${query}`, {
      headers: {
        Accept: "application/json",
        "X-Request-Id": requestId,
      },
    });

    const body = await upstream.text();
    res.status(upstream.status);
    const contentType = upstream.headers.get("content-type");
    if (contentType) res.type(contentType);
    res.send(body);
  } catch {
    sendProblem(res, 502, "Upstream service unavailable", { code: "CORE_UNAVAILABLE" });
  }
}

/** Public `GET /v1/tours`, including its discovery filters. */
export async function getPublicTourCatalog(req: Request, res: Response): Promise<void> {
  await relayPublicTourRead(req, res, "/tours");
}

/** Public `GET /v1/tours/:tourId`; the encoded segment prevents path injection. */
export async function getPublicTourDetail(req: Request, res: Response): Promise<void> {
  await relayPublicTourRead(req, res, `/tours/${encodeURIComponent(req.params.tourId ?? "")}`);
}
