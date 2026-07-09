import { isCrossSiteMutation } from "@/util/csrf.js";
import { config } from "@/config.js";

const req = (method: string, headers: Record<string, string> = {}) =>
  ({ method, header: (k: string) => headers[k.toLowerCase()] }) as never;

describe("isCrossSiteMutation", () => {
  it("allows safe methods regardless of origin", () => {
    expect(isCrossSiteMutation(req("GET", { origin: "https://evil.test" }))).toBe(false);
  });
  it("blocks a mutation from a different origin", () => {
    expect(isCrossSiteMutation(req("POST", { origin: "https://evil.test" }))).toBe(true);
  });
  it("allows a mutation from the web origin", () => {
    expect(isCrossSiteMutation(req("POST", { origin: config.webOrigin }))).toBe(false);
  });
  it("allows a mutation with no Origin/Referer (same-origin fetch)", () => {
    expect(isCrossSiteMutation(req("POST"))).toBe(false);
  });
});
