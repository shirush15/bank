import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Account, Prisma, Transaction, TransactionType } from '@prisma/client';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

export interface TransferResult {
  transferId: string;
  debit: Transaction;
  credit: Transaction;
}

@Injectable()
export class AccountsService {
  constructor(
    private prisma: PrismaService,
    @InjectPinoLogger(AccountsService.name)
    private readonly logger: PinoLogger,
  ) {}

  create(createAccountDto: CreateAccountDto): Promise<Account> {
    this.logger.info('Creating new account');

    return this.prisma.account.create({
      data: {
        personId: createAccountDto.personId,
        balance: createAccountDto.balance ?? 0,
        dailyWithdrawalLimit: createAccountDto.dailyWithdrawalLimit,
        activeFlag: createAccountDto.activeFlag ?? true,
        accountType: createAccountDto.accountType,
      },
    });
  }

  async findOne(id: string): Promise<Account> {
    const account = await this.prisma.account.findUnique({
      where: { accountId: id },
    });

    if (!account) {
      throw new NotFoundException(`Account with ID ${id} not found`);
    }

    return account;
  }

  async update(
    id: string,
    updateAccountDto: UpdateAccountDto,
  ): Promise<Account> {
    await this.findOne(id);

    return this.prisma.account.update({
      where: { accountId: id },
      data: updateAccountDto,
    });
  }

  async deposit(
    id: string,
    amount: number,
    idempotencyKey?: string,
  ): Promise<Transaction> {
    const value = this.toAmount(amount);

    const replay = await this.findIdempotentReplay(
      idempotencyKey,
      (e) =>
        e.accountId === id &&
        e.type === TransactionType.DEPOSIT &&
        !e.transferId &&
        e.value.equals(value),
    );
    if (replay) return replay;

    try {
      return await this.runSerializable(async (tx) => {
        await this.requireActiveAccount(tx, id);

        await tx.account.update({
          where: { accountId: id },
          data: { balance: { increment: value } },
        });

        const transaction = await tx.transaction.create({
          data: {
            accountId: id,
            value,
            type: TransactionType.DEPOSIT,
            idempotencyKey,
          },
        });

        this.logger.info(
          {
            accountId: id,
            amount: value.toFixed(2),
            transactionId: transaction.transactionId,
          },
          'Deposit applied',
        );

        return transaction;
      });
    } catch (error) {
      const recovered = await this.recoverFromKeyRace(idempotencyKey, error);
      if (recovered) return recovered;
      throw error;
    }
  }

  async withdraw(
    id: string,
    amount: number,
    idempotencyKey?: string,
  ): Promise<Transaction> {
    const value = this.toAmount(amount);

    const replay = await this.findIdempotentReplay(
      idempotencyKey,
      (e) =>
        e.accountId === id &&
        e.type === TransactionType.WITHDRAWAL &&
        !e.transferId &&
        e.value.equals(value),
    );
    if (replay) return replay;

    try {
      return await this.runSerializable(async (tx) => {
        const account = await this.requireActiveAccount(tx, id);

        await this.assertWithinDailyLimit(tx, account, value);
        await this.debit(tx, id, value);

        const transaction = await tx.transaction.create({
          data: {
            accountId: id,
            value,
            type: TransactionType.WITHDRAWAL,
            idempotencyKey,
          },
        });

        this.logger.info(
          {
            accountId: id,
            amount: value.toFixed(2),
            transactionId: transaction.transactionId,
          },
          'Withdrawal applied',
        );

        return transaction;
      });
    } catch (error) {
      const recovered = await this.recoverFromKeyRace(idempotencyKey, error);
      if (recovered) return recovered;
      throw error;
    }
  }

