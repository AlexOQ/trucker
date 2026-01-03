import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import type { Database } from '../types/database.js'

const { Pool } = pg

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({
      host: process.env.DB_HOST ?? 'localhost',
      port: parseInt(process.env.DB_PORT ?? '5433'),
      user: process.env.DB_USER ?? 'trucker',
      password: process.env.DB_PASSWORD ?? 'trucker',
      database: process.env.DB_NAME ?? 'ets2',
    }),
  }),
})
