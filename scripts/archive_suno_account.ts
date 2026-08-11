#!/usr/bin/env node
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  AccountArchiveFormat,
  AccountArchiveProgressEvent,
  ArchiveAccountOptions,
} from '../src/lib/SunoApi';
import { getDefaultAccountArchiveRoot } from '../src/lib/SunoApi';
import type { AccountArchiveCliResult, AccountArchiveStatus } from '../src/lib/accountArchiveStatus';

const LOCAL_API_STATUS_POLL_MS = 3_000;
const DEFAULT_LOCAL_API_RECOVERY_WAIT_SECONDS = 3_700;

class LocalArchiveHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'LocalArchiveHttpError';
    this.status = status;
  }
}

interface CliArgs {
  help: boolean;
  output_dir?: string;
  formats: AccountArchiveFormat[];
  limit?: number;
  target_complete?: number;
  page_size?: number;
  max_pages?: number;
  cursor?: string;
  include_incomplete: boolean;
  download_covers: boolean;
  dry_run: boolean;
  resume: boolean;
  skip_existing: boolean;
  redownload: boolean;
  wav_poll_interval_seconds?: number;
  wav_max_poll_attempts?: number;
  concurrency?: number;
  recover_stale_lock: boolean;
  max_run_history?: number;
  api_base?: string;
  via_local_api: boolean;
  local_api_request_timeout_seconds?: number;
  local_api_recovery_wait_seconds?: number;
}

function usage(): string {
  return `Usage:
  npm run download:account
  npm run download:account -- --output-dir ./output/suno-account-archive
  npm run download:account -- --dry-run --limit 20
  npm run download:account -- --formats mp3,wav --page-size 50 --max-pages 200

Options:
  --output-dir <path>          Output directory. Default: output/suno-account-archive
  --formats <mp3,wav>          Comma-separated formats. Default: mp3,wav
  --mp3-only                   Download MP3 only
  --wav-only                   Download WAV only
  --no-mp3                     Disable MP3 download
  --no-wav                     Disable WAV download
  --covers                     Also download cover images
  --limit <n>                  Stop after n listed candidates (not n completed files)
  --target-complete <n>        Continue pagination until n complete Suno clips are selected
  --page-size <n>              Suno feed page size, 1-100. Default: 50
  --max-pages <n>              Safety limit for cursor pagination. Default: 200
  --cursor <cursor>            Resume listing from a Suno feed cursor
  --include-incomplete         Include non-complete clips in the manifest/download attempt
  --redownload                 Re-download previously downloaded clips and overwrite local media
  --no-resume                  Rebuild this run without reading prior manifest state
  --no-skip-existing           Re-download files even if non-empty local files exist
  --wav-poll-interval <sec>    WAV conversion poll interval. Default: 3
  --wav-max-polls <n>          WAV conversion poll count. Default: 20
  --concurrency <n>            Concurrent clip workers, 1-3. Default: 1
  --recover-stale-lock         Recover a dead archive lock older than two hours
  --max-run-history <n>        Retain this many manifest run summaries. Default: 100
  --via-local-api              Use the running local Suno API's authenticated session
  --api-base <url>              Local API base URL; implies --via-local-api
  --local-api-request-timeout <sec>
                               Abort only the initial local API HTTP wait after sec;
                               the CLI then monitors persisted archive status
  --local-api-recovery-wait <sec>
                               Maximum status-monitor wait after a local API disconnect.
                               Default: 3700
  --dry-run                    List clips and write manifest, but do not download media
  -h, --help                   Show this help

Notes:
  - Credential priority is shell environment, then .env.local, then .env.
  - Default mode is incremental: prior successful downloads are skipped when files still exist.
  - Use --redownload only when you explicitly want to refresh existing media files.
  - --target-complete counts complete Suno clips; a download failure still makes the command fail.
  - If the local API connection drops after a request started, the CLI waits for
    the same output directory's persisted run result instead of resubmitting.
  - Signed media URLs are never written to the manifest.
`;
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parsePositiveNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive number`);
  }
  return parsed;
}

function parseNonNegativeNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative number`);
  }
  return parsed;
}

