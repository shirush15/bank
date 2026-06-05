import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  Max,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TransferDto {
  @ApiProperty({ description: 'Account the money leaves' })
  @IsString()
  @IsNotEmpty()
  sourceAccountId: string;

  @ApiProperty({ description: 'Account the money arrives in' })
  @IsString()
  @IsNotEmpty()
  destAccountId: string;

  @ApiProperty({ example: 250.0, description: 'Amount to transfer' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(1_000_000_000_000)
  amount: number;
}
