import { createHmac, randomUUID } from "node:crypto";
import { OFFER_DISCOUNT_PCT } from "./candidates";

export const DISCOUNT_TITLE = "10% off";

export type AddVariantChange = {
  type: "add_variant";
  variantId: number;
  quantity: 1;
  discount: {
    value: number;
    valueType: "percentage";
    title: string;
  };
};

export type ChangesetClaims = {
  iss: string;
  jti: string;
  iat: number;
  sub: string;
  changes: AddVariantChange[];
};

export function discountedPriceCents(
  priceCents: number,
  discountPct = OFFER_DISCOUNT_PCT,
) {
  return Math.round((priceCents * (100 - discountPct)) / 100);
}

export function offerChange(variantId: number): AddVariantChange {
  return {
    type: "add_variant",
    variantId,
    quantity: 1,
    discount: {
      value: OFFER_DISCOUNT_PCT,
      valueType: "percentage",
      title: DISCOUNT_TITLE,
    },
  };
}

export function buildChangesetClaims(input: {
  apiKey: string;
  referenceId: string;
  variantId: number;
  issuedAt?: number;
  jti?: string;
}): ChangesetClaims {
  return {
    iss: input.apiKey,
    jti: input.jti ?? randomUUID(),
    // Unix seconds. The tutorial sample writes Date.now(), and Shopify rejects that millisecond value.
    iat: input.issuedAt ?? Math.floor(Date.now() / 1000),
    sub: input.referenceId,
    changes: [offerChange(input.variantId)],
  };
}

function base64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

export function signChangeset(claims: ChangesetClaims, secret: string) {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify(claims));
  const signature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
}
