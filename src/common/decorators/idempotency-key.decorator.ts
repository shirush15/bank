import {
  createParamDecorator,
  ExecutionContext,
  BadRequestException,
  applyDecorators,
} from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import type { Request } from 'express';

export const IDEMPOTENCY_HEADER_NAME = 'Idempotency-Key';
const MAX_LENGTH = 255;

export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const raw = request.headers['idempotency-key'];
    const value = Array.isArray(raw) ? raw[0] : raw;

    if (value === undefined) return undefined;

    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_LENGTH) {
      throw new BadRequestException(
        `${IDEMPOTENCY_HEADER_NAME} must be between 1 and ${MAX_LENGTH} characters`,
      );
    }
    return trimmed;
  },
);

export function ApiIdempotencyKey(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiHeader({
      name: IDEMPOTENCY_HEADER_NAME,
      required: false,
      description:
        'Unique key per intent; a repeat with the same parameters returns the original result instead of moving money again',
    }),
  );
}
