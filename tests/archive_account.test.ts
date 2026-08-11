import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Readable } from 'node:stream';
import { SunoApi } from '../src/lib/SunoApi';
import { inspectAccountArchive } from '../src/lib/accountArchiveStatus';

function testApi(): SunoApi {
  return new SunoApi('suno_device_id=archive-unit-test');
}

test('target_complete counts completed Suno clips and preserves account-scan semantics', async () => {
  const api = testApi();
  const pages = [
    {
      clips: [
        { id: 'streaming-1', status: 'streaming', metadata: {} },
        { id: 'complete-1', status: 'complete', metadata: {} },
      ],
      has_more: true,
      next_cursor: 'cursor-2',
    },
    {
      clips: [
        { id: 'complete-2', status: 'complete', metadata: {} },
        { id: 'complete-3', status: 'complete', metadata: {} },
      ],
      has_more: true,
      next_cursor: 'cursor-3',
    },
  ];
  let pageIndex = 0;
  (api as any).listAccountClipsPage = async () => pages[pageIndex++];

  const result = await api.listAccountClips({ target_complete: 2, page_size: 50 });

  assert.equal(result.complete_clip_count, 2);
  assert.equal(result.skipped_incomplete_count, 1);
  assert.equal(result.stop_reason, 'target_complete_reached');
  assert.equal(result.account_scan_complete, false);
  assert.equal(result.complete, false);
  assert.equal(result.has_more, true);
  assert.deepEqual(result.clips.map((clip) => clip.id), ['streaming-1', 'complete-1', 'complete-2']);
});

test('candidate limit is never reported as a full-account scan', async () => {
  const api = testApi();
  (api as any).listAccountClipsPage = async () => ({
    clips: [
      { id: 'complete-1', status: 'complete', metadata: {} },
      { id: 'complete-2', status: 'complete', metadata: {} },
    ],
    has_more: true,
    next_cursor: 'cursor-2',
  });

  const result = await api.listAccountClips({ limit: 2, page_size: 50 });

  assert.equal(result.stop_reason, 'limit_reached');
  assert.equal(result.account_scan_complete, false);
  assert.equal(result.complete, false);
});

test('media download resumes a .part file and atomically publishes a verified file', async () => {
  const api = testApi();
  const root = await mkdtemp(path.join(os.tmpdir(), 'suno-archive-download-'));
  const targetPath = path.join(root, 'clip.jpg');
  const partPath = `${targetPath}.part`;
  const payload = Buffer.from('archive-unit-test-payload');
  const initial = payload.subarray(0, 8);
  await writeFile(partPath, initial);

  (api as any).client.get = async (_url: string, config: any) => {
    assert.equal(config.headers.Range, `bytes=${initial.length}-`);
    return {
      status: 206,
      data: Readable.from([payload.subarray(initial.length)]),
      headers: {
        'content-range': `bytes ${initial.length}-${payload.length - 1}/${payload.length}`,
        'content-length': String(payload.length - initial.length),
        'content-type': 'image/jpeg',
      },
    };
  };

  try {
    const result = await (api as any).downloadToFileWithIntegrity('https://example.invalid/file', targetPath, 'cover');
    assert.equal(result.attempts, 1);
    assert.equal(result.integrity.size_bytes, payload.length);
    assert.equal((await readFile(targetPath)).toString(), payload.toString());
    await assert.rejects(() => readFile(partPath));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('output lock prevents concurrent writers and releases cleanly', async () => {
  const api = testApi();
  const root = await mkdtemp(path.join(os.tmpdir(), 'suno-archive-lock-'));
  try {
    const first = await (api as any).acquireArchiveLock(root, false);
    await assert.rejects(() => (api as any).acquireArchiveLock(root, false), /already locked/);
    await first.release();
    const second = await (api as any).acquireArchiveLock(root, false);
    await second.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('persisted archive status distinguishes an active lock from a completed matching run', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'suno-archive-status-'));
  const runId = '20260811160000';
  const manifestPath = path.join(root, 'manifest.json');
  const runPath = path.join(root, 'runs', `${runId}.json`);
  try {
    await writeFile(manifestPath, JSON.stringify({
      summary: {
        last_run_id: runId,
        completed: 2,
      },
    }));
    await writeFile(path.join(root, '.archive.lock'), JSON.stringify({ pid: 1 }));
    const active = await inspectAccountArchive(root);
    assert.equal(active.state, 'running');
    assert.equal(active.lock.held, true);
    assert.equal(active.result, undefined);

    await unlink(path.join(root, '.archive.lock'));
    await mkdir(path.join(root, 'runs'), { recursive: true });
    await writeFile(runPath, JSON.stringify({
      run_id: runId,
      output_dir: root,
      manifest_path: manifestPath,
      run_report_path: runPath,
      started_at: '2026-08-11T08:00:00.000Z',
      completed_at: '2026-08-11T08:01:00.000Z',
      listed_count: 2,
      downloaded_mp3: 2,
      downloaded_wav: 2,
      downloaded_covers: 0,
      existing_mp3: 0,
      existing_wav: 0,
      existing_covers: 0,
      skipped: 0,
      failed: 0,
      completed_count: 2,
      listing: { stop_reason: 'target_complete_reached' },
    }));
    const completed = await inspectAccountArchive(root);
    assert.equal(completed.state, 'completed');
    assert.equal(completed.lock.held, false);
    assert.equal(completed.result?.completed_count, 2);
    assert.equal(completed.result?.listing.stop_reason, 'target_complete_reached');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
