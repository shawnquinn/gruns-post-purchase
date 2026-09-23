import prisma from "../app/db.server";
import { unauthenticated } from "../app/shopify.server";
import { FLUSH_DNS_FIX, checkAppUrl } from "./offer-readiness";

const SHOP = process.env.SHOP || "gruns-quinn-upsell.myshopify.com";

type Check = { ok: boolean; label: string; fix?: string };

function report(check: Check) {
  console.log(`${check.ok ? "✔" : "✖"} ${check.label}`);

  if (!check.ok && check.fix) {
    console.log(`  → ${check.fix}`);
  }
}

async function readAppUrl() {
  const { admin } = await unauthenticated.admin(SHOP);
  const response = await admin.graphql(`#graphql
    query DemoCheckAppUrl {
      shop {
        metafield(namespace: "$app", key: "app_url") {
          value
        }
      }
    }
  `);
  const json = (await response.json()) as {
    data?: { shop?: { metafield?: { value?: string } | null } };
  };

  return json.data?.shop?.metafield?.value ?? null;
}

async function main() {
  const checks: Check[] = [];

  checks.push({
    ok: Boolean(process.env.OPENAI_API_KEY),
    label: "OPENAI_API_KEY is set",
    fix: "Offers will still render, but every pick will use the fallback.",
  });

  const catalogCount = await prisma.catalogProduct.count({ where: { shop: SHOP } });
  checks.push({
    ok: catalogCount > 0,
    label: `Catalog has ${catalogCount} products for ${SHOP}`,
    fix: "Run `SHOPIFY_APP_URL=https://example.com npm run seed`.",
  });

  const appUrl = await readAppUrl();
  checks.push({
    ok: Boolean(appUrl),
    label: `Shop metafield app_url is ${appUrl ?? "missing"}`,
    fix: "Start `shopify app dev` and wait for `[offers] Ready` in its output.",
  });

  if (appUrl) {
    const result = await checkAppUrl(appUrl);

    if (result.registered === false) {
      checks.push({
        ok: false,
        label: `Tunnel ${result.hostname} exists`,
        fix: "This tunnel is gone. Start `shopify app dev` and wait for `[offers] Ready` in its output.",
      });
    } else {
      checks.push({
        ok: result.resolves,
        label: `This machine resolves ${result.hostname}`,
        fix: FLUSH_DNS_FIX,
      });
    }

    if (result.resolves) {
      checks.push({
        ok: result.ready,
        label: `App answers checkout requests at ${appUrl} (status ${result.status ?? "no response"})`,
        fix: "No app is running behind this tunnel. Start `shopify app dev` and wait for `[offers] Ready`.",
      });
    }
  }

  checks.forEach(report);

  const ready = checks.every((check) => check.ok || check.label.startsWith("OPENAI"));
  console.log(ready ? "\nReady: storefront checkouts will show the offer." : "\nNot ready. Fix the items marked ✖.");
  process.exitCode = ready ? 0 : 1;
}

main()
  .catch((error: unknown) => {
    console.error("Demo check failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
