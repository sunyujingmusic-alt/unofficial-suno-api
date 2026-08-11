import axios from 'axios';
import { createHash, randomUUID } from 'crypto';
import { createWriteStream, promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type {
  AudioInfo,
  StudioGenerationRequest,
  StudioGenerationResponse,
  SunoApi,
} from '@/lib/SunoApi';
import { sleep } from '@/lib/utils';

const execFileP = promisify(execFile);
const DEFAULT_POLL_ATTEMPTS = 90;
const DEFAULT_POLL_INTERVAL_SECONDS = 3;
const TERMINAL_FAILURE_STATUSES = new Set(['error', 'failed', 'cancelled', 'canceled']);

export interface StudioExportRequest {
  state: Record<string, unknown>;
  title?: string;
  lyrics?: string;
  tags?: string;
  negative_tags?: string;
  style_summary?: string;
  caption?: string;
  workspace_project_id?: string;
  studio_project_id?: string;
  studio_project_version_id?: string;
  from_studio_project_id?: string;
  start_beats?: number;
  end_beats?: number;
  downbeats?: unknown[];
  export_mode?: string;
  generate_midi_preview?: boolean;
  wait_audio?: boolean;
  max_poll_attempts?: number;
  poll_interval_seconds?: number;
}

export interface StudioExportResult {
  clip_id: string;
  export_mode: string;
  status?: string;
  render_job: {
    id?: string;
    clip_id?: string;
    status?: string;
    type?: string;
  };
  clip?: AudioInfo;
}

export interface StudioMultitrackRequest {
  state: Record<string, unknown>;
  studio_project_id: string;
  title?: string;
  start_beats?: number;
  end_beats?: number;
  downbeats?: unknown[];
  format?: string;
  output_path?: string;
  download?: boolean;
  force_render?: boolean;
}

export interface StudioMultitrackIntegrity {
  local_path?: string;
  file_size?: number;
  sha256?: string;
  container: 'zip' | 'audio' | 'unknown';
  container_test: 'pass' | 'not_run' | 'fail';
  entry_count?: number;
  wav_count?: number;
  representative_wav?: Record<string, unknown>;
  error?: string;
}

export interface StudioMultitrackResult extends StudioMultitrackIntegrity {
  download_url?: string;
  download_url_expires?: boolean;
  project_id: string;
  start_beats: number;
  end_beats: number;
  format: string;
  request_fingerprint: string;
  reused: boolean;
  upstream_submitted: boolean;
  previous_archive_path?: string;
}

export interface StudioGenerationOptions extends StudioGenerationRequest {
  idempotency_key: string;
  confirm_paid_generation?: boolean;
  wait_audio?: boolean;
  max_poll_attempts?: number;
  poll_interval_seconds?: number;
}

export interface StudioGenerationPollResult {
  clip_ids: string[];
  clips: AudioInfo[];
  statuses: Record<string, string>;
  complete: boolean;
  project_insertion: Array<{
    clip_id: string;
    expected_studio_project_id?: string;
    observed_project_ids: string[];
    expected_project_observed?: boolean;
  }>;
}

export interface StudioDirectTransport {
  studioRequest<T = any>(input: {
    method: 'GET' | 'POST';
    endpoint: string;
    data?: unknown;
    params?: Record<string, unknown>;
    timeout?: number;
  }): Promise<T>;
  getFeedByIdsV3(clipIds: string[], limit?: number): Promise<AudioInfo[]>;
  submitStudioGeneration(input: StudioGenerationRequest): Promise<StudioGenerationResponse>;
}

function asTransport(api: SunoApi): StudioDirectTransport {
  return api as unknown as StudioDirectTransport;
}

function numberOrDefault(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function inputError(message: string): Error {
  const error: any = new Error(message);
  error.response = { status: 400 };
  return error;
}

function assertUuid(value: string, field: string): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)) {
    throw inputError(`${field} must be a UUID`);
  }
  return normalized;
}

function studioTimelineBounds(state: any): { startBeats: number; endBeats: number } {
  const starts: number[] = [];
  const ends: number[] = [];
  for (const track of Array.isArray(state?.tracks) ? state.tracks : []) {
    for (const clip of Array.isArray(track?.clips) ? track.clips : []) {
      const start = Number(clip?.startBeats);
      const end = Number(clip?.endBeats);
      if (Number.isFinite(start)) starts.push(start);
      if (Number.isFinite(end)) ends.push(end);
    }
  }
  if (!starts.length || !ends.length) {
    throw inputError('state does not contain a renderable Studio audio timeline');
  }
  const startBeats = Math.min(...starts);
  const endBeats = Math.max(...ends);
  if (!(endBeats > startBeats)) throw inputError('Studio timeline bounds are invalid');
  return { startBeats, endBeats };
}

