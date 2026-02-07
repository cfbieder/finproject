const express = require("express");
const CashFlowFetcher = require("../services/reporting/cashFLowFetcher");

const router = express.Router();
const cashFlowFetcher = new CashFlowFetcher();
const MAX_TRANSACTION_LIMIT = 2000;

router.get("/", async (req, res) => {
  const { fromDate, toDate, transfers, includeUnrealizedGL } = req.query ?? {};

  if (!fromDate || !toDate) {
    return res.status(400).json({
      error: "Missing required query parameters 'fromDate' and 'toDate'",
    });
  }

  const start = new Date(fromDate);
  const end = new Date(toDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return res.status(400).json({
      error: "Invalid 'fromDate' or 'toDate'; expected valid dates",
    });
  }

  const transferMode =
    transfers === "include" || transfers === "only" ? transfers : "exclude";

  try {
    const report = await cashFlowFetcher.buildCashFlowReport({
      fromDate: start,
      toDate: end,
      transfers: transferMode,
      includeUnrealizedGL: includeUnrealizedGL === "true",
    });
    res.json(report);
  } catch (error) {
    console.error("Failed to build cash flow report:", error);
    res.status(500).json({
      error: "Failed to build cash flow report",
    });
  }
});

const parseCategories = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
};

router.get("/transactions", async (req, res) => {
  const { fromDate, toDate, limit } = req.query ?? {};
  const categories = parseCategories(req.query?.category || req.query?.categories);

  if (!fromDate || !toDate) {
    return res
      .status(400)
      .json({ error: "Missing required query parameters 'fromDate' and 'toDate'" });
  }

  if (!categories.length) {
    return res
      .status(400)
      .json({ error: "At least one category is required to fetch transactions" });
  }

  const start = new Date(fromDate);
  const end = new Date(toDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return res.status(400).json({
      error: "Invalid 'fromDate' or 'toDate'; expected valid dates",
    });
  }

  const parsedLimit = Number.isFinite(Number(limit))
    ? Math.floor(Number(limit))
    : null;
  const cappedLimit =
    parsedLimit && parsedLimit > 0
      ? Math.min(MAX_TRANSACTION_LIMIT, parsedLimit)
      : null;

  try {
    const match = {
      Category: { $in: Array.from(new Set(categories)) },
      Date: { $gte: start, $lte: end },
    };

    const query = cashFlowFetcher.psDataModel
      .find(match)
      .sort({ Date: -1 })
      .lean();

    if (cappedLimit) {
      query.limit(cappedLimit);
    }

    const transactions = await query.exec();

    res.json({ transactions });
  } catch (error) {
    console.error("Failed to load cash flow transactions:", error);
    res.status(500).json({
      error: "Failed to load cash flow transactions",
    });
  }
});

module.exports = router;
