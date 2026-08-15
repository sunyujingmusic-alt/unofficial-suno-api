import dns from 'node:dns/promises';

export type StudioTransportAction = 'status' | 'play' | 'pause' | 'stop' | 'seek';

export interface StudioTransportStatus {
  available: true;
  playing: boolean;
  position_beats: number;
  position_seconds: number;
  song_start_seconds: number;
  timeline_present: boolean;
  timeline_playing: boolean;
  observed_at_unix_ms: number;
  source: 'studio_page_dsp_v2' | 'studio_page_playback_controller';
  protocol: 'dsp_v2' | 'playback_controller_v1';
  time_source: 'dsp_timeline' | 'dsp_timeline_bpm' | 'playback_controller';
  tempo_bpm?: number;
  /**
   * The loaded Suno Studio project identifier. This is intentionally limited
   * to the project ID; no Studio state, URL, Cookie, or credential is exposed.
   */
  studio_project_id?: string;
  browser_source: 'system_chrome' | 'openclaw_managed' | 'configured';
}

export interface StudioSeekInput {
  seconds?: number;
  beats?: number;
}

export interface StudioTransportResult {
  action: StudioTransportAction;
  changed: boolean;
  activation?: 'controller' | 'native_space_fallback';
  landed?: {
    position_beats: number;
    position_seconds: number;
  };
  requested?: {
    unit: 'seconds' | 'beats';
    value: number;
  };
  before: StudioTransportStatus;
  after: StudioTransportStatus;
}

export interface StudioTimingAutomationPoint {
  beats: number;
  value: number;
  curve?: number;
}

export interface StudioManualTiming {
  bps: number;
  bpsAutomation?: Required<StudioTimingAutomationPoint>[];
  firstBeatSeconds?: number;
}

interface CdpTarget {
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

function transportError(message: string, status = 503): Error {
  const error: any = new Error(message);
  error.response = { status };
  return error;
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw transportError(`${field} must be a finite JSON number`, 400);
  }
  return value;
}

type NormalizedStudioManualTiming = {
  bps: number;
  bpsAutomation: Required<StudioTimingAutomationPoint>[];
  firstBeatSeconds: number;
};

function normalizeManualTiming(input: StudioManualTiming): NormalizedStudioManualTiming {
  const bps = finiteNumber(input?.bps, 'timing.bps');
  if (bps <= 0) throw transportError('timing.bps must be greater than 0');
  const firstBeatSeconds = input.firstBeatSeconds === undefined
    ? 0
    : finiteNumber(input.firstBeatSeconds, 'timing.firstBeatSeconds');
  const bpsAutomation = (input.bpsAutomation || [])
    .map((point) => {
      const beats = finiteNumber(point?.beats, 'timing.bpsAutomation[].beats');
      const value = finiteNumber(point?.value, 'timing.bpsAutomation[].value');
      if (value <= 0) {
        throw transportError('timing.bpsAutomation[].value must be greater than 0');
      }
      const curve = point?.curve === undefined
        ? 0
        : finiteNumber(point.curve, 'timing.bpsAutomation[].curve');
      return { beats, value, curve };
    })
    .sort((left, right) => left.beats - right.beats);
  return { bps, bpsAutomation, firstBeatSeconds };
}

function timingValueRangeAtBeat(
  beats: number,
  points: NormalizedStudioManualTiming['bpsAutomation'],
): [number, number] {
  if (!points.length) return [0, 0];
  let right = points.length - 1;
  for (let index = 0; index < points.length; index += 1) {
    if (points[index].beats >= beats) {
      right = index;
      break;
    }
  }
  const left = Math.max(0, right - 1);
  const next = points[right];
  const previous = points[left];
  if (beats === next.beats && previous.curve === 0) return [previous.value, next.value];
  if (beats >= next.beats) return [next.value, next.value];
  if (beats <= previous.beats) return [previous.value, previous.value];
  const interval = next.beats - previous.beats;
  if (interval === 0 || next.value === previous.value) return [previous.value, previous.value];
  if (previous.curve === 0) return [previous.value, previous.value];
  const progress = beats - previous.beats;
  const exponent = 2 ** previous.curve;
  const value = exponent === 1
    ? previous.value + ((next.value - previous.value) * progress) / interval
    : previous.value + (next.value - previous.value) *
      (1 - (1 - progress / interval) ** exponent);
  return [value, value];
}

