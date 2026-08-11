import { NextRequest } from 'next/server';
import { getStudioVersions } from '@/lib/StudioDirectApi';
import { studioApiFromRequest, studioError, studioJson, studioOptions } from '@/lib/studioHttp';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { projectId: string } }) {
  try {
    return studioJson(await getStudioVersions(await studioApiFromRequest(), params.projectId));
  } catch (error: any) {
    return studioError(error);
  }
}

export async function OPTIONS() {
  return studioOptions();
}
