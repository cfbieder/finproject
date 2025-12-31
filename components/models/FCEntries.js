var mongoose = require("mongoose");
const {
  scenario,
} = require("../../server/src/services/forecast/fcbuilder-setup");
var Schema = mongoose.Schema;

// Create Schema
var fcEntry = new Schema({
  Scenario: { type: String },
  Year: { type: Number },
  Amount: { type: Number },
  Account: { type: String },
  Module: { type: String },
  Comment: { type: String },
});

module.exports = mongoose.model("fcEntry", fcEntry, "fcEntries");
