// Shared Claude client — el gemelo de `gemini.ts`, para las funciones que
// prefieran leer con Claude.
//
// ── OJO: la suscripción de Claude NO es una API key ─────────────────────────
// Claude Pro/Max y Claude Code se pagan aparte de la API. Una función de
// servidor necesita una key de `console.anthropic.com`, con su propia
// facturación por token. Tener «Claude completo» no alcanza para que esto
// funcione: si `ANTHROPIC_API_KEY` no está puesta en los secretos de Supabase,
// esto lanza y la función que lo llame tiene que decirlo claro.
//
// Modelo: `claude-opus-5`. En Opus 5 el pensamiento viene ENCENDIDO por
// defecto; para una extracción de datos de una foto no hace falta profundidad,
// así que se pide esfuerzo `low` — apagarlo del todo tiene modos de falla
// documentados (puede escribir la llamada a una herramienta en el texto
// visible) y bajar el esfuerzo es la alternativa recomendada.

import Anthropic from "npm:@anthropic-ai/sdk";

const DEFAULT_MODEL = "claude-opus-5";

export interface ClaudeImagen {
  mimeType: string;
  data: string; // base64, sin el prefijo `data:`
}

export interface ClaudeOptions {
  prompt: string;
  imagenes?: ClaudeImagen[];
  model?: string;
  maxTokens?: number;
  /** `low` para extracciones simples; subir sólo si el resultado lo pide. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  timeoutMs?: number;
}

/** Llama a Claude y devuelve el texto del primer bloque de texto. */
export async function callClaude(opts: ClaudeOptions): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY")?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY no configurada en Supabase.");

  const client = new Anthropic({ apiKey });

  const content: unknown[] = [];
  for (const img of opts.imagenes ?? []) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: img.mimeType, data: img.data },
    });
  }
  content.push({ type: "text", text: opts.prompt });

  const res = await client.messages.create(
    {
      model: opts.model ?? DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? 2048,
      output_config: { effort: opts.effort ?? "low" },
      messages: [{ role: "user", content: content as never }],
    },
    { timeout: opts.timeoutMs ?? 45_000 },
  );

  // Una negativa por seguridad llega con HTTP 200 y `stop_reason: "refusal"`:
  // hay que mirarlo ANTES de leer el contenido, o se lee un array vacío.
  if (res.stop_reason === "refusal") {
    throw new Error(`Claude declinó la solicitud (${res.stop_details?.category ?? "sin categoría"}).`);
  }

  const texto = res.content.find((b) => b.type === "text");
  if (!texto || texto.type !== "text") throw new Error("Claude devolvió una respuesta vacía.");
  return texto.text;
}

/** Limpia fences markdown (```json … ```) y parsea como JSON. */
export function parseClaudeJson<T = unknown>(raw: string): T {
  const clean = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  return JSON.parse(clean) as T;
}
