const { Buffer } = require('buffer');
const aiService = require('../services/ai.service');
const { geminiFetch, geminiText, geminiUsage, GEMINI_MODEL_TEXT, GEMINI_MODEL_VISION } = require('../services/gemini.service');
const healthInsightsService = require('../services/health-insights.service');
const sathiContextService = require('../services/sathi-context.service');
const helpService = require('../services/help.service');

// ── Sathi AI system prompt ────────────────────────────────────────────────────
const SATHI_ACTIONS = [
  { route: '/breathing-exercise',    label: 'Try a Breathing Exercise' },
  { route: '/meditation',            label: 'Try Meditation' },
  { route: '/nature-sounds',         label: 'Listen to Nature Sounds' },
  { route: '/bhajans',               label: 'Listen to Bhajans' },
  { route: '/jokes-fun',             label: 'Jokes & Fun' },
  { route: '/mind-games',            label: 'Play Brain Games' },
  { route: '/exercise',              label: 'Start an Exercise' },
  { route: '/mood-lift',             label: 'Open Mood Lift' },
  { route: '/daily-health-checkin',  label: 'Complete Daily Check-in' },
  { route: '/health-vault',          label: 'Open Health Vault' },
  { route: '/care-calendar',         label: 'Open Care Calendar' },
  { route: '/weather',               label: 'Check the Weather' },
  { route: '/calorie-calculator',    label: 'Open Calorie Tracker' },
  { route: '/self-medicine',         label: 'Open Self-Medicine' },
  { route: '/memory-history',        label: 'View Memory History' },
  { route: '/sos',                   label: 'Get Help (SOS)' },
  { route: '/(tabs)/medicine',       label: 'View Your Medicines' },
  { route: '/(tabs)/journal',        label: 'Open Journal' },
];

const SATHI_SYSTEM = `You are Sathi (meaning Companion), a warm, caring companion for elderly users built into the TinyBit app — texting with them like a close family member would, not filing a clinical report.
Your role is to help users manage their health, remember medicines, stay connected with family, and feel supported.

CORE GUIDELINES:
- LENGTH (strict): 1-3 short sentences per reply. One main point per turn. Never stack multiple
  paragraphs, never list out several suggestions at once — pick the single most relevant thing.
- TONE: Talk like a warm companion texting, not a clinical bot reciting a protocol. Skip formal
  transitions ("It is important to...", "Please try to..."). Contractions and simple, everyday words
  are welcome.
- DON'T REPEAT YOURSELF: Never end every reply with the same tacked-on question (e.g. always asking
  "would you like me to message X, or is there anything else?"). Vary your wording turn to turn, and
  only offer to contact a family member when it's genuinely warranted, not as a reflexive closer.
- WHAT THE APP CAN DO: TinyBit has these in-app features, and you should offer the matching
  ACTION tag when the user's request maps to one of them:
  - Breathing exercise, meditation, nature sounds, bhajans, jokes & fun, brain games (mind games,
    puzzles, daily quiz), exercise routines
  - Daily health check-in, mood lift, health vault (medical reports & history), care calendar
    (appointments & reminders), medicines, self-medicine tracking, memory journal & memory history,
    calorie tracker, weather & clothing tips, SOS / emergency help, help guide (app tutorials)
  - Example mappings: "play a game" → brain games; "show my reports" → health vault; "what's the
    weather" → weather; "plan a meal" → calorie tracker; "remember/record something" → journal;
    "help me exercise" → exercise; "call for help" → SOS.
  Use an ACTION tag when it's genuinely relevant — never invent features the app doesn't have.
- ROLE AWARENESS: The USER CONTEXT lists the user's Role ("elder" or "guardian"). Respect what that
  role can access in the app:
  - Elders use: medicines, journal/memories, Sathi chat, brain games, exercises, health vault, care
    calendar, weather, calorie tracker, mood lift, SOS, self-medicine.
  - Guardians primarily monitor elders: they see location, alerts, and guardian reports. They do NOT
    have the elder-only tabs (medicines, journal, Sathi chat, daily check-in for themselves), so never
    suggest those tabs to a guardian — suggest monitoring-oriented actions instead.
  - If you are unsure whether a role can use a feature, do not suggest an ACTION tag for it.
- The USER CONTEXT below is live data from the app (profile, today's medicines and whether each was
  taken, today's check-in, next appointment, emergency contact). Reference it when asked about any
  of these. If something isn't listed there, say you don't have that on file — never invent it.
- The APP HELP FAQ below is the official, admin-maintained answer set for "how do I..." questions
  about using the app. When a user asks something matching one of these, answer from it directly
  rather than guessing at app behavior.
- Never diagnose or replace professional medical advice — always suggest consulting a doctor for serious concerns.
- LANGUAGE RULE (highest priority, overrides everything else including USER CONTEXT): Detect the
  script/language of the user's most recent message ONLY — ignore any language field elsewhere —
  and respond in that exact language. Example: if the user writes "I'm tired" (English), you must
  reply in English, even if their app is set to Hindi elsewhere — the message language always wins.
  Hindi → Devanagari | Tamil → Tamil script | Bengali → Bengali script | Gujarati → Gujarati script | Marathi → Devanagari | English → English
  Never respond in a different language than the one used, regardless of any other instruction.
- FORMATTING RULE: Plain prose by default. Only use **bold** for a key word/phrase, and "- " bullet
  lines for an actual list of items (e.g. medicine names, steps). Never use headers, tables, code
  blocks, or markdown links — the app cannot render them.
- ACTION SUGGESTIONS: When (and only when) it's naturally relevant to suggest doing something in the
  app right now, include exactly one tag from the list below, in this exact format, inline in your
  reply: [[ACTION:<route>|<label>]]. Copy the route and label exactly as given — never invent your
  own route or label, and include at most one tag per reply. Don't force one into every message.
${SATHI_ACTIONS.map((a) => `  - [[ACTION:${a.route}|${a.label}]]`).join('\n')}`;

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CHAT — Gemini
// ═══════════════════════════════════════════════════════════════════════════════
function findNewMessages(dbHistory, incomingMessages) {
  const H = dbHistory.length;
  const I = incomingMessages.length;

  let maxOverlap = 0;
  for (let k = Math.min(H, I); k >= 1; k--) {
    let match = true;
    for (let i = 0; i < k; i++) {
      const dbMsg = dbHistory[H - k + i];
      const incMsg = incomingMessages[i];
      if (dbMsg.role !== incMsg.role || dbMsg.content !== incMsg.content) {
        match = false;
        break;
      }
    }
    if (match) {
      maxOverlap = k;
      break;
    }
  }
  return incomingMessages.slice(maxOverlap);
}

