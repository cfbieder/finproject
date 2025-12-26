/**
 * Tests for fcbuilder-setup module
 *
 * Tests the loadScenarioConfig factory function that loads and processes
 * forecast scenario configuration from FCAssump.json
 */

const { loadScenarioConfig } = require("../fcbuilder-setup");

describe("loadScenarioConfig", () => {
  it("should load scenario configuration successfully", () => {
    // This test assumes FCAssump.json exists with at least one scenario
    // Adjust the scenario name based on your actual data
    const config = loadScenarioConfig("Baseline");

    expect(config).toBeDefined();
    expect(config.scenario).toBeDefined();
    expect(config.scenario.Name).toBe("Baseline");
    expect(config.categories).toBeDefined();
    expect(Array.isArray(config.categories)).toBe(true);
    expect(config.inflationRates).toBeDefined();
    expect(Array.isArray(config.inflationRates)).toBe(true);
    expect(config.fxratesPLN).toBeDefined();
    expect(Array.isArray(config.fxratesPLN)).toBe(true);
    expect(config.fxratesEUR).toBeDefined();
    expect(Array.isArray(config.fxratesEUR)).toBe(true);
    expect(config.years).toBeDefined();
    expect(Array.isArray(config.years)).toBe(true);
    expect(typeof config.taxRate).toBe("number");
  });

  it("should include required scenario fields", () => {
    const config = loadScenarioConfig("Baseline");

    expect(config.scenario.PeriodStart).toBeDefined();
    expect(config.scenario.PeriodEnd).toBeDefined();
    expect(config.scenario.TaxRate).toBeDefined();
    expect(typeof config.scenario.PeriodStart).toBe("number");
    expect(typeof config.scenario.PeriodEnd).toBe("number");
  });

  it("should throw error for non-existent scenario", () => {
    expect(() => loadScenarioConfig("NonExistentScenario123")).toThrow();
  });

  it("should generate years array covering the full period", () => {
    const config = loadScenarioConfig("Baseline");
    const expectedLength =
      config.scenario.PeriodEnd - config.scenario.PeriodStart + 1;

    expect(config.years).toHaveLength(expectedLength);
    expect(config.years[0]).toBe(config.scenario.PeriodStart);
    expect(config.years[config.years.length - 1]).toBe(
      config.scenario.PeriodEnd
    );
  });

  it("should generate rate arrays matching years length", () => {
    const config = loadScenarioConfig("Baseline");

    expect(config.inflationRates).toHaveLength(config.years.length);
    expect(config.fxratesPLN).toHaveLength(config.years.length);
    expect(config.fxratesEUR).toHaveLength(config.years.length);
  });
});
