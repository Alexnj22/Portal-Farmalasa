// Shared Gemini client — fija el modelo y centraliza la llamada para evitar
// el patrón de "listar modelos en cada request" (latencia extra) repetido en
// analyze-document / analyze-branch / analyze-history.

const DEFAULT_MODEL = "gemini-2.5-flash";

/* ── El PENSAMIENTO se cobra como salida, y por defecto no tiene techo ───────
 *
 * Medido en la consola de Google el 2026-09-17, factura del 1 al 17 de
 * septiembre: **$9.54, el 100% de Gemini** (Maps aportó $0), y de esos, $8.66
 * en un solo SKU — `output token count` de 2.5-flash, 3,463,824 tokens. La
 * entrada de texto fueron 2,647,315 ($0.79) y las IMÁGENES 272,737 ($0.08).
 *
 * O sea que la salida SUPERA a la entrada, en una tarea que manda un prompt
 * largo con una foto y devuelve un JSON de veinte campos: son ~2,770 tokens de
 * salida por llamada cuando la respuesta real son 300 o 400. El resto es
 * pensamiento, que 2.5-flash hace por su cuenta y Google factura al precio de
 * salida — $2.50/M contra $0.30/M de entrada, o sea 8 veces más caro.
 *
 * Hasta hoy este archivo fijaba `temperature` y `response_mime_type` y nada
 * más, así que el costo de cada llamada lo elegía el modelo. El modo de falla
 * es que no hay ninguno: la lectura sale bien, nada va lento, y el único lugar
 * del mundo donde eso aparece es la factura, agregada y a fin de mes.
 *
 * Y la trampa es dónde mira uno: el instinto manda a achicar la foto, que es
 * justo lo barato — las imágenes fueron el 0.8% del gasto, y la reducción a
 * 1400 px de `utils/fotoParaLeer.js` ya hacía su trabajo.
 *
 * `null` deja el pensamiento dinámico de Google (lo de antes). Un número lo
 * acota. **No se elige de memoria: se mide contra fotos reales** — apagarlo del
 * todo puede costar justo el caso difícil (el cero barrado que se lee como 8,
 * boleta 018540), que es donde pensar se gana el precio.
 *
 * ── Y se midió (2026-09-17) ─────────────────────────────────────────────────
 *
 * 127 boletas reales —todas las que tienen foto en el bucket— contra el monto
 * que la persona confirmó al registrar la salida. La MISMA foto en las tres
 * corridas: lo único que cambia es el techo.
 *
 * | techo     | monto   | número  | pensamiento | tiempo |
 * |-----------|---------|---------|-------------|--------|
 * | dinámico  | 127/127 | 122/127 |     251,672 | 11.0 s |
 * | 0         | 126/127 | 123/127 |           0 |  4.6 s |
 * | **128**   | 127/127 | 124/127 |      14,806 |  4.8 s |
 *
 * O sea que 128 iguala el monto, mejora el número y usa 94% menos pensamiento.
 *
 * **Apagarlo del todo NO sirve, y ésa es la parte que no se podía adivinar.**
 * Con techo 0 la operación 96 ($121.90) devuelve `monto: 0` y CERO importes: la
 * lectura no se degrada, se derrumba. Se repitió dos veces con el mismo
 * resultado. Y no aparece en una muestra de boletas fáciles —14 de 14 salían
 * bien con techo 0—, así que una prueba chica habría dado luz verde a una
 * regresión que sólo se ve en el caso difícil, que es justo el que importa: el
 * que después se discute con el dinero sobre el mostrador.
 *
 * **Al cambiar este número, volver a correr esa medición.** La sonda que la
 * hizo se borró y NO quedó en el repo a propósito: una sonda que sobrevive a su
 * medición se desactualiza sin que nadie lo note, y la siguiente persona le
 * cree. Rehacerla es media hora y son cuatro piezas:
 *
 *   1. una edge function detrás de `ADMIN_INVOKE_SECRET` que reciba
 *      `{ casos, presupuesto }`, baje cada foto de `payment-proofs` y llame a
 *      `callGemini` con `PROMPT_BOLETA` y ese `thinkingBudget`;
 *   2. los casos salen de `bolsas_operaciones` —`foto_url` y el `monto` que la
 *      persona confirmó, que es el patrón de oro porque es la plata que salió
 *      del cajón—;
 *   3. se dispara desde Postgres con `net.http_post` leyendo el secreto del
 *      vault (`timeout_milliseconds := 150000`, que el default de 5 s corta
 *      toda llamada a un modelo) y se lee la respuesta en `net._http_response`;
 *   4. en tandas de ~18, que 127 fotos en paralelo no entran en los 150 s.
 *
 * Y la muestra tiene que incluir los casos DIFÍCILES a propósito —los que
 * quedaron `CONTRADICHO` o `UNICO`—, porque son los únicos que distinguen un
 * techo bueno de uno malo.
 */
const PENSAMIENTO_POR_DEFECTO: number | null = 128;

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
  /** Techo de tokens de PENSAMIENTO. `null` = el dinámico de Google (caro);
   *  `0` lo apaga donde el modelo lo permita. Ver la nota de arriba. */
  thinkingBudget?: number | null;
  /** Lo que la llamada consumió, para quien necesite el número y no el log
   *  (una medición, por ejemplo). Se llama SIEMPRE que Google lo informe. */
  uso?: (u: Record<string, number>) => void;
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

  /* `undefined` (nadie lo pasó) toma el default del archivo; `null` explícito
   * pide el dinámico. Se distinguen a propósito: con `??` no habría forma de
   * pedir «dejalo como estaba» desde un llamador. */
  const presupuesto = opts.thinkingBudget !== undefined
    ? opts.thinkingBudget
    : PENSAMIENTO_POR_DEFECTO;
  if (presupuesto != null) {
    /* 2.5 Pro no puede apagarlo: su mínimo es 128 y pedirle 0 es un 400 que
     * tumbaría a las tres funciones que lo usan. Se acota, no se rechaza. */
    const esPro = model.includes("pro");
    generationConfig.thinkingConfig = {
      thinkingBudget: esPro ? Math.max(128, presupuesto) : presupuesto,
    };
  }

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
  /* Lo que costó la llamada, del lado del portal.
   *
   * Sin esto, el único lugar donde el gasto aparece es la factura de Google —
   * a fin de mes y agregado por SKU, o sea cuando ya no se puede saber qué
   * llamada lo causó. `thoughtsTokenCount` es el que importa: se factura como
   * salida y es el que no se ve. Ver
   * `feedback_un_control_automatico_sin_rastro_no_se_puede_auditar`. */
  const uso = data.usageMetadata ?? {};
  console.log(
    `[gemini] ${model} entrada=${uso.promptTokenCount ?? "?"} ` +
    `salida=${uso.candidatesTokenCount ?? "?"} ` +
    `pensamiento=${uso.thoughtsTokenCount ?? 0} ` +
    `cache=${uso.cachedContentTokenCount ?? 0} ` +
    `techo=${presupuesto === null ? "dinamico" : presupuesto}`,
  );
  opts.uso?.(uso as Record<string, number>);

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini devolvió una respuesta vacía.");
  return text;
}

/** Limpia fences markdown (```json … ```) y parsea como JSON. */
export function parseGeminiJson<T = unknown>(raw: string): T {
  const clean = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  return JSON.parse(clean) as T;
}