const getChatHistory = async (req, res) => {
  try {
    const userId = req.auth.userId;
    const { limit } = req.query || {};
    const messages = await aiService.getChatHistory(userId, limit);
    return res.json({ success: true, data: { messages } });
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Server error' });
  }
};

const clearChatHistory = async (req, res) => {
  try {
    const userId = req.auth.userId;
    await aiService.clearHistory(userId);
    return res.json({ success: true });
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Server error' });
  }
};

const chat = async (req, res) => {
  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages)) {
      return res.status(400).json({ success: false, message: '`messages` must be an array' });
    }

    const userId = req.auth.userId;
    const dbHistory = await aiService.getChatHistory(userId, 50);

    const newMessages = findNewMessages(dbHistory, messages);
    for (const msg of newMessages) {
      await aiService.saveMessage(userId, {
        role: msg.role,
        content: msg.content,
      });
    }

    const fullConversation = [...dbHistory, ...newMessages];
    if (fullConversation.length === 0) {
      return res.status(400).json({ success: false, message: 'No messages provided' });
    }

    const lastMsg = fullConversation[fullConversation.length - 1];
    if (lastMsg.role === 'assistant') {
      return res.json({ success: true, data: { content: lastMsg.content }, provider: lastMsg.provider || 'unknown' });
    }

    let contextText;
    try {
      contextText = await sathiContextService.buildSathiContext(userId);
    } catch (contextErr) {
      console.warn('[Sathi] context build failed:', contextErr.message);
      contextText = 'No context available.';
    }

    let faqText = 'No FAQ content available.';
    try {
      const faqs = await helpService.listActiveFaqs();
      if (faqs.length > 0) {
        faqText = faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n');
      }
    } catch (faqErr) {
      console.warn('[Sathi] FAQ fetch failed:', faqErr.message);
    }

    const systemPrompt = `${SATHI_SYSTEM}\n\nAPP HELP FAQ:\n${faqText}\n\nUSER CONTEXT:\n${contextText}`;

    let replyContent = '';
    let usage = { prompt_tokens: null, completion_tokens: null, total_tokens: null };
    const provider = 'gemini';

    try {
      // Build multi-turn contents; prepend system prompt to first user message
      const contents = fullConversation.map((m, i) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: i === 0 ? `${systemPrompt}\n\n${m.content}` : String(m.content ?? '') }],
      }));

      const geminiResp = await geminiFetch(GEMINI_MODEL_TEXT, {
        contents,
        generationConfig: { maxOutputTokens: 220, temperature: 0.85 },
      });

      if (geminiResp.ok) {
        const json = await geminiResp.json();
        replyContent = geminiText(json);
        usage = geminiUsage(json);
      } else {
        const errBody = await geminiResp.text();
        console.warn('[Sathi] Gemini error:', geminiResp.status, errBody);
        return res.status(502).json({ success: false, message: 'AI service error: Gemini request failed', detail: errBody });
      }
    } catch (geminiErr) {
      console.warn('[Sathi] Gemini failed:', geminiErr.message);
      return res.status(502).json({ success: false, message: 'AI service error: Gemini request failed' });
    }

    if (!replyContent) {
      return res.status(502).json({ success: false, message: 'AI service error: Gemini request failed' });
    }

    // Save assistant response with exact Gemini usageMetadata for this turn
    await aiService.saveMessage(userId, {
      role: 'assistant',
      content: replyContent,
      provider,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
    });

    return res.json({
      success: true,
      data: { content: replyContent, usage },
      provider,
    });
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 2. TRANSCRIBE — Gemini audio understanding
// ═══════════════════════════════════════════════════════════════════════════════
// Audio-transcription models (Gemini included, same as Whisper) are known to
// hallucinate a plausible sentence for silent/near-silent clips instead of
// honoring a free-text "respond with nothing" instruction. Asking the model to
// commit to an explicit hasSpeech boolean via a JSON schema — and having the
// server discard the transcript whenever hasSpeech is false, regardless of what
// text the model produced — is materially more reliable than trusting free-text
// emptiness. This is a second, independent layer on top of the client-side
// mic-silence gate in useSathiVoice.ts; neither alone is 100% reliable.
const TRANSCRIBE_PROMPT = 'Listen to this audio clip. First decide whether it contains any actual intelligible human speech — silence, ambient/background noise, static, breathing, or unintelligible mumbling all count as NOT speech. Set "hasSpeech" to true only if there is real, intelligible speech. If "hasSpeech" is true, put the exact word-for-word transcription in "transcript" (no preamble, no quotation marks, no commentary, no timestamps). If "hasSpeech" is false, set "transcript" to an empty string.';

