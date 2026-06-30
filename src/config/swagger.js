const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

function getServerUrl() {
  if (process.env.SERVER_URL) {
    return process.env.SERVER_URL.replace(/\/$/, '');
  }
  const port = process.env.PORT || 5000;
  return `http://localhost:${port}`;
}

const swaggerDir = path.join(__dirname, '../swagger');

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'TinyBit Mobile API',
      version: '1.0.0',
      description:
        'OpenAPI documentation for the TinyBit (DD Medax) mobile app backend. ' +
        'Admin panel routes under `/admin` are excluded. ' +
        'Deprecated Twilio OTP endpoints return HTTP 410 — use Firebase phone auth + `POST /api/auth/phone`.',
      contact: {
        name: 'TinyBit',
      },
    },
    servers: [
      {
        url: getServerUrl(),
        description: process.env.SERVER_URL ? 'Configured URL (Default)' : 'Local development',
      },
      {
        url: getServerUrl().replace(/^https:/i, 'http:'),
        description: 'HTTP Fallback (Force HTTP)',
      },
      {
        url: '/',
        description: 'Relative Path (Protocol Agnostic)',
      },
    ],
    tags: [
      { name: 'Health', description: 'Server health check' },
      { name: 'Auth', description: 'Authentication and user profile' },
      { name: 'AI', description: 'Sathi AI features' },
      { name: 'Guardian', description: 'Guardian–elder linking' },
      { name: 'SOS', description: 'Emergency SOS' },
      { name: 'Wellness', description: 'Daily check-ins and health metrics' },
      { name: 'Medicines', description: 'Medicine management' },
      { name: 'Appointments', description: 'Doctor appointments' },
      { name: 'Care Events', description: 'Care calendar' },
      { name: 'Journal', description: 'Memory journal' },
      { name: 'Family Messages', description: 'Family messaging' },
      { name: 'Health Card', description: 'Emergency health QR card' },
      { name: 'Health Vault', description: 'Health document vault' },
      { name: 'Mind Games', description: 'Cognitive games' },
      { name: 'Location', description: 'Elder location sharing' },
      { name: 'Doctors', description: 'Doctor directory' },
      { name: 'Content', description: 'Daily quiz and inspiration' },
      { name: 'Mood Media', description: 'Mood Lift media' },
      { name: 'Storage', description: 'S3 presigned upload and download' },
    ],
  },
  apis: [
    path.join(swaggerDir, 'schemas.js'),
    path.join(swaggerDir, 'paths', '*.js'),
  ],
};

let cachedSpec = null;

function getOpenApiSpec() {
  if (!cachedSpec) {
    cachedSpec = swaggerJsdoc(options);
  }
  return cachedSpec;
}

function countDocumentedEndpoints(spec) {
  let count = 0;
  for (const pathItem of Object.values(spec.paths ?? {})) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'options', 'head']) {
      if (pathItem[method]) count += 1;
    }
  }
  return count;
}

function mountSwagger(app) {
  const spec = getOpenApiSpec();

  app.get('/api/docs/openapi.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.json(spec);
  });

  app.use(
    '/api/docs',
    swaggerUi.serve,
    swaggerUi.setup(spec, {
      customSiteTitle: 'TinyBit API Docs',
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
      },
    }),
  );
}

module.exports = {
  getOpenApiSpec,
  countDocumentedEndpoints,
  mountSwagger,
};