function integrationPoints(
  beats: number,
  points: NormalizedStudioManualTiming['bpsAutomation'],
): Required<StudioTimingAutomationPoint>[] {
  const result: Required<StudioTimingAutomationPoint>[] = [{
    beats: 0,
    value: timingValueRangeAtBeat(0, points)[1],
    curve: 0,
  }];
  for (const point of points) {
    if (point.beats >= beats || point.beats < 0) continue;
    const last = result[result.length - 1];
    if (point.beats === last.beats && point.value === last.value) {
      result[result.length - 1] = { beats: point.beats, value: point.value, curve: point.curve };
    } else {
      result.push({ beats: point.beats, value: point.value, curve: point.curve });
    }
  }
  result.push({
    beats,
    value: timingValueRangeAtBeat(beats, points)[0],
    curve: 0,
  });
  return result;
}

function secondsForLinearBpsSpan(
  beatSpan: number,
  startingBps: number,
  endingBps: number,
): number {
  if (beatSpan === 0) return 0;
  if (startingBps <= 0 || endingBps <= 0) {
    throw transportError('Studio timing contains a non-positive BPS segment');
  }
  const slope = (endingBps - startingBps) / beatSpan;
  return slope === 0
    ? beatSpan / startingBps
    : Math.log((startingBps + slope * beatSpan) / startingBps) / slope;
}

/**
 * Mirrors Suno Studio's current getSecondsFromZero timing model for manual
 * timing, including BPS automation. It deliberately does not use a
 * `beats * 60 / bpm` approximation.
 */
export function studioSecondsFromBeats(beats: number, input: StudioManualTiming): number {
  const position = finiteNumber(beats, 'beats');
  const timing = normalizeManualTiming(input);
  if (position === 0) return timing.firstBeatSeconds;
  if (!timing.bpsAutomation.length) return position / timing.bps + timing.firstBeatSeconds;
  if (timing.bpsAutomation.length === 1) {
    return position / timing.bpsAutomation[0].value + timing.firstBeatSeconds;
  }
  if (position < 0) {
    return -studioSecondsFromBeats(-position, {
      bps: timing.bps,
      bpsAutomation: timing.bpsAutomation
        .map((point) => ({ ...point, beats: -point.beats }))
        .reverse(),
      firstBeatSeconds: -timing.firstBeatSeconds,
    });
  }
  const points = integrationPoints(position, timing.bpsAutomation);
  let seconds = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const startingBps = timingValueRangeAtBeat(start.beats, timing.bpsAutomation)[1];
    const endingBps = timingValueRangeAtBeat(end.beats, timing.bpsAutomation)[0];
    seconds += secondsForLinearBpsSpan(end.beats - start.beats, startingBps, endingBps);
  }
  return seconds + timing.firstBeatSeconds;
}

/**
 * Inverts `studioSecondsFromBeats` with monotonic bisection. The page's
 * timing map is monotonic and the extra iterations retain fractional-second
 * precision through BPS automation without assuming a fixed BPM.
 */
export function studioBeatsFromSeconds(seconds: number, input: StudioManualTiming): number {
  const position = finiteNumber(seconds, 'seconds');
  const timing = normalizeManualTiming(input);
  if (!timing.bpsAutomation.length) return (position - timing.firstBeatSeconds) * timing.bps;
  if (timing.bpsAutomation.length === 1) {
    return (position - timing.firstBeatSeconds) * timing.bpsAutomation[0].value;
  }

  const target = position;
  let low = 0;
  let high = 0;
  if (target >= studioSecondsFromBeats(0, timing)) {
    high = Math.max(1, (target - timing.firstBeatSeconds) * Math.max(
      timing.bps,
      ...timing.bpsAutomation.map((point) => point.value),
    ) + 1);
    while (studioSecondsFromBeats(high, timing) < target) {
      high *= 2;
      if (high > Number.MAX_SAFE_INTEGER / 2) {
        throw transportError('Studio seconds position is outside the supported timing range', 400);
      }
    }
  } else {
    low = -1;
    while (studioSecondsFromBeats(low, timing) > target) {
      low *= 2;
      if (low < -Number.MAX_SAFE_INTEGER / 2) {
        throw transportError('Studio seconds position is outside the supported timing range', 400);
      }
    }
  }
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = (low + high) / 2;
    if (studioSecondsFromBeats(middle, timing) < target) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

export function normalizeStudioSeekInput(input: unknown): { unit: 'seconds' | 'beats'; value: number } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw transportError('seek request must be a JSON object containing exactly one of seconds or beats', 400);
  }
  const value = input as StudioSeekInput;
  const unexpectedKeys = Object.keys(value).filter((key) => key !== 'seconds' && key !== 'beats');
  if (unexpectedKeys.length) {
    throw transportError('seek request may contain only seconds or beats', 400);
  }
  const hasSeconds = value.seconds !== undefined;
  const hasBeats = value.beats !== undefined;
  if (hasSeconds === hasBeats) {
    throw transportError('seek request must contain exactly one of seconds or beats', 400);
  }
  if (hasSeconds) {
    const seconds = finiteNumber(value.seconds, 'seconds');
    if (seconds < 0) throw transportError('seconds must be greater than or equal to 0', 400);
    return { unit: 'seconds', value: seconds };
  }
  return { unit: 'beats', value: finiteNumber(value.beats, 'beats') };
}

