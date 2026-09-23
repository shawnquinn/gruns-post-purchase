import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  buildChangesetClaims,
  discountedPriceCents,
  signChangeset,
} from "../app/offers/changeset";
import { productIdsFrom, shopFromCheckout } from "../app/offers/checkout-body";

test("event product ids must all be positive integers", () => {
  assert.deepEqual(productIdsFrom([15304124137836, "15304124170604"]), [
    "15304124137836",
    "15304124170604",
  ]);
  assert.equal(productIdsFrom([15304124137836, "not-an-id"]), null);
  assert.equal(productIdsFrom([]), null);
  assert.equal(productIdsFrom(undefined), null);
});

test("checkout shop falls back when the post-purchase token has no dest", () => {
  assert.equal(shopFromCheckout(undefined), "gruns-quinn-upsell.myshopify.com");
  assert.equal(
    shopFromCheckout("https://gruns-quinn-upsell.myshopify.com"),
    "gruns-quinn-upsell.myshopify.com",
  );
  assert.equal(
    shopFromCheckout(undefined, "gruns-quinn-upsell.myshopify.com"),
    "gruns-quinn-upsell.myshopify.com",
  );
});

test("discounted unit price is 10 percent off the catalog price", () => {
  assert.equal(discountedPriceCents(2900), 2610);
  assert.equal(discountedPriceCents(7900), 7110);
});

test("signed changeset uses the catalog variant and ignores client discounts", () => {
  const claims = buildChangesetClaims({
    apiKey: "test-key",
    referenceId: "order-reference",
    variantId: 54461061136748,
    issuedAt: 1_700_000_000,
    jti: "fixed-jti",
  });
  const token = signChangeset(claims, "test-secret");
  const [header, payload, signature] = token.split(".");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
  const expected = createHmac("sha256", "test-secret")
    .update(`${header}.${payload}`)
    .digest("base64url");

  assert.equal(signature, expected);
  assert.equal(JSON.parse(Buffer.from(header, "base64url").toString()).alg, "HS256");
  assert.equal(decoded.iss, "test-key");
  assert.equal(decoded.sub, "order-reference");
  assert.equal(decoded.iat, 1_700_000_000);
  assert.equal(decoded.changes.length, 1);
  assert.deepEqual(decoded.changes[0], {
    type: "add_variant",
    variantId: 54461061136748,
    quantity: 1,
    discount: { value: 10, valueType: "percentage", title: "10% off" },
  });
});