function clipStatus(clip: any): string {
  return String(clip?.status || clip?.clip?.status || '').trim().toLowerCase();
}

function extractClipId(response: any): string {
  const id = response?.id || response?.clip_id || response?.clip?.id;
  if (typeof id !== 'string' || !id.trim()) throw new Error('Studio render-state returned no clip id');
  return id;
}

function studioMultitrackFingerprint(input: {
  projectId: string;
  title: string;
  state: Record<string, unknown>;
  startBeats: number;
  endBeats: number;
  downbeats: unknown[];
  format: string;
}): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function defaultStudioOutputPath(projectId: string, requestFingerprint: string): string {
  const root = path.resolve(process.env.SUNO_STUDIO_OUTPUT_DIR || path.join(process.cwd(), '.suno-studio-exports'));
  return path.join(root, `studio-${projectId}-${requestFingerprint.slice(0, 16)}.zip`);
}

async function acquireStudioOperationLock(kind: string, fingerprint: string): Promise<() => Promise<void>> {
  const stateRoot = path.resolve(process.env.SUNO_STUDIO_STATE_DIR || path.join(process.cwd(), '.suno-studio-state'));
  const lockRoot = path.join(stateRoot, 'locks');
  const lockPath = path.join(lockRoot, `${kind}-${fingerprint}.lock`);
  await fs.mkdir(lockRoot, { recursive: true, mode: 0o700 });
  try {
    await fs.mkdir(lockPath, { mode: 0o700 });
    await fs.writeFile(path.join(lockPath, 'owner.json'), `${JSON.stringify({
      pid: process.pid,
      created_at: new Date().toISOString(),
      kind,
      fingerprint,
    }, null, 2)}\n`, { mode: 0o600 });
  } catch (error: any) {
    if (error?.code === 'EEXIST') {
      const conflict: any = new Error('Matching Studio operation is already in progress; retry polling/local reuse instead of submitting again');
      conflict.response = { status: 429 };
      throw conflict;
    }
    throw error;
  }
  return async () => {
    // Docker Desktop bind mounts backed by SMB can briefly replace a removed
    // owner file with `.smbdelete*`. Lock cleanup must never turn an otherwise
    // successful render/download response into HTTP 500. Retry the transient
    // ENOTEMPTY state, then leave a bounded warning for manual stale-lock
    // cleanup rather than throwing from the operation's finally block.
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      try {
        await fs.rm(lockPath, { recursive: true, force: true });
        return;
      } catch (error: any) {
        if (error?.code !== 'ENOTEMPTY' || attempt === 20) {
          console.warn(`Studio lock cleanup deferred: kind=${kind} fingerprint=${fingerprint.slice(0, 16)} code=${error?.code || 'unknown'}`);
          return;
        }
        await sleep(0.25);
      }
    }
  };
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = (await import('fs')).createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function command(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileP(command, args, { maxBuffer: 50 * 1024 * 1024 });
  return { stdout: String(result.stdout || ''), stderr: String(result.stderr || '') };
}

async function ffprobeJson(filePath: string): Promise<Record<string, unknown>> {
  const result = await command('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration,size,bit_rate:stream=codec_name,sample_fmt,sample_rate,channels,bits_per_sample',
    '-of', 'json',
    filePath,
  ]);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