function isIpHost(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || /^[0-9a-f:]+$/i.test(hostname);
}

async function resolveCdpBaseUrl(input: string): Promise<string> {
  const url = new URL(String(input || 'http://host.docker.internal:18800'));
  if (url.hostname === 'host.docker.internal' && !isIpHost(url.hostname)) {
    try {
      const result = await dns.lookup(url.hostname, { family: 4 });
      if (result.address) url.hostname = result.address;
    } catch {
      // Docker Desktop resolves this hostname for the service even when the
      // host-side Node process cannot. Preserve it and let fetch report 503.
    }
  }
  return url.toString().replace(/\/$/, '');
}

async function readJson(url: string): Promise<any> {
  let response: Response;
  try {
    response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(transportTimeoutMs()),
    });
  } catch {
    throw transportError('Studio browser CDP is unavailable; open the managed Suno browser first');
  }
  if (!response.ok) {
    throw transportError(`Studio browser CDP returned HTTP ${response.status}`);
  }
  return response.json();
}

function normalizeTargetWebSocketUrl(cdp: string, value: string): string {
  const ws = new URL(value);
  const base = new URL(cdp);
  if (ws.hostname === 'localhost' || ws.hostname === '127.0.0.1') {
    ws.hostname = base.hostname;
    ws.port = base.port;
  }
  return ws.toString();
}

async function findStudioTarget(cdp: string): Promise<CdpTarget> {
  const targets: CdpTarget[] = await readJson(`${cdp}/json/list`);
  const prefix = String(process.env.SUNO_STUDIO_TRANSPORT_URL_PREFIX || 'https://suno.com/studio').trim();
  const isStudioTarget = (value: string): boolean => {
    if (prefix !== 'https://suno.com/studio') {
      return value.startsWith(prefix);
    }
    try {
      const parsed = new URL(value);
      return (
        parsed.origin === 'https://suno.com' &&
        (parsed.pathname === '/studio' || parsed.pathname.startsWith('/studio/'))
      );
    } catch {
      return false;
    }
  };
  const candidates = targets.filter((target) =>
    target.type === 'page' &&
    typeof target.url === 'string' &&
    isStudioTarget(target.url) &&
    typeof target.webSocketDebuggerUrl === 'string'
  );
  if (!candidates.length) {
    throw transportError('No loaded Suno Studio page was found; open a Studio project in the managed browser');
  }
  if (candidates.length > 1) {
    throw transportError(
      'Multiple loaded Suno Studio pages were found; keep only the project you want to control open',
      409,
    );
  }
  const target = candidates[0];
  return {
    ...target,
    webSocketDebuggerUrl: normalizeTargetWebSocketUrl(cdp, target.webSocketDebuggerUrl!),
  };
}

class StudioCdpConnection {
  private sequence = 0;
  private websocket?: WebSocket;
  private closed = false;
  private pending = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(private readonly websocketUrl: string) {}

