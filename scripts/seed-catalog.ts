import prisma from "../app/db.server";
import { unauthenticated } from "../app/shopify.server";

const SHOP = process.env.SHOP || "gruns-quinn-upsell.myshopify.com";

const PRODUCTS = [
  {
    handle: "gruns-daily-gummies",
    title: "Grüns Daily Gummies",
    price: "79.00",
    tags: ["daily", "greens", "core"],
    marginRank: 40,
    blurb: "The everyday greens gummy most orders start with.",
  },
  {
    handle: "gruns-kids-daily-gummies",
    title: "Grüns Kids Daily Gummies",
    price: "39.00",
    tags: ["kids", "daily"],
    marginRank: 45,
    blurb: "A smaller daily gummy made for kids.",
  },
  {
    handle: "gruns-fiber-gummies",
    title: "Grüns Fiber Gummies",
    price: "29.00",
    tags: ["fiber", "gut"],
    marginRank: 90,
    blurb: "A gut-health add-on that pairs with the daily gummy.",
  },
  {
    handle: "gruns-sleep-gummies",
    title: "Grüns Sleep Gummies",
    price: "32.00",
    tags: ["sleep", "night"],
    marginRank: 80,
    blurb: "A nighttime gummy for the routine after the daily one.",
  },
  {
    handle: "gruns-immunity-gummies",
    title: "Grüns Immunity Gummies",
    price: "28.00",
    tags: ["immunity", "seasonal"],
    marginRank: 85,
    blurb: "Seasonal support that fits next to the kids gummy.",
  },
  {
    handle: "gruns-travel-packs",
    title: "Grüns Travel Packs",
    price: "18.00",
    tags: ["travel", "convenience"],
    marginRank: 70,
    blurb: "A week of daily gummies in single packs.",
  },
  {
    handle: "gruns-low-sugar-daily",
    title: "Grüns Low Sugar Daily",
    price: "44.00",
    tags: ["daily", "greens", "low-sugar"],
    marginRank: 55,
    blurb: "The daily greens gummy with less sugar.",
  },
  {
    handle: "gruns-superfood-powder",
    title: "Grüns Superfood Powder",
    price: "36.00",
    tags: ["powder", "greens"],
    marginRank: 50,
    blurb: "The same greens routine as a scoop instead of a gummy.",
  },
  {
    handle: "gruns-magnesium-night",
    title: "Grüns Magnesium Night",
    price: "27.00",
    tags: ["sleep", "magnesium", "mineral"],
    marginRank: 95,
    blurb: "Magnesium to take with the sleep gummy.",
  },
  {
    handle: "gruns-probiotic-gummies",
    title: "Grüns Probiotic Gummies",
    price: "31.00",
    tags: ["gut", "probiotic"],
    marginRank: 60,
    blurb: "A probiotic gummy for the same gut routine as fiber.",
  },
] as const;

type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

async function adminQuery<T>(
  admin: AdminClient,
  query: string,
  variables?: Record<string, unknown>,
) {
  const response = await admin.graphql(query, { variables });
  const payload = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }

  if (!payload.data) {
    throw new Error("Admin API returned no data");
  }

  return payload.data;
}

function legacyId(gid: string) {
  const id = gid.split("/").pop() ?? "";

  if (!/^\d+$/.test(id)) {
    throw new Error(`Expected a numeric Shopify id, received ${gid}`);
  }

  return id;
}

async function upsertProduct(admin: AdminClient, product: (typeof PRODUCTS)[number]) {
  const data = await adminQuery<{
    productSet: {
      product: {
        id: string;
        variants: { nodes: Array<{ id: string; price: string }> };
      } | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(
    admin,
    `#graphql
      mutation SeedProduct($identifier: ProductSetIdentifiers, $input: ProductSetInput!) {
        productSet(identifier: $identifier, input: $input, synchronous: true) {
          product {
            id
            variants(first: 1) {
              nodes {
                id
                price
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      identifier: { handle: product.handle },
      input: {
        title: product.title,
        handle: product.handle,
        descriptionHtml: `<p>${product.blurb}</p>`,
        vendor: "Grüns",
        productType: "Gummies",
        tags: product.tags,
        status: "ACTIVE",
        productOptions: [
          { name: "Title", values: [{ name: "Default Title" }] },
        ],
        variants: [
          {
            optionValues: [{ optionName: "Title", name: "Default Title" }],
            price: product.price,
            inventoryItem: { tracked: false, requiresShipping: true },
          },
        ],
      },
    },
  );

  const result = data.productSet;

  if (result.userErrors.length > 0 || !result.product) {
    throw new Error(
      `${product.handle}: ${result.userErrors.map((error) => error.message).join("; ") || "product was not returned"}`,
    );
  }

  const variant = result.product.variants.nodes[0];

  if (!variant) {
    throw new Error(`${product.handle}: product has no variant`);
  }

  const priceCents = Math.round(Number(variant.price) * 100);

  await prisma.catalogProduct.upsert({
    where: {
      shop_variantId: { shop: SHOP, variantId: legacyId(variant.id) },
    },
    create: {
      shop: SHOP,
      productId: legacyId(result.product.id),
      variantId: legacyId(variant.id),
      title: product.title,
      tags: product.tags.join(","),
      priceCents,
      blurb: product.blurb,
      available: true,
      marginRank: product.marginRank,
      handle: product.handle,
    },
    update: {
      productId: legacyId(result.product.id),
      title: product.title,
      tags: product.tags.join(","),
      priceCents,
      blurb: product.blurb,
      available: true,
      marginRank: product.marginRank,
      handle: product.handle,
    },
  });

  return {
    handle: product.handle,
    productId: legacyId(result.product.id),
    variantId: legacyId(variant.id),
    priceCents,
  };
}

async function draftGiftCards(admin: AdminClient) {
  const data = await adminQuery<{
    products: { nodes: Array<{ id: string; title: string; isGiftCard: boolean }> };
  }>(
    admin,
    `#graphql
      query GiftCards {
        products(first: 20, query: "gift_card") {
          nodes {
            id
            title
            isGiftCard
          }
        }
      }
    `,
  );

  for (const giftCard of data.products.nodes.filter((product) => product.isGiftCard)) {
    const updated = await adminQuery<{
      productUpdate: { userErrors: Array<{ message: string }> };
    }>(
      admin,
      `#graphql
        mutation DraftGiftCard($input: ProductUpdateInput!) {
          productUpdate(product: $input) {
            userErrors {
              message
            }
          }
        }
      `,
      { input: { id: giftCard.id, status: "DRAFT" } },
    );

    const errors = updated.productUpdate.userErrors;

    if (errors.length > 0) {
      console.warn(
        `Left ${giftCard.title} published: ${errors.map((error) => error.message).join("; ")}`,
      );
      continue;
    }

    console.log(`Set ${giftCard.title} to draft so the dev preview stops selecting it`);
  }
}

async function main() {
  const { admin } = await unauthenticated.admin(SHOP);
  const seeded = [];

  for (const product of PRODUCTS) {
    seeded.push(await upsertProduct(admin, product));
    console.log(`Seeded ${product.title}`);
  }

  try {
    await draftGiftCards(admin);
  } catch (error) {
    console.warn(
      "Could not draft the gift card. The dev console preview may still open it.",
      error instanceof Error ? error.message : "unknown",
    );
  }

  console.table(seeded);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
