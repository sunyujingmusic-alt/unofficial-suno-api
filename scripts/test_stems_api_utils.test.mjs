import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveSongAnchorTitle,
  extractSunoClipId,
  isStudioMultitrackArchiveNameFor,
  isStemsArchiveNameFor,
  normalizeStudioClipMetadata,
  normalizeStemFormat,
  parseBooleanParameter,
  parseNumberParameter,
  parseZipEntrySizes,
  parseWavHeader,
  sanitizeStemsErrorDetails,
  StemsApiError,
} from '../src/lib/stemsBrowser.ts';

const CLIP_ID = 'c86b4e11-b3fe-4b18-9fe3-1049f9d64256';

test('clip id and stem format validation are strict', () => {
  assert.equal(extractSunoClipId(`https://suno.com/song/${CLIP_ID}`), CLIP_ID);
  assert.equal(normalizeStemFormat('WAV'), 'wav');
  assert.throws(() => extractSunoClipId('not-a-song'), (error) => {
    return error instanceof StemsApiError && error.code === 'INVALID_CLIP_ID' && error.status === 400;
  });
  assert.throws(() => normalizeStemFormat('flac'), (error) => {
    return error instanceof StemsApiError && error.code === 'INVALID_STEM_FORMAT' && error.status === 400;
  });
});

test('boolean parameters do not treat the string false as true', () => {
  assert.equal(parseBooleanParameter('false', 'dry_run', true), false);
  assert.equal(parseBooleanParameter('true', 'dry_run', false), true);
  assert.equal(parseBooleanParameter('0', 'dry_run', true), false);
  assert.equal(parseBooleanParameter(1, 'dry_run', false), true);
  assert.equal(parseBooleanParameter(undefined, 'dry_run', false), false);
  assert.throws(() => parseBooleanParameter('sometimes', 'dry_run', false), (error) => {
    return error instanceof StemsApiError && error.code === 'INVALID_PARAMETER';
  });
});

test('numeric parameters reject non-finite, fractional, and out-of-range values', () => {
  assert.equal(parseNumberParameter('6000', 'load_wait_ms', 1000, 1000, 120000), 6000);
  assert.equal(parseNumberParameter(undefined, 'load_wait_ms', 6000, 1000, 120000), 6000);
  for (const value of ['not-a-number', 'Infinity', 1.5, 999, 120001]) {
    assert.throws(() => parseNumberParameter(value, 'load_wait_ms', 6000, 1000, 120000), (error) => {
      return error instanceof StemsApiError && error.code === 'INVALID_PARAMETER';
    });
  }
});

test('archive identity is clip id plus format and ignores the title prefix', () => {
  assert.equal(isStemsArchiveNameFor(`Original title [${CLIP_ID}] Stems (WAV).zip`, CLIP_ID, 'wav'), true);
  assert.equal(isStemsArchiveNameFor(`Different caller title [${CLIP_ID}] Stems (WAV).zip`, CLIP_ID, 'wav'), true);
  assert.equal(isStemsArchiveNameFor(`Original title [${CLIP_ID}] Stems (MP3).zip`, CLIP_ID, 'wav'), false);
});

test('Studio archive identity is clip id and ignores the title prefix', () => {
  assert.equal(isStudioMultitrackArchiveNameFor(`Project A [${CLIP_ID}] Studio Multitrack.zip`, CLIP_ID), true);
  assert.equal(isStudioMultitrackArchiveNameFor(`Project B [${CLIP_ID}] Studio Multitrack.zip`, CLIP_ID), true);
  assert.equal(isStudioMultitrackArchiveNameFor(`Project B [${CLIP_ID}] Stems (WAV).zip`, CLIP_ID), false);
});

test('Studio metadata must identify a completed studio_export and exact project id', () => {
  const projectId = 'ef1a52be-7b21-423d-a554-898dcddf156b';
  const versionId = 'e2f2cfd8-aeae-4860-a8bb-66ab6ce3b1cc';
  const normalized = normalizeStudioClipMetadata(CLIP_ID, {
    id: CLIP_ID,
    title: 'Studio Project',
    status: 'complete',
    type: 'studio_export',
    raw: { metadata: { studio_project_id: projectId, studio_project_version_id: versionId } },
  });
  assert.deepEqual(normalized, {
    clipId: CLIP_ID,
    clipTitle: 'Studio Project',
    studioProjectId: projectId,
    sourceProjectVersionId: versionId,
  });
  assert.throws(() => normalizeStudioClipMetadata(CLIP_ID, {
    id: CLIP_ID,
    status: 'streaming',
    type: 'studio_export',
    raw: { metadata: { studio_project_id: projectId } },
  }), (error) => error instanceof StemsApiError && error.code === 'STUDIO_CLIP_NOT_COMPLETE');
  assert.throws(() => normalizeStudioClipMetadata(CLIP_ID, {
    id: CLIP_ID,
    status: 'complete',
    type: 'cover',
    raw: { metadata: { studio_project_id: projectId } },
  }), (error) => error instanceof StemsApiError && error.code === 'NOT_A_STUDIO_EXPORT');
});

test('WAV header parser identifies Suno Studio 32-bit float PCM', () => {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(48000, 24);
  header.writeUInt32LE(384000, 28);
  header.writeUInt16LE(8, 32);
  header.writeUInt16LE(32, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(0, 40);
  assert.deepEqual(parseWavHeader(header), {
    codec_name: 'pcm_f32le',
    sample_rate: 48000,
    channels: 2,
    bits_per_sample: 32,
  });
  assert.equal(parseWavHeader(Buffer.from('not wav')), null);
});

test('ZIP size parser accepts macOS and Debian unzip date formats', () => {
  const sizes = parseZipEntrySizes(`
 42251580  08-01-2026 12:47   0 New Track.wav
 42251580  2026-08-01 05:36   1 New Track.wav
`);
  assert.equal(sizes.get('0 New Track.wav'), 42251580);
  assert.equal(sizes.get('1 New Track.wav'), 42251580);
});

test('Suno page title removes the account byline from the archive title', () => {
  assert.equal(deriveSongAnchorTitle('借你一盏灯 by 孙玉镜 | Suno'), '借你一盏灯');
  assert.equal(deriveSongAnchorTitle('Plain title | Suno'), 'Plain title');
});

test('public error details are bounded and drop browser state and recorder data', () => {
  const details = sanitizeStemsErrorDetails({
    clip_id: CLIP_ID,
    phase: 'download',
    cause: 'user@example.com https://clerk.example.test/handshake?token=secret',
    state: { body: 'private page', email: 'user@example.com' },
    result: { calls: [{ responseText: 'secret' }] },
    download_events: [{ method: 'Browser.downloadWillBegin', url: 'https://secret.example.test' }],
    recent_files: [{ name: 'stems.zip', path: '/tmp/stems.zip', size: 123 }],
  });
  assert.deepEqual(details?.clip_id, CLIP_ID);
  assert.equal(details?.phase, 'download');
  assert.equal('state' in (details || {}), false);
  assert.equal('result' in (details || {}), false);
  assert.equal('download_events' in (details || {}), false);
  assert.match(String(details?.cause), /\[redacted-email\]/);
  assert.match(String(details?.cause), /\[redacted-url\]/);
});
