import { useEffect, useMemo, useState } from "react";
import {
  extend,
  render,
  useExtensionInput,
  type PostPurchaseRenderApi,
  Banner,
  BlockStack,
  Button,
  CalloutBanner,
  Heading,
  Image,
  Layout,
  Separator,
  Text,
  TextBlock,
  TextContainer,
  Tiles,
} from "@shopify/post-purchase-ui-extensions-react";
import { chooseAppUrl } from "./app-url";

const DECIDE_TIMEOUT_MS = 4000;
const FAILURE_PAUSE_MS = 1600;

type OfferPayload = {
  variantId: number;
  productId: number;
  title: string;
  imageUrl: string;
  headline: string;
  body: string;
  priceCents: number;
  discountPct: number;
};

type DecideResponse = {
  render?: boolean;
  offer?: OfferPayload;
};

type PurchaseInput = {
  token: string;
  shop: {
    domain: string;
    metafields?: Array<{ key: string; value: string | number }>;
  };
  initialPurchase: {
    referenceId: string;
    destinationCountryCode?: string;
    lineItems: Array<{
      quantity: number;
      product: { id: number; title: string; variant: { id: number } };
      totalPriceSet: { shopMoney: { amount: string } };
    }>;
  };
};

type CheckoutContext = {
  appUrl: string;
  token: string;
  shopDomain: string;
  referenceId: string;
  productIds: number[];
};

type CalculatedMoney = {
  originalPrice?: string;
  discountedPrice?: string;
  shipping?: string;
  taxes?: string;
  total?: string;
};

extend("Checkout::PostPurchase::ShouldRender", async ({ inputData, storage }) => {
  const purchase = inputData as PurchaseInput;
  const appUrl = appUrlFor(purchase);

  if (!appUrl) {
    return { render: false };
  }

  const decision = await fetchDecision(purchase, appUrl);

  if (!decision?.render || !decision.offer?.variantId) {
    return { render: false };
  }

  try {
    await storage.update({ ...decision, appUrl });
  } catch {
    return { render: false };
  }

  return { render: true };
});

render("Checkout::PostPurchase::Render", () => <App />);

export function App() {
  const { storage, inputData, calculateChangeset, applyChangeset, done } =
    useExtensionInput<"Checkout::PostPurchase::Render">();
  const stored = storage.initialData as (DecideResponse & { appUrl?: string }) | undefined;
  const appUrl = appUrlFor(inputData as PurchaseInput) || stored?.appUrl;
  const [offer, setOffer] = useState<OfferPayload | undefined>(stored?.offer);
  const [lookupDone, setLookupDone] = useState(Boolean(stored?.offer));

  // Some checkouts run Render where ShouldRender's storage isn't readable (Shop Pay is documented;
  // the dev preview link behaves the same). The app has the decision cached, so ask again.
  useEffect(() => {
    if (lookupDone) {
      return;
    }

    if (!appUrl) {
      setLookupDone(true);
      return;
    }

    fetchDecision(inputData as PurchaseInput, appUrl)
      .then((decision) => {
        if (decision?.render && decision.offer) {
          setOffer(decision.offer);
        }
      })
      .finally(() => setLookupDone(true));
  }, [appUrl, inputData, lookupDone]);

  useEffect(() => {
    if (lookupDone && (!offer || !appUrl)) {
      void done();
    }
  }, [appUrl, done, lookupDone, offer]);

  const checkout = useMemo<CheckoutContext | null>(() => {
    if (!appUrl) {
      return null;
    }

    const purchase = inputData as PurchaseInput;

    return {
      appUrl,
      token: purchase.token,
      shopDomain: purchase.shop.domain,
      referenceId: purchase.initialPurchase.referenceId,
      productIds: purchase.initialPurchase.lineItems.map((line) => line.product.id),
    };
  }, [appUrl, inputData]);

  if (!offer || !checkout) {
    return null;
  }

  return (
    <OfferPage
      checkout={checkout}
      offer={offer}
      calculateChangeset={calculateChangeset}
      applyChangeset={applyChangeset}
      done={done}
    />
  );
}

