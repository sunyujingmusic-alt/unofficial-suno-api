import { getStudioTransportStatus } from '@/lib/StudioTransportBridge';
import { studioError, studioJson, studioOptions } from '@/lib/studioHttp';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return studioJson(await getStudioTransportStatus());
  } catch (error: any) {
    return studioError(error);
  }
}

export async function OPTIONS() {
  return studioOptions();
}
