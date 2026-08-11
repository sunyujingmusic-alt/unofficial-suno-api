import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

export type StudioSubmissionStatus =
  | 'reserved'
  | 'submit_inflight'
  | 'submitted'
  | 'complete'
  | 'terminal_failure'
  | 'unknown_after_submit';

export interface StudioCreditLedger {
  before?: number;
  after?: number;
  consumed?: number;
}

export interface StudioProjectInsertionObservation {
  clip_id?: string;
  expected_studio_project_id?: string;
  checked_at: string;
  observed_project_ids: string[];
  expected_project_observed?: boolean;
}

export interface StudioGenerationSubmissionRecord {
  schema_version: 1;
  idempotency_key: string;
  request_fingerprint: string;
  created_at: string;
  updated_at: string;
  status: StudioSubmissionStatus;
  submit_attempted: boolean;
  request_summary: Record<string, unknown>;
  credit_ledger: StudioCreditLedger;
  clip_ids: string[];
  initial_status?: string;
  terminal_statuses?: Record<string, string>;
  project_insertion?: StudioProjectInsertionObservation[];
  last_error?: string;
}

function submissionRoot(): string {
  return path.resolve(process.env.SUNO_STUDIO_STATE_DIR || path.join(process.cwd(), '.suno-studio-state'));
}

function safeKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function recordPath(key: string): string {
  return path.join(submissionRoot(), 'submissions', `${safeKey(key)}.json`);
}

async function writeRecordAtomic(target: string, record: StudioGenerationSubmissionRecord): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${randomUUID()}`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export function studioRequestFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function readStudioSubmission(key: string): Promise<StudioGenerationSubmissionRecord | null> {
  try {
    return JSON.parse(await fs.readFile(recordPath(key), 'utf8')) as StudioGenerationSubmissionRecord;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Atomically reserves an idempotency key. An existing record is always returned
 * instead of allowing a second upstream create request.
 */
export async function reserveStudioSubmission(input: {
  idempotency_key: string;
  request_fingerprint: string;
  request_summary: Record<string, unknown>;
}): Promise<{ created: boolean; record: StudioGenerationSubmissionRecord }> {
  const now = new Date().toISOString();
  const record: StudioGenerationSubmissionRecord = {
    schema_version: 1,
    idempotency_key: input.idempotency_key,
    request_fingerprint: input.request_fingerprint,
    created_at: now,
    updated_at: now,
    status: 'reserved',
    submit_attempted: false,
    request_summary: input.request_summary,
    credit_ledger: {},
    clip_ids: [],
  };
  const target = recordPath(input.idempotency_key);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  try {
    await fs.writeFile(target, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return { created: true, record };
  } catch (error: any) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = await readStudioSubmission(input.idempotency_key);
    if (!existing) throw error;
    return { created: false, record: existing };
  }
}

export async function updateStudioSubmission(
  key: string,
  update: Partial<Omit<StudioGenerationSubmissionRecord, 'schema_version' | 'idempotency_key' | 'created_at'>>,
): Promise<StudioGenerationSubmissionRecord> {
  const existing = await readStudioSubmission(key);
  if (!existing) throw new Error(`No Studio submission record exists for idempotency key ${key}`);
  const next: StudioGenerationSubmissionRecord = {
    ...existing,
    ...update,
    updated_at: new Date().toISOString(),
  };
  await writeRecordAtomic(recordPath(key), next);
  return next;
}
