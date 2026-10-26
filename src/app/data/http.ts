/**
 * XHR-based GET with timeout and size cap. XHR (unlike fetch) can read files bundled in the
 * app package under file://, and supports timeouts and aborts on every webOS version.
 */
export interface GetOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

export class HttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function getText(url: string, opts: GetOptions = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs || 20000;
  const maxBytes = opts.maxBytes || 30 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = timeoutMs;
    xhr.responseType = 'text';
    xhr.onprogress = (e) => {
      if (e.loaded > maxBytes) {
        xhr.abort();
        reject(new HttpError(`Response larger than ${maxBytes} bytes`, -1));
      }
    };
    xhr.onload = () => {
      // file:// responses report status 0 on some engines.
      if ((xhr.status >= 200 && xhr.status < 300) || (xhr.status === 0 && xhr.responseText)) resolve(xhr.responseText);
      else reject(new HttpError(`HTTP ${xhr.status}`, xhr.status));
    };
    xhr.onerror = () => reject(new HttpError('Network error', 0));
    xhr.ontimeout = () => reject(new HttpError(`Timed out after ${timeoutMs} ms`, -2));
    xhr.send();
  });
}

export async function getJSON<T>(url: string, opts: GetOptions = {}): Promise<T> {
  const text = await getText(url, opts);
  return JSON.parse(text) as T;
}
