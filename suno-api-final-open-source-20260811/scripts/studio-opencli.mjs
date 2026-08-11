#!/usr/bin/env node
/**
 * Thin acceptance wrapper for the direct Studio HTTP routes.
 * It never talks to studio-api.prod.suno.com directly and never retries a POST.
 */
import { readFile } from 'node:fs/promises';

const BASE_URL = (process.env.SUNO_OPENCLI_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const ROUTES = {
  projects: ['GET', '/api/studio/projects'],
  export: ['POST', '/api/studio/export'],
  multitrack: ['POST', '/api/studio/multitrack'],
  generate: ['POST', '/api/studio/generate'],
  revision: ['GET', '/api/studio/revisions/:revisionId'],
  media: ['GET', '/api/studio/media/:clipId?kind=waveform|downbeats|midi|aligned_lyrics|novelty|stems|stems_pages|projects'],
  unverified_actions: ['GET', '/api/studio/unverified_actions'],
};

function usage() {
  console.log(`Usage:
  studio-opencli.mjs doctor [--live]
  studio-opencli.mjs projects
  studio-opencli.mjs project <studioProjectId>
  studio-opencli.mjs versions <studioProjectId>
  studio-opencli.mjs version <studioProjectId> <versionId>
  studio-opencli.mjs revision <revisionId>
  studio-opencli.mjs media <clipId> <kind>
  studio-opencli.mjs unverified_actions
  studio-opencli.mjs export --payload payload.json
  studio-opencli.mjs multitrack --payload payload.json
  studio-opencli.mjs generate --payload payload.json [--confirm-paid]
  studio-opencli.mjs resume <idempotencyKey>

The CLI is a thin wrapper around the local HTTP service. It does not retry
requests. Paid generation additionally requires the server-side safety gate.`);
}

function json(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function readPayload(args) {
  const index = args.indexOf('--payload');
  if (index < 0 || !args[index + 1]) throw new Error('--payload <file.json> is required');
  return JSON.parse(await readFile(args[index + 1], 'utf8'));
}

async function request(method, route, body, extraHeaders = {}) {
  const response = await fetch(`${BASE_URL}${route}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let value;
  try { value = text ? JSON.parse(text) : null; } catch { value = { raw: text }; }
  if (!response.ok) {
    const error = new Error(value?.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.body = value;
    throw error;
  }
  return value;
}

async function doctor(args) {
  const checks = Object.entries(ROUTES).map(([name, [method, route]]) => ({ name, method, route, status: 'not_requested' }));
  if (args.includes('--live')) {
    for (const check of checks) {
      const route = check.route.replace(/\|.*$/, '').replace(':clipId', 'invalid');
      try {
        await request('OPTIONS', route);
        check.status = 'pass';
      } catch (error) {
        check.status = `fail:${error.status || error.message}`;
      }
    }
  }
  json({ ok: checks.every((check) => check.status === 'pass' || check.status === 'not_requested'), base_url: BASE_URL, checks });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') { usage(); return; }
  if (command === 'doctor') { await doctor(args); return; }
  if (command === 'projects') { json(await request('GET', '/api/studio/projects')); return; }
  if (command === 'project') { if (!args[0]) throw new Error('project id is required'); json(await request('GET', `/api/studio/projects/${encodeURIComponent(args[0])}`)); return; }
  if (command === 'versions') { if (!args[0]) throw new Error('project id is required'); json(await request('GET', `/api/studio/projects/${encodeURIComponent(args[0])}/versions`)); return; }
  if (command === 'version') {
    if (!args[0] || !args[1]) throw new Error('project id and version id are required');
    json(await request('GET', `/api/studio/projects/${encodeURIComponent(args[0])}/versions/${encodeURIComponent(args[1])}`));
    return;
  }
  if (command === 'revision') {
    if (!args[0]) throw new Error('revision id is required');
    json(await request('GET', `/api/studio/revisions/${encodeURIComponent(args[0])}`));
    return;
  }
  if (command === 'media') {
    if (!args[0] || !args[1]) throw new Error('clip id and media kind are required');
    json(await request('GET', `/api/studio/media/${encodeURIComponent(args[0])}?kind=${encodeURIComponent(args[1])}`));
    return;
  }
  if (command === 'unverified_actions') { json(await request('GET', '/api/studio/unverified_actions')); return; }
  if (command === 'export' || command === 'multitrack' || command === 'generate') {
    const payload = await readPayload(args);
    if (command === 'generate' && args.includes('--confirm-paid')) payload.confirm_paid_generation = true;
    const headers = command === 'generate' && process.env.SUNO_STUDIO_PAID_API_TOKEN
      ? { 'x-suno-studio-token': process.env.SUNO_STUDIO_PAID_API_TOKEN }
      : {};
    json(await request('POST', `/api/studio/${command}`, payload, headers));
    return;
  }
  if (command === 'resume') {
    if (!args[0]) throw new Error('idempotency key is required');
    const headers = process.env.SUNO_STUDIO_PAID_API_TOKEN
      ? { 'x-suno-studio-token': process.env.SUNO_STUDIO_PAID_API_TOKEN }
      : {};
    json(await request('GET', `/api/studio/generate?idempotency_key=${encodeURIComponent(args[0])}&resume=1`, undefined, headers));
    return;
  }
  usage();
  throw new Error(`unknown command: ${command}`);
}

main().catch((error) => {
  json({ ok: false, error: error.message, status: error.status || null, body: error.body || null });
  process.exitCode = 1;
});
