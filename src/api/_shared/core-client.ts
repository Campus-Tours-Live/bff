import crypto from "node:crypto";
import { config } from "../../config.js";
import { CoreAuthError, CoreError } from "./errors.js";

export interface WriteOpts {
  idempotencyKey?: string;
  correlationId?: string;
}

/**
 * Client for the one downstream the BFF talks to — the Core API. Holds the forward
 * Bearer so handlers don't thread it through every call, and unwraps the Core's
 * `{ data }` envelope. Failures THROW (CoreAuthError on 401, CoreError otherwise) so
 * the handler stays branch-free and `withSession` maps errors in one place;
 * best-effort reads opt out with `.catch(() => fallback)`.
 */
export class CoreClient {
  constructor(private readonly bearer: string) {}

  getUserinfo<T>(): Promise<T> {
    return this.get<T>("/userinfo");
  }
  getGuideProfile<T>(): Promise<T> {
    return this.get<T>("/guide/profile");
  }
  getOfferings<T>(): Promise<T> {
    return this.get<T>("/guide/offerings");
  }
  getParticipantProfile<T>(): Promise<T> {
    return this.get<T>("/participant/profile");
  }
  getNextTour<T>(): Promise<T> {
    return this.get<T>("/bookings/next-tour");
  }
  getUpcomingBookings<T>(): Promise<T> {
    return this.get<T>("/bookings/upcoming");
  }
  getPendingActions<T>(): Promise<T> {
    return this.get<T>("/bookings/pending-actions");
  }

  /**
   * Unwrap Core's `{ data }` envelope — return `data` whenever the body IS enveloped, even
   * when `data` is legitimately `null` (e.g. "no next tour"). A plain `body?.data ?? body`
   * wrongly returns the WHOLE envelope for null data, which downstream then mistakes for a
   * truthy result (and e.g. reshapes it, throwing). Falls back to the raw body only when the
   * response is not enveloped at all.
   */
  private static unwrap<T>(body: { data?: T } | null): T {
    return (body && typeof body === "object" && "data" in body ? body.data : body) as T;
  }

  async get<T>(path: string): Promise<T> {
    let r: Response;
    try {
      r = await fetch(`${config.coreApiBaseUrl}${path}`, {
        headers: { Authorization: `Bearer ${this.bearer}`, Accept: "application/json" },
      });
    } catch {
      // Transport failure (Core down / DNS / connection refused) → treat as a 502 so
      // withSession maps it to "upstream unavailable".
      throw new CoreError(502);
    }
    if (r.status === 401) throw new CoreAuthError();
    if (!r.ok) throw new CoreError(r.status);
    const body = (await r.json().catch(() => null)) as { data?: T } | null;
    return CoreClient.unwrap<T>(body);
  }

  post<T>(path: string, body: unknown, opts: WriteOpts): Promise<T> {
    return this.write<T>("POST", path, body, opts);
  }

  del<T>(path: string, opts: WriteOpts): Promise<T> {
    return this.write<T>("DELETE", path, undefined, opts);
  }

  private async write<T>(
    method: "POST" | "DELETE",
    path: string,
    body: unknown,
    opts: WriteOpts,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.bearer}`,
      Accept: "application/json",
      "Idempotency-Key": opts.idempotencyKey ?? crypto.randomUUID(),
    };
    if (opts.correlationId) headers["X-Request-Id"] = opts.correlationId;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let r: Response;
    try {
      r = await fetch(`${config.coreApiBaseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new CoreError(502);
    }
    if (r.status === 401) throw new CoreAuthError();
    if (!r.ok) {
      const raw = await r.text().catch(() => "");
      throw new CoreError(r.status, raw, r.headers.get("content-type") ?? undefined);
    }
    const parsed = JSON.parse((await r.text().catch(() => "")) || "null") as { data?: T } | null;
    return CoreClient.unwrap<T>(parsed);
  }
}
