import dns from 'node:dns/promises';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function defaultOutputSubdirectory(name: string): string {
  const configuredRoot = (
    process.env.SUNO_OUTPUT_DIR ||
    process.env.SUNO_OUTPUT_ROOT ||
    ''
  ).trim();
  const outputRoot = configuredRoot
    ? path.resolve(configuredRoot)
    : path.resolve(process.cwd(), 'output');
  return path.join(outputRoot, name);
}

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  mtimeMs: number;
}

export interface CdpTarget {
  id?: string;
  type: string;
  title?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
  createdByApi?: boolean;
}

export interface SongStemsRequest {
  url?: string;
  clip_id?: string;
  song_title?: string;
  stem_format?: 'wav' | 'mp3' | 'midi';
  cdp?: string;
  download_dir?: string;
  load_wait_ms?: number;
  extract_timeout_ms?: number;
  download_timeout_ms?: number;
  viewport_width?: number;
  viewport_height?: number;
  dry_run?: boolean;
  queue_timeout_ms?: number;
  cleanup_run_dir?: boolean;
  force_redownload?: boolean;
}

export interface NormalizedSongStemsRequest {
  clipId: string;
  songUrl: string;
  songTitleHint: string;
  stemFormat: 'wav' | 'mp3' | 'midi';
  cdp: string;
  downloadDir: string;
  loadWaitMs: number;
  extractTimeoutMs: number;
  downloadTimeoutMs: number;
  viewportWidth: number;
  viewportHeight: number;
  dryRun: boolean;
  queueTimeoutMs: number;
  cleanupRunDir: boolean;
  forceRedownload: boolean;
}

export interface StudioMultitrackRequest {
  clip_id?: string;
  clip_metadata?: any;
  cdp?: string;
  download_dir?: string;
  load_wait_ms?: number;
  download_timeout_ms?: number;
  viewport_width?: number;
  viewport_height?: number;
  dry_run?: boolean;
  queue_timeout_ms?: number;
  cleanup_run_dir?: boolean;
  force_redownload?: boolean;
}

export interface NormalizedStudioMultitrackRequest {
  clipId: string;
  clipTitle: string;
  studioProjectId: string;
  sourceProjectVersionId: string | null;
  studioUrl: string;
  cdp: string;
  downloadDir: string;
  loadWaitMs: number;
  downloadTimeoutMs: number;
  viewportWidth: number;
  viewportHeight: number;
  dryRun: boolean;
  queueTimeoutMs: number;
  cleanupRunDir: boolean;
  forceRedownload: boolean;
}

interface StudioMultitrackRuntime {
  getCredits?: () => Promise<any>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class StemsApiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly retryable: boolean;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    status: number = 500,
    retryable: boolean = false,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'StemsApiError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

let stemsBrowserLock: Promise<void> = Promise.resolve();

async function withStemsBrowserLock<T>(timeoutMs: number, fn: () => Promise<T>): Promise<T> {
  const previous = stemsBrowserLock;
  let release!: () => void;
  stemsBrowserLock = new Promise<void>((resolve) => { release = resolve; });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let acquired = false;
  try {
    await Promise.race([
      previous,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new StemsApiError(
          'Another stems operation is already using the managed browser; retry later.',
          'STEMS_BROWSER_BUSY',
          429,
          true,
          { queue_timeout_ms: timeoutMs },
        )), Math.max(0, timeoutMs));
      }),
    ]);
    acquired = true;
    return await fn();
  } finally {
    if (timer) clearTimeout(timer);
    if (acquired) release();
    else void previous.finally(() => release());
  }
}

export function expandHome(input?: string): string {
  const s = String(input || '').trim();
  if (!s) return s;
  if (s === '~') return os.homedir();
  if (s.startsWith('~/')) return path.join(os.homedir(), s.slice(2));
  return s;
}

function isIpHost(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || /^[0-9a-f:]+$/i.test(hostname);
}

async function resolveDockerHost(hostname: string): Promise<string> {
  if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || isIpHost(hostname)) {
    return hostname;
  }
  if (hostname === 'host.docker.internal') {
    try {
      const result = await dns.lookup(hostname, { family: 4 });
      if (result?.address) return result.address;
    } catch {
    }
  }
  return hostname;
}

export async function resolveCdpBaseUrl(input: string): Promise<string> {
  const url = new URL(String(input || 'http://127.0.0.1:18800'));
  url.hostname = await resolveDockerHost(url.hostname);
  return url.toString().replace(/\/$/, '');
}

async function httpJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err: any = new Error(`${init?.method || 'GET'} ${url} -> ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function listFiles(dir: string): Promise<FileInfo[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const out: FileInfo[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const fullPath = path.join(dir, entry.name);
      const st = await fs.stat(fullPath).catch(() => null);
      if (!st) continue;
      out.push({ name: entry.name, path: fullPath, size: st.size, mtimeMs: st.mtimeMs });
    }
    return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return [];
  }
}

const CLIP_ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function extractSunoClipId(value?: string): string {
  const raw = String(value || '').trim();
  const clipId = raw.match(CLIP_ID_PATTERN)?.[0]?.toLowerCase();
  if (!clipId) {
    throw new StemsApiError(
      'clip_id or a Suno song URL containing a clip id is required.',
      'INVALID_CLIP_ID',
      400,
      false,
      { received: raw || null },
    );
  }
  return clipId;
}

export function normalizeStemFormat(value?: string): 'wav' | 'mp3' | 'midi' {
  const format = String(value || 'wav').trim().toLowerCase();
  if (format !== 'wav' && format !== 'mp3' && format !== 'midi') {
    throw new StemsApiError(
      'stem_format must be wav, mp3, or midi.',
      'INVALID_STEM_FORMAT',
      400,
      false,
      { received: value || null },
    );
  }
  return format;
}

export interface StudioClipIdentity {
  clipId: string;
  clipTitle: string;
  studioProjectId: string;
  sourceProjectVersionId: string | null;
}

export function normalizeStudioClipMetadata(clipIdInput: string, clipMetadata: any): StudioClipIdentity {
  const clipId = extractSunoClipId(clipIdInput);
  if (!clipMetadata || typeof clipMetadata !== 'object') {
    throw new StemsApiError(
      'Suno did not return metadata for the requested clip.',
      'STUDIO_CLIP_NOT_FOUND',
      404,
      false,
      { clip_id: clipId },
    );
  }
  const returnedId = String(clipMetadata.id || clipMetadata.raw?.id || '').trim().toLowerCase();
  if (returnedId !== clipId) {
    throw new StemsApiError(
      'Suno returned metadata for a different clip id.',
      'STUDIO_CLIP_ID_MISMATCH',
      502,
      true,
      { clip_id: clipId, received: returnedId || null },
    );
  }
  const status = String(clipMetadata.status || clipMetadata.raw?.status || '').trim().toLowerCase();
  if (status !== 'complete') {
    throw new StemsApiError(
      'Studio Multitrack requires a completed studio_export clip.',
      'STUDIO_CLIP_NOT_COMPLETE',
      409,
      status === 'submitted' || status === 'queued' || status === 'streaming',
      { clip_id: clipId, received: status || null },
    );
  }
  const metadata = clipMetadata.raw?.metadata || clipMetadata.metadata || {};
  const type = String(clipMetadata.type || metadata.type || '').trim().toLowerCase();
  if (type !== 'studio_export') {
    throw new StemsApiError(
      'The requested clip is not a Suno Studio export.',
      'NOT_A_STUDIO_EXPORT',
      422,
      false,
      { clip_id: clipId, received: type || null },
    );
  }
  const studioProjectId = String(metadata.studio_project_id || '').trim().toLowerCase();
  if (!UUID_PATTERN.test(studioProjectId)) {
    throw new StemsApiError(
      'The studio_export clip does not contain a valid studio_project_id.',
      'STUDIO_PROJECT_ID_MISSING',
      422,
      false,
      { clip_id: clipId, received: studioProjectId || null },
    );
  }
  const sourceProjectVersionRaw = String(metadata.studio_project_version_id || '').trim().toLowerCase();
  if (sourceProjectVersionRaw && !UUID_PATTERN.test(sourceProjectVersionRaw)) {
    throw new StemsApiError(
      'The studio_export clip contains an invalid studio_project_version_id.',
      'STUDIO_PROJECT_VERSION_INVALID',
      422,
      false,
      { clip_id: clipId, received: sourceProjectVersionRaw },
    );
  }
  const clipTitle = String(clipMetadata.title || clipMetadata.raw?.title || clipId).normalize('NFKC').trim() || clipId;
  return {
    clipId,
    clipTitle,
    studioProjectId,
    sourceProjectVersionId: sourceProjectVersionRaw || null,
  };
}

export function parseBooleanParameter(value: unknown, name: string, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || (typeof value === 'string' && value.trim().toLowerCase() === 'true')) return true;
  if (value === 0 || value === '0' || (typeof value === 'string' && value.trim().toLowerCase() === 'false')) return false;
  throw new StemsApiError(
    `${name} must be a boolean (true/false or 1/0).`,
    'INVALID_PARAMETER',
    400,
    false,
    { parameter: name, received: String(value).slice(0, 160) },
  );
}

export function parseNumberParameter(
  value: unknown,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new StemsApiError(
      `${name} must be an integer between ${min} and ${max}.`,
      'INVALID_PARAMETER',
      400,
      false,
      { parameter: name, received: String(value).slice(0, 160), min, max },
    );
  }
  return parsed;
}

function redactPublicString(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/https?:\/\/[^\s"']+/gi, '[redacted-url]')
    .replace(/(?:bearer\s+|token[=:]\s*|cookie[=:]\s*)[^\s,;]+/gi, '[redacted-secret]')
    .slice(0, 500);
}

const PUBLIC_DETAIL_KEYS = new Set([
  'archive',
  'cause',
  'clip_id',
  'entries',
  'files',
  'max',
  'min',
  'mtimeMs',
  'name',
  'parameter',
  'path',
  'phase',
  'queue_timeout_ms',
  'received',
  'recent_files',
  'run_dir',
  'selected',
  'size',
  'studio_project_id',
  'studio_project_version_id',
  'stem_format',
  'expected_title',
  'page_title',
]);

function sanitizePublicValue(value: unknown, depth: number): unknown {
  if (depth > 3 || value === undefined) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return redactPublicString(value);
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizePublicValue(entry, depth + 1));
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
      if (!PUBLIC_DETAIL_KEYS.has(key)) continue;
      const sanitized = sanitizePublicValue(entry, depth + 1);
      if (sanitized !== undefined) output[key] = sanitized;
    }
    return output;
  }
  return redactPublicString(String(value));
}

export function sanitizeStemsErrorDetails(details: unknown): Record<string, unknown> | undefined {
  const sanitized = sanitizePublicValue(details, 0);
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) return undefined;
  return Object.keys(sanitized).length ? sanitized as Record<string, unknown> : undefined;
}

export function safeFileName(value: string, fallback: string): string {
  const cleaned = String(value || '')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

async function fileInfo(filePath: string): Promise<FileInfo | null> {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) return null;
  return {
    name: path.basename(filePath),
    path: filePath,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

async function validateZipArchive(filePath: string): Promise<{ valid: boolean; entries: string[]; error?: string }> {
  try {
    await execFileAsync('unzip', ['-tqq', filePath], { maxBuffer: 4 * 1024 * 1024 });
    const listed = await execFileAsync('unzip', ['-Z1', filePath], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    });
    const entries = String(listed.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const mediaEntries = entries.filter((entry) => /\.(?:wav|mp3|mid|midi|flac|m4a)$/i.test(entry));
    if (mediaEntries.length < 2) {
      return { valid: false, entries, error: 'ZIP contains fewer than two audio or MIDI stem files.' };
    }
    return { valid: true, entries };
  } catch (error: any) {
    return { valid: false, entries: [], error: error?.stderr || error?.message || String(error) };
  }
}

async function existingVerifiedArchive(filePath: string): Promise<{ file: FileInfo; entries: string[]; sha256: string } | null> {
  const file = await fileInfo(filePath);
  if (!file || file.size < 1024) return null;
  const validation = await validateZipArchive(filePath);
  return validation.valid ? { file, entries: validation.entries, sha256: await sha256File(filePath) } : null;
}

export interface ExistingStemsArchive {
  file: FileInfo;
  entries: string[];
  sha256: string;
  manifestPath: string;
  manifestRecreated: boolean;
  songTitle: string;
  exportEvidence: Record<string, unknown> | null;
  credits: Record<string, unknown> | null;
}

export function archiveSuffix(clipId: string, stemFormat: string): string {
  return ` [${clipId}] Stems (${stemFormat.toUpperCase()}).zip`;
}

export function isStemsArchiveNameFor(name: string, clipId: string, stemFormat: string): boolean {
  return String(name || '').toLowerCase().endsWith(archiveSuffix(clipId, stemFormat).toLowerCase());
}

function titleFromArchiveName(name: string, clipId: string, stemFormat: string): string {
  const suffix = archiveSuffix(clipId, stemFormat);
  return name.toLowerCase().endsWith(suffix.toLowerCase())
    ? name.slice(0, name.length - suffix.length).trim()
    : clipId;
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function ensureArchiveManifest(
  file: FileInfo,
  entries: string[],
  sha256: string,
  clipId: string,
  songTitle: string,
  stemFormat: string,
  exportEvidence?: Record<string, unknown> | null,
  credits?: Record<string, unknown> | null,
): Promise<{
  manifestPath: string;
  recreated: boolean;
  songTitle: string;
  exportEvidence: Record<string, unknown> | null;
  credits: Record<string, unknown> | null;
}> {
  const manifestPath = `${file.path}.json`;
  const raw = await fs.readFile(manifestPath, 'utf8').catch(() => '');
  let current: any = null;
  try {
    current = raw ? JSON.parse(raw) : null;
  } catch {
    current = null;
  }
  const manifestTitle = String(current?.song_title || songTitle || clipId).trim() || clipId;
  const effectiveExportEvidence = exportEvidence ?? current?.export_evidence ?? null;
  const effectiveCredits = credits ?? current?.credits ?? null;
  const valid = current?.schema_version === 1
    && current?.clip_id === clipId
    && current?.stem_format === stemFormat
    && current?.zip_path === file.path
    && current?.zip_size === file.size
    && current?.sha256 === sha256
    && Array.isArray(current?.entries)
    && arraysEqual(current.entries, entries)
    && typeof current?.completed_at === 'string';
  if (valid && exportEvidence === undefined && credits === undefined) {
    return {
      manifestPath,
      recreated: false,
      songTitle: manifestTitle,
      exportEvidence: effectiveExportEvidence,
      credits: effectiveCredits,
    };
  }

  const nextManifest = `${JSON.stringify({
    schema_version: 1,
    clip_id: clipId,
    song_title: manifestTitle,
    stem_format: stemFormat,
    zip_path: file.path,
    zip_size: file.size,
    sha256,
    entries,
    export_evidence: effectiveExportEvidence,
    credits: effectiveCredits,
    completed_at: new Date(file.mtimeMs).toISOString(),
    manifest_updated_at: new Date().toISOString(),
  }, null, 2)}\n`;
  const temporaryPath = `${manifestPath}.${randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, nextManifest, 'utf8');
  await fs.rename(temporaryPath, manifestPath);
  return {
    manifestPath,
    recreated: !valid,
    songTitle: manifestTitle,
    exportEvidence: effectiveExportEvidence,
    credits: effectiveCredits,
  };
}

