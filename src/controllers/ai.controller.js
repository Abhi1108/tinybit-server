const { Buffer } = require('buffer');

const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL_TEXT   = 'gemini-2.0-flash';   // fast text + vision
const GEMINI_MODEL_VISION = 'gemini-2.0-flash';   // supports image input

// ── Key helpers ───────────────────────────────────────────────────────────────
function getOpenAiKey()  { return process.env.OPENAI_API_KEY; }
function getGeminiKey()  { return process.env.GEMINI_API_KEY; }

// ── OpenAI fetch helper (Whisper + TTS + fallback chat/vision) ────────────────
async function openAiFetch(path, init) {
  const apiKey = getOpenAiKey();
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY is not configured');
    err.statusCode = 500;
    throw err;
  }
  return fetch(`${OPENAI_BASE_URL}${path}`, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(25_000),
    headers: { ...(init?.headers || {}), Authorization: `Bearer ${apiKey}` },
  });
}

// ── Gemini text helper ────────────────────────────────────────────────────────
// systemPrompt is folded into the first user turn (Gemini supports systemInstruction
// in v1beta but folding is simpler and equally effective for these tasks).
async function geminiFetch(model, body, timeoutMs = 25_000) {
  const apiKey = getGeminiKey();
  if (!apiKey) {
    const err = new Error('GEMINI_API_KEY is not configured. Add it to server/.env');
    err.statusCode = 500;
    throw err;
  }
  return fetch(`${GEMINI_BASE_URL}/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Extract text from a Gemini response JSON
function geminiText(json) {
  return json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

// ── Sathi AI system prompt ────────────────────────────────────────────────────
const SATHI_SYSTEM = `You are Sathi (meaning Companion), a warm, intelligent AI health assistant for elderly users built into the TinyBit app.
Your role is to help users manage their health, remember medicines, stay connected with family, and feel supported.

CORE GUIDELINES:
- Keep responses concise, warm, and reassuring — never clinical or overwhelming.
- Use a calm, caring tone suitable for elderly users.
- If asked about medicines or health data, reference the USER CONTEXT provided.
- Never diagnose or replace professional medical advice — always suggest consulting a doctor for serious concerns.
- LANGUAGE RULE (highest priority): Detect the script/language of the user's most recent message and respond in that exact language.
  Hindi → Devanagari | Tamil → Tamil script | Bengali → Bengali script | Gujarati → Gujarati script | Marathi → Devanagari | English → English
  Never respond in a different language than the one used, regardless of any other instruction.`;

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CHAT — Gemini (primary) → OpenAI GPT-4o-mini (fallback)
// ═══════════════════════════════════════════════════════════════════════════════
const chat = async (req, res) => {
  try {
    const { messages, context } = req.body || {};
    if (!Array.isArray(messages)) {
      return res.status(400).json({ success: false, message: '`messages` must be an array' });
    }

    const systemPrompt = `${SATHI_SYSTEM}\n\nUSER CONTEXT:\n${context ?? 'No context provided.'}`;

    // ── Try Gemini first ──────────────────────────────────────────────────────
    try {
      // Build multi-turn contents; prepend system prompt to first user message
      const contents = messages.map((m, i) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: i === 0 ? `${systemPrompt}\n\n${m.content}` : String(m.content ?? '') }],
      }));

      const geminiResp = await geminiFetch(GEMINI_MODEL_TEXT, {
        contents,
        generationConfig: { maxOutputTokens: 1024, temperature: 0.7 },
      });

      if (geminiResp.ok) {
        const json = await geminiResp.json();
        const content = geminiText(json);
        if (content) return res.json({ success: true, data: { content }, provider: 'gemini' });
      } else {
        const errBody = await geminiResp.text();
        console.warn('[Sathi] Gemini error:', geminiResp.status, errBody);
      }
    } catch (geminiErr) {
      console.warn('[Sathi] Gemini failed, falling back to OpenAI:', geminiErr.message);
    }

    // ── Fallback: OpenAI GPT-4o-mini ─────────────────────────────────────────
    const oaiResp = await openAiFetch('/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        temperature: 0.7,
      }),
    });

    if (!oaiResp.ok) {
      const body = await oaiResp.text();
      return res.status(502).json({ success: false, message: 'AI service error', detail: body });
    }

    const oaiJson = await oaiResp.json();
    const content = oaiJson?.choices?.[0]?.message?.content ?? '';
    return res.json({ success: true, data: { content }, provider: 'openai' });
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 2. TRANSCRIBE — OpenAI Whisper (Gemini audio transcription not used here)
// ═══════════════════════════════════════════════════════════════════════════════
const transcribe = async (req, res) => {
  try {
    const { base64, filename, mimeType } = req.body || {};
    if (typeof base64 !== 'string' || base64.length < 10) {
      return res.status(400).json({ success: false, message: '`base64` audio is required' });
    }

    const safeFilename = filename?.trim() || 'audio.m4a';
    const safeMime = mimeType?.trim() || 'audio/m4a';

    const bytes = Buffer.from(base64, 'base64');
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: safeMime }), safeFilename);
    form.append('model', 'whisper-1');

    const response = await openAiFetch('/audio/transcriptions', {
      method: 'POST',
      signal: AbortSignal.timeout(35_000),
      body: form,
    });

    if (!response.ok) {
      const body = await response.text();
      return res.status(502).json({ success: false, message: 'Transcription error', detail: body });
    }

    const json = await response.json();
    return res.json({ success: true, data: { text: json?.text ?? '' } });
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 3. TTS — OpenAI TTS (Gemini doesn't support audio output)
// ═══════════════════════════════════════════════════════════════════════════════
const tts = async (req, res) => {
  try {
    const { text, voice } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ success: false, message: '`text` is required' });
    }

    const response = await openAiFetch('/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(35_000),
      body: JSON.stringify({
        model: 'tts-1',
        voice: voice?.trim() || 'nova',
        input: text,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return res.status(502).json({ success: false, message: 'TTS error', detail: body });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return res.json({ success: true, data: { base64: buffer.toString('base64'), mimeType: 'audio/mpeg' } });
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 4. ANALYZE REPORT — Gemini Vision (primary) → OpenAI GPT-4o-mini (fallback)
// ═══════════════════════════════════════════════════════════════════════════════
const REPORT_PROMPT = `Classify this as a medical document. Respond ONLY with valid JSON, no markdown:
{"isReport": true, "category": "Reports"}

Use true for: doctor prescriptions, X-ray/MRI/CT, blood/lab tests, ECG, discharge summaries, medical certificates.
Use false for: ID cards, resumes, school certificates, bank statements, personal photos, food photos.
category must be one of: "Reports", "Prescriptions", "X-Rays", "Blood Tests", or null.
When in doubt, use false.`;

const analyzeReport = async (req, res) => {
  try {
    const { base64, mimeType } = req.body || {};
    if (typeof base64 !== 'string' || base64.length < 100) {
      return res.status(400).json({ success: false, message: '`base64` image is required' });
    }

    const safeMime = mimeType?.trim() || 'image/jpeg';
    const isImage = safeMime.startsWith('image/');

    // ── Try Gemini Vision for images ─────────────────────────────────────────
    if (isImage) {
      try {
        const geminiResp = await geminiFetch(GEMINI_MODEL_VISION, {
          contents: [{
            parts: [
              { inlineData: { mimeType: safeMime, data: base64 } },
              { text: REPORT_PROMPT },
            ],
          }],
          generationConfig: { maxOutputTokens: 100, temperature: 0 },
        }, 20_000);

        if (geminiResp.ok) {
          const json = await geminiResp.json();
          const content = geminiText(json).trim().replace(/```json|```/g, '').trim();
          try {
            const result = JSON.parse(content);
            return res.json({ success: true, data: { isReport: !!result.isReport, category: result.category ?? null } });
          } catch {
            const isReport = /\"isReport\"\s*:\s*true/i.test(content);
            return res.json({ success: true, data: { isReport, category: isReport ? 'Reports' : null } });
          }
        }
      } catch (geminiErr) {
        console.warn('[analyzeReport] Gemini failed, falling back to OpenAI:', geminiErr.message);
      }
    }

    // ── Fallback: OpenAI GPT-4o-mini (supports PDFs too) ────────────────────
    const oaiResp = await openAiFetch('/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: [
            safeMime === 'application/pdf'
              ? { type: 'file', file: { filename: 'document.pdf', file_data: `data:application/pdf;base64,${base64}` } }
              : { type: 'image_url', image_url: { url: `data:${safeMime};base64,${base64}`, detail: 'low' } },
            { type: 'text', text: 'Classify as medical document. Respond ONLY JSON: {"isReport":true/false,"category":"Reports"|"Prescriptions"|"X-Rays"|"Blood Tests"|null}' },
          ],
        }],
        max_tokens: 60,
      }),
    });

    const oaiJson = await oaiResp.json();
    const content = (oaiJson?.choices?.[0]?.message?.content ?? '').trim().replace(/```json|```/g, '').trim();
    try {
      const result = JSON.parse(content);
      return res.json({ success: true, data: { isReport: !!result.isReport, category: result.category ?? null } });
    } catch {
      const isReport = /\"isReport\"\s*:\s*true/i.test(content);
      return res.json({ success: true, data: { isReport, category: isReport ? 'Reports' : null } });
    }
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 5. ANALYZE FOOD — Gemini Vision (primary) → OpenAI GPT-4o-mini (fallback)
// ═══════════════════════════════════════════════════════════════════════════════
const FOOD_PROMPT = `You are a certified nutrition expert AI. Carefully analyze this specific food photo and calculate REAL nutritional values for exactly what you see in the image.

IMPORTANT: Do NOT copy the example values below — they are only showing the required JSON format. Calculate actual nutrition based on the real food items visible in this photo.

Respond with ONLY valid JSON (no markdown, no extra text) using this exact structure:
{
  "detected": true,
  "foodItems": ["<actual food item 1>", "<actual food item 2>"],
  "totalCalories": <calculated integer for this specific meal>,
  "protein": <grams of protein as number>,
  "carbohydrates": <grams of carbs as number>,
  "fat": <grams of fat as number>,
  "fiber": <grams of fiber as number>,
  "sugar": <grams of sugar as number>,
  "sodium": <milligrams of sodium as number>,
  "vitamins": ["<vitamin 1>", "<vitamin 2>"],
  "healthScore": <1-10 integer>,
  "healthRating": "<Excellent|Good|Moderate|Poor>",
  "portionSize": "<small|medium|large>",
  "servingInfo": "<description of portion, e.g. '1 plate (~400g)'>",
  "suggestions": ["<health tip 1>", "<health tip 2>"],
  "dietaryTags": ["<e.g. vegetarian, high-protein, low-carb>"],
  "glycemicIndex": "<low|medium|high>"
}

Rules:
- Identify every visible food item accurately — do NOT guess generically.
- Calculate totalCalories by summing estimated calories for each item at the visible portion size.
- All numeric fields must be actual numbers (integers or decimals), NOT the example placeholders.
- healthRating must be exactly one of: "Excellent", "Good", "Moderate", or "Poor".
- If no food is detected in the image, respond with ONLY: {"detected": false}`;

const analyzeFood = async (req, res) => {
  try {
    const { base64, mimeType } = req.body || {};
    if (typeof base64 !== 'string' || base64.length < 100) {
      return res.status(400).json({ success: false, message: '`base64` image is required' });
    }

    const safeMime = mimeType?.trim() || 'image/jpeg';

    // ── Try Gemini Vision first ───────────────────────────────────────────────
    try {
      const geminiResp = await geminiFetch(GEMINI_MODEL_VISION, {
        contents: [{
          parts: [
            { inlineData: { mimeType: safeMime, data: base64 } },
            { text: FOOD_PROMPT },
          ],
        }],
        generationConfig: { maxOutputTokens: 800, temperature: 0.4 },
      }, 35_000);

      if (geminiResp.ok) {
        const json = await geminiResp.json();
        const content = geminiText(json).trim().replace(/```json|```/g, '').trim();
        try {
          const result = JSON.parse(content);
          return res.json({ success: true, data: result, provider: 'gemini' });
        } catch { /* fall through to OpenAI */ }
      } else {
        const errBody = await geminiResp.text();
        console.warn('[analyzeFood] Gemini error:', geminiResp.status, errBody);
      }
    } catch (geminiErr) {
      console.warn('[analyzeFood] Gemini failed, falling back to OpenAI:', geminiErr.message);
    }

    // ── Fallback: OpenAI GPT-4o-mini Vision ──────────────────────────────────
    const oaiResp = await openAiFetch('/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(35_000),
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${safeMime};base64,${base64}`, detail: 'high' } },
            { type: 'text', text: FOOD_PROMPT },
          ],
        }],
        max_tokens: 800,
        temperature: 0.4,
      }),
    });

    if (!oaiResp.ok) {
      const body = await oaiResp.text();
      return res.status(502).json({ success: false, message: 'Food analysis failed. Both AI providers unavailable.', detail: body });
    }

    const oaiJson = await oaiResp.json();
    const content = (oaiJson?.choices?.[0]?.message?.content ?? '').trim().replace(/```json|```/g, '').trim();
    try {
      const result = JSON.parse(content);
      return res.json({ success: true, data: result, provider: 'openai' });
    } catch {
      return res.json({ success: false, message: 'Could not parse nutrition data. Please try with a clearer food photo.' });
    }
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 6. SUGGEST CLOTHING — Gemini (primary) → OpenAI (fallback) → static defaults
// ═══════════════════════════════════════════════════════════════════════════════
const CLOTHING_DEFAULTS = {
  summary: "Dress comfortably for today's weather.",
  items: ['Comfortable clothing', 'Appropriate footwear', 'Carry water'],
  healthTips: ['Stay hydrated', 'Rest if feeling tired'],
  warning: null,
  emoji: '🌤️',
};

