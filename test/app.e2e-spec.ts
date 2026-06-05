import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * End-to-end tests that exercise the real HTTP pipeline (routing, the global
 * ValidationPipe, serialization) with PrismaService replaced by an in-memory
 * fake, so they run in CI without a Postgres instance.
 */
describe('Bank API (e2e)', () => {
  let app: INestApplication;

  const account = {
    accountId: 'acc-1',
    personId: 'person-1',
    balance: new Prisma.Decimal(1000),
    dailyWithdrawalLimit: new Prisma.Decimal(500),
    activeFlag: true,
    accountType: 'CHECKING',
  };

  // Stateful ledger keyed by idempotencyKey so replays can be demonstrated.
  const ledgerByKey = new Map<string, any>();
  let txnCounter = 0;

  const prismaMock = {
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $transaction: jest.fn((cb) =>
      cb({
        account: {
          findUnique: jest.fn().mockResolvedValue(account),
          update: jest.fn().mockResolvedValue(account),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        transaction: {
          aggregate: jest
            .fn()
            .mockResolvedValue({ _sum: { value: new Prisma.Decimal(0) } }),
          create: jest.fn().mockImplementation(({ data }) => {
            if (data.idempotencyKey && ledgerByKey.has(data.idempotencyKey)) {
              return Promise.reject(
                new Prisma.PrismaClientKnownRequestError('dup', {
                  code: 'P2002',
                  clientVersion: 'test',
                }),
              );
            }
            const txn = { transactionId: `txn-${++txnCounter}`, ...data };
            if (data.idempotencyKey) ledgerByKey.set(data.idempotencyKey, txn);
            return Promise.resolve(txn);
          }),
        },
      }),
    ),
    account: {
      create: jest.fn().mockResolvedValue(account),
      findUnique: jest.fn().mockResolvedValue(account),
      findMany: jest.fn().mockResolvedValue([account]),
    },
    transaction: {
      findUnique: jest
        .fn()
        .mockImplementation(({ where }) =>
          Promise.resolve(ledgerByKey.get(where.idempotencyKey) ?? null),
        ),
    },
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects account creation with an invalid accountType (400)', () => {
    return request(app.getHttpServer())
      .post('/accounts')
      .send({
        personId: 'person-1',
        dailyWithdrawalLimit: 500,
        accountType: 'GOLD',
      })
      .expect(400);
  });

  it('rejects a deposit with a non-positive amount (400)', () => {
    return request(app.getHttpServer())
      .post('/accounts/acc-1/deposit')
      .send({ amount: -5 })
      .expect(400);
  });

  it('rejects unknown properties in the body (400)', () => {
    return request(app.getHttpServer())
      .post('/accounts/acc-1/deposit')
      .send({ amount: 10, hacker: true })
      .expect(400);
  });

  it('accepts a valid deposit and returns a transaction (201)', () => {
    return request(app.getHttpServer())
      .post('/accounts/acc-1/deposit')
      .send({ amount: 100 })
      .expect(201)
      .expect((res) => {
        expect(res.body.type).toBe('DEPOSIT');
      });
  });

  it('rejects a statement query where endDate precedes startDate (400)', () => {
    return request(app.getHttpServer())
      .get(
        '/transactions/account/acc-1/range?startDate=2026-12-31&endDate=2026-01-01',
      )
      .expect(400);
  });

  it('transfers once for a double-submit with the same Idempotency-Key', async () => {
    const key = 'double-click-key-1';

    const first = await request(app.getHttpServer())
      .post('/accounts/acc-1/deposit')
      .set('Idempotency-Key', key)
      .send({ amount: 100 })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post('/accounts/acc-1/deposit')
      .set('Idempotency-Key', key)
      .send({ amount: 100 })
      .expect(201);

    // Same transaction returned both times -> money moved only once.
    expect(second.body.transactionId).toBe(first.body.transactionId);
  });

  it('returns 409 when an Idempotency-Key is reused with a different amount', async () => {
    const key = 'mismatch-key-1';

    await request(app.getHttpServer())
      .post('/accounts/acc-1/deposit')
      .set('Idempotency-Key', key)
      .send({ amount: 100 })
      .expect(201);

    await request(app.getHttpServer())
      .post('/accounts/acc-1/deposit')
      .set('Idempotency-Key', key)
      .send({ amount: 200 })
      .expect(409);
  });

  it('performs an atomic transfer with debit + credit legs (201)', () => {
    return request(app.getHttpServer())
      .post('/transactions/transfer')
      .send({ sourceAccountId: 'acc-1', destAccountId: 'acc-2', amount: 100 })
      .expect(201)
      .expect((res) => {
        expect(res.body.debit.type).toBe('WITHDRAWAL');
        expect(res.body.credit.type).toBe('DEPOSIT');
        expect(res.body.transferId).toBeDefined();
      });
  });

  it('rejects a transfer to the same account (400)', () => {
    return request(app.getHttpServer())
      .post('/transactions/transfer')
      .send({ sourceAccountId: 'acc-1', destAccountId: 'acc-1', amount: 100 })
      .expect(400);
  });

  it('rejects a pagination "limit" above the cap (400)', () => {
    return request(app.getHttpServer())
      .get('/transactions/account/acc-1?limit=500')
      .expect(400);
  });

  it('rejects a malformed (over-long) Idempotency-Key (400)', () => {
    return request(app.getHttpServer())
      .post('/accounts/acc-1/deposit')
      .set('Idempotency-Key', 'x'.repeat(300))
      .send({ amount: 100 })
      .expect(400);
  });
});
