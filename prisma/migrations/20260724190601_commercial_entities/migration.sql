-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('LOCAL_ONLY', 'PENDING', 'PROCESSING', 'SYNCED', 'FAILED', 'CONFLICT', 'STALE');

-- CreateTable
CREATE TABLE "product_families" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "omieId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "omieId" INTEGER NOT NULL,
    "integrationCode" TEXT,
    "sku" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT,
    "ncm" TEXT,
    "ean" TEXT,
    "basePrice" DECIMAL(18,6),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "familyId" UUID,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'SYNCED',
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "sourceUpdatedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_favorites" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_recent_views" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_recent_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "omieId" INTEGER NOT NULL,
    "code" TEXT,
    "name" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "availableForSale" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_positions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "physical" DECIMAL(18,6),
    "reserved" DECIMAL(18,6),
    "expectedOut" DECIMAL(18,6),
    "expectedIn" DECIMAL(18,6),
    "omieAvailable" DECIMAL(18,6),
    "minStock" DECIMAL(18,6),
    "averageCost" DECIMAL(18,6),
    "readAt" TIMESTAMP(3) NOT NULL,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'SYNCED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "omieId" INTEGER,
    "integrationCode" TEXT NOT NULL,
    "document" VARCHAR(14) NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "ownerSellerLinkId" UUID,
    "priceTableId" UUID,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'LOCAL_ONLY',
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncAttemptAt" TIMESTAMP(3),
    "syncAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastSyncError" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "street" TEXT,
    "number" TEXT,
    "complement" TEXT,
    "district" TEXT,
    "city" TEXT,
    "state" VARCHAR(2),
    "zipCode" VARCHAR(8),
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_tables" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "omieId" INTEGER NOT NULL,
    "name" TEXT,
    "code" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_table_items" (
    "id" UUID NOT NULL,
    "priceTableId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "price" DECIMAL(18,6),
    "maxDiscountPercent" DECIMAL(5,2),
    "suggestedDiscountPercent" DECIMAL(5,2),
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_table_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "result" JSONB,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_families_organizationId_omieId_key" ON "product_families"("organizationId", "omieId");

-- CreateIndex
CREATE INDEX "products_organizationId_sku_idx" ON "products"("organizationId", "sku");

-- CreateIndex
CREATE INDEX "products_organizationId_active_idx" ON "products"("organizationId", "active");

-- CreateIndex
CREATE INDEX "products_organizationId_description_idx" ON "products"("organizationId", "description");

-- CreateIndex
CREATE UNIQUE INDEX "products_organizationId_omieId_key" ON "products"("organizationId", "omieId");

-- CreateIndex
CREATE INDEX "product_favorites_userId_idx" ON "product_favorites"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "product_favorites_userId_productId_key" ON "product_favorites"("userId", "productId");

-- CreateIndex
CREATE INDEX "product_recent_views_userId_viewedAt_idx" ON "product_recent_views"("userId", "viewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "product_recent_views_userId_productId_key" ON "product_recent_views"("userId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_organizationId_omieId_key" ON "warehouses"("organizationId", "omieId");

-- CreateIndex
CREATE INDEX "inventory_positions_organizationId_readAt_idx" ON "inventory_positions"("organizationId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_positions_productId_warehouseId_key" ON "inventory_positions"("productId", "warehouseId");

-- CreateIndex
CREATE INDEX "customers_organizationId_legalName_idx" ON "customers"("organizationId", "legalName");

-- CreateIndex
CREATE INDEX "customers_organizationId_ownerSellerLinkId_idx" ON "customers"("organizationId", "ownerSellerLinkId");

-- CreateIndex
CREATE INDEX "customers_organizationId_omieId_idx" ON "customers"("organizationId", "omieId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organizationId_integrationCode_key" ON "customers"("organizationId", "integrationCode");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organizationId_document_key" ON "customers"("organizationId", "document");

-- CreateIndex
CREATE INDEX "customer_addresses_customerId_idx" ON "customer_addresses"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "price_tables_organizationId_omieId_key" ON "price_tables"("organizationId", "omieId");

-- CreateIndex
CREATE INDEX "price_table_items_productId_idx" ON "price_table_items"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "price_table_items_priceTableId_productId_key" ON "price_table_items"("priceTableId", "productId");

-- CreateIndex
CREATE INDEX "idempotency_keys_expiresAt_idx" ON "idempotency_keys"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_organizationId_scope_key_key" ON "idempotency_keys"("organizationId", "scope", "key");

-- AddForeignKey
ALTER TABLE "product_families" ADD CONSTRAINT "product_families_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "product_families"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_favorites" ADD CONSTRAINT "product_favorites_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recent_views" ADD CONSTRAINT "product_recent_views_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_positions" ADD CONSTRAINT "inventory_positions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_positions" ADD CONSTRAINT "inventory_positions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_positions" ADD CONSTRAINT "inventory_positions_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_tables" ADD CONSTRAINT "price_tables_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_table_items" ADD CONSTRAINT "price_table_items_priceTableId_fkey" FOREIGN KEY ("priceTableId") REFERENCES "price_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_table_items" ADD CONSTRAINT "price_table_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
