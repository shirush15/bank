ALTER TABLE "transactions" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "transactions_idempotencyKey_key" ON "transactions"("idempotencyKey");
