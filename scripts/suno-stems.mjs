#!/usr/bin/env node

const usage = `Usage:
  suno-stems song --clip-id ID [--format wav|mp3] [options]
  suno-stems studio --clip-id ID [options]

Options:
  --api-base URL                 API base URL (default: SUNO_API_BASE_URL or http://127.0.0.1:3000)
  --download-dir PATH           Override the server-side output directory
  --force                       Ignore a verified final archive and create a fresh render
  --dry-run                     Validate metadata and upstream state without extraction or render
  --keep-inflight               Preserve the completed .inflight directory
  --extract-timeout-ms N        Song extraction timeout
  --download-timeout-ms N       ZIP download timeout
  --queue-timeout-ms N          Per-clip lock wait timeout
  --help                        Show this help
`;

function fail(message, code = 2) {
  if (message) console.error(`suno-stems: ${message}`);
  console.error(usage);
  process.exit(code);
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  if (!command || command === '--help' || command === '-h') {
    console.log(usage);
    process.exit(0);
  }
  if (command !== 'song' && command !== 'studio') fail('command must be song or studio');
  const options = {};
  const booleans = new Set(['force', 'dry-run', 'keep-inflight']);
  const values = new Set([
    'clip-id',
    'format',
    'api-base',
    'download-dir',
    'extract-timeout-ms',
    'download-timeout-ms',
    'queue-timeout-ms',
  ]);
  while (args.length) {
    const token = args.shift();
    if (token === '--help' || token === '-h') {
      console.log(usage);
      process.exit(0);
    }
    if (!token?.startsWith('--')) fail(`unexpected argument: ${token || ''}`);
    const key = token.slice(2);
    if (booleans.has(key)) {
      options[key] = true;
      continue;
    }
    if (!values.has(key)) fail(`unknown option: --${key}`);
    const value = args.shift();
    if (value === undefined || value.startsWith('--')) fail(`missing value for --${key}`);
    options[key] = value;
  }
  return { command, options };
}

function integerOption(options, key) {
  if (options[key] === undefined) return undefined;
  const value = Number(options[key]);
  if (!Number.isInteger(value) || value <= 0) fail(`--${key} must be a positive integer`);
  return value;
}

const { command, options } = parseArgs(process.argv.slice(2));
const clipId = String(options['clip-id'] || '').trim().toLowerCase();
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(clipId)) {
  fail('--clip-id must be a UUID');
}
const format = String(options.format || 'wav').toLowerCase();
if (command === 'song' && !['wav', 'mp3'].includes(format)) {
  fail('--format must be wav or mp3 for the pure HTTP Song path');
}
if (command === 'studio' && options.format !== undefined) fail('--format is only valid for the song command');

const apiBase = String(options['api-base'] || process.env.SUNO_API_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
let endpoint;
try {
  endpoint = new URL(command === 'song' ? '/api/song_auto_stems_download' : '/api/studio_multitrack', apiBase);
} catch {
  fail('--api-base must be a valid HTTP or HTTPS URL');
}
if (!/^https?:$/.test(endpoint.protocol)) fail('--api-base must use HTTP or HTTPS');

const body = {
  clip_id: clipId,
  backend: 'http',
  force_redownload: Boolean(options.force),
  dry_run: Boolean(options['dry-run']),
  cleanup_run_dir: !options['keep-inflight'],
  ...(options['download-dir'] ? { download_dir: options['download-dir'] } : {}),
  ...(command === 'song' ? { stem_format: format } : {}),
};
for (const [option, field] of [
  ['extract-timeout-ms', 'extract_timeout_ms'],
  ['download-timeout-ms', 'download_timeout_ms'],
  ['queue-timeout-ms', 'queue_timeout_ms'],
]) {
  const value = integerOption(options, option);
  if (value !== undefined) body[field] = value;
}

let response;
try {
  response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: { code: 'SUNO_STEMS_API_UNREACHABLE', message: error?.message || String(error) },
  }, null, 2));
  process.exit(3);
}

const raw = await response.text();
let result;
try {
  result = raw ? JSON.parse(raw) : null;
} catch {
  result = { ok: false, error: { code: 'INVALID_API_RESPONSE', message: raw.slice(0, 1000) } };
}
console.log(JSON.stringify(result, null, 2));
if (!response.ok || !result?.ok) process.exit(1);
