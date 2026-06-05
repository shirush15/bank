import { Injectable } from '@nestjs/common';
import { Transaction } from '@prisma/client';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';
import { TransferDto } from './dto/transfer.dto';
import { AccountsService, TransferResult } from '../accounts/accounts.service';

@Injectable()
export class TransactionsService {
  constructor(
    private prisma: PrismaService,
    private accountsService: AccountsService,
    @InjectPinoLogger(TransactionsService.name)
    private readonly logger: PinoLogger,
  ) {}

  transfer(dto: TransferDto, idempotencyKey?: string): Promise<TransferResult> {
    this.logger.info(
      {
        sourceAccountId: dto.sourceAccountId,
        destAccountId: dto.destAccountId,
      },
      'Creating transfer',
    );
    return this.accountsService.transfer(
      dto.sourceAccountId,
      dto.destAccountId,
      dto.amount,
      idempotencyKey,
    );
  }

  findByAccountId(
    accountId: string,
    page = 1,
    limit = 50,
  ): Promise<Transaction[]> {
    return this.prisma.transaction.findMany({
      where: { accountId },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { transactionDate: 'desc' },
    });
  }

  findByAccountAndDateRange(
    accountId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<Transaction[]> {
    return this.prisma.transaction.findMany({
      where: {
        accountId,
        transactionDate: { gte: startDate, lte: endDate },
      },
      orderBy: { transactionDate: 'desc' },
    });
  }
}
