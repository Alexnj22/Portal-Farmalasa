import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireActiveEmployeeUser } from "../_shared/security.ts";

// Manifiesto de descarga masiva de facturas de compra: devuelve la LISTA de
// archivos con su URL firmada, sin mover un solo byte. El navegador los baja
// del CDN de Storage directo y arma el ZIP en streaming.
//
// Reemplaza a export-purchase-dte-zip (2026-08-03), que bajaba todos los
// archivos de Storage, armaba el ZIP en memoria y lo re-servía. Medido con
// julio 2026 (863 documentos = 1,726 archivos = 181 MB): esos bytes viajaban
// dos veces, el ZIP entero vivía en la memoria de la función (~130 MB por
// tanda de 300 contra ~256 MB de límite), y un corte de red durante la
// transferencia perdía la descarga completa porque no había forma de
// reintentar menos que la tanda entera. Acá el reintento es POR ARCHIVO
// (~83 kB promedio) y la función no tiene ni techo de memoria ni de tiempo:
// solo consulta y firma.
const BUCKET = "purchase-dte";

// La firma es un token portador: quien tenga la URL baja ESE archivo sin
// sesión hasta que expire. Son ~1,700 URLs vivas en el cliente, así que 1h
// (no las 12h del default de signStorageUrls) — alcanza de sobra para 181 MB
// incluso en una conexión mala, y acota la ventana si el listado se filtra.
const SIGN_TTL_SEGUNDOS = 3600;
// createSignedUrls firma en lote; se trocea para no mandar un array enorme
// en un solo POST. 1,726 archivos = 4 llamadas, milisegundos cada una.
const SIGN_CHUNK = 500;
// Tope de seguridad del listado, no de la descarga: 20k archivos son ~10
// años de compras. Existe para que un `ids` malformado no arme un manifiesto
// infinito, no para limitar al usuario (el viejo tope de 300 sí lo limitaba).
const MAX_ARCHIVOS = 20_000;

// Catálogo oficial DTE (Ministerio de Hacienda El Salvador) — duplicado del
// mapping de src/utils/dteTypes.js porque las edge functions (Deno) no
// pueden importar módulos de src/ (resolución de módulos distinta). Mismo
// texto, mantener sincronizados si el catálogo cambia.
const DTE_TYPE_FOLDERS: Record<string, string> = {
  "01": "Factura",
  "03": "Credito Fiscal (CCF)",
  "04": "Nota de Remision",
  "05": "Nota de Credito",
  "06": "Nota de Debito",
  "07": "Comprobante de Retencion",
  "08": "Comprobante de Liquidacion",
  "09": "Doc. Contable de Liquidacion",
  "11": "Factura de Exportacion",
  "14": "Factura Sujeto Excluido",
};
function folderForTipo(tipoDte: string | null): string {
  if (!tipoDte) return "Sin clasificar";
  return DTE_TYPE_FOLDERS[tipoDte] || `Tipo ${tipoDte}`;
}

