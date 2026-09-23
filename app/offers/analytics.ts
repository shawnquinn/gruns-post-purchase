export type AnalyticsEvent = {
  offerVariantId: string;
  eventType: string;
  revenueDeltaCents: number | null;
};

export type OfferRow = {
  variantId: string;
  title: string;
  impressions: number;
  accepts: number;
  rejects: number;
  revenueCents: number;
};

export type OfferSummary = {
  impressions: number;
  accepts: number;
  acceptRate: number;
  revenueCents: number;
  offers: OfferRow[];
};

export function summarizeOffers(
  events: AnalyticsEvent[],
  titles: ReadonlyMap<string, string>,
): OfferSummary {
  const rows = new Map<string, OfferRow>();

  const rowFor = (variantId: string) => {
    const existing = rows.get(variantId);

    if (existing) {
      return existing;
    }

    const created: OfferRow = {
      variantId,
      title: titles.get(variantId) || "Unknown offer",
      impressions: 0,
      accepts: 0,
      rejects: 0,
      revenueCents: 0,
    };
    rows.set(variantId, created);
    return created;
  };

  let impressions = 0;
  let accepts = 0;
  let revenueCents = 0;

  for (const event of events) {
    const row = rowFor(event.offerVariantId);

    if (event.eventType === "impression") {
      impressions += 1;
      row.impressions += 1;
    }

    if (event.eventType === "accept") {
      const revenue = event.revenueDeltaCents ?? 0;
      accepts += 1;
      revenueCents += revenue;
      row.accepts += 1;
      row.revenueCents += revenue;
    }

    if (event.eventType === "reject") {
      row.rejects += 1;
    }
  }

  return {
    impressions,
    accepts,
    acceptRate: impressions === 0 ? 0 : accepts / impressions,
    revenueCents,
    offers: [...rows.values()].sort(
      (left, right) =>
        right.revenueCents - left.revenueCents ||
        right.accepts - left.accepts ||
        right.impressions - left.impressions,
    ),
  };
}

export function formatPercent(rate: number) {
  return `${Math.round(rate * 100)}%`;
}

export function formatDollars(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}
