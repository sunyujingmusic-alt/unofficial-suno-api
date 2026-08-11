import { DEFAULT_MODEL, type SunoApi } from '@/lib/SunoApi';
import { submitAndPollStudioGeneration, waitForStudioClips } from '@/lib/StudioDirectApi';
import {
  readStudioSubmission,
  reserveStudioSubmission,
  studioRequestFingerprint,
  updateStudioSubmission,
  type StudioGenerationSubmissionRecord,
} from '@/lib/studioSubmissions';
import type { StudioGenerationOptions } from '@/lib/StudioDirectApi';

function validationError(message: string): Error {
  const error: any = new Error(message);
  error.response = { status: 400 };
  return error;
}

function assertUuid(value: string | undefined, field: string, required = true): void {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized && !required) return;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)) {
    throw validationError(`${field} must be a UUID`);
  }
}

function safeRequestSummary(input: StudioGenerationOptions): Record<string, unknown> {
  return {
    mode: input.mode,
    title: input.title || null,
    model: input.model || DEFAULT_MODEL,
    batch_size: input.batch_size || 2,
    stem_control_tags: input.stem_control_tags,
    make_instrumental: input.make_instrumental ?? input.mode === 'instrument',
    workspace_project_id_present: Boolean(input.workspace_project_id),
    workspace_project_id_sha256: input.workspace_project_id ? studioRequestFingerprint(input.workspace_project_id) : null,
    studio_project_id: input.studio_project_id || null,
    studio_project_version_id: input.studio_project_version_id || null,
    stem_condition_clip_id: input.stem_condition_clip_id,
    cover_clip_id: input.cover_clip_id || null,
    cover_start_s: input.cover_start_s ?? null,
    cover_end_s: input.cover_end_s ?? null,
    tags_length: String(input.tags || '').length,
    tags_sha256: input.tags ? studioRequestFingerprint(input.tags) : null,
    prompt_length: String(input.prompt || '').length,
    prompt_sha256: input.prompt ? studioRequestFingerprint(input.prompt) : null,
    negative_tags_length: String(input.negative_tags || '').length,
    negative_tags_sha256: input.negative_tags ? studioRequestFingerprint(input.negative_tags) : null,
  };
}

function publicRecord(record: StudioGenerationSubmissionRecord) {
  return {
    ...record,
    // Never return a persisted request body, captcha token, transaction UUID, or
    // upstream response. request_summary is an explicit metadata-only allowlist.
  };
}

