import { loadEnv } from './config/env.js';
import { createDb } from './db/connection.js';
import { createFileKeyProvider } from './crypto/keyProvider.js';
import { buildApp } from './http/app.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const db = createDb(env);
  const keyProvider = createFileKeyProvider(env.KEK_FILE_PATH);
  const app = await buildApp({ env, db, keyProvider });

  const closeGracefully = async (signal: string): Promise<void> => {
    app.log.info(`${signal} empfangen, fahre herunter...`);
    await app.close();
    await db.destroy();
    process.exit(0);
  };
  process.on('SIGTERM', () => void closeGracefully('SIGTERM'));
  process.on('SIGINT', () => void closeGracefully('SIGINT'));

  await app.listen({ host: env.HOST, port: env.PORT });
}

main().catch(err => {
  console.error('Start fehlgeschlagen:', err);
  process.exit(1);
});
