import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeStudioSeekInput,
  studioBeatsFromSeconds,
  studioSecondsFromBeats,
} from '../src/lib/StudioTransportBridge';

function statusOf(error: unknown): number | undefined {
  return (error as any)?.response?.status;
}

test('Studio seek accepts exactly one finite numeric unit', () => {
  assert.deepEqual(normalizeStudioSeekInput({ seconds: 12.5 }), {
    unit: 'seconds',
    value: 12.5,
  });
  assert.deepEqual(normalizeStudioSeekInput({ beats: 32 }), {
    unit: 'beats',
    value: 32,
  });
});

test('Studio seek rejects missing or ambiguous units with HTTP 400 semantics', () => {
  for (const input of [
    null,
    {},
    { seconds: 1, beats: 2 },
    { seconds: 1, project_id: 'unexpected' },
    [],
  ]) {
    assert.throws(
      () => normalizeStudioSeekInput(input),
      (error: unknown) => statusOf(error) === 400,
    );
  }
});

test('Studio seek rejects coercible and non-finite values', () => {
  for (const input of [
    { seconds: '12.5' },
    { seconds: null },
    { seconds: Number.NaN },
    { seconds: Number.POSITIVE_INFINITY },
    { beats: '32' },
    { beats: false },
  ]) {
    assert.throws(
      () => normalizeStudioSeekInput(input),
      (error: unknown) => statusOf(error) === 400,
    );
  }
});

test('Studio seek rejects negative seconds', () => {
  assert.throws(
    () => normalizeStudioSeekInput({ seconds: -0.01 }),
    (error: unknown) =>
      statusOf(error) === 400 &&
      (error as Error).message.includes('greater than or equal to 0'),
  );
});

test('DSP v2 timing conversion retains exact manual BPS values', () => {
  const timing = { bps: 1.9833333333333334, bpsAutomation: [] };
  const beats = 80;
  const seconds = studioSecondsFromBeats(beats, timing);
  assert.ok(Math.abs(seconds - 40.33613445378151) < 1e-12);
  assert.ok(Math.abs(studioBeatsFromSeconds(seconds, timing) - beats) < 1e-10);
});

test('DSP v2 timing conversion follows automated BPS instead of fixed BPM', () => {
  const timing = {
    bps: 2,
    bpsAutomation: [
      { beats: 0, value: 2, curve: 0 },
      { beats: 8, value: 4, curve: 0 },
      { beats: 16, value: 1, curve: 0 },
    ],
  };
  // Suno's current curve implementation treats curve=0 as a held value:
  // 0–8 beats at 2 BPS and 8–16 beats at 4 BPS.
  const seconds = studioSecondsFromBeats(16, timing);
  assert.ok(Math.abs(seconds - 6) < 1e-12);
  assert.ok(Math.abs(studioBeatsFromSeconds(seconds, timing) - 16) < 1e-9);
  assert.notEqual(seconds, 16 / timing.bps);
});

test('DSP v2 timing conversion supports non-linear BPS automation', () => {
  const timing = {
    bps: 2,
    bpsAutomation: [
      { beats: 0, value: 2, curve: 1 },
      { beats: 8, value: 4, curve: 0 },
      { beats: 16, value: 4, curve: 0 },
    ],
  };
  const beats = 5.375;
  const seconds = studioSecondsFromBeats(beats, timing);
  assert.ok(Number.isFinite(seconds));
  assert.ok(Math.abs(studioBeatsFromSeconds(seconds, timing) - beats) < 1e-9);
});
