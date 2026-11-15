// La ficha de cliente del ERP: leerla, escribirla y verificar que quedó.
//
// ⚠️ DUPLICADO CONSCIENTE. Este parseo nació en `push-cliente-erp/index.ts` y
// sigue ahí. No se unificó todavía porque tocar esa función implica
// redesplegarla y volver a probar su camino completo, y esto se escribió en la
// misma sesión que ya había cambiado `sync-dte-sales`. La deuda está anotada:
// al próximo cambio en cualquiera de las dos, unificar.
//
// El original manda mientras tanto: si difieren, gana `push-cliente-erp`.

export const BASE = "https://clientesdte3.oss.com.sv/farma_salud";

export interface Ficha {
  campos: Record<string, string>;
  opciones: Record<string, [string, string][]>;
}

export function getCreds(): { username: string; password: string } {
  const raw = Deno.env.get("ERP_CLIENTES_CREDS") ?? Deno.env.get("ERP_PURCHASES_CREDS");
  if (!raw) throw new Error("Falta el secreto ERP_CLIENTES_CREDS.");
  return JSON.parse(raw);
}

export async function login(): Promise<string> {
  const { username, password } = getCreds();
  const res = await fetch(`${BASE}/login.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, m: "1" }).toString(),
    redirect: "manual",                       // la cookie viaja en el 302
    signal: AbortSignal.timeout(20_000),
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("El ERP no devolvió cookie de sesión.");
  return cookie;
}

// El ERP se cae solo a veces: en 365 escrituras contestó una vez "Proceso no
// encontrado" en texto plano, y el mismo payload entró al reintentarlo.
export async function conReintento<T>(fn: () => Promise<T>, veces = 3, pausaMs = 1500): Promise<T> {
  let ultimo: unknown;
  for (let i = 0; i < veces; i++) {
    try { return await fn(); } catch (e) {
      ultimo = e;
      if (i < veces - 1) await new Promise(r => setTimeout(r, pausaMs * (i + 1)));
    }
  }
  throw ultimo;
}

export async function pedir(cookie: string, url: string, datos?: URLSearchParams): Promise<string> {
  return await conReintento(async () => {
    const res = await fetch(url, {
      method: datos ? "POST" : "GET",
      headers: {
        Cookie: cookie,
        "User-Agent": "Mozilla/5.0",
        "X-Requested-With": "XMLHttpRequest",
        Referer: `${BASE}/admin_cliente.php`,
        ...(datos ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: datos?.toString(),
      signal: AbortSignal.timeout(45_000),
    });
    const t = await res.text();
    if (/name\s*=\s*["']password/i.test(t.slice(0, 4000)))
      throw new Error("La sesión del ERP caducó (devolvió el login).");
    return t;
  });
}

const desescapar = (s: string) => s
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ");

/**
 * Los VALORES no se recortan a propósito: el control de duplicados del ERP
 * compara el nombre tal cual y hay fichas cuya única diferencia es un espacio
 * inicial. Las ETIQUETAS de los <option> sí, porque son para comparar.
 */
export function parsearFicha(html: string): Ficha {
  const campos: Record<string, string> = {};
  const opciones: Record<string, [string, string][]> = {};

  for (const m of html.matchAll(/<input([^>]*)>/g)) {
    const a = m[1];
    if (/type\s*=\s*["'](submit|button)/i.test(a)) continue;
    const n = a.match(/name\s*=\s*["']([^"']+)/);
    if (!n) continue;
    const v = a.match(/value\s*=\s*["']([^"']*)/);
    campos[n[1]] = v ? desescapar(v[1]) : "";
  }
  for (const m of html.matchAll(/<textarea([^>]*)>([\s\S]*?)<\/textarea>/g)) {
    const n = m[1].match(/name\s*=\s*["']([^"']+)/);
    if (n) campos[n[1]] = desescapar(m[2]);
  }
  for (const m of html.matchAll(/<select([^>]*)>([\s\S]*?)<\/select>/g)) {
    const n = m[1].match(/name\s*=\s*["']([^"']+)/);
    if (!n) continue;
    const lista: [string, string][] = [];
    let seleccionado = "";
    for (const o of m[2].matchAll(/<option([^>]*)>\s*([^<]*)/g)) {
      const v = o[1].match(/value\s*=\s*["']([^"']*)/);
      const value = v ? v[1] : "";
      if (/selected/i.test(o[1])) seleccionado = value;
      if (value !== "" && value !== "-1") lista.push([value, desescapar(o[2]).trim()]);
    }
    opciones[n[1]] = lista;
    campos[n[1]] = seleccionado;
  }
  return { campos, opciones };
}

export const leerFicha = async (cookie: string, erpId: string): Promise<Ficha> =>
  parsearFicha(await pedir(cookie, `${BASE}/editar_cliente.php?id_cliente=${erpId}`));

/** El id_cliente que el ERP asocia a una factura. Null si no se puede leer. */
export async function idClienteDeFactura(cookie: string, erpInvoiceId: string): Promise<string | null> {
  const html = await pedir(cookie, `${BASE}/reimprimir_factura.php?id_factura=${erpInvoiceId}`);
  return html.match(/id="id_cliente"[\s\S]*?<option value='(\d+)'\s+selected>/)?.[1] ?? null;
}

/**
 * Escribe UN campo de la ficha, reenviando todos los demás tal como estaban.
 *
 * Un POST parcial BORRA lo que no se manda (incidente 6317), así que se relee
 * la ficha, se cambia el campo y se reenvían los 21. Después se relee OTRA vez
 * para confirmar que quedó y que no se perdió nada — el ERP contesta 200 con
 * `typeinfo: "Error"` cuando rechaza, así que el HTTP no alcanza como prueba.
 */
export async function escribirCampo(
  cookie: string, erpId: string, campo: string, valor: string,
): Promise<{ ok: boolean; motivo?: string; perdidos?: string[] }> {
  const { campos } = await leerFicha(cookie, erpId);
  if (!Object.keys(campos).length) return { ok: false, motivo: "el ERP no devolvió la ficha" };

  const nuevos = { ...campos, [campo]: valor };
  const cruda = await pedir(cookie, `${BASE}/procesos/clientes.php`,
    new URLSearchParams({ ...nuevos, process: "edit", id_cliente: String(erpId) }));
  let resp: { typeinfo?: string; msg?: string };
  try { resp = JSON.parse(cruda); } catch { resp = { typeinfo: "NO-JSON", msg: cruda.slice(0, 200) }; }
  if (resp.typeinfo !== "Success")
    return { ok: false, motivo: resp.msg ?? resp.typeinfo ?? "rechazo sin motivo" };

  const despues = (await leerFicha(cookie, erpId)).campos;
  if ((despues[campo] ?? "") !== valor)
    return { ok: false, motivo: `envié '${valor}', quedó '${despues[campo] ?? ""}'` };
  const perdidos = Object.keys(campos).filter(k => campos[k] && !despues[k] && nuevos[k] !== "");
  if (perdidos.length) return { ok: false, motivo: "se perdieron campos", perdidos };
  return { ok: true };
}


// ── Escribir VARIOS campos, y la ubicación en cascada ────────────────────────

/**
 * Como `escribirCampo` pero con varios campos en un POST.
 *
 * `vaciadosEsperados` existe por los selects encadenados: al cambiar el
 * departamento, el ERP limpia municipio y distrito porque los viejos ya no
 * están en la lista nueva. Eso NO es pérdida de datos —es la consecuencia
 * correcta— y confundirlo con pérdida deja la ficha a medio escribir:
 * departamento nuevo, municipio y distrito en blanco. Pasó el 2026-08-09.
 */
export async function escribirCampos(
  cookie: string, erpId: string,
  cambios: Record<string, string>, vaciadosEsperados: string[] = [],
): Promise<{ ok: boolean; motivo?: string; perdidos?: string[] }> {
  const { campos } = await leerFicha(cookie, erpId);
  if (!Object.keys(campos).length) return { ok: false, motivo: "el ERP no devolvió la ficha" };
  const nuevos = { ...campos, ...cambios };
  const cruda = await pedir(cookie, `${BASE}/procesos/clientes.php`,
    new URLSearchParams({ ...nuevos, process: "edit", id_cliente: String(erpId) }));
  let resp: { typeinfo?: string; msg?: string };
  try { resp = JSON.parse(cruda); } catch { resp = { typeinfo: "NO-JSON", msg: cruda.slice(0, 200) }; }
  if (resp.typeinfo !== "Success")
    return { ok: false, motivo: resp.msg ?? resp.typeinfo ?? "rechazo sin motivo" };

  const despues = (await leerFicha(cookie, erpId)).campos;
  const malos = Object.entries(cambios)
    .filter(([k, v]) => (despues[k] ?? "") !== v)
    .map(([k, v]) => `${k}: envié '${v}', quedó '${despues[k] ?? ""}'`);
  if (malos.length) return { ok: false, motivo: malos.join(" · ") };

  const perdidos = Object.keys(campos)
    .filter(k => !vaciadosEsperados.includes(k))
    .filter(k => campos[k] && !despues[k] && nuevos[k] !== "");
  if (perdidos.length) return { ok: false, motivo: "se perdieron campos", perdidos };
  return { ok: true };
}

const igualEtiqueta = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/**
 * Deja la ubicación de la ficha en el destino pedido, POR ETIQUETA.
 *
 * ⚠️ Los `value` de departamento/municipio/distrito NO son un catálogo global:
 * el distrito `7` es «CHALATENANGO» en Chalatenango y «TEJUTEPEQUE» en Cabañas.
 * Copiar un código de otra ficha escribe un lugar ajeno — casi pasa el
 * 2026-08-09 sobre una ficha que alimenta documentos fiscales.
 *
 * Y por eso va en cascada releyendo entre paso y paso: la lista de municipios
 * depende del departamento YA GUARDADO, y la de distritos del municipio ya
 * guardado. Hasta que el padre no está escrito, el hijo no existe.
 */
export async function ponerUbicacion(
  cookie: string, erpId: string,
  destino: { departamento: string; municipio: string; distrito: string },
): Promise<{ ok: boolean; motivo?: string; antes?: string; despues?: string; pasos: string[]; cambios: number }> {
  const pasos: string[] = [];
  let cambios = 0;   // cuántos campos se ESCRIBIERON de verdad
  const retrato = (f: Ficha) => (["departamento", "municipio", "distrito"] as const)
    .map(c => Object.fromEntries(f.opciones[c] ?? [])[f.campos[c] ?? ""] ?? "(vacío)")
    .join(" / ");

  const antes = retrato(await leerFicha(cookie, erpId));

  for (const campo of ["departamento", "municipio", "distrito"] as const) {
    const { campos, opciones } = await leerFicha(cookie, erpId);
    const par = (opciones[campo] ?? []).find(([, etiqueta]) => igualEtiqueta(etiqueta, destino[campo]));
    if (!par) return { ok: false, pasos, antes, cambios, motivo: `«${destino[campo]}» no está entre las ${(opciones[campo] ?? []).length} opciones de ${campo}` };
    const [codigo, etiqueta] = par;
    if ((campos[campo] ?? "") === codigo) { pasos.push(`${campo} ya estaba en «${etiqueta}»`); continue; }
    const dependientes = campo === "departamento" ? ["municipio", "distrito"]
                       : campo === "municipio"    ? ["distrito"] : [];
    const w = await escribirCampos(cookie, erpId, { [campo]: codigo }, dependientes);
    if (!w.ok) return { ok: false, pasos, antes, cambios, motivo: `${campo}: ${w.motivo}` };
    pasos.push(`${campo} → «${etiqueta}»`);
    cambios++;
  }

  // Verificación final POR ETIQUETA: un código fuera de contexto no dice nada.
  const fin = await leerFicha(cookie, erpId);
  const despues = retrato(fin);
  const ok = (["departamento", "municipio", "distrito"] as const).every(c =>
    igualEtiqueta(Object.fromEntries(fin.opciones[c] ?? [])[fin.campos[c] ?? ""] ?? "", destino[c]));
  return { ok, pasos, antes, despues, cambios, motivo: ok ? undefined : `quedó ${despues}` };
}

// ── El teléfono de la ficha ──────────────────────────────────────────────────
//
// Hacienda exige un teléfono de receptor con forma —rechazó la 0000068683_COF
// con «Campo #/receptor/telefono no cumple el tamaño mínimo permitido»— y el
// dato no siempre está: medido el 2026-08-16, 26 de 27,907 fichas no tienen
// ninguno y ninguna tiene uno malformado.
//
// Cuando falta o no cumple, va el de la empresa. Es una decisión del usuario, no
// un invento: el documento tiene que poder transmitirse, y un teléfono de
// contacto real de la farmacia es preferible a inventar dígitos o a dejar la
// factura sin sello.
export const TELEFONO_DEFECTO = "23010013";

/**
 * ¿Esto es un teléfono que Hacienda va a aceptar? OCHO dígitos, ni más ni menos.
 *
 * Se miran los DÍGITOS, no la cadena: el ERP guarda «7556-5498» con guion y ese
 * formato es válido — lo que no lo es son el vacío, el `undefined` y los restos
 * de migración. Mismo criterio que `duiValido`: la FORMA del dato manda, no que
 * la columna no esté en null.
 */
export const telefonoValido = (tel: string | null | undefined): boolean =>
  /^\d{8}$/.test(String(tel ?? "").replace(/\D/g, ""));

/**
 * ¿Esto tiene forma de correo?
 *
 * OJO CON PARA QUÉ SIRVE: **no** decide si el correo de una ficha está bien.
 * Eso lo decide Hacienda, y su criterio es el único que importa — hubo un
 * rechazo de `receptor/correo` sobre una dirección que este patrón da por
 * buena. Se usa sólo para saber si un ARREGLO produjo algo con forma de correo
 * antes de escribirlo. Confundir las dos cosas sería volver a poner nuestro
 * juicio por encima del de quien rechaza.
 */
export const correoValido = (c: string | null | undefined): boolean =>
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/
    .test(String(c ?? "").trim());

/**
 * Deshace errores de TIPEO en un correo. Nunca inventa uno.
 *
 * Regla del usuario, 2026-08-24: «si no es .com y le han puesto .con o hay
 * espacios, lo corriges». La lista es corta a propósito y cada arreglo tiene
 * una causa evidente — un correo inventado es un dato de contacto falso, que es
 * exactamente el motivo por el que un DUI que no cumple se BORRA en vez de
 * reemplazarse. Acá vale lo mismo: se arregla lo que se puede leer como un
 * error de dedo, y lo demás no se toca.
 *
 * Devuelve el corregido y qué se le hizo. Si no había nada que arreglar,
 * devuelve el mismo valor y `arreglos` vacío — y ESO es la señal de que el
 * problema no es de tipeo y hay que decidir otra cosa.
 */
export function repararCorreo(raw: string | null | undefined): { valor: string; arreglos: string[] } {
  const original = String(raw ?? "");
  let v = original;
  const arreglos: string[] = [];

  // Los espacios —incluidos los de adentro— nunca son parte de un correo.
  if (/\s/.test(v)) { v = v.replace(/\s+/g, ""); arreglos.push("se le quitaron espacios"); }

  // Puntuación pegada al final: sobra siempre.
  if (/[.,;:]+$/.test(v)) { v = v.replace(/[.,;:]+$/, ""); arreglos.push("se le quitó la puntuación del final"); }

  // La coma donde va el punto del dominio. Sólo en esa posición: una coma en
  // otro lado no se sabe qué quiso ser.
  if (/,[A-Za-z]{2,}$/.test(v)) { v = v.replace(/,([A-Za-z]{2,})$/, ".$1"); arreglos.push("la coma del dominio pasó a punto"); }

  // El clásico. `.co` NO entra: es el dominio de Colombia y es válido.
  if (/\.con$/i.test(v)) { v = v.replace(/\.con$/i, ".com"); arreglos.push("«.con» pasó a «.com»"); }

  return { valor: v, arreglos };
}

/** Puerto de `dui_valido` de bloque.py (a su vez de src/utils/duiUtils.js). */
export function duiValido(dui: string | null | undefined): boolean | null {
  if (!dui || !dui.trim()) return null;              // vacío: no opina
  const d = dui.replace(/\D/g, "");
  if (d.length !== 9) return false;
  const dig = [...d].map(Number);
  const ver = dig.pop()!;
  const suma = dig.reduce((a, n, i) => a + n * (9 - i), 0);
  const calc = 10 - (suma % 10);
  return (calc === 10 ? 0 : calc) === ver;
}

// ── Espejo al portal ─────────────────────────────────────────────────────────
const CAMPO_A_COLUMNA: Record<string, string> = {
  nit: "nit", dui: "dui", nrc: "nrc", telefono1: "phone", telefono2: "telefono2",
  correo: "email", direccion: "direccion", pasaporte: "pasaporte",
};
const SELECT_A_COLUMNA: Record<string, string> = {
  departamento: "departamento", municipio: "municipio", distrito: "distrito",
  categoria: "categoria", sel_giro: "giro",
};

/**
 * La fila que va a `aplicar_espejo_erp`. NO toca `name`.
 *
 * `match_name` va CRUDO: el RPC le aplica la misma transliteración que la
 * columna generada `customers.search_name`. Replicarla acá fue el bug de la ñ
 * —614 clientes que nunca emparejaban— así que se manda el nombre tal cual y
 * el emparejamiento lo resuelve la base.
 *
 * `id` manda sobre `match_name` cuando viene: es un id exacto contra un nombre
 * normalizado.
 */
export function filaPortal(customerId: number | null, erpId: string, f: Ficha): Record<string, unknown> {
  const fila: Record<string, unknown> = {
    id: customerId ? `portal:${customerId}` : null,
    erp_id: String(erpId),
    match_name: f.campos.nombre ?? "",
  };
  for (const [campo, col] of Object.entries(CAMPO_A_COLUMNA))
    fila[col] = (f.campos[campo] ?? "").trim() || null;
  for (const [campo, col] of Object.entries(SELECT_A_COLUMNA)) {
    const etiquetas = Object.fromEntries(f.opciones[campo] ?? []);
    fila[col] = etiquetas[f.campos[campo] ?? ""] ?? null;
  }
  const pct = (Object.fromEntries(f.opciones.porcentaje ?? [])[f.campos.porcentaje ?? ""] ?? "")
    .replace(/\D/g, "");
  fila.retencion_pct = pct && Number(pct) <= 100 ? Number(pct) : null;
  return fila;
}

// ── Etiqueta del portal → value de un <select> de la caja ────────────────────
//
// Vivía en `push-cliente-erp/index.ts`; se trajo acá el 2026-11-15 porque el
// alta (`alta-cliente-erp`) necesita exactamente la misma traducción, y dos
// copias de esta tabla son cómo una se queda atrás.

export const sinTildes = (s: string) => (s ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

// El ERP TRUNCA los nombres de distrito para que entren en su campo, así que
// ninguna normalización saca "SN MIG MERCEDES" de "San Miguel de Mercedes".
// Es el reverso de la tabla de `src/data/elSalvadorGeo.js`; está duplicada
// porque son dos runtimes distintos y no hay bundling entre ellos. Si se agrega
// una fila allá, agregarla acá.
export const ABREVIATURAS_ERP: Record<string, string> = {
  "DULCE NOMBRE DE MARIA": "DULCE NOM MARIA",
  "NUEVA CONCEPCION": "NVA CONCEPCION",
  "SAN ANTONIO DE LA CRUZ": "SAN ANT LA CRUZ",
  "SAN ANTONIO LOS RANCHOS": "SAN ANT RANCHOS",
  "SAN ISIDRO LABRADOR": "SAN I LABRADOR",
  "SAN JOSE CANCASQUE": "SAN J CANCASQUE",
  "LAS FLORES": "SAN JOSE FLORES",
  "SAN LUIS DEL CARMEN": "SAN LUIS CARMEN",
  "SAN PABLO TACACHICO": "SAN P TACACHICO",
  "SAN MIGUEL DE MERCEDES": "SN MIG MERCEDES",
};

/** Etiqueta del portal → value de la caja. `null` = no se pudo resolver, y
 *  entonces el campo NO viaja: inventar un distrito en una ficha fiscal es
 *  exactamente lo que este proyecto tiene prohibido. */
export function valorDeSelect(lista: [string, string][] | undefined, etiqueta: string): string | null {
  const opciones = lista ?? [];
  const objetivo = sinTildes(etiqueta);
  if (!objetivo) return "";                              // vaciar es una intención válida
  for (const [value, texto] of opciones) if (sinTildes(texto) === objetivo) return value;
  const abrev = ABREVIATURAS_ERP[objetivo];
  if (abrev) for (const [value, texto] of opciones) if (sinTildes(texto) === abrev) return value;
  // `porcentaje` rotula '10%' y el portal guarda 10.
  for (const [value, texto] of opciones) if (texto.replace(/\D/g, "") === objetivo) return value;
  return null;
}

/** Las <option> sueltas que devuelve `_helpers.php` → pares [value, etiqueta]. */
function opcionesDeHtml(html: string): [string, string][] {
  const out: [string, string][] = [];
  for (const o of html.matchAll(/<option([^>]*)>\s*([^<]*)/g)) {
    const value = o[1].match(/value\s*=\s*["']([^"']*)/)?.[1] ?? "";
    if (value !== "" && value !== "-1") out.push([value, desescapar(o[2]).trim()]);
  }
  return out;
}

// ── Buscar en la lista de clientes de la caja ────────────────────────────────
//
// `admin_cliente_dt.php` es la tabla de la pantalla de clientes (DataTables,
// lado servidor). Busca por contenido en todas las columnas y sin distinguir
// tildes (MUNOZ trae MUÑOZ). Columnas medidas el 2026-11-15:
// [id, nombre, dui, categoria, nit, nrc, telefono, menú]. El DUI sólo se
// encuentra escrito con guion (00000000-0), igual que se guarda.

export interface FilaCaja { id: string; nombre: string; dui: string; categoria: string; nit: string; nrc: string; telefono: string }

export async function buscarEnCaja(cookie: string, texto: string): Promise<FilaCaja[]> {
  const q = new URLSearchParams({
    draw: "1", start: "0", length: "25", "search[value]": texto, "search[regex]": "false",
    "order[0][column]": "0", "order[0][dir]": "asc",
  });
  for (let i = 0; i < 8; i++) {
    q.set(`columns[${i}][data]`, String(i));
    q.set(`columns[${i}][searchable]`, "true");
    q.set(`columns[${i}][orderable]`, "true");
    q.set(`columns[${i}][search][value]`, "");
  }
  const cruda = await pedir(cookie, `${BASE}/admin_cliente_dt.php`, q);
  let d: { data?: string[][] };
  try { d = JSON.parse(cruda); } catch { throw new Error(`la búsqueda de clientes no devolvió JSON: ${cruda.slice(0, 120)}`); }
  return (d.data ?? [])
    .filter(r => /^\d+$/.test(String(r[0] ?? "")) && Number(r[0]) > 0)
    .map(r => ({ id: String(r[0]), nombre: desescapar(String(r[1] ?? "")), dui: String(r[2] ?? ""),
                 categoria: String(r[3] ?? ""), nit: String(r[4] ?? ""), nrc: String(r[5] ?? ""),
                 telefono: String(r[6] ?? "") }));
}

// ── El alta ──────────────────────────────────────────────────────────────────
//
// Es el formulario de cliente nuevo del punto de venta (`modal_new_cliente.php`,
// leído el 2026-11-15): POST a `procesos/clientes.php` con `process=insert`,
// `id_cliente=0`, y contesta `{typeinfo, msg, id_cliente}`. Los mismos campos
// que la edición más `fecha1` (nacimiento, yyyy-mm-dd) y `hi_retiene`.
// Departamento, categoría y retención vienen en el formulario; municipio y
// distrito se piden a `_helpers.php` (dependen del padre); el giro a
// `getGiro.php` (`searchTerm`).

export interface FichaPortal {
  name: string; nit?: string | null; dui?: string | null; nrc?: string | null;
  pasaporte?: string | null; phone?: string | null; telefono2?: string | null;
  email?: string | null; direccion?: string | null; departamento?: string | null;
  municipio?: string | null; distrito?: string | null; categoria?: string | null;
  giro?: string | null; retencion_pct?: number | null; fecha_nacimiento?: string | null;
}

export async function armarAlta(cookie: string, f: FichaPortal):
  Promise<{ payload: URLSearchParams; sinResolver: string[] }> {
  const form = parsearFicha(await pedir(cookie, `${BASE}/modal_new_cliente.php`));
  const sinResolver: string[] = [];
  const sel = (campo: string, lista: [string, string][] | undefined, etiqueta: string | null | undefined) => {
    if (!etiqueta) return "";
    const v = valorDeSelect(lista, etiqueta);
    if (v === null) { sinResolver.push(`${campo} «${etiqueta}»`); return ""; }
    return v;
  };

  const departamento = sel("departamento", form.opciones.departamento, f.departamento);
  let municipio = "", distrito = "";
  if (departamento && f.municipio) {
    const munis = opcionesDeHtml(await pedir(cookie, `${BASE}/_helpers.php`,
      new URLSearchParams({ process: "getMunicipio", id_departamento: departamento })));
    municipio = sel("municipio", munis, f.municipio);
    if (municipio && f.distrito) {
      const dists = opcionesDeHtml(await pedir(cookie, `${BASE}/_helpers.php`,
        new URLSearchParams({ process: "getDistrito", id_departamento: departamento, id_municipio: municipio })));
      distrito = sel("distrito", dists, f.distrito);
    }
  }

  let giro = "";
  if (f.giro) {
    const cruda = await pedir(cookie, `${BASE}/getGiro.php`, new URLSearchParams({ searchTerm: f.giro }));
    let lista: { id: string; text: string }[] = [];
    try { lista = JSON.parse(cruda); } catch { /* sin lista: queda sin resolver */ }
    giro = sel("giro", lista.map(g => [String(g.id), String(g.text)] as [string, string]), f.giro);
  }

  const pct = f.retencion_pct ? String(f.retencion_pct) : "";
  const porcentaje = pct ? (sel("retención", form.opciones.porcentaje, pct) || "0") : "0";

  const payload = new URLSearchParams({
    id_cliente: "0",
    nombre: f.name,                                   // crudo: el control de repetidos de la caja compara tal cual
    direccion: f.direccion ?? "",
    apunte: "",
    departamento: departamento || "-1",
    municipio, distrito,
    categoria: sel("categoría", form.opciones.categoria, f.categoria || "Consumidor") || "1",
    sel_giro: giro,
    dui: f.dui ?? "", nit: f.nit ?? "", nrc: f.nrc ?? "",
    telefono1: f.phone ?? "", telefono2: f.telefono2 ?? "",
    correo: f.email ?? "",
    fecha1: f.fecha_nacimiento ? String(f.fecha_nacimiento).slice(0, 10) : "",
    pasaporte: f.pasaporte ?? "",
    hi_retiene: porcentaje !== "0" ? "1" : "0",
    porcentaje,
    process: "insert",
  });
  return { payload, sinResolver };
}

export async function darDeAlta(cookie: string, payload: URLSearchParams):
  Promise<{ ok: boolean; id?: string; motivo?: string }> {
  const cruda = await pedir(cookie, `${BASE}/procesos/clientes.php`, payload);
  let resp: { typeinfo?: string; msg?: string; id_cliente?: string | number };
  try { resp = JSON.parse(cruda); } catch { return { ok: false, motivo: `respuesta sin JSON: ${cruda.slice(0, 200)}` }; }
  if (resp.typeinfo !== "Success") return { ok: false, motivo: resp.msg ?? resp.typeinfo ?? "rechazo sin motivo" };
  const id = String(resp.id_cliente ?? "").trim();
  return /^\d+$/.test(id) && Number(id) > 0 ? { ok: true, id } : { ok: true, motivo: "aceptó pero no devolvió el número" };
}
