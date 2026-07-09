import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";
import { sendProblem } from "./problem.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence-in-depth (on top of SameSite=Lax): for state-changing methods, reject when
 * the Origin (or, failing that, Referer) is a different site from the web app. No Origin/Referer
 * → allowed (typical same-origin fetch; the SameSite cookie still guards).
 */
export function isCrossSiteMutation(req: Request): boolean {
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

/** Route middleware form: block cross-site mutations with a 403 before any handler runs. */
export function csrfGuard(req: Request, res: Response, next: NextFunction): void {
  if (isCrossSiteMutation(req)) {
    sendProblem(res, 403, "Cross-site request blocked", { code: "CSRF_BLOCKED" });
    return;
  }
  next();
}
