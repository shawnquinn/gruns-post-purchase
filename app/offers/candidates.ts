import { createHash } from "node:crypto";

export const PRICE_BAND_RATIO = 0.6;
export const MINIMUM_ORDER_CENTS = 50;
export const DECISION_TTL_MS = 15 * 60 * 1000;
export const OFFER_DISCOUNT_PCT = 10;

const COMPLEMENT_RULES = [
  { whenTag: "kids", offerTags: ["immunity"] },
  { whenTag: "sleep", offerTags: ["magnesium"] },
  { whenTag: "daily", offerTags: ["fiber", "travel", "sleep"] },
] as const;

export type CatalogCandidate = {
  productId: string;
  variantId: string;
  title: string;
  tags: string[];
  priceCents: number;
  imageUrl: string;
  blurb: string;
  available: boolean;
  marginRank: number;
};

export type PurchaseLine = {
  productId: number | string;
  variantId: number | string;
  title: string;
  quantity?: number;
  shopMoneyAmount: string;
};

export type PurchaseSnapshot = {
  destinationCountryCode?: string | null;
  lineItems?: PurchaseLine[];
};

export type CandidateSelection = {
  candidates: CatalogCandidate[];
  priceBandRelaxed: boolean;
  complementMatched: boolean;
  subtotalCents: number;
};

export type ModelPick = {
  variantId?: string | number;
  reason?: string;
  headline?: string;
  body?: string;
};

export type OfferChoice = {
  product: CatalogCandidate;
  headline: string;
  body: string;
  reason: string;
  model: string;
};

export function moneyToCents(amount: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
    return 0;
  }

  const [whole, fraction = ""] = amount.split(".");
  return Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
}

export function shopDomainFromDest(dest: string) {
  return dest.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function cartKey(productIds: string[]) {
  return createHash("sha256").update([...productIds].sort().join(",")).digest("hex");
}

export function isFreshDecision(createdAt: Date, now = Date.now()) {
  return now - createdAt.getTime() < DECISION_TTL_MS;
}

// ShouldRender can run before the buyer enters a shipping address, and Shopify doesn't call it
// again, so a missing destinationCountryCode must not block the offer.
export function gatePurchase(purchase: PurchaseSnapshot) {
  const lines = (purchase.lineItems ?? []).filter(
    (line) => line && line.title && line.shopMoneyAmount,
  );
  const subtotalCents = lines.reduce(
    (sum, line) => sum + moneyToCents(String(line.shopMoneyAmount)),
    0,
  );

  if (subtotalCents < MINIMUM_ORDER_CENTS) {
    return { ok: false as const, reason: "below-minimum" };
  }

  return {
    ok: true as const,
    subtotalCents,
    lines,
  };
}

function complementTags(purchasedTags: string[]): string[] {
  const rule = COMPLEMENT_RULES.find((candidate) =>
    purchasedTags.includes(candidate.whenTag),
  );

  return rule ? [...rule.offerTags] : [];
}

export function selectCandidates(
  products: CatalogCandidate[],
  purchase: {
    productIds: string[];
    variantIds: string[];
    tags: string[];
    subtotalCents: number;
  },
): CandidateSelection {
  const inCart = new Set([...purchase.productIds, ...purchase.variantIds]);
  const available = products.filter(
    (product) =>
      product.available &&
      !inCart.has(product.productId) &&
      !inCart.has(product.variantId),
  );
  const wantedTags = complementTags(purchase.tags);
  const complements = wantedTags.length
    ? available.filter((product) =>
        product.tags.some((tag) => wantedTags.includes(tag)),
      )
    : [];
  const complementMatched = complements.length > 0;
  const pool = complementMatched ? complements : available;
  const ceiling = Math.floor(purchase.subtotalCents * PRICE_BAND_RATIO);
  const inBand = pool.filter((product) => product.priceCents <= ceiling);

  if (inBand.length > 0) {
    return {
      candidates: inBand,
      priceBandRelaxed: false,
      complementMatched,
      subtotalCents: purchase.subtotalCents,
    };
  }

  const cheapest = [...pool].sort((left, right) => left.priceCents - right.priceCents)[0];

  return {
    candidates: cheapest ? [cheapest] : [],
    priceBandRelaxed: true,
    complementMatched,
    subtotalCents: purchase.subtotalCents,
  };
}

export function pickFallback(
  candidates: CatalogCandidate[],
  complementMatched: boolean,
) {
  if (candidates.length === 0) {
    return null;
  }

  const ranked = [...candidates];

  if (complementMatched) {
    ranked.sort(
      (left, right) =>
        right.marginRank - left.marginRank || left.priceCents - right.priceCents,
    );
    return ranked[0];
  }

  ranked.sort((left, right) => left.priceCents - right.priceCents);
  return ranked[0];
}

export function fallbackCopy(product: CatalogCandidate, purchasedTitles: string[]) {
  const bought = purchasedTitles[0] || "your order";

  return {
    headline: `Add ${product.title}`,
    body: `You already chose ${bought}. ${product.title} is the match we would add next.`,
    reason: "Deterministic complement fallback",
  };
}

export function acceptModelPick(pick: ModelPick | null, candidates: CatalogCandidate[]) {
  if (!pick || pick.variantId === undefined || pick.variantId === null) {
    return null;
  }

  const variantId = String(pick.variantId);
  const product = candidates.find((candidate) => candidate.variantId === variantId);

  if (!product || !pick.headline || !pick.body) {
    return null;
  }

  return {
    product,
    headline: pick.headline,
    body: pick.body,
    reason: pick.reason || "Selected by model",
  };
}

type OfferProvider = () => Promise<ModelPick>;

export async function chooseOffer(input: {
  candidates: CatalogCandidate[];
  purchasedTitles: string[];
  complementMatched: boolean;
  model: string;
  provider: OfferProvider;
}): Promise<OfferChoice | null> {
  const fallbackProduct = pickFallback(input.candidates, input.complementMatched);

  if (!fallbackProduct) {
    return null;
  }

  try {
    const pick = await input.provider();
    const accepted = acceptModelPick(pick, input.candidates);

    if (!accepted) {
      const copy = fallbackCopy(fallbackProduct, input.purchasedTitles);
      return {
        product: fallbackProduct,
        ...copy,
        model: "fallback",
      };
    }

    return {
      product: accepted.product,
      headline: accepted.headline,
      body: accepted.body,
      reason: accepted.reason,
      model: input.model,
    };
  } catch {
    const copy = fallbackCopy(fallbackProduct, input.purchasedTitles);
    return {
      product: fallbackProduct,
      ...copy,
      model: "fallback",
    };
  }
}
