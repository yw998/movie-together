import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const stylesPath = new URL("./styles.css", import.meta.url);

describe("mobile schedule layout", () => {
  it("removes the desktop rail offset and prevents filters from covering showings", async () => {
    const styles = await readFile(stylesPath, "utf8");

    expect(styles).toContain(".site-shell, .personal-home .site-shell { width: 100%; margin-left: 0; }");
    expect(styles).toContain(".sticky { position: static; backdrop-filter: none; }");
    expect(styles).toContain(".cinemas { flex-wrap: nowrap;");
  });

  it("uses compact full-width showing groups and clamps descriptions", async () => {
    const styles = await readFile(stylesPath, "utf8");

    expect(styles).toContain(".cluster { margin-bottom: 28px; display: block; }");
    expect(styles).toContain(".card { grid-template-columns: 70px minmax(0, 1fr); min-height: 0; }");
    expect(styles).toContain("-webkit-line-clamp: 2");
  });
});
