/**
 * Tests for ForecastDatabaseManager
 *
 * Tests database operations for forecast generation.
 * Note: These tests require a MongoDB instance and actual data.
 * For production use, consider using mongodb-memory-server for isolated testing.
 */

const ForecastDatabaseManager = require("../database-manager");

describe("ForecastDatabaseManager", () => {
  let dbManager;

  beforeEach(() => {
    dbManager = new ForecastDatabaseManager();
  });

  describe("Constructor", () => {
    it("should create instance with default URI", () => {
      expect(dbManager).toBeInstanceOf(ForecastDatabaseManager);
      expect(dbManager.mongoUri).toBeDefined();
    });

    it("should use provided URI", () => {
      const customUri = "mongodb://localhost:27017/test";
      const manager = new ForecastDatabaseManager(customUri);
      expect(manager.mongoUri).toBe(customUri);
    });

    it("should fall back to env var or default", () => {
      const manager = new ForecastDatabaseManager();
      expect(
        manager.mongoUri === process.env.MONGO_URI ||
          manager.mongoUri === "mongodb://localhost:27018/fin"
      ).toBe(true);
    });
  });

  describe("Method signatures", () => {
    it("should have all required methods", () => {
      expect(typeof dbManager.ensureConnection).toBe("function");
      expect(typeof dbManager.loadCategoriesForScenario).toBe("function");
      expect(typeof dbManager.loadIncExpCategoriesForScenario).toBe("function");
      expect(typeof dbManager.loadModulesForScenario).toBe("function");
      expect(typeof dbManager.loadIncExpModulesForScenario).toBe("function");
      expect(typeof dbManager.clearEntriesForScenario).toBe("function");
      expect(typeof dbManager.insertEntries).toBe("function");
    });
  });

  // NOTE: The following tests would require a test database
  // For now, they're skipped but show the intended test structure

  describe.skip("Database operations (requires test DB)", () => {
    beforeAll(async () => {
      // Would set up test database here
      await dbManager.ensureConnection();
    });

    afterAll(async () => {
      // Would clean up test database here
    });

    it("should load modules for a scenario", async () => {
      const modules = await dbManager.loadModulesForScenario("TestScenario");
      expect(Array.isArray(modules)).toBe(true);
    });

    it("should return empty array for non-existent scenario", async () => {
      const modules = await dbManager.loadModulesForScenario(
        "NonExistent123"
      );
      expect(modules).toEqual([]);
    });

    it("should clear entries for a scenario", async () => {
      const deletedCount = await dbManager.clearEntriesForScenario(
        "TestScenario"
      );
      expect(typeof deletedCount).toBe("number");
      expect(deletedCount).toBeGreaterThanOrEqual(0);
    });
  });
});
