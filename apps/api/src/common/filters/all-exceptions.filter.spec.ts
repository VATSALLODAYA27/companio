import { ArgumentsHost, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

/**
 * This is the single global error boundary SECURITY.md §9 promises
 * ("Never logged... full request bodies"; "no stack trace in the client
 * response"). It has no other test coverage anywhere in the app — every
 * e2e-spec.ts builds a minimal `Test.createTestingModule` and never calls
 * `app.useGlobalFilters()`, so this file is the only place the filter's
 * actual behavior — what a client receives when something goes wrong —
 * is ever exercised. See TESTING.md "Cross-cutting gaps closed in Phase 9".
 */
describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;
  let loggerErrorSpy: jest.SpyInstance;

  function hostFor(): ArgumentsHost {
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    const response = { status: statusMock };
    const request = { method: 'POST', url: '/api/v1/profile/me' };
    return {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as unknown as ArgumentsHost;
  }

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('passes through an HttpException\'s real status code', () => {
    const exception = new ConflictException('You have already blocked this user');
    filter.catch(exception, hostFor());
    expect(statusMock).toHaveBeenCalledWith(409);
  });

  it('wraps a string-shaped HttpException response into { message }', () => {
    const exception = new ConflictException('You have already blocked this user');
    filter.catch(exception, hostFor());
    const body = jsonMock.mock.calls[0][0];
    expect(body.message).toBe('You have already blocked this user');
    expect(body.statusCode).toBe(409);
    expect(body.path).toBe('/api/v1/profile/me');
    expect(typeof body.timestamp).toBe('string');
  });

  it('spreads an object-shaped HttpException response (e.g. class-validator) rather than double-wrapping it', () => {
    const exception = new BadRequestException({
      statusCode: 400,
      message: ['blockedUserId must be a UUID'],
      error: 'Bad Request',
    });
    filter.catch(exception, hostFor());
    const body = jsonMock.mock.calls[0][0];
    expect(body.message).toEqual(['blockedUserId must be a UUID']);
    expect(body.error).toBe('Bad Request');
    // the filter's own statusCode/path/timestamp still win over anything
    // of the same name accidentally present in the exception's payload
    expect(body.statusCode).toBe(400);
    expect(body.path).toBe('/api/v1/profile/me');
  });

  it('maps a non-HttpException (an unexpected crash) to a generic 500 with no internal detail', () => {
    const exception = new Error('connection refused at 10.0.0.5:5432 user=companio password=hunter2');
    filter.catch(exception, hostFor());

    expect(statusMock).toHaveBeenCalledWith(500);
    const body = jsonMock.mock.calls[0][0];
    expect(body.message).toBe('Something went wrong. Please try again.');
    expect(JSON.stringify(body)).not.toContain('10.0.0.5');
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(JSON.stringify(body)).not.toContain('connection refused');
  });

  it('never leaks a stack trace to the client for a non-HttpException', () => {
    const exception = new Error('boom');
    exception.stack = 'Error: boom\n    at SomeInternalFile.ts:42:7\n    at /home/claude/companio/apps/api/src/x.ts';
    filter.catch(exception, hostFor());

    const body = jsonMock.mock.calls[0][0];
    expect(JSON.stringify(body)).not.toContain('at SomeInternalFile.ts');
    expect(JSON.stringify(body)).not.toContain('companio/apps/api');
  });

  it('logs the stack trace server-side for a non-HttpException, but not for an HttpException', () => {
    const httpExc = new ConflictException('already blocked');
    filter.catch(httpExc, hostFor());
    expect(loggerErrorSpy).toHaveBeenLastCalledWith(
      expect.stringContaining('POST /api/v1/profile/me -> 409'),
      undefined,
    );

    const crash = new Error('unexpected');
    crash.stack = 'Error: unexpected\n    at somewhere.ts:1:1';
    filter.catch(crash, hostFor());
    expect(loggerErrorSpy).toHaveBeenLastCalledWith(
      expect.stringContaining('POST /api/v1/profile/me -> 500'),
      crash.stack,
    );
  });

  it('handles a completely non-Error, non-HttpException throw (e.g. a rejected string/object) without itself crashing', () => {
    const exception = { weird: 'not an Error instance' };
    expect(() => filter.catch(exception, hostFor())).not.toThrow();
    expect(statusMock).toHaveBeenCalledWith(500);
    const body = jsonMock.mock.calls[0][0];
    expect(body.message).toBe('Something went wrong. Please try again.');
  });
});
