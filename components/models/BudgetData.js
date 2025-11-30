var mongoose = require("mongoose");
var Schema = mongoose.Schema;

// Create Schema
var budgetData = new Schema({
  Date: { type: Date },
  Description1: { type: String },
  Amount: { type: Number },
  Currency: { type: String },
  BaseAmount: { type: Number },
  BaseCurrency: { type: String },
  Account: { type: String },
  Category: { type: String },
  Labels: { type: String },
  Note: { type: String },
});

module.exports = mongoose.model("budgetData", budgetData, "budgetData");
