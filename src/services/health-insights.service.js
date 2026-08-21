const { geminiFetch, geminiText, GEMINI_MODEL_VISION } = require('./gemini.service');

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH FORECAST — extracts health metrics from a report image/PDF and returns
// structured insights + recommendations tailored for elderly users.
// ═══════════════════════════════════════════════════════════════════════════════
const FORECAST_PROMPT = `You are a medical AI assistant analyzing a health document for an elderly patient. Extract every health metric and provide a clear, simple forecast.

Respond ONLY with valid JSON (no markdown, no extra text):
{
  "reportType": "Blood Test|Prescription|X-Ray|Scan|General Report|Unknown",
  "summary": "1-2 sentences summarizing the overall health status from this report",
  "alertLevel": "normal|caution|alert",
  "metrics": [
    {
      "name": "Metric name (e.g. Hemoglobin, Blood Sugar, Cholesterol)",
      "value": "Measured value with unit (e.g. 11.2 g/dL)",
      "status": "normal|low|high|borderline",
      "normalRange": "Normal reference range (e.g. 12-17 g/dL)",
      "insight": "1 simple sentence relevant to elderly health"
    }
  ],
  "riskFactors": ["Risk 1 identified from this report"],
  "recommendations": ["Clear, actionable recommendation for elderly patient"],
  "followUp": "When and what type of follow-up is suggested"
}

Rules:
- Extract ALL numeric values visible (blood counts, glucose, cholesterol, BP, etc.)
- For X-ray/MRI/CT: describe findings as metrics (e.g. name:"Bone Density", value:"Mild reduction")
- For prescriptions: list key medications (name: drug name, value: dosage + frequency)
- alertLevel: "normal"=all values in range, "caution"=borderline/mild abnormal, "alert"=significantly abnormal
- Recommendations must be simple and appropriate for elderly users (65+)
- If unreadable or no metrics found, respond: {"reportType":"Unknown","summary":"Could not extract health data from this document.","alertLevel":"normal","metrics":[],"riskFactors":[],"recommendations":["Please share a clearer image of your report"],"followUp":"Consult your doctor for interpretation"}`;

/** Single-document AI insights. Throws Error with .statusCode / .detail on failure. */
async function runHealthForecast({ base64, mimeType, category, title }) {
  if (typeof base64 !== 'string' || base64.length < 100) {
    const err = new Error('base64 document content is required');
    err.statusCode = 400;
    throw err;
  }

  const safeMime = mimeType?.trim() || 'image/jpeg';
  const isImage  = safeMime.startsWith('image/');
  // Gemini supports both images and PDFs via inlineData
  const geminiSupported = isImage || safeMime === 'application/pdf';

  if (!geminiSupported) {
    const err = new Error('Health forecast AI is currently unavailable.');
    err.statusCode = 502;
    throw err;
  }

  const contextNote = [
    title    ? `Document title: ${title}` : '',
    category ? `Document category: ${category}` : '',
  ].filter(Boolean).join('. ');
  const prompt = contextNote ? `${FORECAST_PROMPT}\n\nContext: ${contextNote}` : FORECAST_PROMPT;

  const geminiResp = await geminiFetch(GEMINI_MODEL_VISION, {
    contents: [{
      parts: [
        { inlineData: { mimeType: safeMime, data: base64 } },
        { text: prompt },
      ],
    }],
    generationConfig: { maxOutputTokens: 1200, temperature: 0.2 },
  }, 60_000);   // large PDFs need up to ~45 s

  if (!geminiResp.ok) {
    const detail = await geminiResp.text();
    const err = new Error('Health forecast AI is currently unavailable.');
    err.statusCode = 502;
    err.detail = detail;
    throw err;
  }

  const json    = await geminiResp.json();
  const content = geminiText(json).trim().replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(content);
  } catch {
    const err = new Error('Health forecast AI is currently unavailable.');
    err.statusCode = 502;
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH FORECAST MULTI — analyse several reports together in one Gemini call
// ═══════════════════════════════════════════════════════════════════════════════
const MULTI_FORECAST_PROMPT = `You are a medical AI performing a comprehensive cross-report health analysis for an elderly patient. Multiple health documents are provided. Identify trends, improvements, and deteriorations across them.

Respond ONLY with valid JSON (no markdown, no extra text):
{
  "reportType": "Multi-Report Analysis",
  "summary": "2-3 sentences summarising overall health trends across ALL provided documents",
  "alertLevel": "normal|caution|alert",
  "metrics": [
    {
      "name": "Metric name",
      "value": "Latest or trended value with unit",
      "status": "normal|low|high|borderline",
      "normalRange": "Reference range",
      "insight": "How this metric changed across the reports (improving / stable / worsening)"
    }
  ],
  "riskFactors": ["Risk factor identified from cross-report comparison"],
  "recommendations": ["Actionable recommendation based on multi-report trends for elderly patient"],
  "followUp": "Specific follow-up suggested based on trends seen across the documents"
}

Rules:
- Compare values across reports chronologically — always note if improving, stable, or declining.
- alertLevel: "normal" = trends positive, "caution" = some borderline trends, "alert" = significant worsening.
- If only one document is readable, still analyse it and note limited trend data.`;

/** Multi-document (2+) cross-report AI insights. Throws Error with .statusCode on failure. */
async function runMultiHealthForecast(records) {
  if (!Array.isArray(records) || records.length < 1) {
    const err = new Error('At least one record is required');
    err.statusCode = 400;
    throw err;
  }

  // Build Gemini content parts — one inlineData block per document
  const parts = [];
  for (const rec of records) {
    if (typeof rec.base64 !== 'string' || rec.base64.length < 100) continue;
    parts.push({ inlineData: { mimeType: rec.mimeType || 'image/jpeg', data: rec.base64 } });
    parts.push({ text: `[${rec.category || 'Document'}: "${rec.title || 'Record'}" — ${rec.date || 'Date unknown'}]` });
  }

  if (parts.length === 0) {
    const err = new Error('No readable documents found in the selection');
    err.statusCode = 400;
    throw err;
  }

  parts.push({ text: MULTI_FORECAST_PROMPT });

  const geminiResp = await geminiFetch(GEMINI_MODEL_VISION, {
    contents: [{ parts }],
    generationConfig: { maxOutputTokens: 1500, temperature: 0.2 },
  }, 90_000);   // larger timeout — processing N documents takes longer

  if (!geminiResp.ok) {
    const detail = await geminiResp.text();
    const err = new Error('Multi-report trend analysis AI is currently unavailable.');
    err.statusCode = 502;
    err.detail = detail;
    throw err;
  }

  const json    = await geminiResp.json();
  const content = geminiText(json).trim().replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(content);
  } catch {
    const err = new Error('Multi-report trend analysis AI is currently unavailable.');
    err.statusCode = 502;
    throw err;
  }
}

module.exports = { runHealthForecast, runMultiHealthForecast };
