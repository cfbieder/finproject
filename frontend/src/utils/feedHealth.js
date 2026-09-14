/**
 * Feed connection health — the labels and the "what to do" text, shared by
 * Balance Calibration (the attention panel and each row's badge) and Bank Feed
 * Setup (the attention box and the connections table).
 *
 * Both pages read bank-feed's classified `state`. Since bank-feed 04815bd
 * (2026-09-14) `stale` means no sync with the bank has FINISHED inside 48h,
 * and `days_since_upstream_sync` counts from that last bank contact; the age
 * of the newest data is `days_since_new_data`. (Before, bank-feed read
 * Fintable's `last_successful_update`, which on GoCardless connections is the
 * newest transaction's date — a dormant account read "silent 64 days" while
 * syncing daily.) Before this module the Setup page read the
 * raw `healthy` flag instead, which is TRUE for exactly that case — so it said
 * HEALTHY beside a bank 64 days silent while Balance Calibration, one link
 * away, said it needed attention. One module, one vocabulary.
 *
 * Fin cannot force Fintable's bank sync: bank-feed's only POST to Fintable
 * mints a connection link. So no remedy here points at Refresh Feeds.
 */

export const HEALTH_LABEL = {
  needs_reconnect: "reconnect needed",
  unhealthy: "upstream error",
  never_synced: "never synced",
  stale: "feed silent",
};

// needs_reconnect / unhealthy are "do this now"; the rest are "look at this".
export function healthPillKind(health) {
  if (!health || !health.attention) return "ok";
  return health.state === "needs_reconnect" || health.state === "unhealthy" ? "danger" : "warn";
}

/**
 * @param {object} health  a connection or account health record from bank-feed
 * @param {{onSetupPage?: boolean}} opts  on Bank Feed Setup the Re-authorise
 *   button sits beside the advice, so the text says "press Re-authorise"
 *   instead of naming the page.
 * @returns {{what: string, todo: string}}
 */
export function attentionAdvice(health, { onSetupPage = false } = {}) {
  // On Setup the button is beside the text; elsewhere, name the page it is on.
  const reauth = onSetupPage ? "press Re-authorise" : "re-authorise it under Settings → Bank Feed Setup";
  const Reauth = reauth[0].toUpperCase() + reauth.slice(1);
  const onRecon = onSetupPage ? " on Balance Calibration" : "";
  // Days since the last FINISHED sync with the bank, and since new data arrived.
  const bankDays = health.days_since_upstream_sync;
  const dataDays = health.days_since_new_data;
  const plural = (n) => `${n} day${n === 1 ? "" : "s"}`;
  switch (health.state) {
    case "needs_reconnect":
      return {
        what: "The bank consent has expired, so this feed has stopped.",
        todo: `${Reauth}, then check the account mapping — a reconnect can re-key accounts.`,
      };
    case "unhealthy":
      return {
        what: `Fintable reports this connection unhealthy${health.status_text ? ` (${health.status_text})` : ""}.`,
        todo: `Fintable retries on its own first. If it persists past tomorrow, ${reauth}.`,
      };
    case "never_synced":
      return {
        what: "Fintable has not completed a first sync for this connection.",
        todo: `Give it a day. If it is still empty, ${reauth}.`,
      };
    case "stale":
    default:
      return {
        what:
          (bankDays != null
            ? `Fintable's last completed sync with the bank was ${plural(bankDays)} ago`
            : `Fintable reports no completed sync with the bank in the last 2 days${dataDays != null ? ` and no new data for ${plural(dataDays)}` : ""}`) +
          `, though the consent is still valid${health.status_text ? ` (${health.status_text})` : ""}. A normal gap is under 2 days. Refresh Feeds cannot fix this; it only reads what Fintable already has.`,
        todo: `If it stays silent, ${reauth}. Until it syncs, the bank figure on its accounts is out of date: do not Reconcile them${onRecon} — use Upload on the row to import a statement instead.`,
      };
  }
}
