import request from "supertest";
import { app } from "@/app.js";
import { coreOk, mintSessionCookie, mockCoreByPath } from "../../_helpers.js";

const coreBooking = {
  id: "b1",
  status: "WAITING_FOR_GUIDE",
  scheduledAt: "2026-08-01T15:00:00Z",
  offeringId: "o1",
  offeringTitle: "North Campus",
  guideName: "Maya",
  guideResponseDeadline: null,
  universityName: "NCU",
  durationMin: 60,
  priceCents: 4200,
  currency: "USD",
};

/** Core `CartItemResponse` (CTL-83): the booking shape plus the cart-only fields. */
const coreCartItem = {
  ...coreBooking,
  status: "DRAFT",
  cartStatus: "AVAILABLE",
  currentPriceCents: 4200,
};

describe("bff cart module", () => {
  let cookie: string;
  beforeEach(() => (cookie = mintSessionCookie()));

  it("GET /v1/cart reshapes each item (array)", async () => {
    mockCoreByPath({ "/cart": coreOk([coreBooking, { ...coreBooking, id: "b2" }]) });
    const res = await request(app).get("/v1/cart").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].tourTitle).toBe("North Campus");
    expect(res.body.data[1].id).toBe("b2");
  });

  it("GET /v1/cart passes cartStatus and the live currentPrice through (CTL-83)", async () => {
    mockCoreByPath({
      "/cart": coreOk([
        coreCartItem,
        { ...coreCartItem, id: "b2", cartStatus: "PRICE_CHANGED", currentPriceCents: 5000 },
      ]),
    });
    const res = await request(app).get("/v1/cart").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({
      cartStatus: "AVAILABLE",
      price: { amount: 4200, currency: "USD" },
      currentPrice: { amount: 4200, currency: "USD" },
      guideResponseDeadline: null,
    });
    expect(res.body.data[1]).toMatchObject({
      cartStatus: "PRICE_CHANGED",
      price: { amount: 4200, currency: "USD" },
      currentPrice: { amount: 5000, currency: "USD" },
    });
    expect(res.body.data[0]).not.toHaveProperty("currentPriceCents");
  });

  it("GET /v1/cart against a Core without the cart fields → 200 with null extras", async () => {
    mockCoreByPath({ "/cart": coreOk([coreBooking]) });
    const res = await request(app).get("/v1/cart").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ id: "b1", cartStatus: null, currentPrice: null });
  });

  it("GET /v1/cart with an empty cart → 200, [] (Core { data: [] } unwraps to [], not a crash)", async () => {
    mockCoreByPath({ "/cart": coreOk([]) });
    const res = await request(app).get("/v1/cart").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  // Defensive: the backend returns [] for an empty list, but a null body must not 500.
  it("GET /v1/cart with a null Core body → 200, []", async () => {
    mockCoreByPath({ "/cart": coreOk(null) });
    const res = await request(app).get("/v1/cart").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("DELETE /v1/cart/items/:id with a null Core body → 200, []", async () => {
    mockCoreByPath({ "/cart/items/b1": coreOk(null) });
    const res = await request(app).delete("/v1/cart/items/b1").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("POST /v1/cart/checkout with a null Core body → 200, []", async () => {
    mockCoreByPath({ "/cart/checkout": coreOk(null) });
    const res = await request(app).post("/v1/cart/checkout").set("Cookie", cookie).send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("POST /v1/cart/items reshapes the added item", async () => {
    mockCoreByPath({ "/cart/items": coreOk({ ...coreCartItem, id: "b3" }) });
    const res = await request(app).post("/v1/cart/items").set("Cookie", cookie).send({
      tourOfferingId: "o1",
      scheduledStartAt: "2026-08-01T15:00:00Z",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe("b3");
    expect(res.body.data.status).toBe("DRAFT");
    expect(res.body.data.cartStatus).toBe("AVAILABLE");
    expect(res.body.data.currentPrice).toEqual({ amount: 4200, currency: "USD" });
    expect(res.body.data).not.toHaveProperty("priceCents");
  });

  it("DELETE /v1/cart/items/:id returns the reshaped remaining cart", async () => {
    mockCoreByPath({
      "/cart/items/b1": coreOk([{ ...coreCartItem, id: "b2", cartStatus: "EXPIRED" }]),
    });
    const res = await request(app).delete("/v1/cart/items/b1").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      expect.objectContaining({
        id: "b2",
        price: { amount: 4200, currency: "USD" },
        cartStatus: "EXPIRED",
        currentPrice: { amount: 4200, currency: "USD" },
      }),
    ]);
  });

  it("POST /v1/cart/checkout reshapes the committed bookings (array)", async () => {
    mockCoreByPath({ "/cart/checkout": coreOk([coreBooking, { ...coreBooking, id: "b2" }]) });
    const res = await request(app).post("/v1/cart/checkout").set("Cookie", cookie).send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].price).toEqual({ amount: 4200, currency: "USD" });
    expect(res.body.data[1].id).toBe("b2");
    // Checkout returns committed bookings, not cart items — no cart-only fields.
    expect(res.body.data[0]).not.toHaveProperty("cartStatus");
  });
});
