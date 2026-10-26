// Release maintenance: regenerate after source changes, before publishing the commit.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0').filter(p => p && p !== 'README.md' && p !== 'install-manifest.sha256').sort();
const manifest = [...new Set(files)].map(path => {
  let bytes = readFileSync(path);
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (!bytes.includes(0)) bytes = Buffer.from(text.replace(/\r\n/g, '\n'));
  } catch { /* Binary files are hashed verbatim. */ }
  return `${createHash('sha256').update(bytes).digest('hex')}  ${path}`;
}).join('\n') + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync('install-manifest.sha256', 'utf8') !== manifest) throw new Error('Install manifest is stale; run node ops/create-install-manifest.mjs');
} else writeFileSync('install-manifest.sha256', manifest);
const manifestHash = createHash('sha256').update(manifest).digest('hex');
console.log('INSTALL_MANIFEST_SHA256=' + manifestHash);
if (!process.argv.includes('--check')) {
  const installerHash = createHash('sha256').update(readFileSync('install.sh', 'utf8').replace(/\r\n/g, '\n')).digest('hex');
  const readme = readFileSync('README.md', 'utf8');
  const updated = readme.replace(/^bash -c 'set -e[^\r\n]*raw\.githubusercontent\.com\/ubodigat\/Ticket-System-web\/main\/install\.sh[^\r\n]*$/gm, line => {
    let args = line.includes('--domain=') ? ' --domain=support.example.com --acme-email=admin@example.com' : line.includes('--dev') ? ' --dev' : '';
    if (line.includes('--enable-office-viewer')) args += ' --enable-office-viewer';
    return `bash -c 'set -euo pipefail; if ! command -v curl >/dev/null; then apt-get update && apt-get install -y curl ca-certificates; fi; f=$(mktemp); trap "rm -f \\"$f\\"" EXIT; curl -fsSL https://raw.githubusercontent.com/ubodigat/Ticket-System-web/main/install.sh -o "$f"; printf "%s  %s\\n" "${installerHash}" "$f" | sha256sum -c -; INSTALL_MANIFEST_SHA256=${manifestHash} bash "$f"${args}'`;
  });
  writeFileSync('README.md', updated);
}
