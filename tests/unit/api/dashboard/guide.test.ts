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
    activeRole: null,
    ...over,
  } as Me;
}

describe("guideDashboard", () => {
  it("sends a guide envelope with profile, status (from the profile's applicationStatus), canPublish and offerings", async () => {
    const guide: Json = { id: "g1", displayName: "Ana", applicationStatus: "APPROVED" };
    const offerings: Json[] = [{ id: "o1" }, { id: "o2" }];
    const core = {
      getGuideProfile: jest.fn<() => Promise<unknown>>().mockResolvedValue(guide),
      getOfferings: jest.fn<() => Promise<unknown>>().mockResolvedValue(offerings),
    } as unknown as CoreClient;
    const me = makeMe();

    const res = mockRes();
    await guideDashboard(res as unknown as Response, core, me);

    expect(sentData(res)).toEqual({
      kind: "guide",
      guide,
      guideStatus: "APPROVED",
      canPublish: true,
      offerings,
      createdAt: "2025-03-15T00:00:00Z",
    });
  });

  it("canPublish is false when the profile's applicationStatus is not APPROVED", async () => {
    const core = {
      getGuideProfile: jest
        .fn<() => Promise<unknown>>()
        .mockResolvedValue({ id: "g1", applicationStatus: "PENDING_REVIEW" }),
      getOfferings: jest.fn<() => Promise<unknown>>().mockResolvedValue([]),
    } as unknown as CoreClient;

    const res = mockRes();
    await guideDashboard(res as unknown as Response, core, makeMe());

    expect(sentData(res)).toMatchObject({ canPublish: false, guideStatus: "PENDING_REVIEW" });
  });

  it("guideStatus is null when the profile has no applicationStatus", async () => {
    const core = {
      getGuideProfile: jest.fn<() => Promise<unknown>>().mockResolvedValue({ id: "g1" }),
      getOfferings: jest.fn<() => Promise<unknown>>().mockResolvedValue([]),
    } as unknown as CoreClient;

    const res = mockRes();
    await guideDashboard(res as unknown as Response, core, makeMe());

    expect(sentData(res)).toMatchObject({ canPublish: false, guideStatus: null });
  });

  it("degrades offerings to an empty array when getOfferings rejects", async () => {
    const guide: Json = { id: "g1" };
    const core = {
      getGuideProfile: jest.fn<() => Promise<unknown>>().mockResolvedValue(guide),
      getOfferings: jest.fn<() => Promise<unknown>>().mockRejectedValue(new Error("core down")),
    } as unknown as CoreClient;

    const res = mockRes();
    await guideDashboard(res as unknown as Response, core, makeMe());

    expect(sentData(res)).toMatchObject({ guide, offerings: [] });
  });
});
