import { jest } from "@jest/globals";
import request from "supertest";
import { app } from "@/app.js";
import { coreErr, coreOk, mockCoreByPath } from "../_helpers.js";

describe("public tour discovery", () => {
  it("proxies the catalog and filters without a BFF session or bearer token", async () => {
    const mock = mockCoreByPath({ "/tours": coreOk([{ id: "tour-1" }]) });

    const res = await request(app).get("/v1/tours?topic=GENERAL_CAMPUS&limit=3");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [{ id: "tour-1" }] });
    const [url, init] = mock.mock.calls[0]!;
    expect(String(url)).toBe("http://core.test/tours?topic=GENERAL_CAMPUS&limit=3");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers.Accept).toBe("application/json");
    expect(headers["X-Request-Id"]).toBeDefined();
  });

  it("proxies an individual tour without a BFF session or bearer token", async () => {
    const tourId = "8cc1d6ed-dad7-45bc-b0f1-6e1c8b177ec3";
    const mock = mockCoreByPath({ [`/tours/${tourId}`]: coreOk({ id: tourId }) });

    const res = await request(app).get(`/v1/tours/${tourId}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { id: tourId } });
    const [, init] = mock.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("passes a Core discovery error through verbatim", async () => {
    mockCoreByPath({ "/tours": coreErr(422, { code: "INVALID_SORT" }) });

    const res = await request(app).get("/v1/tours?sort=INVALID");

    expect(res.status).toBe(422);
    expect(res.body).toEqual({ code: "INVALID_SORT" });
  });

  it("returns CORE_UNAVAILABLE when Core cannot be reached", async () => {
    global.fetch = jest
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;

    const res = await request(app).get("/v1/tours");

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: "CORE_UNAVAILABLE" });
  });

  it("does not make nested tour paths public", async () => {
    mockCoreByPath({});

    const res = await request(app).get("/v1/tours/not-a-tour/slots");

    expect(res.status).toBe(401);
    expect(res.headers["auth-required"]).toBe("reauthenticate");
    expect(global.fetch).not.toHaveBeenCalled();
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
