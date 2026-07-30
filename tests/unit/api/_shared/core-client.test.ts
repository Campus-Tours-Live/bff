import { jest } from "@jest/globals";
import { CoreClient } from "@/api/_shared/core-client.js";
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- CoreError kept for readability/parity with error-shape assertions below
import { CoreAuthError, CoreError } from "@/api/_shared/errors.js";

const BASE = "http://core.test"; // CORE_API_BASE_URL from tests/setup.ts

// Preserve the real fetch and restore it after this suite so the `global.fetch`
// stub never leaks into other test files in the same worker.
const originalFetch = global.fetch;
afterAll(() => {
  global.fetch = originalFetch;
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

describe("CoreClient.get", () => {
  beforeEach(() => {
    global.fetch = jest.fn<typeof fetch>();
  });

  it("calls fetch with the base URL + path and the right headers", async () => {
    (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue(
      jsonResponse(200, { data: { ok: true } }),
    );
    const client = new CoreClient("tok-123");

    await client.get("/some/path");

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(`${BASE}/some/path`, {
      headers: { Authorization: "Bearer tok-123", Accept: "application/json" },
    });
  });

  it("unwraps the Core { data } envelope and returns body.data", async () => {
    (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue(
      jsonResponse(200, { data: { name: "Alice" } }),
    );
    const result = await new CoreClient("t").get<{ name: string }>("/userinfo");
    expect(result).toEqual({ name: "Alice" });
  });

  it("returns the whole body when there is no data field", async () => {
    (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue(jsonResponse(200, { name: "Bob" }));
    const result = await new CoreClient("t").get<{ name: string }>("/userinfo");
    expect(result).toEqual({ name: "Bob" });
  });

  it("returns null (not the envelope) when the Core envelope's data is null", async () => {
    (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue(jsonResponse(200, { data: null }));
    const result = await new CoreClient("t").get("/bookings/next-tour");
    expect(result).toBeNull();
  });

  it("returns null body (the fallback of json().catch) when JSON parsing fails", async () => {
    (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response);
    const result = await new CoreClient("t").get("/userinfo");
    expect(result).toBeNull();
  });

  it("throws CoreAuthError on a 401", async () => {
    (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue(jsonResponse(401, {}));
    await expect(new CoreClient("t").get("/userinfo")).rejects.toBeInstanceOf(CoreAuthError);
  });

  it("throws CoreError carrying the status, body, and content-type on other non-ok responses (404)", async () => {
    global.fetch = (async () =>
      ({
        ok: false,
        status: 404,
        headers: new Headers({ "content-type": "application/problem+json" }),
        text: async () => '{"message":"No such guide"}',
      }) as Response) as unknown as typeof fetch;
    // The read error path now captures the raw body + content-type (CTL-56 B3) so a
    // `withMutation`-wrapped read can relay Core's 4xx message verbatim.
    await expect(new CoreClient("t").get("/userinfo")).rejects.toMatchObject({
      name: "CoreError",
      status: 404,
      body: '{"message":"No such guide"}',
      contentType: "application/problem+json",
    });
  });

  it("throws CoreError(500) for a 500 response", async () => {
    global.fetch = (async () =>
      ({
        ok: false,
        status: 500,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () => "",
      }) as Response) as unknown as typeof fetch;
    await expect(new CoreClient("t").get("/userinfo")).rejects.toMatchObject({
      name: "CoreError",
      status: 500,
    });
  });

  it("throws CoreError(502) when fetch itself rejects (unreachable)", async () => {
    (global.fetch as jest.Mock<typeof fetch>).mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(new CoreClient("t").get("/userinfo")).rejects.toMatchObject({
      name: "CoreError",
      status: 502,
    });
  });

  it("read 4xx: falls back to an empty body when the response text() rejects", async () => {
    global.fetch = (async () =>
      ({
        ok: false,
        status: 400,
        headers: new Headers(),
        text: async () => {
          throw new Error("stream aborted");
        },
      }) as unknown as Response) as unknown as typeof fetch;
    await expect(new CoreClient("t").get("/userinfo")).rejects.toMatchObject({
      status: 400,
      body: "",
    });
  });

  it("throws CoreError with contentType undefined when a read 4xx has no content-type header", async () => {
    global.fetch = (async () =>
      ({
        ok: false,
        status: 400,
        headers: new Headers(),
        text: async () => "bad request",
      }) as Response) as unknown as typeof fetch;
    await expect(new CoreClient("t").get("/userinfo")).rejects.toMatchObject({
      name: "CoreError",
      status: 400,
      body: "bad request",
      contentType: undefined,
    });
  });
});

describe("CoreClient convenience methods", () => {
  beforeEach(() => {
    global.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200, { data: { ok: true } }));
  });

  it.each([
    ["getUserinfo", "/userinfo"],
    ["getGuideProfile", "/guide/profile"],
    ["getOfferings", "/guide/offerings"],
    ["getGuideEarnings", "/guide/earnings"],
    ["getParticipantProfile", "/participant/profile"],
    ["getNextTour", "/bookings/next-tour"],
    ["getUpcomingBookings", "/bookings/upcoming"],
    ["getPendingActions", "/bookings/pending-actions"],
  ] as const)("%s GETs %s", async (method, path) => {
    const client = new CoreClient("tok") as unknown as Record<string, () => Promise<unknown>>;
    await client[method]();
    expect(global.fetch).toHaveBeenCalledWith(`${BASE}${path}`, {
      headers: { Authorization: "Bearer tok", Accept: "application/json" },
    });
  });

  it("convenience methods unwrap data like get()", async () => {
    (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue(
      jsonResponse(200, { data: { id: 7 } }),
    );
    const result = await new CoreClient("tok").getUserinfo<{ id: number }>();
    expect(result).toEqual({ id: 7 });
  });
});

describe("CoreClient.post/del", () => {
  function mockFetch(res: Partial<Response> & { _capture?: (i: RequestInit) => void }) {
    global.fetch = (async (_url: string, init: RequestInit) => {
      res._capture?.(init);
      return res as Response;
    }) as unknown as typeof fetch;
  }
  const ok = (data: unknown, capture?: (i: RequestInit) => void) =>
    ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data }),
      _capture: capture,
    }) as never;

  it("unwraps {data} and forwards Idempotency-Key + X-Request-Id", async () => {
    let seen: RequestInit | undefined;
    mockFetch(ok({ id: "b1" }, (i) => (seen = i)));
    const out = await new CoreClient("tok").post<{ id: string }>(
      "/bookings",
      { a: 1 },
      {
        idempotencyKey: "idem-1",
        correlationId: "corr-1",
      },
    );
    expect(out).toEqual({ id: "b1" });
    const h = seen!.headers as Record<string, string>;
    expect(h["Authorization"]).toBe("Bearer tok");
    expect(h["Idempotency-Key"]).toBe("idem-1");
    expect(h["X-Request-Id"]).toBe("corr-1");
    expect(seen!.method).toBe("POST");
    expect(seen!.body).toBe(JSON.stringify({ a: 1 }));
  });

  it("throws CoreError with the body on a 4xx", async () => {
    global.fetch = (async () =>
      ({
        ok: false,
        status: 422,
        headers: new Headers({ "content-type": "application/problem+json" }),
        text: async () => '{"title":"That time slot was just taken"}',
      }) as Response) as unknown as typeof fetch;
    await expect(new CoreClient("t").post("/bookings", {}, {})).rejects.toMatchObject({
      status: 422,
      body: '{"title":"That time slot was just taken"}',
      contentType: "application/problem+json",
    });
  });

  it("maps 401 to CoreAuthError", async () => {
    global.fetch = (async () =>
      ({ ok: false, status: 401, text: async () => "" }) as Response) as never;
    await expect(new CoreClient("t").del("/cart/items/x", {})).rejects.toBeInstanceOf(
      CoreAuthError,
    );
  });

  it("del() sends DELETE with no body and unwraps {data} like post()", async () => {
    let seen: RequestInit | undefined;
    mockFetch(ok({ removed: true }, (i) => (seen = i)));
    const out = await new CoreClient("tok").del<{ removed: boolean }>("/cart/items/x", {});
    expect(out).toEqual({ removed: true });
    expect(seen!.method).toBe("DELETE");
    expect(seen!.body).toBeUndefined();
  });

  it("omits the Idempotency-Key header when none is supplied (the BFF never mints one)", async () => {
    let seen: RequestInit | undefined;
    mockFetch(ok({ ok: true }, (i) => (seen = i)));
    await new CoreClient("t").post("/cart/checkout", {}, {});
    // A minted per-call UUID would be unique every time → the Core records a row per mutation and
    // never dedupes. No client key ⇒ no header ⇒ Core passthrough.
    expect((seen!.headers as Record<string, string>)["Idempotency-Key"]).toBeUndefined();
  });

  it("throws CoreError(502) when the write fetch itself rejects (unreachable)", async () => {
    global.fetch = (() => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch;
    await expect(new CoreClient("t").post("/bookings", {}, {})).rejects.toMatchObject({
      name: "CoreError",
      status: 502,
    });
  });

  it("throws CoreError with contentType undefined when a write 4xx has no content-type header", async () => {
    global.fetch = (async () =>
      ({
        ok: false,
        status: 404,
        headers: new Headers(),
        text: async () => "not found",
      }) as Response) as unknown as typeof fetch;
    await expect(new CoreClient("t").del("/cart/items/x", {})).rejects.toMatchObject({
      status: 404,
      body: "not found",
      contentType: undefined,
    });
  });

  it("returns null when a write succeeds with an empty body", async () => {
    global.fetch = (async () =>
      ({ ok: true, status: 200, text: async () => "" }) as Response) as unknown as typeof fetch;
    const result = await new CoreClient("t").post("/cart/checkout", {}, {});
    expect(result).toBeNull();
  });

  it("write 4xx: falls back to an empty body when the response text() rejects", async () => {
    global.fetch = (async () =>
      ({
        ok: false,
        status: 400,
        headers: new Headers(),
        text: async () => {
          throw new Error("stream aborted");
        },
      }) as unknown as Response) as unknown as typeof fetch;
    await expect(new CoreClient("t").post("/x", {}, {})).rejects.toMatchObject({
      status: 400,
      body: "",
    });
  });

  it("write success: returns null when the body text() rejects", async () => {
    global.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        text: async () => {
          throw new Error("stream aborted");
        },
      }) as unknown as Response) as unknown as typeof fetch;
    const result = await new CoreClient("t").post("/x", {}, {});
    expect(result).toBeNull();
  });
});

