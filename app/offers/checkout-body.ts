import { shopDomainFromDest } from "./candidates";

export const DEMO_SHOP = "gruns-quinn-upsell.myshopify.com";

const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function shopFromCheckout(dest: unknown, reportedShop?: unknown) {
  if (typeof dest === "string" && dest.trim()) {
    const shop = shopDomainFromDest(dest).toLowerCase();

    if (SHOP_DOMAIN.test(shop)) {
      return shop;
    }
  }

  if (typeof reportedShop === "string") {
    const shop = reportedShop.trim().toLowerCase();

    if (SHOP_DOMAIN.test(shop)) {
      return shop;
    }
  }

  return DEMO_SHOP;
}

export function referenceIdFrom(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const referenceId = value.trim();

  if (referenceId.length < 1 || referenceId.length > 200) {
    return null;
  }

  return referenceId;
}

export function productIdsFrom(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    return null;
  }

  const productIds = value.map(variantIdFrom);

  if (productIds.some((productId) => productId === null)) {
    return null;
  }

  return productIds.map(String);
}

export function variantIdFrom(value: unknown) {
  const variantId = Number(value);

  if (!Number.isSafeInteger(variantId) || variantId <= 0) {
    return null;
  }

  return variantId;
}
