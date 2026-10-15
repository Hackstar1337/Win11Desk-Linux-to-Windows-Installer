import { describe, it, expect } from "vitest";
import { dashboardTheme, dashboardThemes } from "./dashboardTheme";
import { deploymentStatusLabel } from "./deploymentStatus";
function luminance(hex: string) {
  const v = hex
    .slice(1)
    .match(/../g)!
    .map(x => parseInt(x, 16) / 255)
    .map(x => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function contrast(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
describe("dashboard colour and status preferences", () => {
  it("offers six unique palettes and safely defaults invalid stored values", () => {
    expect(new Set(dashboardThemes.map(t => t.id)).size).toBe(6);
    for (const value of [null, undefined, "broken", "<script>", {}])
      expect(dashboardTheme(value).id).toBe("cyan");
    for (const theme of dashboardThemes)
      expect(dashboardTheme(theme.id)).toBe(theme);
  });
  it("keeps button text and accent links readable on dark surfaces", () => {
    for (const theme of dashboardThemes) {
      expect(
        contrast(theme.primary, "#06131a"),
        theme.id
      ).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.hover, "#06131a"), theme.id).toBeGreaterThanOrEqual(
        4.5
      );
      expect(contrast(theme.link, "#101d30"), theme.id).toBeGreaterThanOrEqual(
        4.5
      );
    }
  });
  it("only changes the visible stale label, not completion/failure meanings", () => {
    expect(deploymentStatusLabel("stale")).toBe("Awaiting update");
    expect(deploymentStatusLabel("windows_ready")).toBe("windows ready");
    expect(deploymentStatusLabel("failed")).toBe("failed");
  });
});
