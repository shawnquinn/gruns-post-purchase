import assert from "node:assert/strict";
import test from "node:test";
import { formatDollars, formatPercent, summarizeOffers } from "../app/offers/analytics";

const titles = new Map([["54461061136748", "Grüns Fiber Gummies"]]);

test("empty events report zero", () => {
  const summary = summarizeOffers([], titles);

  assert.equal(summary.impressions, 0);
  assert.equal(summary.accepts, 0);
  assert.equal(summary.acceptRate, 0);
  assert.equal(summary.revenueCents, 0);
  assert.deepEqual(summary.offers, []);
});

test("accept rate and revenue use impressions and discounted accepts", () => {
  const summary = summarizeOffers(
    [
      { offerVariantId: "54461061136748", eventType: "impression", revenueDeltaCents: null },
      { offerVariantId: "54461061136748", eventType: "impression", revenueDeltaCents: null },
      { offerVariantId: "54461061136748", eventType: "accept", revenueDeltaCents: 2610 },
      { offerVariantId: "54461061136748", eventType: "reject", revenueDeltaCents: null },
    ],
    titles,
  );

  assert.equal(summary.impressions, 2);
  assert.equal(summary.accepts, 1);
  assert.equal(summary.acceptRate, 0.5);
  assert.equal(summary.revenueCents, 2610);
  assert.equal(summary.offers[0]?.title, "Grüns Fiber Gummies");
  assert.equal(summary.offers[0]?.rejects, 1);
  assert.equal(formatPercent(summary.acceptRate), "50%");
  assert.equal(formatDollars(summary.revenueCents), "$26.10");
});

test("offers sort by revenue", () => {
  const summary = summarizeOffers(
    [
      { offerVariantId: "low", eventType: "impression", revenueDeltaCents: null },
      { offerVariantId: "low", eventType: "accept", revenueDeltaCents: 100 },
      { offerVariantId: "high", eventType: "impression", revenueDeltaCents: null },
      { offerVariantId: "high", eventType: "accept", revenueDeltaCents: 900 },
    ],
    new Map(),
  );

  assert.deepEqual(
    summary.offers.map((offer) => offer.variantId),
    ["high", "low"],
  );
  assert.equal(summary.offers[0]?.title, "Unknown offer");
});
