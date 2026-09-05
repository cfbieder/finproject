import { describe, it, expect } from "vitest";
import {
  noEquitySector, sectorAbsence, ratingLabel, signedPct, BASIS_LABEL,
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