export async function findExistingVerifiedArchive(
  downloadDir: string,
  clipId: string,
  stemFormat: string,
): Promise<ExistingStemsArchive | null> {
  const candidates = (await listFiles(downloadDir))
    .filter((file) => isStemsArchiveNameFor(file.name, clipId, stemFormat));
  for (const candidate of candidates) {
    const existing = await existingVerifiedArchive(candidate.path);
    if (!existing) continue;
    const manifest = await ensureArchiveManifest(
      existing.file,
      existing.entries,
      existing.sha256,
      clipId,
      titleFromArchiveName(existing.file.name, clipId, stemFormat),
      stemFormat,
    );
    return {
      ...existing,
      manifestPath: manifest.manifestPath,
      manifestRecreated: manifest.recreated,
      songTitle: manifest.songTitle,
      exportEvidence: manifest.exportEvidence,
      credits: manifest.credits,
    };
  }
  return null;
}

export async function finalizeDownloadedArchive(
  runDir: string,
  outputPath: string,
  clipId: string,
  songTitle: string,
  stemFormat: string,
  exportEvidence?: Record<string, unknown> | null,
  credits?: Record<string, unknown> | null,
): Promise<{ file: FileInfo; entries: string[]; sha256: string; manifestPath: string }> {
  const files = await listFiles(runDir);
  const archive = files.find((file) => file.name.toLowerCase().endsWith('.zip'));
  if (!archive) {
    throw new StemsApiError(
      'Browser download completed without a ZIP archive.',
      'STEMS_ZIP_MISSING',
      502,
      true,
      { run_dir: runDir, files },
    );
  }
  const validation = await validateZipArchive(archive.path);
  if (!validation.valid) {
    throw new StemsApiError(
      `Downloaded stems ZIP failed integrity validation: ${validation.error || 'unknown error'}`,
      'STEMS_ZIP_INVALID',
      502,
      true,
      { archive, entries: validation.entries },
    );
  }

  await fs.rm(outputPath, { force: true });
  try {
    await fs.rename(archive.path, outputPath);
  } catch {
    await fs.copyFile(archive.path, outputPath);
    await fs.rm(archive.path, { force: true });
  }
  const file = await fileInfo(outputPath);
  if (!file) {
    throw new StemsApiError('Final stems ZIP is missing after move.', 'STEMS_FINALIZE_FAILED', 500, true);
  }
  const sha256 = await sha256File(file.path);
  const manifest = await ensureArchiveManifest(
    file,
    validation.entries,
    sha256,
    clipId,
    songTitle,
    stemFormat,
    exportEvidence,
    credits,
  );
  return { file, entries: validation.entries, sha256, manifestPath: manifest.manifestPath };
}

export interface StudioWavTrack {
  name: string;
  uncompressed_bytes: number;
  codec_name: string;
  sample_rate: number;
  channels: number;
  bits_per_sample: number;
}

export interface StudioZipValidation {
  file: FileInfo;
  entries: string[];
  tracks: StudioWavTrack[];
  sha256: string;
}

export function studioArchiveSuffix(clipId: string): string {
  return ` [${clipId}] Studio Multitrack.zip`;
}

export function isStudioMultitrackArchiveNameFor(name: string, clipId: string): boolean {
  return String(name || '').toLowerCase().endsWith(studioArchiveSuffix(clipId).toLowerCase());
}

function titleFromStudioArchiveName(name: string, clipId: string): string {
  const suffix = studioArchiveSuffix(clipId);
  return name.toLowerCase().endsWith(suffix.toLowerCase())
    ? name.slice(0, name.length - suffix.length).trim()
    : clipId;
}

export function parseWavHeader(bufferInput: Uint8Array): Omit<StudioWavTrack, 'name' | 'uncompressed_bytes'> | null {
  const buffer = Buffer.from(bufferInput.buffer, bufferInput.byteOffset, bufferInput.byteLength);
  if (buffer.length < 36 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (chunkId === 'fmt ' && chunkSize >= 16 && dataOffset + 16 <= buffer.length) {
      const formatTag = buffer.readUInt16LE(dataOffset);
      const channels = buffer.readUInt16LE(dataOffset + 2);
      const sampleRate = buffer.readUInt32LE(dataOffset + 4);
      const bitsPerSample = buffer.readUInt16LE(dataOffset + 14);
      const codecName = formatTag === 3
        ? 'pcm_f32le'
        : formatTag === 1
          ? `pcm_s${bitsPerSample}le`
          : formatTag === 0xfffe
            ? 'pcm_extensible'
            : `wav_format_${formatTag}`;
      if (!channels || !sampleRate || !bitsPerSample) return null;
      return {
        codec_name: codecName,
        sample_rate: sampleRate,
        channels,
        bits_per_sample: bitsPerSample,
      };
    }
    const paddedSize = chunkSize + (chunkSize % 2);
    if (paddedSize > buffer.length || offset + 8 + paddedSize <= offset) break;
    offset += 8 + paddedSize;
  }
  return null;
}

async function readZipEntryHeader(archivePath: string, entry: string): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const child = spawn('unzip', ['-p', archivePath, entry], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let total = 0;
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => finish(new Error(`Timed out reading WAV header for ${entry}`)), 15000);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!child.killed) child.kill('SIGTERM');
      if (error) reject(error);
      else resolve(Buffer.concat(chunks, total));
    };
    child.stdout.on('data', (chunk: Buffer) => {
      if (settled) return;
      const remaining = Math.max(0, 65536 - total);
      if (remaining) {
        const part = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
        chunks.push(part);
        total += part.length;
      }
      const current = Buffer.concat(chunks, total);
      if (parseWavHeader(current) || total >= 65536) finish();
    });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (settled) return;
      if (code && code !== 0) finish(new Error(stderr.trim() || `unzip exited with ${code}`));
      else finish();
    });
  });
}

async function sha256File(filePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export function parseZipEntrySizes(output: string): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const line of String(output || '').split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+\d{2,4}-\d{2}-\d{2,4}\s+\d{2}:\d{2}\s+(.+)$/);
    if (match) sizes.set(match[2], Number(match[1]));
  }
  return sizes;
}

async function validateStudioZipArchive(filePath: string): Promise<StudioZipValidation> {
  const file = await fileInfo(filePath);
  if (!file || file.size < 1024) {
    throw new StemsApiError(
      'Studio Multitrack ZIP is missing or empty.',
      'STUDIO_ZIP_MISSING',
      502,
      true,
      { archive: file || { path: filePath } },
    );
  }
  let entries: string[];
  let sizes: Map<string, number>;
  try {
    await execFileAsync('unzip', ['-tqq', filePath], { maxBuffer: 4 * 1024 * 1024 });
    const [listed, detailed] = await Promise.all([
      execFileAsync('unzip', ['-Z1', filePath], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }),
      execFileAsync('unzip', ['-l', filePath], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }),
    ]);
    entries = String(listed.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    sizes = parseZipEntrySizes(String(detailed.stdout || ''));
  } catch (error: any) {
    throw new StemsApiError(
      'Studio Multitrack ZIP failed integrity validation.',
      'STUDIO_ZIP_INVALID',
      502,
      true,
      { archive: file, cause: error?.stderr || error?.message || String(error) },
    );
  }
  if (!entries.length || entries.some((entry) => entry.endsWith('/') || !/\.wav$/i.test(entry))) {
    throw new StemsApiError(
      'Studio Multitrack ZIP must contain only one or more WAV tracks.',
      'STUDIO_ZIP_CONTENT_INVALID',
      502,
      true,
      { archive: file, entries },
    );
  }
  const tracks: StudioWavTrack[] = [];
  for (const entry of entries) {
    const uncompressedBytes = sizes.get(entry) || 0;
    if (uncompressedBytes <= 44) {
      throw new StemsApiError(
        'Studio Multitrack ZIP contains an empty WAV track.',
        'STUDIO_WAV_EMPTY',
        502,
        true,
        { archive: file, received: entry, size: uncompressedBytes },
      );
    }
    const header = await readZipEntryHeader(filePath, entry).catch((error: any) => {
      throw new StemsApiError(
        'Could not read a WAV track from the Studio Multitrack ZIP.',
        'STUDIO_WAV_READ_FAILED',
        502,
        true,
        { archive: file, received: entry, cause: error?.message || String(error) },
      );
    });
    const audio = parseWavHeader(header);
    if (!audio) {
      throw new StemsApiError(
        'Studio Multitrack ZIP contains a file without a valid WAV header.',
        'STUDIO_WAV_HEADER_INVALID',
        502,
        true,
        { archive: file, received: entry },
      );
    }
    tracks.push({ name: entry, uncompressed_bytes: uncompressedBytes, ...audio });
  }
  return { file, entries, tracks, sha256: await sha256File(filePath) };
}

export interface ExistingStudioArchive extends StudioZipValidation {
  manifestPath: string;
  manifestRecreated: boolean;
  clipTitle: string;
  exportEvidence: Record<string, unknown> | null;
  credits: Record<string, unknown> | null;
}