  async connect(): Promise<void> {
    this.closed = false;
    this.websocket = new WebSocket(this.websocketUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          this.websocket?.close();
        } catch {
          // Best effort.
        }
        reject(transportError('Timed out connecting to the Suno Studio page'));
      }, transportTimeoutMs());
      this.websocket!.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.websocket!.addEventListener('error', () => {
        clearTimeout(timer);
        reject(transportError('Could not connect to the Suno Studio page websocket'));
      }, { once: true });
    });
    this.websocket.addEventListener('close', () => {
      this.closed = true;
      for (const waiter of this.pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(transportError('Studio CDP connection closed before the command completed'));
      }
      this.pending.clear();
    });
    this.websocket.addEventListener('message', (event) => {
      let message: any;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!message.id || !this.pending.has(message.id)) return;
      const waiter = this.pending.get(message.id)!;
      this.pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(transportError(message.error.message || 'Studio CDP command failed'));
      else waiter.resolve(message.result);
    });
    await this.send('Runtime.enable');
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    if (!this.websocket || this.closed || this.websocket.readyState !== WebSocket.OPEN) {
      throw transportError('Studio CDP connection is not open');
    }
    const id = ++this.sequence;
    this.websocket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(transportError(`Studio CDP command timed out: ${method}`));
      }, transportTimeoutMs());
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  async evaluate(expression: string, userGesture = false): Promise<any> {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture,
    });
    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
      throw transportError(String(description || 'Studio page evaluation failed'));
    }
    return result.result?.value;
  }

  async nativeSpace(): Promise<void> {
    await this.send('Runtime.evaluate', {
      expression: `(() => {
        const active = document.activeElement;
        if (active && (active.matches('input, textarea, [contenteditable]') ||
          active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
          active.blur();
        }
        document.body?.focus?.();
      })()`,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: ' ',
      code: 'Space',
      windowsVirtualKeyCode: 32,
      nativeVirtualKeyCode: 32,
    });
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: ' ',
      code: 'Space',
      windowsVirtualKeyCode: 32,
      nativeVirtualKeyCode: 32,
    });
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(transportError('Studio CDP connection closed'));
    }
    this.pending.clear();
    try {
      this.websocket?.close();
    } catch {
      // Best effort.
    }
  }
}

const studioContextScript = `
  const isDspV2 = (context) =>
    context &&
    typeof context.setPlaying === 'function' &&
    typeof context.getCurrentBeats === 'function' &&
    typeof context.seek === 'function' &&
    typeof context.doc?.toProjectState === 'function';
  const isControllerV1 = (controller) =>
    controller &&
    typeof controller.play === 'function' &&
    typeof controller.setPlaying === 'function' &&
    typeof controller.seek === 'function' &&
    typeof controller.seekSeconds === 'function' &&
    typeof controller.getCurrentBeats === 'function' &&
    typeof controller.getCurrentSeconds === 'function';
  const getPlayButton = () => document.querySelector('[data-info-target="play-pause"]');
  const readDspV2 = (context, element) => {
    if (!isDspV2(context)) return null;
    let state;
    try {
      state = context.doc.toProjectState();
    } catch {
      return null;
    }
    const timing = state?.timing;
    const beats = Number(context.getCurrentBeats());
    if (!Number.isFinite(beats) ||
        timing?.type !== 'manual' ||
        !Number.isFinite(Number(timing?.bps)) ||
        Number(timing.bps) <= 0) {
      return null;
    }
    const button = getPlayButton();
    const score =
      (element?.isConnected ? 8 : 0) +
      (context.studioProjectId ? 4 : 0) +
      (context.dspModule ? 4 : 0) +
      (context.dspContext ? 4 : 0) +
      (Array.isArray(state?.tracks) && state.tracks.length > 0 ? 2 : 0) +
      (button ? 3 : 0) +
      4;
    return {
      protocol: 'dsp_v2',
      controller: context,
      state,
      timing,
      beats,
      playButton: button,
      score,
    };
  };
  const readControllerV1 = (studio, element) => {
    const controller = studio?.playbackController;
    if (!isControllerV1(controller)) return null;
    const timeline = controller.moduleReferencesRef?.current?.timeline;
    const state = studio.stateRef?.current || studio.state;
    const beats = Number(controller.getCurrentBeats());
    const seconds = Number(controller.getCurrentSeconds());
    if (!timeline || !Number.isFinite(beats) || !Number.isFinite(seconds)) return null;
    const score =
      (element?.isConnected ? 8 : 0) +
      (studio.projectId ? 4 : 0) +
      4 +
      (Array.isArray(state?.tracks) && state.tracks.length > 0 ? 2 : 0) +
      (!studio.loading ? 1 : 0) +
      4;
    return {
      protocol: 'playback_controller_v1',
      studio,
      controller,
      timeline,
      state,
      beats,
      seconds,
      score,
    };
  };
  const cacheKeyV2 = '__codexSunoStudioTransportContextV2';
  const cacheKeyV1 = '__codexSunoStudioTransportContextV1';
  let selected;
  const cachedV2 = globalThis[cacheKeyV2];
  if (cachedV2?.context) selected = readDspV2(cachedV2.context, cachedV2.element);
  if (!selected) {
    delete globalThis[cacheKeyV2];
    const cachedV1 = globalThis[cacheKeyV1];
    if (cachedV1?.controller) selected = readControllerV1(cachedV1.studio, cachedV1.element);
    if (!selected) delete globalThis[cacheKeyV1];
  }
  if (!selected) {
    const seenDsp = new WeakSet();
    const seenV1 = new WeakSet();
    const dspCandidates = [];
    const v1Candidates = [];
    const addCandidate = (candidate, element) => {
      if (!candidate || (typeof candidate !== 'object' && typeof candidate !== 'function')) return;
      if (!seenDsp.has(candidate)) {
        seenDsp.add(candidate);
        const dsp = readDspV2(candidate, element);
        if (dsp) dspCandidates.push(dsp);
      }
      const controller = candidate?.playbackController;
      if (controller && !seenV1.has(controller)) {
        seenV1.add(controller);
        const v1 = readControllerV1(candidate, element);
        if (v1) v1Candidates.push(v1);
      }
    };
    for (const element of document.querySelectorAll('*')) {
      const fiberKeys = Object.keys(element).filter((key) => key.startsWith('__reactFiber$'));
      for (const fiberKey of fiberKeys) {
        let fiber = element[fiberKey];
        for (let level = 0; fiber && level < 100; level += 1, fiber = fiber.return) {
          for (const candidate of [fiber.memoizedProps, fiber.pendingProps, fiber.memoizedState]) {
            const choices = [
              candidate,
              candidate?.studio,
              candidate?.value,
              candidate?.value?.studio,
              candidate?.value?.value,
              candidate?.value?.value?.studio,
            ];
            for (const choice of choices) addCandidate(choice, element);
          }
        }
      }
    }
    dspCandidates.sort((left, right) => right.score - left.score);
    v1Candidates.sort((left, right) => right.score - left.score);
    selected = dspCandidates[0] || v1Candidates[0];
    if (selected?.protocol === 'dsp_v2') {
      globalThis[cacheKeyV2] = { context: selected.controller, element: selected.playButton };
    } else if (selected?.protocol === 'playback_controller_v1') {
      globalThis[cacheKeyV1] = {
        studio: selected.studio,
        controller: selected.controller,
        element: selected.timeline?.ownerDocument?.querySelector?.('[data-info-target="play-pause"]') || null,
      };
    }
  }
  if (!selected || selected.score < 12) {
    delete globalThis[cacheKeyV2];
    delete globalThis[cacheKeyV1];
    throw new Error(
      'A ready DSP v2 Studio transport or legacy playback controller was not found; ' +
      'DSP v2 currently requires a loaded project using manual timing'
    );
  }
`;

