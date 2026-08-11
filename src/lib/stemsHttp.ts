import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  archiveSuffix,
  captureCredits,
  creditsEvidence,
  finalizeDownloadedArchive,
  finalizeStudioDownloadedArchive,
  findExistingVerifiedArchive,
  findExistingStudioArchive,
  findRecoverableStudioInflight,
  normalizeSongStemsRequest,
  normalizeStudioMultitrackRequest,
  persistStudioInflightEvidence,
  safeFileName,
  StemsApiError,
  studioArchiveResponse,
  studioArchiveSuffix,
  type NormalizedStudioMultitrackRequest,
  type NormalizedSongStemsRequest,
  type SongStemsRequest,
  type StudioMultitrackRequest,
} from '@/lib/stemsBrowser';

export interface StudioMultitrackRenderRequest extends Record<string, unknown> {
  title: string;
  lyrics: string;
  tags: string;
  negative_tags: string;
  style_summary: string;
  caption: string;
  state: Record<string, unknown>;
  start_beats: number;
  end_beats: number;
  web_client_pathname: string;
  downbeats: unknown[];
  format: 'wav' | 'mp3';
}

export interface StudioHttpRuntime {
  getStudioProject: (studioProjectId: string) => Promise<any>;
  renderStudioMultitrack: (request: StudioMultitrackRenderRequest) => Promise<any>;
  getCredits?: () => Promise<any>;
}

export interface SongHttpRuntime {
  getClip: (clipId: string) => Promise<any>;
  getSongStemsPages: (clipId: string) => Promise<number>;
  getSongStemsPage: (clipId: string, page: number) => Promise<any[]>;
  generateSongAutoStems: (clipId: string, title: string, transactionUuid: string) => Promise<any>;
  getFeedByIds: (clipIds: string[]) => Promise<any[]>;
  renderStudioMultitrack: (request: StudioMultitrackRenderRequest) => Promise<any>;
  getCredits?: () => Promise<any>;
}

interface PendingStudioHttpRun {
  runDir: string;
  exportEvidence: Record<string, any>;
  credits: Record<string, unknown> | null;
}

interface DownloadResult {
  path: string;
  receivedBytes: number;
  totalBytes: number | null;
  attempts: number;
  resumed: boolean;
}

