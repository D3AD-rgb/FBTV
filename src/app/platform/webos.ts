/**
 * Thin webOS platform layer. Uses the built-in PalmServiceBridge directly instead of
 * bundling webOSTV.js, so nothing here is required when running in a desktop browser.
 */
export const isWebOS = (): boolean =>
  typeof window !== 'undefined' && (typeof window.PalmSystem !== 'undefined' || /Web0S|webOS/i.test(navigator.userAgent));

export interface LunaResult {
  returnValue?: boolean;
  errorText?: string;
  [key: string]: unknown;
}

/** One-shot Luna service call with a timeout. Rejects outside webOS. */
export function lunaCall(uri: string, params: Record<string, unknown> = {}, timeoutMs = 4000): Promise<LunaResult> {
  return new Promise((resolve, reject) => {
    if (typeof PalmServiceBridge === 'undefined') {
      reject(new Error('Luna bus not available (not running on webOS)'));
      return;
    }
    const bridge = new PalmServiceBridge();
    const timer = setTimeout(() => {
      bridge.cancel();
      reject(new Error(`Luna call timed out: ${uri}`));
    }, timeoutMs);
    bridge.onservicecallback = (msg: string) => {
      clearTimeout(timer);
      try {
        const res = JSON.parse(msg) as LunaResult;
        if (res.returnValue === false) reject(new Error(res.errorText || `Luna call failed: ${uri}`));
        else resolve(res);
      } catch (err) {
        reject(err as Error);
      }
    };
    bridge.call(uri, JSON.stringify(params));
  });
}

export interface DeviceInfo {
  platform: 'webos' | 'browser';
  modelName?: string;
  firmwareVersion?: string;
  sdkVersion?: string;
  uhd?: boolean;
  chromium?: number;
  userAgent: string;
}

export function chromiumVersion(ua = navigator.userAgent): number | undefined {
  const m = /Chrome\/(\d+)/.exec(ua);
  return m ? Number(m[1]) : undefined;
}

export async function getDeviceInfo(): Promise<DeviceInfo> {
  const base: DeviceInfo = {
    platform: isWebOS() ? 'webos' : 'browser',
    chromium: chromiumVersion(),
    userAgent: navigator.userAgent,
  };
  if (!isWebOS()) return base;
  try {
    const res = await lunaCall('luna://com.webos.service.tv.systemproperty/getSystemInfo', {
      keys: ['modelName', 'firmwareVersion', 'sdkVersion', 'UHD'],
    });
    return {
      ...base,
      modelName: res.modelName as string | undefined,
      firmwareVersion: res.firmwareVersion as string | undefined,
      sdkVersion: res.sdkVersion as string | undefined,
      uhd: res.UHD === 'true' || res.UHD === true,
    };
  } catch {
    return base;
  }
}

/** Exits the app on webOS; in a browser it just reloads to the start screen. */
export function exitApp(): void {
  if (isWebOS()) window.close();
  else location.reload();
}

/** Magic Remote pointer visibility (webOS fires `cursorStateChange`). */
export function onPointerVisibility(cb: (visible: boolean) => void): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<{ visibility?: boolean }>).detail;
    cb(Boolean(detail && detail.visibility));
  };
  document.addEventListener('cursorStateChange', handler);
  return () => document.removeEventListener('cursorStateChange', handler);
}
