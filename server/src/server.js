const app = require("./app");
const { sweepStaleScratch } = require("./v2/services/forecastScratch");

const port = process.env.PORT || 3005;

app.listen(port, () => {
  console.log(`[fin-server] listening on port ${port}`);

  // CR085 P0 — remove scratch scenarios a killed process left behind (CR084 §9.2). Fire and
  // forget: it must not delay listening, and `sweepStaleScratch` swallows its own errors so a
  // database that is not up yet cannot stop the server from starting.
  sweepStaleScratch();
});
