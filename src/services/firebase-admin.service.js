const fs = require('fs');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

let jwks = null;

/** Mobile app Firebase project (google-services.json → project_info.project_id). */
const EXPECTED_FIREBASE_PROJECT_ID = process.env.EXPECTED_FIREBASE_PROJECT_ID || 'tinybit-eldercare';

/** JWKS endpoint for Firebase securetoken public keys (more reliable than x509 on Vercel). */
const FIREBASE_JWKS_URI =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

function parseServiceAccountJson(raw) {
  let parsed = JSON.parse(raw);
  if (typeof parsed === 'string') {
    parsed = JSON.parse(parsed);
  }

  if (!parsed || parsed.type !== 'service_account' || !parsed.project_id || !parsed.private_key) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON must be the Firebase Admin service account file ' +
      '(type: "service_account"), not google-services.json.',
    );
  }

  if (typeof parsed.private_key === 'string' && !parsed.private_key.includes('\n')) {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }

  return parsed;
}

function readServiceAccountFromEnv() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (json) {
    return parseServiceAccountJson(json);
  }

  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (credentialsPath) {
    return parseServiceAccountJson(fs.readFileSync(credentialsPath, 'utf8'));
  }

  return null;
}

function getProjectId() {
  const serviceAccount = readServiceAccountFromEnv();
  return serviceAccount?.project_id || EXPECTED_FIREBASE_PROJECT_ID;
}

function getJwksClient() {
  if (!jwks) {
    jwks = jwksClient({
      jwksUri: FIREBASE_JWKS_URI,
      cache: true,
      cacheMaxAge: 6 * 60 * 60 * 1000,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });
  }
  return jwks;
}

function getSigningKey(header, callback) {
  if (!header?.kid) {
    callback(new Error('Firebase ID token is missing "kid" header claim'));
    return;
  }

  getJwksClient().getSigningKey(header.kid, (err, key) => {
    if (err) {
      callback(err);
      return;
    }

    const publicKey = key?.getPublicKey?.();
    if (!publicKey) {
      callback(new Error('Could not resolve Firebase public signing key'));
      return;
    }

    callback(null, publicKey);
  });
}

function getFirebaseAdminStatus() {
  try {
    const serviceAccount = readServiceAccountFromEnv();
    if (!serviceAccount) {
      return {
        configured: false,
        expectedProjectId: EXPECTED_FIREBASE_PROJECT_ID,
      };
    }

    const projectId = serviceAccount.project_id;
    return {
      configured: true,
      projectId,
      expectedProjectId: EXPECTED_FIREBASE_PROJECT_ID,
      projectMatchesApp: projectId === EXPECTED_FIREBASE_PROJECT_ID,
      clientEmail: serviceAccount.client_email,
      verifier: 'jwks',
    };
  } catch (err) {
    return {
      configured: false,
      expectedProjectId: EXPECTED_FIREBASE_PROJECT_ID,
      parseError: err.message,
    };
  }
}

function peekJwtClaims(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return {
      iss: payload.iss,
      aud: payload.aud,
      sub: typeof payload.sub === 'string' ? payload.sub.slice(0, 12) : null,
    };
  } catch {
    return null;
  }
}

function normalizeIdToken(raw) {
  if (typeof raw !== 'string') {
    throw new Error(`idToken must be a string (got ${typeof raw})`);
  }

  const token = raw.trim();
  if (!token) {
    throw new Error('idToken is empty');
  }

  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error('idToken is not a valid JWT');
  }

  return token;
}

async function verifyFirebaseIdToken(idToken) {
  const token = normalizeIdToken(idToken);
  const projectId = getProjectId();
  const issuer = `https://securetoken.google.com/${projectId}`;

  const decoded = await new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getSigningKey,
      {
        algorithms: ['RS256'],
        audience: projectId,
        issuer,
      },
      (err, payload) => {
        if (err) reject(err);
        else resolve(payload);
      },
    );
  });

  if (typeof decoded.sub !== 'string' || !decoded.sub) {
    throw new Error('Firebase ID token has no subject claim');
  }

  return {
    ...decoded,
    uid: decoded.sub,
  };
}

module.exports = {
  verifyFirebaseIdToken,
  getFirebaseAdminStatus,
  peekJwtClaims,
  normalizeIdToken,
  EXPECTED_FIREBASE_PROJECT_ID,
};
