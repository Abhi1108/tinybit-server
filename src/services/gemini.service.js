const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL_TEXT   = 'gemini-3.1-flash-lite';   // fast text + vision + audio
const GEMINI_MODEL_VISION = 'gemini-3.1-flash-lite';   // supports image input

function getGeminiKey() { return process.env.GEMINI_API_KEY; }

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

module.exports = { geminiFetch, geminiText, GEMINI_MODEL_TEXT, GEMINI_MODEL_VISION };