const TRANSCRIBE_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    hasSpeech:  { type: 'BOOLEAN' },
    transcript: { type: 'STRING' },
  },
  required: ['hasSpeech', 'transcript'],
};

const transcribe = async (req, res) => {
  try {
    const { base64, mimeType } = req.body || {};
    if (typeof base64 !== 'string' || base64.length < 10) {
      return res.status(400).json({ success: false, message: '`base64` audio is required' });
    }

    const safeMime = mimeType?.trim() || 'audio/m4a';

    const geminiResp = await geminiFetch(GEMINI_MODEL_TEXT, {
      contents: [{
        parts: [
          { inlineData: { mimeType: safeMime, data: base64 } },
          { text: TRANSCRIBE_PROMPT },
        ],
      }],
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: TRANSCRIBE_RESPONSE_SCHEMA,
      },
    }, 30_000);

    if (!geminiResp.ok) {
      const body = await geminiResp.text();
      return res.status(502).json({ success: false, message: 'Transcription error', detail: body });
    }

    const json = await geminiResp.json();
    const raw = geminiText(json).trim();

    let text = '';
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.hasSpeech === true && typeof parsed.transcript === 'string') {
        text = parsed.transcript.trim();
      }
    } catch {
      // Malformed JSON from the model — treat as no usable speech rather than
      // falling back to raw text, which is exactly the unverified path that
      // let hallucinated sentences through before.
      text = '';
    }

    return res.json({ success: true, data: { text } });
  } catch (error) {
    return res.status(502).json({ success: false, message: 'Transcription error', detail: error?.message || 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 3. ANALYZE REPORT — Gemini Vision
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
    const isPdf = safeMime === 'application/pdf';

    // ── Try Gemini Vision for images and PDFs ────────────────────────────────
    if (isImage || isPdf) {
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

        const errBody = await geminiResp.text();
        return res.status(502).json({ success: false, message: 'AI service error: Gemini request failed', detail: errBody });
      } catch (geminiErr) {
        console.warn('[analyzeReport] Gemini failed:', geminiErr.message);
        return res.status(502).json({ success: false, message: 'AI service error: Gemini request failed' });
      }
    }

    return res.status(502).json({ success: false, message: 'Document classification is only supported for images and PDFs at this time.' });
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 4. ANALYZE FOOD — Gemini Vision
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
  "minerals": ["<mineral 1>", "<mineral 2>"],
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
        } catch {
          return res.json({ success: false, message: 'Could not parse nutrition data. Please try with a clearer food photo.' });
        }
      } else {
        const errBody = await geminiResp.text();
        console.warn('[analyzeFood] Gemini error:', geminiResp.status, errBody);
        return res.status(502).json({ success: false, message: 'Food analysis failed. AI service is unavailable.', detail: errBody });
      }
    } catch (geminiErr) {
      console.warn('[analyzeFood] Gemini failed:', geminiErr.message);
      return res.status(502).json({ success: false, message: 'Food analysis failed. AI service is unavailable.' });
    }
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 5. SUGGEST CLOTHING — Gemini
// ═══════════════════════════════════════════════════════════════════════════════
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
        } catch {
          return res.status(502).json({ success: false, message: 'Weather recommendation AI is currently unavailable.' });
        }
      }

      const errBody = await geminiResp.text();
      console.warn('[suggestClothing] Gemini error:', geminiResp.status, errBody);
      return res.status(502).json({ success: false, message: 'Weather recommendation AI is currently unavailable.', detail: errBody });
    } catch (geminiErr) {
      console.warn('[suggestClothing] Gemini failed:', geminiErr.message);
      return res.status(502).json({ success: false, message: 'Weather recommendation AI is currently unavailable.' });
    }
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 6. WELLNESS SUMMARY — Gemini
// ═══════════════════════════════════════════════════════════════════════════════
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
        } catch {
          return res.status(502).json({ success: false, message: 'Wellness log summary AI is currently unavailable.' });
        }
      }

      const errBody = await geminiResp.text();
      console.warn('[wellnessSummary] Gemini error:', geminiResp.status, errBody);
      return res.status(502).json({ success: false, message: 'Wellness log summary AI is currently unavailable.', detail: errBody });
    } catch (geminiErr) {
      console.warn('[wellnessSummary] Gemini failed:', geminiErr.message);
      return res.status(502).json({ success: false, message: 'Wellness log summary AI is currently unavailable.' });
    }
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 7. HEALTH FORECAST — Gemini Vision (single document)
//    Core prompt/parsing logic lives in health-insights.service.js so it can be
//    reused by the Health Vault per-record "AI Insights" endpoint.
// ═══════════════════════════════════════════════════════════════════════════════
const healthForecast = async (req, res) => {
  try {
    const { base64, mimeType, category, title } = req.body || {};
    const result = await healthInsightsService.runHealthForecast({ base64, mimeType, category, title });
    return res.json({ success: true, data: result, provider: 'gemini' });
  } catch (error) {
    console.warn('[healthForecast] failed:', error?.message);
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Server error', detail: error?.detail });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 8. HEALTH FORECAST MULTI — analyse several reports together in one Gemini call
//    Core logic lives in health-insights.service.js so it can be reused by the
//    Health Vault "Compare Reports" endpoint.
// ═══════════════════════════════════════════════════════════════════════════════
const healthForecastMulti = async (req, res) => {
  try {
    const { records } = req.body || {};
    const result = await healthInsightsService.runMultiHealthForecast(records);
    return res.json({ success: true, data: result, provider: 'gemini' });
  } catch (error) {
    console.warn('[healthForecastMulti] failed:', error?.message);
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Server error', detail: error?.detail });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 9. SUGGEST MEAL — Gemini (Calorie Tracker "Eat Next" tab)
// ═══════════════════════════════════════════════════════════════════════════════
const MEAL_TYPES = new Set(['breakfast', 'lunch', 'dinner', 'snack']);
const DIET_TYPES = new Set(['balanced', 'diabetic', 'heart-healthy', 'high-protein', 'vegetarian', 'low-sodium', 'weight-loss']);

const suggestMeal = async (req, res) => {
  try {
    const { meal_type: mealType, remaining_calories: remainingCalories, context, diet_type: dietType } = req.body || {};
    const safeMealType = String(mealType || '').toLowerCase();
    const safeDietType = DIET_TYPES.has(dietType) ? dietType : null;

    if (!MEAL_TYPES.has(safeMealType)) {
      return res.status(400).json({ success: false, message: `meal_type must be one of: ${[...MEAL_TYPES].join(', ')}` });
    }

    const dietaryConstraint = safeDietType === 'vegetarian'
      ? '\n\nSTRICT DIETARY CONSTRAINT (do not violate): This user is vegetarian. Every suggestion MUST exclude meat, poultry, fish, seafood, and eggs — no exceptions, even if it seems like a good fit otherwise.'
      : '';

    const prompt = `You are a certified nutrition expert AI helping an elderly user plan their next meal.

Meal to plan: ${safeMealType}
Remaining calories for today: ${remainingCalories ?? 'unknown'} kcal
USER CONTEXT:
${context ?? 'No context provided.'}${dietaryConstraint}

Suggest 2-3 realistic, healthy meal options for a ${safeMealType} that fit within the remaining calories, taking into account any health context above.

Respond with ONLY valid JSON (no markdown, no extra text) using this exact structure:
{
  "suggestions": [
    {
      "name": "<meal name>",
      "calories": <calculated integer for this meal>,
      "protein": <grams of protein as number>,
      "carbohydrates": <grams of carbs as number>,
      "fat": <grams of fat as number>,
      "prepTimeMinutes": <estimated integer minutes to prepare>,
      "tags": ["<e.g. Diabetic-friendly, Heart-healthy, High-protein>"],
      "ingredients": ["<ingredient 1>", "<ingredient 2>"],
      "instructions": ["<step 1>", "<step 2>"],
      "healthNotes": "<1-2 sentence description of the dish and why it suits the user>"
    }
  ]
}`;

    try {
      const geminiResp = await geminiFetch(GEMINI_MODEL_TEXT, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1200, temperature: 0.6 },
      }, 25_000);

      if (geminiResp.ok) {
        const json = await geminiResp.json();
        const content = geminiText(json).trim().replace(/```json|```/g, '').trim();
        try {
          const result = JSON.parse(content);
          return res.json({ success: true, data: result, provider: 'gemini' });
        } catch {
          return res.status(502).json({ success: false, message: 'Could not parse meal suggestions. Please try again.' });
        }
      }

      const errBody = await geminiResp.text();
      console.warn('[suggestMeal] Gemini error:', geminiResp.status, errBody);
      return res.status(502).json({ success: false, message: 'Meal suggestions are currently unavailable.', detail: errBody });
    } catch (geminiErr) {
      console.warn('[suggestMeal] Gemini failed:', geminiErr.message);
      return res.status(502).json({ success: false, message: 'Meal suggestions are currently unavailable.' });
    }
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 10. SUGGEST CALORIE GOAL — Gemini (Calorie Tracker "My Goals" → AI Suggest)
// ═══════════════════════════════════════════════════════════════════════════════
const suggestCalorieGoal = async (req, res) => {
  try {
    const { context } = req.body || {};

    const prompt = `You are a certified nutrition expert AI suggesting a daily calorie and macro goal for an elderly user, based on their health profile.

USER CONTEXT:
${context ?? 'No context provided.'}

Respond with ONLY valid JSON (no markdown, no extra text) using this exact structure:
{
  "daily_calories": <calculated integer>,
  "protein_g": <grams of protein as integer>,
  "carbs_g": <grams of carbs as integer>,
  "fat_g": <grams of fat as integer>,
  "diet_type": "<one of: balanced, diabetic, heart-healthy, high-protein, vegetarian, low-sodium, weight-loss>",
  "activity_level": "<one of: sedentary, light, moderate, active, very-active>",
  "reasoning": "<1-2 sentence explanation tailored for an elderly user>"
}`;

    try {
      const geminiResp = await geminiFetch(GEMINI_MODEL_TEXT, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 400, temperature: 0.4 },
      }, 15_000);

      if (geminiResp.ok) {
        const json = await geminiResp.json();
        const content = geminiText(json).trim().replace(/```json|```/g, '').trim();
        try {
          const result = JSON.parse(content);
          return res.json({ success: true, data: result, provider: 'gemini' });
        } catch {
          return res.status(502).json({ success: false, message: 'Could not parse goal suggestion. Please try again.' });
        }
      }

      const errBody = await geminiResp.text();
      console.warn('[suggestCalorieGoal] Gemini error:', geminiResp.status, errBody);
      return res.status(502).json({ success: false, message: 'Goal suggestion is currently unavailable.', detail: errBody });
    } catch (geminiErr) {
      console.warn('[suggestCalorieGoal] Gemini failed:', geminiErr.message);
      return res.status(502).json({ success: false, message: 'Goal suggestion is currently unavailable.' });
    }
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Server error' });
  }
};

module.exports = { getChatHistory, clearChatHistory, chat, transcribe, analyzeReport, analyzeFood, suggestClothing, wellnessSummary, healthForecast, healthForecastMulti, suggestMeal, suggestCalorieGoal };
