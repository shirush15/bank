import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getLoggerToken } from 'nestjs-pino';
import { Prisma, TransactionType } from '@prisma/client';
import { AccountsService } from './accounts.service';
import { PrismaService } from '../prisma/prisma.service';

const noopLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

function account(overrides: Partial<any> = {}) {
  return {
    accountId: 'acc-1',
    personId: 'person-1',
    balance: new Prisma.Decimal(1000),
    dailyWithdrawalLimit: new Prisma.Decimal(500),
    activeFlag: true,
    accountType: 'CHECKING',
    ...overrides,
  };
}

/** In-memory stand-in for the interactive-transaction client. */
function buildTxMock(accounts: any[], { withdrawnToday = 0 } = {}) {
  const map = new Map(accounts.map((a) => [a.accountId, a]));
  let seq = 0;
  return {
    account: {
      findUnique: jest.fn(({ where }) =>
        Promise.resolve(map.get(where.accountId) ?? null),
      ),
      update: jest.fn(({ where }) => Promise.resolve(map.get(where.accountId))),
      updateMany: jest.fn(({ where }) => {
        const acc = map.get(where.accountId);
        const enough =
          acc &&
          new Prisma.Decimal(acc.balance).greaterThanOrEqualTo(
            where.balance.gte,
          );
        return Promise.resolve({ count: enough ? 1 : 0 });
      }),
    },
    transaction: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: { value: new Prisma.Decimal(withdrawnToday) },
      }),
      create: jest.fn(({ data }) =>
        Promise.resolve({ transactionId: `txn-${++seq}`, ...data }),
      ),
    },
  };
}

describe('AccountsService', () => {
  let service: AccountsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      account: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      transaction: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountsService,
        { provide: PrismaService, useValue: prisma },
        { provide: getLoggerToken(AccountsService.name), useValue: noopLogger },
      ],
    }).compile();

    service = module.get(AccountsService);
  });

  describe('findOne', () => {
    it('throws NotFound when the account does not exist', async () => {
      prisma.account.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('deposit / withdraw', () => {
    it('rejects non-positive amounts before touching the DB', async () => {
      await expect(service.deposit('acc-1', 0)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('credits the balance and records a DEPOSIT ledger row', async () => {
      const tx = buildTxMock([account()]);
      prisma.$transaction.mockImplementation((cb: any) => cb(tx));

      const result = await service.deposit('acc-1', 250);

      expect(tx.account.update).toHaveBeenCalled();
      expect(result.type).toBe(TransactionType.DEPOSIT);
    });

    it('rejects a withdrawal on an inactive account', async () => {
      const tx = buildTxMock([account({ activeFlag: false })]);
      prisma.$transaction.mockImplementation((cb: any) => cb(tx));

      await expect(service.withdraw('acc-1', 100)).rejects.toThrow(
        'Account is blocked',
      );
    });

    it('rejects a withdrawal that exceeds the remaining daily limit', async () => {
      const tx = buildTxMock([account()], { withdrawnToday: 450 });
      prisma.$transaction.mockImplementation((cb: any) => cb(tx));

      await expect(service.withdraw('acc-1', 100)).rejects.toThrow(
        /daily limit/,
      );
      expect(tx.account.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a withdrawal with insufficient funds (guarded update returns 0)', async () => {
      const tx = buildTxMock([account({ balance: new Prisma.Decimal(50) })]);
      prisma.$transaction.mockImplementation((cb: any) => cb(tx));

      await expect(service.withdraw('acc-1', 100)).rejects.toThrow(
        'Insufficient funds',
      );
    });

    it('debits the balance and records a WITHDRAWAL ledger row', async () => {
      const tx = buildTxMock([account()]);
      prisma.$transaction.mockImplementation((cb: any) => cb(tx));

      const result = await service.withdraw('acc-1', 100);

      expect(tx.account.updateMany).toHaveBeenCalled();
      expect(result.type).toBe(TransactionType.WITHDRAWAL);
    });
  });

  describe('idempotency', () => {
    it('returns the original transaction and does NOT move money on replay', async () => {
      const original = {
        transactionId: 'txn-1',
        accountId: 'acc-1',
        type: TransactionType.WITHDRAWAL,
        transferId: null,
        value: new Prisma.Decimal(100),
      };
      prisma.transaction.findUnique.mockResolvedValue(original);

      const result = await service.withdraw('acc-1', 100, 'key-123');

      expect(result).toBe(original);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws 409 when the same key is reused with different parameters', async () => {
      prisma.transaction.findUnique.mockResolvedValue({
        transactionId: 'txn-1',
        accountId: 'someone-else',
        type: TransactionType.DEPOSIT,
        transferId: null,
        value: new Prisma.Decimal(100),
      });

      await expect(
        service.deposit('acc-1', 100, 'key-123'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('recovers the winner when two requests race on the same key (P2002)', async () => {
      const winner = {
        transactionId: 'txn-1',
        accountId: 'acc-1',
        type: TransactionType.DEPOSIT,
        transferId: null,
        value: new Prisma.Decimal(100),
      };
      prisma.transaction.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(winner);
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      const result = await service.deposit('acc-1', 100, 'key-123');
      expect(result).toBe(winner);
    });
  });

  describe('transfer', () => {
    it('rejects a transfer to the same account', async () => {
      await expect(service.transfer('acc-1', 'acc-1', 100)).rejects.toThrow(
        /same account/,
      );
    });

    it('debits source, credits destination, and writes two linked legs', async () => {
      const source = account({
        accountId: 'src',
        balance: new Prisma.Decimal(1000),
      });
      const dest = account({
        accountId: 'dst',
        balance: new Prisma.Decimal(0),
      });
      const tx = buildTxMock([source, dest]);
      prisma.$transaction.mockImplementation((cb: any) => cb(tx));

      const result = await service.transfer('src', 'dst', 250);

      expect(result.debit.type).toBe(TransactionType.WITHDRAWAL);
      expect(result.credit.type).toBe(TransactionType.DEPOSIT);
      expect(result.debit.transferId).toBe(result.credit.transferId);
      expect(result.transferId).toBeDefined();
      // Source debited, destination credited.
      expect(tx.account.updateMany).toHaveBeenCalled();
      expect(tx.account.update).toHaveBeenCalledWith({
        where: { accountId: 'dst' },
        data: { balance: { increment: expect.any(Prisma.Decimal) } },
      });
    });

    it('rejects a transfer with insufficient funds in the source', async () => {
      const source = account({
        accountId: 'src',
        balance: new Prisma.Decimal(50),
      });
      const dest = account({
        accountId: 'dst',
        balance: new Prisma.Decimal(0),
      });
      const tx = buildTxMock([source, dest]);
      prisma.$transaction.mockImplementation((cb: any) => cb(tx));

      await expect(service.transfer('src', 'dst', 100)).rejects.toThrow(
        'Insufficient funds',
      );
    });
  });
});
