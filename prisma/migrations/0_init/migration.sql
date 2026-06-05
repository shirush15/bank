CREATE TYPE "AccountType" AS ENUM ('CHECKING', 'SAVINGS');

CREATE TYPE "TransactionType" AS ENUM ('DEPOSIT', 'WITHDRAWAL');

CREATE TABLE "accounts" (
    "accountId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "balance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "dailyWithdrawalLimit" DECIMAL(15,2) NOT NULL,
    "activeFlag" BOOLEAN NOT NULL DEFAULT true,
    "accountType" "AccountType" NOT NULL DEFAULT 'CHECKING',
    "createDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("accountId")
);

CREATE TABLE "transactions" (
    "transactionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "value" DECIMAL(15,2) NOT NULL,
    "type" "TransactionType" NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("transactionId")
);

CREATE INDEX "transactions_accountId_transactionDate_idx" ON "transactions"("accountId", "transactionDate");

CREATE INDEX "transactions_accountId_type_transactionDate_idx" ON "transactions"("accountId", "type", "transactionDate");

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("accountId") ON DELETE CASCADE ON UPDATE CASCADE;