export interface RecoverableStudioInflight {
  runDir: string;
  exportEvidence: Record<string, unknown>;
  credits: Record<string, unknown> | null;
}

function studioTracksEqual(left: StudioWavTrack[], right: StudioWavTrack[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function ensureStudioArchiveManifest(
  validation: StudioZipValidation,
  normalized: NormalizedStudioMultitrackRequest,
  exportEvidence?: Record<string, unknown> | null,
  credits?: Record<string, unknown> | null,
): Promise<{ manifestPath: string; recreated: boolean; exportEvidence: Record<string, unknown> | null; credits: Record<string, unknown> | null }> {
  const manifestPath = `${validation.file.path}.json`;
  const raw = await fs.readFile(manifestPath, 'utf8').catch(() => '');
  let current: any = null;
  try {
    current = raw ? JSON.parse(raw) : null;
  } catch {
    current = null;
  }
  const effectiveExportEvidence = exportEvidence ?? current?.export_evidence ?? null;
  const effectiveCredits = credits ?? current?.credits ?? null;
  const valid = current?.schema_version === 1
    && current?.export_type === 'studio_multitrack'
    && current?.clip_id === normalized.clipId
    && current?.clip_title === normalized.clipTitle
    && current?.studio_project_id === normalized.studioProjectId
    && current?.source_studio_project_version_id === normalized.sourceProjectVersionId
    && current?.zip_path === validation.file.path
    && current?.zip_size === validation.file.size
    && current?.sha256 === validation.sha256
    && Array.isArray(current?.entries)
    && arraysEqual(current.entries, validation.entries)
    && Array.isArray(current?.tracks)
    && studioTracksEqual(current.tracks, validation.tracks)
    && typeof current?.completed_at === 'string';
  if (valid && exportEvidence === undefined && credits === undefined) {
    return {
      manifestPath,
      recreated: false,
      exportEvidence: effectiveExportEvidence,
      credits: effectiveCredits,
    };
  }
  const manifest = {
    schema_version: 1,
    export_type: 'studio_multitrack',
    clip_id: normalized.clipId,
    clip_title: normalized.clipTitle,
    clip_status: 'complete',
    clip_type: 'studio_export',
    studio_project_id: normalized.studioProjectId,
    source_studio_project_version_id: normalized.sourceProjectVersionId,
    studio_url: normalized.studioUrl,
    zip_path: validation.file.path,
    zip_size: validation.file.size,
    sha256: validation.sha256,
    entries: validation.entries,
    tracks: validation.tracks,
    completed_at: new Date(validation.file.mtimeMs).toISOString(),
    export_evidence: effectiveExportEvidence,
    credits: effectiveCredits,
    manifest_updated_at: new Date().toISOString(),
  };
  const temporaryPath = `${manifestPath}.${randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, manifestPath);
  return {
    manifestPath,
    recreated: !valid,
    exportEvidence: effectiveExportEvidence,
    credits: effectiveCredits,
  };
}

export async function findExistingStudioArchive(
  normalized: NormalizedStudioMultitrackRequest,
): Promise<ExistingStudioArchive | null> {
  const candidates = (await listFiles(normalized.downloadDir))
    .filter((file) => isStudioMultitrackArchiveNameFor(file.name, normalized.clipId));
  for (const candidate of candidates) {
    try {
      const validation = await validateStudioZipArchive(candidate.path);
      const manifest = await ensureStudioArchiveManifest(validation, normalized);
      return {
        ...validation,
        manifestPath: manifest.manifestPath,
        manifestRecreated: manifest.recreated,
        clipTitle: titleFromStudioArchiveName(candidate.name, normalized.clipId),
        exportEvidence: manifest.exportEvidence,
        credits: manifest.credits,
      };
    } catch {
      // A corrupt matching archive is not reusable. Preserve it for diagnosis and create a fresh verified archive.
    }
  }
  return null;
}

export async function persistStudioInflightEvidence(
  runDir: string,
  normalized: NormalizedStudioMultitrackRequest,
  exportEvidence: Record<string, unknown>,
  credits: Record<string, unknown> | null,
): Promise<void> {
  const evidencePath = path.join(runDir, 'run_evidence.json');
  const temporaryPath = `${evidencePath}.${randomUUID()}.tmp`;
  const evidence = {
    schema_version: 1,
    clip_id: normalized.clipId,
    clip_title: normalized.clipTitle,
    studio_project_id: normalized.studioProjectId,
    source_studio_project_version_id: normalized.sourceProjectVersionId,
    export_evidence: exportEvidence,
    credits,
    persisted_at: new Date().toISOString(),
  };
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, evidencePath);
  } catch (error: any) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw new StemsApiError(
      'Could not persist Studio export evidence before ZIP finalization.',
      'STUDIO_EVIDENCE_PERSIST_FAILED',
      500,
      true,
      { run_dir: runDir, cause: error?.message || String(error) },
    );
  }
}

export async function findRecoverableStudioInflight(
  normalized: NormalizedStudioMultitrackRequest,
): Promise<RecoverableStudioInflight | null> {
  const inflightRoot = path.join(normalized.downloadDir, '.inflight');
  const entries = await fs.readdir(inflightRoot, { withFileTypes: true }).catch(() => []);
  const candidates: Array<{ runDir: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(`${normalized.clipId}-`)) continue;
    const runDir = path.join(inflightRoot, entry.name);
    const stat = await fs.stat(runDir).catch(() => null);
    if (stat) candidates.push({ runDir, mtimeMs: stat.mtimeMs });
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  for (const candidate of candidates) {
    const raw = await fs.readFile(path.join(candidate.runDir, 'run_evidence.json'), 'utf8').catch(() => '');
    let evidence: any = null;
    try {
      evidence = raw ? JSON.parse(raw) : null;
    } catch {
      evidence = null;
    }
    const exportEvidence = evidence?.export_evidence;
    const renderOk = Number(exportEvidence?.render_status) >= 200
      && Number(exportEvidence?.render_status) < 300;
    const browserComplete = exportEvidence?.save_project_id === normalized.studioProjectId
      && exportEvidence?.browser_download?.state === 'completed'
      && Number(exportEvidence?.save_project_status) >= 200
      && Number(exportEvidence?.save_project_status) < 300;
    const httpComplete = exportEvidence?.backend === 'http'
      && exportEvidence?.studio_project_id === normalized.studioProjectId
      && exportEvidence?.http_download?.state === 'completed';
    if (
      evidence?.schema_version !== 1
      || evidence?.clip_id !== normalized.clipId
      || evidence?.studio_project_id !== normalized.studioProjectId
      || !renderOk
      || (!browserComplete && !httpComplete)
    ) continue;
    const archive = (await listFiles(candidate.runDir)).find((file) => file.name.toLowerCase().endsWith('.zip'));
    if (!archive) continue;
    try {
      await validateStudioZipArchive(archive.path);
      return {
        runDir: candidate.runDir,
        exportEvidence: evidence.export_evidence,
        credits: evidence.credits || null,
      };
    } catch {
      continue;
    }
  }
  return null;
}

export async function finalizeStudioDownloadedArchive(
  runDir: string,
  outputPath: string,
  normalized: NormalizedStudioMultitrackRequest,
  exportEvidence: Record<string, unknown>,
  credits: Record<string, unknown> | null,
): Promise<ExistingStudioArchive> {
  const archive = (await listFiles(runDir)).find((file) => file.name.toLowerCase().endsWith('.zip'));
  if (!archive) {
    throw new StemsApiError(
      'Browser download completed without a Studio Multitrack ZIP.',
      'STUDIO_ZIP_MISSING',
      502,
      true,
      { run_dir: runDir, files: await listFiles(runDir) },
    );
  }
  const sourceValidation = await validateStudioZipArchive(archive.path);
  const stagedPath = `${outputPath}.${randomUUID()}.tmp`;
  try {
    await fs.rename(archive.path, stagedPath);
  } catch {
    await fs.copyFile(archive.path, stagedPath);
    await fs.rm(archive.path, { force: true });
  }
  await fs.rename(stagedPath, outputPath);
  const finalFile = await fileInfo(outputPath);
  if (!finalFile) {
    throw new StemsApiError(
      'Final Studio Multitrack ZIP is missing after atomic move.',
      'STUDIO_FINALIZE_FAILED',
      500,
      true,
      { received: outputPath },
    );
  }
  const validation: StudioZipValidation = { ...sourceValidation, file: finalFile };
  const manifest = await ensureStudioArchiveManifest(validation, normalized, exportEvidence, credits);
  return {
    ...validation,
    manifestPath: manifest.manifestPath,
    manifestRecreated: manifest.recreated,
    clipTitle: normalized.clipTitle,
    exportEvidence: manifest.exportEvidence,
    credits: manifest.credits,
  };
}

function fileKey(file: FileInfo): string {
  return `${file.name}\u0000${file.size}\u0000${Math.round(file.mtimeMs)}`;
}

class CdpConnection {
  private seq = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: any) => void; timer: ReturnType<typeof setTimeout> }>();
  public events: any[] = [];
  private ws?: WebSocket;
  private readonly wsUrl: string;

  constructor(wsUrl: string) {
    this.wsUrl = wsUrl;
  }

  async connect(enablePageRuntime: boolean = true): Promise<void> {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out connecting to ${this.wsUrl}`)), 10000);
      this.ws!.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.ws!.addEventListener('error', (event: any) => {
        clearTimeout(timer);
        reject(new Error(`WebSocket error: ${event?.message || 'unknown'}`));
      }, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      let msg: any;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        clearTimeout(timer);
        if (msg.error) reject(new Error(`${msg.error.message || 'CDP error'} ${JSON.stringify(msg.error.data || '')}`));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
        if (this.events.length > 2000) this.events.splice(0, this.events.length - 2000);
      }
    });
    if (enablePageRuntime) {
      await this.send('Page.enable');
      await this.send('Runtime.enable');
      await this.send('Network.enable').catch(() => {});
    }
  }

  send(method: string, params: Record<string, any> = {}): Promise<any> {
    const id = ++this.seq;
    if (!this.ws) throw new Error('CDP connection is not open');
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  async evaluate(expression: string, awaitPromise: boolean = true): Promise<any> {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
    }
    return result.result?.value;
  }

  async clickAt(x: number, y: number): Promise<void> {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }

  async keyEscape(): Promise<void> {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
  }

  close(): void {
    try {
      this.ws?.close();
    } catch {
    }
  }
}

const installSongRecorderScript = `(() => {
  window.__stemsSongCalls = window.__stemsSongCalls || [];
  const push = (info) => { try { window.__stemsSongCalls.push(info); } catch {} };
  if (!window.__stemsSongRecorderInstalled) {
    window.__stemsSongRecorderInstalled = true;
    const origFetch = window.fetch;
    window.fetch = async (...args) => {
      const info = { type: 'fetch', ts: new Date().toISOString() };
      try {
        const input = args[0], init = args[1] || {};
        info.url = typeof input === 'string' ? input : input?.url;
        info.method = init.method || (typeof input !== 'string' ? input?.method : undefined) || 'GET';
        info.body = typeof init.body === 'string' ? init.body : undefined;
      } catch (e) { info.parseError = String(e); }
      const res = await origFetch.apply(this, args);
      try {
        info.status = res.status;
        info.responseUrl = res.url;
        info.contentType = res.headers.get('content-type') || '';
        if (info.contentType.includes('application/json')) {
          res.clone().text().then((t) => { info.responseText = t.slice(0, 5000); }).catch(() => {});
        }
      } catch {}
      push(info);
      return res;
    };
  }
  return true;
})()`;

const installStudioRecorderScript = `(() => {
  window.__stemsStudioCalls = window.__stemsStudioCalls || [];
  const push = (info) => { try { window.__stemsStudioCalls.push(info); } catch {} };
  if (!window.__stemsStudioRecorderInstalled) {
    window.__stemsStudioRecorderInstalled = true;
    const origFetch = window.fetch;
    window.fetch = async (...args) => {
      const info = { type: 'fetch', ts: new Date().toISOString() };
      try {
        const input = args[0], init = args[1] || {};
        info.url = typeof input === 'string' ? input : input?.url;
        info.method = init.method || (typeof input !== 'string' ? input?.method : undefined) || 'GET';
        info.body = typeof init.body === 'string' ? init.body : undefined;
      } catch (e) { info.parseError = String(e); }
      const res = await origFetch.apply(this, args);
      try {
        info.status = res.status;
        info.responseUrl = res.url;
        info.contentType = res.headers.get('content-type') || '';
        if (info.contentType.includes('application/json')) {
          res.clone().text().then((t) => { info.responseText = t.slice(0, 5000); }).catch(() => {});
        }
      } catch {}
      push(info);
      return res;
    };
  }
  return true;
})()`;

