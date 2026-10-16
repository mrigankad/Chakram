import { describe, expect, it } from "vitest";
import { displayUrl, formatPassRate, relativeTime, stageLabel, stageTone } from "./project-stages";

describe("stageTone", () => {
  it("maps finished states to success", () => {
    for (const s of ["passed", "ready", "done", "GO", "Ready"]) expect(stageTone(s)).toBe("success");
  });

  it("maps in-flight states to info", () => {
    for (const s of ["running", "queued", "building", "generating", "BUILDING"]) expect(stageTone(s)).toBe("info");
  });

  it("maps failures to critical and caution to warning", () => {
    for (const s of ["failed", "error", "NO_GO", "no-go"]) expect(stageTone(s)).toBe("critical");
    expect(stageTone("CAUTION")).toBe("warning");
  });

  it("is neutral for not evaluated, n/a, created, unknown and missing values", () => {
    for (const s of ["not evaluated", "n/a", "created", "INSUFFICIENT_DATA", "something-new", "", null, undefined]) {
      expect(stageTone(s)).toBe("neutral");
    }
  });
});

describe("stageLabel", () => {
  it("prints statuses as sentence case words", () => {
    expect(stageLabel("not evaluated")).toBe("Not evaluated");
    expect(stageLabel("NO_GO")).toBe("No go");
    expect(stageLabel("INSUFFICIENT_DATA")).toBe("Insufficient data");
    expect(stageLabel("n/a")).toBe("n/a");
    expect(stageLabel(null)).toBe("Not evaluated");
  });
});

describe("formatPassRate", () => {
  it("accepts fractions and percentages and shows a dash when absent", () => {
    expect(formatPassRate(0.875)).toBe("88%");
    expect(formatPassRate(1)).toBe("100%");
    expect(formatPassRate(42)).toBe("42%");
    expect(formatPassRate(0)).toBe("0%");
    expect(formatPassRate(null)).toBe("—");
    expect(formatPassRate(undefined)).toBe("—");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-10-16T12:00:00Z");

  it("describes recent times relative to now", () => {
    expect(relativeTime("2026-10-16T11:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-10-16T11:55:00Z", now)).toBe("5m ago");
    expect(relativeTime("2026-10-16T09:00:00Z", now)).toBe("3h ago");
    expect(relativeTime("2026-10-14T12:00:00Z", now)).toBe("2d ago");
  });

  it("falls back to a date for old values and empty for invalid ones", () => {
    expect(relativeTime("2026-01-01T00:00:00Z", now)).toMatch(/2026/);
    expect(relativeTime("not a date", now)).toBe("");
    expect(relativeTime(null, now)).toBe("");
  });
});

describe("displayUrl", () => {
  it("shows the host and path only", () => {
    expect(displayUrl("https://my-app.vercel.app/")).toBe("my-app.vercel.app");
    expect(displayUrl("https://my-app.vercel.app/admin")).toBe("my-app.vercel.app/admin");
    expect(displayUrl("nonsense")).toBe("nonsense");
    expect(displayUrl(null)).toBe("");
  });
});
