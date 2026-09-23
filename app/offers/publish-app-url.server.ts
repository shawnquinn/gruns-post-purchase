import { unauthenticated } from "../shopify.server";

const SHOP = process.env.SHOP || "gruns-quinn-upsell.myshopify.com";
let publishedOrigin: string | null = null;
let publishing: Promise<boolean> | null = null;

export function appOriginFromEnv() {
  const value = process.env.HOST || process.env.SHOPIFY_APP_URL || "";

  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function publishAppUrl() {
  const origin = appOriginFromEnv();

  if (!origin) {
    return Promise.resolve(false);
  }

  if (origin === publishedOrigin) {
    return Promise.resolve(true);
  }

  if (!publishing) {
    publishing = writeAppUrl(origin).finally(() => {
      publishing = null;
    });
  }

  return publishing;
}

async function writeAppUrl(origin: string): Promise<boolean> {
  try {
    const { admin } = await unauthenticated.admin(SHOP);
    const shopResponse = await admin.graphql(`#graphql
      query PostPurchaseShopId {
        shop {
          id
        }
      }
    `);
    const shopJson = (await shopResponse.json()) as {
      data?: { shop?: { id?: string } };
    };
    const ownerId = shopJson.data?.shop?.id;

    if (!ownerId) {
      console.error("App URL publish failed: shop id missing");
      return false;
    }

    const writeResponse = await admin.graphql(
      `#graphql
        mutation PublishPostPurchaseAppUrl($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
              key
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          metafields: [
            {
              ownerId,
              namespace: "$app",
              key: "app_url",
              type: "single_line_text_field",
              value: origin,
            },
          ],
        },
      },
    );
    const writeJson = (await writeResponse.json()) as {
      data?: { metafieldsSet?: { userErrors?: Array<{ message: string }> } };
    };
    const errors = writeJson.data?.metafieldsSet?.userErrors ?? [];

    if (errors.length > 0) {
      console.error(
        "App URL publish failed",
        errors.map((error) => error.message).join("; "),
      );
      return false;
    }

    publishedOrigin = origin;
    console.info("Post-purchase app URL published");
    return true;
  } catch (error) {
    console.error(
      "App URL publish failed",
      error instanceof Error ? error.message : "unknown",
    );
    return false;
  }
}
