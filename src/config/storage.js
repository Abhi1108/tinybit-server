/**
 * S3 storage configuration.
 * EC2 uses the instance IAM role; local dev may set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.
 */

const DEFAULT_REGION = 'ap-northeast-1';

function getBucket() {
  return String(process.env.S3_BUCKET || '').trim();
}

function getRegion() {
  return String(process.env.S3_REGION || DEFAULT_REGION).trim() || DEFAULT_REGION;
}

function isStorageConfigured() {
  return getBucket().length > 0;
}

/** Public URL stored in MySQL (S3 virtual-hosted style or CloudFront override). */
function buildPublicUrl(key) {
  const customBase = String(process.env.S3_PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  if (customBase) {
    return `${customBase}/${key}`;
  }
  const bucket = getBucket();
  const region = getRegion();
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

module.exports = {
  getBucket,
  getRegion,
  isStorageConfigured,
  buildPublicUrl,
};
