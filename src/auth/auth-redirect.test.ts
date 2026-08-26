import { describe, expect, it } from "vitest";
import { authRedirectUrl } from "./auth-redirect";

describe("authentication email redirects", () => {
  it("uses the configured HTTPS origin without carrying paths or query parameters", () => {
    expect(authRedirectUrl({
      configuredUrl: "https://movies.example/account?source=email",
      currentOrigin: "https://preview.example",
      production: true,
    })).toBe("https://movies.example");
  });

  it("uses the canonical production deployment when no override is configured", () => {
    expect(authRedirectUrl({ configuredUrl: "", currentOrigin: "https://preview.example", production: true }))
      .toBe("https://movie-together-nu.vercel.app");
  });

  it("permits localhost for development but rejects insecure remote origins", () => {
    expect(authRedirectUrl({ configuredUrl: "", currentOrigin: "http://localhost:5173", production: false }))
      .toBe("http://localhost:5173");
    expect(authRedirectUrl({ configuredUrl: "http://unsafe.example", currentOrigin: "http://unsafe.example", production: false }))
      .toBe("https://movie-together-nu.vercel.app");
  });
});
