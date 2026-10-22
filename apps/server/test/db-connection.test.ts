import { describe, expect, it, vi } from 'vitest';
import { createDb } from '../src/db/connection.js';
import type { Env } from '../src/config/env.js';

const { createPool } = vi.hoisted(() => ({
  createPool: vi.fn(() => ({ end: (callback: () => void) => callback() }))
}));
vi.mock('mysql2', () => ({ createPool }));

describe('database JSON return contract', () => {
  it.each(['runtime', 'migrate'] as const)('keeps JSON columns as strings for %s connections', async purpose => {
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
