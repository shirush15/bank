import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsEnum,
  IsOptional,
  IsBoolean,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AccountType } from '../enums/account-type.enum';

export class CreateAccountDto {
  @ApiProperty({
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    description: 'Owner identifier',
  })
  @IsString()
  @IsNotEmpty()
  personId: string;

  @ApiProperty({ required: false, default: 0, description: 'Opening balance' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  balance?: number;

  @ApiProperty({
    example: 1000,
    description: 'Maximum total that can be withdrawn per calendar day',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  dailyWithdrawalLimit: number;

  @ApiProperty({ required: false, default: true })
  @IsBoolean()
  @IsOptional()
  activeFlag?: boolean;

  @ApiProperty({ enum: AccountType, example: AccountType.CHECKING })
  @IsEnum(AccountType)
  accountType: AccountType;
}
