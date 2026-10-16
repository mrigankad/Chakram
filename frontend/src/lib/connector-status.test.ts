import { describe, expect, it } from "vitest";
import { enablesLine } from "./connector-status";

describe("enablesLine", () => {
  it("joins the feed labels with a middle dot", () => {
    expect(
      enablesLine({
        feeds: [
          { id: "ci", label: "CI Health" },
          { id: "review", label: "Code Review" },
        ],
      }),
    ).toBe("Enables: CI Health · Code Review");
  });

  it("is empty when nothing reads the connector, and skips blank labels", () => {
    expect(enablesLine({ feeds: [] })).toBe("");
    expect(enablesLine({ feeds: [{ id: "x", label: "  " }] })).toBe("");
    expect(enablesLine({ feeds: [{ id: "x", label: " Deployments " }, { id: "y", label: "" }] })).toBe("Enables: Deployments");
  });
});
