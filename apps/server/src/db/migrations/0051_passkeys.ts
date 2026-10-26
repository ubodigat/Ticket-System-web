import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
export const migration_0051_passkeys: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema.createTable('user_passkeys')
      .addColumn('id', sql`varchar(700) character set ascii collate ascii_bin`, c => c.primaryKey())
      .addColumn('user_id', 'char(36)', c => c.notNull().references('users.id').onDelete('cascade'))
      .addColumn('public_key', 'blob', c => c.notNull())
      .addColumn('counter', 'bigint', c => c.notNull())
      .addColumn('label', 'varchar(100)', c => c.notNull())
      .addColumn('transports_json', 'text', c => c.notNull())
      .addColumn('created_at', 'timestamp', c => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)).execute();
    await db.schema.createTable('mfa_flows')
      .addColumn('token_hash', 'char(64)', c => c.primaryKey())
      .addColumn('user_id', 'char(36)', c => c.notNull().references('users.id').onDelete('cascade'))
      .addColumn('purpose', 'varchar(16)', c => c.notNull())
      .addColumn('state_json', 'text', c => c.notNull())
      .addColumn('expires_at', 'datetime', c => c.notNull()).execute();
    await db.schema.createTable('mfa_devices')
      .addColumn('token_hash', 'char(64)', c => c.primaryKey())
      .addColumn('user_id', 'char(36)', c => c.notNull().references('users.id').onDelete('cascade'))
      .addColumn('verified_at', 'datetime', c => c.notNull()).execute();
    await db.schema.createTable('mfa_recovery_codes')
      .addColumn('user_id', 'char(36)', c => c.notNull().references('users.id').onDelete('cascade'))
      .addColumn('code_hash', 'char(64)', c => c.notNull())
      .addPrimaryKeyConstraint('mfa_recovery_pk', ['user_id', 'code_hash']).execute();
  },
  async down() { throw new Error('Forward-only MFA migration'); }
};
