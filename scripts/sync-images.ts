import prisma from "../app/db.server";
import { unauthenticated } from "../app/shopify.server";

const SHOP = process.env.SHOP || "gruns-quinn-upsell.myshopify.com";
const IMAGE_WIDTH = 800;

type ProductImages = {
  nodes: Array<{
    featuredMedia: { preview: { image: { url: string } | null } | null } | null;
  } | null>;
};

async function main() {
  const catalog = await prisma.catalogProduct.findMany({ where: { shop: SHOP } });

  if (catalog.length === 0) {
    throw new Error(`No catalog rows for ${SHOP}. Run npm run seed first.`);
  }

  const { admin } = await unauthenticated.admin(SHOP);
  const response = await admin.graphql(
    `#graphql
      query CatalogImages($ids: [ID!]!, $width: Int!) {
        nodes(ids: $ids) {
          ... on Product {
            featuredMedia {
              preview {
                image {
                  url(transform: { maxWidth: $width })
                }
              }
            }
          }
        }
      }
    `,
    {
      variables: {
        ids: catalog.map((product) => `gid://shopify/Product/${product.productId}`),
        width: IMAGE_WIDTH,
      },
    },
  );
  const json = (await response.json()) as {
    data?: ProductImages;
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length || !json.data) {
    throw new Error(json.errors?.map((error) => error.message).join("; ") || "No data returned");
  }

  const nodes = json.data.nodes;

  for (const [index, product] of catalog.entries()) {
    const imageUrl = nodes[index]?.featuredMedia?.preview?.image?.url ?? "";

    await prisma.catalogProduct.update({
      where: { id: product.id },
      data: { imageUrl },
    });

    console.log(`${imageUrl ? "✔" : "✖ no image"} ${product.title}`);
  }

  const { count } = await prisma.offerDecision.deleteMany({ where: { shop: SHOP } });
  console.log(`Cleared ${count} cached offer decisions so new offers include images.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
