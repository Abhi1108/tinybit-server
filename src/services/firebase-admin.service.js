const admin = require('firebase-admin');

let initialized = false;

function initFirebaseAdmin() {
  if (initialized || admin.apps.length > 0) {
    initialized = true;
    return;
  }

  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json) {
    const serviceAccount = JSON.parse(json);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    initialized = true;
    return;
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp();
    initialized = true;
    return;
  }

  throw new Error(
    'Firebase Admin is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS.',
  );
}

async function verifyFirebaseIdToken(idToken) {
  initFirebaseAdmin();
  return admin.auth().verifyIdToken(idToken);
}

module.exports = {
  verifyFirebaseIdToken,
};
