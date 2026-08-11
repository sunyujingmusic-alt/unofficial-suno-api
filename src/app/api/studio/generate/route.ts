import { NextRequest } from 'next/server';
import { resumeStudioGeneration, startOrResumeStudioGeneration } from '@/lib/StudioGenerationService';
import { readStudioSubmission } from '@/lib/studioSubmissions';
import { studioApiFromRequest, studioError, studioJson, studioOptions } from '@/lib/studioHttp';
import { studioSharedTokenAccepted, studioSharedTokenConfigured } from '@/lib/studioSecurity';

export const dynamic = 'force-dynamic';
export const maxDuration = 1200;

export async function GET(req: NextRequest) {
  try {
    const key = new URL(req.url).searchParams.get('idempotency_key')?.trim();
    if (!key) return studioJson({ error: 'idempotency_key is required' }, 400);
    if (studioSharedTokenConfigured() && !studioSharedTokenAccepted(req)) {
      return studioJson({ error: 'Valid Studio authorization is required' }, 401);
    }
    const record = await readStudioSubmission(key);
    if (!record) return studioJson({ error: 'Studio generation record not found' }, 404);
    if (new URL(req.url).searchParams.get('resume') === '1' && record.clip_ids.length > 0) {
      const updated = await resumeStudioGeneration(await studioApiFromRequest(), record, {
        max_poll_attempts: Number(new URL(req.url).searchParams.get('max_poll_attempts') || 90),
        poll_interval_seconds: Number(new URL(req.url).searchParams.get('poll_interval_seconds') || 3),
      });
      return studioJson({ record: updated, reused: true, new_submission: false });
    }
    return studioJson({ record, reused: true, new_submission: false });
  } catch (error: any) {
    return studioError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const idempotencyKey = String(body.idempotency_key || '').trim();
    if (!/^[a-zA-Z0-9._:-]{8,160}$/.test(idempotencyKey)) {
      return studioJson({
        error: 'idempotency_key must be 8-160 characters using letters, numbers, dot, underscore, colon, or hyphen',
      }, 400);
    }
    const existing = await readStudioSubmission(idempotencyKey);
    if (!existing && process.env.SUNO_STUDIO_ENABLE_PAID_GENERATION !== '1') {
      return studioJson({
        error: 'Paid Studio generation is disabled; no upstream request was sent.',
        required: 'SUNO_STUDIO_ENABLE_PAID_GENERATION=1',
      }, 403);
    }
    if (!existing && !studioSharedTokenConfigured()) {
      return studioJson({
        error: 'Paid Studio generation token is not configured; no upstream request was sent.',
        required: 'SUNO_STUDIO_PAID_API_TOKEN',
      }, 503);
    }
    if (studioSharedTokenConfigured() && !studioSharedTokenAccepted(req)) {
      return studioJson({ error: 'Valid paid Studio authorization is required; no upstream request was sent' }, 401);
    }
    if (!existing && body.confirm_paid_generation !== true) {
      return studioJson({ error: 'confirm_paid_generation=true is required; no upstream request was sent' }, 400);
    }
    const result = await startOrResumeStudioGeneration(await studioApiFromRequest(), {
      ...body,
      idempotency_key: idempotencyKey,
      wait_audio: body.wait_audio !== false,
    });
    return studioJson(result);
  } catch (error: any) {
    return studioError(error);
  }
}

export async function OPTIONS() {
  return studioOptions();
}
