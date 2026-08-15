import { NextRequest } from 'next/server';
import { controlStudioTransport } from '@/lib/StudioTransportBridge';
import { studioError, studioJson, studioOptions } from '@/lib/studioHttp';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    return studioJson(await controlStudioTransport('seek', body));
  } catch (error: any) {
    return studioError(error);
  }
}

export async function OPTIONS() {
  return studioOptions();
}
