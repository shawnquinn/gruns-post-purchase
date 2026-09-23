const SHOPIFY_HOST = /(^|\.)((shopify|myshopify|shopifycdn|shopifycloud)\.com)$/;

export function httpsOrigin(value?: string | null) {
  if (!value) {
    return null;
  }

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

export function chooseAppUrl(input: {
  scriptOrigin?: string | null;
  metafieldValue?: string | null;
}) {
  const scriptOrigin = httpsOrigin(input.scriptOrigin);

  if (scriptOrigin && !SHOPIFY_HOST.test(new URL(scriptOrigin).hostname)) {
    return scriptOrigin;
  }

  return httpsOrigin(input.metafieldValue);
}
