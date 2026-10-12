/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** package.json version, injected at build time. */
declare const __APP_VERSION__: string;
/** Short commit id of the deployed build (empty in local dev). */
declare const __APP_BUILD__: string;
