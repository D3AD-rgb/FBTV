/**
 * Validation for user-supplied playlist / guide / catalogue URLs. Only http(s) is
 * accepted; credentials embedded in URLs are rejected so they never end up in logs or
 * the repository.
 */
export interface UrlCheck {
  ok: boolean;
  reason?: string;
}

export interface UrlPolicy {
  /** Allow plain http (TV-side playlists on a home network). Default false. */
  allowHttp?: boolean;
  /** Allow localhost / private network hosts. Default false. */
  allowPrivate?: boolean;
  maxLength?: number;
}

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)/i;

export function checkSourceUrl(input: string, policy: UrlPolicy = {}): UrlCheck {
  const url = (input || '').trim();
  const max = policy.maxLength || 2048;
  if (!url) return { ok: false, reason: 'Enter a URL.' };
  if (url.length > max) return { ok: false, reason: `URL is longer than ${max} characters.` };
  if (/[\s<>"`]/.test(url)) return { ok: false, reason: 'URL contains spaces or invalid characters.' };
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i.exec(url);
  if (!m) return { ok: false, reason: 'Not a valid web address.' };
  const scheme = m[1]!.toLowerCase();
  if (scheme !== 'https' && !(scheme === 'http' && policy.allowHttp)) {
    return { ok: false, reason: scheme === 'http' ? 'Use an https:// address.' : `"${scheme}:" addresses are not allowed.` };
  }
  const authority = m[2]!;
  if (authority.indexOf('@') >= 0) {
    return { ok: false, reason: 'Do not put a username or password in the URL.' };
  }
  const host = authority.replace(/:\d+$/, '');
  if (!host) return { ok: false, reason: 'The address has no host name.' };
  if (!policy.allowPrivate && PRIVATE_HOST.test(host)) {
    return { ok: false, reason: 'Local network addresses are not allowed here.' };
  }
  return { ok: true };
}

/** Redacts query strings and credentials for logs (tokens often live in query params). */
export function redactUrl(url: string): string {
  return url.replace(/\/\/[^/@]*@/, '//***@').replace(/\?.*$/, '?…');
}
