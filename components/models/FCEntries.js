var mongoose = require("mongoose");
var Schema = mongoose.Schema;

// Create Schema
var fcEntry = new Schema({
  Date: { type: Date },
  Amount: { type: Number },
  Account: { type: String },
  Note: { type: String },
});

module.exports = mongoose.model("fcEntry", fcEntry, "fcEntries");
