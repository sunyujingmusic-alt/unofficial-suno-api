import axios, { AxiosInstance, AxiosProxyConfig } from 'axios';
import * as cookie from 'cookie';
import { createHash, randomUUID } from 'crypto';
import { createReadStream, createWriteStream, promises as fs } from 'fs';
import { execFile as execFileCallback } from 'child_process';
import path from 'path';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';
import { logger, sleep } from '@/lib/utils';
import { downloadSongAutoStems, type SongStemsRequest } from '@/lib/stemsBrowser';
import {
  buildHCaptchaRequestParams,
  buildTurnstileTask,
  captchaProviderForVersion,
  clientIdentityHeaders,
  normalizeCaptchaVersion,
  parseSharedCaptchaProxy,
  type CaptchaProvider,
  type CaptchaVersion,
} from '@/lib/captchaContext';

const execFile = promisify(execFileCallback);

export const DEFAULT_MODEL = 'chirp-fenix';  // V5.5 browser-captured default model as of 2026-04-08

export function getDefaultWorkspaceName(): string {
  const configured = (
    process.env.SUNO_DEFAULT_WORKSPACE ||
    process.env.SUNO_DEFAULT_PROJECT_NAME ||
    ''
  ).trim();
  return configured || 'SunoApi';
}

export function getDefaultOutputRoot(): string {
  const configured = (
    process.env.SUNO_OUTPUT_DIR ||
    process.env.SUNO_OUTPUT_ROOT ||
    ''
  ).trim();
  return configured || path.resolve(process.cwd(), 'output');
}

export function getDefaultAccountArchiveRoot(): string {
  const configured = (process.env.SUNO_ACCOUNT_ARCHIVE_DIR || '').trim();
  return configured || path.resolve(getDefaultOutputRoot(), 'suno-account-archive');
}

export interface CreditsInfo {
  credits_left: number;
  period?: string;
  monthly_limit?: number;
  monthly_usage?: number;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  shared?: boolean;
  is_trashed?: boolean;
}

export interface CreatePrecheckResult {
  required: boolean;
  captcha_version: CaptchaVersion;
  captcha_provider: CaptchaProvider;
  solved?: boolean;
  solver_ready?: boolean;
  ready_for_create?: boolean;
  verification_status?: 'not_required' | 'pending_create';
  context_binding?: {
    api_version: 'v1' | 'v2';
    task_type: 'TurnstileTask' | 'TurnstileTaskProxyless' | 'HCaptchaLegacy';
    user_agent_bound: boolean;
    shared_proxy: boolean;
    challenge_parameters: string[];
  };
}

export interface AudioInfo {
  id: string;
  title?: string;
  image_url?: string;
  audio_url?: string;
  wav_file_url?: string;
  video_url?: string;
  created_at?: string;
  model_name?: string;
  status?: string;
  gpt_description_prompt?: string;
  prompt?: string;
  type?: string;
  tags?: string;
  negative_tags?: string;
  duration?: number;
  lyric?: string;
  mp3_path?: string;
  wav_path?: string;
  project_id?: string;
  project_name?: string;
  project_assigned?: boolean;
  project_error?: string;
  raw?: any;
}

export interface CreateAndDownloadResult {
  song_ids: string[];
  output_dir: string;
  clips: AudioInfo[];
}

export interface UploadReferenceOptions {
  audio_url?: string;
  source_buffer?: Buffer;
  content_type?: string;
  upload_filename?: string;
  extension?: string;
  is_stem_mix?: boolean;
  upload_type?: string;
  initialize_clip?: boolean;
  wait_upload?: boolean;
  poll_interval_seconds?: number;
  max_poll_attempts?: number;
  title?: string;
  lyrics?: string;
  project_id?: string;
  project_name?: string;
}

export interface UploadReferenceResult {
  upload_id: string;
  status: string;
  title?: string;
  image_url?: string;
  has_vocal?: boolean;
  error_message?: string;
  clip_id?: string;
  clip?: any;
  project_id?: string;
  project_name?: string;
  project_assigned?: boolean;
  project_error?: string;
}

export interface CoverGenerateOptions {
  cover_clip_id: string;
  persona_id?: string;
  lyrics: string;
  style: string;
  title: string;
  negative_tags?: string;
  make_instrumental?: boolean;
  model?: string;
  wait_audio?: boolean;
  vocal_gender?: 'm' | 'f';
  style_weight?: number;
  weirdness_constraint?: number;
  audio_weight?: number;
  project_id?: string;
  project_name?: string;
  force_workspace_assignment?: boolean;
}

export interface ExtendAudioOptions {
  audio_id: string;
  prompt?: string;
  continue_at?: number;
  tags?: string;
  negative_tags?: string;
  title?: string;
  model?: string;
  wait_audio?: boolean;
  project_id?: string;
  project_name?: string;
  force_workspace_assignment?: boolean;
}

export interface MashupGenerateOptions {
  mashup_clip_ids: string[];
  lyrics?: string;
  style?: string;
  title?: string;
  negative_tags?: string;
  make_instrumental?: boolean;
  model?: string;
  wait_audio?: boolean;
  vocal_gender?: 'm' | 'f';
  style_weight?: number;
  weirdness_constraint?: number;
  audio_weight?: number;
  project_id?: string;
  project_name?: string;
  force_workspace_assignment?: boolean;
}

export interface CreateOptions {
  project_id?: string;
  project_name?: string;
  prompt?: string;
  tags?: string;
  title?: string;
  negative_tags?: string;
  make_instrumental?: boolean;
  model?: string;
  wait_audio?: boolean;
  create_mode?: 'custom' | 'prompt';
  task?: string;
  cover_clip_id?: string;
  persona_id?: string;
  continue_clip_id?: string;
  continue_at?: number;
  mashup_clip_ids?: string[];
  vocal_gender?: 'm' | 'f';
  style_weight?: number;
  weirdness_constraint?: number;
  audio_weight?: number;
}

export interface StudioConcatClipInput {
  clip_id?: string;
  clipId?: string;
  id?: string;
  title?: string;
  duration?: number;
  duration_seconds?: number;
  durationSeconds?: number;
  order?: number;
  transposition?: number;
  skipped?: boolean;
}

export interface StudioConcatOptions {
  clips: StudioConcatClipInput[];
  title?: string;
  lyrics?: string;
  tags?: string;
  negative_tags?: string;
  style_summary?: string;
  caption?: string;
  transposition?: number;
  tail_pad_seconds?: number;
  wait_audio?: boolean;
  max_poll_attempts?: number;
  poll_interval_seconds?: number;
}

export interface StudioConcatResult {
  clip_id: string;
  title: string;
  timeline: {
    start_beats: number;
    end_beats: number;
    content_end_beats: number;
    content_duration_seconds: number;
    tail_pad_seconds: number;
    bps: number;
    track_count: number;
    clip_count: number;
  };
  render_job: any;
  clip?: any;
}

export interface StudioGenerationRequest {
  mode: 'instrument' | 'cover';
  workspace_project_id: string;
  studio_project_id?: string;
  studio_project_version_id?: string;
  stem_condition_clip_id: string;
  cover_clip_id?: string;
  cover_start_s?: number;
  cover_end_s?: number;
  title?: string;
  tags?: string;
  prompt?: string;
  negative_tags?: string;
  model?: string;
  make_instrumental?: boolean;
  stem_control_tags: string;
  disable_volume_normalization?: boolean;
  vocal_gender?: string;
  batch_size?: number;
}

export interface StudioGenerationResponse {
  clip_ids: string[];
  status?: string;
  response: any;
}

export type AccountArchiveFormat = 'mp3' | 'wav';

export type AccountArchiveStopReason =
  | 'end_of_feed'
  | 'target_complete_reached'
  | 'limit_reached'
  | 'max_pages_reached'
  | 'missing_cursor'
  | 'cursor_loop';

export interface AccountArchiveFileIntegrity {
  size_bytes: number;
  sha256: string;
  content_type?: string;
  content_length?: number;
  verified_at: string;
  probe?: {
    available: boolean;
    ok: boolean;
    format_name?: string;
    duration_seconds?: number;
    error_code?: string;
  };
}

export interface ListAccountClipsOptions {
  cursor?: string;
  page_size?: number;
  limit?: number;
  target_complete?: number;
  max_pages?: number;
  filters?: Record<string, any>;
}

export interface AccountClipListResult {
  clips: AudioInfo[];
  pages: number;
  page_size: number;
  requested_limit?: number;
  target_complete?: number;
  complete_clip_count: number;
  skipped_incomplete_count: number;
  next_cursor?: string;
  has_more: boolean;
  complete: boolean;
  account_scan_complete: boolean;
  stop_reason: AccountArchiveStopReason;
  filters: Record<string, any>;
}

export interface ArchiveAccountOptions extends ListAccountClipsOptions {
  output_dir?: string;
  formats?: AccountArchiveFormat[];
  dry_run?: boolean;
  resume?: boolean;
  skip_existing?: boolean;
  include_incomplete?: boolean;
  download_covers?: boolean;
  wav_poll_interval_seconds?: number;
  wav_max_poll_attempts?: number;
  concurrency?: number;
  recover_stale_lock?: boolean;
  max_run_history?: number;
  on_progress?: (event: AccountArchiveProgressEvent) => void | Promise<void>;
}

export interface AccountArchiveProgressEvent {
  type:
    | 'listed'
    | 'clip_start'
    | 'clip_skip'
    | 'mp3_downloaded'
    | 'wav_downloaded'
    | 'cover_downloaded'
    | 'clip_done'
    | 'clip_error';
  clip_id?: string;
  index?: number;
  total?: number;
  message?: string;
  path?: string;
  error?: string;
}

export interface AccountArchiveEntry {
  id: string;
  title?: string;
  status?: string;
  created_at?: string;
  model_name?: string;
  duration?: number;
  suno_page_url?: string;
  suno_source?: 'suno' | 'suno_studio';
  metadata_path?: string;
  mp3_path?: string;
  wav_path?: string;
  cover_path?: string;
  cover_existing?: boolean;
  cover_downloaded?: boolean;
  cover_planned?: boolean;
  mp3_integrity?: AccountArchiveFileIntegrity;
  wav_integrity?: AccountArchiveFileIntegrity;
  cover_integrity?: AccountArchiveFileIntegrity;
  stage_timings_ms?: Record<string, number>;
  retry_counts?: Record<string, number>;
  requested_formats: AccountArchiveFormat[];
  completed_formats: AccountArchiveFormat[];
  downloaded_formats: AccountArchiveFormat[];
  existing_formats: AccountArchiveFormat[];
  planned_formats: AccountArchiveFormat[];
  archive_status: 'completed' | 'partial' | 'failed' | 'skipped' | 'planned';
  first_seen_at?: string;
  last_seen_at?: string;
  last_attempted_at?: string;
  last_success_at?: string;
  skipped?: boolean;
  skip_reason?: string;
  errors: Array<{ format?: AccountArchiveFormat | 'cover' | 'metadata'; message: string }>;
}

export interface AccountArchiveRunSummary {
  run_id: string;
  started_at: string;
  completed_at?: string;
  dry_run: boolean;
  resume: boolean;
  redownload: boolean;
  formats: AccountArchiveFormat[];
  listed_count: number;
  downloaded_mp3: number;
  downloaded_wav: number;
  downloaded_covers: number;
  existing_mp3: number;
  existing_wav: number;
  existing_covers: number;
  skipped: number;
  failed: number;
  target_complete?: number;
  completed_count?: number;
  listing_complete: boolean;
  stop_reason: AccountArchiveStopReason;
  concurrency: number;
}

export interface AccountArchiveResult {
  run_id: string;
  output_dir: string;
  manifest_path: string;
  run_report_path: string;
  started_at: string;
  completed_at?: string;
  listed_count: number;
  downloaded_mp3: number;
  downloaded_wav: number;
  downloaded_covers: number;
  existing_mp3: number;
  existing_wav: number;
  existing_covers: number;
  skipped: number;
  failed: number;
  target_complete?: number;
  completed_count: number;
  concurrency: number;
  max_run_history: number;
  dry_run: boolean;
  resume: boolean;
  redownload: boolean;
  formats: AccountArchiveFormat[];
  listing: AccountClipListResult;
  entries: AccountArchiveEntry[];
}

function resolveProxyUrl(): string | undefined {
  return (
    process.env.SUNO_CREATE_CAPTCHA_SHARED_PROXY_URL ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.ALL_PROXY ||
    undefined
  );
}

function buildAxiosProxyConfig(proxyUrl?: string): AxiosProxyConfig | undefined {
  if (!proxyUrl) return undefined;
  try {
    const parsed = new URL(proxyUrl);
    if (!/^https?:$/i.test(parsed.protocol)) return undefined;
    return {
      protocol: parsed.protocol.replace(':', ''),
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80,
      auth: parsed.username
        ? {
            username: decodeURIComponent(parsed.username),
            password: decodeURIComponent(parsed.password),
          }
        : undefined,
    };
  } catch {
    return undefined;
  }
}

function proxyUrlForLog(proxyUrl?: string): string {
  if (!proxyUrl) return 'none';
  try {
    const parsed = new URL(proxyUrl);
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
  } catch {
    return 'configured-invalid-url';
  }
}

function resolveModelAlias(model?: string): string {
  return (model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

function inferExtensionFromMimeType(contentType?: string): string | undefined {
  const normalized = String(contentType || '').toLowerCase();
  if (!normalized) return undefined;
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3';
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('x-m4a') || normalized.includes('m4a') || normalized.includes('mp4')) return 'm4a';
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('flac')) return 'flac';
  if (normalized.includes('aac')) return 'aac';
  return undefined;
}

function buildPathTimestamp(date: Date = new Date(), timeZone: string = process.env.SUNO_OUTPUT_TIMEZONE || 'Asia/Shanghai'): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return `${byType.year}${byType.month}${byType.day}${byType.hour}${byType.minute}${byType.second}`;
}

const STUDIO_TIMELINE_BPS = 2;
const STUDIO_DEFAULT_TAIL_PAD_SECONDS = 3;
const STUDIO_DEFAULT_RENDER_POLL_ATTEMPTS = 90;
const STUDIO_DEFAULT_RENDER_POLL_INTERVAL_SECONDS = 3;
const ACCOUNT_ARCHIVE_DEFAULT_CONCURRENCY = 1;
const ACCOUNT_ARCHIVE_MAX_CONCURRENCY = 3;
const ACCOUNT_ARCHIVE_DEFAULT_MAX_RUN_HISTORY = 100;
const ACCOUNT_ARCHIVE_DEFAULT_LOCK_STALE_SECONDS = 2 * 60 * 60;
const ACCOUNT_ARCHIVE_MAX_DOWNLOAD_ATTEMPTS = 4;
interface NormalizedStudioConcatClip {
  clipId: string;
  title?: string;
  durationSeconds: number;
  order: number;
  transposition: number;
  skipped: boolean;
}

interface StudioTimelineClip {
  type: 'audio';
  id: string;
  streaming: boolean;
  name: string;
  color: string;
  transposition: number;
  amplitude: number;
  startBeats: number;
  endBeats: number;
  readStartBeats: number;
  fadeInBeats: number;
  fadeOutBeats: number;
  fadeInCurve: number;
  fadeOutCurve: number;
  mute: boolean;
  reversed: boolean;
  loop: {
    enabled: boolean;
    startBeats: number;
    endBeats: number;
  };
  warp: {
    enabled: boolean;
    markers: Record<string, number>;
    awaitingAnalysis: boolean;
  };
  asset: {
    type: 'clip';
    id: string;
  };
  clipId: string;
  uploadId: null;
}

interface StudioTimelineTrack {
  type: 'audio';
  id: string;
  input: null;
  color: string;
  name: string;
  clips: StudioTimelineClip[];
  clipCreationIntents: any[];
  height: number;
  solo: boolean;
  mute: boolean;
  arm: boolean;
  amplitude: number;
  balance: number;
  instrument: { type: 'song' };
  soloTakeLaneId: null;
  takeLanesExpanded: boolean;
  takeLanes: any[];
  eq: any;
  signalChain: any[];
  routingMode: 'linear';
  faderAutomation: Record<string, never>;
}

interface StudioTimelineState {
  amplitude: number;
  sections: Record<string, never>;
  lyricsCorrectionsByClipId: Record<string, never>;
  metronome: { enabled: boolean; amplitude: number };
  timing: { type: 'manual'; bps: number; bpsAutomation: any[]; firstBeatSeconds: number };
  timeSignatureChanges: Array<{ startBeats: number; subdivisionsPerBar: number; beatsPerSubdivision: number }>;
  tracks: StudioTimelineTrack[];
  selection: any;
  loop: { enabled: boolean; startBeats: number; endBeats: number };
  songFadeInBeats: number;
  songFadeOutBeats: number;
  layout: any;
  editorPointerModes: { audio: 'select'; midi: 'select' };
  masterSignalChain: any[];
  masterRoutingMode: 'linear';
  routing: Record<string, never>;
  markersRegistry: Record<string, Record<string, number>>;
}

interface BuiltStudioTimeline {
  title: string;
  state: StudioTimelineState;
  startBeats: number;
  endBeats: number;
  contentEndBeats: number;
}

export class SunoApi {
  private summarizeToken(token?: string | null): string {
    if (!token) return 'none';
    const hash = createHash('sha256').update(token).digest('hex').slice(0, 12);
    return `len=${token.length},sha256=${hash}`;
  }

  private static BASE_URL = 'https://studio-api.prod.suno.com';
  private static STUDIO_BASE_URL = 'https://studio-api-prod.suno.com';
  private static CLERK_BASE_URL = 'https://clerk.suno.com';
  private static CLERK_VERSION = '5.15.0';
  private static POLL_REQUEST_TIMEOUT_MS = 15000;
  private static WAIT_AUDIO_INITIAL_DELAY_SECONDS = 90;
  private static WAIT_AUDIO_POLL_INTERVAL_SECONDS = 15;
  private static WAIT_AUDIO_MAX_POLLS = 10;

  private readonly client: AxiosInstance;
  private readonly cookies: Record<string, string | undefined>;
  private readonly deviceId: string;
  private sid?: string;
  private currentToken?: string;
  private clerkTokenCachedAt = 0;
  private readonly clerkTokenTTLMs = 4 * 60 * 1000;
  private sessionTokenCachedAt = 0;
  private cachedSessionToken?: string;
  private readonly sessionTokenTTLMs = 30 * 60 * 1000;
  private userTierCachedAt = 0;
  private cachedUserTier?: string;
  private readonly userTierTTLMs = 60 * 60 * 1000;
  private createCaptchaToken?: string;
  private createCaptchaTokenCachedAt = 0;
  private createCaptchaTaskId?: number;
  private createCaptchaUserAgent?: string;
  private createCaptchaTaskType?: 'TurnstileTask' | 'TurnstileTaskProxyless' | 'HCaptchaLegacy';
  private createCaptchaApiVersion?: 'v1' | 'v2';
  private createCaptchaVersion?: CaptchaVersion;
  private createCaptchaProvider?: CaptchaProvider;
  private createCaptchaSharedProxy = false;
  private createCaptchaChallengeParameters: string[] = [];
  private readonly createCaptchaTokenTTLMs = 50 * 1000; // challenge token is short-lived; keep cache conservative
  private readonly baseClientIdentity: ReturnType<typeof clientIdentityHeaders>;

