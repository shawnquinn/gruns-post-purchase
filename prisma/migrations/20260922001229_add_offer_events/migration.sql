-- CreateTable
CREATE TABLE "OfferEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderReferenceId" TEXT NOT NULL,
    "offerVariantId" TEXT NOT NULL,
    "offerProductId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "discountPct" INTEGER NOT NULL,
    "revenueDeltaCents" INTEGER,
    "llmModel" TEXT NOT NULL,
    "llmReason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "OfferEvent_shop_eventType_idx" ON "OfferEvent"("shop", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "OfferEvent_shop_orderReferenceId_eventType_key" ON "OfferEvent"("shop", "orderReferenceId", "eventType");
