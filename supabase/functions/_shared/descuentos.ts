// ─── Los DESCUENTOS por producto del sistema de la caja ────────────────────
//
// El sistema de la caja tiene una pantalla para esto («Admin Promociones») y lo
// que hace es descontar en la venta: un porcentaje del renglón, o un monto por
// unidad. Este archivo es el único sitio del portal que la habla.
//
// ── Lo que se midió antes de escribirlo (2026-09-04) ──────────────────────
// 13 descuentos históricos, todos a todas las salas. Comprobado punta a punta
// con Omega 3 (29.67 %): 2 × $13.50 = $27.00 → −$8.01 → **$18.99**, que es
// exactamente el `total_linea` que el portal ya tenía sincronizado.
//
// Y ahí está el problema que este módulo resuelve: `sales_invoice_items` NO
// tiene columna de descuento. Llega el precio unitario crudo y el total del
// renglón ya descontado, así que **un descuento de campaña es indistinguible de
// un precio cambiado a mano**. Nadie podía ver qué había vigente sin entrar al
// sistema de la caja sala por sala.
//
// ── Cuatro cosas del origen que se descubrieron midiendo ──────────────────
//  1. **La sala sale del POST, no de la sesión.** Medido: con la sesión abierta
//     en Salud 1 y `id_sucursal=3` en el cuerpo, quedó registrado en Salud 3.
//     O sea que un descuento de una sola sala NO exige `cambio_sesion.php` —
//     una petición alcanza, sea de una sala o de todas.
//  2. **Su propio formulario deja un producto fantasma.** Manda la lista con un
//     `#` al final (`87#84#79#`) y el servidor guarda la cadena vacía como
//     producto 0: 11 de los 13 lo arrastran. Acá se manda SIN el separador
//     final, y se comprobó que así no aparece.
//  3. **Borrar no es el enlace que el menú muestra.** `?process=delete&
//     id_promocion=N` por GET devuelve el formulario de alta y no borra nada.
//     El borrado real es un POST con `process=delete` y **`id=N`** — otro
//     nombre para el mismo número, que es la familia de `id_factura` llevando
//     el id del crédito.
//  4. **No hay estado activo/inactivo.** Sólo fechas. «Apagar» es mover la
//     fecha de fin o borrar, y el portal lo dice con esas palabras.
//
// ── Lo que NO se lee de un rótulo ─────────────────────────────────────────
// La lista devuelve la sala como TEXTO («FARMACIA LA SALUD 3»). Traducirlo con
// una lista escrita a mano es exactamente lo que costó el cargo de enfermería,
// así que el mapa id→rótulo se le pregunta al propio origen
// (`cambio_sesion.php`) en cada corrida. Y el tipo de descuento no sale de la
// columna «Porcentaje»/«Descuento» —eso es un rótulo— sino del símbolo `%`/`$`
// del monto, que es el valor que la base guarda.

const BASE = "https://clientesdte3.oss.com.sv/farma_salud/";
const LOGIN_URL = `${BASE}login.php`;
const FORM_URL = `${BASE}promocion.php`;
const LISTA_URL = `${BASE}admin_promocion_dt.php`;
const SALAS_URL = `${BASE}cambio_sesion.php`;

/** El rótulo que el origen usa para «vale en todas las salas». */
const ROTULO_TODAS = "multi sucursal";

const TIEMPO = 30_000;

export type TipoDescuento = "%" | "$";

export interface DescuentoDelOrigen {
  id: number;
  descripcion: string;
  tipo: TipoDescuento;
  monto: number;
  inicio: string;
  fin: string;
  /** `true` = vale en todas las salas. */
  todas_las_salas: boolean;
  /** La sala del origen cuando NO es de todas. `null` si es de todas o si el
   *  rótulo no se pudo traducir — un rótulo que no reconocemos NO se adivina. */
  erp_sucursal_id: number | null;
  /** El rótulo tal cual vino, para poder decirlo cuando no se pudo traducir. */
  sala_rotulo: string;
}

export interface DetalleDelOrigen extends DescuentoDelOrigen {
  productos: number[];
}

export function getPromosCreds(): { username: string; password: string } {
  const raw = Deno.env.get("ERP_PROMOS_CREDS") ?? Deno.env.get("ERP_PRODUCTS_CREDS");
  if (!raw) throw new Error("Falta el secreto ERP_PROMOS_CREDS (o ERP_PRODUCTS_CREDS).");
  return JSON.parse(raw);
}