const stateScript = `(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.x < innerWidth && r.y < innerHeight && r.right > 0 && r.bottom > 0;
  };
  const textOf = (el) => ((el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '') + '').trim().replace(/\\s+/g, ' ');
  const elements = Array.from(document.querySelectorAll('button,[role="button"],a,[role="menuitem"],[role="dialog"],[data-radix-popper-content-wrapper],[aria-label],label,div'))
    .filter(visible)
    .map((el) => {
      const r = el.getBoundingClientRect();
      const role = el.getAttribute('role');
      const text = textOf(el);
      return { tag: el.tagName, role, text: text.slice(0, 300), fullText: role === 'dialog' ? text.slice(0, 12000) : undefined, aria: el.getAttribute('aria-label'), title: el.getAttribute('title'), className: String(el.className || '').slice(0, 240), disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true', rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
    })
    .filter((x) => x.text || x.aria || x.title);
  const songCalls = (window.__stemsSongCalls || [])
    .filter((c) => /suno\\.com|studio-api-prod\\.suno\\.com/.test(c.url || ''))
    .map((c) => ({ ts: c.ts, type: c.type, method: c.method, url: c.url, status: c.status, body: c.body, responseText: c.responseText }))
    .slice(-120);
  const studioCalls = (window.__stemsStudioCalls || [])
    .filter((c) => /suno\\.com|studio-api-prod\\.suno\\.com/.test(c.url || ''))
    .map((c) => ({ ts: c.ts, type: c.type, method: c.method, url: c.url, status: c.status, body: c.body, responseText: c.responseText }))
    .slice(-120);
  return { title: document.title, url: location.href, body: document.body.innerText.slice(0, 12000), elements, calls: [...songCalls, ...studioCalls] };
})()`;

function looseText(value: any): string {
  return String(value || '').toLowerCase().replace(/\s+/g, '').replace(/s/g, '');
}

function looseIncludes(value: any, needle: any): boolean {
  return looseText(value).includes(looseText(needle));
}

function stateText(state: any): string {
  const elementText = (state?.elements || [])
    .map((x: any) => [x.text, x.aria, x.title].filter(Boolean).join(' '))
    .join('\n');
  return `${state?.body || ''}\n${elementText}`;
}

function controlText(control: any): string {
  return [control?.text, control?.aria, control?.title].filter(Boolean).join(' | ');
}

function stateHas(state: any, regex: RegExp): boolean {
  return regex.test(stateText(state));
}

function getStemsDialogText(state: any): string {
  const candidates = (state?.elements || [])
    .filter((x: any) => controlText(x).includes('Extract Stems') || controlText(x).includes('Extract Stem'))
    .filter((x: any) => x.rect?.w >= 500 && x.rect?.h >= 250)
    .sort((a: any, b: any) => (b.rect.w * b.rect.h) - (a.rect.w * a.rect.h));
  const dialog = candidates.find((x: any) => x.role === 'dialog') || candidates[0];
  return dialog?.fullText || controlText(dialog) || stateText(state);
}

function findControls(state: any, label: string, options: Record<string, any> = {}): any[] {
  const controls = state?.elements || [];
  return controls
    .filter((x: any) => !x.disabled)
    .filter((x: any) => {
      const text = controlText(x);
      return options.exact ? text === label : (text === label || text.includes(label) || (options.loose && looseIncludes(text, label)));
    })
    .filter((x: any) => options.minX == null || x.rect.x >= options.minX)
    .filter((x: any) => options.maxX == null || x.rect.x <= options.maxX)
    .filter((x: any) => options.minY == null || x.rect.y >= options.minY)
    .filter((x: any) => options.maxY == null || x.rect.y <= options.maxY)
    .filter((x: any) => options.maxTextLength == null || controlText(x).length <= options.maxTextLength)
    .filter((x: any) => x.rect.w <= (options.maxWidth ?? 500) && x.rect.h <= (options.maxHeight ?? 140))
    .sort((a: any, b: any) => (a.rect.y - b.rect.y) || (a.rect.x - b.rect.x) || (a.rect.h - b.rect.h));
}

function stateHasControl(state: any, label: string, options: Record<string, any> = {}): boolean {
  return findControls(state, label, options).length > 0;
}

function isGetStemsModalOpen(state: any): boolean {
  const text = stateText(state);
  return (/Extract\s+Stem/i.test(text) && /MIDI/i.test(text)) ||
    (looseIncludes(text, 'Auto split') && /Split from mix/i.test(text) && /Extract/i.test(text));
}

function isFormatDownloadDialogOpen(state: any): boolean {
  return looseIncludes(stateText(state), 'Select files to download') &&
    stateHasControl(state, 'MP3', { maxTextLength: 80 }) &&
    stateHasControl(state, 'WAV', { maxTextLength: 80 });
}

function formatChoiceSelected(state: any, label: string): boolean {
  const choices = findControls(state, label, { minX: 450, maxX: 950, minY: 350, maxY: 650, maxTextLength: 80 });
  const choice = choices.find((x) => controlText(x).startsWith(label)) || choices[0];
  const className = String(choice?.className || '');
  return /border-transparent/.test(className) && !/border-white\/\[0\.04\]/.test(className);
}

function downloadChoiceScript(label: string, desiredSelected: boolean, clickIfNeeded: boolean): string {
  return `(() => {
    const label = ${JSON.stringify(label)};
    const desiredSelected = ${JSON.stringify(desiredSelected)};
    const clickIfNeeded = ${JSON.stringify(clickIfNeeded)};
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.x < innerWidth && r.y < innerHeight && r.right > 0 && r.bottom > 0;
    };
    const textOf = (el) => ((el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '') + '').trim().replace(/\\s+/g, ' ');
    const selectedEvidence = (el) => {
      const rootClass = String(el.className || '');
      const attrs = {
        ariaChecked: el.getAttribute('aria-checked'),
        ariaPressed: el.getAttribute('aria-pressed'),
        dataState: el.getAttribute('data-state'),
      };
      const checkedDescendant = el.querySelector('input:checked,[aria-checked="true"],[aria-pressed="true"],[data-state="checked"]');
      const rootLooksSelected = /border-transparent/.test(rootClass) && !/border-white\\/\\[0\\.04\\]/.test(rootClass);
      const selected = attrs.ariaChecked === 'true' ||
        attrs.ariaPressed === 'true' ||
        attrs.dataState === 'checked' ||
        Boolean(checkedDescendant) ||
        rootLooksSelected;
      const by = [];
      if (attrs.ariaChecked === 'true') by.push('aria-checked');
      if (attrs.ariaPressed === 'true') by.push('aria-pressed');
      if (attrs.dataState === 'checked') by.push('data-state');
      if (checkedDescendant) by.push('checked-descendant');
      if (rootLooksSelected) by.push('selected-class');
      return {
        selected,
        by,
        attrs,
        rootClass,
        checkedDescendant: checkedDescendant ? {
          tag: checkedDescendant.tagName,
          text: textOf(checkedDescendant),
          className: String(checkedDescendant.className || ''),
        } : null,
      };
    };
    const containers = Array.from(document.querySelectorAll('div,[role="dialog"]')).filter(visible);
    const dialog = containers
      .filter((el) => /Select files to download/i.test(textOf(el)))
      .filter((el) => Array.from(el.querySelectorAll('button,[role="button"]')).some((button) => /^MP3(?: |$)/.test(textOf(button))))
      .sort((a, b) => {
        const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
        return (ar.width * ar.height) - (br.width * br.height);
      })[0];
    if (!dialog) return { ok: false, label, reason: 'no visible download dialog' };
    const options = Array.from(dialog.querySelectorAll('button,[role="button"]'))
      .filter(visible)
      .map((el) => ({ el, text: textOf(el), className: String(el.className || ''), rect: el.getBoundingClientRect(), disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true' }))
      .filter((x) => !x.disabled && (x.text === label || x.text.startsWith(label + ' ')))
      .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height));
    const target = options[0];
    if (!target) return { ok: false, label, reason: 'download choice not found', buttons: Array.from(dialog.querySelectorAll('button,[role="button"]')).filter(visible).map(textOf).filter(Boolean) };
    const evidenceBefore = selectedEvidence(target.el);
    const selectedBefore = evidenceBefore.selected;
    if (selectedBefore !== desiredSelected && clickIfNeeded) target.el.click();
    const rect = target.el.getBoundingClientRect();
    const evidenceAfterImmediate = selectedEvidence(target.el);
    return {
      ok: true,
      label,
      selectedBefore,
      selectedBeforeBy: evidenceBefore.by,
      selectedAfterImmediate: evidenceAfterImmediate.selected,
      selectedAfterImmediateBy: evidenceAfterImmediate.by,
      desiredSelected,
      clicked: selectedBefore !== desiredSelected && clickIfNeeded,
      text: target.text,
      className: target.className,
      evidenceBefore,
      evidenceAfterImmediate,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
    };
  })()`;
}

async function ensureDownloadChoiceState(page: CdpConnection, label: 'MP3' | 'WAV' | 'MIDI', selected: boolean): Promise<any> {
  const before = await page.evaluate(downloadChoiceScript(label, selected, true));
  if (!before?.ok) throw Object.assign(new Error(`Could not update ${label}`), { result: before });
  await sleep(600);
  const after = await page.evaluate(downloadChoiceScript(label, selected, false));
  if (!after?.ok || after.selectedBefore !== selected) {
    throw Object.assign(new Error(`${label} selection state did not match the request`), { before, after, selected });
  }
  return { ...before, selectedAfter: selected, verify: after };
}

function clickByLabelScript(label: string, options: Record<string, any> = {}): string {
  return `(() => {
    const label = ${JSON.stringify(label)};
    const options = ${JSON.stringify(options)};
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.x < innerWidth && r.y < innerHeight && r.right > 0 && r.bottom > 0;
    };
    const textOf = (el) => ((el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '') + '').trim().replace(/\\s+/g, ' ');
    const loose = (value) => ((value || '') + '').toLowerCase().replace(/\\s+/g, '').replace(/s/g, '');
    const haystackOf = (el) => [el.innerText, el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent]
      .map((v) => ((v || '') + '').trim().replace(/\\s+/g, ' '))
      .filter(Boolean)
      .join(' | ');
    let candidates = Array.from(document.querySelectorAll('button,[role="button"],[role="menuitem"],[role="checkbox"],[role="radio"],a,label'))
      .filter(visible)
      .map((el) => ({ el, text: textOf(el), haystack: haystackOf(el), rect: el.getBoundingClientRect(), disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true' }))
      .filter((x) => !x.disabled && (options.exact ? (x.text === label || x.haystack === label) : (x.haystack === label || x.haystack.includes(label) || (options.loose && loose(x.haystack).includes(loose(label))))));
    if (options.preferMain) candidates = candidates.filter((x) => !x.text.startsWith('Playbar:') && x.rect.y < innerHeight - 80);
    if (options.minX != null) candidates = candidates.filter((x) => x.rect.x >= options.minX);
    if (options.maxX != null) candidates = candidates.filter((x) => x.rect.x <= options.maxX);
    if (options.minY != null) candidates = candidates.filter((x) => x.rect.y >= options.minY);
    if (options.maxY != null) candidates = candidates.filter((x) => x.rect.y <= options.maxY);
    if (options.maxTextLength != null) candidates = candidates.filter((x) => x.haystack.length <= options.maxTextLength);
    candidates = candidates.filter((x) => x.rect.width <= (options.maxWidth ?? 500) && x.rect.height <= (options.maxHeight ?? 140));
    if (options.preferBottom) candidates.sort((a, b) => (b.rect.y - a.rect.y) || (b.rect.x - a.rect.x));
    else candidates.sort((a, b) => (a.rect.y - b.rect.y) || (a.rect.x - b.rect.x) || (a.rect.height - b.rect.height));
    const target = candidates[0];
    if (!target) return { ok: false, label, available: Array.from(document.querySelectorAll('button,[role="button"],a,[role="menuitem"],label')).filter(visible).map(textOf).filter(Boolean).slice(0, 160) };
    return { ok: true, label, clickedText: target.text, rect: { x: target.rect.x, y: target.rect.y, w: target.rect.width, h: target.rect.height } };
  })()`;
}

