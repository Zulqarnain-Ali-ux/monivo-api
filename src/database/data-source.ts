import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host:     process.env.DB_HOST     ?? 'localhost',
  port:     parseInt(process.env.DB_PORT ?? '5432', 10),
  database: process.env.DB_NAME     ?? 'monivo',
  username: process.env.DB_USER     ?? 'monivo',
  password: process.env.DB_PASSWORD ?? 'changeme',
  ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  entities: process.env.NODE_ENV === 'production'
    ? ['dist/modules/**/*.entity.js']
    : ['src/modules/**/*.entity.ts'],
  migrations: process.env.NODE_ENV === 'production'
    ? ['dist/database/migrations/*.js']
    : ['src/database/migrations/*.ts'],
  synchronize: false,
  logging: ['error', 'migration'],
});
