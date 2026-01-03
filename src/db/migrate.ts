import { sql } from 'kysely'
import { db } from './connection.js'

async function migrate() {
  console.log('Running migrations...')

  await db.schema
    .createTable('cities')
    .ifNotExists()
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('country', 'text', (col) => col.notNull())
    .execute()

  await db.schema
    .createTable('depots')
    .ifNotExists()
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('city_id', 'integer', (col) =>
      col.notNull().references('cities.id').onDelete('cascade')
    )
    .addColumn('company_name', 'text', (col) => col.notNull())
    .execute()

  await db.schema
    .createTable('cargo_types')
    .ifNotExists()
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull().unique())
    .addColumn('value', 'integer', (col) => col.notNull())
    .execute()

  await db.schema
    .createTable('trailer_types')
    .ifNotExists()
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull().unique())
    .execute()

  await db.schema
    .createTable('depot_cargoes')
    .ifNotExists()
    .addColumn('depot_id', 'integer', (col) =>
      col.notNull().references('depots.id').onDelete('cascade')
    )
    .addColumn('cargo_type_id', 'integer', (col) =>
      col.notNull().references('cargo_types.id').onDelete('cascade')
    )
    .execute()

  await sql`
    DO $$ BEGIN
      ALTER TABLE depot_cargoes ADD CONSTRAINT depot_cargoes_pk PRIMARY KEY (depot_id, cargo_type_id);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `.execute(db)

  await db.schema
    .createTable('cargo_trailers')
    .ifNotExists()
    .addColumn('cargo_type_id', 'integer', (col) =>
      col.notNull().references('cargo_types.id').onDelete('cascade')
    )
    .addColumn('trailer_type_id', 'integer', (col) =>
      col.notNull().references('trailer_types.id').onDelete('cascade')
    )
    .execute()

  await sql`
    DO $$ BEGIN
      ALTER TABLE cargo_trailers ADD CONSTRAINT cargo_trailers_pk PRIMARY KEY (cargo_type_id, trailer_type_id);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `.execute(db)

  // Create indexes for common queries
  await sql`CREATE INDEX IF NOT EXISTS idx_depots_city ON depots(city_id)`.execute(db)
  await sql`CREATE INDEX IF NOT EXISTS idx_depot_cargoes_depot ON depot_cargoes(depot_id)`.execute(db)
  await sql`CREATE INDEX IF NOT EXISTS idx_cargo_trailers_cargo ON cargo_trailers(cargo_type_id)`.execute(db)

  console.log('Migrations complete!')
  await db.destroy()
}

migrate().catch(console.error)