async function clickResult(page: CdpConnection, res: any, waitMs: number): Promise<any> {
  const x = res.rect.x + (res.rect.w / 2);
  const y = res.rect.y + (res.rect.h / 2);
  await page.clickAt(x, y);
  await sleep(waitMs);
  return { ...res, x: Math.round(x), y: Math.round(y), via: 'cdp-mouse' };
}

async function click(page: CdpConnection, label: string, options: Record<string, any> = {}, waitMs: number = 700): Promise<any> {
  const res = await page.evaluate(clickByLabelScript(label, options));
  if (!res?.ok) throw Object.assign(new Error(`Could not click ${label}`), { result: res });
  return clickResult(page, res, waitMs);
}

async function clickWithFallback(page: CdpConnection, label: string, options: Record<string, any> = {}, fallback: { x: number; y: number } | null = null, waitMs: number = 700): Promise<any> {
  const res = await page.evaluate(clickByLabelScript(label, options));
  if (res?.ok) {
    return clickResult(page, res, waitMs);
  }
  if (fallback) {
    await page.clickAt(fallback.x, fallback.y);
    await sleep(waitMs);
    return { ok: true, label, fallbackReason: res, x: fallback.x, y: fallback.y, via: 'cdp-fallback' };
  }
  throw Object.assign(new Error(`Could not click ${label}`), { result: res });
}

async function clickStemsDialogDownload(page: CdpConnection, waitMs: number = 1500): Promise<any> {
  const res = await page.evaluate(`(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.x < innerWidth && r.y < innerHeight && r.right > 0 && r.bottom > 0;
    };
    const textOf = (el) => ((el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '') + '').trim().replace(/\\s+/g, ' ');
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible);
    const dialog = dialogs.find((el) => /Extract Stems|Extract Stem/.test(textOf(el))) || dialogs[0];
    if (!dialog) return { ok: false, reason: 'no visible dialog' };
    const candidates = Array.from(dialog.querySelectorAll('button,[role="button"]'))
      .filter(visible)
      .map((el) => ({ el, text: textOf(el), rect: el.getBoundingClientRect(), disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true' }))
      .filter((x) => !x.disabled && x.text === 'Download')
      .sort((a, b) => (b.rect.y - a.rect.y) || (b.rect.width - a.rect.width));
    const target = candidates[0];
    if (!target) return { ok: false, reason: 'no dialog Download button', buttons: Array.from(dialog.querySelectorAll('button,[role="button"]')).filter(visible).map(textOf).filter(Boolean) };
    target.el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = target.el.getBoundingClientRect();
    target.el.click();
    return { ok: true, label: 'Download', clickedText: target.text, rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }, via: 'dom-click' };
  })()`);
  if (!res?.ok) throw Object.assign(new Error('Could not click dialog Download'), { result: res });
  await sleep(waitMs);
  return res;
}

async function clickFormatDialogDownload(page: CdpConnection, waitMs: number = 1000): Promise<any> {
  const res = await page.evaluate(`(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const textOf = (el) => ((el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '') + '').trim().replace(/\\s+/g, ' ');
    const containers = Array.from(document.querySelectorAll('div,[role="dialog"]')).filter(visible);
    const dialog = containers
      .filter((el) => /Select files to download/i.test(textOf(el)))
      .filter((el) => Array.from(el.querySelectorAll('button,[role="button"]')).some((button) => textOf(button) === 'Download'))
      .sort((a, b) => {
        const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
        return (ar.width * ar.height) - (br.width * br.height);
      })[0];
    if (!dialog) return { ok: false, reason: 'format download dialog not visible' };
    const candidates = Array.from(dialog.querySelectorAll('button,[role="button"]'))
      .filter(visible)
      .map((el) => ({ el, text: textOf(el), rect: el.getBoundingClientRect(), disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true' }))
      .filter((x) => !x.disabled && x.text === 'Download')
      .sort((a, b) => (b.rect.y - a.rect.y) || (b.rect.width - a.rect.width));
    const target = candidates[0];
    if (!target) return { ok: false, reason: 'format dialog Download button not found' };
    target.el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = target.el.getBoundingClientRect();
    const dialogRect = dialog.getBoundingClientRect();
    return {
      ok: true,
      label: 'Download',
      clickedText: target.text,
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      dialogRect: { x: dialogRect.x, y: dialogRect.y, w: dialogRect.width, h: dialogRect.height },
    };
  })()`);
  if (!res?.ok) throw Object.assign(new Error('Could not click final format Download'), { result: res });
  return await clickResult(page, res, waitMs);
}

async function waitForState(page: CdpConnection, predicate: (state: any) => boolean, timeoutMs: number, intervalMs: number = 500): Promise<any> {
  const started = Date.now();
  let state = null;
  let lastError = '';
  while (Date.now() - started < timeoutMs) {
    try {
      state = await page.evaluate(stateScript);
      lastError = '';
      if (predicate(state)) return state;
    } catch (error: any) {
      // Runtime contexts are briefly destroyed while a newly-created tab navigates.
      lastError = String(error?.message || error).slice(0, 500);
    }
    await sleep(intervalMs);
  }
  const err: any = new Error('Timed out waiting for page state');
  err.state = state;
  err.lastError = lastError;
  throw err;
}

function findTitleAnchoredMoreMenu(state: any, songTitle: string): any {
  const title = String(songTitle || '').trim();
  if (!title) return null;
  const controls = Array.isArray(state?.elements) ? state.elements : [];
  const anchors = controls
    .filter((x: any) => !x.disabled)
    .filter((x: any) => controlText(x).includes(title))
    .filter((x: any) => x.rect.x >= 180 && x.rect.x <= 850 && x.rect.y >= 120 && x.rect.y <= 520)
    .filter((x: any) => x.rect.w <= 650 && x.rect.h <= 180)
    .sort((a: any, b: any) => (a.rect.w * a.rect.h) - (b.rect.w * b.rect.h) || (a.rect.y - b.rect.y));
  const buttons = controls
    .filter((x: any) => !x.disabled)
    .filter((x: any) => /More menu content/i.test(controlText(x)))
    .filter((x: any) => x.rect.x >= 180 && x.rect.x <= 850 && x.rect.y >= 120 && x.rect.y <= 560)
    .filter((x: any) => x.rect.w <= 80 && x.rect.h <= 80);
  let best: any = null;
  for (const anchor of anchors) {
    const ay = anchor.rect.y + anchor.rect.h / 2;
    const axRight = anchor.rect.x + anchor.rect.w;
    for (const button of buttons) {
      const by = button.rect.y + button.rect.h / 2;
      const bx = button.rect.x + button.rect.w / 2;
      const score = Math.abs(by - ay) * 4 + Math.abs(bx - (axRight + 28)) + (bx < anchor.rect.x ? 500 : 0);
      if (!best || score < best.score) best = { anchor, button, score };
    }
  }
  return best ? {
    ok: true,
    label: 'More menu content',
    songTitle: title,
    clickedText: controlText(best.button),
    score: Math.round(best.score),
    rect: best.button.rect,
    anchor: { text: controlText(best.anchor), rect: best.anchor.rect },
  } : {
    ok: false,
    reason: 'no title-anchored More menu candidate',
    songTitle: title,
    anchors: anchors.slice(0, 10).map((x: any) => ({ text: controlText(x), rect: x.rect })),
    buttons: buttons.slice(0, 20).map((x: any) => ({ text: controlText(x), rect: x.rect })),
  };
}

function normalizeTargetWebSocketUrl(cdp: string, target: CdpTarget): CdpTarget {
  if (!target.webSocketDebuggerUrl) return target;
  try {
    const ws = new URL(target.webSocketDebuggerUrl);
    const base = new URL(cdp);
    if (ws.hostname === 'localhost' || ws.hostname === '127.0.0.1') {
      ws.hostname = base.hostname;
      ws.port = base.port;
    }
    return { ...target, webSocketDebuggerUrl: ws.toString() };
  } catch {
    return target;
  }
}

