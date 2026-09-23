import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { buildChangesetClaims, signChangeset } from "../offers/changeset";
import {
  productIdsFrom,
  referenceIdFrom,
  shopFromCheckout,
  variantIdFrom,
} from "../offers/checkout-body";
import { decisionForOrder } from "../offers/decide.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { cors } = await authenticate.public.checkout(request);
  return cors(new Response(null, { status: 204 }));
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { cors, sessionToken } = await authenticate.public.checkout(request);
  const apiKey = process.env.SHOPIFY_API_KEY;
  const apiSecret = process.env.SHOPIFY_API_SECRET;

  if (!apiKey || !apiSecret) {
    return cors(Response.json({ error: "missing-app-credentials" }, { status: 500 }));
  }

  try {
    const body = (await request.json()) as {
      referenceId?: unknown;
      variantId?: unknown;
      shopDomain?: unknown;
      productIds?: unknown;
    };
    const referenceId = referenceIdFrom(body.referenceId);
    const variantId = variantIdFrom(body.variantId);

    if (!referenceId || !variantId) {
      return cors(Response.json({ error: "invalid-offer" }, { status: 400 }));
    }

    const shop = shopFromCheckout(sessionToken.dest, body.shopDomain);
    const decision = await decisionForOrder(shop, productIdsFrom(body.productIds));

    if (decision?.variantId !== String(variantId)) {
      return cors(Response.json({ error: "not-offered" }, { status: 403 }));
    }

    const product = await prisma.catalogProduct.findUnique({
      where: { shop_variantId: { shop, variantId: String(variantId) } },
    });

    if (!product?.available) {
      return cors(Response.json({ error: "unknown-offer" }, { status: 404 }));
    }

    const token = signChangeset(
      buildChangesetClaims({ apiKey, referenceId, variantId }),
      apiSecret,
    );

    return cors(Response.json({ token }));
  } catch (error) {
    console.error(
      "Offer sign failed",
      error instanceof Error ? error.message : "unknown",
    );
    return cors(Response.json({ error: "sign-error" }, { status: 500 }));
  }
};