export async function getSessionCookie(u: string, p: string): Promise<string> {
  const res = await fetch(LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: u, password: p, m: "1" }).toString(),
    redirect: "manual",
    signal: AbortSignal.timeout(TIEMPO),
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("El sistema de la caja no dio sesión.");
  return cookie;
}

// ── Utilidades de raspado ──────────────────────────────────────────────────

/** Deja el texto de una celda que vino envuelta en etiquetas. */
export function soloTexto(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** Las cinco entidades que el origen escribe al pintar un valor en el form. */
export function desescapar(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'");
}

/** El `value` de un `<input>` por su `name`, con comillas simples o dobles. */
export function valorDeCampo(html: string, name: string): string | null {
  const re = new RegExp(
    `<input[^>]*name=['"]${name}['"][^>]*>`,
    "i",
  );
  const tag = re.exec(html)?.[0];
  if (!tag) return null;
  const v = /value=['"]([^'"]*)['"]/i.exec(tag)?.[1];
  return v === undefined ? null : desescapar(v);
}

// ── El mapa de salas, preguntado al origen ─────────────────────────────────

/**
 * `rótulo en MAYÚSCULAS → id de sala del origen`, leído de su propio
 * desplegable. Nunca escrito a mano: el día que le cambien el nombre a una
 * sala, una lista propia se desincroniza sin dar error.
 */
export async function salasDelOrigen(cookie: string): Promise<Map<string, number>> {
  const html = await (await fetch(SALAS_URL, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(TIEMPO),
  })).text();

  const mapa = new Map<string, number>();
  for (const m of html.matchAll(/<option\s+value=['"](\d+)['"][^>]*>([^<]*)<\/option>/gi)) {
    mapa.set(soloTexto(desescapar(m[2])).toUpperCase(), Number(m[1]));
  }
  if (!mapa.size) throw new Error("No se pudo leer la lista de salas del sistema de la caja.");
  return mapa;
}

/**
 * Los dos campos ocultos que el formulario del origen manda y que dependen de
 * la CUENTA con la que se entró, no de lo que el portal quiera: quién escribe
 * y si es administrador. Se leen en vez de escribirse porque el día que el
 * secreto apunte a otra cuenta, un `32` escrito a mano firmaría con el nombre
 * de otro.
 */
export async function contextoDelFormulario(
  cookie: string,
): Promise<{ idUsuario: string; admin: string }> {
  const html = await (await fetch(FORM_URL, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(TIEMPO),
  })).text();

  const idUsuario = valorDeCampo(html, "id_usuario");
  const admin = valorDeCampo(html, "admin");
  if (!idUsuario) {
    throw new Error(
      "La cuenta configurada no puede abrir la pantalla de descuentos del sistema de la caja.",
    );
  }
  return { idUsuario, admin: admin ?? "1" };
}

// ── Leer ───────────────────────────────────────────────────────────────────

function traducirSala(
  rotulo: string,
  salas: Map<string, number>,
): { todas: boolean; erpId: number | null } {
  const limpio = rotulo.trim();
  if (limpio.toLowerCase() === ROTULO_TODAS) return { todas: true, erpId: null };
  return { todas: false, erpId: salas.get(limpio.toUpperCase()) ?? null };
}

/**
 * La lista entera, en UNA petición.
 *
 * No pagina: el origen acepta `length` y hoy son 13 filas. Se pide 5000 —muy
 * por encima de cualquier crecimiento razonable— y si algún día devolviera
 * exactamente ese número, `recordsTotal` lo delata.
 */
export async function listarDescuentos(
  cookie: string,
  salas: Map<string, number>,
): Promise<DescuentoDelOrigen[]> {
  const url = `${LISTA_URL}?draw=1&start=0&length=5000`;
  const txt = await (await fetch(url, {
    headers: { Cookie: cookie, "X-Requested-With": "XMLHttpRequest" },
    signal: AbortSignal.timeout(TIEMPO),
  })).text();

  let datos: { data?: unknown[][]; recordsTotal?: number };
  try {
    datos = JSON.parse(txt);
  } catch {
    throw new Error("La lista de descuentos no vino en el formato esperado.");
  }

  return (datos.data ?? []).map((f) => {
    /* El TIPO sale del símbolo del monto (`%` o `$`), que es lo que la base
       guarda, y no de la columna «Porcentaje»/«Descuento», que es un rótulo. */
    const montoCelda = soloTexto(String(f[3] ?? ""));
    const tipo: TipoDescuento = montoCelda.includes("%") ? "%" : "$";
    const monto = Number(montoCelda.replace(/[^0-9.]/g, "")) || 0;

    const rotulo = soloTexto(String(f[6] ?? ""));
    const { todas, erpId } = traducirSala(rotulo, salas);

    return {
      id: Number(f[0]),
      descripcion: soloTexto(desescapar(String(f[1] ?? ""))),
      tipo,
      monto,
      inicio: String(f[4] ?? ""),
      fin: String(f[5] ?? ""),
      todas_las_salas: todas,
      erp_sucursal_id: erpId,
      sala_rotulo: rotulo,
    };
  });
}

/** Los productos de un descuento. El origen devuelve sólo ids. */
export async function productosDelDescuento(cookie: string, id: number): Promise<number[]> {
  const txt = await (await fetch(FORM_URL, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ process: "consultar_promocion", id_promocion: String(id) }).toString(),
    signal: AbortSignal.timeout(TIEMPO),
  })).text();

  let r: { success?: boolean; data?: { id_producto?: string }[] };
  try {
    r = JSON.parse(txt);
  } catch {
    throw new Error("No se pudieron leer los productos del descuento.");
  }
  if (!r.success) return [];

  /* El 0 se descarta al LEER además de no escribirlo: 11 de los 13 descuentos
     que ya existían lo arrastran, y mostrarlo pintaría un producto que no
     existe en una pantalla que se usa para decidir. */
  return (r.data ?? [])
    .map((x) => Number(x.id_producto))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * Si el descuento es por porcentaje o por monto, leído del `<select>` del
 * formulario de edición.
 *
 * ── El espacio que no está, y lo que costó (2026-09-04) ──────────────────
 * El origen escribe la opción elegida como `<option value="$"selected>` — SIN
 * espacio antes de `selected`— y las no elegidas como `<option value="%" >`,
 * con uno. La primera versión pedía `\s+selected`, así que **el `$` no
 * matcheaba nunca** y el tipo caía al `%` del default.
 *
 * El modo de falla es el silencio: no da error y no se ve nada raro. Un
 * descuento de $0.75 POR UNIDAD se leía como 0.75 % del renglón, y guardar
 * desde esa pantalla lo habría convertido de verdad. Se descubrió corrigiendo
 * el descuento 17 y comparando contra la LISTA, que dice el tipo por otro
 * camino (el símbolo del monto).
 *
 * Por eso ahora, si no hay ninguna opción elegida, **lanza en vez de asumir**:
 * el default silencioso es lo que hizo el defecto invisible.
 */
