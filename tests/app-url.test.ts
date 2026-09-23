import assert from "node:assert/strict";
import test from "node:test";
import { chooseAppUrl } from "../extensions/post-purchase-offer/src/app-url";

test("a dev tunnel script origin wins over a stale metafield", () => {
  assert.equal(
    chooseAppUrl({
      scriptOrigin: "https://camp-has-amber-grades.trycloudflare.com/extensions/offer.js",
      metafieldValue: "https://old-tunnel.trycloudflare.com",
    }),
    "https://camp-has-amber-grades.trycloudflare.com",
  );
});

test("a Shopify-hosted script uses the shop metafield", () => {
  assert.equal(
    chooseAppUrl({
      scriptOrigin: "https://cdn.shopify.com/extensions/offer.js",
      metafieldValue: "https://camp-has-amber-grades.trycloudflare.com",
    }),
    "https://camp-has-amber-grades.trycloudflare.com",
  );
});

test("missing urls do not invent a host", () => {
  assert.equal(chooseAppUrl({}), null);
  assert.equal(chooseAppUrl({ metafieldValue: "http://insecure.example" }), null);
});
