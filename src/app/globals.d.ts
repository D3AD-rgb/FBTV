/// <reference types="vite/client" />
declare const __APP_VERSION__: string;
declare const __APP_ID__: string;
declare const __APP_TITLE__: string;
declare const __APP_COMMIT__: string;
declare const __CATALOGUE_MANIFEST_URL__: string;

/** Low-level webOS Luna bridge, present inside the webOS web engine only. */
declare class PalmServiceBridge {
  onservicecallback: ((message: string) => void) | null;
  call(uri: string, payload: string): void;
  cancel(): void;
}

interface Window {
  PalmSystem?: { deviceInfo?: string; identifier?: string; platformBack?: () => void };
}