export function tipoDelFormulario(html: string): TipoDescuento {
  const sel = /<option\s+value=['"]([%$])['"]\s*selected/i.exec(html)?.[1];
  if (sel !== "%" && sel !== "$") {
    throw new Error("No se pudo leer si el descuento es por porcentaje o por monto.");
  }
  return sel;
}

/**
 * Un descuento con TODO su detalle, leído del formulario de edición.
 *
 * Se lee de ahí y no de la lista porque el formulario trae los valores tal cual
 * la base los guarda —el `<option selected>` dice `%` o `$`, no «Porcentaje»—.
 *
 * ⚠️ `promocion.php?id=<inexistente>` NO da error: devuelve el formulario en
 * modo edición con todo vacío. Por eso la ausencia de `id_promocion` se traduce
 * acá a «no existe», que es lo que en realidad pasó.
 */
export async function detalleDelDescuento(
  cookie: string,
  id: number,
  salas: Map<string, number>,
): Promise<DetalleDelOrigen | null> {
  const html = await (await fetch(`${FORM_URL}?id=${id}`, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(TIEMPO),
  })).text();

  /* «No existe» y «no pude leer la pantalla» son dos problemas distintos y sólo
     uno tiene arreglo del lado de quien lo usa. El formulario se reconoce por
     su campo `process`: si ni ese está, lo que volvió no es el formulario —una
     pantalla de login vencido, o la cuenta sin acceso a esa pantalla— y decir
     «ya no existe» mandaría a buscar donde no está. */
  if (!valorDeCampo(html, "process")) {
    const pista = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? "sin título";
    const hayForm = /id=['"]promocionForm['"]/i.test(html);
    throw new Error(
      `El sistema de la caja no devolvió el formulario del descuento (respondió «${pista}», ` +
      `formulario ${hayForm ? "presente" : "AUSENTE"}, ${html.length} caracteres). ` +
      "Suele ser que la cuenta configurada no tiene esa pantalla.",
    );
  }
  if (!valorDeCampo(html, "id_promocion")) return null;

  const tipo = tipoDelFormulario(html);

  const checkbox = /<input[^>]*id=['"]multi_sucursal['"][^>]*>/i.exec(html)?.[0] ?? "";
  const todas = /checked/i.test(checkbox);

  const productos = await productosDelDescuento(cookie, id);

  /* La sala concreta no viaja en el formulario —su campo oculto `id_sucursal`
     es la de la SESIÓN, no la del descuento—, así que sale de la lista. */
  let erpId: number | null = null;
  let rotulo = todas ? "Multi sucursal" : "";
  if (!todas) {
    const fila = (await listarDescuentos(cookie, salas)).find((d) => d.id === id);
    erpId = fila?.erp_sucursal_id ?? null;
    rotulo = fila?.sala_rotulo ?? "";
  }

  return {
    id,
    descripcion: valorDeCampo(html, "descripcion") ?? "",
    tipo,
    monto: Number(valorDeCampo(html, "monto")) || 0,
    inicio: valorDeCampo(html, "fecha_inicio") ?? "",
    fin: valorDeCampo(html, "fecha_fin") ?? "",
    todas_las_salas: todas,
    erp_sucursal_id: erpId,
    sala_rotulo: rotulo,
    productos,
  };
}

// ── Escribir ───────────────────────────────────────────────────────────────

export interface DescuentoAEscribir {
  /** `0` para uno nuevo. */
  id: number;
  descripcion: string;
  tipo: TipoDescuento;
  monto: number;
  inicio: string;
  fin: string;
  todas_las_salas: boolean;
  /** La sala del origen. Obligatoria aunque sea de todas: el formulario la
   *  manda igual y el origen la guarda. */
  erp_sucursal_id: number;
  productos: number[];
}

async function postForm(
  cookie: string,
  cuerpo: Record<string, string>,
): Promise<{ success: boolean; msg: string }> {
  const txt = await (await fetch(FORM_URL, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(cuerpo).toString(),
    signal: AbortSignal.timeout(TIEMPO),
  })).text();

  try {
    const r = JSON.parse(txt);
    return { success: r.success === true, msg: String(r.msg ?? "") };
  } catch {
    /* Cuando el origen no contesta en JSON es porque devolvió una pantalla —el
       login vencido, o un `process` que no reconoce—. Decirlo así y no
       «error al guardar»: son dos problemas distintos. */
    throw new Error("El sistema de la caja no aceptó la operación (respondió una pantalla, no un resultado).");
  }
}

/** Crea o corrige. `payload.id === 0` crea. */
export async function guardarDescuento(
  cookie: string,
  ctx: { idUsuario: string; admin: string },
  p: DescuentoAEscribir,
): Promise<{ success: boolean; msg: string }> {
  return await postForm(cookie, {
    process: p.id > 0 ? "edit" : "insert",
    id_promocion: String(p.id > 0 ? p.id : 0),
    id_sucursal: String(p.erp_sucursal_id),
    id_usuario: ctx.idUsuario,
    admin: ctx.admin,
    descripcion: p.descripcion,
    tipo_descuento: p.tipo,
    monto: p.monto.toFixed(2),
    fecha_inicio: p.inicio,
    fecha_fin: p.fin,
    multi_sucursal: p.todas_las_salas ? "1" : "0",
    /* SIN el `#` final: con él, el origen guarda la cadena vacía como producto
       0 — el defecto que arrastran 11 de sus 13 descuentos. */
    data: p.productos.join("#"),
  });
}

/**
 * Borra.
 *
 * El parámetro se llama `id`, NO `id_promocion`, aunque el enlace del menú del
 * origen escriba `?process=delete&id_promocion=N`: ese GET devuelve el
 * formulario de alta y no borra nada. Medido.
 */
export async function borrarDescuento(
  cookie: string,
  id: number,
): Promise<{ success: boolean; msg: string }> {
  return await postForm(cookie, { process: "delete", id: String(id) });
}