const suggestClothing = async (req, res) => {
  try {
    const { temperature, feelsLike, condition, humidity, windSpeed, uvIndex } = req.body || {};

    const prompt = `You are a caring health advisor for elderly users. Based on today's weather, suggest appropriate clothing and health precautions.

Current Weather:
- Temperature: ${temperature ?? 'unknown'}°C (Feels like: ${feelsLike ?? temperature ?? 'unknown'}°C)
- Condition: ${condition ?? 'Clear'}
- Humidity: ${humidity ?? 'unknown'}%
- Wind Speed: ${windSpeed ?? 'unknown'} km/h
- UV Index: ${uvIndex ?? 'unknown'}

Respond with ONLY valid JSON (no markdown):
{
  "summary": "1-sentence clothing summary tailored for elderly users",
  "items": ["item1", "item2", "item3", "item4"],
  "healthTips": ["tip1", "tip2", "tip3"],
  "warning": "important health warning for elderly if extreme weather, or null",
  "emoji": "🌤️"
}`;

    // ── Try Gemini first ──────────────────────────────────────────────────────
    try {
      const geminiResp = await geminiFetch(GEMINI_MODEL_TEXT, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 500, temperature: 0.5 },
      }, 15_000);

      if (geminiResp.ok) {
        const json = await geminiResp.json();
        const content = geminiText(json).trim().replace(/```json|```/g, '').trim();
        try {
          const result = JSON.parse(content);
          return res.json({ success: true, data: result, provider: 'gemini' });
        } catch { /* fall through */ }
      }
    } catch (geminiErr) {
      console.warn('[suggestClothing] Gemini failed, falling back to OpenAI:', geminiErr.message);
    }

    // ── Fallback: OpenAI GPT-4o-mini ─────────────────────────────────────────
    try {
      const oaiResp = await openAiFetch('/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 500,
        }),
      });

      if (oaiResp.ok) {
        const oaiJson = await oaiResp.json();
        const content = (oaiJson?.choices?.[0]?.message?.content ?? '').trim().replace(/```json|```/g, '').trim();
        try {
          const result = JSON.parse(content);
          return res.json({ success: true, data: result, provider: 'openai' });
        } catch { /* fall through to defaults */ }
      }
    } catch (oaiErr) {
      console.warn('[suggestClothing] OpenAI also failed:', oaiErr.message);
    }

    // ── Static defaults ───────────────────────────────────────────────────────
    return res.json({ success: true, data: CLOTHING_DEFAULTS });
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 7. WELLNESS SUMMARY — Gemini (primary) → OpenAI (fallback) → static defaults
// ═══════════════════════════════════════════════════════════════════════════════
const WELLNESS_DEFAULTS = {
  overallStatus: 'Fair',
  headline: 'Keep tracking your health!',
  summary: 'Regular health tracking helps you and your family stay informed about your wellbeing.',
  highlights: ["You're taking steps to monitor your health"],
  suggestions: ['Continue logging daily', 'Drink plenty of water', 'Get regular rest'],
  alertLevel: 'normal',
};

