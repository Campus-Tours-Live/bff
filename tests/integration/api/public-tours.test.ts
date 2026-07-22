import { jest } from "@jest/globals";
import request from "supertest";
import { app } from "@/app.js";
import { coreErr, mockCoreByPath } from "../_helpers.js";

const tourSummary = {
  id: "8cc1d6ed-dad7-45bc-b0f1-6e1c8b177ec3",
  title: "North Campus highlights",
  slug: "north-campus-highlights",
  topic: "GENERAL_CAMPUS",
  universityId: "4cc1d6ed-dad7-45bc-b0f1-6e1c8b177ec3",
  universityName: "North Coast University",
  guideId: "6cc1d6ed-dad7-45bc-b0f1-6e1c8b177ec3",
  guideDisplayName: "Maya Chen",
  durationMin: 60,
  priceCents: 4200,
  currency: "USD",
  avgRating: 4.8,
  reviewCount: 24,
};

const coreMeta = {
  requestId: "4b9cb75a-2c07-4dd6-9f38-437d0c49f6f5",
  timestamp: "2026-07-18T21:00:00Z",
};

function coreTourOk(data: unknown): Response {
  const body = { data, meta: coreMeta };
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("public tour discovery", () => {
  it("proxies the catalog and filters without a BFF session or bearer token", async () => {
    const mock = mockCoreByPath({ "/tours": coreTourOk([tourSummary]) });

    const res = await request(app).get("/v1/tours?topic=GENERAL_CAMPUS&limit=3");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [tourSummary], meta: coreMeta });
    const [url, init] = mock.mock.calls[0]!;
    expect(String(url)).toBe("http://core.test/tours?topic=GENERAL_CAMPUS&limit=3");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers.Accept).toBe("application/json");
    expect(headers["X-Request-Id"]).toBeDefined();
  });

  it("proxies an individual tour without a BFF session or bearer token", async () => {
    const tourId = tourSummary.id;
    const tourDetail = {
      ...tourSummary,
      description: "A student-led walk through North Coast University's most popular landmarks.",
      languages: ["en-US"],
      universitySlug: "north-coast",
      universityCity: "Arcata",
      universityRegion: "CA",
      guideBio: "Computer science student and campus ambassador.",
    };
    const mock = mockCoreByPath({ [`/tours/${tourId}`]: coreTourOk(tourDetail) });

    const res = await request(app).get(`/v1/tours/${tourId}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: tourDetail, meta: coreMeta });
    const [, init] = mock.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("passes a Core discovery error through verbatim", async () => {
    const problem = {
      type: "about:blank",
      title: "Invalid sort: INVALID",
      status: 422,
    };
    mockCoreByPath({ "/tours": coreErr(422, problem) });

    const res = await request(app).get("/v1/tours?sort=INVALID");

    expect(res.status).toBe(422);
    expect(res.body).toEqual(problem);
  });

  it("returns CORE_UNAVAILABLE when Core cannot be reached", async () => {
    global.fetch = jest
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;

    const res = await request(app).get("/v1/tours");

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: "CORE_UNAVAILABLE" });
  });

  it("serves nested tour paths anonymously too (the whole /tours/* subtree is public)", async () => {
    // Anything under /tours is public discovery, not just the two documented single-segment
    // routes: the proxy forwards a deeper path like /tours/{id}/slots anonymously, with no BFF
    // session and no bearer. (Session-scoped subtrees live elsewhere — see /offerings below.)
    const mock = mockCoreByPath({ "/tours/a-tour/slots": coreTourOk([]) });

    const res = await request(app).get("/v1/tours/a-tour/slots");

    expect(res.status).toBe(200);
    const [url, init] = mock.mock.calls[0]!;
    expect(String(url)).toBe("http://core.test/tours/a-tour/slots");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("keeps participant slots and bookings session-protected", async () => {
    mockCoreByPath({});

    const slots = await request(app).get("/v1/offerings/offering-1/slots");
    const booking = await request(app).post("/v1/bookings").send({ offeringId: "offering-1" });

    expect(slots.status).toBe(401);
    expect(slots.headers["auth-required"]).toBe("reauthenticate");
    expect(booking.status).toBe(401);
    expect(booking.headers["auth-required"]).toBe("reauthenticate");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
