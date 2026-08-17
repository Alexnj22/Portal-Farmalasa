import { getCorsHeaders, requireAuthUser } from "../_shared/security.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Consulta al registro de profesionales del Consejo Superior de Salud Pública.
//
// Corre en el SERVIDOR y no en el navegador por dos motivos, y ninguno es la
// comodidad: el sitio es JSF/PrimeFaces —hay que traer una página, sacarle el
// `ViewState` y recién ahí mandar el POST— y además no manda cabeceras CORS,
// así que desde el navegador no se puede ni intentar.
//
// ── Nunca es obligatoria ───────────────────────────────────────────────────
// Lo que la norma exige (ítem 3.13 de la guía de la SRS) es que la RECETA
// traiga los datos del prescriptor, y esa receta se está fotografiando. Esto
// confirma y ahorra tecleo. Si el sitio se cae —es un sitio de gobierno—, el
// portal sigue guardando el médico a mano.
//
// ── Tres trampas MEDIDAS, no supuestas ─────────────────────────────────────
//
//   1. La búsqueda por número es por COINCIDENCIA PARCIAL. Buscando `5000`
//      devuelve también `15000` y `25000`. Sin filtrar por igualdad exacta se
//      guardaría otro médico con el número correcto.
//
//   2. Nombres y apellidos son CAMPOS SEPARADOS y no son intercambiables.
//      Medido: «JOSE ROBERTO JULE SEGURA» en el campo de nombres devuelve
//      **cero resultados**, que en pantalla se lee igual que «ese médico no
//      existe». Por eso esta función recibe los dos por separado y la pantalla
//      pide los dos por separado.
//
//   3. Un apellido solo devuelve decenas (`JULE` → 12, `JOSE ROBERTO` → 94),
//      pero la tabla PAGINA de a seis y la respuesta trae sólo esa página. El
//      total real está en el `rowCount` del widget, NO en la cantidad de filas
//      que llegaron: contar las filas decía «6 resultados» cuando había 12, y
//      una lista truncada en silencio se lee como «éstos son todos». Medido
//      con `JULE`.
//
// ── Quién puede prescribir ─────────────────────────────────────────────────
// Art. 19 de la Ley de Medicamentos: «sólo podrán ser prescritos por
// profesionales médicos, odontólogos y médicos veterinarios». Son esas tres
// juntas y ninguna más — enfermería y químico farmacéutico no prescriben.
// ═══════════════════════════════════════════════════════════════════════════

const BASE = "https://cssp.gob.sv/profesionales/faces/consulta/buscar.xhtml";
const TOPE = 25;

// P01 médica, P02 odontológica, P07 médico veterinario. La lista NO es la del
// sitio (que tiene siete): es la del Art. 19.
const JUNTAS_QUE_PRESCRIBEN = new Set(["P01", "P02", "P07"]);

const limpiar = (s: string) =>
  s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
   .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

