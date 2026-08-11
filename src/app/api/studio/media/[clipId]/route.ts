import { NextRequest } from 'next/server';
import { getStudioDownbeatsStreaming, getStudioMedia } from '@/lib/StudioDirectApi';
import { studioApiFromRequest, studioError, studioJson, studioOptions } from '@/lib/studioHttp';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { clipId: string } }) {
  try {
    const kind = new URL(req.url).searchParams.get('kind') || 'waveform';
    return studioJson(await getStudioMedia(await studioApiFromRequest(), params.clipId, kind));
  } catch (error: any) {
    return studioError(error);
  }
}

export async function POST(req: NextRequest, { params }: { params: { clipId: string } }) {
  try {
    const kind = new URL(req.url).searchParams.get('kind');
    if (kind !== 'downbeats_streaming') return studioJson({ error: 'POST is only supported for kind=downbeats_streaming' }, 405);
    const body = await req.json().catch(() => ({}));
    return studioJson(await getStudioDownbeatsStreaming(await studioApiFromRequest(), params.clipId, body));
  } catch (error: any) {
    return studioError(error);
  }
}

export async function OPTIONS() {
  return studioOptions();
}
