import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Transaction } from '@prisma/client';
import { TransactionsService } from './transactions.service';
import { TransferResult } from '../accounts/accounts.service';
import { TransferDto } from './dto/transfer.dto';
import { StatementQueryDto } from './dto/statement-query.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import {
  IdempotencyKey,
  ApiIdempotencyKey,
} from '../common/decorators/idempotency-key.decorator';

@ApiTags('transactions')
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post('transfer')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Atomically transfer money between two accounts' })
  @ApiIdempotencyKey()
  transfer(
    @Body() dto: TransferDto,
    @IdempotencyKey() idempotencyKey?: string,
  ): Promise<TransferResult> {
    return this.transactionsService.transfer(dto, idempotencyKey);
  }

  @Get('account/:accountId/range')
  @ApiOperation({ summary: 'Statement: account transactions within a period' })
  findByAccountAndDateRange(
    @Param('accountId') accountId: string,
    @Query() query: StatementQueryDto,
  ): Promise<Transaction[]> {
    return this.transactionsService.findByAccountAndDateRange(
      accountId,
      new Date(query.startDate),
      new Date(query.endDate),
    );
  }

  @Get('account/:accountId')
  @ApiOperation({ summary: "List an account's transactions (paginated)" })
  findByAccountId(
    @Param('accountId') accountId: string,
    @Query() pagination: PaginationQueryDto,
  ): Promise<Transaction[]> {
    return this.transactionsService.findByAccountId(
      accountId,
      pagination.page,
      pagination.limit,
    );
  }
}
