import path from 'path';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import {
  getDefaultAccountArchiveRoot,
  getDefaultHotSongOutputRoot,
  getDefaultOutputRoot,
  getFallbackHotSongOutputRoot,
  sunoApi,
  type AccountArchiveFormat,
  type ArchiveAccountOptions,
} from '@/lib/SunoApi';
import { inspectAccountArchive } from '@/lib/accountArchiveStatus';
import { corsHeaders, extractErrorMessage, extractErrorStatus } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 3600;

function positiveInt(value: unknown, fallback?: number): number | undefined {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function safeArchiveOutputDir(value: unknown): string {
  const requested = typeof value === 'string' && value.trim()
    ? path.resolve(value.trim())
    : path.resolve(getDefaultAccountArchiveRoot());
  const allowedRoots = [
    path.resolve(getDefaultOutputRoot()),
    path.resolve(getDefaultHotSongOutputRoot()),
    path.resolve(getFallbackHotSongOutputRoot()),
  ];
  if (!allowedRoots.some((root) => requested === root || requested.startsWith(`${root}${path.sep}`))) {
    throw new Error('output_dir must be inside one of the configured output roots');
  }
  return requested;
}

function normalizeFormats(value: unknown): AccountArchiveFormat[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error('formats must be an array containing mp3 and/or wav');
  const normalized = [...new Set(value.map((item) => String(item).trim().toLowerCase()))];
  if (normalized.length === 0 || normalized.some((item) => !['mp3', 'wav'].includes(item))) {
    throw new Error('formats must be an array containing mp3 and/or wav');
  }
  return normalized as AccountArchiveFormat[];
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const requestedConcurrency = positiveInt(body.concurrency);
    if (requestedConcurrency && requestedConcurrency > 3) {
      return NextResponse.json({ error: 'concurrency cannot exceed 3' }, { status: 400, headers: corsHeaders });
    }
    const requestedLimit = positiveInt(body.limit);
    const targetComplete = positiveInt(body.target_complete ?? body.targetComplete);
    if (requestedLimit && targetComplete) {
      return NextResponse.json({ error: 'limit and target_complete cannot be combined' }, { status: 400, headers: corsHeaders });
    }

    const options: ArchiveAccountOptions = {
      output_dir: safeArchiveOutputDir(body.output_dir ?? body.outputDir),
      formats: normalizeFormats(body.formats),
      dry_run: Boolean(body.dry_run),
      resume: body.resume === undefined ? true : Boolean(body.resume),
      skip_existing: body.skip_existing === undefined ? true : Boolean(body.skip_existing),
      include_incomplete: Boolean(body.include_incomplete),
      download_covers: Boolean(body.download_covers),
      limit: requestedLimit,
      target_complete: targetComplete,
      page_size: positiveInt(body.page_size ?? body.pageSize),
      max_pages: positiveInt(body.max_pages ?? body.maxPages),
      cursor: typeof body.cursor === 'string' ? body.cursor : undefined,
      wav_poll_interval_seconds: Number(body.wav_poll_interval_seconds ?? body.wavPollIntervalSeconds) > 0
        ? Number(body.wav_poll_interval_seconds ?? body.wavPollIntervalSeconds)
        : undefined,
      wav_max_poll_attempts: positiveInt(body.wav_max_poll_attempts ?? body.wavMaxPollAttempts),
      concurrency: requestedConcurrency,
      recover_stale_lock: Boolean(body.recover_stale_lock),
      max_run_history: positiveInt(body.max_run_history ?? body.maxRunHistory),
    };
    const api = await sunoApi((await cookies()).toString());
    const result = await api.archiveAccountClips(options);
    return NextResponse.json(result, { status: result.failed === 0 ? 200 : 207, headers: corsHeaders });
  } catch (error: any) {
    return NextResponse.json({ error: extractErrorMessage(error) }, {
      status: extractErrorStatus(error),
      headers: corsHeaders,
    });
  }
}

export async function GET(req: NextRequest) {
  try {
    const outputDir = safeArchiveOutputDir(
      req.nextUrl.searchParams.get('output_dir') ?? req.nextUrl.searchParams.get('outputDir'),
    );
    return NextResponse.json(await inspectAccountArchive(outputDir), { headers: corsHeaders });
  } catch (error: any) {
    return NextResponse.json({ error: extractErrorMessage(error) }, {
      status: extractErrorStatus(error),
      headers: corsHeaders,
    });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders });
}
