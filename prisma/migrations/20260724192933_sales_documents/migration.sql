-- CreateEnum
CREATE TYPE "SalesDocumentKind" AS ENUM ('QUOTE', 'ORDER');

-- CreateEnum
CREATE TYPE "SalesDocumentStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SYNC_PENDING', 'SYNCING', 'SYNCED', 'SYNC_FAILED', 'EXPIRED', 'CONVERTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "sales_documents" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "kind" "SalesDocumentKind" NOT NULL DEFAULT 'QUOTE',
    "status" "SalesDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "localNumber" INTEGER NOT NULL,
    "integrationCode" TEXT NOT NULL,
    "omieId" INTEGER,
    "omieNumber" TEXT,
    "omieStage" VARCHAR(2),
    "sellerLinkId" UUID NOT NULL,
    "createdByUserId" UUID,
    "customerId" UUID NOT NULL,
    "paymentTermCode" VARCHAR(3),
    "expectedDate" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "notes" TEXT,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "shipping" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "otherCosts" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'LOCAL_ONLY',
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncAttemptAt" TIMESTAMP(3),
    "syncAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastSyncError" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "sales_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_document_items" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "itemIntegrationCode" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "listUnitPrice" DECIMAL(18,6) NOT NULL,
    "unitPrice" DECIMAL(18,6) NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,2) NOT NULL,
    "priceTableId" UUID,
    "priceSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_document_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_attempts" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "documentId" UUID,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "omieCall" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "outcome" TEXT NOT NULL,
    "omieCode" TEXT,
    "omieDescription" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "requestedByUserId" UUID NOT NULL,
    "approvedByUserId" UUID,
    "reason" TEXT NOT NULL,
    "requestedPercent" DECIMAL(5,2) NOT NULL,
    "ceilingPercent" DECIMAL(5,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_documents_organizationId_kind_status_idx" ON "sales_documents"("organizationId", "kind", "status");

-- CreateIndex
CREATE INDEX "sales_documents_organizationId_sellerLinkId_idx" ON "sales_documents"("organizationId", "sellerLinkId");

-- CreateIndex
CREATE INDEX "sales_documents_organizationId_customerId_idx" ON "sales_documents"("organizationId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_documents_organizationId_integrationCode_key" ON "sales_documents"("organizationId", "integrationCode");

-- CreateIndex
CREATE UNIQUE INDEX "sales_documents_organizationId_localNumber_key" ON "sales_documents"("organizationId", "localNumber");

-- CreateIndex
CREATE INDEX "sales_document_items_productId_idx" ON "sales_document_items"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_document_items_documentId_productId_key" ON "sales_document_items"("documentId", "productId");

-- CreateIndex
CREATE INDEX "integration_attempts_organizationId_entityType_entityId_idx" ON "integration_attempts"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "integration_attempts_organizationId_createdAt_idx" ON "integration_attempts"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "approval_requests_documentId_key" ON "approval_requests"("documentId");

-- CreateIndex
CREATE INDEX "approval_requests_organizationId_status_idx" ON "approval_requests"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_sellerLinkId_fkey" FOREIGN KEY ("sellerLinkId") REFERENCES "seller_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_document_items" ADD CONSTRAINT "sales_document_items_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "sales_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_document_items" ADD CONSTRAINT "sales_document_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_attempts" ADD CONSTRAINT "integration_attempts_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "sales_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "sales_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
