import { initializeApp } from 'firebase/app';
import { browserLocalPersistence, connectAuthEmulator, GoogleAuthProvider, indexedDBLocalPersistence, initializeAuth, browserPopupRedirectResolver } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';

const env = import.meta.env;
export const usingEmulators = env.VITE_USE_EMULATORS === 'true';
/**
 * Phone testing (`npm run dev:phone`): the dev server is HTTPS and proxies every
 * emulator through its own origin, so a phone on the LAN needs a single URL and
 * the camera works (it requires a secure context).
 */
const proxied = usingEmulators && env.VITE_EMULATOR_PROXY === 'true';
export const region = env.VITE_FUNCTIONS_REGION || 'us-central1';

const config = usingEmulators
  ? { apiKey: 'demo-key', authDomain: 'demo-filmroll.firebaseapp.com', projectId: 'demo-filmroll', storageBucket: 'demo-filmroll.appspot.com', appId: 'demo-app' }
  : {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    };

export const firebaseConfigured = usingEmulators || Boolean(config.apiKey && config.projectId);

// Without config, initialise with placeholders so the app can show a setup message instead of crashing.
export const app = initializeApp(firebaseConfigured ? config : { apiKey: 'not-configured', projectId: 'not-configured', appId: 'not-configured' });
// Persistent sessions: IndexedDB first, localStorage fallback.
export const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence], popupRedirectResolver: browserPopupRedirectResolver });
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  ignoreUndefinedProperties: true,
  // Proxied emulator: same origin over HTTPS (vite.config.ts forwards to :8080).
  ...(proxied ? { host: location.host, ssl: true } : {}),
});
export const storage = getStorage(app);
const functionsBase = proxied ? `${location.origin}/__functions/demo-filmroll/${region}` : null;
export const functions = getFunctions(app, functionsBase ?? region);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

if (proxied) {
  connectAuthEmulator(auth, location.origin, { disableWarnings: true });
  connectStorageEmulator(storage, location.hostname, Number(location.port || 443));
  // Dev-only: the SDK assumes plain http for the Storage emulator; the proxy is https.
  (storage as unknown as { _protocol: string })._protocol = 'https';
} else if (usingEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}

/** Where developed photos are served from (authorization-checked function). */
export const photoEndpoint: string =
  env.VITE_PHOTO_ENDPOINT ||
  (functionsBase ? `${functionsBase}/photo` : usingEmulators ? `http://127.0.0.1:5001/demo-filmroll/${region}/photo` : `https://${region}-${config.projectId}.cloudfunctions.net/photo`);