  constructor(rawCookies?: string) {
    const cookieSource = rawCookies && rawCookies.trim() ? rawCookies : (process.env.SUNO_COOKIE || '');
    this.cookies = cookie.parse(cookieSource);
    this.deviceId = this.cookies.suno_device_id || this.cookies.ajs_anonymous_id || randomUUID();
    const proxyUrl = resolveProxyUrl();
    const axiosProxy = buildAxiosProxyConfig(proxyUrl);
    const baseUserAgent = process.env.SUNO_CLIENT_USER_AGENT || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
    this.baseClientIdentity = clientIdentityHeaders(baseUserAgent);

    if (proxyUrl) {
      logger.info(`SunoApi proxy enabled: ${proxyUrlForLog(proxyUrl)}`);
    }

    this.client = axios.create({
      withCredentials: true,
      proxy: axiosProxy,
      headers: {
        'Affiliate-Id': 'undefined',
        'Device-Id': this.deviceId,
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': process.env.SUNO_CLIENT_ACCEPT_LANGUAGE || 'zh-CN,zh;q=0.9,en;q=0.8',
        Origin: 'https://suno.com',
        Referer: 'https://suno.com/',
        'sec-ch-ua': process.env.SUNO_CLIENT_SEC_CH_UA || this.baseClientIdentity['sec-ch-ua'],
        'sec-ch-ua-mobile': this.baseClientIdentity['sec-ch-ua-mobile'],
        'sec-ch-ua-platform': this.baseClientIdentity['sec-ch-ua-platform'],
        'User-Agent': this.baseClientIdentity['User-Agent'],
      },
    });



    this.client.interceptors.request.use((config) => {
      if (this.currentToken && !config.headers.Authorization) {
        config.headers.Authorization = `Bearer ${this.currentToken}`;
      }
      // 构建 cookie，包含 __client_uat 动态时间戳
      const cookieEntries = Object.entries(this.cookies).filter(([, value]) => value !== undefined);
      // 添加 __client_uat（当前 Unix 时间戳）
      cookieEntries.push(['__client_uat', Math.floor(Date.now() / 1000).toString()]);
      config.headers.Cookie = cookieEntries
        .map(([key, value]) => cookie.serialize(key, value as string))
        .join('; ');

      const url = String(config.url || '');
      // 所有 Suno API 请求都带动态 Browser-Token（包括 c/check）
      // 与今天上午手动 Create 的记录一致
      if (url.includes(SunoApi.BASE_URL) || url.includes(SunoApi.STUDIO_BASE_URL)) {
        config.headers['Browser-Token'] = this.buildBrowserTokenHeader();
      }
      if (!config.headers['Device-Id']) {
        config.headers['Device-Id'] = this.deviceId;
      }
      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const status = error?.response?.status;
        const url = error?.config?.url || '';
        if (
          status === 401
          && (String(url).includes(SunoApi.BASE_URL) || String(url).includes(SunoApi.STUDIO_BASE_URL))
        ) {
          this.currentToken = undefined;
          this.clerkTokenCachedAt = 0;
        }
        return Promise.reject(error);
      }
    );
  }

  async init(): Promise<SunoApi> {
    await this.getAuthToken();
    await this.keepAlive();
    return this;
  }

  private buildBrowserTokenHeader(): string {
    const encoded = Buffer.from(JSON.stringify({ timestamp: Date.now() })).toString('base64url');
    return JSON.stringify({ token: encoded });
  }

  private async getAuthToken(): Promise<void> {
    logger.info('Getting the session ID');
    const response = await this.client.get(
      `${SunoApi.CLERK_BASE_URL}/v1/client?_is_native=true&_clerk_js_version=${SunoApi.CLERK_VERSION}`,
      {
        headers: { Authorization: this.cookies.__client },
        timeout: 30000,
      }
    );
    const sid = response?.data?.response?.last_active_session_id;
    if (!sid) {
      throw new Error('Failed to get session id, you may need to update SUNO_COOKIE');
    }
    this.sid = sid;
  }

  async keepAlive(forceRefresh: boolean = false): Promise<void> {
    if (!this.sid) throw new Error('Session ID is not set.');
    const age = Date.now() - this.clerkTokenCachedAt;
    if (!forceRefresh && this.currentToken && age < this.clerkTokenTTLMs) {
      return;
    }
    logger.info('KeepAlive...\n');
    const response = await this.client.post(
      `${SunoApi.CLERK_BASE_URL}/v1/client/sessions/${this.sid}/tokens?_is_native=true&_clerk_js_version=${SunoApi.CLERK_VERSION}`,
      {},
      {
        headers: { Authorization: this.cookies.__client },
        timeout: 30000,
      }
    );
    this.currentToken = response.data.jwt;
    this.clerkTokenCachedAt = Date.now();
  }

  /**
   * Authenticated direct HTTP primitive used only by fixed Studio adapters.
   * Public API callers cannot choose an arbitrary upstream host or path.
   */
  async studioRequest<T = any>(input: {
    method: 'GET' | 'POST';
    endpoint: string;
    data?: unknown;
    params?: Record<string, unknown>;
    timeout?: number;
  }): Promise<T> {
    if (!/^\/api\/[a-zA-Z0-9_./?=-]+$/.test(input.endpoint)) {
      throw new Error('Studio endpoint must be a safe /api/ relative path');
    }
    await this.keepAlive(false);
    const baseUrl = String(process.env.SUNO_STUDIO_DIRECT_BASE_URL || SunoApi.BASE_URL).replace(/\/+$/, '');
    const response = await this.client.request<T>({
      method: input.method,
      url: `${baseUrl}${input.endpoint}`,
      data: input.data,
      params: input.params,
      timeout: input.timeout ?? 30000,
    });
    return response.data;
  }

