import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/weekly-schedule.yml", "utf8");

describe("hosted schedule dry run", () => {
  it("defaults manual dispatches to dry-run mode", () => {
    expect(workflow).toMatch(/dry_run:\s+[\s\S]*?default: true\s+[\s\S]*?type: boolean/);
    expect(workflow).toContain(
      "DRY_RUN: ${{ github.event_name == 'workflow_dispatch' && inputs.dry_run == true }}",
    );
  });

  it("guards every production mutation behind the non-dry-run condition", () => {
    for (const step of [
      "Apply database migrations",
      "Import approved rolling window",
      "Export today plus six days",
      "Verify rolling database round trip",
      "Commit validated rolling public data",
    ]) {
      expect(workflow).toMatch(
        new RegExp(`- name: ${step}\\s+if: \\$\\{\\{ env\\.DRY_RUN != 'true' \\}\\}`),
      );
    }
    expect(workflow).toContain('if [ "$DRY_RUN" != "true" ]; then');
    expect(workflow).toMatch(
      /Create manual-review issue on failure\s+if: \$\{\{ failure\(\) && env\.DRY_RUN != 'true' \}\}/,
    );
  });

  it("verifies the exact rolling candidate only in dry-run mode", () => {
    expect(workflow).toMatch(
      /Verify dry-run rolling candidate\s+if: \$\{\{ env\.DRY_RUN == 'true' \}\}/,
    );
    expect(workflow).toContain("compiled-schedule.json");
    expect(workflow).not.toContain("npm run assemble:rolling-dry-run");
  });

  it("validates the candidate before importing it into the database", () => {
    expect(workflow).toContain('cp "$RUN_DIR/compiled-schedule.json" src/data/published-schedule.json');
    expect(workflow.indexOf("- name: Run tests")).toBeLessThan(
      workflow.indexOf("- name: Import approved rolling window"),
    );
    expect(workflow.indexOf("- name: Build production site")).toBeLessThan(
      workflow.indexOf("- name: Import approved rolling window"),
    );
  });
});
