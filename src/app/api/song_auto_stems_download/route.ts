import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { sunoApi } from '@/lib/SunoApi';
import {
  downloadSongAutoStems as downloadSongAutoStemsBrowser,
  parseBooleanParameter,
  sanitizeStemsErrorDetails,
  StemsApiError,
} from '@/lib/stemsBrowser';
import { downloadSongAutoStemsHttp } from '@/lib/stemsHttp';
import { corsHeaders } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 1800;

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

export async function POST(req: NextRequest) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      throw new StemsApiError('Request body must be valid JSON.', 'INVALID_JSON', 400, false);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new StemsApiError('Request body must be a JSON object.', 'INVALID_JSON', 400, false);
    }
    const request = {
      url: body.url,
      clip_id: firstDefined(body.clip_id, body.clipId) as string | undefined,
      song_title: firstDefined(body.song_title, body.songTitle) as string | undefined,
      stem_format: firstDefined(body.stem_format, body.stemFormat) as 'wav' | 'mp3' | 'midi' | undefined,
      cdp: body.cdp,
      download_dir: firstDefined(body.download_dir, body.downloadDir) as string | undefined,
      load_wait_ms: firstDefined(body.load_wait_ms, body.loadWaitMs) as number | undefined,
      extract_timeout_ms: firstDefined(body.extract_timeout_ms, body.extractTimeoutMs) as number | undefined,
      download_timeout_ms: firstDefined(body.download_timeout_ms, body.downloadTimeoutMs) as number | undefined,
      viewport_width: firstDefined(body.viewport_width, body.viewportWidth) as number | undefined,
      viewport_height: firstDefined(body.viewport_height, body.viewportHeight) as number | undefined,
      dry_run: firstDefined(body.dry_run, body.dryRun) as boolean | undefined,
      queue_timeout_ms: firstDefined(body.queue_timeout_ms, body.queueTimeoutMs) as number | undefined,
      cleanup_run_dir: firstDefined(body.cleanup_run_dir, body.cleanupRunDir) as boolean | undefined,
      force_redownload: firstDefined(body.force_redownload, body.forceRedownload) as boolean | undefined,
    };
    const requestedBackend = String(body.backend || 'http').trim().toLowerCase();
    if (!['http', 'browser', 'auto'].includes(requestedBackend)) {
      throw new StemsApiError(
        'backend must be http, browser, or auto.',
        'INVALID_PARAMETER',
        400,
        false,
        { parameter: 'backend', received: requestedBackend },
      );
    }
    const allowBrowserFallback = requestedBackend === 'auto'
      && parseBooleanParameter(
        firstDefined(body.allow_browser_fallback, body.allowBrowserFallback),
        'allow_browser_fallback',
        process.env.SUNO_STEMS_BROWSER_FALLBACK === 'true',
      );
    let result: any;
    if (requestedBackend === 'browser') {
      const fallback = await downloadSongAutoStemsBrowser(request);
      result = { ...fallback, backend: 'browser', browser_fallback_used: false };
    } else {
      const api = await sunoApi((await cookies()).toString());
      try {
        result = await downloadSongAutoStemsHttp(request, {
          getClip: (clipId) => api.getClip(clipId),
          getSongStemsPages: (clipId) => api.getSongStemsPages(clipId),
          getSongStemsPage: (clipId, page) => api.getSongStemsPage(clipId, page),
          generateSongAutoStems: (clipId, title, transactionUuid) => (
            api.generateSongAutoStems(clipId, title, transactionUuid)
          ),
          getFeedByIds: (clipIds) => api.getFeedByIdsV3(clipIds, clipIds.length),
          renderStudioMultitrack: (renderRequest) => api.renderStudioMultitrack(renderRequest),
          getCredits: () => api.getCredits(),
        });
      } catch (error: any) {
        if (!allowBrowserFallback) throw error;
        console.warn('[song_auto_stems_download] pure HTTP failed; using explicitly enabled browser fallback', {
          code: error?.code || null,
          message: error?.message || String(error),
        });
        const fallback = await downloadSongAutoStemsBrowser(request);
        result = {
          ...fallback,
          backend: 'browser',
          browser_fallback_used: true,
          http_error: {
            code: error?.code || 'STEMS_HTTP_FAILED',
            message: error?.message || 'Pure HTTP Song stems failed.',
          },
        };
      }
    }

    return new NextResponse(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (error: any) {
    const stemsError = error instanceof StemsApiError ? error : new StemsApiError(
      'Unexpected stems API failure.',
      'STEMS_INTERNAL_ERROR',
      500,
      false,
    );
    const details = sanitizeStemsErrorDetails(stemsError.details);
    console.error('[song_auto_stems_download]', {
      code: stemsError.code,
      status: stemsError.status,
      retryable: stemsError.retryable,
      message: stemsError.message,
    });
    return new NextResponse(JSON.stringify({
      ok: false,
      error: {
        code: stemsError.code,
        message: stemsError.message,
        retryable: stemsError.retryable,
        ...(details ? { details } : {}),
      },
    }), {
      status: stemsError.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders });
}
