import prisma from "../db.server";
import {
  OFFER_DISCOUNT_PCT,
  cartKey,
  chooseOffer,
  gatePurchase,
  isFreshDecision,
  selectCandidates,
} from "./candidates";
import { OPENAI_MODEL, requestOfferPick } from "./llm.server";
import type { CatalogCandidate, PurchaseSnapshot } from "./candidates";

type DecideResult = {
  render: boolean;
  offer?: {
    variantId: number;
    productId: number;
    title: string;
    imageUrl: string;
    headline: string;
    body: string;
    priceCents: number;
    discountPct: number;
  };
  llmMeta: {
    model: string;
    reason: string;
    cached: boolean;
    priceBandRelaxed: boolean;
  };
};

function parseTags(tags: string) {
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function toCandidate(product: {
  productId: string;
  variantId: string;
  title: string;
  tags: string;
  priceCents: number;
  imageUrl: string;
  blurb: string;
  available: boolean;
  marginRank: number;
}): CatalogCandidate {
  return {
    ...product,
    tags: parseTags(product.tags),
  };
}

function declined(reason: string): DecideResult {
  return {
    render: false,
    llmMeta: {
      model: "none",
      reason,
      cached: false,
      priceBandRelaxed: false,
    },
  };
}

export async function decisionForOrder(shop: string, productIds: string[] | null) {
  if (!productIds) {
    return null;
  }

  return prisma.offerDecision.findUnique({
    where: { shop_cartKey: { shop, cartKey: cartKey(productIds) } },
  });
}

export async function decideOffer(shop: string, purchase: PurchaseSnapshot) {
  const gate = gatePurchase(purchase);

  if (!gate.ok) {
    return declined(gate.reason);
  }

  const catalog = (await prisma.catalogProduct.findMany({ where: { shop } })).map(
    toCandidate,
  );
  const productIds = gate.lines.map((line) => String(line.productId));
  const purchased = catalog.filter((product) => productIds.includes(product.productId));
  const selection = selectCandidates(catalog, {
    productIds,
    variantIds: gate.lines.map((line) => String(line.variantId)),
    tags: purchased.flatMap((product) => product.tags),
    subtotalCents: gate.subtotalCents,
  });

  if (selection.candidates.length === 0) {
    return declined("no-candidates");
  }

  const key = cartKey(productIds);
  const cached = await prisma.offerDecision.findUnique({
    where: { shop_cartKey: { shop, cartKey: key } },
  });

  if (cached && isFreshDecision(cached.createdAt)) {
    const stored = JSON.parse(cached.payload) as DecideResult;
    return {
      ...stored,
      llmMeta: { ...stored.llmMeta, cached: true },
    };
  }

  // Titles come from the catalog, not the request body: they go into the prompt, and the
  // decision is cached for every buyer with the same products.
  const purchasedTitles = productIds
    .map((productId) => purchased.find((product) => product.productId === productId)?.title)
    .filter((title): title is string => Boolean(title));
  const choice = await chooseOffer({
    candidates: selection.candidates,
    purchasedTitles,
    complementMatched: selection.complementMatched,
    model: OPENAI_MODEL,
    provider: async () => {
      try {
        return await requestOfferPick({
          purchasedTitles,
          candidates: selection.candidates,
        });
      } catch (error) {
        console.error(
          "Offer model failed",
          error instanceof Error ? error.message : "unknown",
        );
        throw error;
      }
    },
  });

  if (!choice) {
    return declined("no-candidates");
  }

  const result: DecideResult = {
    render: true,
    offer: {
      variantId: Number(choice.product.variantId),
      productId: Number(choice.product.productId),
      title: choice.product.title,
      imageUrl: choice.product.imageUrl,
      headline: choice.headline,
      body: choice.body,
      priceCents: choice.product.priceCents,
      discountPct: OFFER_DISCOUNT_PCT,
    },
    llmMeta: {
      model: choice.model,
      reason: choice.reason,
      cached: false,
      priceBandRelaxed: selection.priceBandRelaxed,
    },
  };

  await prisma.offerDecision.upsert({
    where: { shop_cartKey: { shop, cartKey: key } },
    create: {
      shop,
      cartKey: key,
      variantId: choice.product.variantId,
      payload: JSON.stringify(result),
    },
    update: {
      variantId: choice.product.variantId,
      payload: JSON.stringify(result),
      createdAt: new Date(),
    },
  });

  return result;
}