async function inspectContainer(filePath: string): Promise<StudioMultitrackIntegrity> {
  const stat = await fs.stat(filePath);
  const result: StudioMultitrackIntegrity = {
    local_path: filePath,
    file_size: stat.size,
    sha256: await hashFile(filePath),
    container: 'unknown',
    container_test: 'not_run',
  };

  const handle = await fs.open(filePath, 'r');
  const magic = Buffer.alloc(4);
  try {
    await handle.read(magic, 0, magic.length, 0);
  } finally {
    await handle.close();
  }

  if (magic[0] === 0x50 && magic[1] === 0x4b) {
    result.container = 'zip';
    try {
      await command('unzip', ['-tq', filePath]);
      const listing = await command('unzip', ['-Z1', filePath]);
      const entries = listing.stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
      const wavEntries = entries.filter((entry) => /\.wav$/i.test(entry));
      result.container_test = 'pass';
      result.entry_count = entries.length;
      result.wav_count = wavEntries.length;

      if (wavEntries.length === 0) {
        throw new Error('Multitrack archive contains no WAV entries');
      }
      const representative = wavEntries[0];
      if (representative) {
        const extractDir = path.join(tmpdir(), `suno-studio-ffprobe-${randomUUID()}`);
        await fs.mkdir(extractDir, { recursive: true });
        try {
          await command('unzip', ['-qq', '-j', filePath, representative, '-d', extractDir]);
          const extracted = path.join(extractDir, path.basename(representative));
          result.representative_wav = await ffprobeJson(extracted);
        } finally {
          await fs.rm(extractDir, { recursive: true, force: true });
        }
      }
    } catch (error: any) {
      result.container_test = 'fail';
      result.error = String(error?.message || error);
      throw Object.assign(new Error(`Multitrack archive integrity check failed: ${result.error}`), { integrity: result });
    }
    return result;
  }

  try {
    result.container = 'audio';
    result.container_test = 'pass';
    result.representative_wav = await ffprobeJson(filePath);
  } catch (error: any) {
    result.container_test = 'fail';
    result.error = String(error?.message || error);
    throw Object.assign(new Error(`Audio container integrity check failed: ${result.error}`), { integrity: result });
  }
  return result;
}

export async function renderStudioExport(api: SunoApi, input: StudioExportRequest): Promise<StudioExportResult> {
  if (!input.studio_project_id?.trim()) {
    throw inputError('studio_project_id is required; do not substitute a Workspace Project ID');
  }
  const studioProjectId = assertUuid(input.studio_project_id, 'studio_project_id');
  if (!input.state || typeof input.state !== 'object' || Array.isArray(input.state)) {
    throw inputError('state is required and must be an object');
  }
  const transport = asTransport(api);
  const exportMode = input.start_beats !== undefined || input.end_beats !== undefined
    ? 'selected_time_range'
    : 'full_song';
  // The current upstream render-state schema requires timeline bounds for both
  // Full Song and Selected Time Range. Preserve the public semantic distinction
  // while deriving Full Song bounds from the exact submitted Studio state.
  const derivedBounds = studioTimelineBounds(input.state);
  const startBeats = numberOrDefault(input.start_beats, derivedBounds.startBeats);
  const endBeats = numberOrDefault(input.end_beats, derivedBounds.endBeats);
  if (!(endBeats > startBeats)) throw inputError('end_beats must be greater than start_beats');
  const payload: Record<string, unknown> = {
    title: input.title || '',
    lyrics: input.lyrics || '',
    state: input.state,
    ...(input.tags !== undefined ? { tags: input.tags } : {}),
    ...(input.negative_tags !== undefined ? { negative_tags: input.negative_tags } : {}),
    ...(input.style_summary !== undefined ? { style_summary: input.style_summary } : {}),
    ...(input.caption !== undefined ? { caption: input.caption } : {}),
    ...(input.workspace_project_id ? { project_id: input.workspace_project_id } : {}),
    studio_project_id: studioProjectId,
    from_studio_project_id: input.from_studio_project_id || studioProjectId,
    ...(input.studio_project_version_id ? { studio_project_version_id: input.studio_project_version_id } : {}),
    start_beats: startBeats,
    end_beats: endBeats,
    downbeats: Array.isArray(input.downbeats) ? input.downbeats : [],
    web_client_pathname: '/studio',
    ...(input.export_mode !== undefined ? { export_mode: input.export_mode } : {}),
    generate_midi_preview: input.generate_midi_preview ?? false,
  };
  const response = await transport.studioRequest<any>({
    method: 'POST',
    endpoint: '/api/studio/render-state',
    data: payload,
    timeout: 30000,
  });
  const clipId = extractClipId(response);
  const result: StudioExportResult = {
    clip_id: clipId,
    export_mode: exportMode,
    status: response?.status,
    render_job: {
      id: response?.id,
      clip_id: response?.clip_id,
      status: response?.status,
      type: response?.type,
    },
  };
  if (input.wait_audio !== false) {
    const polled = await waitForStudioClips(api, [clipId], {
      max_poll_attempts: input.max_poll_attempts,
      poll_interval_seconds: input.poll_interval_seconds,
    });
    result.clip = polled.clips[0];
  }
  return result;
}

