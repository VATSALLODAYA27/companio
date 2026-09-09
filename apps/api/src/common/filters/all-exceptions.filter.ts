import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Global error boundary. Never forwards a stack trace, an ORM error
 * message, or any internal detail to the client — those go to the
 * server-side logger only, and even there without request bodies (which
 * may contain location, messages, or credentials — see SECURITY.md).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const clientMessage = isHttpException
      ? exception.getResponse()
      : { message: 'Something went wrong. Please try again.' };

    this.logger.error(
      `${request.method} ${request.url} -> ${status}`,
      isHttpException ? undefined : (exception as Error)?.stack,
    );

    response.status(status).json({
      statusCode: status,
      path: request.url,
      timestamp: new Date().toISOString(),
      ...(typeof clientMessage === 'string'
        ? { message: clientMessage }
        : clientMessage),
    });
  }
}
