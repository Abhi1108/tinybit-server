// Lazy-loaded so a missing package can't crash route registration at startup
let _QRCode = null;
function getQRCode() {
  if (!_QRCode) _QRCode = require('qrcode');
  return _QRCode;
}

const healthCardService = require('../services/health-card.service');

/** Public base URL for health-card QR links (must be reachable without Vercel Deployment Protection). */
function getServerUrl() {
  if (process.env.SERVER_URL) {
    return process.env.SERVER_URL.replace(/\/$/, '');
  }
  // Per-deployment VERCEL_URL (*.vercel.app) often has Deployment Protection; production alias does not.
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  const port = process.env.PORT || 5000;
  return `http://localhost:${port}`;
}

// POST /api/health-card/generate — requires auth
const generateHealthCardToken = async (req, res) => {
  const userId = req.supabase?.userId;
  if (!userId) return res.status(401).json({ success: false, message: 'Not authenticated' });

  try {
    const { token, expiresAt } = await healthCardService.generateHealthCardToken(userId);
    const serverUrl = getServerUrl();
    const scanUrl = `${serverUrl}/api/health-card/${token}`;

    return res.json({ success: true, data: { token, scanUrl, expiresAt } });
  } catch (err) {
    console.error('[health-card] generateHealthCardToken error:', err);
    return res.status(500).json({ success: false, message: 'Failed to generate health card token' });
  }
};

// GET /api/health-card/:token — public, no auth required
// Add ?format=json to get raw JSON instead of the HTML page
const getHealthCard = async (req, res) => {
  const { token } = req.params;
  const format = req.query.format;

  if (!token || token.length < 10) {
    return res.status(400).send(renderErrorHTML('Invalid health card link.'));
  }

  try {
    const profile = await healthCardService.findProfileByHealthQrToken(token);

    if (!profile) {
      return res.status(404).send(renderErrorHTML('Health card not found. The link may be invalid.'));
    }

    if (profile.health_qr_expires_at && new Date(profile.health_qr_expires_at) < new Date()) {
      return res.status(410).send(renderErrorHTML('This health card has expired. Please ask the person to regenerate their card in the TinyBit app.'));
    }

    const enriched = await healthCardService.enrichProfileForHealthCard({ ...profile });

    if (format === 'json') {
      const { health_qr_expires_at, health_qr_token, ...safeData } = enriched;
      return res.json({ success: true, data: safeData });
    }

    return res.send(renderHealthCardHTML(enriched));
  } catch (err) {
    console.error('[health-card] getHealthCard error:', err);
    return res.status(500).send(renderErrorHTML('Server error. Please try again.'));
  }
};

// ─── HTML helpers ────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(dateStr) {
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  } catch {
    return dateStr ?? '';
  }
}

function calcAge(dobStr) {
  try {
    const ms = Date.now() - new Date(dobStr).getTime();
    return `${Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000))} yrs`;
  } catch {
    return '';
  }
}

const CONDITION_LABELS = {
  none: null,
  diabetes: 'Diabetes',
  pre_diabetes: 'Pre-Diabetes',
  cholesterol: 'High Cholesterol',
  hypertension: 'Hypertension',
  pcos: 'PCOS',
  thyroid: 'Thyroid Disorder',
  physical_injury: 'Physical Injury',
  stress_anxiety: 'Stress / Anxiety',
  sleep_issues: 'Sleep Issues',
  depression: 'Depression',
  anger_issues: 'Anger Issues',
  loneliness: 'Loneliness',
  relationship_stress: 'Relationship Stress',
  others: 'Other',
};