  async transfer(
    sourceAccountId: string,
    destAccountId: string,
    amount: number,
    idempotencyKey?: string,
  ): Promise<TransferResult> {
    if (sourceAccountId === destAccountId) {
      throw new BadRequestException('Cannot transfer to the same account');
    }
    const value = this.toAmount(amount);

    const replay = await this.findIdempotentReplay(
      idempotencyKey,
      (e) =>
        e.accountId === sourceAccountId &&
        e.counterpartyAccountId === destAccountId &&
        e.type === TransactionType.WITHDRAWAL &&
        e.value.equals(value),
    );
    if (replay?.transferId) return this.loadTransfer(replay.transferId);

    const transferId = randomUUID();

    try {
      return await this.runSerializable(async (tx) => {
        const source = await this.requireActiveAccount(
          tx,
          sourceAccountId,
          'Source account',
        );
        await this.requireActiveAccount(
          tx,
          destAccountId,
          'Destination account',
        );

        await this.assertWithinDailyLimit(tx, source, value);

        await this.debit(tx, sourceAccountId, value);
        await tx.account.update({
          where: { accountId: destAccountId },
          data: { balance: { increment: value } },
        });

        const debit = await tx.transaction.create({
          data: {
            accountId: sourceAccountId,
            value,
            type: TransactionType.WITHDRAWAL,
            transferId,
            counterpartyAccountId: destAccountId,
            idempotencyKey,
          },
        });
        const credit = await tx.transaction.create({
          data: {
            accountId: destAccountId,
            value,
            type: TransactionType.DEPOSIT,
            transferId,
            counterpartyAccountId: sourceAccountId,
          },
        });

        this.logger.info(
          {
            transferId,
            sourceAccountId,
            destAccountId,
            amount: value.toFixed(2),
          },
          'Transfer applied',
        );

        return { transferId, debit, credit };
      });
    } catch (error) {
      const recovered = await this.recoverFromKeyRace(idempotencyKey, error);
      if (recovered?.transferId) return this.loadTransfer(recovered.transferId);
      throw error;
    }
  }

  // --- internals -----------------------------------------------------------

  private toAmount(amount: number): Prisma.Decimal {
    const value = new Prisma.Decimal(amount);
    if (!value.isFinite() || value.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Amount must be a positive number');
    }
    return value;
  }

  private async requireActiveAccount(
    tx: Prisma.TransactionClient,
    id: string,
    label = 'Account',
  ): Promise<Account> {
    const account = await tx.account.findUnique({ where: { accountId: id } });
    if (!account) {
      throw new NotFoundException(`${label} with ID ${id} not found`);
    }
    if (!account.activeFlag) {
      throw new BadRequestException(`${label} is blocked`);
    }
    return account;
  }

  private async debit(
    tx: Prisma.TransactionClient,
    id: string,
    value: Prisma.Decimal,
  ): Promise<void> {
    const { count } = await tx.account.updateMany({
      where: { accountId: id, balance: { gte: value } },
      data: { balance: { decrement: value } },
    });
    if (count === 0) {
      throw new BadRequestException('Insufficient funds');
    }
  }

  private async assertWithinDailyLimit(
    tx: Prisma.TransactionClient,
    account: Account,
    amount: Prisma.Decimal,
  ): Promise<void> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const { _sum } = await tx.transaction.aggregate({
      where: {
        accountId: account.accountId,
        type: TransactionType.WITHDRAWAL,
        transactionDate: { gte: startOfDay },
      },
      _sum: { value: true },
    });

    const withdrawnToday = _sum.value ?? new Prisma.Decimal(0);

    if (withdrawnToday.plus(amount).greaterThan(account.dailyWithdrawalLimit)) {
      const remaining = account.dailyWithdrawalLimit.minus(withdrawnToday);
      throw new BadRequestException(
        `Withdrawal exceeds daily limit of ${account.dailyWithdrawalLimit.toFixed(
          2,
        )}. Remaining today: ${remaining.toFixed(2)}`,
      );
    }
  }

  private async runSerializable<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < MAX_ATTEMPTS
        ) {
          this.logger.warn({ attempt }, 'Serialization conflict, retrying');
          continue;
        }
        throw error;
      }
    }
  }

  private async findIdempotentReplay(
    idempotencyKey: string | undefined,
    matches: (existing: Transaction) => boolean,
  ): Promise<Transaction | null> {
    if (!idempotencyKey) return null;

    const existing = await this.prisma.transaction.findUnique({
      where: { idempotencyKey },
    });
    if (!existing) return null;

    if (!matches(existing)) {
      throw new ConflictException(
        'Idempotency-Key was already used with different parameters',
      );
    }

    this.logger.info(
      { idempotencyKey, transactionId: existing.transactionId },
      'Idempotent replay',
    );
    return existing;
  }

  private async recoverFromKeyRace(
    idempotencyKey: string | undefined,
    error: unknown,
  ): Promise<Transaction | null> {
    if (
      idempotencyKey &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return this.prisma.transaction.findUnique({ where: { idempotencyKey } });
    }
    return null;
  }

  private async loadTransfer(transferId: string): Promise<TransferResult> {
    const rows = await this.prisma.transaction.findMany({
      where: { transferId },
    });
    const debit = rows.find((r) => r.type === TransactionType.WITHDRAWAL);
    const credit = rows.find((r) => r.type === TransactionType.DEPOSIT);
    if (!debit || !credit) {
      throw new NotFoundException(`Transfer ${transferId} not found`);
    }
    return { transferId, debit, credit };
  }
}