function OfferPage({
  checkout,
  offer,
  calculateChangeset,
  applyChangeset,
  done,
}: {
  checkout: CheckoutContext;
  offer: OfferPayload;
  calculateChangeset: PostPurchaseRenderApi["calculateChangeset"];
  applyChangeset: PostPurchaseRenderApi["applyChangeset"];
  done: PostPurchaseRenderApi["done"];
}) {
  const [loading, setLoading] = useState(true);
  const [prices, setPrices] = useState<CalculatedMoney>({});
  const [error, setError] = useState("");

  useEffect(() => {
    void postEvent(checkout, offer.variantId, "impression");
  }, [checkout, offer.variantId]);

  useEffect(() => {
    const change = {
      type: "add_variant" as const,
      variantId: offer.variantId,
      quantity: 1,
      discount: {
        value: offer.discountPct,
        valueType: "percentage" as const,
        title: "10% off",
      },
    };

    calculateChangeset({ changes: [change] })
      .then((result) => {
        const purchase = result.calculatedPurchase;
        const line = purchase?.updatedLineItems.find(
          (item) => item.variantId === offer.variantId,
        );

        if (result.status !== "processed" || !line || !purchase) {
          return;
        }

        setPrices({
          originalPrice: line.priceSet.presentmentMoney.amount,
          discountedPrice: line.totalPriceSet.presentmentMoney.amount,
          shipping: purchase.addedShippingLines[0]?.priceSet.presentmentMoney.amount,
          taxes: purchase.addedTaxLines[0]?.priceSet.presentmentMoney.amount,
          total: purchase.totalOutstandingSet.presentmentMoney.amount,
        });
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [calculateChangeset, offer.discountPct, offer.variantId]);

  const finishAfterFailure = () => {
    setError("We couldn't add this offer. Your original order is unchanged.");
    setLoading(false);
    setTimeout(() => {
      void done();
    }, FAILURE_PAUSE_MS);
  };

  const handleAccept = async () => {
    setLoading(true);
    setError("");

    try {
      const signed = await postCheckout<{ token?: string }>(checkout, "/api/offers/sign-changeset", {
        referenceId: checkout.referenceId,
        variantId: offer.variantId,
        shopDomain: checkout.shopDomain,
        productIds: checkout.productIds,
      });

      if (!signed?.token) {
        finishAfterFailure();
        return;
      }

      const result = await applyChangeset(signed.token);

      if (result.status !== "processed") {
        finishAfterFailure();
        return;
      }

      await postEvent(checkout, offer.variantId, "accept");
      await done();
    } catch {
      finishAfterFailure();
    }
  };

  const handleDecline = async () => {
    setLoading(true);
    await postEvent(checkout, offer.variantId, "reject");
    await done();
  };

  const payLabel = prices.total ? `Pay now · ${formatCurrency(prices.total)}` : "Pay now";

  return (
    <BlockStack spacing="loose">
      {error ? <Banner status="critical" title={error} /> : null}
      <CalloutBanner spacing="loose">
        <TextContainer alignment="center" spacing="tight">
          <Heading level={1}>{offer.headline}</Heading>
          <TextBlock size="large">{offer.body}</TextBlock>
        </TextContainer>
      </CalloutBanner>
      <Layout
        media={[
          { viewportSize: "small", sizes: [1, 0, 1], maxInlineSize: 0.9 },
          { viewportSize: "medium", sizes: [532, 0, 1], maxInlineSize: 420 },
          { viewportSize: "large", sizes: [560, 38, 340] },
        ]}
      >
        {offer.imageUrl ? (
          <Image description={offer.title} source={offer.imageUrl} />
        ) : (
          <BlockStack />
        )}
        <BlockStack />
        <BlockStack spacing="loose">
          <Heading level={2}>{offer.title}</Heading>
          <TextContainer alignment="leading" spacing="loose">
            <Text role="deletion" size="large">
              {loading ? "—" : formatCurrency(prices.originalPrice)}
            </Text>
            <Text emphasized size="large" appearance="critical">
              {loading ? "" : ` ${formatCurrency(prices.discountedPrice)}`}
            </Text>
          </TextContainer>
          <BlockStack spacing="tight">
            <Separator />
            <MoneyLine label="Subtotal" amount={prices.discountedPrice} loading={loading} />
            <MoneyLine label="Shipping" amount={prices.shipping} loading={loading} />
            <MoneyLine label="Taxes" amount={prices.taxes} loading={loading} />
            <Separator />
            <MoneyLine label="Total" amount={prices.total} loading={loading} emphasized />
          </BlockStack>
          <BlockStack>
            <Button
              onPress={() => {
                void handleAccept();
              }}
              submit
              loading={loading}
              disabled={Boolean(error)}
            >
              {payLabel}
            </Button>
            <Button
              onPress={() => {
                void handleDecline();
              }}
              subdued
              loading={loading}
              disabled={Boolean(error)}
            >
              Decline this offer
            </Button>
          </BlockStack>
        </BlockStack>
      </Layout>
    </BlockStack>
  );
}

function MoneyLine({
  label,
  amount,
  loading,
  emphasized = false,
}: {
  label: string;
  amount?: string;
  loading: boolean;
  emphasized?: boolean;
}) {
  return (
    <Tiles>
      <TextBlock size={emphasized ? "medium" : "small"} emphasized={emphasized}>
        {label}
      </TextBlock>
      <TextContainer alignment="trailing">
        <TextBlock emphasized size={emphasized ? "medium" : "small"}>
          {loading ? "—" : formatCurrency(amount)}
        </TextBlock>
      </TextContainer>
    </Tiles>
  );
}

function formatCurrency(amount?: string) {
  if (!amount) {
    return "—";
  }

  const value = Number(amount);

  if (!Number.isFinite(value)) {
    return "—";
  }

  if (value === 0) {
    return "Free";
  }

  return `$${value.toFixed(2)}`;
}

function scriptOrigin() {
  try {
    return self.location?.href ?? null;
  } catch {
    return null;
  }
}

function metafieldValue(shop: PurchaseInput["shop"]) {
  const field = shop.metafields?.find((item) => item.key === "app_url");
  return typeof field?.value === "string" ? field.value : null;
}

function appUrlFor(purchase: PurchaseInput) {
  return chooseAppUrl({
    scriptOrigin: scriptOrigin(),
    metafieldValue: metafieldValue(purchase.shop),
  });
}

async function fetchDecision(inputData: PurchaseInput, appUrl: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DECIDE_TIMEOUT_MS);

  try {
    const response = await fetch(`${appUrl}/api/offers/decide`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${inputData.token}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        referenceId: inputData.initialPurchase.referenceId,
        shopDomain: inputData.shop.domain,
        destinationCountryCode: inputData.initialPurchase.destinationCountryCode ?? null,
        lineItems: inputData.initialPurchase.lineItems.map((line) => ({
          productId: line.product.id,
          variantId: line.product.variant.id,
          title: line.product.title,
          quantity: line.quantity,
          shopMoneyAmount: line.totalPriceSet.shopMoney.amount,
        })),
      }),
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as DecideResponse;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function postCheckout<T>(checkout: CheckoutContext, path: string, body: unknown) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DECIDE_TIMEOUT_MS);

  try {
    const response = await fetch(`${checkout.appUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${checkout.token}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function postEvent(
  checkout: CheckoutContext,
  variantId: number,
  eventType: "impression" | "accept" | "reject",
) {
  await postCheckout(checkout, "/api/offers/events", {
    referenceId: checkout.referenceId,
    shopDomain: checkout.shopDomain,
    productIds: checkout.productIds,
    variantId,
    eventType,
  });
}
