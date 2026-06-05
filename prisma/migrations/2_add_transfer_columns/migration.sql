ALTER TABLE "transactions" ADD COLUMN "transferId" TEXT;
ALTER TABLE "transactions" ADD COLUMN "counterpartyAccountId" TEXT;

CREATE INDEX "transactions_transferId_idx" ON "transactions"("transferId");
