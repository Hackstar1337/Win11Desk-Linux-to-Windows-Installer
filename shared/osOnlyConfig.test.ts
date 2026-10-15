import { describe, it, expect } from "vitest";
import { defaults, osOnlyConfig, deploymentSchema } from "./deployment";
import { automaticTarget, defaultIsoUrl } from "./media";
import { installerIssues } from "./installer";
describe("OS-only configuration independent of extras", () => {
  it("ignores invalid optional file/name while keeping primary settings", () => {
    const c = {
      ...defaults,
      password: "SyntheticPassword12!",
      fileUrl: "not a url",
      hostname: "invalid hostname with spaces",
    };
    expect(deploymentSchema.safeParse(c).success).toBe(false);
    expect(
      installerIssues(osOnlyConfig(c), automaticTarget(defaultIsoUrl))
    ).toEqual([]);
    expect(osOnlyConfig(c).password).toBe(c.password);
  });
  it("disregards hidden retries when init is off but validates visible retries", () => {
    expect(
      deploymentSchema.safeParse(
        osOnlyConfig({ ...defaults, retries: 0, initScript: false })
      ).success
    ).toBe(true);
    expect(
      deploymentSchema.safeParse(
        osOnlyConfig({ ...defaults, retries: 0, initScript: true })
      ).success
    ).toBe(false);
  });
});
