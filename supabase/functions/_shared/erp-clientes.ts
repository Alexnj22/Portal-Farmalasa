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
): Promise<{ ok: boolean; motivo?: string; antes?: string; despues?: string; pasos: string[] }> {
  const pasos: string[] = [];
  const retrato = (f: Ficha) => (["departamento", "municipio", "distrito"] as const)
    .map(c => Object.fromEntries(f.opciones[c] ?? [])[f.campos[c] ?? ""] ?? "(vacío)")
    .join(" / ");

  const antes = retrato(await leerFicha(cookie, erpId));

  for (const campo of ["departamento", "municipio", "distrito"] as const) {
    const { campos, opciones } = await leerFicha(cookie, erpId);
    const par = (opciones[campo] ?? []).find(([, etiqueta]) => igualEtiqueta(etiqueta, destino[campo]));
    if (!par) return { ok: false, pasos, antes, motivo: `«${destino[campo]}» no está entre las ${(opciones[campo] ?? []).length} opciones de ${campo}` };
    const [codigo, etiqueta] = par;
    if ((campos[campo] ?? "") === codigo) { pasos.push(`${campo} ya estaba en «${etiqueta}»`); continue; }
    const dependientes = campo === "departamento" ? ["municipio", "distrito"]
                       : campo === "municipio"    ? ["distrito"] : [];
    const w = await escribirCampos(cookie, erpId, { [campo]: codigo }, dependientes);
    if (!w.ok) return { ok: false, pasos, antes, motivo: `${campo}: ${w.motivo}` };
    pasos.push(`${campo} → «${etiqueta}»`);
  }

  // Verificación final POR ETIQUETA: un código fuera de contexto no dice nada.
  const fin = await leerFicha(cookie, erpId);
  const despues = retrato(fin);
  const ok = (["departamento", "municipio", "distrito"] as const).every(c =>
    igualEtiqueta(Object.fromEntries(fin.opciones[c] ?? [])[fin.campos[c] ?? ""] ?? "", destino[c]));
  return { ok, pasos, antes, despues, motivo: ok ? undefined : `quedó ${despues}` };
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