  private async getSessionToken(): Promise<string> {
    let lastError: any;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const response = await this.client.post(
          `${SunoApi.BASE_URL}/api/user/create_session_id/`,
          {
            session_properties: JSON.stringify({ deviceId: this.deviceId }),
            session_type: 1,
          },
          { timeout: 30000 }
        );
        const sessionId = response?.data?.session_id;
        if (!sessionId) throw new Error('create_session_id returned no session_id');
        return sessionId;
      } catch (error: any) {
        lastError = error;
        const status = error?.response?.status;
        if ((status === 502 || status === 503 || status === 504) && attempt < 5) {
          await sleep(attempt * 2);
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  private async getCreateUserTier(): Promise<string | undefined> {
    const envTier = (process.env.SUNO_CREATE_USER_TIER || '').trim();
    if (envTier) return envTier;
    if (this.cachedUserTier && (Date.now() - this.userTierCachedAt) < this.userTierTTLMs) {
      return this.cachedUserTier;
    }
    try {
      const response = await this.client.get(`${SunoApi.BASE_URL}/api/billing/info/`, { timeout: 30000 });
      const data = response.data || {};
      const tier = data.user_tier || data.tier || data.subscription_product_id || data.subscription_id || data.plan_id || undefined;
      if (tier) {
        this.cachedUserTier = tier;
        this.userTierCachedAt = Date.now();
      }
      return tier;
    } catch {
      return undefined;
    }
  }

  private async buildCreateMetadata(createMode: 'custom' | 'prompt'): Promise<Record<string, any>> {
    if (!this.cachedSessionToken || (Date.now() - this.sessionTokenCachedAt) > this.sessionTokenTTLMs) {
      this.cachedSessionToken = await this.getSessionToken();
      this.sessionTokenCachedAt = Date.now();
    }
    return {
      web_client_pathname: '/create',
      is_max_mode: false,
      is_mumble: false,
      create_mode: createMode,
      user_tier: await this.getCreateUserTier(),
      create_session_token: this.cachedSessionToken,
      disable_volume_normalization: false,
    };
  }

  async createPrecheck(traceId?: string, solveChallenge: boolean = true): Promise<CreatePrecheckResult> {
    await this.keepAlive(false);
    const url = `${SunoApi.BASE_URL}/api/c/check`;
    logger.info('c/check URL: ' + url + (traceId ? ` [trace=${traceId}]` : ''));

    const response = await this.client.post(
      url,
      { ctype: 'generation' },
      { timeout: 30000 }
    );
    logger.info('c/check response: ' + JSON.stringify(response.data).slice(0, 200) + (traceId ? ` [trace=${traceId}]` : ''));
    const required = Boolean(response?.data?.required);
    const captchaVersion = normalizeCaptchaVersion(response?.data?.captcha_version);
    const captchaProvider = captchaProviderForVersion(captchaVersion);

    // 显式 create 前置链：
    // 1) 先跑 /api/c/check
    // 2) required=false → 直接进入 create
    // 3) required=true  → 尝试获取 create body 所需的 captcha token，供随后的 create() 复用
    if (required) {
      if (!solveChallenge) {
        return {
          required: true,
          captcha_version: captchaVersion,
          captcha_provider: captchaProvider,
          solved: false,
          solver_ready: false,
          ready_for_create: false,
          verification_status: 'pending_create',
        };
      }
      await this.solveCreateCaptcha(captchaVersion, traceId);
      return {
        required: true,
        captcha_version: captchaVersion,
        captcha_provider: captchaProvider,
        solved: true,
        solver_ready: true,
        ready_for_create: true,
        verification_status: 'pending_create',
        context_binding: {
          api_version: this.createCaptchaApiVersion || 'v1',
          task_type: this.createCaptchaTaskType || 'HCaptchaLegacy',
          user_agent_bound: Boolean(this.createCaptchaUserAgent),
          shared_proxy: this.createCaptchaSharedProxy,
          challenge_parameters: this.createCaptchaChallengeParameters,
        },
      };
    }

    // No challenge required — clear any stale cached token to prevent it from
    // being accidentally reused in the next create() call (Suno rejects stale tokens)
    this.clearCreateCaptchaContext();
    this.applyClientIdentity(this.baseClientIdentity);
    return {
      required: false,
      captcha_version: captchaVersion,
      captcha_provider: captchaProvider,
      solved: false,
      solver_ready: false,
      ready_for_create: true,
      verification_status: 'not_required',
    };
  }

  private applyClientIdentity(headers: ReturnType<typeof clientIdentityHeaders>): void {
    const common = this.client.defaults.headers.common as Record<string, string>;
    common['User-Agent'] = headers['User-Agent'];
    common['sec-ch-ua'] = headers['sec-ch-ua'];
    common['sec-ch-ua-mobile'] = headers['sec-ch-ua-mobile'];
    common['sec-ch-ua-platform'] = headers['sec-ch-ua-platform'];
  }

  private clearCreateCaptchaContext(): void {
    this.createCaptchaToken = undefined;
    this.createCaptchaTokenCachedAt = 0;
    this.createCaptchaTaskId = undefined;
    this.createCaptchaUserAgent = undefined;
    this.createCaptchaTaskType = undefined;
    this.createCaptchaApiVersion = undefined;
    this.createCaptchaVersion = undefined;
    this.createCaptchaProvider = undefined;
    this.createCaptchaSharedProxy = false;
    this.createCaptchaChallengeParameters = [];
  }

  private async solveTurnstileV2(
    apiKey: string,
    sitekey: string,
    pageurl: string,
    traceId?: string
  ): Promise<void> {
    const sharedProxy = parseSharedCaptchaProxy(process.env.SUNO_CREATE_CAPTCHA_SHARED_PROXY_URL);
    const action = (process.env.SUNO_CREATE_CAPTCHA_ACTION || '').trim() || undefined;
    const data = (process.env.SUNO_CREATE_CAPTCHA_CDATA || '').trim() || undefined;
    const pagedata = (process.env.SUNO_CREATE_CAPTCHA_PAGEDATA || '').trim() || undefined;
    const task = buildTurnstileTask({ websiteURL: pageurl, websiteKey: sitekey, action, data, pagedata, sharedProxy });
    const taskType = task.type as 'TurnstileTask' | 'TurnstileTaskProxyless';

    const createResponse = await axios.post(
      'https://api.2captcha.com/createTask',
      { clientKey: apiKey, task },
      { proxy: false, timeout: 35000 }
    );
    if (createResponse.data?.errorId) {
      throw new Error(`CAPTCHA_SOLVE_FAILED: 2Captcha createTask ${createResponse.data.errorCode || createResponse.data.errorDescription || createResponse.data.errorId}`);
    }

    const taskId = Number(createResponse.data?.taskId);
    if (!Number.isFinite(taskId) || taskId <= 0) {
      throw new Error('CAPTCHA_SOLVE_FAILED: 2Captcha createTask returned no taskId');
    }

    logger.info('2Captcha v2 task submitted: ' + JSON.stringify({
      task_id: taskId,
      task_type: taskType,
      shared_proxy: Boolean(sharedProxy),
      challenge_parameters: [action && 'action', data && 'cData', pagedata && 'chlPageData'].filter(Boolean),
      trace_id: traceId || null,
    }));

    const startedAt = Date.now();
    while (Date.now() - startedAt < 120 * 1000) {
      await sleep(5);
      const result = await axios.post(
        'https://api.2captcha.com/getTaskResult',
        { clientKey: apiKey, taskId },
        { proxy: false, timeout: 35000 }
      );
      if (result.data?.errorId) {
        throw new Error(`CAPTCHA_SOLVE_FAILED: 2Captcha getTaskResult ${result.data.errorCode || result.data.errorDescription || result.data.errorId}`);
      }
      if (result.data?.status === 'processing') continue;
      if (result.data?.status !== 'ready') {
        throw new Error(`CAPTCHA_SOLVE_FAILED: unexpected 2Captcha status ${String(result.data?.status)}`);
      }

      const token = String(result.data?.solution?.token || '').trim();
      const userAgent = String(result.data?.solution?.userAgent || '').trim();
      if (!token) throw new Error('CAPTCHA_SOLVE_FAILED: 2Captcha returned no Turnstile token');
      if (!userAgent) throw new Error('CAPTCHA_CONTEXT_INCOMPLETE: 2Captcha returned no userAgent');

      const identity = clientIdentityHeaders(userAgent);
      this.applyClientIdentity(identity);
      this.createCaptchaToken = token;
      this.createCaptchaTokenCachedAt = Date.now();
      this.createCaptchaTaskId = taskId;
      this.createCaptchaUserAgent = userAgent;
      this.createCaptchaTaskType = taskType;
      this.createCaptchaApiVersion = 'v2';
      this.createCaptchaVersion = 2;
      this.createCaptchaProvider = 'turnstile';
      this.createCaptchaSharedProxy = Boolean(sharedProxy);
      this.createCaptchaChallengeParameters = [action && 'action', data && 'cData', pagedata && 'chlPageData'].filter(Boolean) as string[];
      logger.info('Create captcha context ready: ' + JSON.stringify({
        task_id: taskId,
        task_type: taskType,
        token_summary: this.summarizeToken(token),
        user_agent_sha256: createHash('sha256').update(userAgent).digest('hex').slice(0, 12),
        shared_proxy: Boolean(sharedProxy),
        task_request_ip_sha256: result.data?.ip
          ? createHash('sha256').update(String(result.data.ip)).digest('hex').slice(0, 12)
          : null,
        trace_id: traceId || null,
      }));
      return;
    }

    throw new Error('CAPTCHA_SOLVE_FAILED: 2Captcha v2 solve timeout after 120s');
  }

  private async solveHCaptchaV1(
    apiKey: string,
    sitekey: string,
    pageurl: string,
    traceId?: string
  ): Promise<void> {
    const sharedProxy = parseSharedCaptchaProxy(process.env.SUNO_CREATE_CAPTCHA_SHARED_PROXY_URL);
    const rqdata = (process.env.SUNO_CREATE_HCAPTCHA_RQDATA || '').trim() || undefined;
    const apiDomain = (process.env.SUNO_CREATE_HCAPTCHA_API_DOMAIN || '').trim() || undefined;
    const userAgent = this.baseClientIdentity['User-Agent'];
    const params = buildHCaptchaRequestParams({
      apiKey,
      websiteURL: pageurl,
      websiteKey: sitekey,
      userAgent,
      rqdata,
      apiDomain,
      sharedProxy,
    });

    this.applyClientIdentity(this.baseClientIdentity);
    const submitResponse = await axios.get('https://2captcha.com/in.php', {
      params,
      proxy: false,
      timeout: 35000,
    });
    const submitData = typeof submitResponse.data === 'string'
      ? JSON.parse(submitResponse.data)
      : submitResponse.data;
    if (Number(submitData?.status) !== 1) {
      throw new Error(`CAPTCHA_SOLVE_FAILED: 2Captcha hCaptcha submit ${submitData?.request || 'unknown error'}`);
    }

    const taskId = Number(submitData.request);
    if (!Number.isFinite(taskId) || taskId <= 0) {
      throw new Error('CAPTCHA_SOLVE_FAILED: 2Captcha hCaptcha submit returned no task id');
    }
    const challengeParameters = [
      'captcha_version=1',
      'invisible',
      rqdata && 'rqdata',
      apiDomain && 'api_domain',
    ].filter(Boolean) as string[];
    logger.info('2Captcha hCaptcha task submitted: ' + JSON.stringify({
      task_id: taskId,
      task_type: 'HCaptchaLegacy',
      user_agent_sha256: createHash('sha256').update(userAgent).digest('hex').slice(0, 12),
      shared_proxy: Boolean(sharedProxy),
      challenge_parameters: challengeParameters,
      trace_id: traceId || null,
    }));

    const startedAt = Date.now();
    while (Date.now() - startedAt < 120 * 1000) {
      await sleep(5);
      const pollResponse = await axios.get('https://2captcha.com/res.php', {
        params: { key: apiKey, action: 'get', id: taskId, json: 1 },
        proxy: false,
        timeout: 35000,
      });
      const result = typeof pollResponse.data === 'string'
        ? JSON.parse(pollResponse.data)
        : pollResponse.data;
      if (Number(result?.status) === 1) {
        const token = String(result.request || '').trim();
        if (!token) throw new Error('CAPTCHA_SOLVE_FAILED: 2Captcha returned no hCaptcha token');
        this.createCaptchaToken = token;
        this.createCaptchaTokenCachedAt = Date.now();
        this.createCaptchaTaskId = taskId;
        this.createCaptchaUserAgent = userAgent;
        this.createCaptchaTaskType = 'HCaptchaLegacy';
        this.createCaptchaApiVersion = 'v1';
        this.createCaptchaVersion = 1;
        this.createCaptchaProvider = 'hcaptcha';
        this.createCaptchaSharedProxy = Boolean(sharedProxy);
        this.createCaptchaChallengeParameters = challengeParameters;
        logger.info('Create hCaptcha context ready: ' + JSON.stringify({
          task_id: taskId,
          token_summary: this.summarizeToken(token),
          user_agent_sha256: createHash('sha256').update(userAgent).digest('hex').slice(0, 12),
          shared_proxy: Boolean(sharedProxy),
          trace_id: traceId || null,
        }));
        return;
      }
      if (String(result?.request) !== 'CAPCHA_NOT_READY') {
        throw new Error(`CAPTCHA_SOLVE_FAILED: 2Captcha hCaptcha poll ${result?.request || 'unknown error'}`);
      }
    }

    throw new Error('CAPTCHA_SOLVE_FAILED: 2Captcha hCaptcha solve timeout after 120s');
  }

  private async reportIncorrectCaptcha(reason: string): Promise<void> {
    const taskId = this.createCaptchaTaskId;
    const apiKey = process.env.TWOCAPTCHA_API_KEY;
    if (!taskId || !apiKey) return;
    try {
      if (this.createCaptchaApiVersion === 'v1') {
        const response = await axios.get('https://2captcha.com/res.php', {
          params: { key: apiKey, action: 'reportbad', id: taskId, json: 1 },
          proxy: false,
          timeout: 30000,
        });
        logger.warn('Reported rejected hCaptcha solution to 2Captcha: ' + JSON.stringify({
          task_id: taskId,
          status: response.data?.status ?? null,
          reason,
        }));
        return;
      }
      const response = await axios.post(
        'https://api.2captcha.com/reportIncorrect',
        { clientKey: apiKey, taskId },
        { proxy: false, timeout: 30000 }
      );
      logger.warn('Reported rejected captcha solution to 2Captcha: ' + JSON.stringify({
        task_id: taskId,
        status: response.data?.status || null,
        error_id: response.data?.errorId || 0,
        reason,
      }));
    } catch (error: any) {
      logger.warn('Failed to report rejected captcha solution: ' + String(error?.message || error));
    }
  }

  /**
   * 通过 2Captcha 获取 create 阶段所需的 captcha token。
   * Suno captcha_version=1 means hCaptcha and version=2 means Turnstile.
   */
  private async solveCreateCaptcha(captchaVersion: CaptchaVersion, traceId?: string): Promise<void> {
    const now = Date.now();
    if (
      this.createCaptchaToken
      && this.createCaptchaVersion === captchaVersion
      && (now - this.createCaptchaTokenCachedAt) < this.createCaptchaTokenTTLMs
    ) {
      logger.info('Using cached create captcha token (age: ' + Math.round((now - this.createCaptchaTokenCachedAt) / 1000) + 's, ' + this.summarizeToken(this.createCaptchaToken) + ')' + (traceId ? ` [trace=${traceId}]` : ''));
      return;
    }

    this.clearCreateCaptchaContext();

    const apiKey = process.env.TWOCAPTCHA_API_KEY;
    const captchaProvider = captchaProviderForVersion(captchaVersion);
    const configuredMethod = (process.env.SUNO_CREATE_CAPTCHA_METHOD || 'auto').trim().toLowerCase();
    const pageurl = (process.env.SUNO_CREATE_CAPTCHA_PAGEURL || process.env.HCAPTCHA_PAGEURL || 'https://suno.com/create').trim();

    if (!apiKey) {
      logger.error('2Captcha API key not found in environment (TWOCAPTCHA_API_KEY)');
      throw new Error('CAPTCHA_SOLVE_FAILED: 2Captcha API key not configured');
    }

    if (!['auto', 'hcaptcha', 'turnstile'].includes(configuredMethod)) {
      throw new Error(`CAPTCHA_SOLVE_FAILED: unsupported SUNO_CREATE_CAPTCHA_METHOD=${configuredMethod}`);
    }
    if (configuredMethod !== 'auto' && configuredMethod !== captchaProvider) {
      logger.warn('Ignoring CAPTCHA method override that conflicts with c/check: ' + JSON.stringify({
        configured_method: configuredMethod,
        captcha_version: captchaVersion,
        resolved_provider: captchaProvider,
        trace_id: traceId || null,
      }));
    }

    if (captchaVersion === 2) {
      const sitekey = (
        process.env.SUNO_CREATE_TURNSTILE_SITEKEY
        || process.env.SUNO_CREATE_CAPTCHA_SITEKEY
        || '0x4AAAAAADI7xDNyj-3LcIbi'
      ).trim();
      await this.solveTurnstileV2(apiKey, sitekey, pageurl, traceId);
      return;
    }

    const hcaptchaTokenMode = (process.env.SUNO_CREATE_HCAPTCHA_TOKEN_MODE || 'browser').trim().toLowerCase();
    if (hcaptchaTokenMode !== 'legacy') {
      const browserRequired: any = new Error(
        'BROWSER_CAPTCHA_REQUIRED: Suno captcha_version=1 is an in-page hCaptcha image challenge; solve and submit it in the same browser context.'
      );
      browserRequired.response = { status: 409 };
      throw browserRequired;
    }

    const sitekey = (
      process.env.SUNO_CREATE_HCAPTCHA_SITEKEY
      || process.env.HCAPTCHA_SITEKEY
      || 'd65453de-3f1a-4aac-9366-a0f06e52b2ce'
    ).trim();
    await this.solveHCaptchaV1(apiKey, sitekey, pageurl, traceId);
  }

  async getCredits(): Promise<CreditsInfo> {
    await this.keepAlive(false);
    const response = await this.client.get(`${SunoApi.BASE_URL}/api/billing/info/`, { timeout: 30000 });
    const data = response.data || {};
    return {
      credits_left: data.credits_left ?? data.total_credits_left,
      period: data.period,
      monthly_limit: data.monthly_limit,
      monthly_usage: data.monthly_usage,
    };
  }

  async listWorkspaces(showTrashed: boolean = false): Promise<WorkspaceInfo[]> {
    await this.keepAlive(false);
    const workspaces: WorkspaceInfo[] = [];
    let page = 1;
    let total = Number.POSITIVE_INFINITY;

    while ((page - 1) * 25 < total) {
      const response = await this.client.get(`${SunoApi.BASE_URL}/api/project/me`, {
        params: { show_trashed: showTrashed, page, query: '' },
        timeout: 10000,
      });
      const data = response.data || {};
      const projects = Array.isArray(data.projects) ? data.projects : [];
      total = Number(data.num_total_results ?? projects.length);
      if (projects.length === 0) break;
      for (const project of projects) {
        if (project?.id && project?.name) {
          workspaces.push({
            id: project.id,
            name: project.name,
            shared: project.shared,
            is_trashed: project.is_trashed,
          });
        }
      }
      const currentPage = Number(data.current_page ?? page);
      if (currentPage >= Number(data.total_pages ?? currentPage)) break;
      page = currentPage + 1;
    }

    return workspaces;
  }

  async resolveWorkspace(target?: { project_id?: string; project_name?: string }): Promise<WorkspaceInfo | null> {
    if (!target?.project_id && !target?.project_name) return null;
    const workspaces = await this.listWorkspaces(false);
    if (target.project_id) {
      const byId = workspaces.find((w) => w.id === target.project_id);
      if (byId) return byId;
    }
    if (target.project_name) {
      const normalized = target.project_name.trim().toLowerCase();
      const byName = workspaces.find((w) => w.name.trim().toLowerCase() === normalized);
      if (byName) return byName;
    }
    return null;
  }

  async createStudioProject(title?: string): Promise<WorkspaceInfo> {
    await this.keepAlive(false);
    const response = await this.client.post(
      `${SunoApi.BASE_URL}/api/studio/create-project`,
      {},
      {
        params: title ? { title } : undefined,
        timeout: 10000,
      }
    );
    const data = response.data || {};
    return {
      id: data.id || data.project_id || data.project?.id,
      name: data.name || data.title || data.project?.name || title || 'untitled',
      shared: data.shared,
      is_trashed: data.is_trashed,
    };
  }

  async ensureWorkspace(targetName?: string): Promise<WorkspaceInfo | null> {
    if (!targetName) return null;
    const existing = await this.resolveWorkspace({ project_name: targetName });
    if (existing) return existing;
    return await this.createStudioProject(targetName);
  }

  async addClipToWorkspace(clipId: string, workspaceId: string): Promise<boolean> {
    await this.keepAlive(false);
    const response = await this.client.post(
      `${SunoApi.BASE_URL}/api/project/${workspaceId}/clips`,
      {
        update_type: 'add',
        metadata: {
          clip_ids: [clipId],
        },
      },
      {
        timeout: 10000,
      }
    );
    return response.status >= 200 && response.status < 300;
  }

  private extractWavUrl(audio: any): string | undefined {
    return (
      audio?.wav_file_url ||
      audio?.wav_audio_url ||
      audio?.song_paths?.wav ||
      audio?.file_urls?.wav ||
      audio?.metadata?.wav_file_url ||
      audio?.metadata?.song_paths?.wav ||
      undefined
    );
  }

  private mapClip(audio: any): AudioInfo {
    return {
      id: audio.id,
      title: audio.title,
      image_url: audio.image_url,
      audio_url: audio.audio_url,
      wav_file_url: this.extractWavUrl(audio),
      video_url: audio.video_url,
      created_at: audio.created_at,
      model_name: audio.model_name,
      status: audio.status,
      gpt_description_prompt: audio.metadata?.gpt_description_prompt,
      prompt: audio.metadata?.prompt,
      type: audio.metadata?.type,
      tags: audio.metadata?.tags,
      negative_tags: audio.metadata?.negative_tags,
      duration: audio.metadata?.duration,
      lyric: audio.metadata?.prompt,
      raw: audio,
    };
  }

  async getClip(clipId: string): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/clip/${clipId}`,
      {
        timeout: 15000,
      }
    );
    return response.data;
  }

  private isTransientHttpError(error: any): boolean {
    const status = Number(error?.response?.status || 0);
    const code = String(error?.code || '');
    const message = String(error?.message || '').toLowerCase();
    return [408, 425, 429, 500, 502, 503, 504].includes(status)
      || ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNABORTED'].includes(code)
      || message.includes('timeout');
  }

  private async studioRequestWithRetry<T>(
    label: string,
    operation: () => Promise<T>,
    maxAttempts: number = 4,
  ): Promise<T> {
    let lastError: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.keepAlive(attempt > 1);
        return await operation();
      } catch (error: any) {
        lastError = error;
        const status = Number(error?.response?.status || 0);
        const retryable = status === 401 || this.isTransientHttpError(error);
        logger.warn(`${label} failed: ` + JSON.stringify({
          attempt,
          maxAttempts,
          status,
          code: error?.code || null,
          retryable,
        }));
        if (!retryable || attempt >= maxAttempts) throw error;
        if (status === 401) {
          this.currentToken = undefined;
          this.clerkTokenCachedAt = 0;
        }
        const retryAfter = Number(error?.response?.headers?.['retry-after']);
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter, 30)
          : Math.min(12, attempt * attempt));
      }
    }
    throw lastError || new Error(`${label} failed without a captured error`);
  }

  async getStudioProject(studioProjectId: string): Promise<any> {
    const projectId = String(studioProjectId || '').trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(projectId)) {
      throw new Error('studio_project_id must be a UUID');
    }
    return await this.studioRequestWithRetry('get Studio project', async () => {
      const response = await this.client.get(
        `${SunoApi.STUDIO_BASE_URL}/api/studio/project/${projectId}`,
        { timeout: 30000 },
      );
      return response.data;
    });
  }

  async renderStudioMultitrack(request: Record<string, unknown>): Promise<any> {
    return await this.studioRequestWithRetry('render Studio Multitrack', async () => {
      const response = await this.client.post(
        `${SunoApi.STUDIO_BASE_URL}/api/studio/render-state-multitrack`,
        request,
        { timeout: 60000 },
      );
      return response.data;
    });
  }

  async getSongStemsPages(clipIdInput: string): Promise<number> {
    const clipId = String(clipIdInput || '').trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(clipId)) {
      throw new Error('clip_id must be a UUID');
    }
    return await this.studioRequestWithRetry('get Song stems page count', async () => {
      const response = await this.client.get(
        `${SunoApi.STUDIO_BASE_URL}/api/clip/${clipId}/stems/pages`,
        { timeout: 30000 },
      );
      const pages = Number(response.data?.pages ?? 0);
      return Number.isInteger(pages) && pages > 0 ? pages : 0;
    });
  }

  async getSongStemsPage(clipIdInput: string, pageInput: number): Promise<any[]> {
    const clipId = String(clipIdInput || '').trim().toLowerCase();
    const page = Number(pageInput);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(clipId)) {
      throw new Error('clip_id must be a UUID');
    }
    if (!Number.isInteger(page) || page < 0) throw new Error('page must be a non-negative integer');
    return await this.studioRequestWithRetry('get Song stems page', async () => {
      const response = await this.client.get(
        `${SunoApi.STUDIO_BASE_URL}/api/clip/${clipId}/stems`,
        { params: { page }, timeout: 30000 },
      );
      return Array.isArray(response.data?.stems) ? response.data.stems : [];
    });
  }

  async generateSongAutoStems(
    clipIdInput: string,
    titleInput?: string,
    transactionUuidInput?: string,
  ): Promise<any> {
    const clipId = String(clipIdInput || '').trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(clipId)) {
      throw new Error('clip_id must be a UUID');
    }
    await this.keepAlive(false);
    const metadata = await this.buildCreateMetadata('custom');
    metadata.web_client_pathname = `/song/${clipId}`;
    metadata.is_remix = true;
    const transactionUuid = String(transactionUuidInput || randomUUID()).trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(transactionUuid)) {
      throw new Error('transaction_uuid must be a UUID');
    }
    const payload = {
      token: null,
      task: 'gen_stem',
      generation_type: 'TEXT',
      title: String(titleInput || 'Untitled'),
      tags: '',
      negative_tags: '',
      mv: 'chirp-v3-0',
      prompt: '',
      make_instrumental: true,
      user_uploaded_images_b64: null,
      metadata,
      override_fields: [],
      cover_clip_id: null,
      cover_start_s: null,
      cover_end_s: null,
      persona_id: null,
      artist_clip_id: null,
      artist_start_s: null,
      artist_end_s: null,
      continue_clip_id: clipId,
      continued_aligned_prompt: null,
      continue_at: null,
      stem_type_id: 91,
      stem_type_group_name: 'Twelve',
      stem_task: 'twelve',
      transaction_uuid: transactionUuid,
      token_provider: null,
    };
    const response = await this.client.post(
      `${SunoApi.STUDIO_BASE_URL}/api/generate/v2-web/`,
      payload,
      { timeout: 45000 },
    );
    return {
      transaction_uuid: transactionUuid,
      clips: Array.isArray(response.data?.clips) ? response.data.clips : [],
      raw: response.data,
    };
  }

  async uploadReferenceAudio(options: UploadReferenceOptions): Promise<UploadReferenceResult> {
    await this.keepAlive(false);

    const audioUrl = options.audio_url?.trim();
    const sourceBuffer = options.source_buffer;
    if (!audioUrl && !sourceBuffer) {
      throw new Error('audio_url or source_buffer is required');
    }

    let uploadBuffer = sourceBuffer;
    let extension = options.extension?.trim().replace(/^\./, '').toLowerCase();
    let inferredContentType = options.content_type;

    if (!uploadBuffer && audioUrl) {
      const response = await axios.get<ArrayBuffer>(audioUrl, {
        responseType: 'arraybuffer',
        timeout: 120000,
        proxy: false,
      });
      uploadBuffer = Buffer.from(response.data);
      inferredContentType = inferredContentType || String(response.headers['content-type'] || '');
      if (!extension) {
        try {
          const extFromUrl = path.extname(new URL(audioUrl).pathname).replace('.', '').toLowerCase();
          if (extFromUrl) extension = extFromUrl;
        } catch {
        }
      }
    }

    if (!uploadBuffer) {
      throw new Error('Failed to load upload source');
    }

    if (!extension && options.upload_filename) {
      const extFromFilename = path.extname(options.upload_filename).replace('.', '').toLowerCase();
      if (extFromFilename) extension = extFromFilename;
    }
    if (!extension) {
      extension = inferExtensionFromMimeType(inferredContentType) || 'mp3';
    }

    const uploadFilename = options.upload_filename || `upload-${Date.now()}.${extension}`;

    const slotResp = await this.client.post(
      `${SunoApi.BASE_URL}/api/uploads/audio/`,
      {
        extension,
        is_stem_mix: Boolean(options.is_stem_mix),
      },
      {
        timeout: 10000,
      }
    );

    const slot = slotResp.data || {};
    const uploadId = slot.id as string | undefined;
    const uploadUrl = slot.url as string | undefined;
    const uploadFields = slot.fields as Record<string, string> | undefined;
    if (!uploadId || !uploadUrl || !uploadFields) {
      throw new Error('Failed to get upload slot from Suno API');
    }

    const form = new FormData();
    Object.entries(uploadFields).forEach(([key, value]) => {
      form.append(key, String(value));
    });
    const blob = new Blob([new Uint8Array(uploadBuffer)], {
      type: inferredContentType || `audio/${extension}`,
    });
    form.append('file', blob, uploadFilename);

    const storageResp = await fetch(uploadUrl, {
      method: 'POST',
      body: form,
    });
    if (!storageResp.ok) {
      throw new Error(`Failed to upload file to storage: ${storageResp.status}`);
    }

    await this.client.post(
      `${SunoApi.BASE_URL}/api/uploads/audio/${uploadId}/upload-finish/`,
      {
        upload_type: options.upload_type || 'audio_upload',
        upload_filename: uploadFilename,
      },
      {
        timeout: 10000,
      }
    );

    const maxPollAttempts = options.max_poll_attempts ?? 75;
    const pollIntervalSeconds = options.poll_interval_seconds ?? 4;
    const waitUpload = options.wait_upload !== false;

    let uploadStatusData: any = null;
    if (waitUpload) {
      for (let i = 0; i < maxPollAttempts; i++) {
        const statusResp = await this.client.get(
          `${SunoApi.BASE_URL}/api/uploads/audio/${uploadId}/`,
          { timeout: 10000 }
        );
        uploadStatusData = statusResp.data;
        if (uploadStatusData?.status === 'complete' || uploadStatusData?.status === 'error') {
          break;
        }
        await sleep(pollIntervalSeconds);
      }
    } else {
      const statusResp = await this.client.get(
        `${SunoApi.BASE_URL}/api/uploads/audio/${uploadId}/`,
        { timeout: 10000 }
      );
      uploadStatusData = statusResp.data;
    }

    if (!uploadStatusData) {
      throw new Error('Failed to fetch upload status');
    }
    if (uploadStatusData.status !== 'complete' && uploadStatusData.status !== 'error') {
      throw new Error('Audio processing timed out. Please try again.');
    }

    const result: UploadReferenceResult = {
      upload_id: uploadId,
      status: uploadStatusData.status,
      title: uploadStatusData.title || undefined,
      image_url: uploadStatusData.image_url || undefined,
      has_vocal: uploadStatusData.has_vocal || false,
      error_message: uploadStatusData.error_message || undefined,
    };

    if (uploadStatusData.status !== 'complete') {
      return result;
    }

    if (options.initialize_clip !== false) {
      const initResp = await this.client.post(
        `${SunoApi.BASE_URL}/api/uploads/audio/${uploadId}/initialize-clip/`,
        {},
        { timeout: 10000 }
      );
      const clipId = initResp.data?.clip_id as string | undefined;
      if (clipId) {
        result.clip_id = clipId;

        if (options.title || options.lyrics) {
          await this.client.post(
            `${SunoApi.BASE_URL}/api/gen/${clipId}/set_metadata/`,
            {
              title: options.title,
              lyrics: options.lyrics,
              is_audio_upload_tos_accepted: true,
            },
            { timeout: 10000 }
          );
        }

        try {
          result.clip = await this.getClip(clipId);
        } catch {
        }
      }
    }

    if (options.project_id || options.project_name) {
      try {
        if (!result.clip_id) {
          throw new Error('Clip is not initialized; set initialize_clip=true to assign workspace');
        }
        const workspace = options.project_id
          ? await this.resolveWorkspace({ project_id: options.project_id })
          : await this.ensureWorkspace(options.project_name);
        if (!workspace) {
          throw new Error(`Workspace not found: ${options.project_name || options.project_id}`);
        }
        const assigned = await this.addClipToWorkspace(result.clip_id, workspace.id);
        result.project_id = workspace.id;
        result.project_name = workspace.name;
        result.project_assigned = assigned;
      } catch (error: any) {
        result.project_assigned = false;
        result.project_error = error?.message || String(error);
      }
    }

    return result;
  }

  private classifyPollError(error: any): { status: number; code?: string; message: string; retryable: boolean } {
    const status = Number(error?.response?.status || 0);
    const code = typeof error?.code === 'string' ? error.code : undefined;
    const message = String(error?.message || error);
    const retryable =
      [408, 425, 429].includes(status) ||
      (status >= 500 && status <= 599) ||
      ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT'].includes(code || '') ||
      code === 'ECONNABORTED' ||
      /timeout|temporar(?:y|ily)|cloudflare|rate limit/i.test(message);

    return { status, code, message, retryable };
  }

  private retryDelaySeconds(error: any, attempt: number): number {
    const retryAfter = error?.response?.headers?.['retry-after'];
    const parsedRetryAfter = Number(retryAfter);
    if (Number.isFinite(parsedRetryAfter) && parsedRetryAfter > 0) {
      return Math.min(parsedRetryAfter, 120);
    }
    return Math.min(30, 2 ** Math.max(0, attempt - 1)) + Math.random() * 0.5;
  }

  private async waitBeforeRetry(stage: string, error: any, attempt: number): Promise<void> {
    const classified = this.classifyPollError(error);
    const delaySeconds = this.retryDelaySeconds(error, attempt);
    logger.warn('suno retry scheduled: ' + JSON.stringify({
      stage,
      attempt,
      status: classified.status,
      code: classified.code,
      delay_seconds: Number(delaySeconds.toFixed(2)),
    }));
    await sleep(delaySeconds);
  }

  private async withRetry<T>(
    stage: string,
    operation: () => Promise<T>,
    maxAttempts: number = ACCOUNT_ARCHIVE_MAX_DOWNLOAD_ATTEMPTS,
  ): Promise<{ value: T; attempts: number }> {
    let lastError: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return { value: await operation(), attempts: attempt };
      } catch (error: any) {
        lastError = error;
        if (!this.classifyPollError(error).retryable || attempt >= maxAttempts) {
          throw error;
        }
        await this.waitBeforeRetry(stage, error, attempt);
      }
    }
    throw lastError || new Error(`${stage} failed without a captured error`);
  }

  private async keepAliveForPoll(attempt: number): Promise<void> {
    try {
      await this.keepAlive(attempt > 1);
    } catch (error: any) {
      const classified = this.classifyPollError(error);
      logger.warn('poll keepAlive failed: ' + JSON.stringify({
        attempt,
        status: classified.status,
        code: classified.code,
        retryable: classified.retryable,
        message: classified.message,
      }));
      throw error;
    }
  }

  async getFeedByIdsV3(clipIds: string[], limit?: number): Promise<AudioInfo[]> {
    const maxAttempts = 3;
    const expectedCount = limit ?? clipIds.length;
    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.keepAliveForPoll(attempt);
        const response = await this.client.post(
          `${SunoApi.BASE_URL}/api/feed/v3`,
          {
            filters: {
              ids: {
                presence: 'True',
                clipIds,
              },
            },
            limit: expectedCount,
          },
          { timeout: SunoApi.POLL_REQUEST_TIMEOUT_MS }
        );
        const clips = (response.data?.clips || []).map((audio: any) => this.mapClip(audio));
        logger.info('feed/v3 poll result: ' + JSON.stringify({
          attempt,
          expectedCount,
          returnedCount: clips.length,
          statuses: clips.map((audio: AudioInfo) => ({ id: audio.id, status: audio.status })),
        }));

        if (clips.length === 0 && clipIds.length > 0 && attempt < maxAttempts) {
          logger.warn('feed/v3 poll returned zero clips; retrying with same ids');
          await sleep(attempt);
          continue;
        }

        return clips;
      } catch (error: any) {
        lastError = error;
        const classified = this.classifyPollError(error);
        logger.warn('feed/v3 poll failed: ' + JSON.stringify({
          attempt,
          status: classified.status,
          code: classified.code,
          retryable: classified.retryable,
          message: classified.message,
        }));
        if (!classified.retryable || attempt >= maxAttempts) {
          throw error;
        }
        try {
          await this.keepAliveForPoll(attempt + 1);
        } catch {
          // The next attempt will refresh again. Keep polling alive through transient Clerk/Suno 5xx.
        }
        await this.waitBeforeRetry('feed_by_ids', error, attempt);
      }
    }

    throw lastError || new Error('feed/v3 poll failed without a captured error');
  }

  private accountFeedFilters(options: ListAccountClipsOptions): Record<string, any> {
    return { ...(options.filters || {}) };
  }

  async listAccountClips(options: ListAccountClipsOptions = {}): Promise<AccountClipListResult> {
    const pageSize = Math.min(Math.max(Number(options.page_size || 50), 1), 100);
    const requestedLimit = Number(options.limit || 0) > 0 ? Number(options.limit) : undefined;
    const targetComplete = Number(options.target_complete || 0) > 0 ? Number(options.target_complete) : undefined;
    const maxPages = Math.min(Math.max(Number(options.max_pages || 200), 1), 1000);
    const filters = this.accountFeedFilters(options);
    const clips: AudioInfo[] = [];
    const seenClipIds = new Set<string>();
    const seenCursors = new Set<string>();
    let cursor = options.cursor?.trim() || undefined;
    let nextCursor: string | undefined;
    let hasMore = false;
    let stopReason: AccountArchiveStopReason = 'end_of_feed';
    let pages = 0;
    let reachedRequestedBoundary = false;

    while (
      pages < maxPages &&
      (!requestedLimit || clips.length < requestedLimit) &&
      (!targetComplete || clips.filter((clip) => String(clip.status || '').toLowerCase() === 'complete').length < targetComplete)
    ) {
      const limit = requestedLimit ? Math.min(pageSize, requestedLimit - clips.length) : pageSize;
      const response = await this.listAccountClipsPage({
        cursor,
        limit,
        filters,
      });
      pages += 1;

      const rawClips = Array.isArray(response?.clips)
        ? response.clips
        : Array.isArray(response?.items)
          ? response.items
          : Array.isArray(response?.results)
            ? response.results
            : [];

      for (const raw of rawClips) {
        const mapped = this.mapClip(raw);
        if (!mapped.id || seenClipIds.has(mapped.id)) continue;
        seenClipIds.add(mapped.id);
        clips.push(mapped);
        const completeClipCount = clips.filter((clip) => String(clip.status || '').toLowerCase() === 'complete').length;
        if (
          (requestedLimit && clips.length >= requestedLimit) ||
          (targetComplete && completeClipCount >= targetComplete)
        ) {
          reachedRequestedBoundary = true;
          break;
        }
      }

      nextCursor = (
        response?.next_cursor ||
        response?.nextCursor ||
        response?.pagination?.next_cursor ||
        response?.pagination?.nextCursor ||
        undefined
      );
      hasMore = Boolean(response?.has_more ?? response?.hasMore ?? nextCursor);

      if (!hasMore) {
        stopReason = 'end_of_feed';
        break;
      }
      if (!nextCursor) {
        stopReason = 'missing_cursor';
        break;
      }
      if (seenCursors.has(nextCursor)) {
        stopReason = 'cursor_loop';
        break;
      }
      if (targetComplete && clips.filter((clip) => String(clip.status || '').toLowerCase() === 'complete').length >= targetComplete) {
        stopReason = 'target_complete_reached';
        break;
      }
      if (requestedLimit && clips.length >= requestedLimit) {
        stopReason = 'limit_reached';
        break;
      }

      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }

    if (pages >= maxPages && hasMore) {
      stopReason = 'max_pages_reached';
    } else if (reachedRequestedBoundary && stopReason === 'end_of_feed' && hasMore) {
      stopReason = targetComplete ? 'target_complete_reached' : 'limit_reached';
    }

    const completeClipCount = clips.filter((clip) => String(clip.status || '').toLowerCase() === 'complete').length;
    const skippedIncompleteCount = clips.length - completeClipCount;
    const accountScanComplete = !hasMore && stopReason === 'end_of_feed';
    return {
      clips,
      pages,
      page_size: pageSize,
      requested_limit: requestedLimit,
      target_complete: targetComplete,
      complete_clip_count: completeClipCount,
      skipped_incomplete_count: skippedIncompleteCount,
      next_cursor: nextCursor,
      has_more: hasMore,
      complete: accountScanComplete,
      account_scan_complete: accountScanComplete,
      stop_reason: stopReason,
      filters,
    };
  }

  private async listAccountClipsPage(input: {
    cursor?: string;
    limit: number;
    filters: Record<string, any>;
  }): Promise<any> {
    const maxAttempts = 3;
    let lastError: any;
    const body: Record<string, any> = {
      limit: input.limit,
      filters: input.filters,
    };
    if (input.cursor) {
      body.cursor = input.cursor;
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.keepAliveForPoll(attempt);
        const response = await this.client.post(
          `${SunoApi.BASE_URL}/api/feed/v3`,
          body,
          { timeout: SunoApi.POLL_REQUEST_TIMEOUT_MS }
        );
        return response.data || {};
      } catch (error: any) {
        lastError = error;
        const classified = this.classifyPollError(error);
        logger.warn('account feed page failed: ' + JSON.stringify({
          attempt,
          status: classified.status,
          code: classified.code,
          retryable: classified.retryable,
          message: classified.message,
        }));
        if (!classified.retryable || attempt >= maxAttempts) {
          throw error;
        }
        await this.waitBeforeRetry('account_feed_page', error, attempt);
      }
    }

    throw lastError || new Error('account feed page failed without a captured error');
  }

  async create(options: CreateOptions): Promise<AudioInfo[]> {
    await this.keepAlive(false);
    const requestedWorkspaceName = (options.project_name || '').trim() || getDefaultWorkspaceName();
    const workspace = options.project_id
      ? await this.resolveWorkspace({ project_id: options.project_id })
      : await this.ensureWorkspace(requestedWorkspaceName);

    if (!workspace?.id && !options.project_id) {
      throw new Error(`Failed to resolve workspace for create request (requested workspace: ${requestedWorkspaceName}). Refusing to fall back silently to My Workspace.`);
    }

    const createMode = options.create_mode || 'custom';

    // 显式 create 前置链：先 /api/c/check，再按 required 分流。
    // 在真实 create 所在的同一实例中做 precheck + captcha solve，避免跨请求 token 丢失。
    const createTraceId = randomUUID().slice(0, 8);
    const precheck = await this.createPrecheck(createTraceId);
    const createToken = this.createCaptchaToken || null;
    if (precheck.required && !createToken) {
      throw new Error('Create challenge required before generate, but no captcha token is cached after precheck solve.');
    }
    const metadata = await this.buildCreateMetadata(createMode);
    const controlSliders: Record<string, number> = {};
    if (options.style_weight !== undefined) {
      controlSliders.style_weight = options.style_weight;
    }
    if (options.weirdness_constraint !== undefined) {
      controlSliders.weirdness_constraint = options.weirdness_constraint;
    }
    if (options.audio_weight !== undefined) {
      controlSliders.audio_weight = options.audio_weight;
    }
    if (Object.keys(controlSliders).length > 0) {
      metadata.control_sliders = controlSliders;
    }
    if (options.vocal_gender) {
      metadata.vocal_gender = options.vocal_gender;
    }

    const payload: any = {
      project_id: workspace?.id || options.project_id,
      token: createToken,
      generation_type: 'TEXT',
      title: createMode === 'custom' ? (options.title || '') : '',
      tags: createMode === 'custom' ? (options.tags || '') : undefined,
      negative_tags: options.negative_tags || '',
      mv: resolveModelAlias(options.model),
      prompt: createMode === 'custom' ? (options.prompt || '') : '',
      gpt_description_prompt: createMode === 'prompt' ? (options.prompt || '') : undefined,
      make_instrumental: Boolean(options.make_instrumental),
      user_uploaded_images_b64: null,
      metadata,
      override_fields: [],
      task: options.task || null,
      cover_clip_id: options.cover_clip_id || null,
      cover_start_s: null,
      cover_end_s: null,
      persona_id: options.persona_id || null,
      artist_clip_id: null,
      artist_start_s: null,
      artist_end_s: null,
      continue_clip_id: options.continue_clip_id || null,
      continued_aligned_prompt: null,
      continue_at: options.continue_at ?? null,
      transaction_uuid: randomUUID(),
    };

    if (options.mashup_clip_ids) {
      payload.mashup_clip_ids = options.mashup_clip_ids;
    }

    if (options.task === 'cover' || options.task === 'vox_cover') {
      if (!options.cover_clip_id) {
        throw new Error('cover_clip_id is required for cover generation');
      }
    }
    if (options.task === 'mashup_condition' && options.mashup_clip_ids?.length !== 2) {
      throw new Error('mashup_clip_ids must contain exactly two clip IDs');
    }

    logger.info('generateSongs summary: ' + JSON.stringify({
      isCustom: createMode === 'custom',
      title: options.title,
      hasPrompt: Boolean(options.prompt),
      hasTags: Boolean(options.tags),
      make_instrumental: Boolean(options.make_instrumental),
      wait_audio: Boolean(options.wait_audio),
      requested_workspace_name: requestedWorkspaceName,
      resolved_workspace_id: workspace?.id || null,
      resolved_workspace_name: workspace?.name || null,
      project_id: payload.project_id,
      hasToken: Boolean(payload.token),
      token_summary: this.summarizeToken(createToken),
      token_age_ms: createToken ? (Date.now() - this.createCaptchaTokenCachedAt) : null,
      mv: payload.mv,
      task: payload.task,
      mashup_clip_count: options.mashup_clip_ids?.length || 0,
      precheck_required: precheck.required,
      precheck_solved: Boolean(precheck.solved),
      precheck_ready_for_create: Boolean(precheck.ready_for_create),
      captcha_version: precheck.captcha_version,
      captcha_provider: precheck.captcha_provider,
      captcha_task_type: this.createCaptchaTaskType || null,
      trace_id: createTraceId,
    }));

    logger.info('Sending create request to /api/generate/v2-web/... [trace=' + createTraceId + ']');
    let response;
    try {
      response = await this.client.post(
        `${SunoApi.BASE_URL}/api/generate/v2-web/`,
        payload,
        { timeout: 30000 }
      );
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.response?.data?.message || error?.response?.data?.error || error?.message || String(error);
      logger.error('Create request failed: ' + JSON.stringify({
        trace_id: createTraceId,
        status: error?.response?.status || null,
        detail: String(detail).slice(0, 500),
        token_summary: this.summarizeToken(createToken),
        token_age_ms: createToken ? (Date.now() - this.createCaptchaTokenCachedAt) : null,
      }));
      if (error?.response?.status === 422 && /verify|verification|token validation/i.test(String(detail))) {
        await this.reportIncorrectCaptcha(String(detail).slice(0, 160));
      }
      if (String(detail).includes('Token validation failed')) {
        const wrapped: any = new Error('Token validation failed after captcha solve; current create token was rejected by upstream create endpoint.');
        wrapped.response = { status: error?.response?.status || 422 };
        throw wrapped;
      }
      throw error;
    } finally {
      // create captcha token 视为一次性/短时凭证；每次 create 后都清掉，避免复用陈旧 token
      this.clearCreateCaptchaContext();
      this.applyClientIdentity(this.baseClientIdentity);
    }
    logger.info('Create response status: ' + response.status + ', data: ' + JSON.stringify(response.data).slice(0, 500));

    if (response.status !== 200) {
      throw new Error(`Create failed with status ${response.status}`);
    }

    const clips = (response.data?.clips || []).map((audio: any) => this.mapClip(audio));
    logger.info('Clips returned: ' + clips.length);
    if (!options.wait_audio || clips.length === 0) {
      return clips;
    }

    const ids = clips.map((clip: AudioInfo) => clip.id);
    let last = clips;

    logger.info('wait_audio initial delay before first poll: ' + JSON.stringify({
      delaySeconds: SunoApi.WAIT_AUDIO_INITIAL_DELAY_SECONDS,
      pollIntervalSeconds: SunoApi.WAIT_AUDIO_POLL_INTERVAL_SECONDS,
      maxPolls: SunoApi.WAIT_AUDIO_MAX_POLLS,
      clipIds: ids,
    }));
    await sleep(SunoApi.WAIT_AUDIO_INITIAL_DELAY_SECONDS);

    let transientPollFailures = 0;
    for (let pollRound = 1; pollRound <= SunoApi.WAIT_AUDIO_MAX_POLLS; pollRound++) {
      let polled: AudioInfo[];
      try {
        polled = await this.getFeedByIdsV3(ids);
      } catch (error: any) {
        const classified = this.classifyPollError(error);
        transientPollFailures += 1;
        logger.warn('wait_audio poll round failed: ' + JSON.stringify({
          pollRound,
          transientPollFailures,
          status: classified.status,
          code: classified.code,
          retryable: classified.retryable,
          message: classified.message,
        }));

        if (!classified.retryable) {
          throw error;
        }

        if (pollRound < SunoApi.WAIT_AUDIO_MAX_POLLS) {
          await sleep(SunoApi.WAIT_AUDIO_POLL_INTERVAL_SECONDS);
        }
        continue;
      }

      transientPollFailures = 0;
      const hasAllExpected = polled.length === ids.length && polled.length > 0;
      const allCompleted = hasAllExpected && polled.every((audio) => audio.status === 'complete');
      const allError = hasAllExpected && polled.every((audio) => audio.status === 'error');

      logger.info('wait_audio poll round: ' + JSON.stringify({
        pollRound,
        maxPolls: SunoApi.WAIT_AUDIO_MAX_POLLS,
        expectedCount: ids.length,
        returnedCount: polled.length,
        statuses: polled.map((audio) => ({ id: audio.id, status: audio.status })),
        allCompleted,
        allError,
      }));

      if (allCompleted || allError) {
        return polled;
      }
      if (polled.length > 0) {
        last = polled;
      }
      if (pollRound < SunoApi.WAIT_AUDIO_MAX_POLLS) {
        await sleep(SunoApi.WAIT_AUDIO_POLL_INTERVAL_SECONDS);
      }
    }
    logger.warn('wait_audio reached max polls before all clips reached a terminal state: ' + JSON.stringify({
      initialDelaySeconds: SunoApi.WAIT_AUDIO_INITIAL_DELAY_SECONDS,
      pollIntervalSeconds: SunoApi.WAIT_AUDIO_POLL_INTERVAL_SECONDS,
      maxPolls: SunoApi.WAIT_AUDIO_MAX_POLLS,
      clipIds: ids,
    }));
    return last;
  }

  private async inferSourceClipWorkspace(
    clipId: string,
    contextLabel: string
  ): Promise<{ project_id?: string; project_name?: string }> {
    try {
      const sourceClip = await this.getClip(clipId) as any;
      const sourceProject = sourceClip?.project || sourceClip?.project_info || sourceClip?.workspace || sourceClip?.projectDetails;
      const sourceProjectId = sourceProject?.id || sourceClip?.project_id || sourceClip?.projectId;
      const sourceProjectName = sourceProject?.name || sourceClip?.project_name || sourceClip?.projectName;
      if (sourceProjectId) {
        const project_id = String(sourceProjectId);
        const project_name = sourceProjectName ? String(sourceProjectName) : undefined;
        logger.info(`Detected source clip workspace for ${contextLabel}: ${project_name || project_id}`);
        return { project_id, project_name };
      }
    } catch (error: any) {
      logger.warn(`Failed to infer source workspace from ${contextLabel}: ${error?.message || error}`);
    }
    return {};
  }

  private async assignGeneratedClipsToWorkspace(
    clips: AudioInfo[],
    options: {
      project_id?: string;
      project_name?: string;
      force_workspace_assignment?: boolean;
    }
  ): Promise<AudioInfo[]> {
    if (!options.force_workspace_assignment) {
      return clips;
    }

    if (!options.project_id && !options.project_name) {
      return clips.map((clip) => ({
        ...clip,
        project_assigned: false,
        project_error: 'force_workspace_assignment=true requires project_id or project_name',
      }));
    }

    const workspace = await this.resolveWorkspace({
      project_id: options.project_id,
      project_name: options.project_name,
    });

    if (!workspace) {
      const error = `Workspace not found: ${options.project_name || options.project_id}`;
      return clips.map((clip) => ({
        ...clip,
        project_assigned: false,
        project_error: error,
      }));
    }

    const assignment = await Promise.all(
      clips.map(async (clip) => {
        try {
          const assigned = await this.addClipToWorkspace(clip.id, workspace.id);
          return {
            assigned,
            error: assigned ? undefined : 'Failed to assign clip to workspace',
          };
        } catch (error: any) {
          return {
            assigned: false,
            error: error?.message || String(error),
          };
        }
      })
    );

    return clips.map((clip, index) => ({
      ...clip,
      project_id: workspace.id,
      project_name: workspace.name,
      project_assigned: assignment[index].assigned,
      project_error: assignment[index].error,
    }));
  }

  async coverGenerate(options: CoverGenerateOptions): Promise<AudioInfo[]> {
    await this.keepAlive(false);

    if (!options.cover_clip_id) {
      throw new Error('cover_clip_id is required');
    }

    const inferredWorkspace = (!options.project_id && !options.project_name)
      ? await this.inferSourceClipWorkspace(options.cover_clip_id, 'cover generation')
      : {};
    const targetProjectId = (options.project_id || inferredWorkspace.project_id || '').trim() || undefined;
    const targetProjectName = (options.project_name || inferredWorkspace.project_name || '').trim() || undefined;

    const clips = await this.create({
      project_id: targetProjectId,
      project_name: targetProjectId ? undefined : targetProjectName,
      prompt: options.lyrics,
      tags: options.style,
      title: options.title,
      negative_tags: options.negative_tags || '',
      make_instrumental: Boolean(options.make_instrumental),
      model: options.model,
      wait_audio: options.wait_audio,
      create_mode: 'custom',
      task: options.persona_id ? 'vox_cover' : 'cover',
      cover_clip_id: options.cover_clip_id,
      persona_id: options.persona_id,
      vocal_gender: options.vocal_gender,
      style_weight: options.style_weight,
      weirdness_constraint: options.weirdness_constraint,
      audio_weight: options.audio_weight,
    });

    return this.assignGeneratedClipsToWorkspace(clips, {
      project_id: targetProjectId,
      project_name: targetProjectId ? undefined : targetProjectName,
      force_workspace_assignment: options.force_workspace_assignment ?? Boolean(targetProjectId || targetProjectName),
    });
  }

  async extendAudio(options: ExtendAudioOptions): Promise<AudioInfo[]> {
    await this.keepAlive(false);

    if (!options.audio_id) {
      throw new Error('audio_id is required');
    }

    const inferredWorkspace = (!options.project_id && !options.project_name)
      ? await this.inferSourceClipWorkspace(options.audio_id, 'extend audio')
      : {};
    const targetProjectId = (options.project_id || inferredWorkspace.project_id || '').trim() || undefined;
    const targetProjectName = (options.project_name || inferredWorkspace.project_name || '').trim() || undefined;

    const clips = await this.create({
      project_id: targetProjectId,
      project_name: targetProjectId ? undefined : targetProjectName,
      prompt: options.prompt || '',
      tags: options.tags || '',
      title: options.title || '',
      negative_tags: options.negative_tags || '',
      make_instrumental: false,
      model: options.model,
      wait_audio: options.wait_audio,
      create_mode: 'custom',
      task: 'extend',
      continue_clip_id: options.audio_id,
      continue_at: options.continue_at,
    });

    return this.assignGeneratedClipsToWorkspace(clips, {
      project_id: targetProjectId,
      project_name: targetProjectId ? undefined : targetProjectName,
      force_workspace_assignment: options.force_workspace_assignment ?? Boolean(targetProjectId || targetProjectName),
    });
  }

  async mashupGenerate(options: MashupGenerateOptions): Promise<AudioInfo[]> {
    await this.keepAlive(false);

    const mashupClipIds = (options.mashup_clip_ids || [])
      .map((clipId) => String(clipId).trim())
      .filter(Boolean);
    if (mashupClipIds.length !== 2) {
      throw new Error('mashup_clip_ids must contain exactly two clip IDs');
    }

    const inferredWorkspace = (!options.project_id && !options.project_name)
      ? await this.inferSourceClipWorkspace(mashupClipIds[0], 'mashup generation')
      : {};
    const targetProjectId = (options.project_id || inferredWorkspace.project_id || '').trim() || undefined;
    const targetProjectName = (options.project_name || inferredWorkspace.project_name || '').trim() || undefined;

    const clips = await this.create({
      project_id: targetProjectId,
      project_name: targetProjectId ? undefined : targetProjectName,
      prompt: options.lyrics || '',
      tags: options.style || '',
      title: options.title || 'mashup-generate',
      negative_tags: options.negative_tags || '',
      make_instrumental: Boolean(options.make_instrumental),
      model: options.model,
      wait_audio: options.wait_audio,
      create_mode: 'custom',
      task: 'mashup_condition',
      mashup_clip_ids: mashupClipIds,
      vocal_gender: options.vocal_gender,
      style_weight: options.style_weight,
      weirdness_constraint: options.weirdness_constraint,
      audio_weight: options.audio_weight,
    });

    return this.assignGeneratedClipsToWorkspace(clips, {
      project_id: targetProjectId,
      project_name: targetProjectId ? undefined : targetProjectName,
      force_workspace_assignment: options.force_workspace_assignment ?? Boolean(targetProjectId || targetProjectName),
    });
  }

  async downloadSongAutoStems(options: SongStemsRequest): Promise<any> {
    return downloadSongAutoStems(options);
  }

  /**
   * Submit exactly one Studio Instrument/Cover create request.
   *
   * Idempotency reservation, persistence, authorization, credit snapshots, and
   * poll-only recovery are enforced by StudioGenerationService. This method
   * deliberately never retries the upstream POST.
   */
  async submitStudioGeneration(input: StudioGenerationRequest): Promise<StudioGenerationResponse> {
    await this.keepAlive(false);
    if (!input.workspace_project_id?.trim()) {
      throw new Error('workspace_project_id is required and must not be replaced by a Studio project ID');
    }
    if (!input.stem_condition_clip_id?.trim()) {
      throw new Error('stem_condition_clip_id is required');
    }
    if (!input.stem_control_tags?.trim()) {
      throw new Error('stem_control_tags is required');
    }
    if (input.mode === 'cover') {
      if (!input.cover_clip_id?.trim()) throw new Error('cover_clip_id is required for cover mode');
      const start = Number(input.cover_start_s);
      const end = Number(input.cover_end_s);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
        throw new Error('cover_start_s and cover_end_s must define a positive range');
      }
    }

    const traceId = randomUUID().slice(0, 8);
    const precheck = await this.createPrecheck(traceId);
    const createToken = this.createCaptchaToken || null;
    if (precheck.required && !createToken) {
      throw new Error('Studio generation challenge required, but no captcha token is cached after precheck solve');
    }

    const baseMetadata = await this.buildCreateMetadata('custom');
    const metadata = {
      ...baseMetadata,
      web_client_pathname: '/studio',
      create_mode: 'custom',
      disable_volume_normalization: input.disable_volume_normalization ?? (input.mode === 'instrument'),
      vocal_gender: input.vocal_gender || 'unspecified',
      is_remix: true,
      ...(input.studio_project_id ? { from_studio_project_id: input.studio_project_id } : {}),
      ...(input.studio_project_version_id ? { studio_project_version_id: input.studio_project_version_id } : {}),
    };
    const payload: Record<string, any> = {
      project_id: input.workspace_project_id,
      token: createToken,
      task: input.mode === 'cover' ? 'cover_stem_condition' : 'stem_condition',
      generation_type: 'TEXT',
      title: input.title || (input.mode === 'instrument' ? input.stem_control_tags.replace(/^add\s+/i, '') : 'Untitled'),
      tags: input.tags || '',
      negative_tags: input.negative_tags || '',
      mv: resolveModelAlias(input.model || DEFAULT_MODEL),
      prompt: input.prompt || '',
      make_instrumental: input.make_instrumental ?? input.mode === 'instrument',
      stem_control_tags: input.stem_control_tags,
      batch_size: input.batch_size || 2,
      metadata,
      stem_condition_clip_id: input.stem_condition_clip_id,
      cover_clip_id: input.cover_clip_id || null,
      cover_start_s: input.mode === 'cover' ? input.cover_start_s : null,
      cover_end_s: input.mode === 'cover' ? input.cover_end_s : null,
      user_uploaded_images_b64: null,
      override_fields: [],
      persona_id: null,
      artist_clip_id: null,
      artist_start_s: null,
      artist_end_s: null,
      continue_clip_id: null,
      continued_aligned_prompt: null,
      continue_at: null,
      transaction_uuid: randomUUID(),
    };

    logger.info('Submitting one Studio generation request: ' + JSON.stringify({
      trace_id: traceId,
      mode: input.mode,
      task: payload.task,
      batch_size: payload.batch_size,
      model: payload.mv,
      workspace_project_id_present: true,
      studio_project_id_present: Boolean(input.studio_project_id),
      stem_condition_clip_id: input.stem_condition_clip_id,
      cover_clip_id: input.cover_clip_id || null,
      captcha_version: precheck.captcha_version,
    }));

    try {
      const response = await this.client.post(
        `${SunoApi.BASE_URL}/api/generate/v2-web/`,
        payload,
        { timeout: 30000 },
      );
      const clipIds = Array.isArray(response.data?.clips)
        ? response.data.clips
          .map((clip: any) => clip?.id)
          .filter((id: any): id is string => typeof id === 'string' && id.length > 0)
        : [];
      if (clipIds.length === 0) {
        throw new Error('Studio generation response contained no clip ids');
      }
      return {
        clip_ids: clipIds,
        status: response.data?.status,
        response: response.data,
      };
    } catch (error: any) {
      const detail = error?.response?.data?.detail
        || error?.response?.data?.message
        || error?.response?.data?.error
        || error?.message
        || String(error);
      if (error?.response?.status === 422 && /verify|verification|token validation/i.test(String(detail))) {
        await this.reportIncorrectCaptcha(String(detail).slice(0, 160));
      }
      throw error;
    } finally {
      this.clearCreateCaptchaContext();
      this.applyClientIdentity(this.baseClientIdentity);
    }
  }

  private slugify(input?: string): string {
    return (input || 'untitled')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || 'untitled';
  }

  private randomStudioId(prefix: string = 'sb'): string {
    return `${prefix}-${randomUUID()}`;
  }

  private clipStatusFrom(data: any): string {
    return String(data?.status || data?.clip?.status || data?.metadata?.status || '');
  }

  private normalizeStudioConcatClips(clips: StudioConcatClipInput[]): NormalizedStudioConcatClip[] {
    return (Array.isArray(clips) ? clips : [])
      .map((item, index) => {
        const clipId = String(item?.clip_id || item?.clipId || item?.id || '').trim();
        const durationCandidates = [
          item?.duration_seconds,
          item?.durationSeconds,
          item?.duration,
        ];
        let durationSeconds = 0;
        for (const candidate of durationCandidates) {
          const value = Number(candidate);
          if (Number.isFinite(value) && value > 0) {
            durationSeconds = value;
            break;
          }
        }
        return {
          clipId,
          title: item?.title,
          durationSeconds,
          order: Number.isFinite(Number(item?.order)) ? Number(item?.order) : index,
          transposition: Math.max(-24, Math.min(24, Number(item?.transposition) || 0)),
          skipped: Boolean(item?.skipped),
        };
      })
      .filter((item) => item.clipId || item.skipped)
      .sort((a, b) => a.order - b.order);
  }

  private finalStudioMergeTitle(clips: NormalizedStudioConcatClip[], explicitTitle?: string): string {
    if (explicitTitle?.trim()) return explicitTitle.trim();
    const first = clips[0];
    const source = first?.title || 'Suno 批量音频';
    return `${String(source).replace(/\.[^.]+$/, '').replace(/_part\d{3}$/i, '')} (Studio 合并)`;
  }

  private makeStudioAudioArrangement(
    item: NormalizedStudioConcatClip,
    index: number,
    startBeats: number,
    timelineLengthBeats: number,
    sourceLengthBeats: number,
    transposition: number
  ): StudioTimelineClip {
    const colorPalette = ['#FF6A00', '#02AF4A', '#DE1677', '#D4BB03', '#7251F7', '#208BFF'];
    return {
      type: 'audio',
      id: this.randomStudioId(`part-${String(index + 1).padStart(3, '0')}`),
      streaming: false,
      name: item.title || `切片 ${index + 1}`,
      color: colorPalette[index % colorPalette.length],
      transposition,
      amplitude: 1,
      startBeats,
      endBeats: startBeats + timelineLengthBeats,
      readStartBeats: 0,
      fadeInBeats: 0,
      fadeOutBeats: 0,
      fadeInCurve: 1,
      fadeOutCurve: 1,
      mute: false,
      reversed: false,
      loop: {
        enabled: false,
        startBeats: 0,
        endBeats: Math.max(1, sourceLengthBeats),
      },
      warp: {
        enabled: false,
        markers: { 0: 0, 1: 1 },
        awaitingAnalysis: false,
      },
      asset: {
        type: 'clip',
        id: item.clipId || 'skipped-gap',
      },
      clipId: item.clipId || 'skipped-gap',
      uploadId: null,
    };
  }

  private buildStudioTimelineState(
    clips: NormalizedStudioConcatClip[],
    title?: string,
    tailPadSeconds: number = STUDIO_DEFAULT_TAIL_PAD_SECONDS,
  ): BuiltStudioTimeline {
    const bps = STUDIO_TIMELINE_BPS;
    const trackId = this.randomStudioId('track');
    const tailPadBeats = tailPadSeconds * bps;
    let cursor = 0;

    const arrangements = clips.map((item, index) => {
      const duration = Math.max(0.25, Number(item.durationSeconds || 0));
      const sourceLengthBeats = Math.max(0.25, duration * bps);
      const rate = Math.pow(2, item.transposition / 12);
      const timelineLengthBeats = Math.max(0.25, sourceLengthBeats / rate);

      if (item.skipped) {
        cursor += timelineLengthBeats;
        return null;
      }

      const arrangement = this.makeStudioAudioArrangement(item, index, cursor, timelineLengthBeats, sourceLengthBeats, item.transposition);
      cursor = arrangement.endBeats;
      return arrangement;
    });

    const realizedArrangements = arrangements.filter((item): item is StudioTimelineClip => Boolean(item));

    const contentEndBeats = cursor;
    const exportEndBeats = contentEndBeats + tailPadBeats;
    const track: StudioTimelineTrack = {
      type: 'audio',
      id: trackId,
      input: null,
      color: '#208BFF',
      name: '合并音轨',
      clips: realizedArrangements,
      clipCreationIntents: [],
      height: 88,
      solo: false,
      mute: false,
      arm: false,
      amplitude: 1,
      balance: 0,
      instrument: { type: 'song' },
      soloTakeLaneId: null,
      takeLanesExpanded: false,
      takeLanes: [],
      eq: {
        enabled: true,
        band1: { type: 'highpass', enabled: false, frequency: 60, gain: 0, q: 0.707 },
        band2: { type: 'lowshelf', enabled: true, frequency: 160, gain: 0, q: 0.707 },
        band3: { type: 'peaking', enabled: true, frequency: 450, gain: 0, q: 0.707 },
        band4: { type: 'peaking', enabled: true, frequency: 1200, gain: 0, q: 0.707 },
        band5: { type: 'highshelf', enabled: true, frequency: 3200, gain: 0, q: 0.707 },
        band6: { type: 'lowpass', enabled: false, frequency: 8800, gain: 0, q: 0.707 },
      },
      signalChain: [],
      routingMode: 'linear',
      faderAutomation: {},
    };

    return {
      title: this.finalStudioMergeTitle(clips, title),
      state: {
        amplitude: 1,
        sections: {},
        lyricsCorrectionsByClipId: {},
        metronome: { enabled: false, amplitude: 1 },
        timing: { type: 'manual', bps, bpsAutomation: [], firstBeatSeconds: 0 },
        timeSignatureChanges: [{ startBeats: 0, subdivisionsPerBar: 4, beatsPerSubdivision: 1 }],
        tracks: [track],
        selection: {
          anchorBeats: 0,
          focusBeats: exportEndBeats,
          trackIds: [trackId],
          focusedTrackId: trackId,
          focusedTakeLaneId: null,
          focusedArea: null,
          arrangementAnchorBeats: null,
          arrangementFocusBeats: null,
          noteIds: [],
          warpMarkerSeconds: {},
          automationPointIndices: [],
          contextBeforeBeats: 32,
          contextAfterBeats: Math.max(32, tailPadBeats),
        },
        loop: { enabled: false, startBeats: 0, endBeats: exportEndBeats },
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
        masterRoutingMode: 'linear',
        routing: {},
        markersRegistry: {},
      },
      startBeats: 0,
      endBeats: exportEndBeats,
      contentEndBeats,
    };
  }

  private serializeStudioState(inputState: StudioTimelineState): StudioTimelineState {
    const markers = new Map<string, string>();
    const stateCopy = JSON.parse(JSON.stringify(inputState));
    for (const track of stateCopy.tracks || []) {
      if (track.type !== 'audio') continue;
      for (const area of [track, ...(track.takeLanes || [])]) {
        for (const clip of area.clips || []) {
          if (!clip.warp?.markers) continue;
          const key = Object.entries(clip.warp.markers)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([beat, second]) => `${beat}:${second}`)
            .join(',');
          let hash = markers.get(key);
          if (!hash) {
            hash = `warp_${Buffer.from(key).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24) || 'empty'}`;
            markers.set(key, hash);
            stateCopy.markersRegistry[hash] = clip.warp.markers;
          }
          const { markers: _markers, ...warpWithoutMarkers } = clip.warp;
          clip.warp = { ...warpWithoutMarkers, markersHash: hash };
        }
      }
    }
    return stateCopy;
  }

  private async inferClipDurationSeconds(clipId: string): Promise<number> {
    const clip = await this.getClip(clipId);
    const candidates = [
      clip?.metadata?.duration,
      clip?.duration,
      clip?.clip?.metadata?.duration,
      clip?.clip?.duration,
    ];
    for (const candidate of candidates) {
      const value = Number(candidate);
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }
    throw new Error(`duration is required for clip ${clipId} when upstream clip metadata has no usable duration`);
  }

  private uploadedClipDurationSeconds(upload: UploadReferenceResult, fallbackDurationSeconds: number): number {
    const candidates = [
      upload?.clip?.metadata?.duration,
      upload?.clip?.duration,
      upload?.clip?.clip?.metadata?.duration,
      upload?.clip?.clip?.duration,
    ];
    for (const candidate of candidates) {
      const value = Number(candidate);
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }
    return fallbackDurationSeconds;
  }

  private async renderStudioTimeline(options: StudioConcatOptions): Promise<StudioConcatResult> {
    const normalized = this.normalizeStudioConcatClips(options.clips);
    if (!normalized.length) {
      throw new Error('clips is required');
    }
    if (normalized.length < 2) {
      throw new Error('at least two clips are required for Studio concat');
    }

    for (const clip of normalized) {
      if (!(clip.durationSeconds > 0)) {
        clip.durationSeconds = await this.inferClipDurationSeconds(clip.clipId);
      }
    }

    const tailPadSeconds = Number.isFinite(Number(options.tail_pad_seconds))
      ? Math.max(0, Number(options.tail_pad_seconds))
      : STUDIO_DEFAULT_TAIL_PAD_SECONDS;
    const defaultTransposition = Math.max(-24, Math.min(24, Number(options.transposition) || 0));
    const clipsWithTransposition = normalized.map((clip) => ({
      ...clip,
      transposition: Number.isFinite(Number(clip.transposition)) ? clip.transposition : defaultTransposition,
    }));

    const timeline = this.buildStudioTimelineState(clipsWithTransposition, options.title, tailPadSeconds);
    const serializedState = this.serializeStudioState(timeline.state);

    await this.keepAlive(false);
    const response = await this.client.post(
      `${SunoApi.BASE_URL}/api/studio/render-state`,
      {
        title: timeline.title,
        lyrics: options.lyrics || '',
        tags: options.tags || '',
        negative_tags: options.negative_tags || '',
        style_summary: options.style_summary || '',
        caption: options.caption || '',
        state: serializedState,
        start_beats: timeline.startBeats,
        end_beats: timeline.endBeats,
        downbeats: [],
        web_client_pathname: '/studio',
        export_mode: 'rendered_context_window',
        generate_midi_preview: false,
      },
      { timeout: 30000 }
    );

    const data = response.data || {};
    if (data?.moderation_error_message) {
      throw new Error(`Suno moderation failed: ${data.moderation_error_message}`);
    }

    const clipId = data?.id || data?.clip_id || data?.clip?.id;
    if (!clipId) {
      throw new Error('Studio render-state returned no clip id');
    }

    return {
      clip_id: clipId,
      title: timeline.title,
      timeline: {
        start_beats: timeline.startBeats,
        end_beats: timeline.endBeats,
        content_end_beats: timeline.contentEndBeats,
        content_duration_seconds: timeline.contentEndBeats / STUDIO_TIMELINE_BPS,
        tail_pad_seconds: tailPadSeconds,
        bps: STUDIO_TIMELINE_BPS,
        track_count: timeline.state.tracks.length,
        clip_count: clipsWithTransposition.filter((clip) => !clip.skipped).length,
      },
      render_job: data,
    };
  }

  private async waitForStudioRenderReady(
    clipId: string,
    maxPollAttempts: number = STUDIO_DEFAULT_RENDER_POLL_ATTEMPTS,
    pollIntervalSeconds: number = STUDIO_DEFAULT_RENDER_POLL_INTERVAL_SECONDS
  ): Promise<any> {
    const pending = new Set(['queued', 'submitted', 'processing', 'generating', 'running', 'pending']);
    for (let i = 0; i < maxPollAttempts; i += 1) {
      const data = await this.getClip(clipId);
      const status = this.clipStatusFrom(data).toLowerCase();
      if (status === 'error' || status === 'failed') {
        throw new Error(data?.error_message || data?.error || 'Studio render failed');
      }
      if (!status || !pending.has(status)) {
        return data;
      }
      await sleep(pollIntervalSeconds);
    }
    throw new Error('Waiting for Studio render timed out');
  }

  async concatClipsWithStudio(options: StudioConcatOptions): Promise<StudioConcatResult> {
    const result = await this.renderStudioTimeline(options);
    const waitAudio = options.wait_audio === undefined ? true : Boolean(options.wait_audio);
    if (!waitAudio) {
      return result;
    }

    result.clip = await this.waitForStudioRenderReady(
      result.clip_id,
      Number(options.max_poll_attempts) > 0 ? Number(options.max_poll_attempts) : STUDIO_DEFAULT_RENDER_POLL_ATTEMPTS,
      Number(options.poll_interval_seconds) > 0 ? Number(options.poll_interval_seconds) : STUDIO_DEFAULT_RENDER_POLL_INTERVAL_SECONDS,
    );
    return result;
  }

  async prepareClipDownload(clipId: string): Promise<void> {
    await this.withRetry('prepare_clip_download', async () => {
      await this.keepAlive(false);
      await this.client.post(
        `${SunoApi.BASE_URL}/api/billing/clips/${clipId}/download/`,
        {},
        { timeout: 10000 }
      );
    });
  }

  async tryPrepareClipDownload(clipId: string): Promise<boolean> {
    try {
      await this.prepareClipDownload(clipId);
      return true;
    } catch (error: any) {
      const status = Number(error?.response?.status || 0);
      if (status === 404) {
        logger.debug(`clip download prepare returned 404; continuing without prepare for ${clipId}`);
        return false;
      }
      throw error;
    }
  }

  async convertWav(clipId: string): Promise<void> {
    await this.withRetry('convert_wav', async () => {
      await this.keepAlive(false);
      await this.client.post(
        `${SunoApi.BASE_URL}/api/gen/${clipId}/convert_wav/`,
        {},
        { timeout: 10000 }
      );
    });
  }

  async getWavFile(clipId: string): Promise<{ wav_file_url?: string }> {
    const result = await this.withRetry('get_wav_file', async () => {
      await this.keepAlive(false);
      const response = await this.client.get(
        `${SunoApi.BASE_URL}/api/gen/${clipId}/wav_file/`,
        { timeout: 10000 }
      );
      return response.data || {};
    });
    return result.value;
  }

  async ensureWavFile(
    clipId: string,
    pollIntervalSeconds: number = 3,
    maxPollAttempts: number = 20,
  ): Promise<{
    wav_file_url?: string;
    poll_attempts: number;
    conversion_requested: boolean;
    existing_before_conversion: boolean;
  }> {
    const existing = await this.getWavFile(clipId);
    if (existing.wav_file_url) {
      return {
        ...existing,
        poll_attempts: 1,
        conversion_requested: false,
        existing_before_conversion: true,
      };
    }

    await this.convertWav(clipId);
    for (let i = 0; i < maxPollAttempts; i++) {
      const wavData = await this.getWavFile(clipId);
      if (wavData.wav_file_url) {
        return {
          ...wavData,
          poll_attempts: i + 1,
          conversion_requested: true,
          existing_before_conversion: false,
        };
      }
      if (i < maxPollAttempts - 1) {
        const dynamicInterval = Math.min(30, pollIntervalSeconds * Math.max(1, Math.ceil((i + 1) / 5)));
        await sleep(dynamicInterval);
      }
    }
    return {
      poll_attempts: maxPollAttempts,
      conversion_requested: true,
      existing_before_conversion: false,
    };
  }

  private async fileExistsWithSize(filePath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(filePath);
      return stat.isFile() && stat.size > 0;
    } catch {
      return false;
    }
  }

  private async readJsonFile(filePath: string): Promise<any | null> {
    try {
      return JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  private sunoSongUrl(clipId: string): string {
    return `https://suno.com/song/${clipId.toLowerCase()}`;
  }

