var mongoose = require("mongoose");

var Schema = mongoose.Schema;

var changesSchema = new Schema(
  {
    Date: { type: Date },
    Amount: { type: Number },
    Flag: { type: String },
  },
  { _id: false }
);

var FCIncExp = new Schema({
  Scenario: { type: String },
  Account: { type: String },
  Matched: { type: Boolean, default: false },
  Name: { type: String },
  Type: { type: String },
  Currency: { type: String },
  BaseDate: { type: Date },
  BaseValue: { type: Number },
  BaseValueUSD: { type: Number },
  Growth: { type: Number },
  Changes: [changesSchema],
});

module.exports = mongoose.model("FCIncExp", FCIncExp, "FCIncExp");