interface SongInflightRun {
  runDir: string;
  evidence: Record<string, any>;
  credits: Record<string, unknown> | null;
  zipPath: string | null;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function studioTimelineBounds(state: any): { startBeats: number; endBeats: number } {
  const starts: number[] = [];
  const ends: number[] = [];
  for (const track of Array.isArray(state?.tracks) ? state.tracks : []) {
    for (const clip of Array.isArray(track?.clips) ? track.clips : []) {
      const start = finiteNumber(clip?.startBeats);
      const end = finiteNumber(clip?.endBeats);
      if (start !== null) starts.push(start);
      if (end !== null) ends.push(end);
    }
  }
  if (!starts.length || !ends.length) {
    throw new StemsApiError(
      'Studio project state does not contain a renderable audio timeline.',
      'STUDIO_PROJECT_STATE_INVALID',
      422,
      false,
    );
  }
  const startBeats = Math.min(...starts);
  const endBeats = Math.max(...ends);
  if (!(endBeats > startBeats)) {
    throw new StemsApiError(
      'Studio project timeline bounds are invalid.',
      'STUDIO_PROJECT_BOUNDS_INVALID',
      422,
      false,
      { received: `${startBeats}:${endBeats}` },
    );
  }
  return { startBeats, endBeats };
}

function studioHttpResponse(
  normalized: NormalizedStudioMultitrackRequest,
  archive: Awaited<ReturnType<typeof findExistingStudioArchive>> extends infer T ? NonNullable<T> : never,
  reused: boolean,
  recovered: boolean = false,
): Record<string, unknown> {
  return {
    ...studioArchiveResponse(normalized, archive, reused, recovered),
    backend: 'http',
    browser_fallback_used: false,
    route: [
      'POST /api/feed/v3',
      'GET /api/studio/project/{studio_project_id}',
      'POST /api/studio/render-state-multitrack',
      'HTTP ZIP download',
      'verified ZIP archive',
    ],
    note: reused
      ? 'A previously verified Studio Multitrack archive was reused; no render request was submitted.'
      : recovered
        ? 'A completed pure-HTTP Studio download was recovered and finalized without another render request.'
        : 'Pure-HTTP Studio Multitrack render, resumable download, WAV validation, SHA256, and atomic finalization completed.',
  };
}

async function acquireFileLock(
  normalized: NormalizedStudioMultitrackRequest,
): Promise<() => Promise<void>> {
  const root = path.join(normalized.downloadDir, '.locks');
  const lockDir = path.join(root, `studio-${normalized.clipId}.lock`);
  const lockId = randomUUID();
  const timeoutMs = normalized.queueTimeoutMs;
  const staleMs = Math.max(timeoutMs * 2, 2 * 60 * 60 * 1000);
  const started = Date.now();
  await fs.mkdir(root, { recursive: true });
  while (true) {
    try {
      await fs.mkdir(lockDir);
      await fs.writeFile(path.join(lockDir, 'owner.json'), `${JSON.stringify({
        lock_id: lockId,
        pid: process.pid,
        clip_id: normalized.clipId,
        acquired_at: new Date().toISOString(),
      }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      const heartbeat = setInterval(() => {
        const now = new Date();
        void fs.utimes(lockDir, now, now).catch(() => {});
      }, 30000);
      heartbeat.unref();
      return async () => {
        clearInterval(heartbeat);
        const raw = await fs.readFile(path.join(lockDir, 'owner.json'), 'utf8').catch(() => '');
        let ownerLockId = '';
        try {
          ownerLockId = String(JSON.parse(raw)?.lock_id || '');
        } catch {
          return;
        }
        if (ownerLockId === lockId) await fs.rm(lockDir, { recursive: true, force: true });
      };
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      const stat = await fs.stat(lockDir).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > staleMs) {
        await fs.rm(lockDir, { recursive: true, force: true }).catch(() => {});
        continue;
      }
      if (Date.now() - started >= timeoutMs) {
        throw new StemsApiError(
          'Another Studio Multitrack request for this clip is still running.',
          'STUDIO_HTTP_BUSY',
          429,
          true,
          { clip_id: normalized.clipId, queue_timeout_ms: timeoutMs },
        );
      }
      await sleepMs(1000);
    }
  }
}

function contentRangeTotal(value: string | null): number | null {
  const match = String(value || '').match(/\/([0-9]+)$/);
  return match ? Number(match[1]) : null;
}

async function downloadHttpArchive(
  url: string,
  runDir: string,
  timeoutMs: number,
  operation: 'Studio' | 'Song' = 'Studio',
): Promise<DownloadResult> {
  const partPath = path.join(runDir, 'studio-multitrack.zip.part');
  const finalPath = path.join(runDir, 'studio-multitrack.zip');
  let resumed = false;
  let lastError: unknown;
  await fs.mkdir(runDir, { recursive: true });
  for (let attempt = 1; attempt <= 5; attempt++) {
    const existing = await fs.stat(partPath).catch(() => null);
    const offset = existing?.isFile() ? existing.size : 0;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: offset > 0 ? { Range: `bytes=${offset}-` } : undefined,
        signal: controller.signal,
      });
      if (response.status === 416 && offset > 0) {
        await fs.rename(partPath, finalPath);
        return { path: finalPath, receivedBytes: offset, totalBytes: offset, attempts: attempt, resumed: true };
      }
      if (!response.ok || !response.body) {
        const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
        const error = new StemsApiError(
          `${operation} ZIP download returned HTTP ${response.status}.`,
          operation === 'Song' ? 'STEMS_HTTP_DOWNLOAD_FAILED' : 'STUDIO_HTTP_DOWNLOAD_FAILED',
          retryable ? 502 : response.status,
          retryable,
          { phase: 'download', received: response.status },
        );
        if (!retryable) throw error;
        lastError = error;
        await sleepMs(Math.min(15000, attempt * attempt * 1000));
        continue;
      }
      const append = response.status === 206 && offset > 0;
      if (append) resumed = true;
      else if (offset > 0) await fs.rm(partPath, { force: true });
      await pipeline(
        Readable.fromWeb(response.body as any),
        createWriteStream(partPath, { flags: append ? 'a' : 'w', mode: 0o600 }),
      );
      const downloaded = await fs.stat(partPath);
      const rangedTotalValue = contentRangeTotal(response.headers.get('content-range'));
      const rangedTotal = rangedTotalValue !== null && rangedTotalValue > 0 ? rangedTotalValue : null;
      const contentLengthValue = finiteNumber(response.headers.get('content-length'));
      const contentLength = contentLengthValue !== null && contentLengthValue > 0 ? contentLengthValue : null;
      const totalBytes = rangedTotal ?? (contentLength === null ? null : (append ? offset + contentLength : contentLength));
      if (totalBytes !== null && downloaded.size < totalBytes) {
        throw new Error(`incomplete download: ${downloaded.size}/${totalBytes}`);
      }
      await fs.rm(finalPath, { force: true });
      await fs.rename(partPath, finalPath);
      return {
        path: finalPath,
        receivedBytes: downloaded.size,
        totalBytes,
        attempts: attempt,
        resumed,
      };
    } catch (error: any) {
      lastError = error;
      const nonRetryable = error instanceof StemsApiError && !error.retryable;
      if (nonRetryable || attempt >= 5) break;
      await sleepMs(Math.min(15000, attempt * attempt * 1000));
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastError instanceof StemsApiError) throw lastError;
  throw new StemsApiError(
    `${operation} ZIP download failed after retries.`,
    operation === 'Song' ? 'STEMS_HTTP_DOWNLOAD_FAILED' : 'STUDIO_HTTP_DOWNLOAD_FAILED',
    502,
    true,
    { phase: 'download', cause: lastError instanceof Error ? lastError.message : String(lastError) },
  );
}

async function findPendingStudioHttpRun(
  normalized: NormalizedStudioMultitrackRequest,
): Promise<PendingStudioHttpRun | null> {
  const root = path.join(normalized.downloadDir, '.inflight');
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const candidates: Array<{ runDir: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(`${normalized.clipId}-`)) continue;
    const runDir = path.join(root, entry.name);
    const stat = await fs.stat(runDir).catch(() => null);
    if (stat) candidates.push({ runDir, mtimeMs: stat.mtimeMs });
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  for (const candidate of candidates) {
    const raw = await fs.readFile(path.join(candidate.runDir, 'run_evidence.json'), 'utf8').catch(() => '');
    let evidence: any;
    try {
      evidence = raw ? JSON.parse(raw) : null;
    } catch {
      continue;
    }
    const exportEvidence = evidence?.export_evidence;
    if (
      evidence?.schema_version === 1
      && evidence?.clip_id === normalized.clipId
      && evidence?.studio_project_id === normalized.studioProjectId
      && exportEvidence?.backend === 'http'
      && exportEvidence?.studio_project_id === normalized.studioProjectId
      && typeof exportEvidence?.render_download_url === 'string'
      && exportEvidence.render_download_url.startsWith('https://')
      && exportEvidence?.http_download?.state !== 'completed'
    ) {
      return {
        runDir: candidate.runDir,
        exportEvidence,
        credits: evidence.credits || null,
      };
    }
  }
  return null;
}

async function finalizeHttpRun(
  normalized: NormalizedStudioMultitrackRequest,
  runDir: string,
  exportEvidence: Record<string, any>,
  credits: Record<string, unknown> | null,
  outputPath: string,
  cleanupRunDir: boolean,
  recovered: boolean,
): Promise<Record<string, unknown>> {
  const archive = await finalizeStudioDownloadedArchive(
    runDir,
    outputPath,
    normalized,
    exportEvidence,
    credits,
  );
  if (cleanupRunDir) await fs.rm(runDir, { recursive: true, force: true }).catch(() => {});
  return studioHttpResponse(normalized, archive, false, recovered);
}

export async function downloadStudioMultitrackHttp(
  input: StudioMultitrackRequest,
  runtime: StudioHttpRuntime,
): Promise<Record<string, unknown>> {
  const normalized = await normalizeStudioMultitrackRequest(input);
  await fs.mkdir(normalized.downloadDir, { recursive: true });
  if (!normalized.dryRun && !normalized.forceRedownload) {
    const existing = await findExistingStudioArchive(normalized);
    if (existing) return studioHttpResponse(normalized, existing, true);
  }
  const release = await acquireFileLock(normalized);
  try {
    if (!normalized.dryRun && !normalized.forceRedownload) {
      const existing = await findExistingStudioArchive(normalized);
      if (existing) return studioHttpResponse(normalized, existing, true);
      const completed = await findRecoverableStudioInflight(normalized);
      if (completed) {
        const outputPath = path.join(
          normalized.downloadDir,
          `${safeFileName(normalized.clipTitle, normalized.clipId)}${studioArchiveSuffix(normalized.clipId)}`,
        );
        return await finalizeHttpRun(
          normalized,
          completed.runDir,
          completed.exportEvidence,
          completed.credits,
          outputPath,
          normalized.cleanupRunDir,
          true,
        );
      }
    }

    const outputPath = path.join(
      normalized.downloadDir,
      `${safeFileName(normalized.clipTitle, normalized.clipId)}${studioArchiveSuffix(normalized.clipId)}`,
    );
    if (!normalized.dryRun && !normalized.forceRedownload) {
      const pending = await findPendingStudioHttpRun(normalized);
      if (pending) {
        try {
          const download = await downloadHttpArchive(
            String(pending.exportEvidence.render_download_url),
            pending.runDir,
            normalized.downloadTimeoutMs,
          );
          const exportEvidence = {
            ...pending.exportEvidence,
            http_download: {
              state: 'completed',
              received_bytes: download.receivedBytes,
              total_bytes: download.totalBytes,
              attempts: download.attempts,
              resumed: download.resumed,
              completed_at: new Date().toISOString(),
            },
          };
          await persistStudioInflightEvidence(pending.runDir, normalized, exportEvidence, pending.credits);
          return await finalizeHttpRun(
            normalized,
            pending.runDir,
            exportEvidence,
            pending.credits,
            outputPath,
            normalized.cleanupRunDir,
            true,
          );
        } catch (error: any) {
          const received = Number(error?.details?.received || 0);
          if (![401, 403, 404, 410].includes(received)) throw error;
        }
      }
    }

    const project = await runtime.getStudioProject(normalized.studioProjectId);
    if (String(project?.id || '').toLowerCase() !== normalized.studioProjectId) {
      throw new StemsApiError(
        'Suno returned a different Studio project than the requested clip maps to.',
        'STUDIO_PROJECT_MISMATCH',
        502,
        false,
        { studio_project_id: normalized.studioProjectId, received: String(project?.id || '') },
      );
    }
    if (!project?.state || typeof project.state !== 'object' || !Array.isArray(project.state.tracks)) {
      throw new StemsApiError(
        'Suno Studio project response did not contain a valid state.',
        'STUDIO_PROJECT_STATE_INVALID',
        502,
        true,
        { studio_project_id: normalized.studioProjectId },
      );
    }
    const bounds = studioTimelineBounds(project.state);
    if (normalized.dryRun) {
      return {
        ok: true,
        dry_run: true,
        backend: 'http',
        browser_fallback_used: false,
        clip_id: normalized.clipId,
        clip_title: normalized.clipTitle,
        studio_project_id: normalized.studioProjectId,
        project_latest_version_id: project.latest_version_id || null,
        project_track_count: project.state.tracks.length,
        start_beats: bounds.startBeats,
        end_beats: bounds.endBeats,
        output_path: outputPath,
        note: 'Pure-HTTP preflight passed; no render request was submitted.',
      };
    }

    const runDir = path.join(normalized.downloadDir, '.inflight', `${normalized.clipId}-${randomUUID()}`);
    await fs.mkdir(runDir, { recursive: true });
    const creditsBefore = await captureCredits(runtime.getCredits);
    const renderRequest: StudioMultitrackRenderRequest = {
      title: String(project.title || normalized.clipTitle || normalized.clipId),
      lyrics: '',
      tags: '',
      negative_tags: '',
      style_summary: '',
      caption: '',
      state: project.state,
      start_beats: bounds.startBeats,
      end_beats: bounds.endBeats,
      web_client_pathname: '/studio',
      downbeats: [],
      format: 'wav',
    };
    const rendered = await runtime.renderStudioMultitrack(renderRequest);
    const downloadUrl = String(rendered?.download_url || '');
    if (!downloadUrl.startsWith('https://')) {
      throw new StemsApiError(
        'Suno Studio render did not return a valid download URL.',
        'STUDIO_RENDER_RESPONSE_INVALID',
        502,
        true,
        { studio_project_id: normalized.studioProjectId },
      );
    }
    let exportEvidence: Record<string, any> = {
      backend: 'http',
      studio_project_id: normalized.studioProjectId,
      project_latest_version_id: project.latest_version_id || null,
      project_major_version: project.major_version ?? null,
      project_endpoint: `https://studio-api-prod.suno.com/api/studio/project/${normalized.studioProjectId}`,
      render_endpoint: 'https://studio-api-prod.suno.com/api/studio/render-state-multitrack',
      render_status: 200,
      render_download_url: downloadUrl,
      render_format: 'wav',
      render_start_beats: bounds.startBeats,
      render_end_beats: bounds.endBeats,
      render_track_count: project.state.tracks.length,
      http_download: { state: 'pending', started_at: new Date().toISOString() },
      verified_at: new Date().toISOString(),
    };
    await persistStudioInflightEvidence(runDir, normalized, exportEvidence, creditsEvidence(creditsBefore, null));
    const download = await downloadHttpArchive(downloadUrl, runDir, normalized.downloadTimeoutMs);
    const creditsAfter = await captureCredits(runtime.getCredits);
    const credits = creditsEvidence(creditsBefore, creditsAfter);
    exportEvidence = {
      ...exportEvidence,
      http_download: {
        state: 'completed',
        received_bytes: download.receivedBytes,
        total_bytes: download.totalBytes,
        attempts: download.attempts,
        resumed: download.resumed,
        completed_at: new Date().toISOString(),
      },
      verified_at: new Date().toISOString(),
    };
    await persistStudioInflightEvidence(runDir, normalized, exportEvidence, credits);
    return await finalizeHttpRun(
      normalized,
      runDir,
      exportEvidence,
      credits,
      outputPath,
      normalized.cleanupRunDir,
      false,
    );
  } finally {
    await release();
  }
}

const STEM_NAMES: Record<string, string> = {
  Vocals: 'Lead Vocals',
  Backing_Vocals: 'Backing Vocals',
  Drums: 'Drums',
  Bass: 'Bass',
  Guitar: 'Guitar',
  Keyboard: 'Keyboard',
  Percussion: 'Percussion',
  Strings: 'Strings',
  Synth: 'Synth',
  FX: 'Other',
  Brass: 'Brass',
  Woodwinds: 'Woodwinds',
};

const STEM_ORDER = Object.keys(STEM_NAMES);
const STEM_COLORS = ['#208BFF', '#02AF4A', '#FF6A00', '#DE1677', '#7251F7', '#04A6A6'];

function songTitleFromClip(clip: any, fallback: string): string {
  return String(clip?.title || clip?.metadata?.title || fallback).normalize('NFKC').trim() || fallback;
}

function clipDurationSeconds(clip: any): number | null {
  for (const value of [clip?.metadata?.duration, clip?.duration, clip?.raw?.metadata?.duration]) {
    const parsed = finiteNumber(value);
    if (parsed !== null && parsed > 0) return parsed;
  }
  return null;
}

function stemGroupName(clip: any): string {
  return String(
    clip?.metadata?.stem_type_group_name
    || clip?.raw?.metadata?.stem_type_group_name
    || clip?.stem_type_group_name
    || '',
  ).trim();
}

function isCompleteStem(clip: any): boolean {
  const status = String(clip?.status || clip?.raw?.status || '').toLowerCase();
  const underThreshold = Boolean(
    clip?.metadata?.is_loudness_under_threshold
    || clip?.raw?.metadata?.is_loudness_under_threshold,
  );
  return status === 'complete' && !underThreshold && Boolean(String(clip?.id || '').trim());
}

interface StemBank {
  page: number;
  stems: any[];
}

async function loadSongStemBanks(runtime: SongHttpRuntime, clipId: string): Promise<StemBank[]> {
  const pages = await runtime.getSongStemsPages(clipId);
  if (pages <= 0) return [];
  const results = await Promise.all(
    Array.from({ length: pages }, (_, page) => runtime.getSongStemsPage(clipId, page)),
  );
  return results
    .map((stems, page) => ({
      page,
      stems: Array.from(new Map(
        stems.filter((stem) => stem && typeof stem === 'object')
          .map((stem) => [String(stem.id || '').toLowerCase(), stem]),
      ).values()),
    }))
    .filter((bank) => bank.stems.length > 2);
}

function chooseStemBank(banks: StemBank[]): StemBank | null {
  if (!banks.length) return null;
  const ranked = [...banks].sort((left, right) => {
    const leftComplete = left.stems.filter(isCompleteStem).length;
    const rightComplete = right.stems.filter(isCompleteStem).length;
    return (rightComplete - leftComplete) || (right.page - left.page);
  });
  return ranked[0] || null;
}

function orderedCompleteStems(bank: StemBank): any[] {
  return bank.stems.filter(isCompleteStem).sort((left, right) => {
    const leftIndex = STEM_ORDER.indexOf(stemGroupName(left));
    const rightIndex = STEM_ORDER.indexOf(stemGroupName(right));
    const normalizedLeft = leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const normalizedRight = rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex;
    return normalizedLeft - normalizedRight;
  });
}

function defaultEq(): Record<string, unknown> {
  return {
    enabled: true,
    band1: { type: 'highpass', enabled: false, frequency: 60, gain: 0, q: 0.707 },
    band2: { type: 'lowshelf', enabled: true, frequency: 160, gain: 0, q: 0.707 },
    band3: { type: 'peaking', enabled: true, frequency: 450, gain: 0, q: 0.707 },
    band4: { type: 'peaking', enabled: true, frequency: 1200, gain: 0, q: 0.707 },
    band5: { type: 'highshelf', enabled: true, frequency: 3200, gain: 0, q: 0.707 },
    band6: { type: 'lowpass', enabled: false, frequency: 8800, gain: 0, q: 0.707 },
  };
}

function buildSongStemRenderRequest(
  normalized: NormalizedSongStemsRequest,
  sourceClip: any,
  stems: any[],
): StudioMultitrackRenderRequest {
  const sourceDuration = clipDurationSeconds(sourceClip);
  const durations = stems.map((stem) => clipDurationSeconds(stem) ?? sourceDuration).filter((value): value is number => Boolean(value));
  if (!durations.length) {
    throw new StemsApiError(
      'Suno stem clips did not contain a usable duration.',
      'STEMS_DURATION_MISSING',
      502,
      true,
      { clip_id: normalized.clipId },
    );
  }
  const bps = 2;
  const endBeats = Math.max(...durations) * bps;
  const tracks = stems.map((stem, index) => {
    const group = stemGroupName(stem);
    const name = STEM_NAMES[group] || group.replace(/_/g, ' ') || `Stem ${index + 1}`;
    const duration = clipDurationSeconds(stem) ?? sourceDuration ?? Math.max(...durations);
    const clipEndBeats = duration * bps;
    const color = STEM_COLORS[index % STEM_COLORS.length];
    return {
      type: 'audio',
      id: randomUUID(),
      input: null,
      color,
      name,
      clips: [{
        type: 'audio',
        id: randomUUID(),
        streaming: false,
        name,
        color,
        transposition: 0,
        formantCorrection: 0,
        amplitude: 1,
        startBeats: 0,
        endBeats: clipEndBeats,
        readStartBeats: 0,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        fadeInCurve: 1,
        fadeOutCurve: 1,
        mute: false,
        reversed: false,
        loop: { enabled: false, startBeats: 0, endBeats: clipEndBeats },
        warp: { enabled: false, awaitingAnalysis: false },
        asset: { type: 'clip', id: String(stem.id).toLowerCase() },
      }],
      clipCreationIntents: [],
      height: 86,
      solo: false,
      mute: false,
      arm: false,
      amplitude: 1,
      balance: 0,
      instrument: { type: 'song' },
      soloTakeLaneId: null,
      takeLanesExpanded: false,
      takeLanes: [],
      eq: defaultEq(),
      signalChain: [],
      routingMode: 'linear',
    };
  });
  const state = {
    amplitude: 1,
    sections: {},
    lyricsCorrectionsByClipId: {},
    metronome: { enabled: false, amplitude: 1 },
    midiNotePreviewEnabled: true,
    timing: { type: 'manual', bpsAutomation: [], firstBeatSeconds: 0, bps },
    timeSignatureChanges: [{ startBeats: 0, subdivisionsPerBar: 4, beatsPerSubdivision: 1 }],
    selection: {
      anchorBeats: 0,
      focusBeats: 0,
      trackIds: [],
      focusedTrackId: null,
      focusedTakeLaneId: null,
      focusedArea: null,
      arrangementAnchorBeats: null,
      arrangementFocusBeats: null,
      noteIds: [],
      pluginIds: [],
      warpMarkerSeconds: {},
      automationPointIndices: [],
      contextBeforeBeats: 32,
      contextAfterBeats: 32,
    },
    loop: { enabled: false, startBeats: 0, endBeats: 0 },
    songFadeInBeats: 0,
    songFadeOutBeats: 0,
    layout: {
      editorPanelType: null,
      midiAutomationLaneId: { category: 'noteProperty', property: 'velocity' },
      midiAutomationLaneHeight: 24,
      arrangementEditorHeight: 280,
    },
    editorPointerModes: { audio: 'select', midi: 'select' },
    masterSignalChain: [],
    midiControllerSignalChain: [],
    masterRoutingMode: 'linear',
    routing: {},
    markersRegistry: {},
    tracks,
  };
  return {
    title: `${songTitleFromClip(sourceClip, normalized.clipId)} Stems`,
    lyrics: '',
    tags: '',
    negative_tags: '',
    style_summary: '',
    caption: '',
    state,
    start_beats: 0,
    end_beats: endBeats,
    web_client_pathname: `/song/${normalized.clipId}`,
    downbeats: [],
    format: normalized.stemFormat as 'wav' | 'mp3',
  };
}

async function acquireSongFileLock(normalized: NormalizedSongStemsRequest): Promise<() => Promise<void>> {
  const root = path.join(normalized.downloadDir, '.locks');
  const lockDir = path.join(root, `song-${normalized.clipId}-${normalized.stemFormat}.lock`);
  const lockId = randomUUID();
  const started = Date.now();
  const staleMs = Math.max(normalized.queueTimeoutMs * 2, 2 * 60 * 60 * 1000);
  await fs.mkdir(root, { recursive: true });
  while (true) {
    try {
      await fs.mkdir(lockDir);
      await fs.writeFile(path.join(lockDir, 'owner.json'), `${JSON.stringify({
        lock_id: lockId,
        pid: process.pid,
        clip_id: normalized.clipId,
        stem_format: normalized.stemFormat,
        acquired_at: new Date().toISOString(),
      }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      const heartbeat = setInterval(() => {
        const now = new Date();
        void fs.utimes(lockDir, now, now).catch(() => {});
      }, 30000);
      heartbeat.unref();
      return async () => {
        clearInterval(heartbeat);
        const raw = await fs.readFile(path.join(lockDir, 'owner.json'), 'utf8').catch(() => '');
        let ownerLockId = '';
        try {
          ownerLockId = String(JSON.parse(raw)?.lock_id || '');
        } catch {
          return;
        }
        if (ownerLockId === lockId) await fs.rm(lockDir, { recursive: true, force: true });
      };
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      const stat = await fs.stat(lockDir).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > staleMs) {
        await fs.rm(lockDir, { recursive: true, force: true }).catch(() => {});
        continue;
      }
      if (Date.now() - started >= normalized.queueTimeoutMs) {
        throw new StemsApiError(
          'Another Song stems request for this clip and format is still running.',
          'STEMS_HTTP_BUSY',
          429,
          true,
          { clip_id: normalized.clipId, stem_format: normalized.stemFormat, queue_timeout_ms: normalized.queueTimeoutMs },
        );
      }
      await sleepMs(1000);
    }
  }
}

async function writeSongRunEvidence(
  runDir: string,
  normalized: NormalizedSongStemsRequest,
  evidence: Record<string, unknown>,
  credits: Record<string, unknown> | null,
): Promise<void> {
  const destination = path.join(runDir, 'run_evidence.json');
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify({
    schema_version: 1,
    export_type: 'song_auto_stems',
    clip_id: normalized.clipId,
    stem_format: normalized.stemFormat,
    export_evidence: evidence,
    credits,
    persisted_at: new Date().toISOString(),
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, destination);
}

async function findSongInflightRun(
  normalized: NormalizedSongStemsRequest,
): Promise<SongInflightRun | null> {
  const root = path.join(normalized.downloadDir, '.inflight');
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const candidates: Array<{ runDir: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(`${normalized.clipId}-`)) continue;
    const runDir = path.join(root, entry.name);
    const stat = await fs.stat(runDir).catch(() => null);
    if (stat) candidates.push({ runDir, mtimeMs: stat.mtimeMs });
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  for (const candidate of candidates) {
    const raw = await fs.readFile(path.join(candidate.runDir, 'run_evidence.json'), 'utf8').catch(() => '');
    let parsed: any;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      continue;
    }
    if (
      parsed?.schema_version !== 1
      || parsed?.export_type !== 'song_auto_stems'
      || parsed?.clip_id !== normalized.clipId
      || parsed?.stem_format !== normalized.stemFormat
      || parsed?.export_evidence?.backend !== 'http'
    ) continue;
    const files = await fs.readdir(candidate.runDir, { withFileTypes: true }).catch(() => []);
    const zip = files.find((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.zip'));
    return {
      runDir: candidate.runDir,
      evidence: parsed.export_evidence,
      credits: parsed.credits || null,
      zipPath: zip ? path.join(candidate.runDir, zip.name) : null,
    };
  }
  return null;
}

async function discoverSongStemBank(
  runtime: SongHttpRuntime,
  clipId: string,
  timeoutMs: number,
): Promise<{ banks: StemBank[]; bank: StemBank | null }> {
  const started = Date.now();
  let banks: StemBank[] = [];
  let bank: StemBank | null = null;
  while (Date.now() - started < timeoutMs) {
    banks = await loadSongStemBanks(runtime, clipId);
    bank = chooseStemBank(banks);
    if (bank && orderedCompleteStems(bank).length >= 2) return { banks, bank };
    await sleepMs(5000);
  }
  return { banks, bank };
}

async function waitForGeneratedStems(
  runtime: SongHttpRuntime,
  clipIds: string[],
  timeoutMs: number,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const clips = await runtime.getFeedByIds(clipIds);
    const byId = new Map(clips.map((clip) => [String(clip?.id || '').toLowerCase(), clip]));
    const statuses = clipIds.map((id) => String(byId.get(id)?.status || '').toLowerCase());
    if (statuses.length === clipIds.length && statuses.every((status) => status === 'complete')) return;
    if (statuses.some((status) => status === 'error')) {
      throw new StemsApiError(
        'Suno reported that one or more generated stem clips failed.',
        'STEMS_EXTRACTION_FAILED',
        502,
        true,
        { phase: 'extract', received: statuses.join(',') },
      );
    }
    await sleepMs(10000);
  }
  throw new StemsApiError(
    'Timed out waiting for Suno Auto split stem clips.',
    'STEMS_EXTRACTION_TIMEOUT',
    504,
    true,
    { phase: 'extract' },
  );
}

function songHttpResponse(
  normalized: NormalizedSongStemsRequest,
  archive: any,
  songTitle: string,
  reused: boolean,
  evidence?: Record<string, unknown> | null,
  credits?: Record<string, unknown> | null,
): Record<string, unknown> {
  return {
    ok: true,
    reused,
    recovered: false,
    backend: 'http',
    browser_fallback_used: false,
    clip_id: normalized.clipId,
    song_url: normalized.songUrl,
    song_title: songTitle,
    stem_format: normalized.stemFormat,
    download_dir: normalized.downloadDir,
    output_path: archive.file.path,
    manifest_path: archive.manifestPath,
    manifest_recreated: archive.manifestRecreated ?? false,
    downloaded_files: [archive.file],
    zip_entries: archive.entries,
    sha256: archive.sha256,
    export_evidence: evidence ?? archive.exportEvidence ?? null,
    credits: credits ?? archive.credits ?? null,
    route: [
      'GET /api/clip/{clip_id}/stems/pages',
      'GET /api/clip/{clip_id}/stems?page=N',
      'POST /api/generate/v2-web when absent',
      'POST /api/studio/render-state-multitrack',
      'HTTP ZIP download',
      'verified ZIP archive',
    ],
    note: reused
      ? 'A previously verified Song stems archive was reused; no extraction or render request was submitted.'
      : 'Pure-HTTP Song Auto split lookup/extraction, multitrack render, download, ZIP validation, SHA256, and atomic finalization completed.',
  };
}

export async function downloadSongAutoStemsHttp(
  input: SongStemsRequest,
  runtime: SongHttpRuntime,
): Promise<Record<string, unknown>> {
  const normalized = await normalizeSongStemsRequest(input);
  if (normalized.stemFormat === 'midi') {
    throw new StemsApiError(
      'Pure-HTTP MIDI stem packaging uses a separate Suno transcription contract and is not enabled yet.',
      'STEMS_HTTP_MIDI_NOT_IMPLEMENTED',
      501,
      false,
      { stem_format: normalized.stemFormat },
    );
  }
  await fs.mkdir(normalized.downloadDir, { recursive: true });
  if (!normalized.dryRun && !normalized.forceRedownload) {
    const existing = await findExistingVerifiedArchive(normalized.downloadDir, normalized.clipId, normalized.stemFormat);
    if (existing) return songHttpResponse(normalized, existing, existing.songTitle, true);
  }
  const release = await acquireSongFileLock(normalized);
  try {
    if (!normalized.dryRun && !normalized.forceRedownload) {
      const existing = await findExistingVerifiedArchive(normalized.downloadDir, normalized.clipId, normalized.stemFormat);
      if (existing) return songHttpResponse(normalized, existing, existing.songTitle, true);
    }
    const sourceClip = await runtime.getClip(normalized.clipId);
    const songTitle = songTitleFromClip(sourceClip, normalized.songTitleHint || normalized.clipId);
    const outputPath = path.join(
      normalized.downloadDir,
      `${safeFileName(songTitle, normalized.clipId)}${archiveSuffix(normalized.clipId, normalized.stemFormat)}`,
    );
    const inflight = !normalized.dryRun && !normalized.forceRedownload
      ? await findSongInflightRun(normalized)
      : null;
    if (inflight?.zipPath && inflight.evidence?.http_download?.state === 'completed') {
      const archive = await finalizeDownloadedArchive(
        inflight.runDir,
        outputPath,
        normalized.clipId,
        songTitle,
        normalized.stemFormat,
        inflight.evidence,
        inflight.credits,
      );
      if (normalized.cleanupRunDir) await fs.rm(inflight.runDir, { recursive: true, force: true }).catch(() => {});
      return {
        ...songHttpResponse(normalized, archive, songTitle, false, inflight.evidence, inflight.credits),
        recovered: true,
        note: 'A completed pure-HTTP Song stems ZIP was recovered from .inflight and finalized without another extraction or render request.',
      };
    }
    if (
      inflight
      && typeof inflight.evidence?.render_download_url === 'string'
      && inflight.evidence.render_download_url.startsWith('https://')
      && inflight.evidence?.http_download?.state !== 'completed'
    ) {
      try {
        const download = await downloadHttpArchive(
          inflight.evidence.render_download_url,
          inflight.runDir,
          normalized.downloadTimeoutMs,
          'Song',
        );
        const recoveredEvidence = {
          ...inflight.evidence,
          http_download: {
            state: 'completed',
            received_bytes: download.receivedBytes,
            total_bytes: download.totalBytes,
            attempts: download.attempts,
            resumed: download.resumed,
            completed_at: new Date().toISOString(),
          },
          verified_at: new Date().toISOString(),
        };
        await writeSongRunEvidence(inflight.runDir, normalized, recoveredEvidence, inflight.credits);
        const archive = await finalizeDownloadedArchive(
          inflight.runDir,
          outputPath,
          normalized.clipId,
          songTitle,
          normalized.stemFormat,
          recoveredEvidence,
          inflight.credits,
        );
        if (normalized.cleanupRunDir) await fs.rm(inflight.runDir, { recursive: true, force: true }).catch(() => {});
        return {
          ...songHttpResponse(normalized, archive, songTitle, false, recoveredEvidence, inflight.credits),
          recovered: true,
          note: 'A pending pure-HTTP Song stems download was resumed from .inflight without another extraction or render request.',
        };
      } catch (error: any) {
        const received = Number(error?.details?.received || 0);
        if (![401, 403, 404, 410].includes(received)) throw error;
      }
    }
    let banks = await loadSongStemBanks(runtime, normalized.clipId);
    let bank = chooseStemBank(banks);
    if (normalized.dryRun) {
      return {
        ok: true,
        dry_run: true,
        backend: 'http',
        browser_fallback_used: false,
        clip_id: normalized.clipId,
        song_title: songTitle,
        stem_format: normalized.stemFormat,
        existing_bank_count: banks.length,
        selected_bank_page: bank?.page ?? null,
        selected_bank_stem_count: bank?.stems.length ?? 0,
        complete_stem_count: bank ? orderedCompleteStems(bank).length : 0,
        stems: bank?.stems.map((stem) => ({
          id: stem.id,
          status: stem.status,
          group: stemGroupName(stem),
          duration: clipDurationSeconds(stem),
          under_loudness_threshold: Boolean(stem?.metadata?.is_loudness_under_threshold),
        })) || [],
        would_submit_extraction: !bank,
        note: 'Pure-HTTP Song stems preflight passed; no extraction or render request was submitted.',
      };
    }

    const runDir = inflight?.runDir
      || path.join(normalized.downloadDir, '.inflight', `${normalized.clipId}-${randomUUID()}`);
    await fs.mkdir(runDir, { recursive: true });
    const persistedCreditsBefore: Record<string, unknown> | null =
      inflight?.credits?.before && typeof inflight.credits.before === 'object'
      ? inflight.credits.before as Record<string, unknown>
      : null;
    const creditsBefore = persistedCreditsBefore || await captureCredits(runtime.getCredits);
    let generationEvidence: Record<string, any> = inflight?.evidence?.generation || {
      submitted: false,
      reused_existing_bank: Boolean(bank),
      selected_bank_page: bank?.page ?? null,
    };
    if (!bank) {
      const recoveredIds = Array.isArray(generationEvidence?.stem_clip_ids)
        ? generationEvidence.stem_clip_ids.map((id: unknown) => String(id || '').toLowerCase()).filter(Boolean)
        : [];
      if (recoveredIds.length) {
        await waitForGeneratedStems(runtime, recoveredIds, normalized.extractTimeoutMs);
        const discovered = await discoverSongStemBank(runtime, normalized.clipId, 120000);
        banks = discovered.banks;
        bank = discovered.bank;
        if (!bank) {
          throw new StemsApiError(
            'Persisted stem clip IDs completed, but Suno has not exposed their stem bank yet. Rerun will keep polling the same IDs and will not submit extraction again.',
            'STEMS_BANK_NOT_FOUND',
            504,
            true,
            { phase: 'discover-bank' },
          );
        }
      }
    }
    if (!bank) {
      const transactionUuid = String(generationEvidence?.transaction_uuid || randomUUID()).toLowerCase();
      if (generationEvidence?.submission_state === 'intent_persisted') {
        const grace = await discoverSongStemBank(
          runtime,
          normalized.clipId,
          Math.min(normalized.extractTimeoutMs, 300000),
        );
        banks = grace.banks;
        bank = grace.bank;
      }
      if (!bank) {
        generationEvidence = {
          submitted: false,
          transaction_uuid: transactionUuid,
          submission_state: 'intent_persisted',
          intent_persisted_at: generationEvidence?.intent_persisted_at || new Date().toISOString(),
        };
        await writeSongRunEvidence(runDir, normalized, {
          backend: 'http',
          generation: generationEvidence,
        }, creditsEvidence(creditsBefore, null));
      let generated: any;
      try {
        generated = await runtime.generateSongAutoStems(normalized.clipId, songTitle, transactionUuid);
      } catch (error: any) {
        throw new StemsApiError(
          'Suno Auto split submission failed or returned an ambiguous network result. Rerun will query existing stems before any resubmission.',
          'STEMS_EXTRACTION_SUBMIT_AMBIGUOUS',
          502,
          true,
          { phase: 'extract-submit', cause: error?.message || String(error) },
        );
      }
      const generatedIds = (generated?.clips || [])
        .map((clip: any) => String(clip?.id || '').toLowerCase())
        .filter(Boolean);
      if (!generatedIds.length) {
        throw new StemsApiError(
          'Suno Auto split submission returned no stem clip IDs.',
          'STEMS_EXTRACTION_NO_IDS',
          502,
          true,
          { phase: 'extract-submit' },
        );
      }
      generationEvidence = {
        submitted: true,
        transaction_uuid: transactionUuid,
        stem_clip_ids: generatedIds,
        submitted_at: new Date().toISOString(),
      };
      await writeSongRunEvidence(runDir, normalized, {
        backend: 'http',
        generation: generationEvidence,
      }, creditsEvidence(creditsBefore, null));
      await waitForGeneratedStems(runtime, generatedIds, normalized.extractTimeoutMs);
      const discovered = await discoverSongStemBank(runtime, normalized.clipId, 120000);
      banks = discovered.banks;
      bank = discovered.bank;
      if (!bank) {
        throw new StemsApiError(
          'Generated stem clips completed, but Suno did not expose a downloadable stem bank.',
          'STEMS_BANK_NOT_FOUND',
          504,
          true,
          { phase: 'discover-bank' },
        );
      }
      }
    }
    const stems = orderedCompleteStems(bank);
    if (stems.length < 2) {
      throw new StemsApiError(
        'The selected Suno Auto split bank contains fewer than two completed non-empty stems.',
        'STEMS_BANK_INCOMPLETE',
        409,
        true,
        { phase: 'select-bank', received: stems.length },
      );
    }
    const renderRequest = buildSongStemRenderRequest(normalized, sourceClip, stems);
    const rendered = await runtime.renderStudioMultitrack(renderRequest);
    const downloadUrl = String(rendered?.download_url || '');
    if (!downloadUrl.startsWith('https://')) {
      throw new StemsApiError(
        'Suno Song stems render did not return a valid download URL.',
        'STEMS_RENDER_RESPONSE_INVALID',
        502,
        true,
        { phase: 'render' },
      );
    }
    let exportEvidence: Record<string, any> = {
      backend: 'http',
      source_clip_id: normalized.clipId,
      generation: generationEvidence,
      selected_bank_page: bank.page,
      selected_stem_ids: stems.map((stem) => String(stem.id).toLowerCase()),
      selected_stem_groups: stems.map(stemGroupName),
      render_endpoint: 'https://studio-api-prod.suno.com/api/studio/render-state-multitrack',
      render_status: 200,
      render_download_url: downloadUrl,
      render_format: normalized.stemFormat,
      render_start_beats: renderRequest.start_beats,
      render_end_beats: renderRequest.end_beats,
      render_track_count: stems.length,
      http_download: { state: 'pending', started_at: new Date().toISOString() },
    };
    await writeSongRunEvidence(runDir, normalized, exportEvidence, creditsEvidence(creditsBefore, null));
    const download = await downloadHttpArchive(downloadUrl, runDir, normalized.downloadTimeoutMs, 'Song');
    const creditsAfter = await captureCredits(runtime.getCredits);
    const credits = creditsEvidence(creditsBefore, creditsAfter);
    exportEvidence = {
      ...exportEvidence,
      http_download: {
        state: 'completed',
        received_bytes: download.receivedBytes,
        total_bytes: download.totalBytes,
        attempts: download.attempts,
        resumed: download.resumed,
        completed_at: new Date().toISOString(),
      },
      verified_at: new Date().toISOString(),
    };
    await writeSongRunEvidence(runDir, normalized, exportEvidence, credits);
    const archive = await finalizeDownloadedArchive(
      runDir,
      outputPath,
      normalized.clipId,
      songTitle,
      normalized.stemFormat,
      exportEvidence,
      credits,
    );
    if (normalized.cleanupRunDir) await fs.rm(runDir, { recursive: true, force: true }).catch(() => {});
    return songHttpResponse(normalized, archive, songTitle, false, exportEvidence, credits);
  } finally {
    await release();
  }
}
