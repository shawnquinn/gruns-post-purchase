import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acceptModelPick,
  cartKey,
  chooseOffer,
  gatePurchase,
  selectCandidates,
} from "../app/offers/candidates";
import type { CatalogCandidate } from "../app/offers/candidates";

const catalog: CatalogCandidate[] = [
  product("1", "11", "Daily Gummies", ["daily", "greens"], 7900, 40),
  product("2", "22", "Kids Daily Gummies", ["kids", "daily"], 3900, 45),
  product("3", "33", "Fiber Gummies", ["fiber", "gut"], 2900, 90),
  product("4", "44", "Sleep Gummies", ["sleep", "night"], 3200, 80),
  product("5", "55", "Immunity Gummies", ["immunity"], 2800, 85),
  product("6", "66", "Travel Packs", ["travel"], 1800, 70),
  product("7", "77", "Magnesium Night", ["magnesium", "sleep"], 2700, 95),
  product("8", "88", "Sold Out Powder", ["powder"], 3600, 50, false),
];

function product(
  productId: string,
  variantId: string,
  title: string,
  tags: string[],
  priceCents: number,
  marginRank: number,
  available = true,
): CatalogCandidate {
  return {
    productId,
    variantId,
    title,
    tags,
    priceCents,
    imageUrl: "",
    blurb: title,
    available,
    marginRank,
  };
}

describe("selectCandidates", () => {
  it("drops products already in the order, sold-out products, and prices above 60 percent", () => {
    const selection = selectCandidates(catalog, {
      productIds: ["1"],
      variantIds: ["11"],
      tags: ["daily", "greens"],
      subtotalCents: 7900,
    });

    assert.equal(selection.priceBandRelaxed, false);
    assert.equal(selection.complementMatched, true);
    assert.deepEqual(
      selection.candidates.map((candidate) => candidate.variantId).sort(),
      ["33", "44", "66", "77"],
    );
  });

  it("prefers immunity when the purchased tags are kids", () => {
    const selection = selectCandidates(catalog, {
      productIds: ["2"],
      variantIds: ["22"],
      tags: ["kids", "daily"],
      subtotalCents: 5000,
    });

    assert.equal(selection.priceBandRelaxed, false);
    assert.deepEqual(
      selection.candidates.map((candidate) => candidate.title),
      ["Immunity Gummies"],
    );
  });

  it("keeps the cheapest remaining product when the price band is empty", () => {
    const selection = selectCandidates(catalog, {
      productIds: ["6"],
      variantIds: ["66"],
      tags: ["travel"],
      subtotalCents: 1800,
    });

    assert.equal(selection.priceBandRelaxed, true);
    assert.equal(selection.complementMatched, false);
    assert.equal(selection.candidates[0]?.title, "Magnesium Night");
    assert.equal(selection.candidates[0]?.priceCents, 2700);
  });
});

describe("gatePurchase", () => {
  it("allows a checkout that has no shipping country yet", () => {
    const result = gatePurchase({
      destinationCountryCode: null,
      lineItems: [
        {
          productId: 1,
          variantId: 11,
          title: "Daily Gummies",
          shopMoneyAmount: "79.00",
        },
      ],
    });

    assert.equal(result.ok, true);
  });

  it("rejects an order under fifty cents", () => {
    const result = gatePurchase({
      destinationCountryCode: "US",
      lineItems: [
        {
          productId: 1,
          variantId: 11,
          title: "Sample",
          shopMoneyAmount: "0.25",
        },
      ],
    });

    assert.equal(result.ok, false);
  });
});

describe("chooseOffer", () => {
  it("rejects a variant id that is not in the candidate list", async () => {
    const choice = await chooseOffer({
      candidates: [catalog[2], catalog[3]],
      purchasedTitles: ["Daily Gummies"],
      complementMatched: true,
      model: "gpt-4o-mini",
      provider: async () => ({
        variantId: "999",
        reason: "invented",
        headline: "Nope",
        body: "Nope",
      }),
    });

    assert.equal(choice?.model, "fallback");
    assert.equal(choice?.product.variantId, "33");
    assert.match(choice?.body ?? "", /Daily Gummies/);
  });

  it("uses the fallback when the provider throws", async () => {
    const choice = await chooseOffer({
      candidates: [catalog[4], catalog[5]],
      purchasedTitles: ["Kids Daily Gummies"],
      complementMatched: true,
      model: "gpt-4o-mini",
      provider: async () => {
        throw new Error("timeout");
      },
    });

    assert.equal(choice?.model, "fallback");
    assert.equal(choice?.product.variantId, "55");
  });
});

describe("acceptModelPick", () => {
  it("accepts a candidate id", () => {
    const accepted = acceptModelPick(
      {
        variantId: "33",
        reason: "fiber",
        headline: "Add fiber",
        body: "Pair it with daily gummies.",
      },
      [catalog[2]],
    );

    assert.equal(accepted?.product.variantId, "33");
  });
});

describe("cartKey", () => {
  it("ignores line order", () => {
    assert.equal(cartKey(["2", "1"]), cartKey(["1", "2"]));
    assert.notEqual(cartKey(["1"]), cartKey(["1", "2"]));
  });
});
