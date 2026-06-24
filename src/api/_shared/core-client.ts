import { config } from "../../config.js";
import { CoreAuthError, CoreError } from "./errors.js";

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
    return this.get<T>("/participant/bookings/next-tour");
  }
  getUpcomingBookings<T>(): Promise<T> {
    return this.get<T>("/participant/bookings/upcoming");
  }
  getPendingActions<T>(): Promise<T> {
    return this.get<T>("/participant/bookings/pending-actions");
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
    return (body?.data ?? body) as T;
  }
}