const wellnessSummary = async (req, res) => {
  try {
    const { logs, profile } = req.body || {};

    const logsText = Array.isArray(logs) && logs.length > 0
      ? logs.map(l => `${l.type}: ${l.value} ${l.unit ?? ''} (${l.logged_at ?? 'recent'})`).join('\n')
      : 'No recent logs available.';

    const prompt = `You are a compassionate health wellness advisor for elderly users. Analyze these recent health logs and provide a gentle, encouraging summary.

User Profile: ${profile?.fullName ?? 'Elder'}, Age: ${profile?.age ?? 'unknown'}
Recent Health Logs:
${logsText}

Respond with ONLY valid JSON (no markdown):
{
  "overallStatus": "Good",
  "headline": "short encouraging headline",
  "summary": "2-3 sentences about their health trends",
  "highlights": ["positive observation 1", "positive observation 2"],
  "suggestions": ["actionable health tip 1", "actionable health tip 2", "actionable health tip 3"],
  "alertLevel": "normal"
}
overallStatus must be: "Good", "Fair", or "Needs Attention". alertLevel must be: "normal", "caution", or "alert".`;

    // ── Try Gemini first ──────────────────────────────────────────────────────
    try {
      const geminiResp = await geminiFetch(GEMINI_MODEL_TEXT, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 600, temperature: 0.5 },
      }, 20_000);

      if (geminiResp.ok) {
        const json = await geminiResp.json();
        const content = geminiText(json).trim().replace(/```json|```/g, '').trim();
        try {
          const result = JSON.parse(content);
          return res.json({ success: true, data: result, provider: 'gemini' });
        } catch { /* fall through */ }
      }
    } catch (geminiErr) {
      console.warn('[wellnessSummary] Gemini failed, falling back to OpenAI:', geminiErr.message);
    }

    // ── Fallback: OpenAI GPT-4o-mini ─────────────────────────────────────────
    try {
      const oaiResp = await openAiFetch('/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 600,
        }),
      });

      if (oaiResp.ok) {
        const oaiJson = await oaiResp.json();
        const content = (oaiJson?.choices?.[0]?.message?.content ?? '').trim().replace(/```json|```/g, '').trim();
        try {
          const result = JSON.parse(content);
          return res.json({ success: true, data: result, provider: 'openai' });
        } catch { /* fall through to defaults */ }
      }
    } catch (oaiErr) {
      console.warn('[wellnessSummary] OpenAI also failed:', oaiErr.message);
    }

    // ── Static defaults ───────────────────────────────────────────────────────
    return res.json({ success: true, data: WELLNESS_DEFAULTS });
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 8. HEALTH FORECAST — Gemini Vision (primary) → OpenAI GPT-4o-mini (fallback)
//    Extracts health metrics from a report image/PDF and returns structured
//    insights + recommendations tailored for elderly users.
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

