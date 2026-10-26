import { SignJWT, jwtVerify } from 'jose';
import { createHash } from 'node:crypto';
const key = (secret: string) => createHash('sha256').update('ticket-office-source\0' + secret).digest();
export async function signOfficeSource(secret: string, attachmentId: string, userId: string) {
  return new SignJWT({ attachmentId }).setProtectedHeader({ alg: 'HS256' }).setIssuer('ticket-system')
    .setAudience('office-source').setSubject(userId).setIssuedAt().setExpirationTime('30m').sign(key(secret));
}
export async function verifyOfficeSource(secret: string, token: string, attachmentId: string) {
  const { payload } = await jwtVerify(token, key(secret), { algorithms: ['HS256'], issuer: 'ticket-system', audience: 'office-source' });
  if (payload.attachmentId !== attachmentId || typeof payload.sub !== 'string') throw new Error('invalid_source_token');
  return payload.sub;
}
export async function signOfficeConfig(secret: string, config: Record<string, unknown>) {
  return new SignJWT(config).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30m').sign(Buffer.from(secret));
}
