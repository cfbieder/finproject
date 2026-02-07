/**
 * Tests for constants module
 *
 * Verifies that all required constants are defined and have expected values
 */

const { CATEGORIES, PATHS, DEFAULTS } = require("../constants");

describe("Constants Module", () => {
  describe("CATEGORIES", () => {
    it("should define all required category names", () => {
      expect(CATEGORIES.BANK_ACCOUNTS).toBe("Bank Accounts");
      expect(CATEGORIES.TRANSFER_BANK).toBe("Transfer - Bank");
      expect(CATEGORIES.TAXES_US).toBe("Taxes US");
      expect(CATEGORIES.TAXES).toBe("Taxes");
      expect(CATEGORIES.INFLATION).toBe("Inflation");
      expect(CATEGORIES.FX_PLN).toBe("FX - PLN");
      expect(CATEGORIES.FX_EUR).toBe("FX - EUR");
    });
  });

  describe("PATHS", () => {
    it("should define required file paths", () => {
      expect(PATHS.ASSUMP_FILE).toBeDefined();
      expect(PATHS.AUDIT_TRAIL_DIR).toBeDefined();
      expect(typeof PATHS.ASSUMP_FILE).toBe("string");
      expect(typeof PATHS.AUDIT_TRAIL_DIR).toBe("string");
    });

    it("should include components/data in paths", () => {
      expect(PATHS.ASSUMP_FILE).toContain("components");
      expect(PATHS.ASSUMP_FILE).toContain("data");
      expect(PATHS.AUDIT_TRAIL_DIR).toContain("components");
      expect(PATHS.AUDIT_TRAIL_DIR).toContain("data");
    });
  });

  describe("DEFAULTS", () => {
    it("should define default configuration values", () => {
      expect(DEFAULTS.MONGO_URI).toBeDefined();
      expect(DEFAULTS.TIMEOUT_MS).toBeDefined();
      expect(DEFAULTS.TAX_RATE).toBeDefined();
      expect(typeof DEFAULTS.MONGO_URI).toBe("string");
      expect(typeof DEFAULTS.TIMEOUT_MS).toBe("number");
      expect(typeof DEFAULTS.TAX_RATE).toBe("number");
    });

    it("should have sensible default values", () => {
      expect(DEFAULTS.MONGO_URI).toContain("mongodb://");
      expect(DEFAULTS.TIMEOUT_MS).toBeGreaterThan(0);
      expect(DEFAULTS.TAX_RATE).toBeGreaterThanOrEqual(0);
    });
  });
});
