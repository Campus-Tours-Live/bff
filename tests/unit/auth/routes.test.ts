import { landingFor, safeReturnTo } from "@/auth/routes.js";

/**
 * Pure-helper unit tests for the two security/routing decisions inside the auth
 * router. `safeReturnTo` is the open-redirect defence (mirror of the web app's
 * sanitizeReturnTo); `landingFor` is the post-auth role-landing decision. Both
 * were untested at the unit level before — only exercised behaviourally — so the
 * allowlist rejections and the PARENT/PARTICIPANT branches had no direct assertion.
 */

describe("safeReturnTo (open-redirect allowlist)", () => {
  it("falls back to /dashboard for empty / undefined", () => {
    expect(safeReturnTo(undefined)).toBe("/dashboard");
    expect(safeReturnTo("")).toBe("/dashboard");
  });

  it.each([
    ["absolute URL", "https://evil.example/x"],
    ["scheme-relative URL", "//evil.example"],
    ["a path that embeds a scheme", "/redirect?to=http://evil.example"],
    ["a backslash (browser-normalised to /)", "/foo\\bar"],
    ["a non-rooted value", "evil.example"],
  ])("rejects %s → /dashboard", (_label, raw) => {
    expect(safeReturnTo(raw)).toBe("/dashboard");
  });

  it.each(["/dashboard", "/profile", "/support", "/staff", "/onboarding/guide"])(
    "allows the known root %s",
    (root) => {
      expect(safeReturnTo(root)).toBe(root);
    },
  );

  it("allows sub-paths under a known root", () => {
    expect(safeReturnTo("/profile/settings")).toBe("/profile/settings");
    expect(safeReturnTo("/onboarding/participant")).toBe("/onboarding/participant");
  });

  it("rejects a value that only PREFIX-matches a root (boundary)", () => {
    // "/dashboardX" is neither the root nor under "/dashboard/".
    expect(safeReturnTo("/dashboardX")).toBe("/dashboard");
    expect(safeReturnTo("/staffroom")).toBe("/dashboard");
  });

  it("rejects an unknown root", () => {
    expect(safeReturnTo("/secret")).toBe("/dashboard");
  });

  it("preserves the query/hash when the pathname is allowed", () => {
    expect(safeReturnTo("/onboarding/guide?step=2")).toBe("/onboarding/guide?step=2");
    expect(safeReturnTo("/profile#account")).toBe("/profile#account");
  });
});

describe("landingFor (post-auth role landing)", () => {
  describe("with a GUIDE target (returnTo under /onboarding/guide)", () => {
    const rt = "/onboarding/guide";

    it("→ /dashboard when the user already holds GUIDE (effectively a login)", () => {
      expect(landingFor(rt, ["GUIDE"], "GUIDE", null)).toBe("/dashboard");
    });

    it("→ guide onboarding when the role is lacked and acquirable", () => {
      expect(landingFor(rt, ["PARTICIPANT"], "PARTICIPANT", "STUDENT")).toBe("/onboarding/guide");
    });

    it("→ /signup/role notice when a PARENT participant tries to become a guide", () => {
      expect(landingFor(rt, ["PARTICIPANT"], "PARTICIPANT", "PARENT")).toBe(
        "/signup/role?error=parent_no_guide",
      );
    });

    it("→ guide onboarding from a bare account (no roles, no participantType)", () => {
      expect(landingFor(rt, [], null, null)).toBe("/onboarding/guide");
    });
  });

  describe("with a PARTICIPANT target (returnTo under /onboarding/participant)", () => {
    const rt = "/onboarding/participant";

    it("→ /dashboard when the user already holds PARTICIPANT", () => {
      expect(landingFor(rt, ["PARTICIPANT"], "PARTICIPANT", "STUDENT")).toBe("/dashboard");
    });

    it("→ participant onboarding when the role is lacked", () => {
      expect(landingFor(rt, [], null, null)).toBe("/onboarding/participant");
    });

    it("the PARENT guard does NOT apply to the PARTICIPANT target", () => {
      // PARENT only blocks GUIDE; becoming a participant is always fine.
      expect(landingFor(rt, [], null, "PARENT")).toBe("/onboarding/participant");
    });
  });

  describe("with no target (plain sign-in)", () => {
    it("→ /dashboard when the account holds any role", () => {
      expect(landingFor("/dashboard", ["PARTICIPANT"], "PARTICIPANT", null)).toBe("/dashboard");
      expect(landingFor("/", ["GUIDE"], "GUIDE", null)).toBe("/dashboard");
    });

    it("→ /signup/role notice when the account holds no role yet", () => {
      expect(landingFor("/dashboard", [], null, null)).toBe("/signup/role?error=complete_signup");
    });
  });
});
