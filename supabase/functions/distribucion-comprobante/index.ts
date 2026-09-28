// distribucion-comprobante — lee la foto del comprobante de un pago de
// Distribución y la cuadra contra el monto del pago.
//
// POST { imagenBase64, mimeType, esperado: { monto, forma } } con la sesión
// del usuario (verify_jwt ON). Devuelve { leido, coincide, sinLector }.
//
// ── Qué papeles son ─────────────────────────────────────────────────────────
// No es la boleta de una salida de caja (`leer-boleta`): acá llegan el voucher
// del POS de una tarjeta, la CAPTURA de pantalla de una transferencia hecha en
// la app del banco del cliente, un comprobante de depósito o la foto de un
// cheque. `leer-boleta` rechaza una pantalla por diseño; este no.
//
// ── Lo que decide y lo que no ───────────────────────────────────────────────
// Sólo LEE y compara. No frena nada: si el monto no coincide, la pantalla le
// pregunta a la persona y lo que conteste queda escrito en el pago. Una
// máquina que lee mal no puede trabar una venta; una persona que acepta una
// diferencia tiene que dejar dicho por qué.
//
// Sin llave del lector (GEMINI_API_KEY) contesta `sinLector: true` y la
// pantalla sigue con la foto y el monto escrito a mano: la lectura ayuda, no
// es condición.

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireActiveEmployeeUser } from "../_shared/security.ts";
import { callGemini, parseGeminiJson } from "../_shared/gemini.ts";

const PROMPT = `Estás mirando la foto de un COMPROBANTE DE PAGO que un cliente le entrega a
un vendedor: puede ser el voucher impreso del POS de una tarjeta, la captura de
pantalla de una transferencia en la app de un banco, el comprobante de un depósito
o la foto de un cheque.

Devuelve ÚNICAMENTE un JSON válido con esta forma exacta:
{
  "es_comprobante": true | false,
  "tipo": "TARJETA | TRANSFERENCIA | DEPOSITO | CHEQUE | OTRO",
  "monto": 0.00,
  "moneda": "USD" | null,
  "referencia": "el número de autorización, de referencia, de operación o de cheque, o null",
  "banco": "el banco o la red que emite el comprobante, o null",
  "fecha": "YYYY-MM-DD o null",
  "beneficiario": "a quién se le pagó, si aparece, o null",
  "legible": true | false,
  "motivo": "si es_comprobante es false, en una frase corta en español, qué se ve"
}

Reglas:
- "es_comprobante" es false si la foto no muestra un comprobante de pago (un producto,
  una persona, una pantalla que no es de un pago, una factura, una hoja en blanco).
- "monto" es el importe PAGADO o TRANSFERIDO, como número, sin símbolo ni separador
  de miles. Si hay varios importes, el rotulado TOTAL, MONTO o IMPORTE.
- Las impresoras térmicas escriben el cero con una barra (Ø): no lo confundas con un 8.
- Si no se lee con seguridad, "legible": false y no inventes el monto.`;

const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "método no permitido" });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const empleado = await requireActiveEmployeeUser(req, admin);
  if (!empleado) return json(req, 401, { error: "Sesión inválida o empleado inactivo" });

  let cuerpo: any;
  try { cuerpo = await req.json(); } catch { return json(req, 400, { error: "cuerpo inválido" }); }
  const { imagenBase64, mimeType, esperado } = cuerpo ?? {};
  if (!imagenBase64) return json(req, 400, { error: "Falta la imagen." });

  if (!Deno.env.get("GEMINI_API_KEY")?.trim()) {
    return json(req, 200, { sinLector: true, leido: null, coincide: null });
  }
  try {
    const leido = parseGeminiJson<Record<string, any>>(await callGemini({
      prompt: PROMPT,
      inlineData: [{ mimeType: mimeType || "image/jpeg", data: imagenBase64 }],
      jsonOutput: true,
      temperature: 0,
      timeoutMs: 45_000,
    }));
    const monto = Number(leido.monto);
    const esperadoMonto = esperado?.monto == null ? null : Number(esperado.monto);
    const coincide = !leido.es_comprobante || leido.legible === false || !Number.isFinite(monto) || esperadoMonto == null
      ? null
      : Math.abs(monto - esperadoMonto) < 0.005;
    return json(req, 200, { sinLector: false, leido, coincide });
  } catch (e) {
    // Leer falló: la pantalla sigue sin lectura, no se traba la venta.
    return json(req, 200, { sinLector: true, error: (e as Error).message, leido: null, coincide: null });
  }
});
