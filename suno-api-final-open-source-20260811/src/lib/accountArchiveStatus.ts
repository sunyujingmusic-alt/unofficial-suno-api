import fs from 'fs/promises';
import path from 'path';

export type AccountArchiveRuntimeState = 'not_started' | 'running' | 'completed' | 'failed' | 'unknown';

export interface AccountArchiveCliResult {
  run_id?: string;
  output_dir: string;
  manifest_path: string;
  run_report_path?: string;
  started_at?: string;
  completed_at?: string;
  listed_count: number;
  downloaded_mp3: number;
  downloaded_wav: number;
  downloaded_covers: number;
  existing_mp3: number;
  existing_wav: number;
  existing_covers: number;
  skipped: number;
  failed: number;
  completed_count: number;
  target_complete?: number;
  concurrency?: number;
  dry_run?: boolean;
  resume?: boolean;
  redownload?: boolean;
  formats?: string[];
  listing: Record<string, any>;
}

export interface AccountArchiveStatus {
  state: AccountArchiveRuntimeState;
  output_dir: string;
  manifest_path: string;
  run_report_path?: string;
  lock: {
    held: boolean;
    age_seconds?: number;
  };
  summary?: Record<string, any>;
  latest?: {
    run_id?: string;
    started_at?: string;
    completed_at?: string;
    failed?: number;
  };
  result?: AccountArchiveCliResult;
}

async function readJsonIfPresent(filePath: string): Promise<any | undefined> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error: any) {
    if (error?.code === 'ENOENT') return undefined;
    throw new Error(`Cannot read archive state ${path.basename(filePath)}: ${error?.message || String(error)}`);
  }
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resultFromRunReport(run: any, outputDir: string, manifestPath: string, runReportPath: string): AccountArchiveCliResult {
  return {
    run_id: typeof run?.run_id === 'string' ? run.run_id : undefined,
    output_dir: typeof run?.output_dir === 'string' ? run.output_dir : outputDir,
    manifest_path: typeof run?.manifest_path === 'string' ? run.manifest_path : manifestPath,
    run_report_path: typeof run?.run_report_path === 'string' ? run.run_report_path : runReportPath,
    started_at: typeof run?.started_at === 'string' ? run.started_at : undefined,
    completed_at: typeof run?.completed_at === 'string' ? run.completed_at : undefined,
    listed_count: numeric(run?.listed_count),
    downloaded_mp3: numeric(run?.downloaded_mp3),
    downloaded_wav: numeric(run?.downloaded_wav),
    downloaded_covers: numeric(run?.downloaded_covers),
    existing_mp3: numeric(run?.existing_mp3),
    existing_wav: numeric(run?.existing_wav),
    existing_covers: numeric(run?.existing_covers),
    skipped: numeric(run?.skipped),
    failed: numeric(run?.failed),
    completed_count: numeric(run?.completed_count),
    target_complete: Number.isFinite(Number(run?.target_complete)) ? Number(run.target_complete) : undefined,
    concurrency: Number.isFinite(Number(run?.concurrency)) ? Number(run.concurrency) : undefined,
    dry_run: typeof run?.dry_run === 'boolean' ? run.dry_run : undefined,
    resume: typeof run?.resume === 'boolean' ? run.resume : undefined,
    redownload: typeof run?.redownload === 'boolean' ? run.redownload : undefined,
    formats: Array.isArray(run?.formats) ? run.formats.map((value: unknown) => String(value)) : undefined,
    listing: run?.listing && typeof run.listing === 'object' ? run.listing : {},
  };
}

export async function inspectAccountArchive(outputDir: string): Promise<AccountArchiveStatus> {
  const resolvedOutputDir = path.resolve(outputDir);
  const manifestPath = path.join(resolvedOutputDir, 'manifest.json');
  const lockPath = path.join(resolvedOutputDir, '.archive.lock');
  const [manifest, lockStat] = await Promise.all([
    readJsonIfPresent(manifestPath),
    fs.stat(lockPath).catch((error: any) => {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    }),
  ]);
  const lock = {
    held: Boolean(lockStat),
    age_seconds: lockStat ? Math.max(0, Math.round((Date.now() - lockStat.mtimeMs) / 1000)) : undefined,
  };
  const runId = typeof manifest?.summary?.last_run_id === 'string' ? manifest.summary.last_run_id : undefined;
  const runReportPath = runId ? path.join(resolvedOutputDir, 'runs', `${runId}.json`) : undefined;
  const run = runReportPath ? await readJsonIfPresent(runReportPath) : undefined;
  const latest = run
    ? {
        run_id: typeof run.run_id === 'string' ? run.run_id : runId,
        started_at: typeof run.started_at === 'string' ? run.started_at : undefined,
        completed_at: typeof run.completed_at === 'string' ? run.completed_at : undefined,
        failed: numeric(run.failed),
      }
    : runId
      ? { run_id: runId }
      : undefined;

  if (lock.held) {
    return {
      state: 'running',
      output_dir: resolvedOutputDir,
      manifest_path: manifestPath,
      run_report_path: runReportPath,
      lock,
      summary: manifest?.summary,
      latest,
    };
  }

  if (!manifest) {
    return {
      state: 'not_started',
      output_dir: resolvedOutputDir,
      manifest_path: manifestPath,
      lock,
    };
  }

  if (!run || !latest?.completed_at || !runReportPath) {
    return {
      state: 'unknown',
      output_dir: resolvedOutputDir,
      manifest_path: manifestPath,
      run_report_path: runReportPath,
      lock,
      summary: manifest.summary,
      latest,
    };
  }

  const result = resultFromRunReport(run, resolvedOutputDir, manifestPath, runReportPath);
  return {
    state: result.failed > 0 ? 'failed' : 'completed',
    output_dir: resolvedOutputDir,
    manifest_path: manifestPath,
    run_report_path: runReportPath,
    lock,
    summary: manifest.summary,
    latest,
    result,
  };
}
