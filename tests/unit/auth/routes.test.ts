import { landingFor, safeReturnTo } from "@/auth/routes.js";

/**
 * Pure-helper unit tests for the two security/routing decisions inside the auth
 * router. `safeReturnTo` is the open-redirect defence (mirror of the web app's
 * sanitizeReturnTo); `landingFor` is the post-auth landing decision for the
 * NO-requested-role case (CTL-97 Task 1.5-BFF2 moved the target-role/PARENT-gate
 * branches into the callback itself, since they now also mutate the session — see
 * tests/integration/auth/callback.test.ts for those).
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

  it.each(["/dashboard", "/profile", "/support", "/staff", "/onboarding/guide", "/guide"])(
    "allows the known root %s",
    (root) => {
      expect(safeReturnTo(root)).toBe(root);
    },
  );

  it("allows the /guide authenticated area and its sub-paths", () => {
    expect(safeReturnTo("/guide/availability")).toBe("/guide/availability");
    expect(safeReturnTo("/guide/tour-offerings/new")).toBe("/guide/tour-offerings/new");
  });

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

describe("landingFor (post-auth landing, no requested role)", () => {
  it("→ /dashboard when the account holds any role and returnTo is the default", () => {
    expect(landingFor("/dashboard", ["PARTICIPANT"])).toBe("/dashboard");
    // "/" is not allow-listed → normalised to the default → home, not honoured.
    expect(landingFor("/", ["GUIDE"])).toBe("/dashboard");
  });

  it("→ the returnTo when a registered user came from a specific allow-listed page", () => {
    expect(landingFor("/profile/settings", ["PARTICIPANT"])).toBe("/profile/settings");
    expect(landingFor("/guide/availability", ["GUIDE"])).toBe("/guide/availability");
  });

  it("→ the returnTo even with multiple held roles (role selection is client-side on activeRole=null)", () => {
    expect(landingFor("/profile/settings", ["GUIDE", "PARTICIPANT"])).toBe("/profile/settings");
    expect(landingFor("/dashboard", ["GUIDE", "PARTICIPANT"])).toBe("/dashboard");
  });

  it("does NOT honour an unsafe returnTo for a registered user (open-redirect guard)", () => {
    expect(landingFor("//evil.com", ["GUIDE"])).toBe("/dashboard");
    expect(landingFor("/secret", ["GUIDE"])).toBe("/dashboard");
  });

  it("→ /signup/role notice when the account holds no role yet", () => {
    expect(landingFor("/dashboard", [])).toBe("/signup/role?error=complete_signup");
  });
});