async function getOrCreateTarget(cdp: string, url: string, match: (tab: CdpTarget) => boolean): Promise<CdpTarget> {
  const tabs: CdpTarget[] = await httpJson(`${cdp}/json/list`);
  const existing = tabs.find((tab) => tab.type === 'page' && tab.webSocketDebuggerUrl && match(tab));
  if (existing) return normalizeTargetWebSocketUrl(cdp, { ...existing, createdByApi: false });
  try {
    const created = await httpJson(`${cdp}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
    if (created?.webSocketDebuggerUrl) {
      return normalizeTargetWebSocketUrl(cdp, { ...created, createdByApi: true });
    }
  } catch (error: any) {
    throw new StemsApiError(
      'Could not create a dedicated Suno browser tab through CDP.',
      'CDP_TARGET_CREATE_FAILED',
      503,
      true,
      { cdp, cause: error?.message || String(error) },
    );
  }
  throw new StemsApiError('CDP did not return a usable page target.', 'CDP_TARGET_UNAVAILABLE', 503, true, { cdp });
}

async function waitForDownloadInDirs(
  downloadDirs: string[],
  beforeByDir: Record<string, FileInfo[]>,
  timeoutMs: number,
  completedFilePattern: RegExp = /\.zip$/i,
): Promise<{ ok: boolean; files: any[]; allFiles: any[] }> {
  const dirs = [...new Set(downloadDirs.map((d) => path.resolve(expandHome(d))))];
  const started = Date.now();
  let allFiles: any[] = [];
  while (Date.now() - started < timeoutMs) {
    allFiles = [];
    const newer: any[] = [];
    const active: any[] = [];
    for (const dir of dirs) {
      const files = await listFiles(dir);
      allFiles.push(...files.map((f) => ({ ...f, downloadDir: dir })));
      const beforeKeys = new Set((beforeByDir[dir] || []).map(fileKey));
      active.push(...files.filter((f) => /\.crdownload$|\.tmp$|\.download$/i.test(f.name)).map((f) => ({ ...f, downloadDir: dir })));
      newer.push(...files
        .filter((f) => !beforeKeys.has(fileKey(f)))
        .filter((f) => !/\.crdownload$|\.tmp$|\.download$/i.test(f.name))
        .filter((f) => completedFilePattern.test(f.name))
        .map((f) => ({ ...f, downloadDir: dir })));
    }
    if (newer.length && active.length === 0) {
      return {
        ok: true,
        files: newer.sort((a, b) => b.mtimeMs - a.mtimeMs),
        allFiles: allFiles.sort((a, b) => b.mtimeMs - a.mtimeMs),
      };
    }
    await sleep(1000);
  }
  return { ok: false, files: [], allFiles: allFiles.sort((a, b) => b.mtimeMs - a.mtimeMs) };
}

export function deriveSongAnchorTitle(title: string): string {
  const raw = String(title || '').replace(/\s+\|\s+Suno(?: Studio)?\s*$/i, '').trim();
  return raw.replace(/\s+by\s+.+$/i, '').trim();
}

async function ensureSongPageReady(page: CdpConnection, songUrl: string, loadWaitMs: number): Promise<any> {
  let state = await page.evaluate(stateScript).catch(() => null);
  if (!state?.url?.includes(songUrl.split('/').pop() || '')) {
    await page.send('Page.navigate', { url: songUrl });
  }
  try {
    state = await waitForState(
      page,
      (next) => next?.url?.includes(songUrl.split('/').pop() || '') && Boolean(next?.title) && Boolean(next?.body),
      Math.max(loadWaitMs, 20000),
      500,
    );
  } catch (error: any) {
    throw new StemsApiError(
      'Suno song page did not become ready in the managed browser.',
      'SUNO_PAGE_NOT_READY',
      504,
      true,
      { song_url: songUrl, state: error?.state || state },
    );
  }
  if (/\b(?:sign in|log in)\b/i.test(stateText(state)) && !/\bLibrary\b/i.test(stateText(state))) {
    throw new StemsApiError(
      'Managed Suno browser is not authenticated.',
      'SUNO_BROWSER_NOT_AUTHENTICATED',
      401,
      false,
      { song_url: songUrl, title: state.title },
    );
  }
  await page.evaluate(installSongRecorderScript);
  return state;
}

async function openSongStemsModal(page: CdpConnection, songUrl: string, loadWaitMs: number, songTitle: string): Promise<any> {
  let state = await ensureSongPageReady(page, songUrl, loadWaitMs);
  if (isGetStemsModalOpen(state)) return { alreadyOpen: true, state };

  const steps: any[] = [];
  for (let i = 0; i < 2; i++) {
    await page.keyEscape();
    await sleep(200);
  }
  await sleep(500);
  try {
    state = await waitForState(
      page,
      (next) => Boolean(findTitleAnchoredMoreMenu(next, songTitle)?.ok)
        || stateHasControl(next, 'More menu content', { minX: 180, maxX: 850, minY: 120, maxY: 560, maxTextLength: 80 }),
      Math.max(loadWaitMs, 20000),
      500,
    );
  } catch (error: any) {
    throw new StemsApiError(
      'Suno song actions did not become ready.',
      'SUNO_SONG_ACTIONS_NOT_READY',
      504,
      true,
      { clip_id: songUrl.split('/').pop(), phase: 'open-song-actions', state: error?.state || state },
    );
  }
  const anchoredMore = findTitleAnchoredMoreMenu(state, songTitle);
  if (anchoredMore?.ok) steps.push(await clickResult(page, anchoredMore, 900));
  else {
    steps.push(await clickWithFallback(page, 'More menu content', { minX: 250, maxX: 700, minY: 200, maxY: 420, maxTextLength: 80 }, { x: 500, y: 294 }, 900));
  }
  try {
    state = await waitForState(
      page,
      (next) => stateHasControl(next, 'Download', { minX: 300, maxX: 700, minY: 350, maxY: 700, maxTextLength: 60 }),
      10000,
      300,
    );
  } catch (error: any) {
    throw new StemsApiError(
      'Suno song action menu did not open.',
      'SUNO_SONG_MENU_NOT_READY',
      504,
      true,
      { clip_id: songUrl.split('/').pop(), phase: 'open-download-menu', state: error?.state || state },
    );
  }
  steps.push(await clickWithFallback(page, 'Download', { minX: 300, maxX: 700, minY: 350, maxY: 700, maxTextLength: 60 }, { x: 437, y: 497 }, 900));
  try {
    state = await waitForState(
      page,
      (next) => stateHasControl(next, 'Stems / MIDI', { minX: 450, maxX: 850, minY: 450, maxY: 750, maxTextLength: 120, loose: true }),
      10000,
      300,
    );
  } catch (error: any) {
    throw new StemsApiError(
      'Suno download submenu did not open.',
      'SUNO_DOWNLOAD_MENU_NOT_READY',
      504,
      true,
      { clip_id: songUrl.split('/').pop(), phase: 'open-stems-menu', state: error?.state || state },
    );
  }
  steps.push(await clickWithFallback(page, 'Stems / MIDI', { minX: 450, maxX: 850, minY: 450, maxY: 750, maxTextLength: 120, loose: true }, { x: 608, y: 585 }, 2500));
  try {
    state = await waitForState(page, isGetStemsModalOpen, 15000, 500);
  } catch (error: any) {
    throw new StemsApiError(
      'Suno Get Stems/MIDI dialog did not open.',
      'SUNO_STEMS_DIALOG_NOT_READY',
      504,
      true,
      { clip_id: songUrl.split('/').pop(), phase: 'open-stems-dialog', state: error?.state || state },
    );
  }
  return { alreadyOpen: false, steps, state };
}

async function ensureAutoSplitResult(page: CdpConnection, extractTimeoutMs: number): Promise<any> {
  let state = await page.evaluate(stateScript);
  const steps: any[] = [];
  if (isExtractionReady(state)) return { alreadyReady: true, steps, state };

  if (!stateHasControl(state, 'Auto split', { loose: true })) throw Object.assign(new Error('Auto split option not visible'), { state });
  steps.push(await click(page, 'Auto split', { loose: true }, 500));
  state = await page.evaluate(stateScript);

  if (!stateHas(state, /Extracting/i) && !isExtractionReady(state)) {
    steps.push(await click(page, 'Extract', { preferBottom: true }, 1500));
  }

  const started = Date.now();
  let last = await page.evaluate(stateScript);
  while (Date.now() - started < extractTimeoutMs) {
    last = await page.evaluate(stateScript);
    if (isExtractionReady(last)) return { alreadyReady: false, steps, state: last, waitedMs: Date.now() - started };
    if (stateHas(last, /Token validation failed|Something went wrong|Extraction failed|try again/i)) {
      return { failed: true, steps, state: last, waitedMs: Date.now() - started };
    }
    await sleep(5000);
  }
  return { timeout: true, steps, state: last, waitedMs: Date.now() - started };
}

function isExtractionReady(input: any): boolean {
  const text = typeof input === 'string' ? input : getStemsDialogText(input);
  return /Lead Vocal|Synth|Other|Bass|Drums|Guitar|Piano/i.test(text) && /Download/i.test(text) && !/Extracting/i.test(text);
}

async function setDownloadChoices(page: CdpConnection, format: 'wav' | 'mp3' | 'midi'): Promise<any[]> {
  const steps: any[] = [];
  for (const label of ['MP3', 'WAV', 'MIDI'] as const) {
    steps.push(await ensureDownloadChoiceState(page, label, label.toLowerCase() === format));
  }
  return steps;
}

function normalizeStudioTitle(value: string): string {
  return String(value || '')
    .replace(/\s+\|\s+Suno Studio\s*$/i, '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function ensureStudioPageReady(
  page: CdpConnection,
  studioUrl: string,
  clipTitle: string,
  loadWaitMs: number,
): Promise<any> {
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: installStudioRecorderScript }).catch(() => {});
  await page.send('Page.navigate', { url: studioUrl });
  let state: any = null;
  try {
    state = await waitForState(
      page,
      (next) => normalizeStudioTitle(next?.title) === normalizeStudioTitle(clipTitle)
        && stateHasControl(next, 'Export', { exact: true, maxTextLength: 20 }),
      loadWaitMs,
      500,
    );
  } catch (error: any) {
    const last = error?.state || state || await page.evaluate(stateScript).catch(() => null);
    if (/\b(?:sign in|log in)\b/i.test(stateText(last)) && !/\bLibrary\b/i.test(stateText(last))) {
      throw new StemsApiError(
        'Managed Suno browser is not authenticated.',
        'SUNO_BROWSER_NOT_AUTHENTICATED',
        401,
        false,
        { page_title: last?.title, expected_title: clipTitle },
      );
    }
    throw new StemsApiError(
      'The requested Suno Studio project did not become ready with the expected title.',
      'STUDIO_PROJECT_NOT_READY',
      504,
      true,
      { page_title: last?.title, expected_title: clipTitle, phase: 'load-studio-project' },
    );
  }
  if (!String(state.url || '').startsWith('https://suno.com/studio')) {
    throw new StemsApiError(
      'Managed browser navigated away from Suno Studio.',
      'STUDIO_NAVIGATION_MISMATCH',
      502,
      true,
      { page_title: state.title, expected_title: clipTitle, received: state.url },
    );
  }
  return state;
}

async function openStudioMultitrackModal(page: CdpConnection): Promise<any> {
  let state = await page.evaluate(stateScript);
  const steps: any[] = [];
  if (!stateHasControl(state, 'Multitrack', { exact: true, maxTextLength: 40 })) {
    let exportClick: any;
    try {
      exportClick = await click(page, 'Export', { exact: true, minX: 900, maxX: 1400, minY: 40, maxY: 140, maxTextLength: 20 }, 1200);
    } catch (error: any) {
      throw new StemsApiError(
        'Could not click the Suno Studio Export control.',
        'STUDIO_EXPORT_CONTROL_NOT_FOUND',
        502,
        true,
        { phase: 'click-export', page_title: state?.title, cause: error?.message || String(error) },
      );
    }
    steps.push({ step: 'Export', ...exportClick });
    try {
      state = await waitForState(
        page,
        (next) => stateHasControl(next, 'Multitrack', { exact: true, maxTextLength: 40 }),
        10000,
        300,
      );
    } catch (error: any) {
      throw new StemsApiError(
        'Suno Studio Export menu did not expose Multitrack.',
        'STUDIO_EXPORT_MENU_NOT_READY',
        504,
        true,
        { phase: 'open-export-menu', page_title: error?.state?.title || state?.title },
      );
    }
  }
  let multitrackClick: any;
  try {
    multitrackClick = await click(page, 'Multitrack', { exact: true, minX: 900, maxX: 1400, minY: 120, maxY: 320, maxTextLength: 40 }, 500);
  } catch (error: any) {
    throw new StemsApiError(
      'Could not click the Suno Studio Multitrack control.',
      'STUDIO_MULTITRACK_CONTROL_NOT_FOUND',
      502,
      true,
      { phase: 'click-multitrack', page_title: state?.title, cause: error?.message || String(error) },
    );
  }
  steps.push({ step: 'Multitrack', ...multitrackClick });
  return { steps, state: await page.evaluate(stateScript) };
}

function parseRecordedJson(value: unknown): any {
  try {
    return typeof value === 'string' && value.trim() ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function inspectStudioExportCalls(state: any, studioProjectId: string): any {
  const calls = Array.isArray(state?.calls) ? state.calls : [];
  const renderCall = [...calls].reverse().find((call: any) => /\/api\/studio\/render-state-multitrack(?:\?|$)/.test(String(call?.url || '')));
  const saveCall = [...calls].reverse().find((call: any) => /\/api\/studio\/save-project(?:\?|$)/.test(String(call?.url || '')));
  const renderResponse = parseRecordedJson(renderCall?.responseText);
  const saveResponse = parseRecordedJson(saveCall?.responseText);
  const renderStatus = Number(renderCall?.status || 0);
  const saveStatus = Number(saveCall?.status || 0);
  const savedProjectId = String(saveResponse?.id || saveResponse?.studioProjectId || '').toLowerCase();
  const saveVersionId = String(saveResponse?.version_id || saveResponse?.versionId || '').toLowerCase();
  return {
    renderSeen: Boolean(renderCall),
    renderStatus,
    renderDownloadUrl: String(renderResponse?.download_url || ''),
    saveSeen: Boolean(saveCall),
    saveStatus,
    savedProjectId,
    saveVersionId,
    projectMatches: savedProjectId === studioProjectId,
  };
}

async function waitForStudioExportEvidence(
  page: CdpConnection,
  studioProjectId: string,
  timeoutMs: number = 30000,
): Promise<{ state: any; evidence: Record<string, unknown> }> {
  const started = Date.now();
  let state: any = null;
  while (Date.now() - started < timeoutMs) {
    state = await page.evaluate(stateScript);
    const inspected = inspectStudioExportCalls(state, studioProjectId);
    if (inspected.renderSeen && inspected.renderStatus >= 400) {
      throw new StemsApiError(
        'Suno Studio rejected the Multitrack render request.',
        'STUDIO_RENDER_FAILED',
        502,
        true,
        { phase: 'render', studio_project_id: studioProjectId, received: inspected.renderStatus },
      );
    }
    if (inspected.saveSeen && inspected.saveStatus >= 400) {
      throw new StemsApiError(
        'Suno Studio failed to save the project during Multitrack export.',
        'STUDIO_SAVE_PROJECT_FAILED',
        502,
        true,
        { phase: 'save-project', studio_project_id: studioProjectId, received: inspected.saveStatus },
      );
    }
    if (inspected.saveSeen && inspected.savedProjectId && !inspected.projectMatches) {
      throw new StemsApiError(
        'Suno Studio saved a different project than the requested clip mapped to.',
        'STUDIO_PROJECT_MISMATCH',
        502,
        false,
        { studio_project_id: studioProjectId, received: inspected.savedProjectId },
      );
    }
    if (
      inspected.renderStatus >= 200
      && inspected.renderStatus < 300
      && inspected.renderDownloadUrl
      && inspected.saveStatus >= 200
      && inspected.saveStatus < 300
      && inspected.projectMatches
      && UUID_PATTERN.test(inspected.saveVersionId)
    ) {
      return {
        state,
        evidence: {
          render_endpoint: 'https://studio-api-prod.suno.com/api/studio/render-state-multitrack',
          render_status: inspected.renderStatus,
          render_download_url: inspected.renderDownloadUrl,
          save_project_endpoint: 'https://studio-api-prod.suno.com/api/studio/save-project',
          save_project_status: inspected.saveStatus,
          save_project_id: inspected.savedProjectId,
          save_project_version_id: inspected.saveVersionId,
        },
      };
    }
    await sleep(500);
  }
  const inspected = inspectStudioExportCalls(state, studioProjectId);
  throw new StemsApiError(
    'Timed out waiting for verified Studio render and save-project responses.',
    'STUDIO_EXPORT_EVIDENCE_TIMEOUT',
    504,
    true,
    {
      phase: 'export-evidence',
      studio_project_id: studioProjectId,
      cause: `render_status=${inspected.renderStatus || 'missing'}, save_status=${inspected.saveStatus || 'missing'}, saved_project_id=${inspected.savedProjectId || 'missing'}`,
    },
  );
}

export async function normalizeSongStemsRequest(input: SongStemsRequest): Promise<NormalizedSongStemsRequest> {
  const clipId = extractSunoClipId(input.clip_id || input.url);
  const cdpInput = input.cdp || process.env.SUNO_BROWSER_CDP || 'http://host.docker.internal:18800';
  let cdp: string;
  try {
    cdp = await resolveCdpBaseUrl(cdpInput);
  } catch {
    throw new StemsApiError('cdp must be a valid HTTP or HTTPS URL.', 'INVALID_PARAMETER', 400, false, { parameter: 'cdp' });
  }
  if (!/^https?:\/\//i.test(cdp)) {
    throw new StemsApiError('cdp must be a valid HTTP or HTTPS URL.', 'INVALID_PARAMETER', 400, false, { parameter: 'cdp' });
  }
  const downloadDir = path.resolve(expandHome(
    input.download_dir
    || process.env.SUNO_STEMS_DOWNLOAD_DIR
    || defaultOutputSubdirectory('suno-stems-downloads'),
  ));
  return {
    clipId,
    songUrl: `https://suno.com/song/${clipId}`,
    songTitleHint: String(input.song_title ?? '').trim(),
    stemFormat: normalizeStemFormat(input.stem_format),
    cdp,
    downloadDir,
    loadWaitMs: parseNumberParameter(input.load_wait_ms, 'load_wait_ms', 6000, 1000, 120000),
    extractTimeoutMs: parseNumberParameter(input.extract_timeout_ms, 'extract_timeout_ms', 1200000, 5000, 3600000),
    downloadTimeoutMs: parseNumberParameter(input.download_timeout_ms, 'download_timeout_ms', 180000, 5000, 1800000),
    viewportWidth: parseNumberParameter(input.viewport_width, 'viewport_width', 1400, 900, 4096),
    viewportHeight: parseNumberParameter(input.viewport_height, 'viewport_height', 1200, 700, 4096),
    dryRun: parseBooleanParameter(input.dry_run, 'dry_run', false),
    queueTimeoutMs: parseNumberParameter(
      input.queue_timeout_ms ?? process.env.SUNO_STEMS_QUEUE_TIMEOUT_MS,
      'queue_timeout_ms',
      1800000,
      1000,
      3600000,
    ),
    cleanupRunDir: parseBooleanParameter(input.cleanup_run_dir, 'cleanup_run_dir', true),
    forceRedownload: parseBooleanParameter(input.force_redownload, 'force_redownload', false),
  };
}

function reusedArchiveResponse(
  normalized: NormalizedSongStemsRequest,
  existing: ExistingStemsArchive,
  route: string[],
): Record<string, unknown> {
  return {
    ok: true,
    reused: true,
    clip_id: normalized.clipId,
    song_url: normalized.songUrl,
    song_title: existing.songTitle,
    stem_format: normalized.stemFormat,
    download_dir: normalized.downloadDir,
    output_path: existing.file.path,
    manifest_path: existing.manifestPath,
    manifest_recreated: existing.manifestRecreated,
    downloaded_files: [existing.file],
    zip_entries: existing.entries,
    sha256: existing.sha256,
    export_evidence: existing.exportEvidence,
    credits: existing.credits,
    route,
    note: 'A previously verified archive for this clip id and format was reused; Extract was not submitted again.',
  };
}

async function downloadSongAutoStemsUnlocked(normalized: NormalizedSongStemsRequest): Promise<any> {
  const {
    clipId,
    songUrl,
    songTitleHint,
    stemFormat,
    cdp,
    downloadDir,
    loadWaitMs,
    extractTimeoutMs,
    downloadTimeoutMs,
    viewportWidth,
    viewportHeight,
    dryRun,
    cleanupRunDir,
    forceRedownload,
  } = normalized;
  const runId = randomUUID();
  const runDir = path.join(downloadDir, '.inflight', `${clipId}-${runId}`);
  const route = ['Download', 'Get Stems / MIDI', 'Auto split', 'Extract', 'Download', stemFormat.toUpperCase(), 'Download'];

  await fs.mkdir(downloadDir, { recursive: true });
  const existingBeforeBrowser = await findExistingVerifiedArchive(downloadDir, clipId, stemFormat);
  if (existingBeforeBrowser && !dryRun && !forceRedownload) return reusedArchiveResponse(normalized, existingBeforeBrowser, route);

  const target = await getOrCreateTarget(cdp, songUrl, (tab) => Boolean(tab.url?.includes(clipId)));
  const page = new CdpConnection(target.webSocketDebuggerUrl!);
  let browser: CdpConnection | null = null;
  let finalized = false;

  try {
    await page.connect(true);
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: viewportWidth,
      height: viewportHeight,
      deviceScaleFactor: 1,
      mobile: false,
    }).catch(() => {});
    const initial = await ensureSongPageReady(page, songUrl, loadWaitMs);
    const pageSongTitle = deriveSongAnchorTitle(initial.title) || songTitleHint || clipId;
    const navigationTitle = songTitleHint || pageSongTitle;
    const outputPath = path.join(
      downloadDir,
      `${safeFileName(pageSongTitle, clipId)} [${clipId}] Stems (${stemFormat.toUpperCase()}).zip`,
    );

    if (dryRun) {
      return {
        ok: true,
        dry_run: true,
        clip_id: clipId,
        song_url: songUrl,
        song_title: pageSongTitle,
        page_title: initial.title,
        stem_format: stemFormat,
        download_dir: downloadDir,
        output_path: outputPath,
        existing_verified_archive: existingBeforeBrowser ? {
          output_path: existingBeforeBrowser.file.path,
          manifest_path: existingBeforeBrowser.manifestPath,
          size: existingBeforeBrowser.file.size,
          entries: existingBeforeBrowser.entries,
        } : null,
        route,
        controls: initial.elements
          .filter((x: any) => /Auto split|Split from mix|Advanced split|Extract|Download|MP3|WAV|MIDI|Lead Vocal|Synth|Other|Full Song/i.test(`${x.text || ''} ${x.aria || ''} ${x.title || ''}`))
          .slice(0, 40)
          .map((x: any) => ({ text: x.text, aria: x.aria, title: x.title, disabled: x.disabled })),
        note: 'Dry run only; no Extract or download action was performed.',
      };
    }

    await fs.mkdir(runDir, { recursive: true });
    const browserVersion = normalizeTargetWebSocketUrl(cdp, await httpJson(`${cdp}/json/version`));
    if (!browserVersion.webSocketDebuggerUrl) {
      throw new StemsApiError('CDP browser websocket is unavailable.', 'CDP_BROWSER_UNAVAILABLE', 503, true, { cdp });
    }
    browser = new CdpConnection(browserVersion.webSocketDebuggerUrl);
    await browser.connect(false);
    try {
      await browser.send('Browser.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: runDir,
        eventsEnabled: true,
      });
    } catch (error: any) {
      throw new StemsApiError(
        'Could not configure the managed browser download directory.',
        'CDP_DOWNLOAD_CONFIG_FAILED',
        503,
        true,
        { cdp, run_dir: runDir, cause: error?.message || String(error) },
      );
    }

    await openSongStemsModal(page, songUrl, loadWaitMs, navigationTitle);
    const extract = await ensureAutoSplitResult(page, extractTimeoutMs);
    if (extract.failed) {
      throw new StemsApiError(
        'Suno reported that stems extraction failed.',
        'STEMS_EXTRACTION_FAILED',
        502,
        true,
        { clip_id: clipId, phase: 'extract', run_dir: runDir, extract },
      );
    }
    if (extract.timeout) {
      throw new StemsApiError(
        'Timed out waiting for Suno stems extraction.',
        'STEMS_EXTRACTION_TIMEOUT',
        504,
        true,
        { clip_id: clipId, phase: 'extract', run_dir: runDir, extract },
      );
    }

    let downloadDialog = await page.evaluate(stateScript);
    if (!isFormatDownloadDialogOpen(downloadDialog)) {
      await clickStemsDialogDownload(page, 1500);
    }
    if (!isFormatDownloadDialogOpen(downloadDialog)) {
      downloadDialog = await waitForState(page, isFormatDownloadDialogOpen, 15000, 500);
    }
    await setDownloadChoices(page, stemFormat);
    const finalDownloadClick = await clickFormatDialogDownload(page, 1000);
    const download = await waitForDownloadInDirs([runDir], { [runDir]: [] }, downloadTimeoutMs);
    const finalState = await page.evaluate(stateScript).catch(() => null);
    const downloadEvents = browser.events.filter((event) => /^Browser\.download/.test(event.method));
    if (!download.ok) {
      throw new StemsApiError(
        'Clicked the final Download button, but no completed stems ZIP was observed.',
        'STEMS_DOWNLOAD_TIMEOUT',
        504,
        true,
        {
          clip_id: clipId,
          phase: 'download',
          run_dir: runDir,
          recent_files: download.allFiles.slice(0, 20),
          download_events: downloadEvents,
          final_download_click: finalDownloadClick,
        },
      );
    }

    const finalizedArchive = await finalizeDownloadedArchive(
      runDir,
      outputPath,
      clipId,
      pageSongTitle,
      stemFormat,
    );
    finalized = true;
    return {
      ok: true,
      reused: false,
      clip_id: clipId,
      song_url: songUrl,
      song_title: pageSongTitle,
      page_title: finalState?.title || downloadDialog.title,
      stem_format: stemFormat,
      download_dir: downloadDir,
      output_path: finalizedArchive.file.path,
      manifest_path: finalizedArchive.manifestPath,
      downloaded_files: [finalizedArchive.file],
      zip_entries: finalizedArchive.entries,
      sha256: finalizedArchive.sha256,
      route,
      extract: {
        already_ready: Boolean(extract.alreadyReady),
        waited_ms: extract.waitedMs || 0,
      },
      note: 'Suno stems extraction and verified ZIP download completed.',
    };
  } finally {
    page.close();
    browser?.close();
    if (finalized && cleanupRunDir) {
      await fs.rm(runDir, { recursive: true, force: true }).catch(() => {});
    }
    if (target.createdByApi && target.id) {
      await httpJson(`${cdp}/json/close/${target.id}`).catch(() => null);
    }
  }
}

