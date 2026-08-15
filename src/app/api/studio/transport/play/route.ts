import { controlStudioTransport } from '@/lib/StudioTransportBridge';
import { studioError, studioJson, studioOptions } from '@/lib/studioHttp';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    return studioJson(await controlStudioTransport('play'));
  } catch (error: any) {
    return studioError(error);
  }
}

export async function OPTIONS() {
  return studioOptions();
}