function parseFormats(value: string): AccountArchiveFormat[] {
  const formats = value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const allowed = new Set(['mp3', 'wav']);
  for (const format of formats) {
    if (!allowed.has(format)) {
      throw new Error(`Unsupported format: ${format}`);
    }
  }
  return [...new Set(formats)] as AccountArchiveFormat[];
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    help: false,
    formats: ['mp3', 'wav'],
    include_incomplete: false,
    download_covers: false,
    dry_run: false,
    resume: true,
    skip_existing: true,
    redownload: false,
    recover_stale_lock: false,
    via_local_api: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (item === '-h' || item === '--help') args.help = true;
    else if (item === '--output-dir') args.output_dir = path.resolve(readValue(argv, i++, item));
    else if (item === '--formats') args.formats = parseFormats(readValue(argv, i++, item));
    else if (item === '--mp3-only') args.formats = ['mp3'];
    else if (item === '--wav-only') args.formats = ['wav'];
    else if (item === '--no-mp3') args.formats = args.formats.filter((format) => format !== 'mp3');
    else if (item === '--no-wav') args.formats = args.formats.filter((format) => format !== 'wav');
    else if (item === '--limit') args.limit = parsePositiveInt(readValue(argv, i++, item), item);
    else if (item === '--target-complete') args.target_complete = parsePositiveInt(readValue(argv, i++, item), item);
    else if (item === '--page-size') args.page_size = parsePositiveInt(readValue(argv, i++, item), item);
    else if (item === '--max-pages') args.max_pages = parsePositiveInt(readValue(argv, i++, item), item);
    else if (item === '--cursor') args.cursor = readValue(argv, i++, item);
    else if (item === '--include-incomplete') args.include_incomplete = true;
    else if (item === '--covers') args.download_covers = true;
    else if (item === '--redownload') {
      args.redownload = true;
      args.skip_existing = false;
    }
    else if (item === '--no-resume') args.resume = false;
    else if (item === '--no-skip-existing') {
      args.skip_existing = false;
      args.redownload = true;
    }
    else if (item === '--wav-poll-interval') args.wav_poll_interval_seconds = parsePositiveNumber(readValue(argv, i++, item), item);
    else if (item === '--wav-max-polls') args.wav_max_poll_attempts = parsePositiveInt(readValue(argv, i++, item), item);
    else if (item === '--concurrency') args.concurrency = parsePositiveInt(readValue(argv, i++, item), item);
    else if (item === '--recover-stale-lock') args.recover_stale_lock = true;
    else if (item === '--max-run-history') args.max_run_history = parsePositiveInt(readValue(argv, i++, item), item);
    else if (item === '--via-local-api') args.via_local_api = true;
    else if (item === '--api-base') {
      args.api_base = readValue(argv, i++, item).replace(/\/+$/, '');
      args.via_local_api = true;
    }
    else if (item === '--local-api-request-timeout') {
      args.local_api_request_timeout_seconds = parseNonNegativeNumber(readValue(argv, i++, item), item);
    }
    else if (item === '--local-api-recovery-wait') {
      args.local_api_recovery_wait_seconds = parsePositiveNumber(readValue(argv, i++, item), item);
    }
    else if (item === '--dry-run') args.dry_run = true;
    else throw new Error(`Unknown argument: ${item}`);
  }

  if (!args.help && args.formats.length === 0) {
    throw new Error('At least one format must be enabled');
  }
  if (!args.skip_existing) {
    args.redownload = true;
  }
  if (args.limit && args.target_complete) {
    throw new Error('--limit and --target-complete cannot be used together');
  }
  if (args.concurrency && args.concurrency > 3) {
    throw new Error('--concurrency cannot exceed 3');
  }

  return args;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function describeError(error: unknown): string {
  const candidate = error as { name?: unknown; message?: unknown; cause?: { code?: unknown; message?: unknown } } | undefined;
  const parts = [
    typeof candidate?.name === 'string' ? candidate.name : undefined,
    typeof candidate?.message === 'string' ? candidate.message : undefined,
    typeof candidate?.cause?.code === 'string' ? candidate.cause.code : undefined,
    typeof candidate?.cause?.message === 'string' ? candidate.cause.message : undefined,
  ].filter((value, index, all) => Boolean(value) && all.indexOf(value) === index);
  return parts.join(': ') || String(error);
}

function isCurrentLocalArchiveRun(status: AccountArchiveStatus, requestStartedAtMs: number): boolean {
  const startedAtMs = Date.parse(String(status.latest?.started_at || ''));
  return Number.isFinite(startedAtMs) && startedAtMs >= requestStartedAtMs - 10_000;
}