  private inferArchiveSunoSource(clip: AudioInfo): 'suno' | 'suno_studio' {
    const rawType = String(clip.type || clip.raw?.metadata?.type || '').toLowerCase();
    if (rawType.includes('studio')) return 'suno_studio';
    return 'suno';
  }

  private archiveStatus(entry: AccountArchiveEntry): AccountArchiveEntry['archive_status'] {
    if (entry.skipped) return 'skipped';
    if (entry.planned_formats.length > 0 && entry.completed_formats.length === 0 && entry.errors.length === 0) return 'planned';
    if (entry.errors.length === 0 && entry.requested_formats.every((format) => entry.completed_formats.includes(format))) return 'completed';
    if (entry.completed_formats.length > 0) return 'partial';
    return 'failed';
  }

  private mergeArchiveEntry(
    previous: AccountArchiveEntry | undefined,
    next: AccountArchiveEntry,
    now: string,
  ): AccountArchiveEntry {
    const merged: AccountArchiveEntry = {
      ...previous,
      ...next,
      first_seen_at: previous?.first_seen_at || now,
      last_seen_at: now,
      last_attempted_at: now,
      last_success_at: next.archive_status === 'completed'
        ? now
        : previous?.last_success_at,
      requested_formats: next.requested_formats,
      completed_formats: next.completed_formats,
      downloaded_formats: next.downloaded_formats,
      existing_formats: next.existing_formats,
      planned_formats: next.planned_formats,
      errors: next.errors,
    };
    merged.archive_status = this.archiveStatus(merged);
    return merged;
  }

