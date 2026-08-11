import { createHash, timingSafeEqual } from 'crypto';

type HeaderRequest = {
  headers: Headers;
};

export function studioSharedTokenConfigured(): boolean {
  return Boolean(String(process.env.SUNO_STUDIO_PAID_API_TOKEN || ''));
}

export function studioSharedTokenAccepted(req: HeaderRequest): boolean {
  const expected = String(process.env.SUNO_STUDIO_PAID_API_TOKEN || '');
  if (!expected) return false;
  const authorization = req.headers.get('authorization') || '';
  const provided = req.headers.get('x-suno-studio-token') || authorization.replace(/^Bearer\s+/i, '');
  if (!provided) return false;
  const expectedHash = createHash('sha256').update(expected).digest();
  const providedHash = createHash('sha256').update(provided).digest();
  return timingSafeEqual(expectedHash, providedHash);
}

export function unverifiedStudioWriteRejection(
  req: HeaderRequest,
  body: Record<string, unknown>,
): { status: number; payload: Record<string, unknown> } | null {
  if (process.env.SUNO_STUDIO_ENABLE_UNVERIFIED_WRITES !== '1') {
    return {
      status: 403,
      payload: {
        error: 'Unverified Studio writes are disabled; no upstream request was sent.',
        required: 'SUNO_STUDIO_ENABLE_UNVERIFIED_WRITES=1',
      },
    };
  }
  if (!studioSharedTokenConfigured()) {
    return {
      status: 503,
      payload: {
        error: 'Studio write authorization token is not configured; no upstream request was sent.',
        required: 'SUNO_STUDIO_PAID_API_TOKEN',
      },
    };
  }
  if (!studioSharedTokenAccepted(req)) {
    return {
      status: 401,
      payload: { error: 'Valid Studio write authorization is required; no upstream request was sent.' },
    };
  }
  if (body.confirm_unverified_write !== true) {
    return {
      status: 400,
      payload: {
        error: 'confirm_unverified_write=true is required; no upstream request was sent.',
      },
    };
  }
  return null;
}
