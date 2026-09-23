import type { CatalogCandidate, ModelPick } from "./candidates";

export const OPENAI_MODEL = "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = 3000;

const OFFER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    variantId: { type: "string" },
    reason: { type: "string" },
    headline: { type: "string" },
    body: { type: "string" },
  },
  required: ["variantId", "reason", "headline", "body"],
} as const;

export async function requestOfferPick(input: {
  purchasedTitles: string[];
  candidates: CatalogCandidate[];
}) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "offer_pick",
          strict: true,
          schema: OFFER_SCHEMA,
        },
      },
      messages: [
        {
          role: "system",
          content:
            "You choose one post-purchase offer. Pick exactly one variantId from the candidate list. Do not invent an id. Write a short headline and one sentence that mentions what the customer already bought. Tone is enticing and persuasive.",
        },
        {
          role: "user",
          content: JSON.stringify({
            purchasedTitles: input.purchasedTitles,
            candidates: input.candidates.map((candidate) => ({
              variantId: candidate.variantId,
              title: candidate.title,
              priceCents: candidate.priceCents,
              tags: candidate.tags,
              blurb: candidate.blurb,
            })),
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("OpenAI returned an empty choice");
  }

  return JSON.parse(content) as ModelPick;
}
