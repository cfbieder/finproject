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

var FCModule = new Schema({
  Scenario: { type: String },
  Account: { type: String },
  Name: { type: String },
  Type: { type: String },
  Currency: { type: String },
  ExpCategory: { type: String },
  Expense: { type: Number },
  ExpensePct: { type: Number },
  IncomeCategory: { type: String },
  Income: { type: Number },
  IncomePct: { type: Number },
  BaseDate: { type: Date },
  BaseValue: { type: Number },
  MarketValue: { type: Number },
  BaseValueUSD: { type: Number },
  MarketValueUSD: { type: Number },
  Growth: { type: Number },
  Invest: [transferSchema],
  Dispose: [transferSchema],
});

module.exports = mongoose.model("FCModule", FCModule, "FCModule");
