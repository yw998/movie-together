import { describe, expect, it } from "vitest";
import { normalizeUsername, usernameError } from "./username";

describe("username", () => {
  it("normalizes public usernames without collecting personal profile data", () => {
    expect(normalizeUsername("  Movie_Friend  ")).toBe("movie_friend");
  });

  it("accepts bounded identifiers and rejects display names or unsafe characters", () => {
    expect(usernameError("film_friend_26")).toBeNull();
    expect(usernameError("ab")).not.toBeNull();
    expect(usernameError("Yuzhen Wang")).not.toBeNull();
    expect(usernameError("电影朋友")).not.toBeNull();
  });
});
