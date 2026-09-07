import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decryptMangoPayload,
  deriveMangoUserKey,
  selectSunoPlaybackMedia,
  unwrapMangoValue,
} from '../src/lib/playbackAudio';

test('selects the current encrypted progressive media_urls playback source', () => {
  const selected = selectSunoPlaybackMedia({
    audio_url: 'https://studio-api.prod.suno.com/api/forbidden',
    media_urls: [{
      url: 'https://d2lwuy8qc234o3.cloudfront.net/1/clip/12345678-1234-1234-1234-123456789012.m4a',
      content_type: 'm4a-opus',
      delivery: 'progressive',
      encoding: '1.0.0',
    }],
  });
  assert.equal(selected.encrypted, true);
  assert.equal(selected.extension, 'm4a');
  assert.equal(selected.response_content_type, 'audio/mp4');
});

test('never treats the replacement /api/forbidden audio_url as playable', () => {
  assert.throws(
    () => selectSunoPlaybackMedia({ audio_url: 'https://studio-api.prod.suno.com/api/forbidden' }),
    /no supported playback media URL/,
  );
});

test('unwraps Mango rights and decrypts the AES-CTR playback payload', () => {
  const contentId = '12345678-1234-1234-1234-123456789012';
  const userKey = deriveMangoUserKey('test-jwt');
  const contentKey = unwrapMangoValue(
    'AAECAwQFBgcICQoLyeTJ8zNuZQmHbMiNrikBV/XvIVmM+kkl06j9TFWzIeiimdzxlgJH5WfNrtgna2PL',
    contentId,
    userKey,
  );
  const contentIv = unwrapMangoValue(
    'DA0ODxAREhMUFRYXUMd+d4lH9KgEUUPRHvtDTfwH1/acBJDpQZE58AdqxZQ=',
    contentId,
    userKey,
  );
  const encrypted = Buffer.from('6cPvktRAKpa9QN32NueojraxPumz8aWFtw==', 'base64');
  const clear = decryptMangoPayload(encrypted, contentKey, contentIv);
  assert.equal(clear.toString('base64'), 'AAAAGGZ0eXBNNEEgAAAAAE9wdXNIZWFkAQ==');
});

test('rejects even allowed legacy audio_url without current media_urls', () => {
  assert.throws(() => selectSunoPlaybackMedia({ audio_url: 'https://cdn1.suno.ai/legacy.mp3' }), /no supported playback media URL/);
});
