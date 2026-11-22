import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import { RegistrationController } from './registration.controller';
import { RegistrationThrottlerGuard } from './registration-throttler.guard';
import { RegistrationService } from './registration.service';

type SchemaObject = Exclude<
  NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string],
  { $ref: string }
>;

describe('Registration OpenAPI document', () => {
  let app: NestFastifyApplication;
  let document: OpenAPIObject;

  const schema = (name: string): SchemaObject =>
    document.components?.schemas?.[name] as SchemaObject;
  const property = (name: string, field: string): SchemaObject =>
    schema(name).properties?.[field] as SchemaObject;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [RegistrationController],
      providers: [{ provide: RegistrationService, useValue: {} }],
    })
      .overrideGuard(RegistrationThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['/auth/register', 'register', ['201', '202', '400', '409', '429', '503']],
    ['/auth/register/confirm', 'confirmRegistration', ['200', '400', '429']],
    [
      '/auth/register/resend',
      'resendRegistrationVerification',
      ['202', '400', '429', '503'],
    ],
  ])(
    'should document POST %s as %s with the contract statuses',
    (path, operationId, statuses) => {
      const operation = document.paths[path]?.post;

      expect(operation?.operationId).toBe(operationId);
      expect(Object.keys(operation?.responses ?? {}).sort()).toEqual(statuses);
    },
  );

  it('should document only POST operations under /auth/register', () => {
    const registrationPaths = Object.entries(document.paths).filter(([path]) =>
      path.startsWith('/auth/register'),
    );

    for (const [, item] of registrationPaths) {
      expect(Object.keys(item).filter((key) => key !== 'parameters')).toEqual([
        'post',
      ]);
    }
  });

  it('should document request fields as in the contract', () => {
    expect(schema('RegisterDto').required).toEqual(['email', 'password']);
    expect(property('RegisterDto', 'email')).toMatchObject({
      format: 'email',
      maxLength: 254,
    });
    expect(property('RegisterDto', 'password')).toMatchObject({
      format: 'password',
      minLength: 8,
    });
    expect(schema('ResendRegistrationDto').required).toEqual(['email']);
    expect(property('ResendRegistrationDto', 'email')).toMatchObject({
      format: 'email',
      maxLength: 254,
    });
    expect(
      Object.keys(schema('ConfirmRegistrationDto').properties ?? {}),
    ).toEqual(['attemptId', 'code', 'token']);
  });

  it('should document response fields as in the contract', () => {
    expect(schema('UserResponse').required).toEqual(['id', 'email', 'status']);
    expect(property('UserResponse', 'email')).toMatchObject({
      format: 'email',
    });
    expect(property('UserResponse', 'status').enum).toEqual(['active']);
    expect(schema('VerificationRequiredResponse').required).toEqual([
      'confirmationRequired',
      'method',
      'attemptId',
      'expiresInSeconds',
      'resendAfterSeconds',
    ]);
    expect(
      property('VerificationRequiredResponse', 'expiresInSeconds'),
    ).toEqual({ type: 'integer', enum: [600] });
    expect(
      property('VerificationRequiredResponse', 'resendAfterSeconds'),
    ).toEqual({ type: 'integer', enum: [60] });
  });
});
