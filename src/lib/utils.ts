import pino from 'pino';

export const logger = pino();

export const sleep = (seconds: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
};

export function extractErrorMessage(error: any): string {
  const data = error?.response?.data;
  const detail = data?.detail;
  const message = data?.message;
  const errorText = data?.error;

  if (typeof detail === 'string' && detail.trim()) return detail;
  if (typeof message === 'string' && message.trim()) return message;
  if (typeof errorText === 'string' && errorText.trim()) return errorText;

  if (typeof data === 'string' && data.trim()) return data;

  if (data && typeof data === 'object') {
    try {
      return JSON.stringify(data);
    } catch {}
  }

  if (typeof error?.message === 'string' && error.message.trim()) return error.message;
  return String(error);
}

export function extractErrorStatus(error: any, fallback: number = 500): number {
  return Number(error?.response?.status || fallback);
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
