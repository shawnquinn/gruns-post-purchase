-- CreateTable
CREATE TABLE "CatalogProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "tags" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "imageUrl" TEXT NOT NULL DEFAULT '',
    "blurb" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "marginRank" INTEGER NOT NULL,
    "handle" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OfferDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "cartKey" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "CatalogProduct_shop_idx" ON "CatalogProduct"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogProduct_shop_variantId_key" ON "CatalogProduct"("shop", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "OfferDecision_shop_cartKey_key" ON "OfferDecision"("shop", "cartKey");
