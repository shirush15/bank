import {
  IsNumber,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsPositive,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AccountType } from '../enums/account-type.enum';

export class UpdateAccountDto {
  @ApiProperty({ required: false, example: 1000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @IsOptional()
  dailyWithdrawalLimit?: number;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  activeFlag?: boolean;

  @ApiProperty({ required: false, enum: AccountType })
  @IsEnum(AccountType)
  @IsOptional()
  accountType?: AccountType;
}
