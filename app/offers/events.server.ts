import prisma from "../db.server";
import { OFFER_DISCOUNT_PCT } from "./candidates";
import { discountedPriceCents } from "./changeset";
import { decisionForOrder } from "./decide.server";

const EVENT_TYPES = ["impression", "accept", "reject"] as const;
const UNKNOWN_META = { llmModel: "unknown", llmReason: "" };

export type OfferEventType = (typeof EVENT_TYPES)[number];

export function isOfferEventType(value: unknown): value is OfferEventType {
  return (EVENT_TYPES as readonly unknown[]).includes(value);
}

function decisionMeta(payload: string) {
  try {
    const stored = JSON.parse(payload) as {
      llmMeta?: { model?: string; reason?: string };
    };

    return {
      llmModel: stored.llmMeta?.model || "unknown",
      llmReason: stored.llmMeta?.reason || "",
    };
  } catch {
    return UNKNOWN_META;
  }
}

async function metaForOrder(shop: string, productIds: string[] | null, variantId: string) {
  const decision = await decisionForOrder(shop, productIds);

  if (!decision || decision.variantId !== variantId) {
    return UNKNOWN_META;
  }

  return decisionMeta(decision.payload);
}

export async function recordOfferEvent(input: {
  shop: string;
  referenceId: string;
  variantId: number;
  productIds: string[] | null;
  eventType: OfferEventType;
}) {
  const product = await prisma.catalogProduct.findUnique({
    where: {
      shop_variantId: { shop: input.shop, variantId: String(input.variantId) },
    },
  });

  if (!product) {
    return null;
  }

  const meta = await metaForOrder(input.shop, input.productIds, product.variantId);

  return prisma.offerEvent.upsert({
    where: {
      shop_orderReferenceId_eventType: {
        shop: input.shop,
        orderReferenceId: input.referenceId,
        eventType: input.eventType,
      },
    },
    create: {
      shop: input.shop,
      orderReferenceId: input.referenceId,
      offerVariantId: product.variantId,
      offerProductId: product.productId,
      eventType: input.eventType,
      discountPct: OFFER_DISCOUNT_PCT,
      revenueDeltaCents:
        input.eventType === "accept"
          ? discountedPriceCents(product.priceCents)
          : null,
      llmModel: meta.llmModel,
      llmReason: meta.llmReason,
    },
    update: {
      offerVariantId: product.variantId,
      offerProductId: product.productId,
      discountPct: OFFER_DISCOUNT_PCT,
      revenueDeltaCents:
        input.eventType === "accept"
          ? discountedPriceCents(product.priceCents)
          : null,
      llmModel: meta.llmModel,
      llmReason: meta.llmReason,
    },
  });
}
