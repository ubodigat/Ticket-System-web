import { z } from 'zod';

// Alle Secrets kommen ausschließlich aus Umgebungsvariablen (vom install.sh-Skript generiert
// und in die Container-Umgebung injiziert). Es gibt bewusst keine Default-Werte für Secrets --
// ein fehlender Wert muss den Start verhindern, nicht stillschweigend einen unsicheren Default liefern.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('127.0.0.1'),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_SSL_CA_PATH: z.string().min(1).optional(),
  DB_SSL_REJECT_UNAUTHORIZED: z.coerce.boolean().default(true),

  KEK_FILE_PATH: z.string().min(1),
  COOKIE_SECRET: z.string().min(32),

  INSTALLATION_ID: z.string().uuid(),
  SCHEMA_VERSION: z.coerce.number().int().positive().default(1),

  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).default(1)
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

// Wirft beim ersten fehlerhaften/fehlenden Wert -- der Prozess darf mit unvollständiger
// Konfiguration nicht hochfahren (verhindert "Start mit unsicherem Default").
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Ungültige/fehlende Konfiguration: ${details}`);
  }
  cached = parsed.data;
  return cached;
}
