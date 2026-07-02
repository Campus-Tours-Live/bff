import { jest } from "@jest/globals";
import { CoreClient } from "@/api/_shared/core-client.js";
import { CoreAuthError } from "@/api/_shared/errors.js";

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
    global.fetch = jest.fn();
  });

  it("calls fetch with the base URL + path and the right headers", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(200, { data: { ok: true } }));
    const client = new CoreClient("tok-123");

    await client.get("/some/path");

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(`${BASE}/some/path`, {
      headers: { Authorization: "Bearer tok-123", Accept: "application/json" },
    });
  });

  it("unwraps the Core { data } envelope and returns body.data", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(200, { data: { name: "Alice" } }));
    const result = await new CoreClient("t").get<{ name: string }>("/userinfo");
    expect(result).toEqual({ name: "Alice" });
  });

  it("returns the whole body when there is no data field", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(200, { name: "Bob" }));
    const result = await new CoreClient("t").get<{ name: string }>("/userinfo");
    expect(result).toEqual({ name: "Bob" });
  });

  it("returns null body (the fallback of json().catch) when JSON parsing fails", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
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
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(401, {}));
    await expect(new CoreClient("t").get("/userinfo")).rejects.toBeInstanceOf(CoreAuthError);
  });

  it("throws CoreError carrying the status on other non-ok responses (404)", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(404, {}));
    await expect(new CoreClient("t").get("/userinfo")).rejects.toMatchObject({
      name: "CoreError",
      status: 404,
    });
  });

  it("throws CoreError(500) for a 500 response", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(500, {}));
    await expect(new CoreClient("t").get("/userinfo")).rejects.toMatchObject({
      name: "CoreError",
      status: 500,
    });
  });

  it("throws CoreError(502) when fetch itself rejects (unreachable)", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(new CoreClient("t").get("/userinfo")).rejects.toMatchObject({
      name: "CoreError",
      status: 502,
    });
  });
});

describe("CoreClient convenience methods", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, { data: { ok: true } }));
  });

  it.each([
    ["getUserinfo", "/userinfo"],
    ["getGuideProfile", "/guide/profile"],
    ["getOfferings", "/guide/offerings"],
    ["getParticipantProfile", "/participant/profile"],
    ["getNextTour", "/participant/bookings/next-tour"],
    ["getUpcomingBookings", "/participant/bookings/upcoming"],
    ["getPendingActions", "/participant/bookings/pending-actions"],
  ] as const)("%s GETs %s", async (method, path) => {
    const client = new CoreClient("tok") as unknown as Record<string, () => Promise<unknown>>;
    await client[method]();
    expect(global.fetch).toHaveBeenCalledWith(`${BASE}${path}`, {
      headers: { Authorization: "Bearer tok", Accept: "application/json" },
    });
  });

  it("convenience methods unwrap data like get()", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(200, { data: { id: 7 } }));
    const result = await new CoreClient("tok").getUserinfo<{ id: number }>();
    expect(result).toEqual({ id: 7 });
  });
});
