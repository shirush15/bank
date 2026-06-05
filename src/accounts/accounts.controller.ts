import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Account, Transaction } from '@prisma/client';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { AmountDto } from './dto/amount.dto';
import {
  IdempotencyKey,
  ApiIdempotencyKey,
} from '../common/decorators/idempotency-key.decorator';

@ApiTags('accounts')
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new account' })
  create(@Body() createAccountDto: CreateAccountDto): Promise<Account> {
    return this.accountsService.create(createAccountDto);
  }

  @Get(':accountId')
  @ApiOperation({ summary: 'Get a single account' })
  findOne(@Param('accountId') accountId: string): Promise<Account> {
    return this.accountsService.findOne(accountId);
  }

  @Patch(':accountId')
  @ApiOperation({ summary: 'Update account settings' })
  update(
    @Param('accountId') accountId: string,
    @Body() updateAccountDto: UpdateAccountDto,
  ): Promise<Account> {
    return this.accountsService.update(accountId, updateAccountDto);
  }

  @Post(':accountId/deposit')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Deposit money into an account' })
  @ApiIdempotencyKey()
  deposit(
    @Param('accountId') accountId: string,
    @Body() body: AmountDto,
    @IdempotencyKey() idempotencyKey?: string,
  ): Promise<Transaction> {
    return this.accountsService.deposit(accountId, body.amount, idempotencyKey);
  }

  @Post(':accountId/withdraw')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Withdraw money from an account' })
  @ApiIdempotencyKey()
  withdraw(
    @Param('accountId') accountId: string,
    @Body() body: AmountDto,
    @IdempotencyKey() idempotencyKey?: string,
  ): Promise<Transaction> {
    return this.accountsService.withdraw(
      accountId,
      body.amount,
      idempotencyKey,
    );
  }
}