const FORECAST_FALLBACK = {
  reportType: 'Unknown',
  summary: 'AI analysis is currently unavailable. Please try again later.',
  alertLevel: 'normal',
  metrics: [],
  riskFactors: [],
  recommendations: ['Consult your doctor for a detailed interpretation of this report.'],
  followUp: 'Schedule a visit with your doctor to review this document.',
};

const healthForecast = async (req, res) => {
  try {
    const { base64, mimeType, category, title } = req.body || {};

    if (typeof base64 !== 'string' || base64.length < 100) {
      return res.status(400).json({ success: false, message: 'base64 document content is required' });
    }

    const safeMime = mimeType?.trim() || 'image/jpeg';
    const isImage  = safeMime.startsWith('image/');
    // Gemini supports both images and PDFs via inlineData
    const geminiSupported = isImage || safeMime === 'application/pdf';

    const contextNote = [
      title    ? `Document title: ${title}` : '',
      category ? `Document category: ${category}` : '',
    ].filter(Boolean).join('. ');
    const prompt = contextNote ? `${FORECAST_PROMPT}\n\nContext: ${contextNote}` : FORECAST_PROMPT;

    // ── Try Gemini Vision (images + PDFs) ─────────────────────────────────────
    if (geminiSupported) {
      try {
        const geminiResp = await geminiFetch(GEMINI_MODEL_VISION, {
          contents: [{
            parts: [
              { inlineData: { mimeType: safeMime, data: base64 } },
              { text: prompt },
            ],
          }],
          generationConfig: { maxOutputTokens: 1200, temperature: 0.2 },
        }, 60_000);   // large PDFs need up to ~45 s

        if (geminiResp.ok) {
          const json    = await geminiResp.json();
          const content = geminiText(json).trim().replace(/```json|```/g, '').trim();
          try {
            const result = JSON.parse(content);
            return res.json({ success: true, data: result, provider: 'gemini' });
          } catch { /* fall through to OpenAI */ }
        } else {
          const errBody = await geminiResp.text();
          console.warn('[healthForecast] Gemini error:', geminiResp.status, errBody);
        }
      } catch (geminiErr) {
        console.warn('[healthForecast] Gemini failed, falling back to OpenAI:', geminiErr.message);
      }
    }

    // ── Fallback: OpenAI GPT-4o-mini (images only — PDFs not supported inline) ─
    // For PDFs we already tried Gemini above; skip OpenAI if it's a PDF.
    if (safeMime === 'application/pdf') {
      return res.json({ success: true, data: FORECAST_FALLBACK });
    }

    try {
      const contentParts = [
        { type: 'image_url', image_url: { url: `data:${safeMime};base64,${base64}`, detail: 'high' } },
        { type: 'text', text: prompt },
      ];

      const oaiResp = await openAiFetch('/chat/completions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        signal:  AbortSignal.timeout(35_000),
        body: JSON.stringify({
          model:       'gpt-4o-mini',
          messages:    [{ role: 'user', content: contentParts }],
          max_tokens:  1200,
          temperature: 0.2,
        }),
      });

      if (oaiResp.ok) {
        const oaiJson = await oaiResp.json();
        const content = (oaiJson?.choices?.[0]?.message?.content ?? '').trim().replace(/```json|```/g, '').trim();
        try {
          const result = JSON.parse(content);
          return res.json({ success: true, data: result, provider: 'openai' });
        } catch { /* fall through to fallback */ }
      } else {
        const errBody = await oaiResp.text();
        console.warn('[healthForecast] OpenAI error:', oaiResp.status, errBody);
      }
    } catch (oaiErr) {
      console.warn('[healthForecast] OpenAI also failed:', oaiErr.message);
    }

    return res.json({ success: true, data: FORECAST_FALLBACK });
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 9. HEALTH FORECAST MULTI — analyse several reports together in one Gemini call
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

const healthForecastMulti = async (req, res) => {
  try {
    const { records } = req.body || {};
    if (!Array.isArray(records) || records.length < 1) {
      return res.status(400).json({ success: false, message: 'At least one record is required' });
    }

    // Build Gemini content parts — one inlineData block per document
    const parts = [];
    for (const rec of records) {
      if (typeof rec.base64 !== 'string' || rec.base64.length < 100) continue;
      parts.push({ inlineData: { mimeType: rec.mimeType || 'image/jpeg', data: rec.base64 } });
      parts.push({ text: `[${rec.category || 'Document'}: "${rec.title || 'Record'}" — ${rec.date || 'Date unknown'}]` });
    }

    if (parts.length === 0) {
      return res.status(400).json({ success: false, message: 'No readable documents found in the selection' });
    }

    parts.push({ text: MULTI_FORECAST_PROMPT });

    // ── Try Gemini Vision ────────────────────────────────────────────────────
    try {
      const geminiResp = await geminiFetch(GEMINI_MODEL_VISION, {
        contents: [{ parts }],
        generationConfig: { maxOutputTokens: 1500, temperature: 0.2 },
      }, 90_000);   // larger timeout — processing N documents takes longer

      if (geminiResp.ok) {
        const json    = await geminiResp.json();
        const content = geminiText(json).trim().replace(/```json|```/g, '').trim();
        try {
          const result = JSON.parse(content);
          return res.json({ success: true, data: result, provider: 'gemini' });
        } catch { /* fall through */ }
      } else {
        const errBody = await geminiResp.text();
        console.warn('[healthForecastMulti] Gemini error:', geminiResp.status, errBody);
      }
    } catch (geminiErr) {
      console.warn('[healthForecastMulti] Gemini failed:', geminiErr.message);
    }

    return res.json({ success: true, data: {
      ...FORECAST_FALLBACK,
      reportType: 'Multi-Report Analysis',
      summary: 'AI analysis is currently unavailable. Please try again later.',
    }});
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Server error' });
  }
};

module.exports = { chat, transcribe, tts, analyzeReport, analyzeFood, suggestClothing, wellnessSummary, healthForecast, healthForecastMulti };
