// Shared Gemini client — fija el modelo y centraliza la llamada para evitar
// el patrón de "listar modelos en cada request" (latencia extra) repetido en
// analyze-document / analyze-branch / analyze-history.

const DEFAULT_MODEL = "gemini-2.5-flash";

export interface GeminiInlineData {
  mimeType: string;
  data: string; // base64
}

export interface GeminiOptions {
  prompt: string;
  inlineData?: GeminiInlineData[];
  temperature?: number;
  jsonOutput?: boolean;
  model?: string;
  timeoutMs?: number;
}

/** Llama a Gemini y devuelve el texto crudo del primer candidato. */
export async function callGemini(opts: GeminiOptions): Promise<string> {
  const key = Deno.env.get("GEMINI_API_KEY")?.trim();
  if (!key) throw new Error("GEMINI_API_KEY no configurada en Supabase.");

  const model = opts.model ?? DEFAULT_MODEL;
  const parts: any[] = [{ text: opts.prompt }];
  for (const d of opts.inlineData ?? []) {
    parts.push({ inline_data: { mime_type: d.mimeType, data: d.data } });
  }

  const generationConfig: Record<string, unknown> = {};
  if (opts.temperature != null) generationConfig.temperature = opts.temperature;
  if (opts.jsonOutput) generationConfig.response_mime_type = "application/json";

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }], generationConfig }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    },
  );

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Google API Error: ${data.error?.message || JSON.stringify(data)}`);
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini devolvió una respuesta vacía.");
  return text;
}

/** Limpia fences markdown (```json … ```) y parsea como JSON. */
export function parseGeminiJson<T = unknown>(raw: string): T {
  const clean = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  return JSON.parse(clean) as T;
}