function renderHealthCardHTML(p) {
  const name = p.full_name
    || [p.first_name, p.last_name].filter(Boolean).join(' ')
    || 'Unknown';

  const ageLine = p.age
    ? `${p.age} yrs`
    : (p.date_of_birth ? calcAge(p.date_of_birth) : '');

  const dobLine = p.date_of_birth ? formatDate(p.date_of_birth) : '';

  const sexLabel = p.biological_sex
    ? p.biological_sex.charAt(0).toUpperCase() + p.biological_sex.slice(1)
    : '';

  const metaParts = [
    ageLine && `<span class="meta-pill">${escapeHtml(ageLine)}</span>`,
    dobLine && `<span class="meta-pill">DOB: ${escapeHtml(dobLine)}</span>`,
    sexLabel && `<span class="meta-pill">${escapeHtml(sexLabel)}</span>`,
  ].filter(Boolean).join('');

  const bloodGroup = p.blood_group || 'N/A';

  // Emergency contact block
  const hasEmergencyContact = p.emergency_name || p.emergency_phone;
  const emergencyBlock = hasEmergencyContact
    ? `<div class="contact-row">
        <div class="contact-avatar">${escapeHtml((p.emergency_name || 'EC')[0].toUpperCase())}</div>
        <div class="contact-info">
          <div class="contact-name">${escapeHtml(p.emergency_name || 'Emergency Contact')}</div>
          <div class="contact-rel">${escapeHtml(p.emergency_relation || '')}</div>
        </div>
        ${p.emergency_phone
          ? `<a class="call-pill" href="tel:${escapeHtml(p.emergency_phone)}">
               <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
               Call
             </a>`
          : ''}
      </div>
      ${p.emergency_phone
        ? `<div style="margin-top:10px;">
             <a class="call-full" href="tel:${escapeHtml(p.emergency_phone)}">${escapeHtml(p.emergency_phone)}</a>
           </div>`
        : ''}`
    : `<div class="empty-state">No emergency contact on file</div>`;

  // Medical conditions — map keys to labels, skip 'none'
  const rawConditions = Array.isArray(p.medical_conditions) ? p.medical_conditions : [];
  const conditionLabels = rawConditions
    .filter(c => c !== 'none')
    .map(c => CONDITION_LABELS[c] !== undefined ? CONDITION_LABELS[c] : c)
    .filter(Boolean);

  if (p.other_condition && p.other_condition.trim()) {
    conditionLabels.push(p.other_condition.trim());
  }

  const conditionsBlock = conditionLabels.length > 0
    ? conditionLabels.map(c => `<div class="tag">${escapeHtml(c)}</div>`).join('')
    : `<div class="empty-state">No conditions on file</div>`;

  // Allergies
  const rawAllergies = Array.isArray(p.allergies) ? p.allergies : [];
  const allergiesBlock = rawAllergies.length > 0
    ? rawAllergies.map(a => `<div class="tag tag-warn">${escapeHtml(a)}</div>`).join('')
    : `<div class="empty-state">No known allergies on file</div>`;

  // Medications
  const rawMeds = Array.isArray(p.medications) ? p.medications : [];
  const filteredMeds = rawMeds.filter(m => typeof m === 'string' ? m.trim() : m?.name?.trim());
  const medsBlock = filteredMeds.length > 0
    ? filteredMeds.map(m => {
        if (typeof m === 'string') {
          return `<div class="med-item"><div class="med-name">${escapeHtml(m)}</div></div>`;
        }
        return `<div class="med-item">
          <div class="med-name">${escapeHtml(m.name || '')}</div>
          <div class="med-detail">${[m.dosage, m.timing].filter(Boolean).map(escapeHtml).join(' · ')}</div>
        </div>`;
      }).join('')
    : `<div class="empty-state">No medications on file</div>`;

  // Doctor info
  const doctorBlock = p.doctor_name
    ? `<div class="doctor-row">
        <div class="doctor-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        </div>
        <div>
          <div class="doctor-name">${escapeHtml(p.doctor_name)}</div>
          ${p.doctor_contact ? `<div class="doctor-contact">${escapeHtml(p.doctor_contact)}</div>` : ''}
        </div>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>Emergency Health Card — ${escapeHtml(name)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { -webkit-text-size-adjust: 100%; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
      background: #f0f3f8;
      color: #1a2030;
      min-height: 100vh;
      padding-bottom: 40px;
    }

    /* ── Header ── */
    .header {
      background: linear-gradient(145deg, #b71c1c 0%, #c62828 40%, #e53935 100%);
      padding: 28px 20px 24px;
      position: relative;
      overflow: hidden;
    }
    .header::before {
      content: '';
      position: absolute;
      top: -30px; right: -30px;
      width: 160px; height: 160px;
      border-radius: 50%;
      background: rgba(255,255,255,0.07);
    }
    .header::after {
      content: '';
      position: absolute;
      bottom: -40px; left: -20px;
      width: 120px; height: 120px;
      border-radius: 50%;
      background: rgba(255,255,255,0.05);
    }
    .header-tag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(255,255,255,0.18);
      border: 1px solid rgba(255,255,255,0.25);
      border-radius: 20px;
      padding: 4px 12px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: #fff;
      margin-bottom: 14px;
    }
    .header-name {
      font-size: 30px;
      font-weight: 800;
      color: #fff;
      line-height: 1.15;
      letter-spacing: -0.3px;
    }
    .header-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }
    .meta-pill {
      background: rgba(255,255,255,0.15);
      border: 1px solid rgba(255,255,255,0.2);
      color: rgba(255,255,255,0.95);
      border-radius: 20px;
      padding: 4px 12px;
      font-size: 12px;
      font-weight: 600;
    }

    /* ── Blood group hero ── */
    .blood-hero {
      background: #fff;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid #eef2f7;
      gap: 12px;
    }
    .blood-group-wrap {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .blood-drop {
      width: 44px; height: 44px;
      background: linear-gradient(135deg, #ffebee, #ffcdd2);
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .blood-drop-inner {
      transform: rotate(45deg);
      font-size: 18px;
      font-weight: 900;
      color: #c62828;
      line-height: 1;
    }
    .blood-label { font-size: 11px; color: #8a94a6; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; }
    .blood-value { font-size: 26px; font-weight: 900; color: #b71c1c; line-height: 1; }
    .doctor-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      background: #f7f9fc;
      border-radius: 12px;
      padding: 10px 14px;
    }
    .doctor-icon { width: 28px; height: 28px; background: #e8f0fe; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #3d5afe; flex-shrink: 0; margin-top: 2px; }
    .doctor-name { font-size: 14px; font-weight: 700; color: #1a2030; }
    .doctor-contact { font-size: 13px; color: #6b7a8d; margin-top: 2px; }

    /* ── Card container ── */
    .cards { padding: 12px 12px 0; display: flex; flex-direction: column; gap: 10px; }

    /* ── Section card ── */
    .card {
      background: #fff;
      border-radius: 18px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04);
    }
    .card-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 16px 12px;
      border-bottom: 1px solid #f4f6fa;
    }
    .card-icon {
      width: 32px; height: 32px;
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      font-size: 16px;
      flex-shrink: 0;
    }
    .card-icon.red    { background: #ffebee; }
    .card-icon.blue   { background: #e3f2fd; }
    .card-icon.orange { background: #fff3e0; }
    .card-icon.green  { background: #e8f5e9; }
    .card-icon.purple { background: #f3e5f5; }
    .card-title { font-size: 13px; font-weight: 700; color: #4a5568; text-transform: uppercase; letter-spacing: 0.8px; }
    .card-body { padding: 14px 16px; }

    /* ── Emergency contact ── */
    .contact-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .contact-avatar {
      width: 44px; height: 44px;
      background: linear-gradient(135deg, #b71c1c, #e53935);
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; font-weight: 800; color: #fff;
      flex-shrink: 0;
    }
    .contact-info { flex: 1; min-width: 0; }
    .contact-name { font-size: 16px; font-weight: 700; color: #1a2030; }
    .contact-rel { font-size: 13px; color: #6b7a8d; margin-top: 2px; }
    .call-pill {
      display: inline-flex; align-items: center; gap: 5px;
      background: #2e7d32; color: #fff;
      text-decoration: none;
      padding: 8px 14px; border-radius: 20px;
      font-size: 13px; font-weight: 700;
      white-space: nowrap;
    }
    .call-full {
      display: block;
      background: linear-gradient(135deg, #1b5e20, #2e7d32);
      color: #fff; text-decoration: none;
      text-align: center;
      padding: 13px;
      border-radius: 12px;
      font-size: 15px; font-weight: 700;
      letter-spacing: 0.5px;
      margin-top: 10px;
    }

    /* ── Tags ── */
    .tags { display: flex; flex-wrap: wrap; gap: 8px; }
    .tag {
      background: #eef2ff;
      color: #3d4f8a;
      border: 1px solid #c7d0f5;
      border-radius: 20px;
      padding: 6px 14px;
      font-size: 13px; font-weight: 600;
    }
    .tag-warn {
      background: #fff8e1;
      color: #b45309;
      border-color: #fcd34d;
    }

    /* ── Medications ── */
    .med-item {
      padding: 10px 0;
      border-bottom: 1px solid #f4f6fa;
    }
    .med-item:last-child { border-bottom: none; }
    .med-name { font-size: 15px; font-weight: 600; color: #1a2030; }
    .med-detail { font-size: 13px; color: #6b7a8d; margin-top: 3px; }

    /* ── Empty state ── */
    .empty-state {
      font-size: 14px;
      color: #b0bcc8;
      font-style: italic;
      padding: 4px 0;
    }

    /* ── Footer ── */
    .footer {
      text-align: center;
      padding: 28px 20px 16px;
      font-size: 11px;
      color: #b0bcc8;
      line-height: 1.8;
    }
    .footer strong { color: #8a94a6; }
  </style>
</head>
<body>

  <!-- Header -->
  <div class="header">
    <div class="header-tag">🚨 Emergency Health Card</div>
    <div class="header-name">${escapeHtml(name)}</div>
    <div class="header-meta">${metaParts}</div>
  </div>

  <!-- Blood group + doctor -->
  <div class="blood-hero">
    <div class="blood-group-wrap">
      <div class="blood-drop">
        <div class="blood-drop-inner">${escapeHtml(bloodGroup.replace('+','').replace('-',''))}</div>
      </div>
      <div>
        <div class="blood-label">Blood Group</div>
        <div class="blood-value">${escapeHtml(bloodGroup)}</div>
      </div>
    </div>
    ${doctorBlock}
  </div>

  <div class="cards">

    <!-- Emergency Contact -->
    <div class="card">
      <div class="card-header">
        <div class="card-icon red">🆘</div>
        <div class="card-title">Emergency Contact</div>
      </div>
      <div class="card-body">
        ${emergencyBlock}
      </div>
    </div>

    <!-- Medical Conditions -->
    <div class="card">
      <div class="card-header">
        <div class="card-icon blue">⚕️</div>
        <div class="card-title">Medical Conditions</div>
      </div>
      <div class="card-body">
        <div class="tags">${conditionsBlock}</div>
      </div>
    </div>

    <!-- Allergies -->
    <div class="card">
      <div class="card-header">
        <div class="card-icon orange">⚠️</div>
        <div class="card-title">Allergies</div>
      </div>
      <div class="card-body">
        <div class="tags">${allergiesBlock}</div>
      </div>
    </div>

    <!-- Medications -->
    <div class="card">
      <div class="card-header">
        <div class="card-icon green">💊</div>
        <div class="card-title">Current Medications</div>
      </div>
      <div class="card-body">
        ${medsBlock}
      </div>
    </div>

  </div>

  <div class="footer">
    <strong>TinyBit Health</strong> · Emergency use only<br>
    Data self-reported. Always consult a qualified medical professional.
  </div>

</body>
</html>`;
}

