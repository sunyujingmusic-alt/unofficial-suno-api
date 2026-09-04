import assert from 'node:assert/strict';
import test from 'node:test';
import { getDefaultWorkspaceName, SunoApi } from '../src/lib/SunoApi';

function testApi(): SunoApi {
  return new SunoApi('suno_device_id=create-unit-test');
}

test('create proceeds without forcing a workspace when no project hint is provided', async () => {
  const envKeys = ['SUNO_DEFAULT_WORKSPACE', 'SUNO_DEFAULT_PROJECT_NAME', 'SUNO_WORKSPACE'] as const;
  const envSnapshot = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) {
    process.env[key] = '';
  }

  try {
    const api = testApi();
    let precheckCalls = 0;
    let metadataCalls = 0;
    let postCalls = 0;
    const sentinelError = new Error('workspace lookup should not be required for create');

    (api as any).keepAlive = async () => {};
    (api as any).createPrecheck = async () => {
      precheckCalls += 1;
      return {
        required: false,
        captcha_version: 1,
        captcha_provider: 'hcaptcha',
        solved: false,
        solver_ready: false,
        ready_for_create: true,
        verification_status: 'not_required',
      };
    };
    (api as any).buildCreateMetadata = async () => {
      metadataCalls += 1;
      return {
        web_client_pathname: '/create',
        is_max_mode: false,
        is_mumble: false,
        create_mode: 'custom',
        user_tier: 'free',
        create_session_token: 'session-token',
        disable_volume_normalization: false,
      };
    };
    (api as any).ensureWorkspace = async () => {
      throw sentinelError;
    };
    (api as any).resolveWorkspace = async () => {
      throw sentinelError;
    };
    (api as any).client.post = async (url: string, payload: any) => {
      postCalls += 1;
      assert.equal(url, 'https://studio-api-prod.suno.com/api/generate/v2-web/');
      assert.equal(payload.project_id, undefined);
      assert.equal(payload.token, undefined);
      assert.equal(payload.token_provider, null);
      assert.equal(payload.mv, 'chirp-fenix');
      assert.equal(payload.title, 'No workspace song');
      assert.equal(payload.task, undefined);
      return {
        status: 200,
        data: {
          clips: [{ id: 'clip-1', title: 'No workspace song', status: 'complete' }],
        },
      };
    };

    const clips = await api.create({
      prompt: 'lyrics',
      title: 'No workspace song',
      tags: 'pop',
      model: 'chirp-crow',
      wait_audio: false,
      create_mode: 'custom',
    });

    assert.equal(precheckCalls, 1);
    assert.equal(metadataCalls, 1);
  assert.equal(postCalls, 1);
  assert.deepEqual(clips.map((clip) => clip.id), ['clip-1']);
  } finally {
    for (const key of envKeys) {
      if (envSnapshot[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = envSnapshot[key];
      }
    }
  }
});

test('create sends numeric token_provider when a captcha token is present', async () => {
  const api = testApi();
  let postCalls = 0;
  (api as any).keepAlive = async () => {};
  (api as any).createPrecheck = async () => ({
    required: true,
    captcha_version: 2,
    captcha_provider: 'turnstile',
    solved: true,
    solver_ready: true,
    ready_for_create: true,
    verification_status: 'pending_create',
  });
  (api as any).buildCreateMetadata = async () => ({
    web_client_pathname: '/create',
    is_max_mode: false,
    is_mumble: false,
    create_mode: 'custom',
    user_tier: 'free',
    create_session_token: 'session-token',
    disable_volume_normalization: false,
  });
  (api as any).createCaptchaToken = 'captcha-token';
  (api as any).client.post = async (url: string, payload: any) => {
    postCalls += 1;
    assert.equal(url, 'https://studio-api-prod.suno.com/api/generate/v2-web/');
    assert.equal(payload.token, 'captcha-token');
    assert.equal(payload.token_provider, 2);
    return {
      status: 200,
      data: {
        clips: [{ id: 'clip-token-provider', title: 'Captcha song', status: 'complete' }],
      },
    };
  };

  const clips = await api.create({
    prompt: 'lyrics',
    title: 'Captcha song',
    tags: 'pop',
    model: 'v5',
    wait_audio: false,
    create_mode: 'custom',
  });

  assert.equal(postCalls, 1);
  assert.deepEqual(clips.map((clip) => clip.id), ['clip-token-provider']);
});

