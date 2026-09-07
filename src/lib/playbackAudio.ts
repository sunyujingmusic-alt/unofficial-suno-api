import { createDecipheriv, createHash } from 'node:crypto';

export interface SunoPlaybackMediaItem {
  url: string;
  content_type?: string;
  delivery?: string;
  encoding?: string | null;
}

export interface SelectedSunoPlaybackMedia extends SunoPlaybackMediaItem {
  encrypted: boolean;
  extension: string;
  response_content_type: string;
}

function playbackError(message: string, status = 422): Error {
  const error: any = new Error(message);
  error.response = { status };
  return error;
}

function isAllowedPlaybackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    const defaultSuffixes = ['cloudfront.net', 'suno.ai', 'suno.com', 'amazonaws.com'];
    const configured = String(process.env.SUNO_PLAYBACK_MEDIA_HOST_SUFFIXES || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    const suffixes = configured.length ? configured : defaultSuffixes;
    return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

function playbackFormat(item: SunoPlaybackMediaItem): { extension: string; contentType: string } {
  const declared = String(item.content_type || '').toLowerCase();
  let pathname = '';
  try {
    pathname = new URL(item.url).pathname.toLowerCase();
  } catch {}
  if (declared.includes('m4a') || declared.includes('mp4') || pathname.endsWith('.m4a')) {
    return { extension: 'm4a', contentType: 'audio/mp4' };
  }
  if (declared.includes('webm') || pathname.endsWith('.webm')) {
    return { extension: 'webm', contentType: 'audio/webm' };
  }
  if (declared.includes('mpeg') || declared.includes('mp3') || pathname.endsWith('.mp3')) {
    return { extension: 'mp3', contentType: 'audio/mpeg' };
  }
  return { extension: 'm4a', contentType: 'audio/mp4' };
}

export function selectSunoPlaybackMedia(clip: any): SelectedSunoPlaybackMedia {
  const items: SunoPlaybackMediaItem[] = Array.isArray(clip?.media_urls)
    ? clip.media_urls.filter((item: any) => item && typeof item.url === 'string')
    : [];
  const progressive = items.filter((item) => !item.delivery || item.delivery === 'progressive');
  const ordered = [
    ...progressive.filter((item) => !item.encoding),
    ...progressive.filter((item) => Boolean(item.encoding)),
  ];
  const selected = ordered.find((item) => isAllowedPlaybackUrl(item.url));
  if (selected) {
    if (selected.encoding && selected.encoding !== '1.0.0') {
      throw playbackError(`Unsupported Suno playback encoding: ${selected.encoding}`);
    }
    const format = playbackFormat(selected);
    return {
      ...selected,
      delivery: selected.delivery || 'progressive',
      encrypted: Boolean(selected.encoding),
      extension: format.extension,
      response_content_type: format.contentType,
    };
  }

  throw playbackError('Suno clip has no supported playback media URL');
}

export function deriveMangoUserKey(material: string): Buffer {
  if (!material) throw playbackError('Suno playback license has no user key material', 502);
  return createHash('sha256').update(material, 'utf8').digest();
}

export function unwrapMangoValue(wrappedBase64: string, contentId: string, userKey: Buffer): Buffer {
  const wrapped = Buffer.from(wrappedBase64 || '', 'base64');
  if (wrapped.length < 12 + 16 + 1) {
    throw playbackError('Suno playback license contains an invalid wrapped value', 502);
  }
  const nonce = wrapped.subarray(0, 12);
  const ciphertext = wrapped.subarray(12, -16);
  const authenticationTag = wrapped.subarray(-16);
  try {
    const decipher = createDecipheriv('aes-256-gcm', userKey, nonce);
    decipher.setAAD(Buffer.from(contentId, 'utf8'));
    decipher.setAuthTag(authenticationTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw playbackError('Suno playback license could not be authenticated', 502);
  }
}

export function decryptMangoPayload(ciphertext: Buffer, contentKey: Buffer, contentIv: Buffer): Buffer {
  if (![16, 24, 32].includes(contentKey.length) || contentIv.length !== 16) {
    throw playbackError('Suno playback license returned an unsupported AES key or IV', 502);
  }
  const decipher = createDecipheriv(`aes-${contentKey.length * 8}-ctr`, contentKey, contentIv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