function statusExpression(): string {
  return `(() => {
    ${studioContextScript}
    const controller = selected.controller;
    if (selected.protocol === 'dsp_v2') {
      const tracks = Array.isArray(selected.state?.tracks) ? selected.state.tracks : [];
      const allTracks = tracks.flatMap((track) => [track, ...(Array.isArray(track?.takeLanes) ? track.takeLanes : [])]);
      const startBeats = allTracks
        .flatMap((track) => Array.isArray(track?.clips) ? track.clips : [])
        .map((clip) => Number(clip?.startBeats))
        .filter(Number.isFinite)
        .reduce((minimum, beats) => Math.min(minimum, beats), 0);
      const playing = selected.playButton?.getAttribute?.('aria-label') === 'Pause';
      return {
        available: true,
        playing,
        position_beats: Number(controller.getCurrentBeats()),
        song_start_beats: startBeats,
        timing: selected.timing,
        timeline_present: true,
        timeline_playing: playing,
        observed_at_unix_ms: Date.now(),
        source: 'studio_page_dsp_v2',
        protocol: 'dsp_v2',
        studio_project_id: typeof controller.studioProjectId === 'string'
          ? controller.studioProjectId
          : undefined,
      };
    }
    const timeline = controller.moduleReferencesRef?.current?.timeline;
    return {
      available: true,
      playing: Boolean(controller.playing),
      position_beats: Number(controller.getCurrentBeats()),
      position_seconds: Number(controller.getCurrentSeconds()),
      song_start_seconds: Number(controller.songStartSeconds),
      timeline_present: Boolean(timeline),
      timeline_playing: Boolean(timeline?.playing),
      observed_at_unix_ms: Date.now(),
      source: 'studio_page_playback_controller',
      protocol: 'playback_controller_v1',
      time_source: 'playback_controller',
      studio_project_id: typeof selected.studio?.projectId === 'string'
        ? selected.studio.projectId
        : undefined,
    };
  })()`;
}

