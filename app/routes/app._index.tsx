import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { formatDollars, formatPercent, summarizeOffers } from "../offers/analytics";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [events, products] = await Promise.all([
    prisma.offerEvent.findMany({
      where: { shop: session.shop },
      select: {
        offerVariantId: true,
        eventType: true,
        revenueDeltaCents: true,
      },
    }),
    prisma.catalogProduct.findMany({
      where: { shop: session.shop },
      select: { variantId: true, title: true },
    }),
  ]);
  const titles = new Map(products.map((product) => [product.variantId, product.title]));

  return summarizeOffers(events, titles);
};

export default function Index() {
  const summary = useLoaderData<typeof loader>();

  return (
    <s-page heading="Post-purchase offers">
      <s-section heading="Performance">
        <s-grid gridTemplateColumns="repeat(3, minmax(0, 1fr))" gap="base">
          <Metric label="Impressions" value={String(summary.impressions)} />
          <Metric label="Accept rate" value={formatPercent(summary.acceptRate)} />
          <Metric label="Incremental revenue" value={formatDollars(summary.revenueCents)} />
        </s-grid>
      </s-section>

      <s-section heading="Offers">
        {summary.offers.length === 0 ? (
          <s-paragraph>
            No offers yet. Check out Grüns Daily Gummies with Bogus Gateway to record one.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Offer</s-table-header>
              <s-table-header format="numeric">Impressions</s-table-header>
              <s-table-header format="numeric">Accepts</s-table-header>
              <s-table-header format="numeric">Rejects</s-table-header>
              <s-table-header format="numeric">Revenue</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {summary.offers.map((offer) => (
                <s-table-row key={offer.variantId}>
                  <s-table-cell>{offer.title}</s-table-cell>
                  <s-table-cell>{offer.impressions}</s-table-cell>
                  <s-table-cell>{offer.accepts}</s-table-cell>
                  <s-table-cell>{offer.rejects}</s-table-cell>
                  <s-table-cell>{formatDollars(offer.revenueCents)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
      <s-stack direction="block" gap="base">
        <s-text>{label}</s-text>
        <s-heading>{value}</s-heading>
      </s-stack>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
