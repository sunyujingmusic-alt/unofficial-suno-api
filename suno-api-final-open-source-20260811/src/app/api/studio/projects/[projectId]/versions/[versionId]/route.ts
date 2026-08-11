import { NextRequest } from 'next/server';
import { getStudioVersion } from '@/lib/StudioDirectApi';
import { studioApiFromRequest, studioError, studioJson, studioOptions } from '@/lib/studioHttp';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { projectId: string; versionId: string } }) {
  try {
    return studioJson(await getStudioVersion(await studioApiFromRequest(), params.projectId, params.versionId));
  } catch (error: any) {
    return studioError(error);
  }
}

export async function OPTIONS() {
  return studioOptions();
}
