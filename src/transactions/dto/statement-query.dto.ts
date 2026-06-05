import { IsDateString, Validate } from 'class-validator';
import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

@ValidatorConstraint({ name: 'isAfterStart', async: false })
class IsAfterStartConstraint implements ValidatorConstraintInterface {
  validate(endDate: string, args: ValidationArguments): boolean {
    const { startDate } = args.object as StatementQueryDto;
    if (!startDate || !endDate) return true;
    return new Date(startDate).getTime() <= new Date(endDate).getTime();
  }

  defaultMessage(): string {
    return 'endDate must be the same as or after startDate';
  }
}

export class StatementQueryDto {
  @ApiProperty({
    example: '2026-01-01',
    description: 'Start of period (ISO 8601)',
  })
  @IsDateString()
  startDate: string;

  @ApiProperty({
    example: '2026-12-31',
    description: 'End of period (ISO 8601)',
  })
  @IsDateString()
  @Validate(IsAfterStartConstraint)
  endDate: string;
}
