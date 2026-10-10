
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const requiredFields = [
  'apiKey',
  'authDomain',
  'databaseURL',
  'projectId',
  'appId',
];

const missingFields = requiredFields.filter(
  (field) => !firebaseConfig[field]
);

export const firebaseConfigured = missingFields.length === 0;

let auth = null;
let db = null;

if (firebaseConfigured) {
  // Reuse the existing app only if it has the expected project config.
  const existingApp = getApps().find(
    (app) => app.name === '[DEFAULT]'
  );

  const app = existingApp
    ? getApp()
    : initializeApp(firebaseConfig);

  if (
    app.options.projectId !== firebaseConfig.projectId ||
    app.options.databaseURL !== firebaseConfig.databaseURL
  ) {
    console.error(
      'Firebase configuration mismatch.',
      {
        expectedProjectId: firebaseConfig.projectId,
        actualProjectId: app.options.projectId,
        expectedDatabaseURL: firebaseConfig.databaseURL,
        actualDatabaseURL: app.options.databaseURL,
      }
    );
  }

  auth = getAuth(app);
  db = getDatabase(app, firebaseConfig.databaseURL);

  console.log('Firebase connected:', {
    projectId: app.options.projectId,
    databaseURL: db.app.options.databaseURL,
  });
} else {
  console.error(
    'Firebase configuration is incomplete. Missing:',
    missingFields
  );
}

export { auth, db };