export async function downloadSongAutoStems(input: SongStemsRequest): Promise<any> {
  const normalized = await normalizeSongStemsRequest(input);
  await fs.mkdir(normalized.downloadDir, { recursive: true });
  const route = ['Download', 'Get Stems / MIDI', 'Auto split', 'Extract', 'Download', normalized.stemFormat.toUpperCase(), 'Download'];
  const existing = await findExistingVerifiedArchive(normalized.downloadDir, normalized.clipId, normalized.stemFormat);
  if (existing && !normalized.dryRun && !normalized.forceRedownload) return reusedArchiveResponse(normalized, existing, route);
  return await withStemsBrowserLock(
    normalized.queueTimeoutMs,
    () => downloadSongAutoStemsUnlocked(normalized),
  );
}

export async function normalizeStudioMultitrackRequest(input: StudioMultitrackRequest): Promise<NormalizedStudioMultitrackRequest> {
  const identity = normalizeStudioClipMetadata(String(input.clip_id || ''), input.clip_metadata);
  const cdpInput = input.cdp || process.env.SUNO_BROWSER_CDP || 'http://host.docker.internal:18800';
  let cdp: string;
  try {
    cdp = await resolveCdpBaseUrl(cdpInput);
  } catch {
    throw new StemsApiError('cdp must be a valid HTTP or HTTPS URL.', 'INVALID_PARAMETER', 400, false, { parameter: 'cdp' });
  }
  if (!/^https?:\/\//i.test(cdp)) {
    throw new StemsApiError('cdp must be a valid HTTP or HTTPS URL.', 'INVALID_PARAMETER', 400, false, { parameter: 'cdp' });
  }
  return {
    ...identity,
    studioUrl: `https://suno.com/studio?initial_project_id=${encodeURIComponent(identity.studioProjectId)}`,
    cdp,
    downloadDir: path.resolve(expandHome(
      input.download_dir
      || process.env.SUNO_STUDIO_MULTITRACK_DOWNLOAD_DIR
      || defaultOutputSubdirectory('suno-studio-multitrack-downloads'),
    )),
    loadWaitMs: parseNumberParameter(input.load_wait_ms, 'load_wait_ms', 120000, 5000, 300000),
    downloadTimeoutMs: parseNumberParameter(input.download_timeout_ms, 'download_timeout_ms', 300000, 5000, 1800000),
    viewportWidth: parseNumberParameter(input.viewport_width, 'viewport_width', 1600, 900, 4096),
    viewportHeight: parseNumberParameter(input.viewport_height, 'viewport_height', 1000, 700, 4096),
    dryRun: parseBooleanParameter(input.dry_run, 'dry_run', false),
    queueTimeoutMs: parseNumberParameter(
      input.queue_timeout_ms ?? process.env.SUNO_STEMS_QUEUE_TIMEOUT_MS,
      'queue_timeout_ms',
      1800000,
      1000,
      3600000,
    ),
    cleanupRunDir: parseBooleanParameter(input.cleanup_run_dir, 'cleanup_run_dir', true),
    forceRedownload: parseBooleanParameter(input.force_redownload, 'force_redownload', false),
  };
}