function actionExpression(
  action: Exclude<StudioTransportAction, 'status'>,
  seek?: { unit: 'seconds' | 'beats'; value: number },
): string {
  const serializedSeek = JSON.stringify(seek || null);
  return `(() => {
    ${studioContextScript}
    const controller = selected.controller;
    const action = ${JSON.stringify(action)};
    const seek = ${serializedSeek};
    const usingDspV2 = selected.protocol === 'dsp_v2';
    if (action === 'play') {
      if (usingDspV2) controller.setPlaying(true);
      else controller.play();
    } else if (action === 'pause') {
      const snapshotBeats = Number(controller.getCurrentBeats());
      controller.setPlaying(false);
      controller.seek(snapshotBeats);
    } else if (action === 'stop') {
      controller.setPlaying(false);
      if (usingDspV2) controller.seek(0);
      else controller.seekSeconds(0);
    } else if (action === 'seek') {
      if (!seek) throw new Error('seek payload is missing');
      if (usingDspV2 && seek.unit !== 'beats') {
        throw new Error('DSP v2 receives pre-converted Beat seek values only');
      }
      const wasPlaying = usingDspV2
        ? selected.playButton?.getAttribute?.('aria-label') === 'Pause'
        : Boolean(controller.playing);
      if (wasPlaying) controller.setPlaying(false);
      if (seek.unit === 'seconds') controller.seekSeconds(seek.value);
      else controller.seek(seek.value);
      const landed = {
        position_beats: Number(controller.getCurrentBeats()),
        ...(usingDspV2 ? {} : { position_seconds: Number(controller.getCurrentSeconds()) }),
      };
      if (wasPlaying) {
        if (usingDspV2) controller.setPlaying(true);
        else controller.play();
      }
      return landed;
    }
    return true;
  })()`;
}

interface StudioTransportRuntimeStatus extends Omit<StudioTransportStatus, 'browser_source'> {
  timing?: Required<StudioManualTiming>;
}

function toPublicStatus(status: StudioTransportRuntimeStatus): StudioTransportStatus {
  const { timing: _timing, ...publicStatus } = status;
  return publicStatus as StudioTransportStatus;
}

