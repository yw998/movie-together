import { afterEach, describe, expect, it, vi } from "vitest";
import { clearInviteToken, invitationUrl, readInviteToken } from "./channel-api";

describe("channel invitation fragments", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps bearer invitation tokens in the URL fragment", () => {
    const token = "a".repeat(64);
    vi.stubGlobal("window", {
      location: { hash: `#invite=${token}`, origin: "https://example.com", pathname: "/", search: "" },
      history: { replaceState: vi.fn() },
    });

    expect(readInviteToken()).toBe(token);
    expect(invitationUrl(token)).toBe(`https://example.com/#invite=${token}`);
  });

  it("removes the invite credential after acceptance", () => {
    const replaceState = vi.fn();
    vi.stubGlobal("window", {
      location: { hash: `#invite=${"b".repeat(64)}`, pathname: "/", search: "" },
      history: { replaceState },
    });

    clearInviteToken();
    expect(replaceState).toHaveBeenCalledWith(null, "", "/");
  });
});