describe("CoreClient.postFull/patchFull/delFull", () => {
  function mockFetch(res: Partial<Response> & { _capture?: (i: RequestInit) => void }) {
    global.fetch = (async (_url: string, init: RequestInit) => {
      res._capture?.(init);
      return res as Response;
    }) as unknown as typeof fetch;
  }
  const okEnvelope = (
    data: unknown,
    affectedBookings: unknown[],
    capture?: (i: RequestInit) => void,
  ) =>
    ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data, affectedBookings }),
      _capture: capture,
    }) as never;

  it("postFull POSTs and returns the raw write envelope (data + affectedBookings), unwrapped", async () => {
    let seen: RequestInit | undefined;
    mockFetch(okEnvelope({ id: "r1" }, [{ bookingId: "b1" }], (i) => (seen = i)));
    const out = await new CoreClient("tok").postFull<{ id: string }, { bookingId: string }>(
      "/availability/rules",
      { dayOfWeek: 1 },
      {},
    );
    expect(out).toEqual({ data: { id: "r1" }, affectedBookings: [{ bookingId: "b1" }] });
    expect(seen!.method).toBe("POST");
    expect(seen!.body).toBe(JSON.stringify({ dayOfWeek: 1 }));
  });

  it("patchFull PATCHes and returns the raw write envelope", async () => {
    let seen: RequestInit | undefined;
    mockFetch(okEnvelope({ id: "r1", active: false }, [], (i) => (seen = i)));
    const out = await new CoreClient("tok").patchFull<{ id: string }, unknown>(
      "/availability/rules/r1",
      { active: false },
      {},
    );
    expect(out).toEqual({ data: { id: "r1", active: false }, affectedBookings: [] });
    expect(seen!.method).toBe("PATCH");
  });

  it("delFull DELETEs with no body and returns the raw write envelope", async () => {
    let seen: RequestInit | undefined;
    mockFetch(okEnvelope([], [{ bookingId: "b1" }], (i) => (seen = i)));
    const out = await new CoreClient("tok").delFull<unknown[], { bookingId: string }>(
      "/availability/rules/r1",
      {},
    );
    expect(out).toEqual({ data: [], affectedBookings: [{ bookingId: "b1" }] });
    expect(seen!.method).toBe("DELETE");
    expect(seen!.body).toBeUndefined();
  });
});