/** Las filas de la tabla de resultados. */
function parsearFilas(xml: string) {
  const out: Array<{ nombres: string; apellidos: string; numero_junta: string; junta: string; carrera: string }> = [];
  // Cada resultado es un <tr data-ri="N"> con seis <td role="gridcell">.
  const filas = xml.match(/<tr[^>]*data-ri="\d+"[\s\S]*?<\/tr>/g) || [];
  for (const fila of filas) {
    const celdas = (fila.match(/<td[^>]*role="gridcell"[^>]*>([\s\S]*?)<\/td>/g) || [])
      .map((c) => limpiar(c.replace(/^<td[^>]*>/, "").replace(/<\/td>$/, "")));
    if (celdas.length < 5) continue;
    const [nombres, apellidos, numero, junta, carrera] = celdas;
    if (!numero) continue;
    out.push({ nombres, apellidos, numero_junta: numero, junta, carrera });
  }
  return out;
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const responder = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status, headers: { ...cors, "Content-Type": "application/json" },
    });

  // La llama el navegador con la sesión de quien completa el libro, así que va
  // con JWT (`verify_jwt: true`). El flag depende de QUIÉN la llama, no del
  // circuito al que pertenece.
  const user = await requireAuthUser(req);
  if (!user) return responder({ ok: false, error: "UNAUTHORIZED" }, 401);

  try {
    const { junta = "P01", numero = "", nombres = "", apellidos = "" } =
      await req.json().catch(() => ({}));

    if (!JUNTAS_QUE_PRESCRIBEN.has(junta)) {
      return responder({ ok: false, error: "Esa junta no corresponde a un profesional que pueda prescribir." }, 400);
    }
    const num = String(numero || "").trim();
    const nom = String(nombres || "").trim();
    const ape = String(apellidos || "").trim();
    if (!num && !nom && !ape) {
      return responder({ ok: false, error: "Hay que dar el número de junta, o el nombre y el apellido." }, 400);
    }

    // 1. La página, para el ViewState y la cookie de sesión.
    const inicio = await fetch(BASE, { signal: AbortSignal.timeout(20_000) });
    if (!inicio.ok) return responder({ ok: false, error: "El registro del Consejo no respondió." }, 502);
    const html = await inicio.text();
    const cookie = inicio.headers.get("set-cookie")?.split(";")[0] ?? "";
    const vs = html.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/)?.[1];
    if (!vs) return responder({ ok: false, error: "El registro del Consejo cambió de forma." }, 502);

    // 2. La búsqueda.
    const cuerpo = new URLSearchParams({
      "javax.faces.partial.ajax": "true",
      "javax.faces.source": "frm1:j_idt45",
      "javax.faces.partial.execute": "@all",
      "javax.faces.partial.render": "frm1:profesionales frm1:panelDatos",
      "frm1:j_idt45": "frm1:j_idt45",
      "frm1": "frm1",
      "frm1:nombre": nom,
      "frm1:apellidos": ape,
      "frm1:junta_input": junta,
      "frm1:junta_focus": "",
      "frm1:profesion_input": "",
      "frm1:profesion_focus": "",
      "frm1:idProfesional": num,
      "frm1:j_idt59": "grid",
      "javax.faces.ViewState": vs,
    });

    const res = await fetch(BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Faces-Request": "partial/ajax",
        "X-Requested-With": "XMLHttpRequest",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: cuerpo.toString(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return responder({ ok: false, error: "El registro del Consejo no respondió." }, 502);

    const xml = await res.text();
    let filas = parsearFilas(xml);

    // El total REAL sale del paginador del widget, no de las filas que
    // llegaron: la tabla manda una página de seis por vez.
    const totalReal = Number(xml.match(/rowCount:\s*(\d+)/)?.[1] ?? filas.length);

    // Trampa 1: la búsqueda por número es parcial. `5000` trae `15000` y
    // `25000`, y guardar cualquiera de ésos sería guardar otro médico.
    if (num) filas = filas.filter((f) => f.numero_junta === num);

    // Con número, el total que importa es el de las coincidencias exactas.
    const total = num ? filas.length : totalReal;
    const recortado = total > filas.length || filas.length > TOPE;

    return responder({
      ok: true,
      total,
      recortado,
      profesionales: filas.slice(0, TOPE).map((f) => ({
        numero_junta: f.numero_junta,
        nombre: `${f.nombres} ${f.apellidos}`.replace(/\s+/g, " ").trim(),
        nombres: f.nombres,
        apellidos: f.apellidos,
        junta,
        junta_texto: f.junta,
        carrera: f.carrera,
      })),
    });
  } catch (e) {
    // El detalle NO viaja al navegador: es un sitio ajeno y su error interno no
    // le dice nada a quien está completando una receta.
    console.error("consultar-profesional-cssp:", e);
    return responder({ ok: false, error: "No se pudo consultar el registro del Consejo." }, 502);
  }
});
