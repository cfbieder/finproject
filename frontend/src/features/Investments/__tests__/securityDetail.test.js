import { describe, it, expect } from "vitest";
import {
  noEquitySector, sectorAbsence, ratingLabel, signedPct, BASIS_LABEL, yieldRows,
} from "../securityDetail.js";

describe("sectorAbsence — three reasons, and only one is work to do", () => {
  it("🔴 a bond or CD has no equity sector BY NATURE", () => {
    // This said "not classified yet" for a brokered CD, which reads as
    // outstanding work on something that can never carry an equity sector.
    expect(sectorAbsence({ asset_class: "bond", price_basis: "per_1_face" }))
      .toBe("none — not an equity instrument");
  });

  it("🔴 an FDIC deposit is caught by its PRICE BASIS, not its asset class", () => {
    // Three deposits are classed `unknown` and are plainly not equity — they are
    // held at par. The structural signal is the one `services/exposure.js` uses.
    expect(noEquitySector({ asset_class: "unknown", price_basis: "par" })).toBe(true);
    expect(sectorAbsence({ asset_class: "unknown", price_basis: "par" }))
      .toBe("none — not an equity instrument");
  });

  it("an equity we asked about and got nothing for is not the same as one we never asked", () => {
    const eq = { asset_class: "equity", price_basis: "per_share" };
    expect(sectorAbsence({ ...eq, sector_asked: true })).toBe("asked; none reported");
    expect(sectorAbsence({ ...eq, sector_asked: false })).toBe("not classified yet");
  });
});

describe("ratingLabel", () => {
  it("shows both agencies when both are printed — a split rating is a fact", () => {
    expect(ratingLabel({ moodys_rating: "Baa2", sp_rating: "BBB-" }))
      .toBe("Moody's Baa2 · S&P BBB-");
  });

  it("shows the one that exists when only one does", () => {
    expect(ratingLabel({ moodys_rating: "Baa3", sp_rating: null })).toBe("Moody's Baa3");
  });

  it("🔴 FDIC-insured is not a rating and not the absence of one", () => {
    // Rendering a CD as "none printed" beside genuinely unrated corporate paper
    // would say this holding carries credit risk it does not carry.
    expect(ratingLabel({ moodys_rating: null, sp_rating: null, fdic_insured: true }))
      .toBe("FDIC-insured");
  });

  it("a genuinely unrated bond returns null, for the caller to render as absent", () => {
    expect(ratingLabel({ moodys_rating: null, sp_rating: null, fdic_insured: false })).toBeNull();
    expect(ratingLabel(null)).toBeNull();
  });
});

describe("signedPct", () => {
  it("always carries a sign, so a gain and a loss differ without colour", () => {
    expect(signedPct(0.1865)).toBe("+18.65%");
    expect(signedPct(-0.0497)).toBe("-4.97%");
    expect(signedPct(0)).toBe("+0.00%");
  });

  it("absence is a dash, never 0%", () => {
    expect(signedPct(null)).toBe("—");
    expect(signedPct(undefined)).toBe("—");
  });
});

describe("BASIS_LABEL", () => {
  it("covers every price basis the schema allows", () => {
    // The CHECK constraint on securities.price_basis; a new one appearing here
    // without a label would render as a raw enum.
    expect(Object.keys(BASIS_LABEL).sort())
      .toEqual(["par", "per_100_face", "per_1_face", "per_share"]);
  });
});

describe("yieldRows — a different question on each side of the portfolio", () => {
  it("🔴 a bond shows BOTH coupon and current yield, because they are not the same number", () => {
    // The coupon is what it pays on FACE and never moves; the current yield is
    // that income against what it costs today. IBM 4.75% of 2031 at 98.60.
    const rows = yieldRows({ kind: "coupon", covered: true, coupon_rate: 4.75, price: 98.6007, current_yield: 0.048174 });
    expect(rows.map((r) => r.label)).toEqual(["Coupon", "Current yield"]);
    expect(rows[0].value).toBe("4.75% of face");
    expect(rows[1].value).toContain("4.82%");
  });

  it("🔴 current yield carries the not-YTM qualifier", () => {
    // YTM adds the pull to par over the remaining life. Calling this "yield"
    // unqualified overstates a discount bond and understates a premium one.
    const [, cy] = yieldRows({ kind: "coupon", covered: true, coupon_rate: 4.75, price: 98.6, current_yield: 0.0482 });
    expect(cy.note).toMatch(/not yield to maturity/);
  });

  it("a bond with no price gets no invented current yield", () => {
    const [, cy] = yieldRows({ kind: "coupon", covered: true, coupon_rate: 4.75, price: null, current_yield: null });
    expect(cy.value).toBe("no price");
  });

  it("🔴 'pays nothing' and 'we never asked' are different rows", () => {
    // BRK/B genuinely pays no dividend; FCNTX is a fund the provider does not
    // cover. Showing 0.00% for the second would be a measurement we never took.
    const paysNothing = yieldRows({ kind: "dividend", covered: true, pays_nothing: true });
    expect(paysNothing[0].value).toMatch(/pays no distribution/);

    const neverAsked = yieldRows({ kind: "dividend", covered: false, reason: "Distributions have not been loaded for this security." });
    expect(neverAsked[0].value).toMatch(/not been loaded/);
    expect(neverAsked[0].muted).toBe(true);
  });

  it("an equity shows the trailing-twelve-month yield with the income behind it", () => {
    const rows = yieldRows({
      kind: "dividend", covered: true, pays_nothing: false,
      dividend_yield: 0.0286943, ttm_income: 6.74, ttm_excluded: 0, ttm_excluded_types: [],
    });
    expect(rows[0].value).toBe("2.87% · $6.74/sh over 12 months");
    expect(rows).toHaveLength(1);
  });

  it("🔴 a capital-gains distribution is shown SEPARATELY, never folded into the yield", () => {
    const rows = yieldRows({
      kind: "dividend", covered: true, pays_nothing: false,
      dividend_yield: 0.0286943, ttm_income: 6.74,
      ttm_excluded: 4.5, ttm_excluded_types: ["LT", "ST"],
    });
    expect(rows).toHaveLength(2);
    expect(rows[1].value).toBe("$4.5/sh of LT/ST");
    expect(rows[1].note).toMatch(/not an income rate/);
  });

  it("an incomplete trailing year says it understates", () => {
    const [r] = yieldRows({
      kind: "dividend", covered: true, pays_nothing: false, partial_year: true,
      dividend_yield: 0.01, ttm_income: 1, ttm_excluded: 0, ttm_excluded_types: [],
    });
    expect(r.note).toMatch(/understates/);
  });
});