  private async hashFile(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    for await (const chunk of stream) {
      hash.update(chunk as Buffer);
    }
    return hash.digest('hex');
  }

  private async probeMediaFile(filePath: string): Promise<AccountArchiveFileIntegrity['probe']> {
    try {
      const result = await execFile(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=format_name,duration', '-of', 'json', filePath],
        { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
      );
      const parsed = JSON.parse(result.stdout || '{}');
      const format = parsed?.format || {};
      return {
        available: true,
        ok: true,
        format_name: typeof format.format_name === 'string' ? format.format_name : undefined,
        duration_seconds: Number.isFinite(Number(format.duration)) ? Number(format.duration) : undefined,
      };
    } catch (error: any) {
      if (error?.code === 'ENOENT') return { available: false, ok: true };
      return {
        available: true,
        ok: false,
        error_code: typeof error?.code === 'string' ? error.code : 'ffprobe_failed',
      };
    }
  }

  private async collectFileIntegrity(
    filePath: string,
    format?: AccountArchiveFormat | 'cover',
    metadata?: { content_type?: string; content_length?: number },
  ): Promise<AccountArchiveFileIntegrity> {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size <= 0) {
      throw new Error(`Downloaded file is empty or not a regular file: ${filePath}`);
    }
    const probe = format === 'mp3' || format === 'wav'
      ? await this.probeMediaFile(filePath)
      : undefined;
    if (probe && probe.available && !probe.ok) {
      throw new Error(`ffprobe rejected downloaded ${format}: ${filePath}`);
    }
    return {
      size_bytes: stat.size,
      sha256: await this.hashFile(filePath),
      content_type: metadata?.content_type,
      content_length: metadata?.content_length,
      verified_at: new Date().toISOString(),
      probe,
    };
  }

