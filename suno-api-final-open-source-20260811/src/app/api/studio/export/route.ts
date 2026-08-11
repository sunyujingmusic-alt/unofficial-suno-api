import { NextRequest } from 'next/server';
import { renderStudioExport } from '@/lib/StudioDirectApi';
import { studioApiFromRequest, studioError, studioJson, studioOptions } from '@/lib/studioHttp';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const mode = body.mode || (body.start_beats !== undefined || body.end_beats !== undefined ? 'selected_time_range' : 'full_song');
    if (!['full_song', 'selected_time_range'].includes(mode)) {
      return studioJson({ error: 'mode must be full_song or selected_time_range' }, 400);
    }
    if (!body.studio_project_id) {
      return studioJson({ error: 'studio_project_id is required; Workspace Project IDs are not accepted in this field' }, 400);
    }
    if (!body.state || typeof body.state !== 'object' || Array.isArray(body.state)) {
      return studioJson({ error: 'state is required and must be an object' }, 400);
    }
    if (mode === 'selected_time_range' && (body.start_beats === undefined || body.end_beats === undefined)) {
      return studioJson({ error: 'start_beats and end_beats are required for selected_time_range' }, 400);
    }
    const result = await renderStudioExport(await studioApiFromRequest(), {
      ...body,
      wait_audio: body.wait_audio !== false,
    });
    return studioJson({ ...result, mode, semantic_result: 'rendered and saved to Suno Library; no local download' });
  } catch (error: any) {
    return studioError(error);
  }
}

export async function OPTIONS() {
  return studioOptions();
}
