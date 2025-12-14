const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const healthRouter = require("./routes/health");
const balanceRouter = require("./routes/balance");
const cashFlowRouter = require("./routes/cashFlow");
const ingestRouter = require("./routes/ingestPs");
const utilRouter = require("./routes/util");
const budgetRouter = require("./routes/budget");
const forecastRouter = require("./routes/forecast");
const app = express();

app.use(morgan("tiny"));
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));

app.use("/api/util", utilRouter);
app.use("/api/health", healthRouter);
app.use("/api/balance", balanceRouter);
app.use("/api/cash-flow", cashFlowRouter);
app.use("/api/ingest-ps", ingestRouter);
app.use("/api/budget", budgetRouter);
app.use("/api/forecast", forecastRouter);

// URL of MongoDB server
var db = process.env.MONGO_URI;
console.log("[SERVER] Mongo URI: ", db);

app.get("/", (req, res) => {
  res.json({
    service: "fin-server",
    status: "running",
    routes: [
      "/api/health",
      "/api/balance",
      "/api/cash-flow",
      "/api/ingest-ps",
      "/api/ingest-ps/upload-ps",
      "/api/ingest-ps/analyze-ps",
      "/api/ingest-ps/refresh-ps",
      "/api/forecast",
    ],
  });
});

app.use((req, res, next) => {
  const err = new Error("Not Found");
  err.status = 404;
  next(err);
});

app.use((err, req, res) => {
  res.status(err.status || 500).json({
    error: err.message,
    status: err.status || 500,
  });
});

// Library for MongoDB
var mongoose = require("../../components/node_modules/mongoose");

const NOT_READY_DELAY = 5000;

const connectWithRetry = () => {
  mongoose
    .connect(db, { serverSelectionTimeoutMS: 10000 })
    .then(() => {
      console.log("[SERVER] Connected to MongoDB");
    })
    .catch((err) => {
      console.log(
        "[SERVER] Error: Unable to connect to MongoDB - retrying in a few seconds",
        err.message
      );
      setTimeout(connectWithRetry, NOT_READY_DELAY);
    });
};

connectWithRetry();

module.exports = app;