  private async fileStillAvailable(filePath?: string, format?: AccountArchiveFormat | 'cover'): Promise<boolean> {
    if (!filePath || !(await this.fileExistsWithSize(filePath))) return false;
    try {
      await this.collectFileIntegrity(filePath, format);
      return true;
    } catch {
      return false;
    }
  }

  private clipArchiveDir(rootDir: string, clip: AudioInfo): string {
    const day = (clip.created_at || '').slice(0, 10) || 'unknown-date';
    return path.join(rootDir, 'clips', day, clip.id);
  }

  private clipMetadataForArchive(
    clip: AudioInfo,
    entry: AccountArchiveEntry,
  ): Record<string, any> {
    return {
      id: clip.id,
      title: clip.title,
      status: clip.status,
      created_at: clip.created_at,
      suno_page_url: this.sunoSongUrl(clip.id),
      suno_source: entry.suno_source || this.inferArchiveSunoSource(clip),
      model_name: clip.model_name,
      duration: clip.duration,
      prompt: clip.prompt,
      gpt_description_prompt: clip.gpt_description_prompt,
      tags: clip.tags,
      negative_tags: clip.negative_tags,
      type: clip.type,
      local_files: {
        mp3_path: entry.mp3_path,
        wav_path: entry.wav_path,
        cover_path: entry.cover_path,
      },
      integrity: {
        mp3: entry.mp3_integrity,
        wav: entry.wav_integrity,
        cover: entry.cover_integrity,
      },
      archive: {
        status: entry.archive_status,
        requested_formats: entry.requested_formats,
        completed_formats: entry.completed_formats,
        downloaded_formats: entry.downloaded_formats,
        existing_formats: entry.existing_formats,
        planned_formats: entry.planned_formats,
        stage_timings_ms: entry.stage_timings_ms,
        retry_counts: entry.retry_counts,
      },
      archived_at: new Date().toISOString(),
    };
  }

