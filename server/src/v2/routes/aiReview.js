/**
 * AI Review Routes — Claude-powered forecast plan evaluation
 *
 * POST   /                          Create new review (calls Claude)
 * POST   /:reviewId/message         Send follow-up message
 * GET    /scenario/:scenarioId      List reviews for scenario
 * GET    /:reviewId                 Get full conversation
 * DELETE /:reviewId                 Delete a review
 * POST   /apply                     Apply a recommended change
 */

const express = require("express");
const router = express.Router();
const db = require("../db");
const aiReview = require("../services/aiReview");

// POST /api/v2/ai-review — Create new review
router.post("/", async (req, res, next) => {
  try {
    const { scenario } = req.body;
    if (!scenario) return res.status(400).json({ error: "Scenario name is required" });

    const { review, content, actions } = await aiReview.createReview(scenario);
    res.status(201).json({ review, message: { role: "assistant", content, actions } });
  } catch (error) {
    console.error("[ai-review] Create failed:", error.message);
    if (error.message.includes("API key")) return res.status(400).json({ error: error.message });
    next(error);
  }
});

// POST /api/v2/ai-review/:reviewId/message — Follow-up message
router.post("/:reviewId/message", async (req, res, next) => {
  try {
    const reviewId = parseInt(req.params.reviewId);
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message is required" });

    const { content, actions } = await aiReview.sendMessage(reviewId, message);
    res.json({ message: { role: "assistant", content, actions } });
  } catch (error) {
    console.error("[ai-review] Message failed:", error.message);
    next(error);
  }
});

// GET /api/v2/ai-review/scenario/:scenarioName — List reviews for scenario
router.get("/scenario/:scenarioName", async (req, res, next) => {
  try {
    const scenarioName = decodeURIComponent(req.params.scenarioName).trim();
    const scenarioResult = await db.query("SELECT id FROM forecast_scenarios WHERE name = $1", [scenarioName]);
    if (scenarioResult.rows.length === 0) return res.json({ data: [] });
    const scenarioId = scenarioResult.rows[0].id;
    const result = await db.query(
      "SELECT * FROM fc_ai_reviews WHERE scenario_id = $1 ORDER BY created_at DESC",
      [scenarioId]
    );
    res.json({ data: result.rows });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/ai-review/:reviewId — Get full conversation
router.get("/:reviewId", async (req, res, next) => {
  try {
    const reviewId = parseInt(req.params.reviewId);
    const review = await db.query("SELECT * FROM fc_ai_reviews WHERE id = $1", [reviewId]);
    if (review.rows.length === 0) return res.status(404).json({ error: "Review not found" });

    const messages = await db.query(
      "SELECT * FROM fc_ai_messages WHERE review_id = $1 ORDER BY created_at",
      [reviewId]
    );
    res.json({ review: review.rows[0], messages: messages.rows });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v2/ai-review/:reviewId — Delete a review
router.delete("/:reviewId", async (req, res, next) => {
  try {
    const reviewId = parseInt(req.params.reviewId);
    await db.query("DELETE FROM fc_ai_reviews WHERE id = $1", [reviewId]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// POST /api/v2/ai-review/apply — Apply a recommended change
router.post("/apply", async (req, res, next) => {
  try {
    const { action } = req.body;
    if (!action) return res.status(400).json({ error: "Action is required" });

    const result = await aiReview.applyAction(action);
    res.json(result);
  } catch (error) {
    console.error("[ai-review] Apply failed:", error.message);
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
