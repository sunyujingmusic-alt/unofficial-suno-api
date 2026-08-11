import { NextRequest } from 'next/server';
import { cloneStudioRevision } from '@/lib/StudioDirectApi';
import { studioApiFromRequest, studioError, studioJson, studioOptions } from '@/lib/studioHttp';
import { unverifiedStudioWriteRejection } from '@/lib/studioSecurity';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { revisionId: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const rejection = unverifiedStudioWriteRejection(req, body);
    if (rejection) return studioJson(rejection.payload, rejection.status);
    const { confirm_unverified_write: _confirm, ...payload } = body;
    return studioJson(await cloneStudioRevision(await studioApiFromRequest(), params.revisionId, payload));
  } catch (error: any) {
    return studioError(error);
  }
}

export async function OPTIONS() {
  return studioOptions();
}