export async function renderStudioMultitrack(api: SunoApi, input: StudioMultitrackRequest): Promise<StudioMultitrackResult> {
  if (!input.studio_project_id?.trim()) throw inputError('studio_project_id is required; do not pass a workspace project id here');
  const studioProjectId = assertUuid(input.studio_project_id, 'studio_project_id');
  if (!input.state || typeof input.state !== 'object' || Array.isArray(input.state)) {
    throw inputError('state is required and must be an object');
  }
  const derivedBounds = studioTimelineBounds(input.state);
  const transport = asTransport(api);
  const startBeats = numberOrDefault(input.start_beats, derivedBounds.startBeats);
  const endBeats = numberOrDefault(input.end_beats, derivedBounds.endBeats);
  if (!(endBeats > startBeats)) throw inputError('end_beats must be greater than start_beats');
  const format = String(input.format || 'wav').toLowerCase();
  if (format !== 'wav') throw inputError('Studio Multitrack format is currently verified only for wav');
  const title = String(input.title || 'Studio Multitrack').trim() || 'Studio Multitrack';
  const downbeats = Array.isArray(input.downbeats) ? input.downbeats : [];
  const requestFingerprint = studioMultitrackFingerprint({
    projectId: studioProjectId,
    title,
    state: input.state,
    startBeats,
    endBeats,
    downbeats,
    format,
  });
  const target = path.resolve(input.output_path || defaultStudioOutputPath(studioProjectId, requestFingerprint));
  await fs.mkdir(path.dirname(target), { recursive: true });
  const releaseLock = await acquireStudioOperationLock('multitrack', requestFingerprint);

  try {
    if (input.download !== false && input.force_render !== true) {
      try {
        const integrity = await inspectContainer(target);
        return {
          project_id: studioProjectId,
          start_beats: startBeats,
          end_beats: endBeats,
          format,
          request_fingerprint: requestFingerprint,
          reused: true,
          upstream_submitted: false,
          ...integrity,
        };
      } catch (error: any) {
        if (error?.code !== 'ENOENT') {
          const conflict: any = new Error(`Existing Multitrack archive failed validation; inspect it or use force_render=true: ${target}`);
          conflict.response = { status: 409 };
          throw conflict;
        }
      }
    }

    const response = await transport.studioRequest<any>({
      method: 'POST',
      endpoint: '/api/studio/render-state-multitrack',
      data: {
        title,
        state: input.state,
        start_beats: startBeats,
        end_beats: endBeats,
        project_id: studioProjectId,
        downbeats,
        format,
      },
      timeout: 60000,
    });
    const downloadUrl = response?.download_url;
    if (typeof downloadUrl !== 'string' || !downloadUrl.trim()) throw new Error('render-state-multitrack returned no download_url');
    const resultBase = {
      project_id: studioProjectId,
      start_beats: startBeats,
      end_beats: endBeats,
      format,
      request_fingerprint: requestFingerprint,
      reused: false,
      upstream_submitted: true,
    };
    if (input.download === false) {
      return {
        ...resultBase,
        download_url: downloadUrl,
        download_url_expires: true,
        container: 'unknown',
        container_test: 'not_run',
      };
    }

    const temporary = `${target}.part-${randomUUID()}`;
    try {
      const downloaded = await axios.get(downloadUrl, {
        responseType: 'stream',
        timeout: 20 * 60 * 1000,
        maxContentLength: 1024 * 1024 * 1024,
        maxBodyLength: 1024 * 1024 * 1024,
      });
      await pipeline(downloaded.data, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
    let temporaryIntegrity: StudioMultitrackIntegrity;
    try {
      temporaryIntegrity = await inspectContainer(temporary);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
    let previousArchivePath: string | undefined;
    try {
      await fs.access(target);
      previousArchivePath = `${target}.before-force-${Date.now()}`;
      await fs.rename(target, previousArchivePath);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        await fs.rm(temporary, { force: true });
        throw error;
      }
    }
    try {
      await fs.rename(temporary, target);
    } catch (error) {
      if (previousArchivePath) {
        await fs.rename(previousArchivePath, target).catch(() => {});
      }
      await fs.rm(temporary, { force: true });
      throw error;
    }
    const integrity = { ...temporaryIntegrity, local_path: target };
    return {
      ...resultBase,
      ...(previousArchivePath ? { previous_archive_path: previousArchivePath } : {}),
      ...integrity,
    };
  } finally {
    await releaseLock();
  }
}

export async function waitForStudioClips(
  api: SunoApi,
  clipIds: string[],
  options: {
    max_poll_attempts?: number;
    poll_interval_seconds?: number;
    expected_studio_project_id?: string;
    on_poll?: (clips: AudioInfo[]) => Promise<void> | void;
  } = {},
): Promise<StudioGenerationPollResult> {
  const ids = [...new Set(clipIds.filter(Boolean))];
  if (ids.length === 0) throw new Error('clip_ids is required for polling');
  const maxAttempts = Math.max(1, numberOrDefault(options.max_poll_attempts, DEFAULT_POLL_ATTEMPTS));
  const interval = Math.max(0, numberOrDefault(options.poll_interval_seconds, DEFAULT_POLL_INTERVAL_SECONDS));
  let latest: AudioInfo[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    latest = await api.getFeedByIdsV3(ids, ids.length);
    if (options.on_poll) await options.on_poll(latest);
    const statuses = Object.fromEntries(ids.map((id) => {
      const clip = latest.find((candidate) => candidate.id === id);
      return [id, clipStatus(clip) || 'unknown'];
    }));
    const allTerminal = ids.every((id) => {
      const status = statuses[id];
      return status === 'complete' || TERMINAL_FAILURE_STATUSES.has(status);
    });
    if (allTerminal) {
      const projectInsertion = await observeStudioProjectInsertion(api, ids, options.expected_studio_project_id);
      return {
        clip_ids: ids,
        clips: latest,
        statuses,
        complete: Object.values(statuses).every((status) => status === 'complete'),
        project_insertion: projectInsertion,
      };
    }
    if (attempt < maxAttempts && interval > 0) await sleep(interval);
  }
  const statuses = Object.fromEntries(ids.map((id) => {
    const clip = latest.find((candidate) => candidate.id === id);
    return [id, clipStatus(clip) || 'unknown'];
  }));
  return {
    clip_ids: ids,
    clips: latest,
    statuses,
    complete: false,
    project_insertion: [],
  };
}

export async function submitAndPollStudioGeneration(api: SunoApi, input: StudioGenerationOptions): Promise<{
  submission: StudioGenerationResponse;
  poll?: StudioGenerationPollResult;
}> {
  if (!input.confirm_paid_generation) {
    throw new Error('confirm_paid_generation=true is required for the one-and-only Studio generation submission');
  }
  const submission = await asTransport(api).submitStudioGeneration(input);
  const poll = input.wait_audio === false
    ? undefined
    : await waitForStudioClips(api, submission.clip_ids, input);
  return { submission, poll };
}

export async function observeStudioProjectInsertion(api: SunoApi, clipIds: string[], expectedProjectId?: string) {
  const transport = asTransport(api);
  const observations: Array<{
    clip_id: string;
    expected_studio_project_id?: string;
    observed_project_ids: string[];
    expected_project_observed?: boolean;
  }> = [];
  for (const clipId of clipIds) {
    try {
      const response = await transport.studioRequest<any>({
        method: 'GET',
        endpoint: `/api/studio/clips/${encodeURIComponent(clipId)}/projects`,
        timeout: 15000,
      });
      const projects = Array.isArray(response?.projects) ? response.projects : Array.isArray(response) ? response : [];
      const ids = projects.map((project: any) => project?.id || project?.project_id).filter((id: any): id is string => typeof id === 'string');
      observations.push({
        clip_id: clipId,
        expected_studio_project_id: expectedProjectId,
        observed_project_ids: ids,
        expected_project_observed: expectedProjectId ? ids.includes(expectedProjectId) : undefined,
      });
    } catch {
      observations.push({
        clip_id: clipId,
        expected_studio_project_id: expectedProjectId,
        observed_project_ids: [],
        expected_project_observed: false,
      });
    }
  }
  return observations;
}

export async function getStudioMedia(api: SunoApi, clipId: string, kind: string): Promise<any> {
  const transport = asTransport(api);
  const encoded = encodeURIComponent(assertUuid(clipId, 'clip_id'));
  const endpoints: Record<string, string> = {
    waveform: `/api/gen/${encoded}/waveform-aggregates`,
    downbeats: `/api/gen/${encoded}/downbeats`,
    midi: `/api/gen/${encoded}/midi`,
    aligned_lyrics: `/api/gen/${encoded}/aligned_lyrics/v3`,
    novelty: `/api/gen/${encoded}/novelty-sections`,
    stems: `/api/clip/${encoded}/stems`,
    stems_pages: `/api/clip/${encoded}/stems/pages`,
    projects: `/api/studio/clips/${encoded}/projects`,
  };
  const endpoint = endpoints[kind];
  if (!endpoint) throw new Error(`Unsupported read-only Studio media kind: ${kind}`);
  return transport.studioRequest({ method: 'GET', endpoint, timeout: 30000 });
}

export async function getStudioDownbeatsStreaming(api: SunoApi, clipId: string, body: unknown = {}): Promise<any> {
  const transport = asTransport(api);
  return transport.studioRequest({
    method: 'POST',
    endpoint: `/api/gen/${encodeURIComponent(assertUuid(clipId, 'clip_id'))}/downbeats_streaming/v2`,
    data: body,
    timeout: 60000,
  });
}

export async function listStudioProjects(api: SunoApi, params: Record<string, unknown> = {}): Promise<any> {
  return asTransport(api).studioRequest({ method: 'GET', endpoint: '/api/studio/list-projects', params, timeout: 30000 });
}

export async function getStudioProject(api: SunoApi, projectId: string): Promise<any> {
  return asTransport(api).studioRequest({ method: 'GET', endpoint: `/api/studio/project/${encodeURIComponent(assertUuid(projectId, 'studio_project_id'))}`, timeout: 30000 });
}

export async function getStudioVersions(api: SunoApi, projectId: string): Promise<any> {
  return asTransport(api).studioRequest({
    method: 'GET',
    endpoint: `/api/studio/${encodeURIComponent(assertUuid(projectId, 'studio_project_id'))}/versions`,
    params: { return_days_only: false },
    timeout: 30000,
  });
}

export async function getStudioVersion(api: SunoApi, projectId: string, versionId: string): Promise<any> {
  return asTransport(api).studioRequest({
    method: 'GET',
    endpoint: `/api/studio/${encodeURIComponent(assertUuid(projectId, 'studio_project_id'))}/version/${encodeURIComponent(assertUuid(versionId, 'version_id'))}`,
    timeout: 30000,
  });
}

export async function saveStudioProject(api: SunoApi, payload: Record<string, unknown>): Promise<any> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('save-project payload must be an object');
  if (!payload.state || typeof payload.state !== 'object' || Array.isArray(payload.state)) {
    throw new Error('save-project payload.state is required and must be an object');
  }
  if (typeof payload.project_id !== 'string' || !payload.project_id.trim()) {
    throw new Error('save-project payload.project_id must be the Studio project id');
  }
  // This endpoint's wire field is named project_id, but it is a Studio project
  // identifier. The route adapter prevents Workspace IDs from being substituted.
  return asTransport(api).studioRequest({ method: 'POST', endpoint: '/api/studio/save-project', data: payload, timeout: 60000 });
}

export async function cloneStudioRevision(api: SunoApi, revisionId: string, body: Record<string, unknown> = {}): Promise<any> {
  return asTransport(api).studioRequest({
    method: 'POST',
    endpoint: `/api/studio/project_revision/${encodeURIComponent(assertUuid(revisionId, 'revision_id'))}/clone`,
    data: body,
    timeout: 30000,
  });
}

export async function getStudioRevision(api: SunoApi, revisionId: string): Promise<any> {
  return asTransport(api).studioRequest({
    method: 'GET',
    endpoint: `/api/studio/project_revision/${encodeURIComponent(assertUuid(revisionId, 'revision_id'))}`,
    timeout: 30000,
  });
}

export async function studioProjectMutation(api: SunoApi, projectId: string, action: 'archive' | 'unarchive' | 'bookmark' | 'metadata', body: Record<string, unknown> = {}): Promise<any> {
  const suffix = action === 'metadata' ? 'metadata' : action;
  return asTransport(api).studioRequest({
    method: 'POST',
    endpoint: `/api/studio/project/${encodeURIComponent(assertUuid(projectId, 'studio_project_id'))}/${suffix}`,
    data: body,
    timeout: 30000,
  });
}
