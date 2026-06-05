import { PrismaClient, AccountType, TransactionType } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

const DEMO_PERSON_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

async function main() {
  const checking = await prisma.account.create({
    data: {
      personId: DEMO_PERSON_ID,
      balance: 1000,
      dailyWithdrawalLimit: 500,
      accountType: AccountType.CHECKING,
    },
  });

  const savings = await prisma.account.create({
    data: {
      personId: DEMO_PERSON_ID,
      balance: 5000,
      dailyWithdrawalLimit: 2000,
      accountType: AccountType.SAVINGS,
    },
  });

  await prisma.transaction.createMany({
    data: [
      { accountId: checking.accountId, value: 1000, type: TransactionType.DEPOSIT },
      { accountId: savings.accountId, value: 5000, type: TransactionType.DEPOSIT },
    ],
  });

  const transferId = randomUUID();
  await prisma.transaction.createMany({
    data: [
      {
        accountId: savings.accountId,
        value: 200,
        type: TransactionType.WITHDRAWAL,
        transferId,
        counterpartyAccountId: checking.accountId,
      },
      {
        accountId: checking.accountId,
        value: 200,
        type: TransactionType.DEPOSIT,
        transferId,
        counterpartyAccountId: savings.accountId,
      },
    ],
  });

  console.log('Seeded accounts:', checking.accountId, savings.accountId);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