function renderErrorHTML(message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Health Card — Error</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; background: #f5f5f5;
    }
    .box {
      background: #fff; border-radius: 20px; padding: 40px 32px;
      text-align: center; max-width: 360px; width: 90%;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    }
    .icon { font-size: 40px; margin-bottom: 16px; }
    h2 { color: #c62828; font-size: 20px; font-weight: 700; margin-bottom: 10px; }
    p { color: #5a6478; font-size: 15px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="box">
    <div class="icon">⚠️</div>
    <h2>Unable to Load</h2>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}

// GET /api/health-card/qr — auth required
// Returns the QR as a base64 PNG data URL, auto-generating a token if needed
const getHealthCardQR = async (req, res) => {
  const userId = req.supabase?.userId;
  if (!userId) return res.status(401).json({ success: false, message: 'Not authenticated' });

  try {
    const { token, expiresAt } = await healthCardService.getOrCreateHealthQrToken(userId);

    const serverUrl = getServerUrl();
    const scanUrl = `${serverUrl}/api/health-card/${token}`;

    const qrDataUrl = await getQRCode().toDataURL(scanUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 300,
      color: { dark: '#1A3050', light: '#FFFFFF' },
    });

    return res.json({ success: true, data: { qrDataUrl, scanUrl, expiresAt, token } });
  } catch (err) {
    console.error('[health-card] getHealthCardQR error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

module.exports = { generateHealthCardToken, getHealthCard, getHealthCardQR };
