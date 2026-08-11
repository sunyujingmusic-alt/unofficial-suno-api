import assert from 'node:assert/strict';
import {
  buildHCaptchaRequestParams,
  buildCoordinatesTask,
  buildTurnstileTask,
  captchaProviderForVersion,
  clientIdentityHeaders,
  normalizeCaptchaVersion,
  parseSharedCaptchaProxy,
} from '../src/lib/captchaContext.ts';

const proxy = parseSharedCaptchaProxy('http://example%40user:example%40password@proxy.example.invalid:8080');
assert.deepEqual(proxy, {
  protocol: 'http',
  host: 'proxy.example.invalid',
  port: 8080,
  username: 'example@user',
  password: 'example@password',
});

assert.deepEqual(
  buildTurnstileTask({
    websiteURL: 'https://suno.com/create',
    websiteKey: 'site-key',
    action: 'managed',
    data: 'cdata',
    pagedata: 'page-data',
    sharedProxy: proxy,
  }),
  {
    type: 'TurnstileTask',
    websiteURL: 'https://suno.com/create',
    websiteKey: 'site-key',
    action: 'managed',
    data: 'cdata',
    pagedata: 'page-data',
    proxyType: 'http',
    proxyAddress: 'proxy.example.invalid',
    proxyPort: 8080,
    proxyLogin: 'example@user',
    proxyPassword: 'example@password',
  }
);

assert.deepEqual(
  buildCoordinatesTask({
    body: 'base64-image',
    comment: 'click the matching objects',
    minClicks: 1,
    maxClicks: 9,
  }),
  {
    type: 'CoordinatesTask',
    body: 'base64-image',
    comment: 'click the matching objects',
    minClicks: 1,
    maxClicks: 9,
  }
);

assert.equal(normalizeCaptchaVersion(undefined), 1);
assert.equal(normalizeCaptchaVersion(1), 1);
assert.equal(normalizeCaptchaVersion(2), 2);
assert.equal(normalizeCaptchaVersion('2'), 2);
assert.equal(captchaProviderForVersion(1), 'hcaptcha');
assert.equal(captchaProviderForVersion(2), 'turnstile');

assert.deepEqual(
  buildHCaptchaRequestParams({
    apiKey: 'secret',
    websiteURL: 'https://suno.com/create',
    websiteKey: 'hcaptcha-site-key',
    userAgent: 'test-agent',
    rqdata: 'request-data',
    sharedProxy: proxy,
  }),
  {
    key: 'secret',
    method: 'hcaptcha',
    sitekey: 'hcaptcha-site-key',
    pageurl: 'https://suno.com/create',
    invisible: 1,
    userAgent: 'test-agent',
    json: 1,
    data: 'request-data',
    proxy: 'example%40user:example%40password@proxy.example.invalid:8080',
    proxytype: 'HTTP',
  }
);

assert.deepEqual(
  buildTurnstileTask({ websiteURL: 'https://suno.com/create', websiteKey: 'site-key' }),
  {
    type: 'TurnstileTaskProxyless',
    websiteURL: 'https://suno.com/create',
    websiteKey: 'site-key',
  }
);

const headers = clientIdentityHeaders(
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36'
);
assert.equal(headers['sec-ch-ua-platform'], '"Windows"');
assert.equal(headers['sec-ch-ua-mobile'], '?0');
assert.match(headers['sec-ch-ua'], /Chrome";v="123/);

assert.throws(
  () => parseSharedCaptchaProxy('socks5://example.net:1080'),
  /must use http:\/\/ or https:\/\//
);

console.log('captcha context tests passed');
