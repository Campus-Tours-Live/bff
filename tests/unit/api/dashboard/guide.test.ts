import { describe, expect, it, jest } from "@jest/globals";
import type { Response } from "express";
import type { CoreClient, Json, Me } from "@/api/_shared/index.js";
import { guideDashboard } from "@/api/dashboard/guide.js";

function mockRes() {
  const res = {
    body: undefined as unknown,
    type(_t: string) {
      return res;
    },
    send(b: string) {
      res.body = b;
      return res;
    },
    getHeader(_n: string): string | undefined {
      return undefined;
    },
  };
  return res;
}

function sentData(res: { body: unknown }): unknown {
  return JSON.parse(res.body as string).data;
}

function makeMe(over: Partial<Me> = {}): Me {
  return {
    user: {
      id: "u1",
      firstName: null,
      lastName: null,
      displayName: null,
      email: null,
      accountStatus: null,
      ageBand: null,
      createdAt: "2025-03-15T00:00:00Z",
    },
    roles: [],
    ...over,
  } as Me;
}

function makeCore(over: Partial<CoreClient> = {}): CoreClient {
  return {
    getGuideProfile: jest.fn<() => Promise<unknown>>().mockResolvedValue({ id: "g1" }),
    getOfferings: jest.fn<() => Promise<unknown>>().mockResolvedValue([]),
    getGuidePendingActions: jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValue({ pendingAcceptance: 0 }),
    ...over,
  } as unknown as CoreClient;
}

describe("guideDashboard", () => {
  it("sends a guide envelope with profile, status, canPublish, offerings, and pending count", async () => {
    const guide: Json = { id: "g1", displayName: "Ana", guideStatus: "VERIFIED" };
    const offerings: Json[] = [{ id: "o1" }, { id: "o2" }];
    const core = makeCore({
      getGuideProfile: jest.fn<() => Promise<unknown>>().mockResolvedValue(guide),
      getOfferings: jest.fn<() => Promise<unknown>>().mockResolvedValue(offerings),
      getGuidePendingActions: jest
        .fn<() => Promise<unknown>>()
        .mockResolvedValue({ pendingAcceptance: 3 }),
    });
    const me = makeMe();

    const res = mockRes();
    await guideDashboard(res as unknown as Response, core, me);

    expect(sentData(res)).toEqual({
      kind: "guide",
      guide,
      guideStatus: "VERIFIED",
      canPublish: true,
      offerings,
      pendingBookingRequests: 3,
      createdAt: "2025-03-15T00:00:00Z",
    });
  });

  it("canPublish is false when the profile's guideStatus is not VERIFIED", async () => {
    const core = makeCore({
      getGuideProfile: jest
        .fn<() => Promise<unknown>>()
        .mockResolvedValue({ id: "g1", guideStatus: "PENDING" }),
    });

    const res = mockRes();
    await guideDashboard(res as unknown as Response, core, makeMe());

    expect(sentData(res)).toMatchObject({ canPublish: false, guideStatus: "PENDING" });
  });

  it("guideStatus is null when the profile has no guideStatus", async () => {
    const core = makeCore({
      getGuideProfile: jest.fn<() => Promise<unknown>>().mockResolvedValue({ id: "g1" }),
    });

    const res = mockRes();
    await guideDashboard(res as unknown as Response, core, makeMe());

    expect(sentData(res)).toMatchObject({ canPublish: false, guideStatus: null });
  });

  it("degrades offerings to an empty array when getOfferings rejects", async () => {
    const guide: Json = { id: "g1" };
    const core = makeCore({
      getGuideProfile: jest.fn<() => Promise<unknown>>().mockResolvedValue(guide),
      getOfferings: jest.fn<() => Promise<unknown>>().mockRejectedValue(new Error("core down")),
    });

    const res = mockRes();
    await guideDashboard(res as unknown as Response, core, makeMe());

    expect(sentData(res)).toMatchObject({ guide, offerings: [], pendingBookingRequests: 0 });
  });

  it("degrades pendingBookingRequests to 0 when pending-actions rejects", async () => {
    const core = makeCore({
      getGuidePendingActions: jest
        .fn<() => Promise<unknown>>()
        .mockRejectedValue(new Error("core down")),
    });

    const res = mockRes();
    await guideDashboard(res as unknown as Response, core, makeMe());

    expect(sentData(res)).toMatchObject({ pendingBookingRequests: 0 });
  });
});