test('default workspace lookup still honors legacy SUNO_WORKSPACE', () => {
  const envKeys = ['SUNO_DEFAULT_WORKSPACE', 'SUNO_DEFAULT_PROJECT_NAME', 'SUNO_WORKSPACE'] as const;
  const envSnapshot = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  try {
    process.env.SUNO_DEFAULT_WORKSPACE = '';
    process.env.SUNO_DEFAULT_PROJECT_NAME = '';
    process.env.SUNO_WORKSPACE = 'WeiboHot';
    assert.equal(getDefaultWorkspaceName(), 'WeiboHot');
  } finally {
    for (const key of envKeys) {
      if (envSnapshot[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = envSnapshot[key];
      }
    }
  }
});

test('Suno API requests omit Cookie by default while Clerk auth keeps it', () => {
  const envSnapshot = process.env.SUNO_SEND_COOKIE_TO_API;
  try {
    process.env.SUNO_SEND_COOKIE_TO_API = '';
    const api = testApi();
    assert.equal((api as any).shouldAttachCookieForUrl('https://studio-api-prod.suno.com/api/generate/v2-web/'), false);
    assert.equal((api as any).shouldAttachCookieForUrl('https://studio-api.prod.suno.com/api/feed/v3'), false);
    assert.equal((api as any).shouldAttachCookieForUrl('https://clerk.suno.com/v1/client'), true);
    process.env.SUNO_SEND_COOKIE_TO_API = '1';
    assert.equal((api as any).shouldAttachCookieForUrl('https://studio-api-prod.suno.com/api/generate/v2-web/'), true);
  } finally {
    if (envSnapshot === undefined) {
      delete process.env.SUNO_SEND_COOKIE_TO_API;
    } else {
      process.env.SUNO_SEND_COOKIE_TO_API = envSnapshot;
    }
  }
});

test('create can proceed with browser captcha fallback using a null token', async () => {
  const api = testApi();
  let postCalls = 0;
  (api as any).keepAlive = async () => {};
  (api as any).createPrecheck = async () => ({
    required: true,
    captcha_version: 2,
    captcha_provider: 'turnstile',
    solved: true,
    solver_ready: true,
    ready_for_create: true,
    verification_status: 'pending_create',
  });
  (api as any).buildCreateMetadata = async () => ({
    web_client_pathname: '/create',
    is_max_mode: false,
    is_mumble: false,
    create_mode: 'custom',
    user_tier: 'free',
    create_session_token: 'session-token',
    disable_volume_normalization: false,
  });
  (api as any).createCaptchaBrowserFallback = true;
  (api as any).client.post = async (url: string, payload: any) => {
    postCalls += 1;
    assert.equal(url, 'https://studio-api-prod.suno.com/api/generate/v2-web/');
    assert.equal(payload.token, null);
    assert.equal(payload.token_provider, null);
    return {
      status: 200,
      data: {
        clips: [{ id: 'clip-browser-fallback', title: 'Browser fallback song', status: 'complete' }],
      },
    };
  };

  const clips = await api.create({
    prompt: 'lyrics',
    title: 'Browser fallback song',
    tags: 'pop',
    model: 'v5',
    wait_audio: false,
    create_mode: 'custom',
  });

  assert.equal(postCalls, 1);
  assert.deepEqual(clips.map((clip) => clip.id), ['clip-browser-fallback']);
});

test('create recovers clips from feed when upstream returns an ambiguous 500 after submit', async () => {
  const api = testApi();
  let postCalls = 0;
  let recoveryCalls = 0;
  (api as any).keepAlive = async () => {};
  (api as any).createPrecheck = async () => ({
    required: false,
    captcha_version: 2,
    captcha_provider: 'turnstile',
    solved: false,
    solver_ready: false,
    ready_for_create: true,
    verification_status: 'not_required',
  });
  (api as any).buildCreateMetadata = async () => ({
    web_client_pathname: '/create',
    is_max_mode: false,
    is_mumble: false,
    create_mode: 'custom',
    user_tier: 'free',
    create_session_token: 'session-token',
    disable_volume_normalization: false,
  });
  (api as any).resolveWorkspace = async () => ({
    id: 'project-123',
    name: 'Recovery Workspace',
    shared: false,
    is_trashed: false,
  });
  (api as any).client.post = async (url: string) => {
    postCalls += 1;
    if (url === 'https://studio-api-prod.suno.com/api/generate/v2-web/') {
      const error: any = new Error('upstream ambiguous failure');
      error.response = {
        status: 500,
        data: { error: 'An unexpected error occurred.' },
      };
      throw error;
    }
    throw new Error(`unexpected POST ${url}`);
  };
  (api as any).listAccountClips = async () => {
    recoveryCalls += 1;
    return {
      clips: [
        {
          id: 'recovered-1',
          title: 'Recovered song',
          status: 'complete',
          created_at: new Date().toISOString(),
          model_name: 'chirp-fenix',
          project_id: 'project-123',
          project_name: 'Recovery Workspace',
          tags: 'pop',
          negative_tags: '',
          prompt: 'hello world',
          raw: {
            id: 'recovered-1',
            title: 'Recovered song',
            status: 'complete',
            created_at: new Date().toISOString(),
            model_name: 'chirp-fenix',
            project: { id: 'project-123', name: 'Recovery Workspace' },
            metadata: {
              tags: 'pop',
              negative_tags: '',
              prompt: 'hello world',
              type: 'gen',
            },
          },
        },
        {
          id: 'recovered-2',
          title: 'Recovered song',
          status: 'complete',
          created_at: new Date().toISOString(),
          model_name: 'chirp-fenix',
          project_id: 'project-123',
          project_name: 'Recovery Workspace',
          tags: 'pop',
          negative_tags: '',
          prompt: 'hello world',
          raw: {
            id: 'recovered-2',
            title: 'Recovered song',
            status: 'complete',
            created_at: new Date().toISOString(),
            model_name: 'chirp-fenix',
            project: { id: 'project-123', name: 'Recovery Workspace' },
            metadata: {
              tags: 'pop',
              negative_tags: '',
              prompt: 'hello world',
              type: 'gen',
            },
          },
        },
      ],
      pages: 1,
      page_size: 30,
      complete_clip_count: 2,
      skipped_incomplete_count: 0,
      has_more: false,
      complete: false,
      account_scan_complete: false,
      stop_reason: 'end_of_feed',
      filters: {},
    };
  };

  const clips = await api.create({
    prompt: 'hello world',
    title: 'Recovered song',
    tags: 'pop',
    model: 'v5.5',
    wait_audio: false,
    create_mode: 'custom',
    project_id: 'project-123',
  });

  assert.equal(postCalls >= 1, true);
  assert.equal(recoveryCalls >= 1, true);
  assert.deepEqual(clips.map((clip) => clip.id), ['recovered-1', 'recovered-2']);
});