async function fetchLocalArchiveStatus(apiBase: string, outputDir: string): Promise<AccountArchiveStatus> {
  const statusUrl = `${apiBase}/api/archive_account?output_dir=${encodeURIComponent(outputDir)}`;
  const response = await fetch(statusUrl);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || `local archive status returned HTTP ${response.status}`);
  }
  return body as AccountArchiveStatus;
}

async function waitForDetachedLocalArchive(
  apiBase: string,
  outputDir: string,
  requestStartedAtMs: number,
  waitSeconds: number,
): Promise<AccountArchiveCliResult> {
  const deadlineMs = Date.now() + waitSeconds * 1_000;
  let lastState = 'no status';
  let announcedRunning = false;
  while (Date.now() < deadlineMs) {
    try {
      const status = await fetchLocalArchiveStatus(apiBase, outputDir);
      const isCurrentRun = isCurrentLocalArchiveRun(status, requestStartedAtMs);
      lastState = `${status.state}${isCurrentRun ? '' : ' (no matching current run yet)'}`;
      if (isCurrentRun && status.state === 'running' && !announcedRunning) {
        console.warn('Local archive request disconnected; the server is still running. Monitoring its persisted manifest...');
        announcedRunning = true;
      }
      if (isCurrentRun && (status.state === 'completed' || status.state === 'failed') && status.result) {
        return status.result;
      }
    } catch (error) {
      lastState = `status query failed: ${describeError(error)}`;
    }
    await sleep(LOCAL_API_STATUS_POLL_MS);
  }
  throw new Error(
    `Local archive request disconnected and no final result was observed within ${waitSeconds}s (${lastState}). ` +
    `Do not resubmit blindly; inspect the archive manifest and .archive.lock first.`,
  );
}