function relativePath(publicUrl: string | null): string | null {
  if (!publicUrl) return null;
  const marker = `/object/public/${BUCKET}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(publicUrl.slice(idx + marker.length));
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // Descarga = acción de lectura: basta con can_view (no can_edit como
  // "Sincronizar ahora", que sí escribe). Mismo gate que tenía la función
  // que servía el ZIP — que el navegador baje directo NO relaja el permiso:
  // sin este chequeo no se emite ninguna firma.
  const employee = await requireActiveEmployeeUser(req, admin);
  if (!employee) {
    return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // Hacen falta las DOS claves: ver el módulo y, desde 2026-08-03, el permiso
  // aparte de abrir/descargar el documento (`facturas_compra_archivos`). Sin la
  // segunda esta función no emite ni una firma — es lo que evita que esconder
  // el botón "Descargar" en la vista sea todo el candado. La policy de Storage
  // pide la misma clave para el archivo suelto.
  const { data: empRole } = await admin.from("employees").select("role_id").eq("id", employee.id).single();
  const { data: perms, error: permErr } = await admin.from("role_permissions").select("module_key, can_view")
    .eq("role_id", empRole?.role_id ?? -1)
    .in("module_key", ["facturas_compra", "facturas_compra_archivos"]);
  const puede = (key: string) => (perms ?? []).some((p) => p.module_key === key && p.can_view === true);
  if (permErr || !puede("facturas_compra") || !puede("facturas_compra_archivos")) {
    return new Response(JSON.stringify({ error: "FORBIDDEN" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const ids: number[] = Array.isArray(body.ids) ? body.ids.map(Number).filter(Boolean) : [];
    // Pedido del usuario 2026-07-22: la descarga masiva también trae lo que
    // sigue pendiente en Revisión (PDFs huérfanos, JSON inválido, etc.) en su
    // propia carpeta "Revisar". Ya no hace falta el "solo en la primera
    // tanda" del diseño anterior: acá el manifiesto se arma de una sola vez.
    const includePendingReview = body.include_pending_review === true;
    if (ids.length === 0 && !includePendingReview) {
      return new Response(JSON.stringify({ error: "ids vacío" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    type Entrada = { name: string; rel: string };
    const entradas: Entrada[] = [];
    const warnings: string[] = [];

    if (ids.length > 0) {
      // .in() con miles de ids es una URL enorme; se trocea el INPUT igual
      // que manda la regla del cap de 1000 filas de PostgREST — con ≤500 ids
      // por llamada la respuesta tampoco puede pasarse de 1000 filas.
      const ID_CHUNK = 500;
      for (let i = 0; i < ids.length; i += ID_CHUNK) {
        const { data: rows, error: selErr } = await admin
          .from("purchase_dte_documents")
          .select("id, codigo_generacion, tipo_dte, json_path, pdf_path")
          .in("id", ids.slice(i, i + ID_CHUNK));
        if (selErr) throw new Error(selErr.message);

        for (const row of rows ?? []) {
          // codigo_generacion es NULL en docs "confirmados sin JSON" (ver
          // TabRevision) — sin este fallback, 2+ documentos así en la misma
          // descarga generaban null.json/null.pdf y se pisaban entre sí.
          const baseName = row.codigo_generacion || `doc-${row.id}`;
          const folder = folderForTipo(row.tipo_dte);
          const jsonRel = relativePath(row.json_path);
          if (jsonRel) entradas.push({ name: `${folder}/${baseName}.json`, rel: jsonRel });
          const pdfRel = relativePath(row.pdf_path);
          if (pdfRel) entradas.push({ name: `${folder}/${baseName}.pdf`, rel: pdfRel });
        }
      }
    }

    if (includePendingReview) {
      const { data: pending, error: pendErr } = await admin
        .from("purchase_dte_review_queue")
        .select("id, file_path, filename")
        .eq("status", "pendiente");
      if (pendErr) throw new Error(pendErr.message);
      for (const row of pending ?? []) {
        const rel = relativePath(row.file_path);
        if (!rel) continue;
        // Prefijo con el id de la fila — dos correos distintos pueden llegar
        // con el mismo nombre de archivo (ej. "Comprobante.pdf" de
        // proveedores distintos) y uno pisaría al otro sin avisar.
        entradas.push({ name: `Revisar/${row.id}_${row.filename || `archivo-${row.id}`}`, rel });
      }
    }

    if (entradas.length === 0) {
      return new Response(JSON.stringify({ error: "Ningún archivo para descargar" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (entradas.length > MAX_ARCHIVOS) {
      return new Response(JSON.stringify({ error: `Demasiados archivos (${entradas.length}) — acotá el rango de fechas.` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Un ZIP admite dos entradas con el mismo nombre y ningún extractor avisa:
    // según cuál abras, una tapa a la otra. Dos documentos pueden compartir
    // codigo_generacion y tipo (reprocesos, cargas duplicadas), así que el
    // choque se resuelve acá y queda visible en el nombre.
    const vistos = new Map<string, number>();
    for (const e of entradas) {
      const n = (vistos.get(e.name) ?? 0) + 1;
      vistos.set(e.name, n);
      if (n > 1) {
        const punto = e.name.lastIndexOf(".");
        e.name = punto > 0
          ? `${e.name.slice(0, punto)} (${n})${e.name.slice(punto)}`
          : `${e.name} (${n})`;
      }
    }

    const files: { name: string; url: string }[] = [];

    // No está documentado cuántas rutas acepta createSignedUrls en una sola
    // llamada, y de ese número depende TODA la descarga. En vez de asumirlo:
    // si un lote falla entero, se parte a la mitad y se reintenta hasta llegar
    // a 25. Así un tope más bajo del que creemos degrada a más llamadas
    // (milisegundos) en vez de romper la función.
    async function firmar(lote: Entrada[]): Promise<void> {
      const { data, error } = await admin.storage.from(BUCKET)
        .createSignedUrls(lote.map((e) => e.rel), SIGN_TTL_SEGUNDOS);

      if (error || !data) {
        if (lote.length > 25) {
          const mitad = Math.ceil(lote.length / 2);
          await firmar(lote.slice(0, mitad));
          await firmar(lote.slice(mitad));
          return;
        }
        throw new Error(error?.message ?? "no se pudieron firmar los archivos");
      }

      lote.forEach((e, j) => {
        const firmada = data[j]?.signedUrl;
        // createSignedUrls devuelve la fila con .error cuando el objeto no
        // existe (fila en BD apuntando a un archivo borrado). Se reporta en
        // el manifiesto de errores del ZIP en vez de romper toda la descarga.
        if (firmada) files.push({ name: e.name, url: firmada });
        else warnings.push(`${e.name}: ${data[j]?.error ?? "no se pudo firmar"}`);
      });
    }

    for (let i = 0; i < entradas.length; i += SIGN_CHUNK) {
      await firmar(entradas.slice(i, i + SIGN_CHUNK));
    }

    if (files.length === 0) {
      return new Response(JSON.stringify({ error: "Ningún archivo pudo firmarse" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ files, warnings }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
