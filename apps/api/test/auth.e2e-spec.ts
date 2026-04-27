import { Test, type TestingModule } from '@nestjs/testing';
import { type NestFastifyApplication, FastifyAdapter } from '@nestjs/platform-fastify';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { UserEntity } from '../src/database/entities/user.entity';
import { OrganizationEntity } from '../src/database/entities/organization.entity';
import { ProjectEntity } from '../src/database/entities/project.entity';

describe('Auth → Projects (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ JWT_SECRET: 'test-secret-min-32-chars-long!!', HMAC_SECRET: 'hmac-test-secret' })],
        }),
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [UserEntity, OrganizationEntity, ProjectEntity],
          synchronize: true,
        }),
        AuthModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  let authToken: string;
  let projectId: string;

  it('POST /auth/register — creates org + owner, returns JWT', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        orgName: 'Test Org',
        orgSlug: 'test-org',
        email: 'owner@test.com',
        password: 'password123',
      })
      .expect(201);

    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('userId');
    expect(res.body).toHaveProperty('orgId');
    expect(res.body.email).toBe('owner@test.com');
    authToken = res.body.token as string;
  });

  it('POST /auth/register — rejects duplicate email', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        orgName: 'Other Org',
        orgSlug: 'other-org',
        email: 'owner@test.com',
        password: 'password123',
      })
      .expect(409);
  });

  it('POST /auth/login — returns JWT for valid credentials', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'owner@test.com', password: 'password123' })
      .expect(200);

    expect(res.body).toHaveProperty('token');
    authToken = res.body.token as string;
  });

  it('POST /auth/login — rejects wrong password', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'owner@test.com', password: 'wrongpassword' })
      .expect(401);
  });

  it('GET /org — returns org details', async () => {
    const res = await request(app.getHttpServer())
      .get('/org')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.name).toBe('Test Org');
    expect(res.body.slug).toBe('test-org');
    expect(res.body.plan).toBe('self_hosted');
  });

  it('POST /projects — creates project and returns API key', async () => {
    const res = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'My Project', description: 'Test project' })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('apiKey');
    expect(res.body.apiKey as string).toMatch(/^proj_/);
    expect(res.body.name).toBe('My Project');
    projectId = res.body.id as string;
  });

  it('GET /projects/:id — returns project without API key', async () => {
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.id).toBe(projectId);
    expect(res.body.name).toBe('My Project');
    expect(res.body).not.toHaveProperty('apiKey');
  });

  it('POST /projects/:id/rotate-key — returns new API key', async () => {
    const res = await request(app.getHttpServer())
      .post(`/projects/${projectId}/rotate-key`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);

    expect(res.body.apiKey as string).toMatch(/^proj_/);
  });

  it('GET /projects — lists projects for org', async () => {
    const res = await request(app.getHttpServer())
      .get('/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
  });

  it('protected routes reject unauthenticated requests', async () => {
    await request(app.getHttpServer()).get('/projects').expect(401);
    await request(app.getHttpServer()).get('/org').expect(401);
  });
});
