import { CoreClient } from "@/api/_shared/core-client.js";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { CoreError, CoreAuthError } from "@/api/_shared/errors.js";

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

describe("CoreClient.post/del", () => {
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

  it("generates an Idempotency-Key when none is supplied", async () => {
    let seen: RequestInit | undefined;
    mockFetch(ok({ ok: true }, (i) => (seen = i)));
    await new CoreClient("t").post("/cart/checkout", {}, {});
    expect((seen!.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/[0-9a-f-]{36}/);
  });
});
