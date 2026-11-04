import { describe, expect, it, vi } from 'vitest';
import { createDb } from '../src/db/connection.js';
import type { Env } from '../src/config/env.js';

const { createPool, handlers } = vi.hoisted(() => {
  const handlers: Record<string, (connection: unknown) => void> = {};
  return {
    handlers,
    createPool: vi.fn(() => ({
      end: (callback: () => void) => callback(),
      on: (event: string, handler: (connection: unknown) => void) => { handlers[event] = handler; }
    }))
  };
});
vi.mock('mysql2', () => ({ createPool }));

describe('database connection contract', () => {
  it('sets the session time zone to UTC on every new connection (review item 5)', async () => {
    const env = { DB_HOST: '127.0.0.1', DB_PORT: 3306, DB_NAME: 'unused', DB_USER: 'u', DB_PASSWORD: 'p' } as Env;
    const db = createDb(env, 'schema');
    try {
      const query = vi.fn();
      handlers.connection!({ query, destroy: vi.fn() });
      expect(query).toHaveBeenCalledWith("SET time_zone = '+00:00'", expect.any(Function));
    } finally { await db.destroy(); }
  });

  it.each(['runtime', 'schema'] as const)('keeps JSON columns as strings for %s connections', async purpose => {
    const env = { DB_HOST: '127.0.0.1', DB_PORT: 3306, DB_NAME: 'unused',
      DB_USER: 'migration', DB_PASSWORD: 'migration-password',
      DB_RUNTIME_USER: 'application', DB_RUNTIME_PASSWORD: 'application-password' } as Env;
    const db = createDb(env, purpose);
    try {
      expect(createPool).toHaveBeenLastCalledWith(expect.objectContaining({
        jsonStrings: true, timezone: 'Z', dateStrings: false,
        user: purpose === 'runtime' ? 'application' : 'migration'
      }));
    } finally { await db.destroy(); }
  });
});
