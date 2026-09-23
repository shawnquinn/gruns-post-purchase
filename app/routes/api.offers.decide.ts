import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { shopFromCheckout } from "../offers/checkout-body";
import { decideOffer } from "../offers/decide.server";
import type { PurchaseSnapshot } from "../offers/candidates";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { cors } = await authenticate.public.checkout(request);
  return cors(new Response(null, { status: 204 }));
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const startedAt = Date.now();
  const { cors, sessionToken } = await authenticate.public.checkout(request);

  try {
    const body = (await request.json()) as PurchaseSnapshot & { shopDomain?: unknown };
    const result = await decideOffer(
      shopFromCheckout(sessionToken.dest, body.shopDomain),
      body,
    );
    const outcome = result.render
      ? `offer from ${result.llmMeta.model}${result.llmMeta.cached ? " (cached)" : ""}`
      : `no offer (${result.llmMeta.reason})`;
    console.info(`Offer decide: ${outcome} in ${Date.now() - startedAt}ms`);
    return cors(Response.json(result));
  } catch (error) {
    console.error(
      "Offer decide failed",
      error instanceof Error ? error.message : "unknown",
    );
    return cors(
      Response.json(
        {
          render: false,
          llmMeta: {
            model: "none",
            reason: "decide-error",
            cached: false,
            priceBandRelaxed: false,
          },
        },
        { status: 500 },
      ),
    );
  }
};
