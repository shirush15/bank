import { Test, TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import { TransactionsService } from './transactions.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccountsService } from '../accounts/accounts.service';

describe('TransactionsService', () => {
  let service: TransactionsService;
  let accounts: { transfer: jest.Mock };
  let prisma: { transaction: any };

  beforeEach(async () => {
    accounts = { transfer: jest.fn() };
    prisma = {
      transaction: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AccountsService, useValue: accounts },
        {
          provide: getLoggerToken(TransactionsService.name),
          useValue: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(TransactionsService);
  });

  it('routes a transfer to AccountsService.transfer', async () => {
    accounts.transfer.mockResolvedValue({ transferId: 'tr1' });
    await service.transfer(
      { sourceAccountId: 'a', destAccountId: 'b', amount: 100 },
      'key-1',
    );
    expect(accounts.transfer).toHaveBeenCalledWith('a', 'b', 100, 'key-1');
  });

  it('lists an account transactions with page/limit pagination', async () => {
    prisma.transaction.findMany.mockResolvedValue([]);
    // Page 2 with a page size of 20 should skip the first 20 records.
    await service.findByAccountId('acc-1', 2, 20);
    expect(prisma.transaction.findMany).toHaveBeenCalledWith({
      where: { accountId: 'acc-1' },
      skip: 20,
      take: 20,
      orderBy: { transactionDate: 'desc' },
    });
  });

  it('scopes a statement query to an account and period', async () => {
    prisma.transaction.findMany.mockResolvedValue([]);
    const start = new Date('2026-01-01');
    const end = new Date('2026-12-31');
    await service.findByAccountAndDateRange('acc-1', start, end);
    expect(prisma.transaction.findMany).toHaveBeenCalledWith({
      where: {
        accountId: 'acc-1',
        transactionDate: { gte: start, lte: end },
      },
      orderBy: { transactionDate: 'desc' },
    });
  });
});