export async function startOrResumeStudioGeneration(
  api: SunoApi,
  input: StudioGenerationOptions,
): Promise<{ record: ReturnType<typeof publicRecord>; reused: boolean; new_submission: boolean }> {
  const idempotencyKey = String(input.idempotency_key || '').trim();
  if (!idempotencyKey) throw validationError('idempotency_key is required');
  if (!/^[a-zA-Z0-9._:-]{8,160}$/.test(idempotencyKey)) {
    throw validationError('idempotency_key must be 8-160 characters using letters, numbers, dot, underscore, colon, or hyphen');
  }
  if (input.mode !== 'instrument' && input.mode !== 'cover') throw validationError('mode must be instrument or cover');
  if (!input.stem_control_tags?.trim()) throw validationError('stem_control_tags is required');
  assertUuid(input.stem_condition_clip_id, 'stem_condition_clip_id');
  assertUuid(input.workspace_project_id, 'workspace_project_id');
  assertUuid(input.studio_project_id, 'studio_project_id', false);
  assertUuid(input.studio_project_version_id, 'studio_project_version_id', false);
  if (input.mode === 'cover') {
    assertUuid(input.cover_clip_id, 'cover_clip_id');
    const start = Number(input.cover_start_s);
    const end = Number(input.cover_end_s);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      throw validationError('cover_start_s and cover_end_s must define a positive range');
    }
  }
  const batchSize = Number(input.batch_size ?? 2);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 4) {
    throw validationError('batch_size must be an integer from 1 to 4');
  }

  const requestSummary = safeRequestSummary(input);
  const fingerprint = studioRequestFingerprint({ ...requestSummary, idempotency_key: idempotencyKey });
  const reservation = await reserveStudioSubmission({
    idempotency_key: idempotencyKey,
    request_fingerprint: fingerprint,
    request_summary: requestSummary,
  });

  if (!reservation.created) {
    if (reservation.record.request_fingerprint !== fingerprint) {
      const error: any = new Error('idempotency_key was already used with a different Studio generation request');
      error.response = { status: 409 };
      throw error;
    }
    if (reservation.record.clip_ids.length === 0) {
      return { record: publicRecord(reservation.record), reused: true, new_submission: false };
    }
    if (input.wait_audio === false) {
      return { record: publicRecord(reservation.record), reused: true, new_submission: false };
    }
    const poll = await waitForStudioClips(api, reservation.record.clip_ids, {
      max_poll_attempts: input.max_poll_attempts,
      poll_interval_seconds: input.poll_interval_seconds,
      expected_studio_project_id: input.studio_project_id,
    });
    const terminalFailure = Object.values(poll.statuses).some((status) => ['error', 'failed', 'cancelled', 'canceled'].includes(status));
    const record = await updateStudioSubmission(idempotencyKey, {
      status: poll.complete ? 'complete' : terminalFailure ? 'terminal_failure' : reservation.record.status,
      terminal_statuses: poll.statuses,
      project_insertion: poll.project_insertion.map((item) => ({
        clip_id: item.clip_id,
        expected_studio_project_id: input.studio_project_id,
        checked_at: new Date().toISOString(),
        observed_project_ids: item.observed_project_ids,
        expected_project_observed: item.expected_project_observed,
      })),
    });
    return { record: publicRecord(record), reused: true, new_submission: false };
  }

  if (process.env.SUNO_STUDIO_ENABLE_PAID_GENERATION !== '1') {
    await updateStudioSubmission(idempotencyKey, {
      status: 'terminal_failure',
      last_error: 'Paid Studio generation is disabled; set SUNO_STUDIO_ENABLE_PAID_GENERATION=1 only for an explicitly authorized submission.',
    });
    throw new Error('Paid Studio generation is disabled (SUNO_STUDIO_ENABLE_PAID_GENERATION must be 1)');
  }
  if (!input.confirm_paid_generation) {
    await updateStudioSubmission(idempotencyKey, {
      status: 'terminal_failure',
      last_error: 'confirm_paid_generation=true was not supplied; no upstream generation request was sent.',
    });
    throw new Error('confirm_paid_generation=true is required; no upstream generation request was sent');
  }

  const before = await api.getCredits();
  await updateStudioSubmission(idempotencyKey, {
    status: 'submit_inflight',
    submit_attempted: true,
    credit_ledger: { before: Number(before?.credits_left) },
  });

  let submission;
  try {
    submission = await submitAndPollStudioGeneration(api, {
      ...input,
      confirm_paid_generation: true,
      wait_audio: false,
    });
  } catch (error: any) {
    // The POST may have reached Suno even if the HTTP client saw an error. Never
    // replay this idempotency key automatically; recovery must use stored IDs or a
    // separately authorized manual decision.
    await updateStudioSubmission(idempotencyKey, {
      status: 'unknown_after_submit',
      last_error: String(error?.message || error).slice(0, 500),
    });
    throw error;
  }

  let after: any;
  try {
    after = await api.getCredits();
  } catch {
    after = undefined;
  }
  const afterCredits = Number(after?.credits_left);
  const beforeCredits = Number(before?.credits_left);
  await updateStudioSubmission(idempotencyKey, {
    status: 'submitted',
    clip_ids: submission.submission.clip_ids,
    initial_status: submission.submission.status,
    credit_ledger: {
      before: Number.isFinite(beforeCredits) ? beforeCredits : undefined,
      after: Number.isFinite(afterCredits) ? afterCredits : undefined,
      consumed: Number.isFinite(beforeCredits) && Number.isFinite(afterCredits) ? beforeCredits - afterCredits : undefined,
    },
  });

  if (input.wait_audio === false) {
    const record = await readStudioSubmission(idempotencyKey);
    if (!record) throw new Error('Studio submission record disappeared after submit');
    return { record: publicRecord(record), reused: false, new_submission: true };
  }

  const poll = await waitForStudioClips(api, submission.submission.clip_ids, {
    max_poll_attempts: input.max_poll_attempts,
    poll_interval_seconds: input.poll_interval_seconds,
    expected_studio_project_id: input.studio_project_id,
  });
  const terminalFailure = Object.values(poll.statuses).some((status) => ['error', 'failed', 'cancelled', 'canceled'].includes(status));
  const record = await updateStudioSubmission(idempotencyKey, {
    status: poll.complete ? 'complete' : terminalFailure ? 'terminal_failure' : 'submitted',
    terminal_statuses: poll.statuses,
    project_insertion: poll.project_insertion.map((item) => ({
      clip_id: item.clip_id,
      expected_studio_project_id: input.studio_project_id,
      checked_at: new Date().toISOString(),
      observed_project_ids: item.observed_project_ids,
      expected_project_observed: item.expected_project_observed,
    })),
    last_error: terminalFailure ? 'One or more Studio generation clips reached a terminal failure status' : undefined,
  });
  return { record: publicRecord(record), reused: false, new_submission: true };
}

export async function resumeStudioGeneration(
  api: SunoApi,
  record: StudioGenerationSubmissionRecord,
  options: Pick<StudioGenerationOptions, 'max_poll_attempts' | 'poll_interval_seconds'> = {},
): Promise<StudioGenerationSubmissionRecord> {
  if (record.clip_ids.length === 0) return record;
  const poll = await waitForStudioClips(api, record.clip_ids, options);
  const terminalFailure = Object.values(poll.statuses).some((status) => ['error', 'failed', 'cancelled', 'canceled'].includes(status));
  return updateStudioSubmission(record.idempotency_key, {
    status: poll.complete ? 'complete' : terminalFailure ? 'terminal_failure' : record.status,
    terminal_statuses: poll.statuses,
    project_insertion: poll.project_insertion.map((item) => ({
      clip_id: item.clip_id,
      expected_studio_project_id: record.request_summary.studio_project_id as string | undefined,
      checked_at: new Date().toISOString(),
      observed_project_ids: item.observed_project_ids,
      expected_project_observed: item.expected_project_observed,
    })),
  });
}
