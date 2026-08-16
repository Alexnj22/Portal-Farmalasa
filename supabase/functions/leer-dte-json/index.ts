import { createClient } from "npm:@supabase/supabase-js@2";
import { extractText, getDocumentProxy } from "npm:unpdf@1.6.2";
import { requireInvokeSecret } from "../_shared/security.ts";

// Leer el JSON de un DTE de compra — la pieza que le faltaba a todo lo demás.
//
// POR QUÉ EXISTE. El portal guarda el JSON de cada documento en el bucket
// PRIVADO `purchase-dte`, y hasta hoy nadie lo leía: lo único que se consultaba
// era `purchase_dte_documents.items_text`, que es el mismo JSON **aplanado en
// una sola cadena** por `extractItemsText` — sólo `codigo + descripcion`, unidos
// con ` | `, y **descartando la descripción repetida**.
//
// Esa pérdida está medida (`docs/AUDITORIA-MATCH-DTE-PRODUCTOS-2026-08-16.md`):
// sólo COFARSAL pierde 177 renglones, y le falta alguno a 81 de sus 209
// compras. Y peor: al quedarse con dos campos, el texto **no puede mostrar** lo
// que el proveedor manda en los demás. La factura de GAMMA lo dejó a la vista —
// su representación gráfica trae columnas `Lote` y `Vence` que en `items_text`
// no aparecen por ningún lado.
//
// AUTENTICACIÓN. Secreto de invocación (`ADMIN_INVOKE_SECRET`), no JWT: la
// llama Postgres con `net.http_post` leyendo el secreto de Vault, igual que los
// crons. Por eso se despliega con `--no-verify-jwt` — sin el flag, la
// plataforma rechaza la llamada antes de ejecutar una línea.
//
// NO ESCRIBE NADA. Lee de Storage y devuelve; ni una escritura.

const MAX_DOCS  = 12;   // el cuerpo de la respuesta viaja por net._http_response
const MAX_ITEMS = 10;

/** El sobre viejo: `{selloRecibido, firmaElectronica, dteJson}`. */
function desenvolver(j: any): any {
  return j?.dteJson ?? j?.documento ?? j;
}

/** El path dentro del bucket, sacado de la URL formato-public que se guarda. */
function pathDeStorage(url: string | null): string | null {
  if (!url) return null;
  const i = url.indexOf("/purchase-dte/");
  return i < 0 ? null : decodeURIComponent(url.slice(i + "/purchase-dte/".length));
}

