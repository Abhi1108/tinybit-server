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

function formatMedicineTiming(m) {
  if (m.time?.trim()) return m.time.trim();
  if (m.schedule_time === 'Morning') return '8:00 AM';
  if (m.schedule_time === 'Afternoon') return '12:00 PM';
  if (m.schedule_time === 'Night' || m.schedule_time === 'Evening') return '8:00 PM';
  return m.frequency || '';
}

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

  const bloodGroup = p.blood_group || 'N/A';
  const avatarInitial = (name.trim()[0] || '?').toUpperCase();
  const avatarBlock = p.avatar_url
    ? `<img src="${escapeHtml(p.avatar_url)}" class="avatar-img" alt="${escapeHtml(avatarInitial)}" />`
    : `<div class="avatar-fallback">${escapeHtml(avatarInitial)}</div>`;

  const patientDetails = [
    ageLine && `Age: ${escapeHtml(ageLine)}`,
    sexLabel && `Gender: ${escapeHtml(sexLabel)}`,
    dobLine && `DOB: ${escapeHtml(dobLine)}`,
  ].filter(Boolean).join('<br>');

  const hasEmergencyContact = p.emergency_name || p.emergency_phone;
  const emergencyBlock = hasEmergencyContact
    ? `<div class="emergency-card">
        <div class="section-kicker">Emergency Contact</div>
        <div class="emergency-row">
          <div>
            <div class="emergency-name">${escapeHtml(p.emergency_name || 'Emergency Contact')}</div>
            ${p.emergency_relation ? `<div class="emergency-rel">${escapeHtml(p.emergency_relation)}</div>` : ''}
          </div>
          ${p.emergency_phone
            ? `<a class="call-chip" href="tel:${escapeHtml(p.emergency_phone)}">Call</a>`
            : ''}
        </div>
        ${p.emergency_phone
          ? `<a class="call-full" href="tel:${escapeHtml(p.emergency_phone)}">${escapeHtml(p.emergency_phone)}</a>`
          : ''}
      </div>`
    : `<div class="empty-state">No emergency contact on file</div>`;

  const rawConditions = Array.isArray(p.medical_conditions) ? p.medical_conditions : [];
  const conditionLabels = rawConditions
    .filter(c => c !== 'none')
    .map(c => CONDITION_LABELS[c] !== undefined ? CONDITION_LABELS[c] : c)
    .filter(Boolean);

  if (p.other_condition && p.other_condition.trim()) {
    conditionLabels.push(p.other_condition.trim());
  }

  const conditionsBlock = conditionLabels.length > 0
    ? conditionLabels.map(c => `<span class="chip chip-blue">${escapeHtml(c)}</span>`).join('')
    : `<span class="empty-inline">None on file</span>`;

  const rawAllergies = Array.isArray(p.allergies) ? p.allergies : [];
  const allergiesBlock = rawAllergies.length > 0
    ? rawAllergies.map(a => `<span class="chip chip-warn">${escapeHtml(a)}</span>`).join('')
    : `<span class="empty-inline">None on file</span>`;

  const rawMeds = Array.isArray(p.medications) ? p.medications : [];
  const filteredMeds = rawMeds.filter(m => typeof m === 'string' ? m.trim() : m?.name?.trim());
  const medsBlock = filteredMeds.length > 0
    ? filteredMeds.map(m => {
        if (typeof m === 'string') {
          return `<div class="med-card"><div class="med-name">${escapeHtml(m)}</div></div>`;
        }
        const timing = formatMedicineTiming(m);
        return `<div class="med-card">
          <div class="med-main">
            <div class="med-name">${escapeHtml(m.name || '')}</div>
            <div class="med-detail">${[m.dosage, timing].filter(Boolean).map(escapeHtml).join(' · ')}</div>
          </div>
          ${timing ? `<div class="med-time">${escapeHtml(timing)}</div>` : ''}
        </div>`;
      }).join('')
    : `<div class="empty-state">No active medications on file</div>`;

  const doctorBlock = p.doctor_name
    ? `<div class="doctor-card">
        <div class="doctor-label">Primary Doctor</div>
        <div class="doctor-name">${escapeHtml(p.doctor_name)}</div>
        ${p.doctor_contact ? `<a class="doctor-phone" href="tel:${escapeHtml(p.doctor_contact)}">${escapeHtml(p.doctor_contact)}</a>` : ''}
      </div>`
    : '';

  const stickyCallBar = p.emergency_phone
    ? `<a class="sticky-call" href="tel:${escapeHtml(p.emergency_phone)}">
         <span>Call Emergency Contact</span>
         <strong>${escapeHtml(p.emergency_phone)}</strong>
       </a>`
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
      background: #f7f9fc;
      color: #1a2030;
      min-height: 100vh;
      padding-bottom: ${p.emergency_phone ? '88px' : '32px'};
    }
    .page { max-width: 480px; margin: 0 auto; background: #fff; min-height: 100vh; }
    .top-bar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 18px; border-bottom: 1px solid #eef2f7;
    }
    .brand { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 800; color: #1a3050; }
    .brand-dot {
      width: 30px; height: 30px; border-radius: 50%; background: #1a3050;
      display: flex; align-items: center; justify-content: center;
    }
    .brand-dot-inner { width: 12px; height: 12px; border: 2.5px solid #fff; border-radius: 50%; }
    .hero {
      text-align: center; padding: 22px 18px 18px; border-bottom: 1px solid #eef2f7;
    }
    .hero-badge {
      display: inline-block; background: #dc2626; color: #fff;
      font-size: 11px; font-weight: 800; letter-spacing: 1.4px; text-transform: uppercase;
      padding: 5px 14px; border-radius: 4px; margin-bottom: 10px;
    }
    .hero-title { font-size: 24px; font-weight: 800; color: #1a2030; }
    .hero-sub { margin-top: 6px; font-size: 13px; color: #6b7a8d; }
    .patient-card {
      margin: 16px; padding: 16px; border: 1px solid #e8edf3; border-radius: 16px;
      display: flex; gap: 12px; align-items: flex-start;
    }
    .avatar-img, .avatar-fallback {
      width: 64px; height: 64px; border-radius: 50%; flex-shrink: 0; object-fit: cover;
    }
    .avatar-fallback {
      display: flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, #304b76, #4b99ca);
      color: #fff; font-size: 26px; font-weight: 900;
    }
    .patient-name { font-size: 18px; font-weight: 800; color: #1a2030; }
    .patient-detail { margin-top: 4px; font-size: 13px; color: #6b7a8d; line-height: 1.5; }
    .blood-badge {
      margin-left: auto; background: #dc2626; color: #fff; border-radius: 10px;
      padding: 8px 10px; text-align: center; flex-shrink: 0;
    }
    .blood-label { font-size: 9px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; }
    .blood-value { font-size: 20px; font-weight: 900; line-height: 1.1; margin-top: 2px; }
    .split-row { display: flex; gap: 0; margin: 0 16px 16px; }
    .split-col {
      flex: 1; padding: 14px; border: 1px solid #e8edf3;
    }
    .split-col.conditions {
      background: #eff6ff; border-color: #bfdbfe; border-radius: 12px 0 0 12px; border-right: none;
    }
    .split-col.allergies {
      background: #fef2f2; border-color: #fecaca; border-radius: 0 12px 12px 0;
    }
    .section-kicker {
      font-size: 10px; font-weight: 800; letter-spacing: 1.1px; text-transform: uppercase;
      color: #6b7a8d; margin-bottom: 10px;
    }
    .split-col.conditions .section-kicker { color: #2563eb; }
    .split-col.allergies .section-kicker { color: #dc2626; }
    .chip {
      display: inline-block; border-radius: 20px; padding: 5px 12px;
      font-size: 12px; font-weight: 700; margin: 0 6px 6px 0;
    }
    .chip-blue { background: #dbeafe; color: #1e40af; }
    .chip-warn { background: #fee2e2; color: #dc2626; }
    .section { margin: 0 16px 16px; }
    .emergency-card {
      border: 1px solid #e8edf3; border-radius: 14px; padding: 14px; background: #fff;
    }
    .emergency-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .emergency-name { font-size: 16px; font-weight: 800; color: #1a2030; }
    .emergency-rel { font-size: 13px; color: #6b7a8d; margin-top: 2px; }
    .call-chip {
      background: #2e7d32; color: #fff; text-decoration: none;
      padding: 8px 14px; border-radius: 20px; font-size: 13px; font-weight: 700;
    }
    .call-full {
      display: block; margin-top: 10px; text-align: center; text-decoration: none;
      background: linear-gradient(135deg, #1b5e20, #2e7d32); color: #fff;
      padding: 12px; border-radius: 12px; font-size: 15px; font-weight: 700;
    }
    .med-card {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      border: 1px solid #e8edf3; border-radius: 12px; padding: 12px 14px; margin-bottom: 10px;
      background: #fff;
    }
    .med-name { font-size: 15px; font-weight: 700; color: #1a2030; }
    .med-detail { font-size: 12px; color: #6b7a8d; margin-top: 3px; }
    .med-time {
      background: #f0f4f8; border-radius: 8px; padding: 8px 12px;
      font-size: 13px; font-weight: 700; color: #1a2030; white-space: nowrap;
    }
    .doctor-card {
      margin: 0 16px 16px; padding: 14px; border-radius: 12px; background: #f7f9fc; border: 1px solid #e8edf3;
    }
    .doctor-label { font-size: 10px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: #6b7a8d; }
    .doctor-name { margin-top: 6px; font-size: 15px; font-weight: 700; color: #1a2030; }
    .doctor-phone { display: inline-block; margin-top: 6px; color: #2563eb; font-weight: 700; text-decoration: none; }
    .empty-state, .empty-inline { font-size: 13px; color: #b0bcc8; font-style: italic; }
    .footer {
      text-align: center; padding: 20px 18px 28px; font-size: 11px; color: #9aa5b4; line-height: 1.7;
      border-top: 1px solid #eef2f7;
    }
    .footer strong { color: #2563eb; }
    .sticky-call {
      position: fixed; left: 0; right: 0; bottom: 0;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 2px; padding: 14px 18px calc(14px + env(safe-area-inset-bottom));
      background: linear-gradient(135deg, #b71c1c, #e53935); color: #fff; text-decoration: none;
      font-size: 12px; font-weight: 700; letter-spacing: 0.3px;
      box-shadow: 0 -4px 20px rgba(0,0,0,0.15);
    }
    .sticky-call strong { font-size: 18px; font-weight: 900; }
  </style>
</head>
<body>
  <div class="page">
    <div class="top-bar">
      <div class="brand">
        <div class="brand-dot"><div class="brand-dot-inner"></div></div>
        TinyBit
      </div>
      <span style="font-size:12px;color:#9aa5b4;">Emergency</span>
    </div>

    <div class="hero">
      <div class="hero-badge">Emergency Health Card</div>
      <div class="hero-title">${escapeHtml(name)}</div>
      <div class="hero-sub">Critical medical information for first responders</div>
    </div>

    <div class="patient-card">
      ${avatarBlock}
      <div style="flex:1;min-width:0;">
        <div class="patient-name">${escapeHtml(name)}</div>
        ${patientDetails ? `<div class="patient-detail">${patientDetails}</div>` : ''}
      </div>
      <div class="blood-badge">
        <div class="blood-label">Blood</div>
        <div class="blood-value">${escapeHtml(bloodGroup)}</div>
      </div>
    </div>

    <div class="split-row">
      <div class="split-col conditions">
        <div class="section-kicker">Conditions</div>
        <div>${conditionsBlock}</div>
      </div>
      <div class="split-col allergies">
        <div class="section-kicker">Allergies</div>
        <div>${allergiesBlock}</div>
      </div>
    </div>

    <div class="section">
      <div class="section-kicker">Emergency Contact</div>
      ${emergencyBlock}
    </div>

    ${doctorBlock}

    <div class="section">
      <div class="section-kicker">Active Medications</div>
      ${medsBlock}
    </div>

    <div class="footer">
      <strong>TinyBit Health</strong><br>
      Self-reported data for emergency use only. Always consult a medical professional.
    </div>
  </div>
  ${stickyCallBar}
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