export function studioArchiveResponse(
  normalized: NormalizedStudioMultitrackRequest,
  archive: ExistingStudioArchive,
  reused: boolean,
  recovered: boolean = false,
): Record<string, unknown> {
  return {
    ok: true,
    reused,
    recovered,
    clip_id: normalized.clipId,
    clip_title: normalized.clipTitle,
    studio_project_id: normalized.studioProjectId,
    source_studio_project_version_id: normalized.sourceProjectVersionId,
    studio_url: normalized.studioUrl,
    download_dir: normalized.downloadDir,
    output_path: archive.file.path,
    manifest_path: archive.manifestPath,
    manifest_recreated: archive.manifestRecreated,
    downloaded_files: [archive.file],
    zip_entries: archive.entries,
    track_count: archive.tracks.length,
    tracks: archive.tracks,
    sha256: archive.sha256,
    export_evidence: archive.exportEvidence,
    credits: archive.credits,
    route: ['GET /api/feed/v3', 'Studio initial_project_id', 'Export', 'Multitrack', 'render-state-multitrack', 'verified ZIP archive'],
    note: recovered
      ? 'A previously completed Studio export was recovered from its verified inflight ZIP and evidence; Export was not clicked again.'
      : reused
        ? 'A previously verified Studio Multitrack archive for this clip id was reused; Export was not clicked again.'
        : 'Suno Studio Multitrack export, project identity checks, download, WAV validation, and archive finalization completed.',
  };
}

export async function captureCredits(getCredits?: () => Promise<any>): Promise<Record<string, unknown> | null> {
  if (!getCredits) return null;
  try {
    const value = await getCredits();
    return {
      ok: true,
      credits_left: Number.isFinite(Number(value?.credits_left)) ? Number(value.credits_left) : null,
      period: value?.period ?? null,
      monthly_limit: value?.monthly_limit ?? null,
      monthly_usage: value?.monthly_usage ?? null,
      checked_at: new Date().toISOString(),
    };
  } catch (error: any) {
    return {
      ok: false,
      error: redactPublicString(error?.message || String(error)),
      checked_at: new Date().toISOString(),
    };
  }
}

export function creditsEvidence(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!before && !after) return null;
  const beforeValue = before?.ok ? Number(before.credits_left) : Number.NaN;
  const afterValue = after?.ok ? Number(after.credits_left) : Number.NaN;
  return {
    before,
    after,
    delta: Number.isFinite(beforeValue) && Number.isFinite(afterValue) ? afterValue - beforeValue : null,
  };
}

function completedBrowserDownloadEvidence(events: any[], runDir: string): Record<string, unknown> | null {
  const event = [...events].reverse().find((entry: any) => (
    entry?.method === 'Browser.downloadProgress'
    && entry?.params?.state === 'completed'
    && (!entry?.params?.filePath || path.resolve(entry.params.filePath).startsWith(`${path.resolve(runDir)}${path.sep}`))
  ));
  if (!event) return null;
  return {
    guid: event.params?.guid || null,
    state: 'completed',
    received_bytes: event.params?.receivedBytes ?? null,
    total_bytes: event.params?.totalBytes ?? null,
    file_path: event.params?.filePath || null,
  };
}

async function downloadStudioMultitrackUnlocked(
  normalized: NormalizedStudioMultitrackRequest,
  runtime: StudioMultitrackRuntime,
): Promise<any> {
  const {
    clipId,
    clipTitle,
    studioProjectId,
    studioUrl,
    cdp,
    downloadDir,
    loadWaitMs,
    downloadTimeoutMs,
    viewportWidth,
    viewportHeight,
    dryRun,
    cleanupRunDir,
    forceRedownload,
  } = normalized;
  const route = ['GET /api/feed/v3', 'Studio initial_project_id', 'Export', 'Multitrack', 'render-state-multitrack', 'verified ZIP archive'];
  const existing = await findExistingStudioArchive(normalized);
  if (existing && !dryRun && !forceRedownload) return studioArchiveResponse(normalized, existing, true);

  const outputPath = path.join(downloadDir, `${safeFileName(clipTitle, clipId)}${studioArchiveSuffix(clipId)}`);
  if (!dryRun && !forceRedownload) {
    const recoverable = await findRecoverableStudioInflight(normalized);
    if (recoverable) {
      const archive = await finalizeStudioDownloadedArchive(
        recoverable.runDir,
        outputPath,
        normalized,
        recoverable.exportEvidence,
        recoverable.credits,
      );
      if (cleanupRunDir) {
        await fs.rm(recoverable.runDir, { recursive: true, force: true }).catch(() => {});
      }
      return studioArchiveResponse(normalized, archive, false, true);
    }
  }

  const runId = randomUUID();
  const runDir = path.join(downloadDir, '.inflight', `${clipId}-${runId}`);
  const target = await getOrCreateTarget(cdp, studioUrl, (tab) => Boolean(tab.url?.includes(studioProjectId)));
  const page = new CdpConnection(target.webSocketDebuggerUrl!);
  let browser: CdpConnection | null = null;
  let finalized = false;

  try {
    await page.connect(true);
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: viewportWidth,
      height: viewportHeight,
      deviceScaleFactor: 1,
      mobile: false,
    }).catch(() => {});
    const initial = await ensureStudioPageReady(page, studioUrl, clipTitle, loadWaitMs);
    if (dryRun) {
      return {
        ok: true,
        dry_run: true,
        clip_id: clipId,
        clip_title: clipTitle,
        studio_project_id: studioProjectId,
        source_studio_project_version_id: normalized.sourceProjectVersionId,
        studio_url: studioUrl,
        page_title: initial.title,
        download_dir: downloadDir,
        output_path: outputPath,
        existing_verified_archive: existing ? {
          output_path: existing.file.path,
          manifest_path: existing.manifestPath,
          size: existing.file.size,
          sha256: existing.sha256,
          entries: existing.entries,
          tracks: existing.tracks,
        } : null,
        route,
        controls: initial.elements
          .filter((item: any) => item.tag === 'BUTTON' || item.role === 'button' || item.role === 'menuitem')
          .filter((item: any) => `${item.text || ''} ${item.aria || ''} ${item.title || ''}`.length <= 160)
          .filter((item: any) => /Export|Multitrack|Full Song|Selected Time Range|Track|Upload|Create/i.test(`${item.text || ''} ${item.aria || ''} ${item.title || ''}`))
          .slice(0, 40)
          .map((item: any) => ({ text: item.text, aria: item.aria, title: item.title, disabled: item.disabled })),
        note: 'Dry run only; the exact Studio project was loaded but Export was not clicked.',
      };
    }

    await fs.mkdir(runDir, { recursive: true });
    const browserVersion = normalizeTargetWebSocketUrl(cdp, await httpJson(`${cdp}/json/version`));
    if (!browserVersion.webSocketDebuggerUrl) {
      throw new StemsApiError('CDP browser websocket is unavailable.', 'CDP_BROWSER_UNAVAILABLE', 503, true, { cdp });
    }
    browser = new CdpConnection(browserVersion.webSocketDebuggerUrl);
    await browser.connect(false);
    try {
      await browser.send('Browser.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: runDir,
        eventsEnabled: true,
      });
    } catch (error: any) {
      throw new StemsApiError(
        'Could not configure the managed browser download directory.',
        'CDP_DOWNLOAD_CONFIG_FAILED',
        503,
        true,
        { cdp, run_dir: runDir, cause: error?.message || String(error) },
      );
    }

    const creditsBefore = await captureCredits(runtime.getCredits);
    await openStudioMultitrackModal(page);
    const exportResult = await waitForStudioExportEvidence(page, studioProjectId);
    const download = await waitForDownloadInDirs([runDir], { [runDir]: [] }, downloadTimeoutMs);
    if (!download.ok) {
      throw new StemsApiError(
        'Suno Studio rendered Multitrack, but no completed ZIP was observed before timeout.',
        'STUDIO_DOWNLOAD_TIMEOUT',
        504,
        true,
        { clip_id: clipId, studio_project_id: studioProjectId, phase: 'download', run_dir: runDir, recent_files: download.allFiles.slice(0, 20) },
      );
    }
    await sleep(500);
    const browserDownload = completedBrowserDownloadEvidence(browser.events, runDir);
    if (!browserDownload) {
      throw new StemsApiError(
        'Studio ZIP appeared on disk without a matching completed browser download event.',
        'STUDIO_DOWNLOAD_EVENT_MISSING',
        502,
        true,
        { clip_id: clipId, studio_project_id: studioProjectId, phase: 'download-event', run_dir: runDir, files: download.files },
      );
    }
    const creditsAfter = await captureCredits(runtime.getCredits);
    const credits = creditsEvidence(creditsBefore, creditsAfter);
    const exportEvidence = {
      ...exportResult.evidence,
      browser_download: browserDownload,
      page_title: exportResult.state?.title || initial.title,
      verified_at: new Date().toISOString(),
    };
    await persistStudioInflightEvidence(runDir, normalized, exportEvidence, credits);
    const archive = await finalizeStudioDownloadedArchive(
      runDir,
      outputPath,
      normalized,
      exportEvidence,
      credits,
    );
    finalized = true;
    return studioArchiveResponse(normalized, archive, false);
  } finally {
    page.close();
    browser?.close();
    if (finalized && cleanupRunDir) {
      await fs.rm(runDir, { recursive: true, force: true }).catch(() => {});
    }
    if (target.createdByApi && target.id) {
      await httpJson(`${cdp}/json/close/${target.id}`).catch(() => null);
    }
  }
}

export async function downloadStudioMultitrack(
  input: StudioMultitrackRequest,
  runtime: StudioMultitrackRuntime = {},
): Promise<any> {
  const normalized = await normalizeStudioMultitrackRequest(input);
  await fs.mkdir(normalized.downloadDir, { recursive: true });
  if (!normalized.dryRun && !normalized.forceRedownload) {
    const existing = await findExistingStudioArchive(normalized);
    if (existing) return studioArchiveResponse(normalized, existing, true);
  }
  return await withStemsBrowserLock(
    normalized.queueTimeoutMs,
    () => downloadStudioMultitrackUnlocked(normalized, runtime),
  );
}
