import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  productIdsFrom,
  referenceIdFrom,
  shopFromCheckout,
  variantIdFrom,
} from "../offers/checkout-body";
import { isOfferEventType, recordOfferEvent } from "../offers/events.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { cors } = await authenticate.public.checkout(request);
  return cors(new Response(null, { status: 204 }));
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { cors, sessionToken } = await authenticate.public.checkout(request);

  try {
    const body = (await request.json()) as {
      referenceId?: unknown;
      variantId?: unknown;
      eventType?: unknown;
      shopDomain?: unknown;
      productIds?: unknown;
    };
    const referenceId = referenceIdFrom(body.referenceId);
    const variantId = variantIdFrom(body.variantId);

    if (!referenceId || !variantId || !isOfferEventType(body.eventType)) {
      return cors(Response.json({ ok: false }, { status: 400 }));
    }

    const event = await recordOfferEvent({
      shop: shopFromCheckout(sessionToken.dest, body.shopDomain),
      referenceId,
      variantId,
      productIds: productIdsFrom(body.productIds),
      eventType: body.eventType,
    });

    if (!event) {
      return cors(Response.json({ ok: false }, { status: 404 }));
    }

    return cors(Response.json({ ok: true }));
  } catch (error) {
    console.error(
      "Offer event failed",
      error instanceof Error ? error.message : "unknown",
    );
    return cors(Response.json({ ok: false }, { status: 500 }));
  }
};
