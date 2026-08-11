import { NextRequest } from 'next/server';
import { renderStudioMultitrack } from '@/lib/StudioDirectApi';
import { studioApiFromRequest, studioError, studioJson, studioOptions } from '@/lib/studioHttp';

export const dynamic = 'force-dynamic';
export const maxDuration = 1200;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.studio_project_id) {
      return studioJson({ error: 'studio_project_id is required; workspace project ids are not accepted here' }, 400);
    }
    if (!body.state || typeof body.state !== 'object' || Array.isArray(body.state)) {
      return studioJson({ error: 'state is required and must be an object' }, 400);
    }
    const result = await renderStudioMultitrack(await studioApiFromRequest(), body);
    return studioJson({
      ...result,
      semantic_result: result.reused
        ? 'matching local Multitrack ZIP reused; no upstream render was submitted'
        : result.local_path
          ? 'Multitrack ZIP downloaded atomically and integrity checked'
          : 'ephemeral Multitrack download URL returned; local download skipped',
    });
  } catch (error: any) {
    return studioError(error);
  }
}

export async function OPTIONS() {
  return studioOptions();
}
