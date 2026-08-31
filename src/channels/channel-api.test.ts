import { afterEach, describe, expect, it, vi } from "vitest";
import { clearInviteToken, invitationMessage, invitationUrl, readInviteToken } from "./channel-api";

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

describe("channel invitation copy", () => {
  it("creates a two-line Chinese invitation with the inviter and Film Fam name", () => {
    expect(invitationMessage({
      channelName: "周末电影搭子",
      inviterUsername: "movie_fan",
      locale: "zh-CN",
      url: "https://example.com/#invite=token",
    })).toBe("@movie_fan 邀请你加入「周末电影搭子」观影小组\nhttps://example.com/#invite=token");
  });

  it("creates the matching English invitation", () => {
    expect(invitationMessage({
      channelName: "Weekend Crew",
      inviterUsername: "movie_fan",
      locale: "en-US",
      url: "https://example.com/#invite=token",
    })).toBe("@movie_fan invited you to join the “Weekend Crew” Film Fam\nhttps://example.com/#invite=token");
  });
});
