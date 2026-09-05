/**
 * SecurityChartModal.jsx — CR093 §5. Click a ticker, see what it did.
 *
 * ⚠️ THREE NUMBERS HERE ALL LOOK LIKE "GAIN", and the page says which is which
 * rather than leaving the reader to assume. **Price change** is what the quote
 * did over the chosen period, with no dividends, so it is not total return.
 * **Unrealized G/L** is this position against its own cost basis over a holding
 * period that is not the chosen one. **The overlay's %** is what SPY or DIA did
 * in the same window. This project has settled the level-series-is-not-return
 * question three times ([CR056](../../..) §3.3, CR058 §9 and §12.8); labelling
 * is how it stays settled.
 *
 * ⚠️ REBASED TO 100, NEVER TWO PRICE AXES. DIA trades near $534; on one axis a
 * $25 holding is a flat line along the bottom and the chart says nothing. Both
 * series start at 100 and the SHAPES compare — the only comparison a level
 * series supports.
 *
 * ⚠️ AN UNQUOTED INSTRUMENT GETS A SENTENCE, NOT AN EMPTY AXIS. 52% of this
 * portfolio's value is bonds, CDs and deposits with no market quote by nature.
 * An empty chart reads as "this did not move".
 */

import { useEffect, useState } from "react";
import {
  ComposedChart, Line, Bar, ReferenceLine, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import Modal from "../../components/Modal/Modal.jsx";
import LoadingSpinner from "../../components/LoadingSpinner.jsx";
import useTheme from "../../hooks/useTheme.js";
import { chartChrome, seriesColors, tooltipStyle } from "../Forecast/utils/fcSeriesPalette.js";
import { money } from "./investmentFormat.js";
import Rest from "../../js/rest.js";
import {
  BASIS_LABEL, SECTOR_LABEL, sectorAbsence, ratingLabel, signedPct, yieldRows, faceValue,
} from "./securityDetail.js";

/** Merge the subject and its overlays onto one date axis for recharts. */
function mergeSeries(data) {
  const byDate = new Map();
  for (const p of data.series) byDate.set(p.d, { d: p.d, subject: p.rebased, close: p.close });
  for (const o of data.overlays) {
    for (const p of o.series) {
      const row = byDate.get(p.d) || { d: p.d };
      row[o.key] = p.rebased;
      byDate.set(p.d, row);
    }
  }
  return [...byDate.values()].sort((a, b) => (a.d < b.d ? -1 : 1));
}

function Detail({ label, children }) {
  return (
    <div className="inv-detail">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Details({ d, security }) {
  const { position, instrument, quote } = d;
  const terms = instrument.bond_terms;
  return (
    <div className="inv-details">
      <section>
        <h3>Your position</h3>
        <dl>
          {position.held ? (
            <>
              <Detail label="Quantity">
                {Number(position.quantity).toLocaleString()} {position.quantity_unit || ""}
              </Detail>
              {/* ⚠️ A bond's QUANTITY is units of par, not dollars of face: 1,000
                  units priced per $100 of face is $100,000 of face. Beside a
                  "coupon on face" the bare quantity invites an annual income
                  100x too small, so the face value is spelled out. */}
              {faceValue(position, security) !== null && (
                <Detail label="Face value">
                  {money(faceValue(position, security), security.currency)}
                </Detail>
              )}
              <Detail label="Market value">{money(position.market_value, security.currency)}</Detail>
              <Detail label="Cost basis">
                {position.cost_basis === null
                  ? <span className="inv-muted">not reported</span>
                  : money(position.cost_basis, security.currency)}
              </Detail>
              {/* ⚠️ NOT the chart's % change. Different period, different base. */}
              <Detail label="Unrealized G/L">
                {position.unrealized === null
                  ? <span className="inv-muted">no cost basis</span>
                  : money(position.unrealized, security.currency)}
              </Detail>
              <Detail label="% of portfolio">{(position.share_of_portfolio * 100).toFixed(2)}%</Detail>
              <Detail label={position.accounts.length > 1 ? "Held in" : "Account"}>
                {position.accounts.map((a) => a.account_name).join(", ")}
              </Detail>
            </>
          ) : (
            <Detail label="Held">
              <span className="inv-muted">Not in the latest snapshot.</span>
            </Detail>
          )}
        </dl>
      </section>

      <section>
        <h3>The instrument</h3>
        <dl>
          <Detail label="Asset class">{instrument.asset_class}</Detail>
          <Detail label="Priced">{BASIS_LABEL[instrument.price_basis] || instrument.price_basis || "—"}</Detail>
          <Detail label="Sector">
            {/* ⚠️ THREE reasons there is no sector, not two — the same split the
                Exposure page makes, and getting it wrong here told the owner a
                brokered CD was "not classified yet", which reads as work
                outstanding on something that can never have an equity sector.
                The structural signal is price basis and asset class, not
                whether we happen to have asked. */}
            {instrument.sectors.length
              ? instrument.sectors.map((x) => `${SECTOR_LABEL[x.sector] || x.sector} ${(x.weight * 100).toFixed(0)}%`).join(" · ")
              : (
                <span className="inv-muted">{sectorAbsence(instrument)}</span>
              )}
          </Detail>
          {/* What it PAYS — a coupon and a current yield for fixed income, a
              trailing-twelve-month dividend yield for everything else. */}
          {yieldRows(d.yield, terms).map((r) => (
            <Detail key={r.label} label={r.label}>
              <span className={r.muted ? "inv-muted" : undefined}>{r.value}</span>
              {r.note && <span className="inv-detail__note">{r.note}</span>}
            </Detail>
          ))}
          {terms && (
            <>
              <Detail label="Rating">
                {ratingLabel(terms) || <span className="inv-muted">none printed</span>}
              </Detail>
              <Detail label="Matures">{terms.maturity_date || "—"}</Detail>
              {terms.next_call_date && <Detail label="Next call">{terms.next_call_date}</Detail>}
              {/* ⚠️ A statement can be a quarter old. Print its date. */}
              <Detail label="Terms as of">{terms.as_of} (statement)</Detail>
            </>
          )}
        </dl>
      </section>

      <section>
        <h3>The quote</h3>
        <dl>
          {quote ? (
            <>
              <Detail label="Last close">
                {money(quote.last_close, security.currency)} on {quote.last_close_on}
                {quote.age_days > 5 && <span className="inv-warn"> · {quote.age_days} days old</span>}
              </Detail>
              <Detail label="52-week range">
                {money(quote.week52_low, security.currency)} – {money(quote.week52_high, security.currency)}
              </Detail>
            </>
          ) : (
            <Detail label="Quote">
              <span className="inv-muted">This instrument is not quoted on a market.</span>
            </Detail>
          )}
        </dl>
      </section>
    </div>
  );
}

export default function SecurityChartModal({ securityId, symbol, onClose }) {
  const [period, setPeriod] = useState("1Y");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const { theme } = useTheme();
  const chrome = chartChrome(theme);
  const colors = seriesColors(theme);

  useEffect(() => {
    let live = true;
    Rest.fetchJson(`/api/v2/investments/securities/${securityId}/chart?period=${period}`)
      .then((res) => { if (live) { setData(Rest.unwrap(res)); setError(null); } })
      .catch((e) => live && setError(e.message || String(e)));
    return () => { live = false; };
  }, [securityId, period]);

  // ⚠️ "Still loading" is DERIVED from whether the response we hold is the one
  // that was asked for, not tracked in a second piece of state. Two states that
  // can disagree is how a chart ends up labelled with a period it is not
  // showing — and every label below reads `data.period`, the window the data is
  // actually for, so the caption and the line can never come apart while a new
  // period is in flight.
  const pending = Boolean(data) && data.period !== period;
  const shown = data?.period || period;

  const title = data ? `${data.security.ticker || symbol || "—"} · ${data.security.name}` : (symbol || "Security");
  const merged = data?.chartable ? mergeSeries(data) : [];

  return (
    <Modal open onClose={onClose} size="chart" title={title}>
      {/* The period selector stays mounted while a period loads, so the choice
          the reader just made does not vanish under a spinner. */}
      {data?.chartable !== false && (
        <div className="inv-periods" role="group" aria-label="Chart period">
          {(data?.periods || []).map((p) => (
            <button
              key={p.key}
              type="button"
              className={`btn btn--sm${p.key === period ? " btn--active" : ""}`}
              onClick={() => setPeriod(p.key)}
              aria-pressed={p.key === period}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {!data && !error && <LoadingSpinner />}
      {error && <p className="inv-history__caveat">Could not load this security — {error}</p>}

      {data && !data.chartable && (
        <p className="inv-history__caveat">{data.no_chart_reason}</p>
      )}

      {data?.chartable && (
        <>
          <p className="inv-history__caveat">
            {/* Three percentages, each named. */}
            <strong>{signedPct(data.price_change.pct)}</strong> price change over {shown}
            {" "}({data.window.actual_from} → {data.window.to})
            {data.overlays.map((o) => (
              <span key={o.key}> · {o.label} {signedPct(o.pct)}</span>
            ))}
            . ⚠️ Price only — dividends are not included, so this is not total return, and it is
            not the same as your unrealized gain below, which is measured against what you paid.
            {data.window.truncated && (
              <> ⚠️ History for this security begins {data.history.first}, so the window is
                shorter than {shown}.</>
            )}
          </p>

          <div className="inv-chart" aria-busy={pending}>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={merged} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={chrome.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="d" stroke={chrome.axis} tick={{ fontSize: 11 }} minTickGap={40} />
                {/* Rebased, so the unit is "relative to the start", not dollars. */}
                <YAxis stroke={chrome.axis} tick={{ fontSize: 11 }} width={48}
                  domain={["auto", "auto"]} tickFormatter={(v) => v.toFixed(0)} />
                <Tooltip contentStyle={tooltipStyle}
                  formatter={(v, n) => [v === null ? "—" : `${Number(v).toFixed(1)}`, n]} />
                <Legend wrapperStyle={{ fontSize: "0.78rem" }} />
                {/* 100 is where every series started. */}
                <ReferenceLine y={100} stroke={chrome.axis} strokeDasharray="4 4" />
                <Line type="monotone" dataKey="subject" name={data.security.ticker || "This security"}
                  stroke={colors[0]} dot={false} strokeWidth={2} connectNulls />
                {data.overlays.map((o, i) => (
                  <Line key={o.key} type="monotone" dataKey={o.key} name={o.label}
                    stroke={colors[i + 1]} dot={false} strokeWidth={1.25} connectNulls />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <h3 className="inv-macd__title">MACD 12/26/9</h3>
          <p className="inv-history__caveat">
            {/* ⚠️ Saying the indicator is fully seeded is the point: MACD emits
                nothing for its first ~34 bars, and a chart that draws warm-up
                looks exactly like a chart that draws signal. */}
            {data.macd_complete
              ? `Seeded from ${data.macd_lead_bars} trading days before the window, so every point here is a computed value rather than warm-up.`
              : `⚠️ Not enough history before this window to seed the indicator — the early points are warm-up and are left blank rather than drawn.`}
          </p>
          <div className="inv-chart" aria-busy={pending}>
            <ResponsiveContainer width="100%" height={160}>
              <ComposedChart data={data.macd} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={chrome.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="d" stroke={chrome.axis} tick={{ fontSize: 11 }} minTickGap={40} />
                <YAxis stroke={chrome.axis} tick={{ fontSize: 11 }} width={48} />
                <Tooltip contentStyle={tooltipStyle}
                  formatter={(v, n) => [v === null ? "—" : Number(v).toFixed(3), n]} />
                <Legend wrapperStyle={{ fontSize: "0.78rem" }} />
                <ReferenceLine y={0} stroke={chrome.axis} />
                <Bar dataKey="histogram" name="Histogram" fill={colors[3]} isAnimationActive={false} />
                <Line type="monotone" dataKey="macd" name="MACD" stroke={colors[0]} dot={false} strokeWidth={1.5} connectNulls={false} />
                <Line type="monotone" dataKey="signal" name="Signal" stroke={colors[1]} dot={false} strokeWidth={1.5} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {data && <Details d={data.details} security={data.security} />}
    </Modal>
  );
}
