export interface SharedCaptchaProxy {
  protocol: 'http' | 'https';
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export type CaptchaVersion = 1 | 2;
export type CaptchaProvider = 'hcaptcha' | 'turnstile';

export interface TurnstileTaskOptions {
  websiteURL: string;
  websiteKey: string;
  action?: string;
  data?: string;
  pagedata?: string;
  sharedProxy?: SharedCaptchaProxy;
}

export interface HCaptchaRequestOptions {
  apiKey: string;
  websiteURL: string;
  websiteKey: string;
  userAgent: string;
  rqdata?: string;
  apiDomain?: string;
  sharedProxy?: SharedCaptchaProxy;
}

export interface CoordinatesTaskOptions {
  body: string;
  comment?: string;
  imgInstructions?: string;
  minClicks?: number;
  maxClicks?: number;
}

export interface ClientIdentityHeaders {
  'User-Agent': string;
  'sec-ch-ua': string;
  'sec-ch-ua-mobile': string;
  'sec-ch-ua-platform': string;
}

export function normalizeCaptchaVersion(value: unknown): CaptchaVersion {
  return Number(value) === 2 ? 2 : 1;
}

export function captchaProviderForVersion(version: CaptchaVersion): CaptchaProvider {
  return version === 2 ? 'turnstile' : 'hcaptcha';
}

export function parseSharedCaptchaProxy(value?: string): SharedCaptchaProxy | undefined {
  const raw = String(value || '').trim();
  if (!raw) return undefined;

  const parsed = new URL(raw);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('SUNO_CREATE_CAPTCHA_SHARED_PROXY_URL must use http:// or https://');
  }

  return {
    protocol: parsed.protocol.slice(0, -1) as 'http' | 'https',
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
  };
}

export function buildTurnstileTask(options: TurnstileTaskOptions): Record<string, unknown> {
  const task: Record<string, unknown> = {
    type: options.sharedProxy ? 'TurnstileTask' : 'TurnstileTaskProxyless',
    websiteURL: options.websiteURL,
    websiteKey: options.websiteKey,
  };

  if (options.action) task.action = options.action;
  if (options.data) task.data = options.data;
  if (options.pagedata) task.pagedata = options.pagedata;

  if (options.sharedProxy) {
    task.proxyType = options.sharedProxy.protocol === 'https' ? 'http' : options.sharedProxy.protocol;
    task.proxyAddress = options.sharedProxy.host;
    task.proxyPort = options.sharedProxy.port;
    if (options.sharedProxy.username) task.proxyLogin = options.sharedProxy.username;
    if (options.sharedProxy.password) task.proxyPassword = options.sharedProxy.password;
  }

  return task;
}

export function buildHCaptchaRequestParams(options: HCaptchaRequestOptions): Record<string, string | number> {
  const params: Record<string, string | number> = {
    key: options.apiKey,
    method: 'hcaptcha',
    sitekey: options.websiteKey,
    pageurl: options.websiteURL,
    invisible: 1,
    userAgent: options.userAgent,
    json: 1,
  };

  if (options.rqdata) params.data = options.rqdata;
  if (options.apiDomain) params.domain = options.apiDomain;
  if (options.sharedProxy) {
    const auth = options.sharedProxy.username
      ? `${encodeURIComponent(options.sharedProxy.username)}:${encodeURIComponent(options.sharedProxy.password || '')}@`
      : '';
    params.proxy = `${auth}${options.sharedProxy.host}:${options.sharedProxy.port}`;
    params.proxytype = options.sharedProxy.protocol.toUpperCase();
  }

  return params;
}

export function buildCoordinatesTask(options: CoordinatesTaskOptions): Record<string, string | number> {
  const body = String(options.body || '').trim();
  if (!body) throw new Error('CoordinatesTask requires a base64 image body');
  const task: Record<string, string | number> = { type: 'CoordinatesTask', body };
  if (options.comment) task.comment = options.comment;
  if (options.imgInstructions) task.imgInstructions = options.imgInstructions;
  if (Number.isFinite(options.minClicks)) task.minClicks = Math.max(1, Number(options.minClicks));
  if (Number.isFinite(options.maxClicks)) task.maxClicks = Math.max(1, Number(options.maxClicks));
  return task;
}

export function clientIdentityHeaders(userAgent: string): ClientIdentityHeaders {
  const ua = String(userAgent || '').trim();
  if (!ua) throw new Error('2Captcha returned an empty userAgent');

  const chromeVersion = ua.match(/(?:Chrome|Chromium)\/(\d+)/)?.[1] || '99';
  const mobile = /\bMobile\b|\bAndroid\b/i.test(ua);
  const platform = /Windows/i.test(ua)
    ? 'Windows'
    : /Android/i.test(ua)
      ? 'Android'
      : /Linux/i.test(ua) && !/Android/i.test(ua)
        ? 'Linux'
        : /(?:Macintosh|Mac OS X)/i.test(ua)
          ? 'macOS'
          : 'Unknown';

  return {
    'User-Agent': ua,
    'sec-ch-ua': `"Not_A Brand";v="99", "Chromium";v="${chromeVersion}", "Google Chrome";v="${chromeVersion}"`,
    'sec-ch-ua-mobile': mobile ? '?1' : '?0',
    'sec-ch-ua-platform': `"${platform}"`,
  };
}
