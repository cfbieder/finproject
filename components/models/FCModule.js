var mongoose = require("mongoose");
var Schema = mongoose.Schema;

var transferSchema = new Schema(
  {
    Date: { type: Date },
    Amount: { type: Number },
    Flag: { type: String },
  },
  { _id: false }
);

var incomePctSchema = new Schema(
  {
    Date: { type: Date },
    Value: { type: Number },
  },
  { _id: false }
);

var FCModule = new Schema({
  Scenario: { type: String },
  Account: { type: String },
  Matched: { type: Boolean, default: false },
  Name: { type: String },
  Type: { type: String },
  Currency: { type: String },
  ExpCategory: { type: String },
  Expense: { type: Number },
  ExpensePct: { type: Number },
  IncomeCategory: { type: String },
  Income: { type: Number },
  IncomePct: [incomePctSchema],
  BaseDate: { type: Date },
  BaseValue: { type: Number },
  MarketValue: { type: Number },
  BaseValueUSD: { type: Number },
  MarketValueUSD: { type: Number },
  Growth: { type: Number },
  Comment: { type: String },
  Invest: [transferSchema],
  Dispose: [transferSchema],
});

module.exports = mongoose.model("FCModule", FCModule, "FCModule");
