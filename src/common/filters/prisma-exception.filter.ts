import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  constructor(
    @InjectPinoLogger(PrismaExceptionFilter.name)
    private readonly logger: PinoLogger,
  ) {}

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    switch (exception.code) {
      case 'P2025': // Record not found
        status = HttpStatus.NOT_FOUND;
        message = 'Requested record was not found';
        break;
      case 'P2002': // Unique constraint violation
        status = HttpStatus.CONFLICT;
        message = 'A record with these values already exists';
        break;
      case 'P2003': // Foreign key constraint violation
        status = HttpStatus.BAD_REQUEST;
        message = 'Related record does not exist';
        break;
    }

    this.logger.error(
      { code: exception.code, meta: exception.meta },
      `Prisma error: ${exception.message}`,
    );

    response.status(status).json({
      statusCode: status,
      message,
      error: HttpStatus[status],
    });
  }
}
