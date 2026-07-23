import { promises as fs } from 'fs';
import path from 'path';

export interface FinalSongPayload {
  title: string;
  lyrics: string;
  styles: string;
}

export interface FinalSongValidation {
  ok: boolean;
  errors: string[];
  fields: string[];
  required_fields: string[];
  missing_fields: string[];
  extra_fields: string[];
  field_types: Record<string, string>;
}

export class FinalSongValidationError extends Error {
  validation: FinalSongValidation;

  constructor(validation: FinalSongValidation) {
    super('final_song.json field validation failed: ' + validation.errors.join('; '));
    this.name = 'FinalSongValidationError';
    this.validation = validation;
  }
}

const REQUIRED_FINAL_SONG_FIELDS = ['title', 'lyrics', 'styles'];
const REQUIRED_FINAL_SONG_FIELDS_SORTED = [...REQUIRED_FINAL_SONG_FIELDS].sort();

function valueType(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function buildValidation(record: Record<string, unknown> | null, fields: string[], errors: string[]): FinalSongValidation {
  const fieldSet = new Set(fields);
  const requiredSet = new Set(REQUIRED_FINAL_SONG_FIELDS);
  const missingFields = REQUIRED_FINAL_SONG_FIELDS.filter((field) => !fieldSet.has(field));
  const extraFields = fields.filter((field) => !requiredSet.has(field));
  const fieldTypes = Object.fromEntries(fields.map((field) => [field, valueType(record?.[field])]));
  return {
    ok: errors.length === 0,
    errors,
    fields,
    required_fields: REQUIRED_FINAL_SONG_FIELDS,
    missing_fields: missingFields,
    extra_fields: extraFields,
    field_types: fieldTypes,
  };
}

export function validateFinalSongPayload(parsed: unknown): { payload: FinalSongPayload; validation: FinalSongValidation } {
  const errors: string[] = [];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const validation = buildValidation(null, [], ['final_song must be one JSON object']);
    throw new FinalSongValidationError(validation);
  }

  const record = parsed as Record<string, unknown>;
  const fields = Object.keys(record).sort();
  if (JSON.stringify(fields) !== JSON.stringify(REQUIRED_FINAL_SONG_FIELDS_SORTED)) {
    errors.push(`JSON fields must be exactly ${JSON.stringify(REQUIRED_FINAL_SONG_FIELDS)}; got ${JSON.stringify(fields)}`);
  }

  const values: FinalSongPayload = { title: '', lyrics: '', styles: '' };
  for (const field of REQUIRED_FINAL_SONG_FIELDS) {
    const value = record[field];
    if (typeof value !== 'string') {
      errors.push(`${field} must be a string`);
    } else {
      values[field as keyof FinalSongPayload] = value;
    }
  }

  const validation = buildValidation(record, fields, errors);
  if (errors.length) {
    throw new FinalSongValidationError(validation);
  }
  return { payload: values, validation };
}

export async function writeFinalSongJson(outputDir: string, payload: FinalSongPayload): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true });
  const finalSongPath = path.join(outputDir, 'final_song.json');
  await fs.writeFile(finalSongPath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  return finalSongPath;
}
