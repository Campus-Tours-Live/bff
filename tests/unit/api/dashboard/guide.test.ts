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
    roles: [],
    activeRole: null,
    participantType: null,
    guideStatus: null,
    ...over,
  } as Me;
}

const STATS: Json = {
  avgRating: 4.5,
  reviewCount: 12,
  earningsThisMonthCents: 8400,
  upcomingPayoutCents: 4200,
  currency: "USD",
};

describe("guideDashboard", () => {
  it("sends a guide envelope with profile, status, canPublish, offerings, and stats", async () => {
    const guide: Json = { id: "g1", displayName: "Ana" };
    const offerings: Json[] = [{ id: "o1" }, { id: "o2" }];
    const core = {
      getGuideProfile: jest.fn<() => Promise<unknown>>().mockResolvedValue(guide),
      getOfferings: jest.fn<() => Promise<unknown>>().mockResolvedValue(offerings),
      getGuideDashboardStats: jest.fn<() => Promise<unknown>>().mockResolvedValue(STATS),
    } as unknown as CoreClient;
    const me = makeMe({ guideStatus: "APPROVED" });

    const res = mockRes();
    await guideDashboard(res as unknown as Response, core, me);

    expect(sentData(res)).toMatchObject({
      kind: "guide",
      guide,
      guideStatus: "APPROVED",
      canPublish: true,
      offerings,
      stats: STATS,
    });
  });

  it("canPublish is false when guideStatus is not APPROVED", async () => {
    const core = {
      getGuideProfile: jest.fn<() => Promise<unknown>>().mockResolvedValue({ id: "g1" }),
      getOfferings: jest.fn<() => Promise<unknown>>().mockResolvedValue([]),
      getGuideDashboardStats: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
    } as unknown as CoreClient;

    const res = mockRes();
    await guideDashboard(
      res as unknown as Response,
      core,
      makeMe({ guideStatus: "PENDING_REVIEW" }),
    );

    expect(sentData(res)).toMatchObject({ canPublish: false, guideStatus: "PENDING_REVIEW" });
  });

  it("degrades offerings to an empty array when getOfferings rejects", async () => {
    const guide: Json = { id: "g1" };
    const core = {
      getGuideProfile: jest.fn<() => Promise<unknown>>().mockResolvedValue(guide),
      getOfferings: jest.fn<() => Promise<unknown>>().mockRejectedValue(new Error("core down")),
      getGuideDashboardStats: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
    } as unknown as CoreClient;

    const res = mockRes();
    await guideDashboard(res as unknown as Response, core, makeMe());

    expect(sentData(res)).toMatchObject({ guide, offerings: [] });
  });

  it("degrades stats to null when getGuideDashboardStats rejects", async () => {
    const guide: Json = { id: "g1" };
    const core = {
      getGuideProfile: jest.fn<() => Promise<unknown>>().mockResolvedValue(guide),
      getOfferings: jest.fn<() => Promise<unknown>>().mockResolvedValue([]),
      getGuideDashboardStats: jest
        .fn<() => Promise<unknown>>()
        .mockRejectedValue(new Error("core down")),
    } as unknown as CoreClient;

    const res = mockRes();
    await guideDashboard(res as unknown as Response, core, makeMe());

    expect(sentData(res)).toMatchObject({ stats: null });
  });
});
