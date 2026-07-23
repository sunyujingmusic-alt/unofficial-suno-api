import axios, { AxiosInstance, AxiosProxyConfig } from 'axios';
import * as cookie from 'cookie';
import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { logger, sleep } from '@/lib/utils';
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

export const DEFAULT_MODEL = 'chirp-fenix';  // V5.5 browser-captured default model as of 2026-04-08

export function getDefaultWorkspaceName(): string | undefined {
  const configured = (
    process.env.SUNO_DEFAULT_WORKSPACE ||
    process.env.SUNO_DEFAULT_PROJECT_NAME ||
    process.env.SUNO_WORKSPACE ||
    ''
  ).trim();
  return configured || undefined;
}

export function getDefaultOutputRoot(): string {
  const configured = (
    process.env.SUNO_OUTPUT_DIR ||
    process.env.SUNO_OUTPUT_ROOT ||
    ''
  ).trim();
  return configured || path.resolve(process.cwd(), 'output');
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
  raw?: any;
}

export interface CreateAndDownloadResult {
  song_ids: string[];
  output_dir: string;
  clips: AudioInfo[];
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


class SunoApi {
  private summarizeToken(token?: string | null): string {
    if (!token) return 'none';
    const hash = createHash('sha256').update(token).digest('hex').slice(0, 12);
    return `len=${token.length},sha256=${hash}`;
  }

  private static BASE_URL = 'https://studio-api.prod.suno.com';
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
      if (url.includes(SunoApi.BASE_URL)) {
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
        if (status === 401 && String(url).includes(SunoApi.BASE_URL)) {
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

  private classifyPollError(error: any): { status: number; code?: string; message: string; retryable: boolean } {
    const status = Number(error?.response?.status || 0);
    const code = typeof error?.code === 'string' ? error.code : undefined;
    const message = String(error?.message || error);
    const retryable =
      [502, 503, 504].includes(status) ||
      ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(code || '') ||
      code === 'ECONNABORTED' ||
      message.includes('timeout');

    return { status, code, message, retryable };
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
        await sleep(attempt);
      }
    }

    throw lastError || new Error('feed/v3 poll failed without a captured error');
  }

  async create(options: CreateOptions): Promise<AudioInfo[]> {
    await this.keepAlive(false);
    const requestedWorkspaceName = (options.project_name || '').trim() || getDefaultWorkspaceName();
    const workspace = options.project_id
      ? await this.resolveWorkspace({ project_id: options.project_id })
      : requestedWorkspaceName
        ? await this.ensureWorkspace(requestedWorkspaceName)
        : null;

    if (!workspace?.id && requestedWorkspaceName) {
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
      cover_clip_id: null,
      cover_start_s: null,
      cover_end_s: null,
      persona_id: null,
      artist_clip_id: null,
      artist_start_s: null,
      artist_end_s: null,
      continue_clip_id: null,
      continued_aligned_prompt: null,
      continue_at: null,
      transaction_uuid: randomUUID(),
    };

    logger.info('generateSongs summary: ' + JSON.stringify({
      isCustom: createMode === 'custom',
      title: options.title,
      hasPrompt: Boolean(options.prompt),
      hasTags: Boolean(options.tags),
      make_instrumental: Boolean(options.make_instrumental),
      wait_audio: Boolean(options.wait_audio),
      requested_workspace_name: requestedWorkspaceName || null,
      resolved_workspace_id: workspace?.id || null,
      resolved_workspace_name: workspace?.name || null,
      project_id: payload.project_id,
      hasToken: Boolean(payload.token),
      token_summary: this.summarizeToken(createToken),
      token_age_ms: createToken ? (Date.now() - this.createCaptchaTokenCachedAt) : null,
      mv: payload.mv,
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

  private slugify(input?: string): string {
    return (input || 'untitled')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || 'untitled';
  }

  async prepareClipDownload(clipId: string): Promise<void> {
    await this.keepAlive(false);
    await this.client.post(
      `${SunoApi.BASE_URL}/api/billing/clips/${clipId}/download/`,
      {},
      { timeout: 10000 }
    );
  }

  async convertWav(clipId: string): Promise<void> {
    await this.keepAlive(false);
    await this.client.post(
      `${SunoApi.BASE_URL}/api/gen/${clipId}/convert_wav/`,
      {},
      { timeout: 10000 }
    );
  }

  async getWavFile(clipId: string): Promise<{ wav_file_url?: string }> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/gen/${clipId}/wav_file/`,
      { timeout: 10000 }
    );
    return response.data || {};
  }

  async ensureWavFile(clipId: string, pollIntervalSeconds: number = 3, maxPollAttempts: number = 20): Promise<{ wav_file_url?: string }> {
    await this.convertWav(clipId);
    for (let i = 0; i < maxPollAttempts; i++) {
      const wavData = await this.getWavFile(clipId);
      if (wavData.wav_file_url) {
        return wavData;
      }
      if (i < maxPollAttempts - 1) {
        await sleep(pollIntervalSeconds);
      }
    }
    return {};
  }


  private async downloadToFile(url: string, filePath: string): Promise<string> {
    const response = await this.client.get(url, {
      responseType: 'arraybuffer',
      timeout: 120000,
    });
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, Buffer.from(response.data));
    return filePath;
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
    const outputDir = input.output_dir || path.resolve(getDefaultOutputRoot(), `${stamp}_${this.slugify(input.title)}`);
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