// ── El PDF ──────────────────────────────────────────────────────────────────
// Cinco proveedores (GAMMA, MENFAR, SAVONA, CONGELADOS, STEINER) NO mandan lote
// ni vencimiento en el JSON — verificado leyéndolos enteros, apéndice incluido.
// Pero su representación gráfica sí los imprime: la factura de GAMMA trae
// columnas «Lote» y «Vence». El PDF está guardado en el mismo bucket, así que
// el dato es alcanzable sin pedirle nada a nadie.
//
// `unpdf` extrae texto sin DOM ni canvas — es el mismo paquete con el que
// `sync-purchase-emails` detecta el código de generación de un PDF huérfano,
// así que ya está probado en este runtime.
async function textoDelPdf(bytes: Uint8Array): Promise<string> {
  const doc = await getDocumentProxy(bytes);
  const { text } = await extractText(doc, { mergePages: true });
  return text;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ── El vencimiento es MES Y AÑO, nunca día ─────────────────────────────────
// Regla del negocio, confirmada contra los datos: de las 24,776 líneas de
// compra de los últimos diez meses, **las 24,776 se guardaron con día 1**. Cero
// excepciones. (Las 483 con otro día son todas anteriores a nov-2025, de una
// convención que ya no se usa; `inventory` dice lo mismo.)
//
// Eso simplifica y robustece la lectura: **el día que imprime el proveedor es
// ruido**. COFARSAL escribe `01/01/2030`, RONASA `31/10/2027`, GAMMA `04/2028`
// y VIJOSA `(V-12-27)` — los cuatro terminan en el mismo lugar. Y el formato de
// VIJOSA, que sin esta regla parecía incompleto, resulta ser exactamente lo que
// hace falta.
const MES_ES = /^(0?[1-9]|1[0-2])$/;

/** Cualquier fecha que escriba un proveedor → `YYYY-MM-01`, o null. */
function aMesYAnio(bruto: string | null): string | null {
  if (!bruto) return null;
  const p = bruto.trim().split(/[\/\-.]/).filter(Boolean);
  let mes: string | null = null, anio: string | null = null;

  if (p.length === 3) {            // dd/mm/aaaa — el día se descarta
    [, mes, anio] = p;
  } else if (p.length === 2) {     // mm/aaaa  o  mm/aa
    [mes, anio] = p;
  } else return null;

  if (!MES_ES.test(mes)) return null;
  if (anio.length === 2) anio = String(2000 + Number(anio));
  if (!/^\d{4}$/.test(anio)) return null;
  const a = Number(anio);
  // Un vencimiento fuera de esta ventana es un número mal leído, no una fecha.
  //
  // El rango importa MÁS de lo que parece. Con `2000..2100` el precio `12.00`
  // de LETERAGO se leía como diciembre del 2000 —mes 12, año 00— y eso
  // arrastraba el campo de al lado como número de lote: devolvía `false`, que
  // es literalmente lo que ese proveedor manda como descripción. Un vencimiento
  // de hace 26 años no existe en una compra de hoy.
  const hoy = new Date().getUTCFullYear();
  if (a < hoy - 5 || a > hoy + 20) return null;
  return `${anio}-${String(Number(mes)).padStart(2, "0")}-01`;
}

// Las formas en que los proveedores escriben la fecha, de la más específica a
// la más suelta. El orden importa: `dd/mm/aaaa` tiene que probarse antes que
// `mm/aaaa`, o la primera mitad se leería como mes y año.
const FECHAS = [
  /(?:fecha\s*exp\.?|vence|vencimiento|caducidad|v)\s*[:.]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
  /\(\s*v\s*-\s*(\d{1,2}\s*-\s*\d{2,4})\s*\)/i,          // VIJOSA: (V-12-27)
  /(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/,
  /(\d{1,2}[\/\-.]\d{4})\b/,                              // GAMMA: 04/2028
];

const LOTES = [
  /(?:n[uú]mero\s+de\s+)?lote\s*[:.]?\s*([A-Za-z0-9._\-\/]+)/i,
  /\bl0te\s*[:.]?\s*([A-Za-z0-9._\-\/]+)/i,
];

// Un lote de verdad tiene al menos dos caracteres y alguno alfanumérico.
// Sin esto, IMBERTON —que rotula «cantidad - lote - fecha caducidad»— devolvía
// el guion como número de lote: un dato inventado, que es peor que ninguno.
const loteValido = (s: string | null) =>
  !!s && s.replace(/[^A-Za-z0-9]/g, "").length >= 2 ? s : null;

/**
 * El lote SIN rótulo, que es como lo manda casi la mitad de los proveedores.
 * Se apoya en el vencimiento: el lote es lo que está **pegado antes** de la
 * fecha. No se busca «algo que parezca un lote» —eso devuelve presentaciones y
 * gramajes—; se usa la fecha como ancla, que sí se reconoce sola.
 *
 *   DROGUERÍA AMERICANA  `OVESTIN CREMA 1MG. X 15GR.|B22625K|30/11/2027|7.000000`
 *   SANTA LUCÍA          `VISINA 15 ML 7750021004879|RAB3F00|30/01/2029|FCO|18.00`
 *   MONTREAL             `GASTROFLUX 10MG X 30 L138601 V. 01-11-2028 16`
 */
function loteSinRotulo(t: string): string | null {
  // (0) IMBERTON escribe el ENCABEZADO y después los valores en ese orden:
  //     `SIMILAC RICE 400GX6IT cantidad - lote - fecha caducidad 2 - 790748N11 - 18-07-2027`
  //     Rotula la fila entera en vez de cada dato, así que el rótulo suelto no
  //     sirve de ancla — sirve el orden que él mismo declara.
  const imb = t.match(/cantidad\s*-\s*lote\s*-\s*fecha\s+caducidad\s+\S+\s*-\s*(\S+)\s*-/i);
  if (imb) { const c = loteValido(imb[1]); if (c) return c; }

  // (a) Entre separadores: el campo justo antes del que es una fecha.
  const partes = t.split("|").map((x) => x.trim());
  if (partes.length >= 3) {
    for (let i = 1; i < partes.length; i++) {
      if (aMesYAnio(partes[i]) && partes[i].split(/[\/\-.]/).length >= 2) {
        const cand = loteValido(partes[i - 1]);
        // El nombre del producto también está entre `|`: un lote no lleva
        // espacios, y eso lo separa del nombre sin tener que conocerlo.
        if (cand && !/\s/.test(cand)) return cand;
      }
    }
  }
  // (b) Sin separadores, con la fecha rotulada: el token pegado antes del
  //     rótulo. Se exige que mezcle letra y dígito para no traerse «30» ni
  //     «X» de «X 30».
  const m = t.match(/([A-Za-z0-9][A-Za-z0-9._\-\/]{2,})\s+(?:v\.|vence|vencimiento|f\.?\s*exp)/i);
  if (m && /[A-Za-z]/.test(m[1]) && /\d/.test(m[1])) return loteValido(m[1]);
  return null;
}

/** Lote y vencimiento escondidos en el texto libre de un renglón. */
function deTextoLibre(s: string): { lote: string | null; vence: string | null } {
  const t = norm(s ?? "");
  let vence: string | null = null;
  for (const re of FECHAS) { const m = t.match(re); if (m) { vence = aMesYAnio(m[1]); if (vence) break; } }
  let lote: string | null = null;
  for (const re of LOTES) { const m = t.match(re); if (m) { lote = loteValido(m[1]); if (lote) break; } }
  if (!lote) lote = loteSinRotulo(t);
  return { lote, vence };
}

/**
 * Lote y vencimiento de un renglón, leídos del PDF.
 *
 * NO se busca «un lote» a ciegas: se ancla en lo que el JSON ya dice de ese
 * renglón —el código y la descripción— y se lee **lo que queda entre la
 * descripción y la cantidad**. Los dos extremos son conocidos, así que el
 * hueco del medio es exactamente el dato que falta; no hay que adivinar cuál
 * de los números de la línea es cuál.
 *
 * Devuelve `null` cuando el ancla no aparece en el texto: es preferible que la
 * pantalla lo pida a inventar un vencimiento, que es un dato sanitario.
 */
function loteYVence(texto: string, item: any): { lote: string | null; vence: string | null; de: string } {
  const desc = norm(String(item?.descripcion ?? ""));
  if (!desc) return { lote: null, vence: null, de: "sin descripción" };

  // (0) La propia descripción del JSON. Diez de los quince proveedores meten
  //     ahí el lote y el vencimiento, así que ni hace falta abrir el PDF.
  const enDesc = deTextoLibre(desc);
  if (enDesc.lote || enDesc.vence) return { ...enDesc, de: "descripcion" };

  // La cantidad tal como la imprime el papel («4.00»), para cerrar el hueco.
  const cant = Number(item?.cantidad ?? 0);
  const cantTxt = Number.isFinite(cant) ? cant.toFixed(2) : null;

  const t = norm(texto);

  // (A) Columnas sin rótulo — GAMMA: `código descripción LOTE VENCE cant precio`.
  //     El hueco queda encerrado entre la descripción y la cantidad.
  const re = new RegExp(
    escapar(desc) + "\\s+(.{0,40}?)\\s*" + (cantTxt ? escapar(cantTxt) : "\\d+\\.\\d{2}") + "\\b",
  );
  const m = t.match(re);
  if (m) {
    const medio = norm(m[1]);
    const f = medio.match(/(\d{1,2}[\/\-.]\d{2,4}(?:[\/\-.]\d{2,4})?)\s*$/);
    const vence = f ? aMesYAnio(f[1]) : null;
    const lote  = loteValido(norm(f ? medio.slice(0, f.index) : medio) || null);
    if (lote || vence) return { lote, vence, de: "pdf/columnas" };
  }

  // (B) Rótulos explícitos — MENFAR: `descripción Lote: X Vencimiento: Y`.
  //     Se busca sólo DESPUÉS de la descripción y en una ventana corta, para no
  //     traerse el lote del renglón siguiente.
  const i = t.indexOf(desc);
  if (i >= 0) {
    const ventana = t.slice(i + desc.length, i + desc.length + 120);
    const r = deTextoLibre(ventana);
    if (r.lote || r.vence) return { ...r, de: "pdf/rotulos" };
  }

  return { lote: null, vence: null, de: "no encontrado" };
}

Deno.serve(async (req: Request) => {
  if (!requireInvokeSecret(req)) {
    return new Response(JSON.stringify({ error: "no autorizado" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const {
      document_ids = null,
      emisor_nit   = null,
      emisor_like  = null,
      limit        = 3,
      max_items    = MAX_ITEMS,
      // `claves` devuelve sólo la forma (qué campos trae cada renglón) en vez
      // del contenido: sirve para barrer muchos proveedores sin traerse la
      // factura entera.
      modo         = "items",
    } = body ?? {};

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let q = admin
      .from("purchase_dte_documents")
      .select("id, emisor_nombre, emisor_nit, codigo_generacion, fecha_emision, json_path, pdf_path")
      .not("json_path", "is", null)
      .order("id", { ascending: false })
      .limit(Math.min(Number(limit) || 3, MAX_DOCS));

    if (Array.isArray(document_ids) && document_ids.length > 0) {
      q = q.in("id", document_ids.slice(0, MAX_DOCS));
    }
    if (emisor_nit)  q = q.eq("emisor_nit", emisor_nit);
    if (emisor_like) q = q.ilike("emisor_nombre", `%${emisor_like}%`);

    const { data: docs, error } = await q;
    if (error) throw new Error(`purchase_dte_documents: ${error.message}`);

    const salida: any[] = [];

    for (const d of docs ?? []) {
      const path = pathDeStorage(d.json_path);
      if (!path) { salida.push({ id: d.id, error: "json_path sin ruta de bucket" }); continue; }

      const { data: blob, error: dlErr } = await admin.storage.from("purchase-dte").download(path);
      if (dlErr || !blob) { salida.push({ id: d.id, error: `descarga: ${dlErr?.message}` }); continue; }

      let dte: any;
      try { dte = desenvolver(JSON.parse(await blob.text())); }
      catch (e: any) { salida.push({ id: d.id, error: `json ilegible: ${e.message}` }); continue; }

      const items: any[] = Array.isArray(dte?.cuerpoDocumento) ? dte.cuerpoDocumento : [];

      // La UNIÓN de claves de todos los renglones: si un proveedor manda un
      // campo sólo en algunos, igual aparece.
      const claves = [...new Set(items.flatMap((it) => Object.keys(it ?? {})))].sort();

      const base = {
        id: d.id,
        emisor: d.emisor_nombre,
        emisor_nit: d.emisor_nit,
        fecha: d.fecha_emision,
        renglones: items.length,
        claves_del_renglon: claves,
        // Extensiones y apartados donde algunos emisores meten datos propios.
        // `apendice` es el que importa: el estándar lo deja libre como lista de
        // {campo, etiqueta, valor}, y es el único sitio legal para mandar algo
        // que el esquema no tiene — por ejemplo lote y vencimiento.
        tiene_extension: !!dte?.extension,
        extension: dte?.extension ?? null,
        apendice: dte?.apendice ?? null,
        otros_documentos: dte?.otrosDocumentos ?? null,
        claves_raiz: Object.keys(dte ?? {}).sort(),
      };

      if (modo === "lotes") {
        const pPdf = pathDeStorage(d.pdf_path);
        if (!pPdf) { salida.push({ ...base, error: "sin pdf_path" }); continue; }
        const { data: pdfBlob, error: pdfErr } = await admin.storage.from("purchase-dte").download(pPdf);
        if (pdfErr || !pdfBlob) { salida.push({ ...base, error: `pdf: ${pdfErr?.message}` }); continue; }
        let txt = "";
        try { txt = await textoDelPdf(new Uint8Array(await pdfBlob.arrayBuffer())); }
        catch (e: any) { salida.push({ ...base, error: `pdf ilegible: ${e?.message ?? e}` }); continue; }

        const leidos = items.map((it) => {
          const r = loteYVence(txt, it);
          return {
            codigo: it?.codigo ?? null,
            descripcion: it?.descripcion ?? null,
            cantidad: it?.cantidad ?? null,
            precioUni: it?.precioUni ?? null,
            lote: r.lote, vence: r.vence, de: r.de,
          };
        });
        salida.push({
          ...base,
          con_lote:  leidos.filter((x) => x.lote).length,
          con_vence: leidos.filter((x) => x.vence).length,
          renglones_leidos: leidos.slice(0, Math.min(Number(max_items) || MAX_ITEMS, 25)),
        });
        continue;
      }

      if (modo === "pdf") {
        const pPdf = pathDeStorage(d.pdf_path);
        if (!pPdf) { salida.push({ ...base, pdf: "sin pdf_path" }); continue; }
        const { data: pdfBlob, error: pdfErr } = await admin.storage.from("purchase-dte").download(pPdf);
        if (pdfErr || !pdfBlob) { salida.push({ ...base, pdf: `descarga: ${pdfErr?.message}` }); continue; }
        try {
          const txt = await textoDelPdf(new Uint8Array(await pdfBlob.arrayBuffer()));
          salida.push({ ...base, pdf_caracteres: txt.length,
            pdf_texto: txt.slice(Number(body?.pdf_desde ?? 0), Number(body?.pdf_desde ?? 0) + Number(body?.pdf_largo ?? 2500)) });
        } catch (e: any) {
          // PDF escaneado o sin capa de texto: no hay nada que leer.
          salida.push({ ...base, pdf: `ilegible: ${e?.message ?? e}` });
        }
        continue;
      }

      salida.push(modo === "claves"
        ? base
        : { ...base, items: items.slice(0, Math.min(Number(max_items) || MAX_ITEMS, 25)) });
    }

    return new Response(JSON.stringify({ documentos: salida }, null, 1), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
