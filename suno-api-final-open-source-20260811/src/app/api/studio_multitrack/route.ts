import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { sunoApi } from '@/lib/SunoApi';
import {
  downloadStudioMultitrack as downloadStudioMultitrackBrowser,
  extractSunoClipId,
  parseBooleanParameter,
  sanitizeStemsErrorDetails,
  StemsApiError,
} from '@/lib/stemsBrowser';
import { downloadStudioMultitrackHttp } from '@/lib/stemsHttp';
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
    const clipId = extractSunoClipId(firstDefined(body.clip_id, body.clipId) as string | undefined);
    const api = await sunoApi((await cookies()).toString());
    let clips: any[];
    try {
      clips = await api.getFeedByIdsV3([clipId], 1);
    } catch (error: any) {
      throw new StemsApiError(
        'Could not fetch the Studio clip metadata from Suno.',
        'STUDIO_METADATA_LOOKUP_FAILED',
        502,
        true,
        { clip_id: clipId, cause: error?.message || String(error) },
      );
    }
    const clip = clips.find((item) => String(item?.id || '').toLowerCase() === clipId) || null;
    const request = {
      clip_id: clipId,
      clip_metadata: clip,
      cdp: body.cdp,
      download_dir: firstDefined(body.download_dir, body.downloadDir) as string | undefined,
      load_wait_ms: firstDefined(body.load_wait_ms, body.loadWaitMs) as number | undefined,
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
      result = await downloadStudioMultitrackBrowser(request, {
        getCredits: () => api.getCredits(),
      });
      result = { ...result, backend: 'browser', browser_fallback_used: false };
    } else {
      try {
        result = await downloadStudioMultitrackHttp(request, {
          getStudioProject: (studioProjectId) => api.getStudioProject(studioProjectId),
          renderStudioMultitrack: (renderRequest) => api.renderStudioMultitrack(renderRequest),
          getCredits: () => api.getCredits(),
        });
      } catch (error: any) {
        if (!allowBrowserFallback) throw error;
        console.warn('[studio_multitrack] pure HTTP failed; using explicitly enabled browser fallback', {
          code: error?.code || null,
          message: error?.message || String(error),
        });
        const fallback = await downloadStudioMultitrackBrowser(request, {
          getCredits: () => api.getCredits(),
        });
        result = {
          ...fallback,
          backend: 'browser',
          browser_fallback_used: true,
          http_error: {
            code: error?.code || 'STUDIO_HTTP_FAILED',
            message: error?.message || 'Pure HTTP Studio Multitrack failed.',
          },
        };
      }
    }

    return new NextResponse(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (error: any) {
    if (!(error instanceof StemsApiError)) {
      console.error('[studio_multitrack] unexpected error', {
        name: error?.name,
        message: error?.message || String(error),
        stack: error?.stack,
      });
    }
    const stemsError = error instanceof StemsApiError ? error : new StemsApiError(
      'Unexpected Studio Multitrack API failure.',
      'STUDIO_MULTITRACK_INTERNAL_ERROR',
      500,
      false,
    );
    const details = sanitizeStemsErrorDetails(stemsError.details);
    console.error('[studio_multitrack]', {
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