function assertStatus(value: any): StudioTransportRuntimeStatus {
  if (!value || value.available !== true || !Number.isFinite(value.position_beats)) {
    throw transportError('Studio transport returned an invalid status');
  }
  if (value.protocol === 'dsp_v2') {
    let timing: Required<StudioManualTiming>;
    let songStartBeats: number;
    try {
      timing = normalizeManualTiming(value.timing);
      songStartBeats = finiteNumber(value.song_start_beats, 'song_start_beats');
    } catch {
      throw transportError('Studio DSP v2 timing data is invalid');
    }
    const positionSecondsAbsolute = studioSecondsFromBeats(value.position_beats, timing);
    const songStartSeconds = studioSecondsFromBeats(songStartBeats, timing);
    const studioProjectID =
      typeof value.studio_project_id === 'string' && value.studio_project_id.trim()
        ? value.studio_project_id.trim()
        : undefined;
    if (!Number.isFinite(positionSecondsAbsolute) || !Number.isFinite(songStartSeconds)) {
      throw transportError('Studio DSP v2 timing conversion returned an invalid status');
    }
    return {
      available: true,
      playing: Boolean(value.playing),
      position_beats: value.position_beats,
      position_seconds: positionSecondsAbsolute - songStartSeconds,
      song_start_seconds: songStartSeconds,
      timeline_present: Boolean(value.timeline_present),
      timeline_playing: Boolean(value.timeline_playing),
      observed_at_unix_ms: finiteNumber(value.observed_at_unix_ms, 'observed_at_unix_ms'),
      source: 'studio_page_dsp_v2',
      protocol: 'dsp_v2',
      time_source: timing.bpsAutomation.length ? 'dsp_timeline' : 'dsp_timeline_bpm',
      tempo_bpm: 60 / timing.bps,
      studio_project_id: studioProjectID,
      timing,
    };
  }
  if (value.protocol !== 'playback_controller_v1' ||
      !Number.isFinite(value.position_seconds) ||
      !Number.isFinite(value.song_start_seconds)) {
    throw transportError('Studio playback controller returned an invalid status');
  }
  const studioProjectID =
    typeof value.studio_project_id === 'string' && value.studio_project_id.trim()
      ? value.studio_project_id.trim()
      : undefined;
  return {
    ...value,
    source: 'studio_page_playback_controller',
    protocol: 'playback_controller_v1',
    time_source: 'playback_controller',
    studio_project_id: studioProjectID,
  } as StudioTransportRuntimeStatus;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function transportTimeoutMs(): number {
  const configured = Number(process.env.SUNO_STUDIO_TRANSPORT_TIMEOUT_MS || 15000);
  return Number.isFinite(configured) && configured >= 1000 ? configured : 15000;
}

let transportTail = Promise.resolve();
let cachedTransportConnection: StudioCdpConnection | undefined;
let cachedTransportWebSocketUrl = '';
let cachedTransportBrowserSource: StudioTransportStatus['browser_source'] = 'configured';
const transportCandidateProbeTimeoutMs = 1_500;

async function withTransportLock<T>(operation: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const previous = transportTail;
  transportTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

async function openTransportPage(): Promise<StudioCdpConnection> {
  const configuredCandidates = String(
    process.env.SUNO_STUDIO_TRANSPORT_CDP_CANDIDATES || ''
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const inputs = configuredCandidates.length
    ? configuredCandidates
    : [
        process.env.SUNO_STUDIO_TRANSPORT_CDP ||
        process.env.SUNO_BROWSER_CDP ||
        'http://host.docker.internal:18800',
      ];

  // Once a controller is healthy, keep using it. Candidate browser discovery
  // must not happen on every 100 ms status request.
  if (cachedTransportConnection) {
    return cachedTransportConnection;
  }

  let lastError: unknown;
  for (const input of inputs) {
    const cdp = await resolveCdpBaseUrl(input);
    const browserSource: StudioTransportStatus['browser_source'] =
      new URL(cdp).port === '18801'
        ? 'system_chrome'
        : new URL(cdp).port === '18800'
          ? 'openclaw_managed'
          : 'configured';
    let target: CdpTarget;
    try {
      target = await findStudioTarget(cdp);
    } catch (error: any) {
      if (Number(error?.response?.status) === 409) {
        throw error;
      }
      lastError = error;
      continue;
    }

    if (cachedTransportConnection &&
        cachedTransportWebSocketUrl === target.webSocketDebuggerUrl) {
      try {
        // A target can survive while Studio itself reloads or returns to a
        // non-project page. Only keep it selected when its controller still
        // answers a real Transport read.
        await readStatus(cachedTransportConnection, cachedTransportBrowserSource);
        return cachedTransportConnection;
      } catch (error) {
        lastError = error;
        invalidateTransportConnection(cachedTransportConnection);
        continue;
      }
    }
    const connection = new StudioCdpConnection(target.webSocketDebuggerUrl!);
    try {
      await connection.connect();
      // Presence of a /studio page alone is not enough: an authentication,
      // loading, or project-selection page has no usable playback controller.
      // In that case, try the next configured browser rather than blocking it.
      await readStatusWithTimeout(
        connection,
        browserSource,
        transportCandidateProbeTimeoutMs,
      );
      const previousConnection = cachedTransportConnection;
      cachedTransportConnection = connection;
      cachedTransportWebSocketUrl = target.webSocketDebuggerUrl!;
      cachedTransportBrowserSource = browserSource;
      if (previousConnection && previousConnection !== connection) {
        previousConnection.close();
      }
      return connection;
    } catch (error) {
      lastError = error;
      connection.close();
    }
  }

  // Candidate probing must never take down an existing good controller just
  // because a higher-priority browser has a loading/sign-in Studio page.
  if (cachedTransportConnection) {
    try {
      await readStatus(cachedTransportConnection, cachedTransportBrowserSource);
      return cachedTransportConnection;
    } catch (error) {
      lastError = error;
      invalidateTransportConnection(cachedTransportConnection);
    }
  }

  throw lastError || transportError(
    'No Suno Studio page was found in any configured Chrome transport source'
  );
}

function invalidateTransportConnection(connection?: StudioCdpConnection): void {
  if (connection && cachedTransportConnection !== connection) {
    connection.close();
    return;
  }
  cachedTransportConnection?.close();
  cachedTransportConnection = undefined;
  cachedTransportWebSocketUrl = '';
  cachedTransportBrowserSource = 'configured';
}

async function readRuntimeStatus(
  connection: StudioCdpConnection,
  browserSource = cachedTransportBrowserSource,
): Promise<StudioTransportRuntimeStatus> {
  return {
    ...assertStatus(await connection.evaluate(statusExpression())),
    browser_source: browserSource,
  } as StudioTransportRuntimeStatus;
}

async function readStatus(
  connection: StudioCdpConnection,
  browserSource = cachedTransportBrowserSource,
): Promise<StudioTransportStatus> {
  return toPublicStatus(await readRuntimeStatus(connection, browserSource));
}

async function readStatusWithTimeout(
  connection: StudioCdpConnection,
  browserSource: StudioTransportStatus['browser_source'],
  timeoutMs: number,
): Promise<StudioTransportStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readStatus(connection, browserSource),
      new Promise<StudioTransportStatus>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            transportError(
              'Studio browser candidate did not expose a ready playback timeline',
              503,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function getStudioTransportStatus(): Promise<StudioTransportStatus> {
  return withTransportLock(async () => {
    let connection = await openTransportPage();
    try {
      return await readStatus(connection);
    } catch {
      // Status is read-only, so one reconnect-and-rediscover retry is safe.
      // This absorbs a stale CDP socket after a Studio reload/navigation.
      invalidateTransportConnection(connection);
      connection = await openTransportPage();
      try {
        return await readStatus(connection);
      } catch (error) {
        invalidateTransportConnection(connection);
        throw error;
      }
    }
  });
}

export async function controlStudioTransport(
  action: Exclude<StudioTransportAction, 'status'>,
  input?: unknown,
): Promise<StudioTransportResult> {
  return withTransportLock(async () => {
    const seek = action === 'seek' ? normalizeStudioSeekInput(input) : undefined;
    let connection = await openTransportPage();
    try {
      let before: StudioTransportRuntimeStatus;
      try {
        before = await readRuntimeStatus(connection);
      } catch {
        // Reconnect only before any action has been sent. Never replay a
        // possibly accepted Play/Pause/Seek operation.
        invalidateTransportConnection(connection);
        connection = await openTransportPage();
        before = await readRuntimeStatus(connection);
      }
      let activation: StudioTransportResult['activation'];
      let landed: StudioTransportResult['landed'];

      if (action === 'play') {
        if (!before.playing) {
          await connection.evaluate(actionExpression('play'), true);
        }
        await delay(220);
        let probe = await readRuntimeStatus(connection);
        const advanced = probe.position_seconds - before.position_seconds;
        if (!probe.playing || advanced < 0.02) {
          // A newly loaded page can expose playing=true before WebAudio has
          // received a browser activation. Return the controller to a known
          // stopped state, then use Studio's own Space-key transport once.
          await connection.evaluate(actionExpression('pause'), true);
          await connection.nativeSpace();
          await delay(260);
          probe = await readRuntimeStatus(connection);
          if (!probe.playing || probe.position_seconds - before.position_seconds < 0.02) {
            await connection.evaluate(actionExpression('pause'), true).catch(() => {});
            throw transportError(
              'Studio accepted the Play state but its timeline did not advance; click once inside Studio and retry',
              409,
            );
          }
          activation = 'native_space_fallback';
        } else {
          activation = 'controller';
        }
      } else {
        const bridgeSeek = action === 'seek' && seek && before.protocol === 'dsp_v2'
          ? {
              unit: 'beats' as const,
              value: seek.unit === 'seconds'
                ? studioBeatsFromSeconds(seek.value + before.song_start_seconds, before.timing!)
                : seek.value,
            }
          : seek;
        const actionResult = await connection.evaluate(actionExpression(action, bridgeSeek), true);
        if (action === 'seek' && seek) {
          const landedBeats = Number(actionResult?.position_beats);
          landed = {
            position_beats: landedBeats,
            position_seconds: before.protocol === 'dsp_v2'
              ? studioSecondsFromBeats(landedBeats, before.timing!) - before.song_start_seconds
              : Number(actionResult?.position_seconds),
          };
          const received = seek.unit === 'seconds'
            ? landed.position_seconds
            : landed.position_beats;
          if (!Number.isFinite(received) || Math.abs(received - seek.value) > 0.02) {
            throw transportError(`Studio seek did not reach the requested ${seek.unit}`, 409);
          }
        }
        await delay(action === 'seek' ? 80 : 120);
      }

      const after = await readRuntimeStatus(connection);
      if (action === 'pause' && after.playing) {
        throw transportError('Studio did not enter the paused state', 409);
      }
      if (action === 'stop' && (after.playing || Math.abs(after.position_seconds) > 0.02)) {
        throw transportError('Studio did not stop at 0 seconds', 409);
      }
      if (action === 'seek' && after.playing !== before.playing) {
        throw transportError('Studio seek did not preserve the prior playback state', 409);
      }

      return {
        action,
        changed:
          before.playing !== after.playing ||
          Math.abs(before.position_beats - after.position_beats) > 0.0001 ||
          Math.abs(before.position_seconds - after.position_seconds) > 0.0001,
        ...(activation ? { activation } : {}),
        ...(seek ? { requested: seek } : {}),
        ...(landed ? { landed } : {}),
        before: toPublicStatus(before),
        after: toPublicStatus(after),
      };
    } catch (error) {
      invalidateTransportConnection(connection);
      throw error;
    }
  });
}