async function postLocalArchive(
  apiBase: string,
  options: ArchiveAccountOptions,
  requestTimeoutSeconds?: number,
): Promise<AccountArchiveCliResult> {
  const requestTimeoutMilliseconds = Number(requestTimeoutSeconds || 0) * 1_000;
  const controller = requestTimeoutMilliseconds > 0 ? new AbortController() : undefined;
  const timeout = controller
    ? setTimeout(() => controller.abort(), Math.round(requestTimeoutMilliseconds))
    : undefined;
  try {
    const response = await fetch(`${apiBase}/api/archive_account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...options, on_progress: undefined }),
      signal: controller?.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 207) {
      throw new LocalArchiveHttpError(
        response.status,
        result?.error || `local archive API returned HTTP ${response.status}`,
      );
    }
    return result as AccountArchiveCliResult;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function parseDotEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const equalsAt = trimmed.indexOf('=');
  if (equalsAt <= 0) return null;
  const key = trimmed.slice(0, equalsAt).trim();
  let value = trimmed.slice(equalsAt + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return [key, value.replace(/\\n/g, '\n')];
}

function loadDotEnvFile(filePath: string, inheritedKeys: Set<string>, overrideDotEnv: boolean): Set<string> {
  const applied = new Set<string>();
  if (!existsSync(filePath)) return applied;
  const body = readFileSync(filePath, 'utf8');
  for (const line of body.split(/\r?\n/)) {
    const parsed = parseDotEnvLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    if (!inheritedKeys.has(key) && (overrideDotEnv || process.env[key] === undefined)) {
      process.env[key] = value;
      applied.add(key);
    }
  }
  return applied;
}

function loadLocalEnv(): 'shell' | '.env.local' | '.env' | 'missing' {
  const cwd = process.cwd();
  const inheritedKeys = new Set(Object.keys(process.env));
  const fromEnv = loadDotEnvFile(path.join(cwd, '.env'), inheritedKeys, false);
  const fromEnvLocal = loadDotEnvFile(path.join(cwd, '.env.local'), inheritedKeys, true);
  if (inheritedKeys.has('SUNO_COOKIE')) return 'shell';
  if (fromEnvLocal.has('SUNO_COOKIE')) return '.env.local';
  if (fromEnv.has('SUNO_COOKIE')) return '.env';
  return 'missing';
}

function printProgress(event: AccountArchiveProgressEvent): void {
  if (event.type === 'listed') {
    console.log(`[listed] ${event.message}`);
    return;
  }
  const prefix = event.index && event.total
    ? `[${String(event.index).padStart(String(event.total).length, '0')}/${event.total}]`
    : '[clip]';
  if (event.type === 'clip_start') {
    console.log(`${prefix} ${event.clip_id} start`);
  } else if (event.type === 'clip_skip') {
    console.log(`${prefix} ${event.clip_id} skipped ${event.message || ''}`.trim());
  } else if (event.type === 'mp3_downloaded') {
    console.log(`${prefix} ${event.clip_id} mp3 ok`);
  } else if (event.type === 'wav_downloaded') {
    console.log(`${prefix} ${event.clip_id} wav ok`);
  } else if (event.type === 'cover_downloaded') {
    console.log(`${prefix} ${event.clip_id} cover ok`);
  } else if (event.type === 'clip_done') {
    console.log(`${prefix} ${event.clip_id} done`);
  } else if (event.type === 'clip_error') {
    console.warn(`${prefix} ${event.clip_id} error: ${event.error}`);
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return 0;
  }

  const credentialSource = loadLocalEnv();
  const apiBase = args.api_base || process.env.SUNO_ARCHIVE_API_BASE || (args.via_local_api ? 'http://127.0.0.1:3000' : undefined);
  if (!process.env.SUNO_COOKIE?.trim() && !apiBase) {
    throw new Error('SUNO_COOKIE is required. Put it in .env/.env.local or export it in the shell.');
  }
  const outputDir = path.resolve(args.output_dir || getDefaultAccountArchiveRoot());

  const options: ArchiveAccountOptions = {
    output_dir: outputDir,
    formats: args.formats,
    limit: args.limit,
    target_complete: args.target_complete,
    page_size: args.page_size,
    max_pages: args.max_pages,
    cursor: args.cursor,
    include_incomplete: args.include_incomplete,
    download_covers: args.download_covers,
    dry_run: args.dry_run,
    resume: args.resume,
    skip_existing: args.skip_existing,
    wav_poll_interval_seconds: args.wav_poll_interval_seconds,
    wav_max_poll_attempts: args.wav_max_poll_attempts,
    concurrency: args.concurrency,
    recover_stale_lock: args.recover_stale_lock,
    max_run_history: args.max_run_history,
    on_progress: printProgress,
  };

  console.log(`Formats    : ${args.formats.join(',')}`);
  console.log(`Dry run    : ${args.dry_run}`);
  console.log(`Resume     : ${args.resume}`);
  console.log(`Redownload : ${args.redownload}`);
  console.log(`Concurrency: ${args.concurrency || 1}`);
  console.log(`Auth source: ${credentialSource}`);
  console.log(`Execution : ${apiBase ? `local API ${apiBase}` : 'direct Node client'}`);
  console.log(`Output dir : ${outputDir}`);
  console.log('');

  let result: AccountArchiveCliResult;
  if (apiBase) {
    const requestStartedAtMs = Date.now();
    try {
      result = await postLocalArchive(apiBase, options, args.local_api_request_timeout_seconds);
    } catch (error) {
      if (error instanceof LocalArchiveHttpError) {
        throw error;
      }
      const waitSeconds = args.local_api_recovery_wait_seconds ?? DEFAULT_LOCAL_API_RECOVERY_WAIT_SECONDS;
      console.warn(`Local archive API request ended before a result (${describeError(error)}). Checking persisted state instead...`);
      result = await waitForDetachedLocalArchive(apiBase, outputDir, requestStartedAtMs, waitSeconds);
      console.warn(`Recovered final result from the persisted archive state: run ${result.run_id || 'unknown'}.`);
    }
  } else {
    const { sunoApi } = await import('../src/lib/SunoApi');
    const api = await sunoApi();
    result = await api.archiveAccountClips(options) as AccountArchiveCliResult;
  }
  console.log('');
  console.log(`Done. Listed ${result.listed_count} clips.`);
  console.log(`New MP3: ${result.downloaded_mp3}, new WAV: ${result.downloaded_wav}, new covers: ${result.downloaded_covers}`);
  console.log(`Existing MP3: ${result.existing_mp3}, existing WAV: ${result.existing_wav}, existing covers: ${result.existing_covers}`);
  console.log(`Skipped: ${result.skipped}, failed: ${result.failed}`);
  console.log(`Manifest: ${result.manifest_path}`);
  console.log(`Run report: ${result.run_report_path}`);
  console.log(`Completed archive entries: ${result.completed_count}`);
  console.log(`Listing stop reason: ${result.listing.stop_reason}`);
  if (!result.listing.account_scan_complete) {
    console.warn('Account scan did not reach the end of the Suno feed. Re-run without --limit/--target-complete, use a larger --max-pages, or resume from manifest latest_listing.next_cursor.');
  }
  return result.failed === 0 ? 0 : 1;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] === scriptPath) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(describeError(error));
    process.exitCode = 1;
  });
}