  private async writeJsonFile(filePath: string, data: any): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
    try {
      const handle = await fs.open(tempPath, 'w', 0o600);
      try {
        await handle.writeFile(JSON.stringify(data, null, 2));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(tempPath, filePath);
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async emitArchiveProgress(
    options: ArchiveAccountOptions,
    event: AccountArchiveProgressEvent,
  ): Promise<void> {
    if (options.on_progress) {
      await options.on_progress(event);
    }
  }

  async downloadClipMedia(
    clip: AudioInfo,
    outputDir: string,
    options: ArchiveAccountOptions = {},
    previousEntry?: AccountArchiveEntry,
  ): Promise<AccountArchiveEntry> {
    const formats = this.normalizeArchiveFormats(options.formats);
    const skipExisting = options.skip_existing !== false;
    const resume = options.resume !== false;
    const archiveDir = this.clipArchiveDir(outputDir, clip);
    const basename = `${this.slugify(clip.title || clip.id)}_${clip.id}`;
    const entry: AccountArchiveEntry = {
      id: clip.id,
      title: clip.title,
      status: clip.status,
      created_at: clip.created_at,
      model_name: clip.model_name,
      duration: clip.duration,
      suno_page_url: this.sunoSongUrl(clip.id),
      suno_source: this.inferArchiveSunoSource(clip),
      requested_formats: formats,
      completed_formats: [],
      downloaded_formats: [],
      existing_formats: [],
      planned_formats: [],
      archive_status: 'planned',
      first_seen_at: previousEntry?.first_seen_at,
      last_success_at: previousEntry?.last_success_at,
      errors: [],
    };
    const stageTimings: Record<string, number> = {};

    const status = String(clip.status || '').toLowerCase();
    if (!options.include_incomplete && status && status !== 'complete') {
      entry.skipped = true;
      entry.skip_reason = `status=${clip.status}`;
      entry.archive_status = this.archiveStatus(entry);
      return entry;
    }

    await fs.mkdir(archiveDir, { recursive: true });

    if (formats.includes('mp3')) {
      const mp3Path = previousEntry?.mp3_path || path.join(archiveDir, `${basename}.mp3`);
      const stageStartedAt = Date.now();
      try {
        const defaultMp3Path = path.join(archiveDir, `${basename}.mp3`);
        const reusableMp3Path = await this.fileStillAvailable(mp3Path, 'mp3')
          ? mp3Path
          : await this.fileStillAvailable(defaultMp3Path, 'mp3')
            ? defaultMp3Path
            : undefined;
        if (resume && skipExisting && reusableMp3Path) {
          entry.mp3_path = reusableMp3Path;
          entry.mp3_integrity = await this.collectFileIntegrity(reusableMp3Path, 'mp3');
          entry.existing_formats.push('mp3');
          entry.completed_formats.push('mp3');
        } else if (options.dry_run) {
          entry.mp3_path = reusableMp3Path || defaultMp3Path;
          entry.planned_formats.push('mp3');
        } else if (skipExisting && reusableMp3Path) {
          entry.mp3_path = reusableMp3Path;
          entry.mp3_integrity = await this.collectFileIntegrity(reusableMp3Path, 'mp3');
          entry.existing_formats.push('mp3');
          entry.completed_formats.push('mp3');
        } else if (!clip.audio_url) {
          entry.errors.push({ format: 'mp3', message: 'clip has no audio_url' });
        } else {
          await this.tryPrepareClipDownload(clip.id);
          const downloaded = await this.downloadArchiveMediaWithFreshUrl(clip, 'mp3', clip.audio_url, defaultMp3Path);
          entry.mp3_path = downloaded.path;
          entry.mp3_integrity = downloaded.integrity;
          entry.retry_counts = {
            ...(entry.retry_counts || {}),
            mp3: downloaded.attempts - 1,
            mp3_url_refresh: downloaded.refreshed_url ? 1 : 0,
          };
          entry.downloaded_formats.push('mp3');
          entry.completed_formats.push('mp3');
        }
      } catch (error: any) {
        entry.errors.push({ format: 'mp3', message: error?.message || String(error) });
      } finally {
        stageTimings.mp3 = Date.now() - stageStartedAt;
      }
    }

    if (formats.includes('wav')) {
      const wavPath = previousEntry?.wav_path || path.join(archiveDir, `${basename}.wav`);
      const stageStartedAt = Date.now();
      try {
        const defaultWavPath = path.join(archiveDir, `${basename}.wav`);
        const reusableWavPath = await this.fileStillAvailable(wavPath, 'wav')
          ? wavPath
          : await this.fileStillAvailable(defaultWavPath, 'wav')
            ? defaultWavPath
            : undefined;
        if (resume && skipExisting && reusableWavPath) {
          entry.wav_path = reusableWavPath;
          entry.wav_integrity = await this.collectFileIntegrity(reusableWavPath, 'wav');
          entry.existing_formats.push('wav');
          entry.completed_formats.push('wav');
        } else if (options.dry_run) {
          entry.wav_path = reusableWavPath || defaultWavPath;
          entry.planned_formats.push('wav');
        } else if (skipExisting && reusableWavPath) {
          entry.wav_path = reusableWavPath;
          entry.wav_integrity = await this.collectFileIntegrity(reusableWavPath, 'wav');
          entry.existing_formats.push('wav');
          entry.completed_formats.push('wav');
        } else {
          await this.tryPrepareClipDownload(clip.id);
          const wavData = clip.wav_file_url
            ? { wav_file_url: clip.wav_file_url }
            : await this.ensureWavFile(
                clip.id,
                Number(options.wav_poll_interval_seconds) > 0 ? Number(options.wav_poll_interval_seconds) : 3,
                Number(options.wav_max_poll_attempts) > 0 ? Number(options.wav_max_poll_attempts) : 20,
              );
          if (wavData.wav_file_url) {
            clip.wav_file_url = wavData.wav_file_url;
            const downloaded = await this.downloadArchiveMediaWithFreshUrl(clip, 'wav', wavData.wav_file_url, defaultWavPath);
            entry.wav_path = downloaded.path;
            entry.wav_integrity = downloaded.integrity;
            entry.retry_counts = {
              ...(entry.retry_counts || {}),
              wav: downloaded.attempts - 1,
              wav_poll: 'poll_attempts' in wavData ? wavData.poll_attempts : 0,
              wav_url_refresh: downloaded.refreshed_url ? 1 : 0,
            };
            entry.downloaded_formats.push('wav');
            entry.completed_formats.push('wav');
          } else {
            entry.errors.push({ format: 'wav', message: 'Suno did not return wav_file_url before polling ended' });
          }
        }
      } catch (error: any) {
        entry.errors.push({ format: 'wav', message: error?.message || String(error) });
      } finally {
        stageTimings.wav = Date.now() - stageStartedAt;
      }
    }

    if (options.download_covers) {
      const coverPath = previousEntry?.cover_path || path.join(archiveDir, `${basename}.jpg`);
      const stageStartedAt = Date.now();
      try {
        const defaultCoverPath = path.join(archiveDir, `${basename}.jpg`);
        const reusableCoverPath = await this.fileStillAvailable(coverPath, 'cover')
          ? coverPath
          : await this.fileStillAvailable(defaultCoverPath, 'cover')
            ? defaultCoverPath
            : undefined;
        if (resume && skipExisting && reusableCoverPath) {
          entry.cover_path = reusableCoverPath;
          entry.cover_integrity = await this.collectFileIntegrity(reusableCoverPath, 'cover');
          entry.cover_existing = true;
        } else if (options.dry_run) {
          entry.cover_path = reusableCoverPath || defaultCoverPath;
          entry.cover_planned = true;
        } else if (skipExisting && reusableCoverPath) {
          entry.cover_path = reusableCoverPath;
          entry.cover_integrity = await this.collectFileIntegrity(reusableCoverPath, 'cover');
          entry.cover_existing = true;
        } else if (!clip.image_url) {
          entry.errors.push({ format: 'cover', message: 'clip has no image_url' });
        } else {
          const downloaded = await this.downloadArchiveMediaWithFreshUrl(clip, 'cover', clip.image_url, defaultCoverPath);
          entry.cover_path = downloaded.path;
          entry.cover_integrity = downloaded.integrity;
          entry.retry_counts = {
            ...(entry.retry_counts || {}),
            cover: downloaded.attempts - 1,
            cover_url_refresh: downloaded.refreshed_url ? 1 : 0,
          };
          entry.cover_downloaded = true;
        }
      } catch (error: any) {
        entry.errors.push({ format: 'cover', message: error?.message || String(error) });
      } finally {
        stageTimings.cover = Date.now() - stageStartedAt;
      }
    }

    entry.metadata_path = previousEntry?.metadata_path || path.join(archiveDir, 'metadata.json');
    entry.archive_status = this.archiveStatus(entry);
    if (!options.dry_run) {
      const stageStartedAt = Date.now();
      try {
        await this.writeJsonFile(entry.metadata_path, this.clipMetadataForArchive(clip, entry));
      } catch (error: any) {
        entry.errors.push({ format: 'metadata', message: error?.message || String(error) });
        entry.archive_status = this.archiveStatus(entry);
      } finally {
        stageTimings.metadata = Date.now() - stageStartedAt;
      }
    }
    entry.stage_timings_ms = stageTimings;

    return entry;
  }

  private normalizeExistingArchiveEntries(existingManifest: any): Map<string, AccountArchiveEntry> {
    const byId = new Map<string, AccountArchiveEntry>();
    const fromClipsObject = existingManifest?.clips && typeof existingManifest.clips === 'object'
      ? Object.values(existingManifest.clips)
      : [];
    const fromEntriesArray = Array.isArray(existingManifest?.entries)
      ? existingManifest.entries
      : [];

    for (const raw of [...fromClipsObject, ...fromEntriesArray]) {
      const entry = raw as AccountArchiveEntry;
      if (!entry?.id) continue;
      byId.set(entry.id, {
        ...entry,
        requested_formats: Array.isArray(entry.requested_formats) ? entry.requested_formats : [],
        completed_formats: Array.isArray(entry.completed_formats) ? entry.completed_formats : [],
        downloaded_formats: Array.isArray(entry.downloaded_formats) ? entry.downloaded_formats : [],
        existing_formats: Array.isArray(entry.existing_formats) ? entry.existing_formats : [],
        planned_formats: Array.isArray(entry.planned_formats) ? entry.planned_formats : [],
        archive_status: entry.archive_status || this.archiveStatus({
          ...entry,
          requested_formats: Array.isArray(entry.requested_formats) ? entry.requested_formats : [],
          completed_formats: Array.isArray(entry.completed_formats) ? entry.completed_formats : [],
          downloaded_formats: Array.isArray(entry.downloaded_formats) ? entry.downloaded_formats : [],
          existing_formats: Array.isArray(entry.existing_formats) ? entry.existing_formats : [],
          planned_formats: Array.isArray(entry.planned_formats) ? entry.planned_formats : [],
          errors: Array.isArray(entry.errors) ? entry.errors : [],
        }),
        errors: Array.isArray(entry.errors) ? entry.errors : [],
      });
    }

    return byId;
  }

  private runSummaryFromResult(result: AccountArchiveResult): AccountArchiveRunSummary {
    return {
      run_id: result.run_id,
      started_at: result.started_at,
      completed_at: result.completed_at,
      dry_run: result.dry_run,
      resume: result.resume,
      redownload: result.redownload,
      formats: result.formats,
      listed_count: result.listed_count,
      downloaded_mp3: result.downloaded_mp3,
      downloaded_wav: result.downloaded_wav,
      downloaded_covers: result.downloaded_covers,
      existing_mp3: result.existing_mp3,
      existing_wav: result.existing_wav,
      existing_covers: result.existing_covers,
      skipped: result.skipped,
      failed: result.failed,
      target_complete: result.target_complete,
      completed_count: result.completed_count,
      listing_complete: result.listing.account_scan_complete,
      stop_reason: result.listing.stop_reason,
      concurrency: result.concurrency,
    };
  }

  private buildArchiveManifest(
    existingManifest: any,
    result: AccountArchiveResult,
    entriesById: Map<string, AccountArchiveEntry>,
  ): Record<string, any> {
    const allEntries = [...entriesById.values()].sort((a, b) => {
      const dateOrder = String(b.created_at || '').localeCompare(String(a.created_at || ''));
      return dateOrder || String(a.id).localeCompare(String(b.id));
    });
    const maxRunHistory = Math.min(
      Math.max(Number(result.max_run_history || ACCOUNT_ARCHIVE_DEFAULT_MAX_RUN_HISTORY), 1),
      1000,
    );
    const runs = Array.isArray(existingManifest?.runs)
      ? existingManifest.runs.filter((run: any) => run?.run_id !== result.run_id)
      : [];
    runs.push(this.runSummaryFromResult(result));
    runs.sort((a: AccountArchiveRunSummary, b: AccountArchiveRunSummary) =>
      String(a.started_at || '').localeCompare(String(b.started_at || '')),
    );
    if (runs.length > maxRunHistory) runs.splice(0, runs.length - maxRunHistory);

    const clips: Record<string, AccountArchiveEntry> = {};
    for (const entry of allEntries) {
      clips[entry.id] = entry;
    }
    const mediaFiles = this.buildArchiveMediaFiles(entriesById);

    const countByStatus = (status: AccountArchiveEntry['archive_status']) =>
      allEntries.filter((entry) => entry.archive_status === status).length;

    return {
      schema_version: 4,
      archive_type: 'suno_account_archive',
      generated_by: 'suno-api-final',
      created_at: existingManifest?.created_at || result.started_at,
      updated_at: new Date().toISOString(),
      output_dir: result.output_dir,
      manifest_path: result.manifest_path,
      summary: {
        total_known_clips: allEntries.length,
        completed: countByStatus('completed'),
        partial: countByStatus('partial'),
        failed: countByStatus('failed'),
        skipped: countByStatus('skipped'),
        planned: countByStatus('planned'),
        mp3_ready: allEntries.filter((entry) => entry.completed_formats.includes('mp3')).length,
        wav_ready: allEntries.filter((entry) => entry.completed_formats.includes('wav')).length,
        media_file_count: mediaFiles.length,
        last_run_id: result.run_id,
      },
      latest_listing: {
        pages: result.listing.pages,
        page_size: result.listing.page_size,
        requested_limit: result.listing.requested_limit,
        target_complete: result.listing.target_complete,
        complete_clip_count: result.listing.complete_clip_count,
        skipped_incomplete_count: result.listing.skipped_incomplete_count,
        has_more: result.listing.has_more,
        complete: result.listing.complete,
        account_scan_complete: result.listing.account_scan_complete,
        stop_reason: result.listing.stop_reason,
        next_cursor: result.listing.next_cursor,
        listed_count: result.listed_count,
      },
      media_files: mediaFiles,
      runs,
      clips,
    };
  }

  private buildArchiveMediaFiles(
    entriesById: Map<string, AccountArchiveEntry>,
  ): Array<Record<string, any>> {
    const mediaFiles: any[] = [];
    for (const entry of entriesById.values()) {
      const audioFiles: Array<{ format: AccountArchiveFormat; path?: string }> = [
        { format: 'mp3', path: entry.mp3_path },
        { format: 'wav', path: entry.wav_path },
      ];
      for (const file of audioFiles) {
        if (!file.path || !entry.completed_formats.includes(file.format)) continue;
        mediaFiles.push({
          media_id: `${entry.id}:${file.format}`,
          clip_id: entry.id,
          suno_id: entry.id,
          file_name: path.basename(file.path),
          file_path: file.path,
          format: file.format,
          suno_page_url: entry.suno_page_url || this.sunoSongUrl(entry.id),
          suno_source: entry.suno_source || 'suno',
          title: entry.title,
          status: entry.status,
          archive_status: entry.archive_status,
          created_at: entry.created_at,
          model_name: entry.model_name,
          integrity: file.format === 'mp3' ? entry.mp3_integrity : entry.wav_integrity,
          paired_files: {
            mp3_path: entry.mp3_path,
            wav_path: entry.wav_path,
            cover_path: entry.cover_path,
            metadata_path: entry.metadata_path,
          },
        });
      }
    }
    mediaFiles.sort((a, b) => String(a.file_path).localeCompare(String(b.file_path)));
    return mediaFiles;
  }

  private sanitizedArchiveRunReport(result: AccountArchiveResult): Record<string, any> {
    return {
      schema_version: 1,
      run_type: 'suno_account_archive_run',
      note: 'Signed media URLs are intentionally not stored in this run report.',
      run_id: result.run_id,
      output_dir: result.output_dir,
      manifest_path: result.manifest_path,
      run_report_path: result.run_report_path,
      started_at: result.started_at,
      completed_at: result.completed_at,
      listed_count: result.listed_count,
      downloaded_mp3: result.downloaded_mp3,
      downloaded_wav: result.downloaded_wav,
      downloaded_covers: result.downloaded_covers,
      existing_mp3: result.existing_mp3,
      existing_wav: result.existing_wav,
      existing_covers: result.existing_covers,
      skipped: result.skipped,
      failed: result.failed,
      target_complete: result.target_complete,
      completed_count: result.completed_count,
      concurrency: result.concurrency,
      dry_run: result.dry_run,
      resume: result.resume,
      redownload: result.redownload,
      formats: result.formats,
      listing: {
        pages: result.listing.pages,
        page_size: result.listing.page_size,
        requested_limit: result.listing.requested_limit,
        target_complete: result.listing.target_complete,
        complete_clip_count: result.listing.complete_clip_count,
        skipped_incomplete_count: result.listing.skipped_incomplete_count,
        next_cursor: result.listing.next_cursor,
        has_more: result.listing.has_more,
        complete: result.listing.complete,
        account_scan_complete: result.listing.account_scan_complete,
        stop_reason: result.listing.stop_reason,
        filters: result.listing.filters,
      },
      entries: result.entries,
    };
  }

  private async acquireArchiveLock(
    outputDir: string,
    recoverStaleLock: boolean,
  ): Promise<{ lock_path: string; release: () => Promise<void> }> {
    const lockPath = path.join(outputDir, '.archive.lock');
    const lockPayload = {
      pid: process.pid,
      acquired_at: new Date().toISOString(),
      hostname: process.env.HOSTNAME || process.env.COMPUTERNAME || 'local',
    };
    const createLock = async () => {
      const handle = await fs.open(lockPath, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify(lockPayload, null, 2));
        await handle.sync();
      } finally {
        await handle.close();
      }
      return {
        lock_path: lockPath,
        release: async () => {
          await fs.rm(lockPath, { force: true });
        },
      };
    };
    try {
      return await createLock();
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
    }

    let existing: any = {};
    let ageSeconds = Number.POSITIVE_INFINITY;
    try {
      existing = JSON.parse(await fs.readFile(lockPath, 'utf8'));
      const stat = await fs.stat(lockPath);
      ageSeconds = Math.max(0, (Date.now() - stat.mtimeMs) / 1000);
    } catch {
      // Malformed stale locks still require explicit recovery.
    }
    const ownerPid = Number(existing?.pid);
    let ownerAlive = false;
    if (Number.isInteger(ownerPid) && ownerPid > 0) {
      try {
        process.kill(ownerPid, 0);
        ownerAlive = true;
      } catch (processError: any) {
        ownerAlive = processError?.code === 'EPERM';
      }
    }
    if (recoverStaleLock && !ownerAlive && ageSeconds >= ACCOUNT_ARCHIVE_DEFAULT_LOCK_STALE_SECONDS) {
      await fs.rm(lockPath, { force: true });
      return createLock();
    }
    const owner = Number.isInteger(ownerPid) && ownerPid > 0 ? `pid=${ownerPid}` : 'unknown owner';
    throw new Error(
      `Archive output is already locked (${owner}, age=${Math.round(ageSeconds)}s). ` +
      `Wait for the active run, or use --recover-stale-lock only after ${ACCOUNT_ARCHIVE_DEFAULT_LOCK_STALE_SECONDS}s when no owner is running.`,
    );
  }

  async archiveAccountClips(options: ArchiveAccountOptions = {}): Promise<AccountArchiveResult> {
    const formats = this.normalizeArchiveFormats(options.formats);
    const startedAt = new Date().toISOString();
    const runId = buildPathTimestamp();
    const resume = options.resume !== false;
    const redownload = options.skip_existing === false;
    const concurrency = Math.min(
      Math.max(Number(options.concurrency || ACCOUNT_ARCHIVE_DEFAULT_CONCURRENCY), 1),
      ACCOUNT_ARCHIVE_MAX_CONCURRENCY,
    );
    const maxRunHistory = Math.min(
      Math.max(Number(options.max_run_history || ACCOUNT_ARCHIVE_DEFAULT_MAX_RUN_HISTORY), 1),
      1000,
    );
    const outputDir = path.resolve(options.output_dir || getDefaultAccountArchiveRoot());
    const manifestPath = path.join(outputDir, 'manifest.json');
    const runReportPath = path.join(outputDir, 'runs', `${runId}.json`);
    await fs.mkdir(outputDir, { recursive: true });
    const archiveLock = await this.acquireArchiveLock(outputDir, Boolean(options.recover_stale_lock));

    try {
      const existingManifest = resume ? await this.readJsonFile(manifestPath) || {} : {};
      const entriesById = this.normalizeExistingArchiveEntries(existingManifest);

      const listing = await this.listAccountClips(options);
      await this.emitArchiveProgress(options, {
        type: 'listed',
        total: listing.clips.length,
        message: `listed ${listing.clips.length} clips across ${listing.pages} page(s); stop_reason=${listing.stop_reason}`,
      });

      const result: AccountArchiveResult = {
        run_id: runId,
        output_dir: outputDir,
        manifest_path: manifestPath,
        run_report_path: runReportPath,
        started_at: startedAt,
        listed_count: listing.clips.length,
        downloaded_mp3: 0,
        downloaded_wav: 0,
        downloaded_covers: 0,
        existing_mp3: 0,
        existing_wav: 0,
        existing_covers: 0,
        skipped: 0,
        failed: 0,
        target_complete: listing.target_complete,
        completed_count: 0,
        concurrency,
        max_run_history: maxRunHistory,
        dry_run: Boolean(options.dry_run),
        resume,
        redownload,
        formats,
        listing,
        entries: [],
      };

      let persistTail: Promise<void> = Promise.resolve();
      const persistManifest = async () => {
        const persist = async () => {
          const manifest = this.buildArchiveManifest(existingManifest, result, entriesById);
          await this.writeJsonFile(manifestPath, manifest);
          await this.writeJsonFile(runReportPath, this.sanitizedArchiveRunReport(result));
        };
        persistTail = persistTail.then(persist, persist);
        return persistTail;
      };

      const processClip = async (index: number): Promise<void> => {
        const clip = listing.clips[index];
        const previousEntry = entriesById.get(clip.id);
        const startedMs = Date.now();
        await this.emitArchiveProgress(options, {
          type: 'clip_start',
          clip_id: clip.id,
          index: index + 1,
          total: listing.clips.length,
        });

        try {
          const attemptedEntry = await this.downloadClipMedia(clip, outputDir, options, previousEntry);
          attemptedEntry.stage_timings_ms = {
            ...(attemptedEntry.stage_timings_ms || {}),
            total: Date.now() - startedMs,
          };
          const entry = this.mergeArchiveEntry(previousEntry, attemptedEntry, new Date().toISOString());
          entriesById.set(entry.id, entry);
          result.entries.push(entry);

          if (entry.skipped) {
            result.skipped += 1;
            await this.emitArchiveProgress(options, {
              type: 'clip_skip',
              clip_id: clip.id,
              index: index + 1,
              total: listing.clips.length,
              message: entry.skip_reason,
            });
          } else {
            if (entry.downloaded_formats.includes('mp3')) {
              result.downloaded_mp3 += 1;
              await this.emitArchiveProgress(options, {
                type: 'mp3_downloaded',
                clip_id: clip.id,
                index: index + 1,
                total: listing.clips.length,
                path: entry.mp3_path,
              });
            }
            if (entry.downloaded_formats.includes('wav')) {
              result.downloaded_wav += 1;
              await this.emitArchiveProgress(options, {
                type: 'wav_downloaded',
                clip_id: clip.id,
                index: index + 1,
                total: listing.clips.length,
                path: entry.wav_path,
              });
            }
            if (entry.existing_formats.includes('mp3')) result.existing_mp3 += 1;
            if (entry.existing_formats.includes('wav')) result.existing_wav += 1;
            if (entry.cover_downloaded && !entry.errors.some((error) => error.format === 'cover')) {
              result.downloaded_covers += 1;
              await this.emitArchiveProgress(options, {
                type: 'cover_downloaded',
                clip_id: clip.id,
                index: index + 1,
                total: listing.clips.length,
                path: entry.cover_path,
              });
            }
            if (entry.cover_existing) result.existing_covers += 1;
            if (entry.errors.length > 0) {
              result.failed += 1;
              await this.emitArchiveProgress(options, {
                type: 'clip_error',
                clip_id: clip.id,
                index: index + 1,
                total: listing.clips.length,
                error: entry.errors.map((item) => `${item.format || 'clip'}: ${item.message}`).join('; '),
              });
            } else {
              await this.emitArchiveProgress(options, {
                type: 'clip_done',
                clip_id: clip.id,
                index: index + 1,
                total: listing.clips.length,
              });
            }
          }

        } catch (error: any) {
          const attemptedEntry: AccountArchiveEntry = {
            id: clip.id,
            title: clip.title,
            status: clip.status,
            created_at: clip.created_at,
            model_name: clip.model_name,
            duration: clip.duration,
            suno_page_url: this.sunoSongUrl(clip.id),
            suno_source: this.inferArchiveSunoSource(clip),
            requested_formats: formats,
            completed_formats: [],
            downloaded_formats: [],
            existing_formats: [],
            planned_formats: [],
            archive_status: 'failed',
            stage_timings_ms: { total: Date.now() - startedMs },
            errors: [{ message: error?.message || String(error) }],
          };
          const entry = this.mergeArchiveEntry(previousEntry, attemptedEntry, new Date().toISOString());
          entriesById.set(entry.id, entry);
          result.entries.push(entry);
          result.failed += 1;
          await this.emitArchiveProgress(options, {
            type: 'clip_error',
            clip_id: clip.id,
            index: index + 1,
            total: listing.clips.length,
            error: entry.errors[0].message,
          });
        }
        await persistManifest();
      };

      await persistManifest();
      let nextIndex = 0;
      const worker = async () => {
        while (true) {
          const index = nextIndex;
          nextIndex += 1;
          if (index >= listing.clips.length) return;
          await processClip(index);
        }
      };
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      await persistTail;
      result.completed_count = result.entries.filter((entry) => entry.archive_status === 'completed').length;
      result.completed_at = new Date().toISOString();
      await persistManifest();
      return result;
    } finally {
      await archiveLock.release();
    }
  }

  private normalizeArchiveFormats(formats?: AccountArchiveFormat[]): AccountArchiveFormat[] {
    const allowed = new Set<AccountArchiveFormat>(['mp3', 'wav']);
    const normalized = (formats && formats.length > 0 ? formats : ['mp3', 'wav'])
      .map((format) => String(format).trim().toLowerCase() as AccountArchiveFormat)
      .filter((format): format is AccountArchiveFormat => allowed.has(format));
    return [...new Set(normalized)];
  }


  private async downloadToFileWithIntegrity(
    url: string,
    filePath: string,
    format?: AccountArchiveFormat | 'cover',
  ): Promise<{ path: string; integrity: AccountArchiveFileIntegrity; attempts: number }> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const partPath = `${filePath}.part`;
    let lastError: any;
    for (let attempt = 1; attempt <= ACCOUNT_ARCHIVE_MAX_DOWNLOAD_ATTEMPTS; attempt++) {
      try {
        let existingBytes = 0;
        try {
          const partStat = await fs.stat(partPath);
          existingBytes = partStat.isFile() ? partStat.size : 0;
        } catch {
          existingBytes = 0;
        }
        const response = await this.client.get(url, {
          responseType: 'stream',
          timeout: 120000,
          headers: existingBytes > 0 ? { Range: `bytes=${existingBytes}-` } : undefined,
        });
        const responseStatus = Number(response.status || 200);
        const contentRange = String(response.headers?.['content-range'] || '');
        const rangeStart = contentRange.match(/^bytes\s+(\d+)-/i)?.[1];
        const append = existingBytes > 0 && responseStatus === 206 && Number(rangeStart) === existingBytes;
        const contentLength = Number(response.headers?.['content-length']);
        const totalMatch = contentRange.match(/\/(\d+)$/);
        const expectedTotal = totalMatch
          ? Number(totalMatch[1])
          : append && Number.isFinite(contentLength)
            ? existingBytes + contentLength
            : Number.isFinite(contentLength) ? contentLength : undefined;

        if (existingBytes > 0 && responseStatus === 206 && !append) {
          await fs.rm(partPath, { force: true });
          if (attempt < ACCOUNT_ARCHIVE_MAX_DOWNLOAD_ATTEMPTS) continue;
          throw new Error(`Server returned an invalid Content-Range while resuming ${filePath}`);
        }
        if (existingBytes > 0 && !append) {
          await fs.rm(partPath, { force: true });
          existingBytes = 0;
        }
        await pipeline(response.data, createWriteStream(partPath, { flags: append ? 'a' : 'w', mode: 0o600 }));
        const partStat = await fs.stat(partPath);
        if (!partStat.isFile() || partStat.size <= 0) {
          throw new Error(`Downloaded response produced an empty file for ${filePath}`);
        }
        if (expectedTotal && partStat.size !== expectedTotal) {
          throw new Error(`Downloaded file size mismatch for ${filePath}: expected ${expectedTotal}, got ${partStat.size}`);
        }
        await fs.rename(partPath, filePath);
        try {
          const integrity = await this.collectFileIntegrity(filePath, format, {
            content_type: String(response.headers?.['content-type'] || '') || undefined,
            content_length: expectedTotal,
          });
          return { path: filePath, integrity, attempts: attempt };
        } catch (error) {
          await fs.rm(filePath, { force: true });
          throw error;
        }
      } catch (error: any) {
        lastError = error;
        if (!this.classifyPollError(error).retryable || attempt >= ACCOUNT_ARCHIVE_MAX_DOWNLOAD_ATTEMPTS) throw error;
        await this.waitBeforeRetry('media_download', error, attempt);
      }
    }
    throw lastError || new Error(`Media download failed: ${filePath}`);
  }

