/**
 * Balance Sheet Routes
 *
 * This module defines routes for retrieving balance sheet reports.
 *
 * Routes:
 * -------
 * GET /
 *   Description: Generates and retrieves a balance sheet report for a specific date
 *   Query Parameters:
 *     - asOfDate (required): ISO 8601 date string representing the report date
 *                            Example: "2024-12-31" or "2024-12-31T23:59:59.000Z"
 *   Responses:
 *     - 200: Success - Returns balance sheet report as JSON
 *     - 400: Bad Request - Missing or invalid asOfDate parameter
 *     - 500: Internal Server Error - Failed to generate report
 *   Example Request:
 *     GET /balance?asOfDate=2024-12-31
 *   Example Response:
 *     {
 *       // Balance sheet report structure from BalanceSheetFetcher
 *     }
 */

const express = require("express");
const BalanceSheetFetcher = require("../services/reporting/balanceSheetFetcher");

const router = express.Router();
const balanceSheetFetcher = new BalanceSheetFetcher();

/**
 * GET /
 * Retrieves a balance sheet report as of a specified date
 */
router.get("/", async (req, res) => {
  const { asOfDate: asOfDateString } = req.query;

  // Validate presence of required parameter
  if (!asOfDateString) {
    return res.status(400).json({
      error: "Missing required query parameter 'asOfDate'",
    });
  }

  // Validate date format
  const asOfDate = new Date(asOfDateString);
  if (Number.isNaN(asOfDate.getTime())) {
    return res.status(400).json({
      error: "Invalid 'asOfDate' query parameter; expected a valid date",
    });
  }

  console.log("Generating balance sheet report for date:", asOfDate.toISOString());

  try {
    const report = await balanceSheetFetcher.buildBalanceSheetReport(asOfDate, false);
    return res.json(report);
  } catch (error) {
    console.error("Failed to build balance sheet report:", error);
    return res.status(500).json({
      error: "Failed to build balance sheet report",
      message: error.message,
    });
  }
});

module.exports = router;