  private async downloadArchiveMediaWithFreshUrl(
    clip: AudioInfo,
    format: AccountArchiveFormat | 'cover',
    url: string,
    filePath: string,
  ): Promise<{ path: string; integrity: AccountArchiveFileIntegrity; attempts: number; refreshed_url: boolean }> {
    try {
      const downloaded = await this.downloadToFileWithIntegrity(url, filePath, format);
      return { ...downloaded, refreshed_url: false };
    } catch (error: any) {
      const status = Number(error?.response?.status || 0);
      if (![401, 403, 404].includes(status)) throw error;
      const refreshedClip = (await this.getFeedByIdsV3([clip.id], 1))[0];
      const refreshedUrl =
        format === 'mp3' ? refreshedClip?.audio_url :
        format === 'wav' ? refreshedClip?.wav_file_url :
        refreshedClip?.image_url;
      if (!refreshedUrl || refreshedUrl === url) throw error;
      Object.assign(clip, refreshedClip);
      const downloaded = await this.downloadToFileWithIntegrity(refreshedUrl, filePath, format);
      return { ...downloaded, refreshed_url: true };
    }
  }

  private async downloadToFile(url: string, filePath: string): Promise<string> {
    const extension = path.extname(filePath).toLowerCase();
    const format: AccountArchiveFormat | 'cover' | undefined =
      extension === '.mp3' ? 'mp3' : extension === '.wav' ? 'wav' : extension === '.jpg' || extension === '.jpeg' ? 'cover' : undefined;
    const result = await this.downloadToFileWithIntegrity(url, filePath, format);
    return result.path;
  }

  async customGenerateAndDownload(input: {
    prompt: string;
    tags?: string;
    title?: string;
    make_instrumental?: boolean;
    model?: string;
    negative_tags?: string;
    project_id?: string;
    project_name?: string;
    output_dir?: string;
    download_mp3?: boolean;
    download_wav?: boolean;
  }): Promise<CreateAndDownloadResult> {
    const clips = await this.create({
      prompt: input.prompt,
      tags: input.tags,
      title: input.title,
      make_instrumental: input.make_instrumental,
      model: input.model,
      wait_audio: true,
      negative_tags: input.negative_tags,
      project_id: input.project_id,
      project_name: input.project_name,
      create_mode: 'custom',
    });

    const stamp = buildPathTimestamp();
    const outputDir = input.output_dir || path.resolve(
      getDefaultOutputRoot(),
      'songs',
      `${stamp}_${this.slugify(input.title)}`,
    );
    await fs.mkdir(outputDir, { recursive: true });

    for (let index = 0; index < clips.length; index++) {
      const clip = clips[index];
      const prefix = `${String(index + 1).padStart(2, '0')}_${this.slugify(clip.title || input.title || clip.id)}_${clip.id}`;
      if ((input.download_mp3 ?? true) && clip.audio_url) {
        await this.prepareClipDownload(clip.id);
        clip.mp3_path = await this.downloadToFile(clip.audio_url, path.join(outputDir, `${prefix}.mp3`));
      }
      if (input.download_wav ?? true) {
        await this.prepareClipDownload(clip.id);
        const wavData = clip.wav_file_url ? { wav_file_url: clip.wav_file_url } : await this.ensureWavFile(clip.id);
        if (wavData.wav_file_url) {
          clip.wav_file_url = wavData.wav_file_url;
          clip.wav_path = await this.downloadToFile(wavData.wav_file_url, path.join(outputDir, `${prefix}.wav`));
        }
      }
    }

    return {
      song_ids: clips.map((clip) => clip.id),
      output_dir: outputDir,
      clips,
    };
  }

  async customGenerate(
    prompt: string,
    tags?: string,
    title?: string,
    makeInstrumental?: boolean,
    model?: string,
    waitAudio: boolean = false,
    negativeTags?: string,
    options?: { project_id?: string; project_name?: string }
  ): Promise<AudioInfo[]> {
    return this.create({
      prompt,
      tags,
      title,
      make_instrumental: makeInstrumental,
      model,
      wait_audio: waitAudio,
      negative_tags: negativeTags,
      project_id: options?.project_id,
      project_name: options?.project_name,
      create_mode: 'custom',
    });
  }

  async generate(
    prompt: string,
    makeInstrumental?: boolean,
    model?: string,
    waitAudio: boolean = false
  ): Promise<AudioInfo[]> {
    return this.create({
      prompt,
      make_instrumental: makeInstrumental,
      model,
      wait_audio: waitAudio,
      create_mode: 'prompt',
    });
  }

  // ========== Search API ==========
  async omnisearch(query: string, limit: number = 20): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.post(
      `${SunoApi.BASE_URL}/api/unified/search/omnisearch`,
      { query, limit },
      { timeout: 30000 }
    );
    return response.data;
  }

  async getExploreFeed(limit: number = 50): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.post(
      `${SunoApi.BASE_URL}/api/unified/homepage/explore`,
      { limit },
      { timeout: 30000 }
    );
    return response.data;
  }

  // ========== User APIs ==========
  async getUserSessionId(): Promise<{ session_id: string }> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/user/get_user_session_id/`,
      { timeout: 15000 }
    );
    return response.data;
  }

  async getTosAcceptance(): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/user/tos_acceptance`,
      { timeout: 15000 }
    );
    return response.data;
  }

  async setUserConfig(config: Record<string, any>): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.post(
      `${SunoApi.BASE_URL}/api/user/user_config/`,
      config,
      { timeout: 15000 }
    );
    return response.data;
  }

  async getUserInfo(username: string): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/profiles/${username}/info`,
      { timeout: 15000 }
    );
    return response.data;
  }

  async getPinnedClips(): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/profiles/pinned-clips`,
      { timeout: 15000 }
    );
    return response.data;
  }

  // ========== Billing APIs ==========
  async getPlanDescriptions(): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/billing/usage-plan-descriptions/`,
      { timeout: 15000 }
    );
    return response.data;
  }

  async getPlanComparison(): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/billing/usage-plan-web-table-comparison/`,
      { timeout: 15000 }
    );
    return response.data;
  }

  async getPlanFaq(): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/billing/usage-plan-faq/`,
      { timeout: 15000 }
    );
    return response.data;
  }

  // ========== Personalization APIs ==========
  async getPersonalizationMemory(): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/personalization/memory`,
      { timeout: 15000 }
    );
    return response.data;
  }

  async getPersonalizationSettings(): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/personalization/settings`,
      { timeout: 15000 }
    );
    return response.data;
  }

  // ========== Prompts APIs ==========
  async getLyricsPrompts(page: number = 0, perPage: number = 100): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/prompts/`,
      { params: { page, per_page: perPage, filter_prompt_type: 'lyrics' }, timeout: 15000 }
    );
    return response.data;
  }

  async getStyleTags(page: number = 0, perPage: number = 100): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/prompts/`,
      { params: { page, per_page: perPage, filter_prompt_type: 'tags' }, timeout: 15000 }
    );
    return response.data;
  }

  // ========== Notification APIs ==========
  async getNotifications(): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/notification/v2`,
      { timeout: 15000 }
    );
    return response.data;
  }

  async getNotificationBadgeCount(): Promise<{ count: number }> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/notification/v2/badge-count`,
      { timeout: 15000 }
    );
    return response.data;
  }

  // ========== Other APIs ==========
  async getContests(): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/contests/`,
      { timeout: 15000 }
    );
    return response.data;
  }

  async getCustomModelPending(): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/custom-model/pending/`,
      { timeout: 15000 }
    );
    return response.data;
  }

  async getVideoGenPendingBatches(): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.post(
      `${SunoApi.BASE_URL}/api/video_gen/pending_batches`,
      {},
      { timeout: 15000 }
    );
    return response.data;
  }

  async getSession(): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/session/`,
      { timeout: 15000 }
    );
    return response.data;
  }

  async getModals(): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/modals`,
      { timeout: 15000 }
    );
    return response.data;
  }

  async getShareNudge(): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/cms/nudges/share-nudge`,
      { timeout: 15000 }
    );
    return response.data;
  }

  async getPublishNudge(): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/cms/nudges/publish-nudge`,
      { timeout: 15000 }
    );
    return response.data;
  }

  async getShareStats(contentType: string = 'song'): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/share/stats`,
      { params: { content_type: contentType }, timeout: 15000 }
    );
    return response.data;
  }

  // ========== Challenge/Progress APIs ==========
  async getChallengeProgress(): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/challenge/progress`,
      { timeout: 15000 }
    );
    return response.data;
  }

  // ========== Project APIs ==========
  async getDefaultProject(): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/project/default`,
      { timeout: 15000 }
    );
    return response.data;
  }

  async getDefaultProjectPinnedClips(): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/project/default/pinned-clips`,
      { timeout: 15000 }
    );
    return response.data;
  }

  async getProjects(page: number = 1, sort: string = 'max_created_at_last_updated_clip'): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/project/me`,
      { params: { page, sort, show_trashed: false, exclude_shared: false }, timeout: 15000 }
    );
    return response.data;
  }

  // ========== Billing ==========
  async getEligibleDiscounts(): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/billing/eligible-discounts`,
      { timeout: 15000 }
    );
    return response.data;
  }

  // ========== Prompts ==========
  async getPromptSuggestions(): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/prompts/suggestions`,
      { timeout: 15000 }
    );
    return response.data;
  }
}

export const sunoApi = async (rawCookies?: string): Promise<SunoApi> => {
  return await new SunoApi(rawCookies).init();
};
