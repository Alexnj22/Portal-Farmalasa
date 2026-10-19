// ─── La app de clientes ─────────────────────────────────────────────────────
//
// La puerta del teléfono del CLIENTE. Hermana de `mis-puntos`, con una
// diferencia que lo cambia todo: aquélla pide documento + teléfono en cada
// consulta; ésta los pide UNA vez y devuelve una sesión.
//
// ── La sesión ───────────────────────────────────────────────────────────────
// Un token opaco de 32 bytes que vive en el llavero del teléfono. En la base
// sólo queda su HUELLA (`app_cliente_sesiones.token_hash`): una copia de la
// tabla no sirve para entrar. Caduca a los 180 días sin uso, la revoca «Cerrar
// sesión» o «Borrar mi cuenta», y la sala puede revocarla al descartar un
// pre-registro. El `customer_id` sale SIEMPRE de la sesión, nunca del cuerpo:
// nadie consulta otra ficha cambiando un número.
//
// ── Las mismas tres reglas que `mis-puntos` ─────────────────────────────────
//   1. Freno por IP (`puntos_consulta_registrar`): el mismo contador, así que
//      probar en la web y en la app suma contra el mismo tope.
//   2. «No encontrado» es una sola respuesta para todo lo que no coincidió.
//   3. El documento no se archiva en el registro de intentos, sólo su huella.
//
// ── El pre-registro ─────────────────────────────────────────────────────────
// Quien no tiene ficha puede dejar sus datos. NO se crea la ficha: nace en el
// sistema de la caja cuando la sala lo registra, y la siguiente consulta de la
// app la encuentra sola con el MISMO documento y teléfono (`vincularSiSePuede`).
// Mientras tanto la app muestra «tu registro está pendiente».
//
// ── Lo que NO hace, a propósito ─────────────────────────────────────────────
// No canjea puntos, no edita la ficha, no devuelve el documento ni el teléfono.
// Todo lo que escribe es reversible o es del propio cliente: sus permisos, su
// aviso al teléfono, su sesión.
import { createClient } from "npm:@supabase/supabase-js@2";
import { TEXTOS_CONSENTIMIENTO as TEXTOS } from "../_shared/consentimientoPuntos.ts";
import { clienteDelEnlace, enlaceDePase, paseDeCliente } from "../_shared/pase.ts";
import { enlaceGoogleWallet, googleWalletListo } from "../_shared/paseGoogle.ts";
import { escaleraDeNiveles, nivelDeCliente, programaParaApp } from "../_shared/nivel.ts";
import { validarFiscales } from "../_shared/fiscal.ts";
import { calentarWompi, crearEnlace } from "../_shared/wompi.ts";
import { mensajePush } from "../_shared/avisoPrivado.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TOPE_FALLOS = 8;
const TOPE_FALLOS_CODIGO = 5;
const ES_CODIGO = /^[ACDEFGHJKMNPQRTUVWXY34679]{7}$/;
const DIAS_SESION = 180;
const POR_PAGINA_INICIAL = 10;
const POR_PAGINA = 20;
// El cupón del mes (2026-10-14): `puntos_estado_cuenta` lo trae como «compra»
// (su CASE no conoce el origen 'cupon'), pero sus puntos vencen a fin de mes y
// la app tiene que decirlo. Se reconoce por el motivo que escribe
// `puntos_dar_cupones` («Cupón <nivel> del mes»).
// deno-lint-ignore no-explicit-any
const tipoDeMovimiento = (m: any) => (m.tipo === "compra" && /^Cup[oó]n .* del mes$/.test(String(m.motivo ?? "")) ? "cupon" : m.tipo);

// Las condiciones de la reserva, tal como las lee el cliente. Cambiar el texto
// exige cambiar la `version`: la app vuelve a pedir que las acepte y cada
// reserva guarda la versión que aceptó.
// El WhatsApp de contacto de la empresa (número global), con código de país.
const WHATSAPP_EMPRESA = "50323010013";

const TERMINOS_RESERVA = {
  // 2026-10-09: + quién puede retirar (el código compartido). Cambiar la versión
  // vuelve a pedir la aceptación la próxima vez que se reserve.
  // 2026-10-12: los productos bajo receta YA se reservan, con foto de la receta
  // que revisa la sucursal antes de confirmar.
  version: "2026-10-12",
  titulo: "Así funciona tu reserva",
  puntos: [
    "Por ahora puedes reservar productos que estén en oferta.",
    "Te avisamos cuando la sucursal la tenga lista. Desde ese aviso tienes 24 horas para retirarla.",
    "El precio de oferta vale si la retiras dentro de las fechas de la oferta.",
    "Puedes tener hasta 3 reservas activas y hasta 5 unidades por producto.",
    "Si no la retiras a tiempo, el producto vuelve a la venta. Con 3 reservas sin retirar en 30 días, no podrás reservar por 30 días.",
    "Los productos bajo receta se reservan con una foto de tu receta. La sucursal la revisa y, cuando la aprueba, tu reserva queda confirmada. Mientras está en revisión no se puede pagar, y si el pedido lleva algún producto bajo receta, todo el pedido espera esa revisión.",
    "Puedes pagarla en línea desde la app o al retirarla en la sucursal.",
    "Si la pagaste en línea, tienes 7 días para retirarla desde que esté lista. Pasado ese plazo el producto vuelve a la venta, pero tu pago se conserva y la sucursal la aparta de nuevo cuando vengas.",
    "Una reserva pagada en línea no se cancela desde la app: escríbele a la sucursal.",
    "Si no puedes ir tú, comparte el código de tu reserva (desde Mis reservas) con alguien de confianza: quien lo presente en la sucursal puede retirarla, y pagarla si falta. Como el código basta para retirarla, no lo publiques.",
  ],
};

// Cómo se llama cada sucursal PARA EL CLIENTE (decisión del usuario,
// 2026-10-06): el barrio, no el número interno. Lo demás pasa tal cual.
const NOMBRE_SUCURSAL: Record<string, string> = {
  "Salud 1": "La Salud - San Antonio",
  "Salud 2": "La Salud - El Calvario",
  "Salud 3": "La Salud - Totolco",
  "Salud 4": "La Salud - El Paraíso",
  "Salud 5": "La Salud - Nueva Concepción",
};
const sucursal = (n: unknown) => (n == null ? n : NOMBRE_SUCURSAL[String(n)] ?? String(n));
// deno-lint-ignore no-explicit-any
const conSucursal = (x: any): any =>
  Array.isArray(x) ? x.map(conSucursal)
  : x && typeof x === "object"
    ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, k === "sala" ? sucursal(v) : conSucursal(v)]))
    : x;

// Las MUESTRAS de una ficha (`app_cliente_muestras`, 2026-10-06): ofertas,
// inyecciones y vencimientos de muestra que sólo ve esa persona, para revisar
// el diseño con datos que producción no tiene. Nunca tumban la respuesta: si
// no se pueden leer, la app se ve con lo real y nada más.
// deno-lint-ignore no-explicit-any
async function muestrasDe(admin: any, customerId: number | null, tipo: string): Promise<any[]> {
  if (!customerId) return [];
  const { data, error } = await admin.from("app_cliente_muestras")
    .select("id, datos").eq("customer_id", customerId).eq("tipo", tipo).order("id");
  if (error) { console.error("no se pudieron leer las muestras:", error.message); return []; }
  // deno-lint-ignore no-explicit-any
  return (data ?? []).map((m: any) => ({ id: m.id, ...m.datos }));
}
// ── Archivos del cliente (2026-10-12): receta, chat y foto de perfil ───────
// Bucket PRIVADO. La app nunca elige la ruta: pide una URL de subida firmada
// (la ruta la arma el servidor con la ficha de la sesión), sube, y confirma.
// Al confirmar se vuelve a comprobar la ruta Y que el archivo exista: sin eso,
// se podría «confirmar» una receta que nunca se subió.
const BUCKET_ARCHIVOS = "app-clientes-archivos";
// deno-lint-ignore no-explicit-any
async function urlDeSubida(admin: any, ruta: string) {
  const { data, error } = await admin.storage.from(BUCKET_ARCHIVOS).createSignedUploadUrl(ruta, { upsert: true });
  if (error) throw error;
  return { ok: true, url: data.signedUrl as string, token: data.token as string, ruta };
}
// deno-lint-ignore no-explicit-any
async function archivoExiste(admin: any, ruta: string): Promise<boolean> {
  const corte = ruta.lastIndexOf("/");
  const carpeta = ruta.slice(0, corte), nombre = ruta.slice(corte + 1);
  const { data, error } = await admin.storage.from(BUCKET_ARCHIVOS).list(carpeta, { limit: 10, search: nombre });
  if (error) throw error;
  // deno-lint-ignore no-explicit-any
  return (data ?? []).some((f: any) => f.name === nombre);
}
// Lo que «borrar mi cuenta» se lleva de la ficha (2026-10-17). Apple
// (5.1.1(v)) pide borrar los datos de la cuenta, y la ficha fiscal se conserva
// porque la ley obliga; pero la foto de perfil, el chat y las fotos de receta
// no tienen esa razón. Tres reglas, cada una con su motivo:
//   · Foto de perfil: se borra entera (fila y archivo).
//   · Chat: se borra el CONTENIDO (texto, fotos, productos adjuntos) y el
//     archivo de cada foto, pero la conversación y sus renglones quedan con
//     «Mensaje borrado»: de ellos cuelgan `app_chat_incumplimientos`, la
//     medida de cuánto tardó el equipo en contestar, que es del personal y no
//     del cliente. Borrar la conversación los borraría en cascada.
//   · Recetas: se borran las de reservas que NO se entregaron (vencida,
//     cancelada, o receta rechazada). La de una reserva RETIRADA respalda una
//     dispensación bajo receta y se conserva; la de una reserva todavía en
//     curso también, porque la sala la está usando para decidir.
// Si un archivo no se puede borrar del almacenamiento, la cuenta se borra
// igual y queda en el registro: el cliente no puede quedarse sin poder irse
// por un archivo.
// deno-lint-ignore no-explicit-any
async function borrarLoPersonal(admin: any, customerId: number) {
  const archivos: string[] = [];
  // Una carpeta entera del bucket (las fotos del chat y las de una receta,
  // que se suben numeradas y sólo la última queda anotada en la fila).
  const deCarpeta = async (carpeta: string) => {
    const { data, error } = await admin.storage.from(BUCKET_ARCHIVOS).list(carpeta, { limit: 500 });
    if (error) { console.error(`borrar_cuenta: no se pudo listar ${carpeta}:`, error.message); return; }
    // deno-lint-ignore no-explicit-any
    for (const f of data ?? []) if (f?.name && f.id) archivos.push(`${carpeta}/${f.name}`);
  };

  const { data: foto, error: eF } = await admin.from("app_cliente_fotos").select("ruta").eq("customer_id", customerId).maybeSingle();
  if (eF) throw eF;
  if (foto?.ruta) archivos.push(foto.ruta);
  const { error: eFd } = await admin.from("app_cliente_fotos").delete().eq("customer_id", customerId);
  if (eFd) throw eFd;

  const { data: conv, error: eC } = await admin.from("app_chat_conversaciones").select("id").eq("customer_id", customerId).maybeSingle();
  if (eC) throw eC;
  if (conv) {
    // Una conversación es de UNA persona: cabe en un tope generoso, y si
    // alguna vez no cabe, la vuelta siguiente del mismo botón termina.
    const { data: fotos, error: eM } = await admin.from("app_chat_mensajes").select("foto_ruta")
      .eq("conversacion_id", conv.id).not("foto_ruta", "is", null).limit(5000);
    if (eM) throw eM;
    // deno-lint-ignore no-explicit-any
    for (const m of fotos ?? []) archivos.push((m as any).foto_ruta);
    const { error: eU } = await admin.from("app_chat_mensajes")
      .update({ texto: "Mensaje borrado", foto_ruta: null, adjunto: null }).eq("conversacion_id", conv.id);
    if (eU) throw eU;
  }
  await deCarpeta(`chat/${customerId}`);

  const { data: rs, error: eR } = await admin.from("app_reservas").select("id, branch_id, estado, receta_estado")
    .eq("customer_id", customerId).not("receta_ruta", "is", null).limit(500);
  if (eR) throw eR;
  // deno-lint-ignore no-explicit-any
  // Una receta APROBADA no se borra nunca (2026-10-19, decisión 8): es el
  // respaldo de lo que se despachó bajo receta y la consulta el libro
  // (`receta_app_de_dispensacion`). Sólo se borran las que nunca valieron.
  const sinEntregar = (rs ?? []).filter((r: any) => r.receta_estado !== "aprobada"
    && (r.estado === "vencida" || r.estado === "cancelada" || r.receta_estado === "rechazada"));
  for (const r of sinEntregar) await deCarpeta(`recetas/${Number(r.branch_id)}/${Number(r.id)}`);
  if (sinEntregar.length) {
    // deno-lint-ignore no-explicit-any
    const { error: eRu } = await admin.from("app_reservas").update({ receta_ruta: null }).in("id", sinEntregar.map((r: any) => r.id));
    if (eRu) throw eRu;
  }

  const unicos = [...new Set(archivos.filter(Boolean))];
  for (let i = 0; i < unicos.length; i += 500) {
    const { error } = await admin.storage.from(BUCKET_ARCHIVOS).remove(unicos.slice(i, i + 500));
    if (error) console.error(`borrar_cuenta: ${unicos.length} archivo(s) de la ficha ${customerId} sin borrar:`, error.message);
  }
}
/** Firma varias rutas de un bucket privado; las que fallan quedan fuera del mapa. */
// deno-lint-ignore no-explicit-any
async function firmarRutas(admin: any, bucket: string, rutas: string[], segundos = 3600): Promise<Map<string, string>> {
  const unicas = [...new Set(rutas.filter(Boolean))];
  const firmadas = new Map<string, string>();
  if (!unicas.length) return firmadas;
  const { data, error } = await admin.storage.from(bucket).createSignedUrls(unicas, segundos);
  if (error) { console.error(`no se pudieron firmar archivos de ${bucket}:`, error.message); return firmadas; }
  for (const f of data ?? []) if (f.path && f.signedUrl && !f.error) firmadas.set(f.path, f.signedUrl);
  return firmadas;
}
// Las fotos de ofertas, historias, banners y sucursales (bucket
// `ofertas-clientes`), firmadas por 12 h y GUARDADAS en la instancia
// (2026-10-14): firmarlas en cada apertura costaba un viaje a Storage —el más
// lento de la cadena de Ofertas— y daba una URL nueva cada vez, así que el
// teléfono volvía a bajar la misma foto. Se reusa la firma mientras le queden
// más de 2 h; con eso la URL es la misma entre aperturas y la caché de
// imágenes del teléfono la reconoce.
const FIRMA_SEG = 12 * 3600;
// Una sola guarda para todos los buckets (2026-10-15): la clave es
// `bucket/ruta`, así que dos buckets con la misma ruta no se pisan. El chat la
// usa también (fotos de mensajes y del equipo): cada sondeo de 5 s volvía a
// firmar todo y la URL cambiaba en cada uno.
const firmasGuardadas = new Map<string, { url: string; vence: number }>();
/** Como `firmarRutas`, pero reusa la firma mientras le quede más de `margenSeg`. */
// deno-lint-ignore no-explicit-any
async function firmarGuardando(admin: any, bucket: string, rutas: string[], segundos: number, margenSeg: number): Promise<Map<string, string>> {
  const ahora = Date.now();
  const firmadas = new Map<string, string>();
  const faltan: string[] = [];
  for (const r of new Set(rutas.filter(Boolean))) {
    const g = firmasGuardadas.get(`${bucket}/${r}`);
    if (g && g.vence - ahora > margenSeg * 1000) firmadas.set(r, g.url); else faltan.push(r);
  }
  if (!faltan.length) return firmadas;
  const { data, error } = await admin.storage.from(bucket).createSignedUrls(faltan, segundos);
  if (error) { console.error(`no se pudieron firmar archivos de ${bucket}:`, error.message); return firmadas; }
  if (firmasGuardadas.size > 2000) firmasGuardadas.clear(); // tope de memoria
  for (const f of data ?? []) {
    if (!f.path || !f.signedUrl || f.error) continue;
    firmadas.set(f.path, f.signedUrl);
    firmasGuardadas.set(`${bucket}/${f.path}`, { url: f.signedUrl, vence: ahora + segundos * 1000 });
  }
  return firmadas;
}
// deno-lint-ignore no-explicit-any
const firmarOfertas = (admin: any, rutas: string[]) => firmarGuardando(admin, "ofertas-clientes", rutas, FIRMA_SEG, 2 * 3600);
// Las del chat (bucket privado del cliente y fotos del equipo): 6 h, reusadas
// mientras les quede más de 1 h — una conversación abierta no se queda con
// una URL vencida entre dos sondeos.
// deno-lint-ignore no-explicit-any
const firmarChat = (admin: any, bucket: string, rutas: string[]) => firmarGuardando(admin, bucket, rutas, 6 * 3600, 3600);

// Las sucursales (id, nombre, dirección, tipo, código de puntos), guardadas
// 5 min por instancia (2026-10-15), como `horarioFarmacia`: el resumen, los
// movimientos, las reservas, las ofertas y la ficha de producto las leían en
// cada llamada y cambian una vez al año. Devuelve `{ data, error }` para que
// cada lector conserve su manejo del error; un error no se guarda.
// deno-lint-ignore no-explicit-any
let salasCache: { en: number; v: any[] } | null = null;
// deno-lint-ignore no-explicit-any
async function salasDeLaRed(admin: any): Promise<{ data: any[] | null; error: any }> {
  if (salasCache && Date.now() - salasCache.en < 5 * 60_000) return { data: salasCache.v, error: null };
  const { data, error } = await admin.from("branches").select("id, name, address, type, codigo_puntos");
  if (error) return { data: null, error };
  salasCache = { en: Date.now(), v: data ?? [] };
  return { data: salasCache.v, error: null };
}

// Unidades DISPONIBLES por sucursal (2026-10-15, «¿dónde lo hay?»; desde el
// 2026-10-19, lo apartado ya restado). La cuenta vive en la base,
// `app_existencias_netas`: existencia en UNIDADES —una fila de `inventory` por
// presentación y lote, pasada a unidades con `v_product_factor`, sin factor
// el «x N» del detalle, y deduplicada como `inv_dedup`— menos las unidades de
// las reservas abiertas de esa sala (en revisión, pendientes y listas). Antes
// esta cuenta se hacía acá a mano y no restaba lo apartado: dos clientes podían
// reservar y pagar la última caja. Devuelve JSON (no SETOF): sin techo de 1000.
// Con `existencia` además trae la cuenta bruta y lo apartado, para el control
// de cobro (FIFO) de `pagar_reserva`.
// deno-lint-ignore no-explicit-any
async function existenciasNetas(admin: any, ids: number[]): Promise<{ product_id: number; branch_id: number; existencia: number; apartadas: number; disponibles: number }[]> {
  const unicos = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  if (!unicos.length) return [];
  const { data, error } = await admin.rpc("app_existencias_netas", { p_ids: unicos });
  if (error) throw error;
  // deno-lint-ignore no-explicit-any
  return ((data ?? []) as any[]).map((x) => ({
    product_id: Number(x.product_id), branch_id: Number(x.branch_id),
    existencia: Number(x.existencia) || 0, apartadas: Number(x.apartadas) || 0, disponibles: Number(x.disponibles) || 0,
  }));
}
// deno-lint-ignore no-explicit-any
async function unidadesPorSala(admin: any, ids: number[]): Promise<Map<number, Map<number, number>>> {
  const out = new Map<number, Map<number, number>>();
  for (const x of await existenciasNetas(admin, ids)) {
    if (!out.has(x.product_id)) out.set(x.product_id, new Map());
    out.get(x.product_id)!.set(x.branch_id, x.disponibles);
  }
  return out;
}

// Bajo receta (2026-10-19): la MISMA regla del libro (`clase_de_dispensacion`),
// contestada en UN sitio de la base (`app_productos_bajo_receta`) para
// reservar, el carrito, los encargos y las existencias. Antes cada acción
// preguntaba `es_antibiotico || requiere_receta` por su cuenta, y eso no ve lo
// que la sala marcó como bajo receta en el catálogo del libro. Además el
// trigger `app_reservas_guardas` lo vuelve a decidir al insertar la reserva.
// deno-lint-ignore no-explicit-any
async function bajoReceta(admin: any, ids: number[]): Promise<Set<number>> {
  const unicos = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  if (!unicos.length) return new Set();
  const { data, error } = await admin.rpc("app_productos_bajo_receta", { p_ids: unicos });
  if (error) throw error;
  return new Set(((data ?? []) as unknown[]).map(Number));
}

// Cuántas de una presentación alcanzan en una sala, con tope en 5 (lo más que
// se pide de una): la app no muestra existencias exactas, sólo si alcanza para
// lo que la persona pide o hasta dónde llega.
const TOPE_ALCANCE = 5;
const alcanceDe = (unidades: number, factor: number) => Math.max(0, Math.min(TOPE_ALCANCE, Math.floor(unidades / Math.max(1, factor || 1))));
// La foto de un empleado se guarda como URL «formato público» del bucket
// privado `empleados` (regla 10 del CLAUDE.md): se saca el bucket y la ruta
// para firmarla, igual que `getSignedFileUrl` del portal.
const RUTA_STORAGE = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+?)(?:\?.*)?$/;
// Nombre corto (primer nombre + primer apellido), el canon de `shortEmployeeName`.
// deno-lint-ignore no-explicit-any
const nombreCortoEmpleado = (e: any) => {
  const primero = (s: unknown) => String(s ?? "").trim().split(/\s+/)[0] ?? "";
  const n = primero(e?.first_names), a = primero(e?.last_names);
  if (n || a) return `${n} ${a}`.trim();
  const p = String(e?.name ?? "").trim().split(/\s+/).filter(Boolean);
  return p.length <= 2 ? p.join(" ") : `${p[0]} ${p[2]}`;
};
// Horario de atención del chat (2026-10-12, decisión del usuario): el de las
// SUCURSALES, no un número fijo — `farmacia_estado()` junta los horarios de
// todas (horario especial del día > feriado con horario de domingo > semana).
// Abierta si al menos una lo está. Se guarda un minuto por instancia.
// deno-lint-ignore no-explicit-any
let estadoCache: { en: number; v: any } | null = null;
const horaBonita = (hm: string | null) => {
  if (!hm) return null;
  const [h, m] = hm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`;
};
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
// deno-lint-ignore no-explicit-any
async function horarioFarmacia(admin: any) {
  if (!estadoCache || Date.now() - estadoCache.en > 60_000) {
    const { data, error } = await admin.rpc("farmacia_estado");
    if (error) {
      console.error("farmacia_estado:", error.message);
      // Sin el dato, se supone abierta de 7 a 22 (lo que era fijo antes).
      const h = new Date(Date.now() - 6 * 3600_000).getUTCHours();
      return { abierta: h >= 7 && h < 22, cierra: "10:00 p. m.", abre: "a las 7:00 a. m.", feriado: null, texto: "" };
    }
    estadoCache = { en: Date.now(), v: data };
  }
  const e = estadoCache.v ?? {};
  const cierra = horaBonita(e.cierra);
  let abre: string | null = null;
  if (e.abre) {
    const [fecha, hm] = String(e.abre).split("T");
    const hoy = hoySV();
    const manana = new Date(Date.parse(`${hoy}T12:00:00Z`) + 86400_000).toISOString().slice(0, 10);
    const dia = fecha === hoy ? "hoy" : fecha === manana ? "mañana" : `el ${DIAS[new Date(`${fecha}T12:00:00Z`).getUTCDay()]}`;
    abre = `${dia} a las ${horaBonita(hm)}`;
  }
  const texto = e.abierta
    ? `Atendemos hasta las ${cierra}${e.feriado ? ` (${e.feriado})` : ""}. Te respondemos en unos minutos.`
    : `Escríbenos igual: te responderemos a la brevedad cuando abramos${abre ? `, ${abre}` : ""}.`;
  return { abierta: !!e.abierta, cierra, abre, feriado: e.feriado ?? null, texto };
}

const VERSION_AVISO = `${TEXTOS.version} · ${TEXTOS.aviso}`;

// Las versiones VIGENTES de los dos documentos que la app pide leer y aceptar
// en el primer inicio (2026-10-14, app/guia.js). El reglamento lleva la fecha
// de su «Vigente a partir del…» (public/reglamento-puntos.html) y el aviso es
// el mismo `TEXTOS.aviso` del consentimiento. Subir una de las dos = la app le
// vuelve a pedir la aceptación (sólo esa página) a todo el mundo.
const DOCUMENTOS_VIGENTES = { reglamento: "reglamento-2026-10-01", aviso: TEXTOS.aviso };

// Para el alta que no se puede hacer desde la app (el documento ya tiene un
// registro pendiente con otro teléfono). No dice por qué: confirmar que ese
// documento está registrado sería regalar el dato.
const NO_SE_PUDO_REGISTRAR = {
  ok: false,
  motivo: "no_se_pudo",
  mensaje: "No pudimos registrarte desde la app. Pasa a cualquiera de nuestras salas y te ayudamos.",
};

/** 'AAAA-MM-DD' de una fecha REAL entre 1900 y hoy; null si viene vacía; false si es inválida. */
function fechaDeNacimiento(v: unknown): string | null | false {
  const t = String(v ?? "").trim();
  if (!t) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const real = d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  if (!real || +m[1] < 1900 || d.getTime() > Date.now()) return false;
  return t;
}

const NO_ENCONTRADO = {
  ok: false,
  motivo: "no_encontrado",
  mensaje: "No encontramos ese registro. Revisa los datos.",
};

// La misma regla que `public.venta_valida(estado)`: anulada o invalidada no cuenta.
const venta_valida_js = (estado: unknown) => !["NULA", "DTE INVALIDADO EN MH"].includes(String(estado ?? "").toUpperCase());

async function sha256(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Misma huella que `mis-puntos`, para que el freno cuente igual en las dos.
const huellaDoc = async (doc: string) => (await sha256(`puntos:${doc}`)).slice(0, 32);

function tokenNuevo(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Hoy en El Salvador (UTC-6, sin horario de verano).
const hoySV = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);

// Mis créditos (2026-10-15): la política es la del portal y NO otra. El plazo
// es un mes desde la fecha del crédito (`DIAS_DE_PLAZO` de src/data/creditos.js
// y el `> 30` de `creditos_pasados_del_plazo`, que dispara el aviso), y «vence
// pronto» son los cinco días previos (`DIAS_DE_AVISO`). Vencido exige SALDO:
// un crédito pagado de hace un año no debe nada. `fecha_limite` es el último
// día dentro del plazo; desde el siguiente está vencido.
const PLAZO_CREDITO = 30, AVISO_CREDITO = 5;
const estadoDeCredito = (fecha: string, saldo: number) => {
  const base = Date.parse(`${String(fecha).slice(0, 10)}T12:00:00Z`);
  const dias = Math.round((Date.parse(`${hoySV()}T12:00:00Z`) - base) / 86400_000);
  const fecha_limite = new Date(base + PLAZO_CREDITO * 86400_000).toISOString().slice(0, 10);
  const estado = !(saldo > 0.004) ? "pagado"
    : dias > PLAZO_CREDITO ? "vencido"
    : dias >= PLAZO_CREDITO - AVISO_CREDITO ? "vence_pronto" : "al_dia";
  return { dias, fecha_limite, estado };
};

const limpiarDoc = (v: unknown) => String(v ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
// deno-lint-ignore no-explicit-any
const coordenadas = (loc: any) => {
  const lat = parseFloat(loc?.lat), lng = parseFloat(loc?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : { lat: null, lng: null };
};
const limpiarTel = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const plataformaValida = (p: unknown) => (["ios", "android", "web"].includes(String(p)) ? String(p) : null);

// Freno por IP de `reportar_error` (ver la acción).
const topeErrores = new Map<string, { n: number; desde: number }>();

// ── La traza de cada pedido (2026-10-15) ─────────────────────────────────
// Una línea JSON por pedido en los registros de la función: qué acción, cuánto
// tardó y cómo terminó. Sin esto el registro sólo decía «POST app-clientes» y
// no había forma de medir la latencia por acción (p. ej. `ofertas`). NUNCA
// lleva datos de la persona: ni documento, ni teléfono, ni token, ni el
// cuerpo — sólo el nombre de la acción, y sólo si tiene forma de nombre (lo
// manda el cliente: un texto arbitrario podría traer cualquier cosa).
// Cuesta un console.log; no escribe en la base.
type Traza = { accion: string; fallo: boolean };
const nombreDeAccion = (v: unknown) => {
  const a = String(v ?? "");
  return /^[a-z0-9_]{1,40}$/.test(a) ? a : a ? "no_valida" : "sin_accion";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const t0 = performance.now();
  const traza: Traza = { accion: "sin_accion", fallo: false };
  let estado = 500;
  try {
    const res = await atender(req, traza);
    estado = res.status;
    return res;
  } catch (e) {
    // No debería llegar aquí (el cuerpo tiene su propio catch), pero si llega
    // la traza lo anota como falla y el error sigue su curso.
    traza.fallo = true;
    throw e;
  } finally {
    console.log(JSON.stringify({
      traza: "app-clientes",
      accion: traza.accion,
      ms: Math.round(performance.now() - t0),
      estado,
      ok: !traza.fallo && estado < 400,
    }));
  }
});

async function atender(req: Request, traza: Traza): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  // La tarjeta de Wallet: Safari abre este enlace (lo da la acción
  // `wallet_enlace`, firmado y válido 10 min) y ofrece «Agregar a Wallet».
  const enlaceWallet = req.method === "GET" ? new URL(req.url).searchParams.get("wallet") : null;
  if (req.method !== "POST" && !enlaceWallet) return json({ error: "solo POST" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // La tarjeta de Wallet de una ficha, firmada (ver `_shared/pase.ts`).
  // `oro+equipo`: en prueba, el nivel y además el sello de Equipo.
  const paseDe = async (id: number, nivelDePrueba?: string, equipoPrueba = false) => (await paseDeCliente(admin, id, nivelDePrueba, equipoPrueba)).pase;
  // Dos preguntas distintas desde el 2026-10-17, que antes eran una:
  //   · ¿tiene MUESTRAS? (`tieneMuestras`) — ve datos de ejemplo. Las tiene
  //     también la cuenta del revisor de las tiendas, para que la app no se
  //     vea vacía.
  //   · ¿es la cuenta de PRUEBA? (`esDePrueba`) — además puede ver la app
  //     «como» otro nivel, mandarse avisos de muestra y el panel «Modo de
  //     prueba» de Cuenta. Lo marca una fila `tipo = 'modo_prueba'`. Al
  //     revisor de Apple ese panel se le lee como una función de depuración,
  //     y es motivo de rechazo.
  const tieneMuestras = async (id: number) => {
    const { count, error } = await admin.from("app_cliente_muestras").select("id", { count: "exact", head: true }).eq("customer_id", id);
    if (error) throw error;
    return (count ?? 0) > 0;
  };
  const esDePrueba = async (id: number) => {
    const { count, error } = await admin.from("app_cliente_muestras").select("id", { count: "exact", head: true })
      .eq("customer_id", id).eq("tipo", "modo_prueba");
    if (error) throw error;
    return (count ?? 0) > 0;
  };
  // Modo de prueba: los niveles y, para ver su tarjeta, los rangos de mayorista.
  const NOMBRE_NIVEL: Record<string, string> = { vip: "Bronce", bronce: "Bronce", plata: "Plata", oro: "Oro", platino: "Platino",
    jade: "Jade", zafiro: "Zafiro", rubi: "Rubí", diamante: "Diamante", empleado: "Personal" };


  if (enlaceWallet) {
    traza.accion = "wallet";
    try {
      const id = await clienteDelEnlace(enlaceWallet);
      if (!id) return new Response("Este enlace ya venció. Vuelve a tocar «Agregar a Wallet» en la app.", { status: 410, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      // Modo de prueba: la cuenta de prueba puede pedir la tarjeta con otro nivel.
      const [nivelQ, extraQ] = (new URL(req.url).searchParams.get("nivel") ?? "").split("+");
      const nivelPrueba = NOMBRE_NIVEL[nivelQ] && await esDePrueba(id) ? NOMBRE_NIVEL[nivelQ] : undefined;
      const pkpass = await paseDe(id, nivelPrueba, !!nivelPrueba && extraQ === "equipo");
      return new Response(pkpass, { headers: {
        "Content-Type": "application/vnd.apple.pkpass",
        "Content-Disposition": "attachment; filename=PuntosSalud.pkpass",
        "Cache-Control": "no-store",
      } });
    } catch (e) {
      console.error("[wallet]", (e as Error)?.message ?? e);
      traza.fallo = true;
      return new Response("No se pudo crear la tarjeta.", { status: 500 });
    }
  }
  // La IP para el freno: la que pone Cloudflare (`cf-connecting-ip`), que el
  // cliente no puede falsear. Si no viene, el primer valor de
  // `x-forwarded-for`, igual que `mis-puntos`. El último no: puede ser un proxy
  // interno, y entonces TODOS los clientes compartirían un mismo tope.
  const ip = (req.headers.get("cf-connecting-ip")
    ?? (req.headers.get("x-forwarded-for") ?? "").split(",")[0]
    ?? "").trim() || "desconocida";
  const body = await req.json().catch(() => ({} as any));
  const accion = String(body?.accion ?? "");
  traza.accion = nombreDeAccion(accion);

  // ── El freno, compartido con `mis-puntos` ────────────────────────────────
  // Devuelve una Response si hay que cortar; si no, null.
  async function frenar(doc: string, esCodigo: boolean): Promise<Response | null> {
    const { data: fallos, error } = await admin.rpc("puntos_consulta_registrar", {
      p_ip: ip, p_huella_dui: await huellaDoc(doc), p_acerto: false,
    });
    if (error) {
      console.error("app-clientes: el freno no respondió:", error.message);
      return json({ ok: false, mensaje: "Servicio no disponible. Intenta en un rato." }, 503);
    }
    if (Number(fallos ?? 0) >= (esCodigo ? TOPE_FALLOS_CODIGO : TOPE_FALLOS)) {
      return json({ ok: false, motivo: "muchos_intentos", mensaje: "Demasiados intentos. Espera unos minutos." }, 429);
    }
    return null;
  }
  async function anotarAcierto(doc: string) {
    const { error } = await admin.rpc("puntos_consulta_registrar", {
      p_ip: ip, p_huella_dui: await huellaDoc(doc), p_acerto: true,
    });
    if (error) console.error("no se pudo anotar el acierto:", error.message);
  }

  async function buscarCliente(doc: string, tel: string) {
    const { data, error } = await admin.rpc("puntos_cliente_por_documento", {
      p_documento: doc, p_telefono: tel || null,
    });
    if (error) throw error;
    return Array.isArray(data) ? data[0] ?? null : null;
  }

  async function abrirSesion(fila: { customer_id?: number | null; preregistro_id?: string | null }) {
    const token = tokenNuevo();
    const { error } = await admin.from("app_cliente_sesiones").insert({
      customer_id: fila.customer_id ?? null,
      preregistro_id: fila.preregistro_id ?? null,
      token_hash: await sha256(token),
      plataforma: plataformaValida(body?.plataforma),
      dispositivo: body?.dispositivo ? String(body.dispositivo).slice(0, 80) : null,
    });
    if (error) throw error;
    return token;
  }

  async function guardarPermisos(customerId: number, programa: boolean | null, promociones: boolean | null) {
    const { data, error } = await admin.rpc("puntos_guardar_consentimiento", {
      p_customer_id: customerId,
      p_programa: programa,
      p_promociones: promociones,
      p_texto_programa: TEXTOS.programa,
      p_texto_promos: TEXTOS.promociones,
      p_version_aviso: VERSION_AVISO,
      p_identificado_por: "dui_telefono",
      p_origen: "app-clientes",
    });
    if (error) throw error;
    return data as any;
  }

  try {
    // ════════════════════════════════════════════════════════════════════
    // Sin sesión: entrar y registrarse.
    // ════════════════════════════════════════════════════════════════════
    // ── Errores de la app (2026-10-08): la app manda aquí lo que falla, con o
    // sin sesión (también falla antes de entrar). Con freno: si en 5 minutos ya
    // llegaron 300, se descarta — un bucle no puede llenar la tabla.
    if (accion === "reportar_error") {
      const txt = (v: unknown, n: number) => (v == null ? null : String(v).slice(0, n));
      const { count, error: eC } = await admin.from("app_errores").select("id", { count: "exact", head: true })
        .gte("created_at", new Date(Date.now() - 5 * 60_000).toISOString());
      if (eC) console.error("reportar_error: conteo", eC.message);
      if ((count ?? 0) >= 300) return json({ ok: true, descartado: true });
      // (2026-10-12, auditoría) Tope por IP además del global: sin él, un solo
      // script llenaba los 300 y dejaba ciego el registro para todos los demás.
      // Vive en memoria de la instancia: es un freno barato, no una cuenta exacta.
      const ahora = Date.now();
      const r = topeErrores.get(ip);
      if (r && ahora - r.desde < 5 * 60_000) {
        if (r.n >= 20) return json({ ok: true, descartado: true });
        r.n++;
      } else {
        if (topeErrores.size > 5000) topeErrores.clear();
        topeErrores.set(ip, { n: 1, desde: ahora });
      }
      let customerId: number | null = null;
      if (typeof body?.token === "string" && body.token.length > 10) {
        const { data: ses, error: eS } = await admin.from("app_cliente_sesiones").select("customer_id")
          .eq("token_hash", await sha256(body.token)).is("revocada_at", null).maybeSingle();
        if (eS) console.error("reportar_error: sesión", eS.message);
        customerId = ses?.customer_id ?? null;
      }
      const { error } = await admin.from("app_errores").insert({
        customer_id: customerId, fatal: body?.fatal === true, mensaje: txt(body?.mensaje, 1000) ?? "(sin mensaje)",
        pila: txt(body?.pila, 4000), pantalla: txt(body?.pantalla, 200), version: txt(body?.version, 40),
        compilacion: txt(body?.compilacion, 40), plataforma: txt(body?.plataforma, 20), dispositivo: txt(body?.dispositivo, 120),
      });
      if (error) console.error("reportar_error:", error.message);
      return json({ ok: true });
    }

    if (accion === "entrar") {
      const doc = limpiarDoc(body?.documento);
      const tel = limpiarTel(body?.telefono);
      const esCodigo = ES_CODIGO.test(doc);
      if (doc.length < 7 || (!esCodigo && tel.length < 8)) return json(NO_ENCONTRADO);

      const corte = await frenar(doc, esCodigo);
      if (corte) return corte;

      const cli = await buscarCliente(doc, tel);
      if (cli) {
        await anotarAcierto(doc);
        return json({ ok: true, token: await abrirSesion({ customer_id: cli.id }) });
      }
      // ¿Se pre-registró con ESOS dos datos? Entonces vuelve a su pre-registro.
      if (!esCodigo) {
        const { data: pre, error } = await admin.from("app_cliente_preregistros")
          .select("id").eq("documento", doc).eq("telefono", tel).eq("estado", "pendiente").maybeSingle();
        if (error) throw error;
        if (pre) {
          await anotarAcierto(doc);
          return json({ ok: true, token: await abrirSesion({ preregistro_id: pre.id }) });
        }
      }
      return json(NO_ENCONTRADO);
    }

    if (accion === "registrar") {
      const doc = limpiarDoc(body?.documento);
      const tel = limpiarTel(body?.telefono);
      const nombre = String(body?.nombre ?? "").replace(/\s+/g, " ").trim();
      const email = String(body?.email ?? "").trim().toLowerCase() || null;
      const nacimiento = fechaDeNacimiento(body?.fecha_nacimiento);
      if (nacimiento === false) {
        return json({ ok: false, motivo: "datos", mensaje: "Revisa tu fecha de nacimiento." });
      }
      const aceptaPromos = body?.acepta_promociones === true;

      if (body?.acepta_programa !== true) {
        return json({ ok: false, motivo: "consentimiento", mensaje: "Para unirte hay que aceptar el programa." });
      }
      if (nombre.length < 3 || nombre.length > 120) {
        return json({ ok: false, motivo: "datos", mensaje: "Escribe tu nombre completo." });
      }
      if (doc.length < 7 || doc.length > 20 || ES_CODIGO.test(doc)) {
        return json({ ok: false, motivo: "datos", mensaje: "Revisa tu número de documento." });
      }
      if (tel.length < 8 || tel.length > 15) {
        return json({ ok: false, motivo: "datos", mensaje: "Revisa tu teléfono: son 8 dígitos." });
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ ok: false, motivo: "datos", mensaje: "Revisa tu correo." });
      }

      // El alta también pasa por el freno: sin él, la puerta se vuelve una
      // forma de llenar la tabla de basura o de probar documentos.
      const corte = await frenar(doc, false);
      if (corte) return corte;

      // ¿Ya es cliente? Entonces no hay nada que pre-registrar: entra.
      const cli = await buscarCliente(doc, tel);
      if (cli) {
        await anotarAcierto(doc);
        await guardarPermisos(cli.id, true, aceptaPromos);
        return json({ ok: true, token: await abrirSesion({ customer_id: cli.id }), ya_era_cliente: true });
      }

      // ¿Ya hay un pre-registro pendiente con ese documento?
      const { data: previo, error: ePrev } = await admin.from("app_cliente_preregistros")
        .select("id, telefono").eq("documento", doc).eq("estado", "pendiente").maybeSingle();
      if (ePrev) throw ePrev;
      if (previo) {
        // Mismo teléfono: es la misma persona volviendo, entra a su registro.
        // Otro teléfono: no se dice nada más — confirmar que ese documento
        // está registrado sería regalar el dato.
        if (previo.telefono !== tel) return json(NO_SE_PUDO_REGISTRAR);
        await anotarAcierto(doc);
        return json({ ok: true, token: await abrirSesion({ preregistro_id: previo.id }) });
      }

      const { data: nuevo, error: eIns } = await admin.from("app_cliente_preregistros").insert({
        nombre: nombre.toUpperCase(), documento: doc, telefono: tel, email, fecha_nacimiento: nacimiento,
        acepta_programa: true, acepta_promociones: aceptaPromos, version_aviso: VERSION_AVISO,
      }).select("id").single();
      if (eIns) throw eIns;
      // Llegó invitado: se anota quién lo invitó. El premio lo decide la base
      // (`puntos_premiar_referidos`) cuando haga su primera compra de $10.
      // Un código que no existe no frena el alta: se ignora.
      const ref = String(body?.referido ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (ref.length === 6) {
        const { data: quien, error: eR } = await admin.from("app_cliente_referido_codigo")
          .select("customer_id").eq("codigo", ref).maybeSingle();
        if (eR) console.error("no se pudo leer el código de invitación:", eR.message);
        if (quien) {
          const { error: eRef } = await admin.from("app_cliente_referidos")
            .insert({ referidor_id: quien.customer_id, preregistro_id: nuevo.id, codigo: ref });
          if (eRef) console.error("no se pudo anotar la invitación:", eRef.message);
        }
      }
      // A propósito NO se anota como acierto: cada alta nueva cuenta contra el
      // tope de la IP (8 en 15 min). Sin esto, desde un solo teléfono se podían
      // crear pre-registros sin límite con documentos ajenos.
      return json({ ok: true, token: await abrirSesion({ preregistro_id: nuevo.id }), pendiente: true });
    }

    if (accion === "textos") {
      return json({ ok: true, textos: { programa: TEXTOS.programa, promociones: TEXTOS.promociones }, documentos: DOCUMENTOS_VIGENTES });
    }

    // ── Ofertas exclusivas por nivel (2026-10-14) ─────────────────────────
    // `ofertas_clientes.nivel_minimo`: null (todos) | plata | oro | platino |
    // mayoreo. Los niveles van en orden vip < plata < oro < platino; «mayoreo»
    // exige ser Cliente Mayorista aprobado. Con los niveles apagados todos
    // están en el de entrada (`nivelDeCliente`), así que una oferta de nivel no
    // la reserva nadie hasta encenderlos: es la regla, no un error.
    // La cuenta de PRUEBA puede mirar «como» otro nivel (`prueba_nivel`,
    // `prueba_mayorista`, los mismos del modo de prueba de la app).
    const ORDEN_NIVEL: Record<string, number> = { vip: 0, bronce: 0, plata: 1, oro: 2, platino: 3 };
    // `dias`: cuántos días antes ve las ofertas (2026-10-19). Antes era
    // «Platino = 2» escrito acá; hoy es `puntos_niveles.dias_anticipo_ofertas`,
    // que se cambia desde el portal. Apagados los niveles, 0 para todos.
    type Acceso = { nivel: string | null; mayorista: boolean; dias: number };
    const accesoDeNivel = async (customerId: number | null): Promise<Acceso> => {
      if (!customerId) return { nivel: null, mayorista: false, dias: 0 };
      const pn = String(body?.prueba_nivel ?? "");
      if ((pn in ORDEN_NIVEL || body?.prueba_mayorista === true) && await esDePrueba(customerId)) {
        if (!(pn in ORDEN_NIVEL)) {
          const nv = await nivelDeCliente(admin, customerId);
          return { nivel: nv.clave, mayorista: body?.prueba_mayorista === true, dias: nv.dias_anticipo_ofertas };
        }
        // El modo de prueba mira «como» ese nivel, con lo configurado para él.
        const clave = pn === "bronce" ? "vip" : pn;
        const { lista } = await escaleraDeNiveles(admin);
        const fila = lista.find((n) => n.clave === clave);
        return { nivel: clave, mayorista: body?.prueba_mayorista === true, dias: Number(fila?.dias_anticipo_ofertas ?? 0) };
      }
      const [nv, { data: m, error: eM }] = await Promise.all([
        nivelDeCliente(admin, customerId),
        admin.rpc("mayorista_de", { p_customer: customerId }),
      ]);
      if (eM) throw eM;
      // deno-lint-ignore no-explicit-any
      return { nivel: nv.clave, mayorista: (m as any)?.estado === "aprobado", dias: nv.dias_anticipo_ofertas };
    };
    const alcanzaNivel = (requerido: string | null | undefined, acc: { nivel: string | null; mayorista: boolean; dias?: number }) => {
      if (!requerido) return true;
      if (requerido === "mayoreo") return acc.mayorista;
      if (acc.nivel == null || !(requerido in ORDEN_NIVEL)) return false;
      return (ORDEN_NIVEL[acc.nivel] ?? -1) >= ORDEN_NIVEL[requerido];
    };
    const NOMBRE_EXCLUSIVA: Record<string, string> = {
      plata: "clientes Plata o más", oro: "clientes Oro o más", platino: "clientes Platino", mayoreo: "Clientes Mayoristas",
    };

    // Las ofertas vigentes. Con `customerId` null es la vitrina PÚBLICA (sin
    // cuenta, desde la bienvenida): lo exclusivo se anuncia sin detalle y no
    // hay muestras. Es el gancho para unirse (2026-10-06).
    // deno-lint-ignore no-explicit-any
    const ofertasPara = async (customerId: number | null): Promise<any> => {
      const hoy = hoySV();
      // Un nivel puede ver las ofertas unos días ANTES que nadie (2026-10-07,
      // Platino; desde el 2026-10-19 lo que diga `dias_anticipo_ofertas`),
      // marcadas «pronto». Se piden con la ventana más larga posible (14 días,
      // el tope del CHECK en la base) y se recortan acá según el nivel.
      const masAdelante = (dias: number) => new Date(Date.parse(`${hoy}T12:00:00Z`) + dias * 86400_000).toISOString().slice(0, 10);
      const ventanaMaxima = masAdelante(14);
      // Todo A LA VEZ (2026-10-14). Antes eran siete viajes en fila —nivel,
      // ofertas, ficha, salas, muestras, firma— y la pestaña tardaba ~0.75 s
      // de mediana y hasta varios segundos. Así no esperan a saber el nivel.
      const [acceso, { data: filasTodas, error }, socio, { data: salas, error: eB }, muestras] = await Promise.all([
        accesoDeNivel(customerId),
        admin.from("ofertas_clientes")
          .select("id, titulo, descripcion, etiqueta, condiciones, imagen_path, inicio, fin, exclusiva, branch_ids, descuento_tipo, descuento_monto, productos, acento, nivel_minimo")
          .eq("publicada", true).lte("inicio", ventanaMaxima).gte("fin", hoy)
          .order("orden", { ascending: true }).order("fin", { ascending: true })
          .limit(120),
        customerId
          ? admin.from("customers").select("acepta_programa_puntos, acumula_puntos").eq("id", customerId).maybeSingle()
            .then(({ data: c, error: eC }: any) => { if (eC) throw eC; return c?.acepta_programa_puntos !== false && c?.acumula_puntos !== false; })
          : Promise.resolve(false),
        salasDeLaRed(admin),
        muestrasDe(admin, customerId, "oferta"),
      ]);
      if (error) throw error;
      const tope = acceso.dias > 0 ? masAdelante(acceso.dias) : hoy;
      // deno-lint-ignore no-explicit-any
      const filas = (filasTodas ?? []).filter((o: any) => o.inicio <= tope).slice(0, 50);
      if (eB) console.error("no se pudieron leer las salas:", eB.message);
      const nombreSala = new Map((salas ?? []).map((b: any) => [b.id, sucursal(b.name)]));

      // Firmadas en UNA llamada, por 12 horas y reusadas entre aperturas
      // (`firmarOfertas`): una URL nueva cada vez hacía que el teléfono
      // volviera a bajar la misma foto.
      const firmadas = await firmarOfertas(admin, [...filas, ...muestras].map((o: any) => o.imagen_path));
      const ofertas = (filas ?? []).map((o: any) => {
        const imagen = o.imagen_path ? firmadas.get(o.imagen_path) ?? null : null;
        const disponible = !o.exclusiva || socio;
        return {
          id: o.id, titulo: o.titulo, etiqueta: o.etiqueta, imagen, imagen_clave: o.imagen_path ?? null, inicio: o.inicio, fin: o.fin, acento: o.acento ?? "magenta",
          exclusiva: o.exclusiva, disponible, pronto: o.inicio > hoy,
          // Exclusiva por nivel: todos la VEN (es la invitación); reservarla,
          // sólo quien llega. Sin sesión, nunca.
          nivel_minimo: o.nivel_minimo ?? null,
          disponible_para_ti: !!customerId && disponible && alcanzaNivel(o.nivel_minimo, acceso),
          // Lo exclusivo se ANUNCIA a quien no es socio —es la invitación a
          // serlo— pero el detalle sólo lo ve quien puede usarlo.
          descripcion: disponible ? o.descripcion : null,
          condiciones: disponible ? o.condiciones : null,
          // La oferta de un descuento de la caja: qué rebaja y en qué productos,
          // con el precio antes y después. Lo exclusivo no lo muestra a quien no
          // es socio, igual que el texto.
          descuento: o.descuento_tipo ? { tipo: o.descuento_tipo, monto: Number(o.descuento_monto) } : null,
          productos: disponible && Array.isArray(o.productos) ? o.productos : [],
          salas: Array.isArray(o.branch_ids) && o.branch_ids.length
            ? o.branch_ids.map((id: number) => nombreSala.get(id)).filter(Boolean) : null,
        };
      });
      for (const m of muestras) {
        const disponible = !m.exclusiva || socio;
        ofertas.push({
          id: `muestra-${m.id}`, titulo: m.titulo, etiqueta: m.etiqueta ?? null,
          imagen: m.imagen_path ? firmadas.get(m.imagen_path) ?? null : null, imagen_clave: m.imagen_path ?? null,
          inicio: m.inicio, fin: m.fin, acento: m.acento ?? "magenta", exclusiva: !!m.exclusiva, disponible,
          nivel_minimo: m.nivel_minimo ?? null,
          disponible_para_ti: !!customerId && disponible && alcanzaNivel(m.nivel_minimo ?? null, acceso),
          descripcion: disponible ? m.descripcion ?? null : null,
          condiciones: disponible ? m.condiciones ?? null : null,
          descuento: m.descuento ?? null,
          productos: disponible && Array.isArray(m.productos) ? m.productos : [],
          salas: Array.isArray(m.salas) && m.salas.length ? m.salas.map(sucursal) : null,
        });
      }
      return { ok: true, ofertas, socio };
    };

    if (accion === "ofertas_publicas") return json(await ofertasPara(null));

    // Las HISTORIAS (carrusel tipo estados): vigentes y publicadas, con la foto
    // firmada. Con ficha, se suman sus muestras.
    // deno-lint-ignore no-explicit-any
    const historiasPara = async (customerId: number | null): Promise<any> => {
      // Duran 24 horas desde que se publican (`publicada_at` lo pone la base).
      const hace24h = new Date(Date.now() - 24 * 3600_000).toISOString();
      // Las historias y las muestras a la vez: no dependen una de otra.
      const [{ data: filas, error }, muestras] = await Promise.all([
        admin.from("app_historias")
          .select("id, titulo, rotulo, texto, imagen_path, enlace, boton, inicio, fin, oferta_id, publicada_at")
          .eq("publicada", true).gte("publicada_at", hace24h)
          .order("orden", { ascending: true }).order("created_at", { ascending: false }).limit(20),
        muestrasDe(admin, customerId, "historia"),
      ]);
      if (error) throw error;
      const todas = [...(filas ?? []), ...muestras.map((m) => ({ ...m, id: `muestra-${m.id}` }))];
      const firmadas = await firmarOfertas(admin, todas.map((h) => h.imagen_path));
      return {
        ok: true,
        historias: todas.filter((h) => firmadas.has(h.imagen_path)).map((h) => ({
          id: h.id, titulo: h.titulo, rotulo: h.rotulo ?? null, texto: h.texto ?? null, imagen: firmadas.get(h.imagen_path), imagen_clave: h.imagen_path,
          enlace: h.enlace ?? null, boton: h.boton ?? null, fin: h.fin,
          // «Reservar» abre esta oferta; «Más información» va al WhatsApp de la empresa.
          oferta_id: h.oferta_id ?? null,
          publicada_at: h.publicada_at ?? null,
        })),
        whatsapp: WHATSAPP_EMPRESA,
      };
    };
    if (accion === "historias_publicas") return json(await historiasPara(null));

    // Quién vio cada historia (2026-10-06): el portal cuenta las vistas y quién
    // tocó el botón. Sin cuenta, por un identificador aleatorio del teléfono.
    // Las muestras (`muestra-…`) no se anotan.
    // deno-lint-ignore no-explicit-any
    const anotarVista = async (b: any, customerId: number | null) => {
      const id = String(b?.id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ ok: true, anotada: false });
      const disp = typeof b?.dispositivo === "string" && /^[A-Za-z0-9-]{8,64}$/.test(b.dispositivo) ? b.dispositivo : null;
      if (!customerId && !disp) return json({ ok: true, anotada: false });
      const { error } = await admin.rpc("app_historia_registrar_vista", {
        p_historia: id, p_customer: customerId, p_dispositivo: disp, p_boton: b?.boton === true,
      });
      // Una historia borrada entre que se cargó y se vio: no es un error de la app.
      if (error && error.code !== "23503") throw error;
      return json({ ok: true, anotada: !error });
    };
    if (accion === "historia_vista_publica") return await anotarVista(body, null);

    // ── Banners (2026-10-07): las imágenes horizontales de arriba del
    // catálogo, que se suben en el portal. Públicos, con su foto firmada.
    if (accion === "banners") {
      const hoy = hoySV();
      const { data: filas, error } = await admin.from("app_banners")
        .select("id, titulo, titulo_visible, imagen_path, oferta_id, enlace")
        .eq("publicada", true).lte("inicio", hoy).gte("fin", hoy)
        .order("orden", { ascending: true }).order("created_at", { ascending: false }).limit(10);
      if (error) throw error;
      const firmadas = await firmarOfertas(admin, (filas ?? []).map((b: any) => b.imagen_path));
      return json({
        ok: true,
        banners: (filas ?? []).filter((b: any) => firmadas.has(b.imagen_path)).map((b: any) => ({
          id: b.id, titulo: b.titulo, titulo_visible: b.titulo_visible, imagen: firmadas.get(b.imagen_path),
          imagen_clave: b.imagen_path, oferta_id: b.oferta_id ?? null, enlace: b.enlace ?? null,
        })),
      });
    }

    // ── Catálogo (2026-10-07): precio de viñeta y precio VIP, y dónde hay.
    // Público como la vitrina: no hace falta cuenta para mirar precios.
    //
    // Precio de mayoreo (2026-10-12): `app_catalogo` y `app_catalogo_producto`
    // traen `precio_mayoreo` (lista Mayoreo) y `precio_plus` (Mayoreo Plus).
    // NUNCA salen tal cual: se quitan siempre y, sólo a quien le corresponde,
    // se devuelve UN precio normalizado (`precio_tuyo` + `precio_tuyo_nombre`).
    // Le corresponde al cliente mayorista aprobado (su lista) y al personal
    // (Mayoreo Plus, por política). Lo comprado a precio de personal no
    // acumula puntos salvo que además sea mayorista aprobado
    // (`precio_tuyo_sin_puntos`). La cuenta de prueba puede pedir
    // `prueba_precio` para ver cómo se ve.
    // `conPrueba = false` al COBRAR: el precio de prueba es sólo para mirar.
    const condicionDePrecio = async (conPrueba = true): Promise<{ clave: string | null; sinPuntos: boolean }> => {
      const nada = { clave: null, sinPuntos: false };
      const tk = String(body?.token ?? "");
      if (tk.length < 30) return nada;
      const { data: s, error } = await admin.from("app_cliente_sesiones")
        .select("customer_id, ultimo_uso_at, revocada_at").eq("token_hash", await sha256(tk)).maybeSingle();
      if (error) { console.error("catálogo: sesión", error.message); return nada; }
      if (!s?.customer_id || s.revocada_at || Date.now() - new Date(s.ultimo_uso_at).getTime() > DIAS_SESION * 86400_000) return nada;
      const pp = String(body?.prueba_precio ?? "");
      if (conPrueba && (pp === "mayoreo" || pp === "mayoreo_plus") && await esDePrueba(s.customer_id)) return { clave: pp, sinPuntos: false };
      const [{ data: m, error: eM }, { data: emp, error: eE }] = await Promise.all([
        admin.rpc("mayorista_de", { p_customer: s.customer_id }),
        admin.rpc("cliente_es_empleado", { p_customer: s.customer_id }),
      ]);
      if (eM) console.error("catálogo: mayoreo", eM.message);
      if (eE) console.error("catálogo: personal", eE.message);
      const mayorista = !eM && (m as any)?.estado === "aprobado";
      if (mayorista) {
        // Personal que además es mayorista: el mejor de los dos, y acumula.
        return { clave: (m as any).precio === "mayoreo_plus" || (!eE && emp === true) ? "mayoreo_plus" : "mayoreo", sinPuntos: false };
      }
      if (!eE && emp === true) return { clave: "mayoreo_plus", sinPuntos: true };
      return nada;
    };
    // El precio de la lista del cliente, escrito UNA vez para el catálogo y el
    // cobro (2026-10-19). Los dos números vienen ya de `precio_de_lista` (la
    // regla única en la base: techo = el menor entre viñeta y VIP; el Plus es
    // el menor entre Plus y Mayoreo). Acá sólo se elige cuál le toca y con qué
    // nombre: si el «Plus» de un producto es en realidad su Mayoreo (no tiene
    // uno mejor), se nombra y se guarda como Mayoreo, que es la lista con la
    // que la sala lo tiene que facturar.
    const precioDeLista = (clave: string | null, mayoreo: unknown, plus: unknown):
      { precio: number | null; lista: "mayoreo" | "mayoreo_plus" | null; nombre: string | null } => {
      const may = mayoreo == null ? null : Number(mayoreo);
      const pl = plus == null ? null : Number(plus);
      if (clave === "mayoreo_plus" && pl != null && (may == null || pl < may)) return { precio: pl, lista: "mayoreo_plus", nombre: "Mayoreo Plus" };
      if ((clave === "mayoreo_plus" || clave === "mayoreo") && may != null) return { precio: may, lista: "mayoreo", nombre: "Mayoreo" };
      return { precio: null, lista: null, nombre: null };
    };
    // deno-lint-ignore no-explicit-any
    const conPrecioTuyo = (cond: { clave: string | null; sinPuntos: boolean }) => (x: any) => {
      const { precio_mayoreo, precio_plus, ...resto } = x ?? {};
      const { precio: tuyo, nombre } = precioDeLista(cond.clave, precio_mayoreo, precio_plus);
      return { ...resto, precio_tuyo: tuyo, precio_tuyo_nombre: nombre, precio_tuyo_sin_puntos: tuyo != null && cond.sinPuntos };
    };
    // El mayoreo es por presentación CERRADA (2026-10-12, condiciones de
    // mayoreo; usuario: «si selecciono unidades, se pone el precio
    // preferencial»): la lista Mayoreo / Mayoreo Plus vale sólo para la
    // presentación de mayor `factor` (la caja). Las menores —unidades sueltas,
    // blíster— van a precio Preferente (VIP) o, sin él, de viñeta: a esas no
    // se les pone `precio_tuyo` y la app muestra el Preferente de siempre.
    // La MISMA regla cobra `reservar_carrito`.
    // deno-lint-ignore no-explicit-any
    const factorMayor = (lista: any[]) => Math.max(1, ...lista.map((x: any) => Number(x?.factor) || 1));
    if (accion === "catalogo") {
      const q = String(body?.q ?? "").slice(0, 60);
      const desde = Math.max(0, Math.min(1000, Number(body?.desde) || 0));
      const limite = Math.max(1, Math.min(50, Number(body?.limite) || 30));
      const [{ data, error }, cond] = await Promise.all([
        admin.rpc("app_catalogo", { p_q: q, p_desde: desde, p_limite: limite }),
        condicionDePrecio(),
      ]);
      if (error) throw error;
      const d: any = data ?? {};
      return json({ ok: true, ...d, productos: (Array.isArray(d.productos) ? d.productos : []).map(conPrecioTuyo(cond)) });
    }
    if (accion === "catalogo_producto") {
      const id = Number(body?.id);
      if (!Number.isInteger(id) || id <= 0) return json({ ok: false, mensaje: "Producto no válido." });
      const [{ data, error }, { data: salas, error: eS }, cond, unidades] = await Promise.all([
        admin.rpc("app_catalogo_producto", { p_id: id }),
        salasDeLaRed(admin).then((r) => ({ ...r, data: r.data?.filter((b: any) => b.type === "FARMACIA") ?? null })),
        condicionDePrecio(),
        unidadesPorSala(admin, [id]).then((m) => m.get(id) ?? new Map<number, number>()),
      ]);
      if (error) throw error;
      if (eS) throw eS;
      if (!data) return json({ ok: false, mensaje: "Este producto ya no está en el catálogo." });
      const nombre = new Map((salas ?? []).map((b: any) => [Number(b.id), sucursal(b.name)]));
      // deno-lint-ignore no-explicit-any
      const d: any = data;
      // Dos filas iguales (misma presentación y precio) se muestran una vez.
      const vistas = new Set<string>();
      const caja = factorMayor(d.presentaciones ?? []);
      const sinLista = { clave: null, sinPuntos: false };
      return json({
        ok: true,
        producto: {
          ...d,
          presentaciones: (d.presentaciones ?? []).filter((x: any) => {
            const k = `${x.tipo}|${x.precio}|${x.precio_vip}`;
            if (vistas.has(k)) return false;
            vistas.add(k);
            return true;
          }).map((x: any) => conPrecioTuyo((Number(x?.factor) || 1) === caja ? cond : sinLista)(x)),
          // `alcance` (2026-10-15): por factor de presentación, cuántas alcanzan en
          // esa sala (tope 5), contado en UNIDADES — una caja de 100 no cabe en
          // 40 sueltas —. `nivel` también sale de las unidades: antes una caja
          // de 100 contaba como «1» y decía «Pocas unidades».
          existencias: (d.existencias ?? []).filter((e: any) => nombre.has(Number(e.branch_id)))
            .map((e: any) => {
              const u = unidades.get(Number(e.branch_id));
              if (u == null) return { ...e, sala: nombre.get(Number(e.branch_id)) };
              const alcance = Object.fromEntries([...new Set((d.presentaciones ?? []).map((x: any) => Number(x?.factor) || 1))]
                .map((f) => [f, alcanceDe(u, f as number)]));
              return { ...e, nivel: u >= 5 ? "hay" : "pocas", alcance, sala: nombre.get(Number(e.branch_id)) };
            }),
          salas: [...nombre.entries()].map(([id, n]) => ({ id, sala: n })),
        },
        whatsapp: WHATSAPP_EMPRESA,
      });
    }

    // Las salas: dirección, teléfonos y horario, y si está abierta AHORA (hora
    // de El Salvador). Pública: se ve también sin cuenta.
    if (accion === "salas") {
      const { data, error } = await admin.from("branches")
        .select("id, name, address, phone, cell, weekly_hours, settings").eq("type", "FARMACIA").order("name");
      if (error) throw error;
      // La foto REAL de cada sucursal, cuando se suba: `branches.settings.foto_app`
      // (ruta en el bucket ofertas-clientes). Mientras no esté, la app pone una
      // de stock.
      const rutasFoto = (data ?? []).map((b: any) => b.settings?.foto_app).filter(Boolean);
      const fotos = await firmarOfertas(admin, rutasFoto);
      const sv = new Date(Date.now() - 6 * 3600_000);
      const dia = sv.getUTCDay();
      const ahora = sv.getUTCHours() * 60 + sv.getUTCMinutes();
      const minutos = (h: string) => { const m = String(h ?? "").match(/(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
      // deno-lint-ignore no-explicit-any
      const salas = (data ?? []).map((b: any) => {
        const horas = b.weekly_hours ?? {};
        // deno-lint-ignore no-explicit-any
        const horario = [0, 1, 2, 3, 4, 5, 6].map((d) => { const h: any = horas[d] ?? horas[String(d)] ?? {}; return {
          dia: d, abre: h.isOpen ? String(h.start ?? "").slice(0, 5) : null, cierra: h.isOpen ? String(h.end ?? "").slice(0, 5) : null,
        }; });
        const hoy = horario[dia];
        const a = minutos(hoy.abre ?? ""), c = minutos(hoy.cierra ?? "");
        return {
          id: b.id, nombre: sucursal(b.name), direccion: b.address,
          foto: b.settings?.foto_app ? fotos.get(b.settings.foto_app) ?? null : null, foto_clave: b.settings?.foto_app ?? null, telefono: b.phone, celular: b.cell, horario,
          abierta: a != null && c != null && ahora >= a && ahora < c,
          cierra_hoy: hoy.cierra, abre_hoy: hoy.abre,
          // Dónde está (`settings.location`, la misma que usan las rutas de
          // reparto): la app ordena «más cercanas» en el TELÉFONO, así que la
          // ubicación de la persona nunca viaja al servidor (2026-10-08).
          ...coordenadas(b.settings?.location),
        };
      });
      return json({ ok: true, salas });
    }

    // ════════════════════════════════════════════════════════════════════
    // Con sesión.
    // ════════════════════════════════════════════════════════════════════
    const token = String(body?.token ?? "");
    if (token.length < 30) return json({ ok: false, motivo: "sin_sesion" }, 401);
    const hash = await sha256(token);
    const { data: ses, error: eSes } = await admin.from("app_cliente_sesiones")
      .select("id, customer_id, preregistro_id, ultimo_uso_at, revocada_at, acepta_avisos")
      .eq("token_hash", hash).maybeSingle();
    if (eSes) throw eSes;
    const vencida = ses && Date.now() - new Date(ses.ultimo_uso_at).getTime() > DIAS_SESION * 86400_000;
    if (!ses || ses.revocada_at || vencida) return json({ ok: false, motivo: "sin_sesion" }, 401);

    // El uso se anota a lo sumo una vez por hora: anotar cada consulta sería
    // una escritura por pantalla abierta, que es justo el churn que no se quiere.
    if (Date.now() - new Date(ses.ultimo_uso_at).getTime() > 3600_000) {
      const { error } = await admin.from("app_cliente_sesiones")
        .update({ ultimo_uso_at: new Date().toISOString() }).eq("id", ses.id);
      if (error) console.error("no se pudo anotar el uso:", error.message);
    }

    // Un pre-registro se vincula solo el día que la sala crea la ficha con el
    // mismo documento y teléfono. La búsqueda de la ficha recorre `customers`,
    // así que se intenta sólo al pedir el RESUMEN (al abrir la app), no en cada
    // pantalla.
    let customerId: number | null = ses.customer_id;
    if (!customerId && ses.preregistro_id) {
      const { data: pre, error } = await admin.from("app_cliente_preregistros")
        .select("id, documento, telefono, estado, customer_id, acepta_promociones")
        .eq("id", ses.preregistro_id).maybeSingle();
      if (error) throw error;
      if (!pre || pre.estado === "descartado") return json({ ok: false, motivo: "sin_sesion" }, 401);
      if (pre.estado === "vinculado" && pre.customer_id) {
        customerId = pre.customer_id;
      } else if (accion === "resumen") {
        const cli = await buscarCliente(pre.documento, pre.telefono);
        if (cli) {
          customerId = cli.id;
          const { error: eV } = await admin.from("app_cliente_preregistros")
            .update({ estado: "vinculado", customer_id: cli.id, resuelto_at: new Date().toISOString() })
            .eq("id", pre.id).eq("estado", "pendiente");
          if (eV) throw eV;
          await guardarPermisos(cli.id, true, pre.acepta_promociones);
        }
      }
      if (customerId) {
        const { error: eS } = await admin.from("app_cliente_sesiones")
          .update({ customer_id: customerId }).eq("preregistro_id", ses.preregistro_id).is("customer_id", null);
        if (eS) throw eS;
      }
    }

    // ── Cerrar sesión / borrar cuenta: valen también sin ficha ─────────────
    if (accion === "salir") {
      const { error } = await admin.from("app_cliente_sesiones")
        .update({ revocada_at: new Date().toISOString(), push_token: null }).eq("id", ses.id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (accion === "borrar_cuenta") {
      // La cuenta de la app es la sesión, los avisos, el pre-registro y lo
      // personal que se subió desde la app (`borrarLoPersonal`). La
      // FICHA no se borra: es un registro fiscal que la ley obliga a guardar, y
      // la sala la usa para facturar. Lo que el cliente sí decide sobre ella
      // —sus permisos— se puede retirar en el mismo gesto (`retirar_permisos`).
      const ahora = new Date().toISOString();
      if (customerId) {
        const { error } = await admin.from("app_cliente_sesiones")
          .update({ revocada_at: ahora, push_token: null, acepta_avisos: false })
          .eq("customer_id", customerId).is("revocada_at", null);
        if (error) throw error;
        if (body?.retirar_permisos === true) await guardarPermisos(customerId, false, false);
        await borrarLoPersonal(admin, customerId);
      }
      // El pre-registro se borra aunque ya esté VINCULADO: sus datos (nombre,
      // documento, teléfono, correo, nacimiento) ya viven en la ficha, y
      // guardarlos aparte después de «borrar mi cuenta» no tiene motivo.
      if (ses.preregistro_id) {
        const { error } = await admin.from("app_cliente_preregistros").delete().eq("id", ses.preregistro_id);
        if (error) throw error;
      }
      if (customerId) {
        const { error } = await admin.from("app_cliente_preregistros").delete().eq("customer_id", customerId);
        if (error) throw error;
      }
      const { error: eYo } = await admin.from("app_cliente_sesiones")
        .update({ revocada_at: ahora, push_token: null }).eq("id", ses.id);
      if (eYo) throw eYo;
      return json({ ok: true });
    }

    if (accion === "avisos") {
      const acepta = body?.acepta === true;
      const pushToken = acepta && body?.push_token ? String(body.push_token).slice(0, 200) : null;
      const { error } = await admin.from("app_cliente_sesiones")
        .update({ acepta_avisos: acepta, push_token: pushToken }).eq("id", ses.id);
      if (error) throw error;
      return json({ ok: true, acepta });
    }

    // ── Reglas y privacidad del primer inicio (2026-10-14, app/guia.js) ────
    // `documentos_estado`: ¿esta cuenta ya aceptó las versiones vigentes? La
    // app lo pregunta una vez por sesión nueva. `aceptar_documentos`: guarda la
    // aceptación de los dos, cada uno con su versión, la plataforma y la
    // versión de la app. Valen también para el pre-registro (sin ficha): lo
    // aceptado como pre-registro sigue valiendo cuando se vincula la ficha.
    if (accion === "documentos_estado" || accion === "aceptar_documentos") {
      const filtro = [
        customerId ? `customer_id.eq.${Number(customerId)}` : null,
        ses.preregistro_id ? `preregistro_id.eq.${ses.preregistro_id}` : null,
      ].filter(Boolean).join(",");
      if (!filtro) return json({ ok: false, motivo: "sin_sesion" }, 401);
      if (accion === "documentos_estado") {
        const { data, error } = await admin.from("app_cliente_aceptaciones")
          .select("documento, version").or(filtro).in("documento", ["reglamento", "aviso"]).limit(200);
        if (error) throw error;
        const tiene = (d: string, v: string) => (data ?? []).some((f: any) => f.documento === d && f.version === v);
        return json({
          ok: true, documentos: DOCUMENTOS_VIGENTES,
          aceptado: tiene("reglamento", DOCUMENTOS_VIGENTES.reglamento) && tiene("aviso", DOCUMENTOS_VIGENTES.aviso),
        });
      }
      // Se acepta lo que la persona tenía delante: si la app trae otra versión
      // (el documento cambió mientras leía), no se anota y se le pide de nuevo.
      if (body?.reglamento_version !== DOCUMENTOS_VIGENTES.reglamento || body?.aviso_version !== DOCUMENTOS_VIGENTES.aviso) {
        return json({ ok: false, motivo: "version", documentos: DOCUMENTOS_VIGENTES,
          mensaje: "Los documentos se actualizaron. Revísalos de nuevo y vuelve a aceptar." });
      }
      const comun = {
        customer_id: customerId ?? null,
        preregistro_id: customerId ? null : ses.preregistro_id,
        sesion_id: ses.id,
        plataforma: plataformaValida(body?.plataforma),
        version_app: body?.version_app == null ? null : String(body.version_app).slice(0, 40),
      };
      const { error } = await admin.from("app_cliente_aceptaciones").insert([
        { ...comun, documento: "reglamento", version: DOCUMENTOS_VIGENTES.reglamento },
        { ...comun, documento: "aviso", version: DOCUMENTOS_VIGENTES.aviso },
      ]);
      if (error) throw error;
      return json({ ok: true, documentos: DOCUMENTOS_VIGENTES });
    }

    // ── Ofertas: las ve también quien está pendiente ──────────────────────
    if (accion === "ofertas") return json(await ofertasPara(customerId));
    if (accion === "historias") return json(await historiasPara(customerId));
    if (accion === "historia_vista") return await anotarVista(body, customerId);

    // ── Reservas de productos en oferta (2026-10-06) ──────────────────────
    // Reglas en TERMINOS_RESERVA (se muestran antes de la primera reserva y se
    // guardan con su versión). La sucursal las maneja desde el portal.
    if (accion === "reserva_terminos") return json({ ok: true, ...TERMINOS_RESERVA });

    if (accion === "reserva_existencias") {
      const productoId = Number(body?.producto_id);
      if (!productoId) return json({ ok: false, mensaje: "Producto inválido." }, 400);
      // `receta` (2026-10-12): bajo receta se reserva con foto, y la hoja la pide.
      // `alcance` (2026-10-15): cuántas de las que se piden alcanzan en cada
      // sala (tope 5). La oferta se reserva en su presentación MENOR —su precio
      // es el más bajo de viñeta (`productosDeLaFoto`)—, así que se cuenta con
      // ese factor y en unidades.
      const [{ data, error }, rx, { data: facs, error: eFa }, unidades] = await Promise.all([
        admin.rpc("app_cliente_existencias", { p_producto_id: productoId }),
        bajoReceta(admin, [productoId]),
        admin.from("product_precios").select("factor").eq("product_id", productoId).eq("activo", true).gt("vineta", 0),
        unidadesPorSala(admin, [productoId]).then((m) => m.get(productoId) ?? new Map<number, number>()),
      ]);
      if (error) throw error;
      if (eFa) throw eFa;
      const menor = (facs ?? []).length ? Math.max(1, Math.min(...(facs ?? []).map((x: any) => Number(x.factor) || 1))) : 1;
      const sucursales = (data ?? []).map((s: any) => ({ ...s, alcance: alcanceDe(unidades.get(Number(s.branch_id)) ?? 0, menor) }));
      return json({ ok: true, sucursales: conSucursal(sucursales), receta: rx.has(productoId) });
    }

    // El cupón del mes ya se raspó (2026-10-09): queda en el servidor, así en
    // otro teléfono o al reinstalar no aparece sin raspar. Sólo su propio cupón.
    if (accion === "cupon_raspado") {
      if (!customerId) return json({ ok: false });
      const id = Number(body?.id);
      if (!Number.isFinite(id)) return json({ ok: false, mensaje: "Cupón inválido." });
      const { error } = await admin.from("puntos_lote").update({ raspado_el: new Date().toISOString() })
        .eq("id", id).eq("customer_id", customerId).eq("origen", "cupon").is("raspado_el", null);
      if (error) throw error;
      return json({ ok: true });
    }

    if (["solicitar_mayorista", "mis_tratamientos", "tratamiento_cambiar", "mis_encuestas", "responder_encuesta", "mis_facturas", "factura_documento", "mis_reservas", "reservar", "cancelar_reserva", "pagar_reserva", "reservar_carrito", "encargar", "mis_encargos", "pagar_encargo", "cancelar_encargo", "receta_subir_url", "receta_confirmar", "quitar_receta"].includes(accion)) {
      if (!customerId) return json({ ok: false, mensaje: "Completa tu registro en una sucursal para reservar." });
    }
    // El chat y la foto de perfil (2026-10-12) cuelgan de la ficha.
    if (["chat_mensajes", "chat_enviar", "chat_leido", "chat_subir_url", "chat_reaccionar", "chat_escribiendo", "chat_calificar", "perfil", "perfil_subir_url", "perfil_confirmar", "perfil_quitar"].includes(accion)) {
      if (!customerId) return json({ ok: false, pendiente: true, mensaje: "Completa tu registro en una sucursal para usar esta opción." });
    }

    // ── Receta con foto (2026-10-12) ──────────────────────────────────────
    // Una reserva de un producto bajo receta nace «en_revision». La app pide
    // una URL de subida (`receta_subir_url`), sube la foto y la confirma
    // (`receta_confirmar`); ahí queda `receta_estado = 'pendiente'` y un
    // trigger le avisa a la sucursal, que decide en el portal
    // (`reserva_receta_decidir`). Si pide otra foto (`otra_foto`), se repite.
    // Un pedido del carrito lleva UNA receta para todos sus renglones: todo el
    // pedido espera la revisión, y la foto se anota en todos.
    const recetaDe = async (id: number) => {
      const { data, error } = await admin.from("app_reservas")
        .select("id, branch_id, estado, receta_estado, receta_fotos, pedido")
        .eq("id", id).eq("customer_id", customerId).maybeSingle();
      if (error) throw error;
      if (!data || data.estado !== "en_revision" || !(data.receta_estado == null || data.receta_estado === "otra_foto")) return null;
      return data;
    };
    const rutaDeReceta = (r: any) => `recetas/${Number(r.branch_id)}/${Number(r.id)}/${Number(r.receta_fotos ?? 0) + 1}.jpg`;
    if (accion === "receta_subir_url") {
      const r = await recetaDe(Number(body?.reserva_id));
      if (!r) return json({ ok: false, mensaje: "Esta reserva ya no necesita una foto de la receta." });
      if (Number(r.receta_fotos ?? 0) >= 10) return json({ ok: false, mensaje: "Ya subiste muchas fotos para esta reserva. Pasa a la sucursal con tu receta." });
      return json(await urlDeSubida(admin, rutaDeReceta(r)));
    }
    if (accion === "receta_confirmar") {
      const r = await recetaDe(Number(body?.reserva_id));
      if (!r) return json({ ok: false, mensaje: "Esta reserva ya no necesita una foto de la receta." });
      const ruta = rutaDeReceta(r);
      if (String(body?.ruta ?? "") !== ruta) return json({ ok: false, mensaje: "La foto no corresponde a esta reserva. Vuelve a subirla." });
      if (!(await archivoExiste(admin, ruta))) return json({ ok: false, mensaje: "La foto no terminó de subirse. Intenta de nuevo." });
      const ahora = new Date().toISOString();
      let q = admin.from("app_reservas").update({
        receta_ruta: ruta, receta_estado: "pendiente", receta_subida_at: ahora, receta_fotos: Number(r.receta_fotos ?? 0) + 1,
        receta_motivo: null, updated_at: ahora,
      }).eq("customer_id", customerId).eq("estado", "en_revision").or("receta_estado.is.null,receta_estado.eq.otra_foto");
      q = r.pedido ? q.eq("pedido", r.pedido) : q.eq("id", r.id);
      const { data: hechas, error } = await q.select("id");
      if (error) throw error;
      return json(hechas?.length ? { ok: true, ruta } : { ok: false, mensaje: "Esta reserva ya no necesita una foto de la receta." });
    }
    // Quitar lo bajo receta y seguir con lo demás (2026-10-19, decisión 7):
    // mientras el pedido espera la receta (falta la foto, la sala pidió otra o
    // la está revisando), el cliente puede sacar los productos bajo receta; lo
    // demás pasa a «en preparación» y se paga o se retira como cualquier
    // pedido. Si todo el pedido era bajo receta, es cancelarlo.
    if (accion === "quitar_receta") {
      const { data, error } = await admin.rpc("app_reserva_quitar_receta", {
        p_customer_id: customerId, p_id: Number(body?.reserva_id),
      });
      if (error) throw error;
      return json(data ?? { ok: false, mensaje: "No se pudo quitar. Intenta de nuevo." });
    }

    // ── Foto de perfil (2026-10-12) ───────────────────────────────────────
    // Opcional y privada: la ve el equipo en el chat. El equipo puede quitarla
    // (`cliente_foto_quitar` marca `quitada_at`); entonces la app muestra el
    // avatar de siempre y deja subir otra. Si la quita el propio cliente, la
    // fila y el archivo se borran: es su dato.
    const fotoDePerfil = async (): Promise<{ url: string | null; quitada: boolean; ruta: string | null }> => {
      const { data, error } = await admin.from("app_cliente_fotos").select("ruta, quitada_at").eq("customer_id", customerId).maybeSingle();
      if (error) { console.error("no se pudo leer la foto de perfil:", error.message); return { url: null, quitada: false, ruta: null }; }
      if (!data) return { url: null, quitada: false, ruta: null };
      if (data.quitada_at) return { url: null, quitada: true, ruta: data.ruta };
      const firmadas = await firmarRutas(admin, BUCKET_ARCHIVOS, [data.ruta], 6 * 3600);
      return { url: firmadas.get(data.ruta) ?? null, quitada: false, ruta: data.ruta };
    };
    const borrarArchivo = async (ruta: string | null) => {
      if (!ruta) return;
      const { error } = await admin.storage.from(BUCKET_ARCHIVOS).remove([ruta]);
      if (error) console.error("no se pudo borrar el archivo:", error.message);
    };
    if (accion === "perfil") {
      const f = await fotoDePerfil();
      return json({ ok: true, foto_url: f.url, quitada: f.quitada });
    }
    if (accion === "perfil_subir_url") return json(await urlDeSubida(admin, `perfil/${customerId}/${Date.now()}.jpg`));
    if (accion === "perfil_confirmar") {
      const ruta = String(body?.ruta ?? "");
      if (!new RegExp(`^perfil/${customerId}/\\d+\\.jpg$`).test(ruta)) return json({ ok: false, mensaje: "La foto no es válida. Vuelve a elegirla." });
      if (!(await archivoExiste(admin, ruta))) return json({ ok: false, mensaje: "La foto no terminó de subirse. Intenta de nuevo." });
      const anterior = await fotoDePerfil();
      const { error } = await admin.from("app_cliente_fotos").upsert({
        customer_id: customerId, ruta, subida_at: new Date().toISOString(), quitada_at: null, quitada_por: null,
      }, { onConflict: "customer_id" });
      if (error) throw error;
      if (anterior.ruta && anterior.ruta !== ruta) await borrarArchivo(anterior.ruta);
      const f = await fotoDePerfil();
      return json({ ok: true, foto_url: f.url });
    }
    if (accion === "perfil_quitar") {
      const anterior = await fotoDePerfil();
      const { error } = await admin.from("app_cliente_fotos").delete().eq("customer_id", customerId);
      if (error) throw error;
      await borrarArchivo(anterior.ruta);
      return json({ ok: true });
    }

    // ── Chat con la farmacia (2026-10-12) ─────────────────────────────────
    // Una conversación por ficha (`app_chat_conversaciones.customer_id` es
    // UNIQUE), creada con el primer mensaje. El equipo contesta desde el
    // portal (`chat_responder`), que además deja un aviso tipo `chat` para el
    // push (`avisos-clientes` lo manda; la bandeja no lo lista). La app
    // pregunta cada ~5 s con `desde_id` (sólo lo nuevo) mientras la pantalla
    // está a la vista, y con `antes_id` baja lo anterior, de a 30.
    const POR_PAGINA_CHAT = 30;
    const convDe = async () => {
      const { data, error } = await admin.from("app_chat_conversaciones")
        .select("id, sin_leer_cliente, tomada_por, tomada_at, escribiendo_por, escribiendo_at, visto_equipo_at, ultimo_de, ultimo_mensaje_at, estado, resuelta_at, calificacion, calificada_at")
        .eq("customer_id", customerId).maybeSingle();
      if (error) throw error;
      return data;
    };
    // El estado para la app (2026-10-13): resuelta o abierta, y si puede
    // calificar la atención. Se califica UNA vez por cada vez que el equipo la
    // resuelve: si el cliente vuelve a escribir, el trigger la reabre, y al
    // resolverla de nuevo (`resuelta_at` posterior a `calificada_at`) se puede
    // calificar otra vez.
    // deno-lint-ignore no-explicit-any
    const estadoConversacion = (cv: any) => {
      if (!cv) return { estado: null, calificacion: null, puede_calificar: false };
      const resuelta = cv.estado === "resuelta";
      const vigente = !!cv.calificada_at && (!cv.resuelta_at || Date.parse(cv.calificada_at) >= Date.parse(cv.resuelta_at));
      return {
        estado: cv.estado,
        calificacion: vigente ? Number(cv.calificacion) || null : null,
        puede_calificar: resuelta && !vigente,
      };
    };
    // Cada foto firmada viaja con su `foto_clave` (la ruta en Storage, que no
    // cambia): la app la usa como `cacheKey` de la imagen, así una firma nueva
    // no obliga a bajar otra vez la misma foto. Las firmas además se reusan
    // por instancia (`firmarChat`), y los pasos independientes —el equipo con
    // sus fotos, las fotos de los mensajes, reacciones y citas— van a la vez.
    // deno-lint-ignore no-explicit-any
    const armarMensajes = async (filas: any[]) => {
      const idsEq = [...new Set(filas.map((m) => m.employee_id).filter(Boolean))];
      const idsMsg = filas.map((m) => m.id);
      const idsCita = [...new Set(filas.map((m) => m.respuesta_a).filter(Boolean))];
      // El equipo y sus fotos (bucket privado, firmadas por bucket a la vez).
      const equipoConFotos = async () => {
        // deno-lint-ignore no-explicit-any
        const persona = new Map<any, { nombre: string; foto_url: string | null; foto_clave: string | null }>();
        if (!idsEq.length) return persona;
        const { data, error } = await admin.from("employees").select("id, first_names, last_names, name, photo_url").limit(100).in("id", idsEq);
        if (error) console.error("chat: no se pudo leer el equipo:", error.message);
        // deno-lint-ignore no-explicit-any
        const equipo: any[] = data ?? [];
        const porBucket = new Map<string, string[]>();
        const rutaFoto = new Map<string, { bucket: string; ruta: string }>();
        for (const e of equipo) {
          const m = RUTA_STORAGE.exec(String(e.photo_url ?? ""));
          if (!m) continue;
          const ruta = decodeURIComponent(m[2]);
          rutaFoto.set(e.id, { bucket: m[1], ruta });
          porBucket.set(m[1], [...(porBucket.get(m[1]) ?? []), ruta]);
        }
        const firmadasEq = new Map<string, string>();
        const porCada = await Promise.all([...porBucket].map(async ([bucket, rutas]) => [bucket, await firmarChat(admin, bucket, rutas)] as const));
        for (const [bucket, mapa] of porCada) for (const [ruta, url] of mapa) firmadasEq.set(`${bucket}/${ruta}`, url);
        for (const e of equipo) {
          const f = rutaFoto.get(e.id);
          const url = f ? firmadasEq.get(`${f.bucket}/${f.ruta}`) ?? null : null;
          persona.set(e.id, { nombre: nombreCortoEmpleado(e), foto_url: url, foto_clave: url && f ? `${f.bucket}/${f.ruta}` : null });
        }
        return persona;
      };
      // Reacciones y citas (2026-10-12): cada mensaje trae sus reacciones
      // (emoji, de quién, y si es la mía) y, si responde a otro, un resumen
      // del citado.
      const [persona, fotos, { data: reacs, error: eR }, { data: citas, error: eCi }] = await Promise.all([
        equipoConFotos(),
        firmarChat(admin, BUCKET_ARCHIVOS, filas.map((m) => m.foto_ruta).filter(Boolean)),
        idsMsg.length ? admin.from("app_chat_reacciones").select("mensaje_id, autor, employee_id, emoji").limit(900).in("mensaje_id", idsMsg)
          : Promise.resolve({ data: [], error: null }),
        idsCita.length ? admin.from("app_chat_mensajes").select("id, autor, texto, foto_ruta, conversacion_id").limit(200).in("id", idsCita)
          : Promise.resolve({ data: [], error: null }),
      ]);
      // deno-lint-ignore no-explicit-any
      const adjunto = (a: any) => {
        if (!a || typeof a !== "object") return null;
        // La foto, sólo si es del bucket público de productos (2026-10-13).
        if (a.tipo === "producto" && a.id != null) {
          const foto = typeof a.foto === "string" && a.foto.startsWith(`${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/product-photos/`) ? a.foto : null;
          return { tipo: "producto", id: Number(a.id), nombre: String(a.nombre ?? ""), precio: a.precio == null ? null : Number(a.precio), foto };
        }
        if (a.tipo === "oferta" && a.id != null) return { tipo: "oferta", id: String(a.id), titulo: String(a.titulo ?? "") };
        return null;
      };
      if (eR) console.error("chat: reacciones", eR.message);
      if (eCi) console.error("chat: citas", eCi.message);
      // deno-lint-ignore no-explicit-any
      const reacPor = new Map<number, any[]>();
      for (const r of reacs ?? []) {
        const k = Number(r.mensaje_id);
        reacPor.set(k, [...(reacPor.get(k) ?? []), { emoji: r.emoji, mia: r.autor === "cliente" }]);
      }
      // deno-lint-ignore no-explicit-any
      const citaPor = new Map<number, any>((citas ?? []).map((c: any) => [Number(c.id), {
        id: Number(c.id), autor: c.autor, texto: c.texto ? String(c.texto).slice(0, 140) : null, foto: !!c.foto_ruta,
      }]));
      return filas.map((m) => {
        const foto_url = m.foto_ruta ? fotos.get(m.foto_ruta) ?? null : null;
        return {
        id: Number(m.id), autor: m.autor, texto: m.texto ?? null, created_at: m.created_at,
        foto_url,
        foto_clave: foto_url ? `${BUCKET_ARCHIVOS}/${m.foto_ruta}` : null,
        adjunto: adjunto(m.adjunto),
        equipo: m.autor === "equipo" ? persona.get(m.employee_id) ?? { nombre: "Farmacia Salud", foto_url: null, foto_clave: null } : null,
        reacciones: reacPor.get(Number(m.id)) ?? [],
        responde_a: m.respuesta_a ? citaPor.get(Number(m.respuesta_a)) ?? null : null,
        };
      });
    };
    if (accion === "chat_mensajes") {
      // Sin `mi_foto` (2026-10-15): la app no la leía y firmarla en cada
      // sondeo de 5 s costaba una consulta y un viaje a Storage.
      const [cv, hor] = await Promise.all([convDe(), horarioFarmacia(admin)]);
      const base = { ok: true, fuera_de_horario: !hor.abierta, horario: { abierta: hor.abierta, texto: hor.texto, feriado: hor.feriado },
        conversacion: estadoConversacion(cv) };
      if (!cv) return json({ ...base, mensajes: [], hay_mas: false, sin_leer: 0 });
      const desde = Number(body?.desde_id), antes = Number(body?.antes_id);
      const COLS_CHAT = "id, autor, employee_id, texto, foto_ruta, adjunto, respuesta_a, created_at";
      // Por DÍAS (2026-10-14, «que salgan los de los últimos 3 días; si no,
      // "Cargar más" de semana en semana»): la app nueva manda `desde_fecha`
      // (primera carga) o `antes_de` (+ `antes_id`, la página anterior). Una
      // app vieja no manda ninguno y sigue por páginas de 30 ids.
      const fechaDe = (v: unknown) => {
        const ms = typeof v === "string" ? Date.parse(v) : NaN;
        return Number.isFinite(ms) && ms > Date.parse("2020-01-01") && ms < Date.now() + 86400_000 ? ms : null;
      };
      const desdeFecha = fechaDe(body?.desde_fecha);
      const antesDe = fechaDe(body?.antes_de);
      // deno-lint-ignore no-explicit-any
      let filas: any[] = [];
      let hayMas = false;
      if (!(Number.isSafeInteger(desde) && desde > 0) && (desdeFecha != null || antesDe != null)) {
        const TOPE_PRIMERA = 300;   // red de seguridad de la primera carga
        const MINIMO = 15;          // una conversación tranquila no abre vacía
        const POR_SEMANA = 50;      // tope de cada «Cargar anteriores»
        const SEMANA_MS = 7 * 86400_000;
        if (antesDe != null) {
          // La semana anterior a lo más viejo que la app tiene. Si esa semana
          // está vacía, la ventana salta a la semana del mensaje más nuevo de
          // los que quedan (sin pedir semanas vacías una por una).
          let q = admin.from("app_chat_mensajes").select(COLS_CHAT).limit(POR_SEMANA + 1).eq("conversacion_id", cv.id);
          q = Number.isSafeInteger(antes) && antes > 0 ? q.lt("id", antes) : q.lt("created_at", new Date(antesDe).toISOString());
          const { data, error } = await q.order("id", { ascending: false });
          if (error) throw error;
          const viejos = data ?? [];
          if (viejos.length) {
            const masNuevo = Date.parse(viejos[0].created_at);
            const piso = masNuevo >= antesDe - SEMANA_MS ? antesDe - SEMANA_MS : masNuevo - SEMANA_MS;
            // deno-lint-ignore no-explicit-any
            const enVentana = viejos.filter((m: any) => Date.parse(m.created_at) >= piso).slice(0, POR_SEMANA);
            hayMas = enVentana.length < viejos.length;
            filas = enVentana.reverse();
          }
        } else {
          // Primera carga: los últimos 3 días (la fecha la manda la app), con
          // un mínimo de 15 y siempre desde el primer mensaje sin leer, para
          // que la franja «N mensajes nuevos» tenga dónde ir.
          const { data: rec, error: eRec } = await admin.from("app_chat_mensajes").select(COLS_CHAT).limit(TOPE_PRIMERA)
            .eq("conversacion_id", cv.id).gte("created_at", new Date(desdeFecha!).toISOString()).order("id", { ascending: false });
          if (eRec) throw eRec;
          let lista = rec ?? [];
          if (lista.length < MINIMO) {
            const { data: ult, error: eUlt } = await admin.from("app_chat_mensajes").select(COLS_CHAT).limit(MINIMO)
              .eq("conversacion_id", cv.id).order("id", { ascending: false });
            if (eUlt) throw eUlt;
            lista = ult ?? [];
          }
          const sinLeer = Math.min(TOPE_PRIMERA, Number(cv.sin_leer_cliente ?? 0));
          if (sinLeer > 0 && lista.length < TOPE_PRIMERA) {
            const { data: noLeidos, error: eNl } = await admin.from("app_chat_mensajes").select("id").limit(sinLeer)
              .eq("conversacion_id", cv.id).eq("autor", "equipo").order("id", { ascending: false });
            if (eNl) throw eNl;
            const primero = (noLeidos ?? []).at(-1)?.id;
            const masViejo = lista.at(-1)?.id;
            if (primero != null && masViejo != null && primero < masViejo) {
              const { data: hasta, error: eH } = await admin.from("app_chat_mensajes").select(COLS_CHAT).limit(TOPE_PRIMERA)
                .eq("conversacion_id", cv.id).gte("id", primero).order("id", { ascending: false });
              if (eH) throw eH;
              lista = hasta ?? lista;
            }
          }
          const masViejo = lista.at(-1)?.id;
          if (masViejo != null) {
            const { data: antesUno, error: eA } = await admin.from("app_chat_mensajes").select("id").limit(1)
              .eq("conversacion_id", cv.id).lt("id", masViejo);
            if (eA) throw eA;
            hayMas = (antesUno ?? []).length > 0;
          }
          filas = [...lista].reverse();
        }
      } else if (Number.isSafeInteger(desde) && desde > 0) {
        // Lo nuevo desde el último que la app ya tiene (en orden).
        const { data, error } = await admin.from("app_chat_mensajes").select(COLS_CHAT).limit(100)
          .eq("conversacion_id", cv.id).gt("id", desde).order("id", { ascending: true });
        if (error) throw error;
        filas = data ?? [];
      } else {
        let q = admin.from("app_chat_mensajes").select(COLS_CHAT).limit(POR_PAGINA_CHAT + 1)
          .eq("conversacion_id", cv.id);
        if (Number.isSafeInteger(antes) && antes > 0) q = q.lt("id", antes);
        const { data, error } = await q.order("id", { ascending: false });
        if (error) throw error;
        hayMas = (data ?? []).length > POR_PAGINA_CHAT;
        filas = (data ?? []).slice(0, POR_PAGINA_CHAT).reverse();
      }
      // En vivo (2026-10-12): quién atiende, si está escribiendo y si ya vio lo
      // último del cliente. «Escribiendo» dura 6 s sin renovarse; atender, 10 min.
      const ahoraMs = Date.now();
      const escribe = cv.escribiendo_por && cv.escribiendo_at && ahoraMs - Date.parse(cv.escribiendo_at) < 6_000 ? cv.escribiendo_por : null;
      const atiende = cv.tomada_por && cv.tomada_at && ahoraMs - Date.parse(cv.tomada_at) < 10 * 60_000 ? cv.tomada_por : null;
      const ids = [...new Set([escribe, atiende].filter(Boolean))];
      // deno-lint-ignore no-explicit-any
      const quien = new Map<string, any>();
      if (ids.length) {
        const { data: eqs, error: eE } = await admin.from("employees").select("id, first_names, last_names, name").limit(5).in("id", ids);
        if (eE) console.error("chat_mensajes: equipo", eE.message);
        for (const e of eqs ?? []) quien.set(e.id, nombreCortoEmpleado(e));
      }
      const vivo = {
        escribiendo: escribe ? quien.get(escribe) ?? "Farmacia Salud" : null,
        atiende: atiende ? quien.get(atiende) ?? null : null,
        visto: cv.ultimo_de === "cliente" && !!cv.visto_equipo_at && Date.parse(cv.visto_equipo_at) >= Date.parse(cv.ultimo_mensaje_at),
      };
      return json({ ...base, mensajes: await armarMensajes(filas), hay_mas: hayMas, sin_leer: Number(cv.sin_leer_cliente ?? 0), vivo });
    }
    // Reaccionar a un mensaje de su conversación (`emoji` null = quitar).
    if (accion === "chat_reaccionar") {
      const mid = Number(body?.mensaje_id);
      const emoji = body?.emoji == null ? null : String(body.emoji);
      if (!Number.isSafeInteger(mid) || mid <= 0) return json({ ok: false, mensaje: "Mensaje no válido." });
      if (emoji && !["👍", "❤️", "😂", "😮", "🙏", "✅"].includes(emoji)) return json({ ok: false, mensaje: "Reacción no válida." });
      const cv = await convDe();
      if (!cv) return json({ ok: false, mensaje: "Mensaje no válido." });
      const { data: msg, error: eM } = await admin.from("app_chat_mensajes").select("id").eq("id", mid).eq("conversacion_id", cv.id).maybeSingle();
      if (eM) throw eM;
      if (!msg) return json({ ok: false, mensaje: "Mensaje no válido." });
      const { error: eD } = await admin.from("app_chat_reacciones").delete().eq("mensaje_id", mid).eq("autor", "cliente");
      if (eD) throw eD;
      if (emoji) {
        const { error: eI } = await admin.from("app_chat_reacciones").insert({ mensaje_id: mid, autor: "cliente", emoji });
        if (eI) throw eI;
      }
      return json({ ok: true });
    }
    // El cliente está escribiendo: el portal lo muestra en vivo (dura 6 s).
    if (accion === "chat_escribiendo") {
      const { error } = await admin.from("app_chat_conversaciones").update({ cliente_escribiendo_at: new Date().toISOString() })
        .eq("customer_id", customerId);
      if (error) throw error;
      return json({ ok: true });
    }
    if (accion === "chat_subir_url") return json(await urlDeSubida(admin, `chat/${customerId}/${Date.now()}.jpg`));
    if (accion === "chat_enviar") {
      const crudo = String(body?.texto ?? "").trim();
      if (crudo.length > 2000) return json({ ok: false, mensaje: "El mensaje es muy largo (máximo 2,000 letras)." });
      let texto = crudo || null;
      const fotoRuta = body?.foto_ruta ? String(body.foto_ruta) : null;
      // Consultar un producto (2026-10-13): la app manda SÓLO el id; nombre,
      // precio y foto los arma el servidor desde el catálogo (la misma
      // función que la ficha del producto, que ya descarta lo inactivo y lo
      // oculto). Nunca se confía en lo que diga el teléfono.
      let adjuntoProducto: Record<string, unknown> | null = null;
      if (body?.producto_id != null) {
        const pid = Number(body.producto_id);
        if (!Number.isSafeInteger(pid) || pid <= 0) return json({ ok: false, mensaje: "Producto no válido." });
        const { data: prod, error: eProd } = await admin.rpc("app_catalogo_producto", { p_id: pid });
        if (eProd) throw eProd;
        if (!prod) return json({ ok: false, mensaje: "Este producto ya no está en el catálogo." });
        // deno-lint-ignore no-explicit-any
        const d: any = prod;
        const precios = (d.presentaciones ?? []).map((x: any) => Number(x?.precio)).filter((n: number) => Number.isFinite(n) && n > 0);
        adjuntoProducto = {
          tipo: "producto", id: Number(d.id), nombre: String(d.nombre ?? ""),
          precio: precios.length ? Math.min(...precios) : null,
          foto: typeof d.foto === "string" && d.foto ? d.foto : null,
        };
        // Sin texto, la pregunta por defecto: así el equipo ve en su lista
        // de qué se trata (el trigger resume `texto`, no el adjunto).
        if (!texto) texto = "Quiero consultar por este producto.";
      }
      if (!texto && !fotoRuta) return json({ ok: false, mensaje: "Escribe un mensaje." });
      if (fotoRuta && !new RegExp(`^chat/${customerId}/\\d+\\.jpg$`).test(fotoRuta)) return json({ ok: false, mensaje: "La foto no es válida. Vuelve a elegirla." });
      if (fotoRuta && !(await archivoExiste(admin, fotoRuta))) return json({ ok: false, mensaje: "La foto no terminó de subirse. Intenta de nuevo." });
      let cv = await convDe();
      if (!cv) {
        const { data, error } = await admin.from("app_chat_conversaciones").insert({ customer_id: customerId }).select("id, sin_leer_cliente").single();
        // Dos mensajes a la vez: el segundo choca con la UNIQUE y lee la que ganó.
        if (error && error.code !== "23505") throw error;
        cv = data ?? await convDe();
        if (!cv) throw new Error("no se pudo abrir la conversación");
      }
      // Responder citando: sólo un mensaje de SU conversación.
      let respuestaA: number | null = null;
      const pedidaCita = Number(body?.respuesta_a);
      if (Number.isSafeInteger(pedidaCita) && pedidaCita > 0) {
        const { data: cita, error: eCt } = await admin.from("app_chat_mensajes").select("id")
          .eq("id", pedidaCita).eq("conversacion_id", cv.id).maybeSingle();
        if (eCt) throw eCt;
        respuestaA = cita ? Number(cita.id) : null;
      }
      // Freno: 30 mensajes en 10 minutos por cliente.
      const { count, error: eC } = await admin.from("app_chat_mensajes").select("id", { count: "exact", head: true })
        .eq("conversacion_id", cv.id).eq("autor", "cliente").gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString());
      if (eC) throw eC;
      if ((count ?? 0) >= 30) return json({ ok: false, motivo: "muchos_mensajes", mensaje: "Enviaste muchos mensajes seguidos. Espera unos minutos." }, 429);
      const { data: m, error } = await admin.from("app_chat_mensajes")
        .insert({ conversacion_id: cv.id, autor: "cliente", texto, foto_ruta: fotoRuta, respuesta_a: respuestaA, adjunto: adjuntoProducto })
        .select("id, autor, employee_id, texto, foto_ruta, adjunto, respuesta_a, created_at").single();
      if (error) throw error;
      // Respuesta automática (2026-10-12): el cliente siempre sabe que lo
      // recibimos y cuándo le contestan. Una por turno: no se repite si ya hubo
      // una en las últimas 10 horas.
      const hor = await horarioFarmacia(admin);
      const abierto = hor.abierta;
      let auto: any = null;
      const { data: previa, error: eP } = await admin.from("app_chat_mensajes").select("id")
        .eq("conversacion_id", cv.id).eq("autor", "sistema").gte("created_at", new Date(Date.now() - 10 * 3600_000).toISOString()).limit(1);
      if (eP) console.error("chat_enviar: respuesta automática", eP.message);
      if (!eP && !previa?.length) {
        // Los textos los edita el equipo en el portal (`app_chat_ajustes`),
        // con {abre} y {cierra} reemplazados por el horario real.
        const { data: aj, error: eAj } = await admin.from("app_chat_ajustes").select("mensaje_abierto, mensaje_cerrado").eq("id", true).maybeSingle();
        if (eAj) console.error("chat_enviar: ajustes", eAj.message);
        const plantilla = (abierto ? aj?.mensaje_abierto : aj?.mensaje_cerrado)
          ?? (abierto ? "¡Gracias por escribirnos! Recibimos tu mensaje y en un momento te atiende alguien de nuestro equipo."
            : "¡Gracias por escribirnos! En este momento estamos fuera de horario. Te responderemos a la brevedad cuando abramos, {abre}.");
        const texto = String(plantilla).replaceAll("{abre}", hor.abre ?? "en nuestro próximo horario")
          .replaceAll("{cierra}", hor.cierra ?? "");
        const { data: a, error: eA } = await admin.from("app_chat_mensajes").insert({
          conversacion_id: cv.id, autor: "sistema", texto,
        }).select("id, autor, employee_id, texto, foto_ruta, adjunto, respuesta_a, created_at").single();
        if (eA) console.error("chat_enviar: respuesta automática", eA.message);
        else auto = a;
      }
      const armados = await armarMensajes(auto ? [m, auto] : [m]);
      // Escribir reabre la conversación (trigger `app_chat_mensaje_nuevo`).
      return json({ ok: true, mensaje: armados[0], automatico: armados[1] ?? null, fuera_de_horario: !abierto,
        conversacion: { estado: "abierta", calificacion: null, puede_calificar: false }, horario: { abierta: hor.abierta, texto: hor.texto, feriado: hor.feriado } });
    }
    // Calificar la atención (2026-10-13): sólo con la conversación resuelta
    // y sin calificar desde que se resolvió. El cliente sale de la sesión.
    if (accion === "chat_calificar") {
      const nota = Number(body?.calificacion);
      if (!Number.isInteger(nota) || nota < 1 || nota > 5) return json({ ok: false, mensaje: "Elige de 1 a 5 estrellas." });
      const comentario = String(body?.comentario ?? "").trim().slice(0, 500) || null;
      const cv = await convDe();
      if (!cv || !estadoConversacion(cv).puede_calificar) return json({ ok: false, mensaje: "Esta conversación ya no se puede calificar." });
      const { data: hecha, error } = await admin.from("app_chat_conversaciones")
        .update({ calificacion: nota, calificacion_comentario: comentario, calificada_at: new Date().toISOString() })
        .eq("id", cv.id).eq("customer_id", customerId).eq("estado", "resuelta").select("id").limit(1);
      if (error) throw error;
      if (!hecha?.length) return json({ ok: false, mensaje: "Esta conversación ya no se puede calificar." });
      return json({ ok: true, conversacion: { estado: "resuelta", calificacion: nota, puede_calificar: false } });
    }
    if (accion === "chat_leido") {
      const ahora = new Date().toISOString();
      const [{ error }, { error: eA }] = await Promise.all([
        admin.from("app_chat_conversaciones").update({ sin_leer_cliente: 0 }).eq("customer_id", customerId).gt("sin_leer_cliente", 0),
        admin.from("app_cliente_avisos").update({ leido_at: ahora }).eq("customer_id", customerId).eq("tipo", "chat").is("leido_at", null),
      ]);
      if (error) throw error;
      if (eA) console.error("chat_leido: avisos", eA.message);
      return json({ ok: true });
    }

    // Mis reservas — paginada y con filtro (2026-10-09). Antes: las últimas 30
    // de los últimos 45 días, sin forma de ver más atrás.
    //
    // `estado`: «todas» (por defecto), «abiertas» (pendiente/lista),
    // «retiradas» o «cerradas» (vencidas y canceladas). El filtro va en el
    // servidor para que la paginación sea la de lo filtrado.
    //
    // Las ABIERTAS nunca se paginan: son pocas (3 activas como mucho, más los
    // renglones de los pedidos del carrito) y tienen que llegar JUNTAS — la
    // pantalla las agrupa arriba («Listas para retirar» / «En preparación») y
    // el total de un pedido suma todos sus renglones abiertos. En «todas» van
    // completas en la primera página y el cursor recorre sólo las terminadas.
    //
    // Cursor `antes` = {created_at, id} de la última fila mostrada, de a 20
    // (como `mis_facturas`): una reserva nueva mientras se baja no repite ni
    // salta ninguna.
    // El saldo a favor del cliente (2026-10-19, decisión 6): lo que pagó y no
    // se le entregó —la sala canceló, venció, o el pago llegó tarde— y el
    // anticipo de una reserva de sala vencida. Vale en cualquier sucursal hasta
    // su fecha; se usa mostrando el código en caja. Sólo lo vigente: ni usado,
    // ni devuelto en dinero, ni vencido.
    const saldosAFavor = async (cid: number) => {
      const { data, error } = await admin.from("app_reservas")
        .select("id, pedido, saldo_favor, saldo_favor_vence, saldo_favor_origen").limit(100) // tope deliberado: son pocos
        .eq("customer_id", cid).gt("saldo_favor", 0).is("saldo_favor_usado_at", null).is("saldo_favor_devuelto_at", null)
        .gte("saldo_favor_vence", hoySV()).order("saldo_favor_vence", { ascending: true });
      if (error) { console.error("app-clientes: no se pudo leer el saldo a favor:", error.message); return null; }
      const filas = (data ?? []) as any[];
      const total = Math.round(filas.reduce((t, r) => t + Number(r.saldo_favor ?? 0), 0) * 100) / 100;
      return {
        total, vence: filas[0]?.saldo_favor_vence ?? null,
        detalle: filas.map((r) => ({
          codigo: r.pedido ?? `R-${String(r.id).padStart(6, "0")}`, monto: Number(r.saldo_favor), vence: r.saldo_favor_vence,
          origen: r.saldo_favor_origen,
        })),
      };
    };
    if (accion === "mis_reservas") {
      const COLS = "id, estado, origen, pedido, documento, producto_nombre, cantidad, precio_unitario, precio_normal, oferta_titulo, oferta_fin, branch_id, lista_at, vence_at, created_at, cerrada_at, anticipo, pago_estado, pago_metodo, pagado_at, entrega, direccion_entrega, costo_envio, saldo_favor, saldo_favor_vence, saldo_favor_usado_at, receta_ruta, receta_estado, receta_motivo, receta_subida_at, receta_fotos, bajo_receta, pago_prueba, vencida_motivo, saldo_favor_origen, saldo_favor_devuelto_at";
      // `en_revision` (2026-10-12): esperando que la sucursal revise la receta.
      const ABIERTAS = ["en_revision", "pendiente", "lista"];
      const TERMINADAS: Record<string, string[]> = {
        todas: ["retirada", "vencida", "cancelada"], retiradas: ["retirada"], cerradas: ["vencida", "cancelada"],
      };
      const filtro = ["todas", "abiertas", "retiradas", "cerradas"].includes(String(body?.estado)) ? String(body.estado) : "todas";
      const POR_PAGINA = 20;
      const antes = body?.antes && typeof body.antes === "object" ? body.antes : null;
      const cursorOk = antes && /^\d{4}-\d{2}-\d{2}T[\d:.]+([+-]\d{2}:?\d{2}|Z)?$/.test(String(antes.created_at ?? "")) && Number.isFinite(Number(antes.id));

      // Las abiertas (todas de una vez, sólo en la primera página), las
      // terminadas de esta página y las sucursales van A LA VEZ (2026-10-15):
      // ninguna depende de otra. Sólo la firma de las recetas espera a saber
      // qué filas hay.
      const [abiertas, terminadas, { data: salas, error: eS }, saldos] = await Promise.all([
        (async () => {
          if (!((filtro === "todas" || filtro === "abiertas") && !antes)) return [] as any[];
          const { data, error } = await admin.from("app_reservas").select(COLS).limit(200) // tope deliberado: son pocas
            .eq("customer_id", customerId).in("estado", ABIERTAS)
            .order("created_at", { ascending: false }).order("id", { ascending: false });
          if (error) throw error;
          return (data ?? []) as any[];
        })(),
        // Las terminadas, por página.
        (async () => {
          if (filtro === "abiertas") return [] as any[];
          let q = admin.from("app_reservas").select(COLS).limit(20) // = POR_PAGINA
            .eq("customer_id", customerId).in("estado", TERMINADAS[filtro])
            .order("created_at", { ascending: false }).order("id", { ascending: false });
          if (cursorOk) {
            const C = String(antes.created_at), I = Number(antes.id);
            q = q.or(`created_at.lt."${C}",and(created_at.eq."${C}",id.lt.${I})`);
          }
          const { data, error } = await q;
          if (error) throw error;
          return (data ?? []) as any[];
        })(),
        salasDeLaRed(admin),
        saldosAFavor(customerId as number),
      ]);
      let siguiente: { created_at: string; id: number } | null = null;
      const ultima = terminadas[terminadas.length - 1];
      if (terminadas.length === POR_PAGINA && ultima) siguiente = { created_at: ultima.created_at, id: Number(ultima.id) };
      const data = [...abiertas, ...terminadas];

      if (eS) throw eS;
      const sala = new Map((salas ?? []).map((b: any) => [Number(b.id), b]));
      // Lo que se cobra de un pedido del carrito: sus renglones abiertos + el envío una vez.
      // (Completo: las abiertas llegan todas juntas, ver arriba.)
      const porPedido = new Map<string, { suma: number; envio: number }>();
      for (const r of data) {
        if (!r.pedido || !ABIERTAS.includes(r.estado)) continue;
        const t = porPedido.get(r.pedido) ?? { suma: 0, envio: 0 };
        t.suma += Number(r.precio_unitario ?? 0) * Number(r.cantidad ?? 1);
        t.envio = Math.max(t.envio, Number(r.costo_envio ?? 0));
        porPedido.set(r.pedido, t);
      }
      // La foto de la receta, para que el cliente vea la que mandó (1 h).
      const recetas = await firmarRutas(admin, BUCKET_ARCHIVOS, data.map((r: any) => r.receta_ruta).filter(Boolean));
      return json({
        ok: true,
        estado: filtro,
        siguiente,
        // El saldo a favor vigente (2026-10-19), aunque sus renglones estén en
        // otra página: la pantalla lo muestra arriba, con su vigencia.
        saldo_a_favor: saldos,
        reservas: data.map(({ receta_ruta, ...r }: any) => {
          const tp = r.pedido ? porPedido.get(r.pedido) : null;
          const b: any = sala.get(Number(r.branch_id));
          return {
            ...r, codigo: `R-${String(r.id).padStart(6, "0")}`,
            receta_url: receta_ruta ? recetas.get(receta_ruta) ?? null : null,
            sala: b ? sucursal(b.name) : null, sala_direccion: b?.address ?? null,
            // Promoción (con oferta) o producto a precio normal.
            tipo: r.oferta_titulo ? "promocion" : "producto",
            total: Math.round(Number(r.precio_unitario ?? 0) * Number(r.cantidad ?? 1) * 100) / 100,
            total_pedido: tp ? Math.round((tp.suma + tp.envio) * 100) / 100 : null,
          };
        }),
      });
    }

    // El tope de «3 vencidas en 30 días» (2026-10-19) cuenta sólo lo que fue
    // del cliente: no retirarla o no mandar la foto de la receta. Si venció
    // porque la sala no revisó la receta o no la preparó a tiempo, o porque la
    // oferta terminó, no le cuenta en contra (el aviso se lo dice así).
    const vencidaDelCliente = (r: any) => r.estado === "vencida"
      && !["receta_sin_revisar", "sin_preparar", "oferta_terminada"].includes(String(r.vencida_motivo ?? ""));
    if (accion === "reservar") {
      const ofertaId = String(body?.oferta_id ?? "");
      const productoId = Number(body?.producto_id);
      const branchId = Number(body?.branch_id);
      const cantidad = Math.trunc(Number(body?.cantidad));
      if (body?.acepta_terminos !== TERMINOS_RESERVA.version) {
        return json({ ok: false, motivo: "terminos", mensaje: "Acepta las condiciones de la reserva para continuar." });
      }
      if (!productoId || !branchId || !(cantidad >= 1 && cantidad <= 5)) {
        return json({ ok: false, mensaje: "Revisa la sucursal y la cantidad (de 1 a 5)." });
      }
      // La oferta: publicada, vigente, con ese producto. Una MUESTRA (sólo la
      // ficha de prueba) se reserva igual, para poder ver el circuito completo.
      const hoy = hoySV();
      let o: any = null;
      if (ofertaId.startsWith("muestra-")) {
        const m = (await muestrasDe(admin, customerId, "oferta")).find((x) => `muestra-${x.id}` === ofertaId);
        if (m && m.fin >= hoy) o = { id: null, titulo: m.titulo, fin: m.fin, productos: m.productos ?? [], branch_ids: null, nivel_minimo: m.nivel_minimo ?? null };
      } else {
        const { data, error: eO } = await admin.from("ofertas_clientes")
          .select("id, titulo, fin, exclusiva, productos, branch_ids, nivel_minimo")
          .eq("id", ofertaId).eq("publicada", true).lte("inicio", hoy).gte("fin", hoy).maybeSingle();
        if (eO) throw eO;
        o = data;
      }
      if (!o) return json({ ok: false, mensaje: "Esta oferta ya no está vigente." });
      const p = (Array.isArray(o.productos) ? o.productos : []).find((x: any) => Number(x.id) === productoId);
      if (!p) return json({ ok: false, mensaje: "Ese producto no está en la oferta." });
      if (Array.isArray(o.branch_ids) && o.branch_ids.length && !o.branch_ids.map(Number).includes(branchId)) {
        return json({ ok: false, mensaje: "La oferta no aplica en esa sucursal." });
      }
      // (2026-10-12, auditoría) Lo exclusivo es para socios: la pantalla ya lo
      // decía, pero el servidor no lo comprobaba y se podía reservar llamando
      // a la acción directo. Y la sala tiene que ser una farmacia.
      const [{ data: cs, error: eCs }, { data: salaR, error: eSalaR }] = await Promise.all([
        admin.from("customers").select("acepta_programa_puntos, acumula_puntos").eq("id", customerId).maybeSingle(),
        admin.from("branches").select("id").eq("id", branchId).eq("type", "FARMACIA").maybeSingle(),
      ]);
      if (eCs) throw eCs;
      if (eSalaR) throw eSalaR;
      if (!salaR) return json({ ok: false, mensaje: "Elige una sucursal válida." });
      if (o.exclusiva && !(cs?.acepta_programa_puntos !== false && cs?.acumula_puntos !== false)) {
        return json({ ok: false, mensaje: "Esta oferta es exclusiva para socios de Puntos Salud." });
      }
      // Exclusiva por nivel (2026-10-14): la pantalla ya no ofrece el botón,
      // pero el servidor es el que decide.
      if (o.nivel_minimo && !alcanzaNivel(o.nivel_minimo, await accesoDeNivel(customerId))) {
        return json({ ok: false, motivo: "nivel", mensaje: `Esta oferta es exclusiva para ${NOMBRE_EXCLUSIVA[o.nivel_minimo] ?? "otro nivel"}.` });
      }
      // Bajo receta (2026-10-12): se reserva igual, pero nace «en revisión» y
      // espera la foto de la receta (`receta_subir_url` / `receta_confirmar`).
      // La regla es la del libro (2026-10-19, `bajoReceta`).
      // Lo que se aparta (2026-10-19, decisión 5): la oferta se reserva en su
      // presentación MENOR (como `reserva_existencias`), y tiene que alcanzar
      // con lo DISPONIBLE de esa sala —existencia menos lo que ya apartaron
      // otras reservas—. Sin esto dos personas reservaban la última caja.
      const [rx, { data: facs, error: eFa }, disponibles] = await Promise.all([
        bajoReceta(admin, [productoId]),
        admin.from("product_precios").select("factor").eq("product_id", productoId).eq("activo", true).gt("vineta", 0),
        unidadesPorSala(admin, [productoId]).then((m) => m.get(productoId)?.get(branchId) ?? 0),
      ]);
      if (eFa) throw eFa;
      const conReceta = rx.has(productoId);
      const factorMenor = (facs ?? []).length ? Math.max(1, Math.min(...(facs ?? []).map((x: any) => Number(x.factor) || 1))) : 1;
      // La MUESTRA (ficha de prueba) se reserva igual, para ver el circuito.
      if (!ofertaId.startsWith("muestra-") && disponibles < cantidad * factorMenor) {
        const alcanza = alcanceDe(disponibles, factorMenor);
        return json({ ok: false, motivo: "sin_existencia", mensaje: alcanza > 0
          ? `En esa sucursal sólo alcanzan ${alcanza}. Pide menos o elige otra sucursal.`
          : "Esa sucursal ya no tiene para apartar. Elige otra sucursal." });
      }
      // Tope de activas y bloqueo por vencidas.
      const { data: suyas, error: eR } = await admin.from("app_reservas").select("id, estado, cerrada_at, pedido, vencida_motivo")
        .eq("customer_id", customerId).or(`estado.in.(en_revision,pendiente,lista),and(estado.eq.vencida,cerrada_at.gte.${new Date(Date.now() - 30 * 86400_000).toISOString()})`);
      if (eR) throw eR;
      // Un pedido del carrito cuenta como UNA reserva (2026-10-07).
      const activas = new Set((suyas ?? []).filter((r: any) => ["en_revision", "pendiente", "lista"].includes(r.estado)).map((r: any) => r.pedido ?? `r${r.id}`)).size;
      const vencidas = new Set((suyas ?? []).filter(vencidaDelCliente).map((r: any) => r.pedido ?? `r${r.id}`)).size;
      if (vencidas >= 3) return json({ ok: false, mensaje: "Tienes 3 reservas que no se retiraron este mes. Podrás reservar de nuevo en 30 días." });
      if (activas >= 3) return json({ ok: false, mensaje: "Ya tienes 3 reservas activas. Retira o cancela una para reservar otra." });
      const { data: nueva, error: eI } = await admin.from("app_reservas").insert({
        customer_id: customerId, branch_id: branchId, oferta_id: o.id, oferta_titulo: o.titulo, oferta_fin: o.fin,
        producto_id: productoId, producto_nombre: String(p.nombre), cantidad,
        precio_unitario: p.precio_descuento ?? null, precio_normal: p.precio ?? null, terminos_version: TERMINOS_RESERVA.version,
        factor: factorMenor,
        ...(conReceta ? { estado: "en_revision" } : {}),
      }).select("id").single();
      if (eI) throw eI;
      return json({ ok: true, id: nueva.id, codigo: `R-${String(nueva.id).padStart(6, "0")}`, receta: conReceta });
    }

    // ── El carrito (2026-10-07) ─────────────────────────────────────────
    // `carrito_existencias`: dónde hay de cada producto, para elegir sala.
    // `reservar_carrito`: reserva TODO el carrito en una sala, como un pedido
    // (`P-XXXXXX`): una fila de `app_reservas` por producto. El precio lo
    // calcula el servidor —nunca el que mande la app—: el VIP de esa
    // presentación (el socio paga VIP) o el de viñeta si no tiene.
    // El envío a domicilio (2026-10-07): lo configura el portal en `app_ajustes`.
    const ajustesEnvio = async () => {
      const { data, error } = await admin.from("app_ajustes").select("envio_activo, envio_costo, envio_gratis_desde, envio_nota").maybeSingle();
      if (error) console.error("app_ajustes:", error.message);
      return data ? { activo: !!data.envio_activo, costo: Number(data.envio_costo), gratis_desde: data.envio_gratis_desde == null ? null : Number(data.envio_gratis_desde), nota: data.envio_nota }
        : { activo: false, costo: 0, gratis_desde: null, nota: "" };
    };
    const costoDeEnvio = (cfg: { costo: number; gratis_desde: number | null }, subtotal: number) =>
      cfg.gratis_desde != null && subtotal >= cfg.gratis_desde ? 0 : cfg.costo;

    // Abrir el carrito o Mis reservas deja el cobro listo (token de Wompi).
    if (accion === "pago_preparar") return json({ ok: await calentarWompi() });

    if (accion === "carrito_existencias") {
      const ids = (Array.isArray(body?.ids) ? body.ids : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0).slice(0, 20);
      const envio = await ajustesEnvio();
      if (!ids.length) return json({ ok: true, existencias: [], salas: [], envio });
      const [{ data, error }, { data: salas, error: eS }, rec, unidades] = await Promise.all([
        admin.rpc("app_carrito_existencias", { p_ids: ids }),
        admin.from("branches").select("id, name, address").eq("type", "FARMACIA").order("name"),
        // `receta_ids` (2026-10-12): los que piden foto de la receta al reservar
        // (desde el 2026-10-19, con la regla del libro).
        bajoReceta(admin, ids),
        unidadesPorSala(admin, ids),
      ]);
      if (error) throw error;
      if (eS) throw eS;
      // `alcance` (2026-10-15): si la app manda `items` ({ id, factor }), por
      // cada uno y cada sala, cuántos de esa presentación alcanzan (tope 5,
      // contado en unidades). Así el carrito distingue «tiene todo» de «tiene
      // 1 de los 3 que pides».
      const pedidos = (Array.isArray(body?.items) ? body.items : []).slice(0, 20)
        .map((x: any) => ({ id: Number(x?.id), factor: Number(x?.factor) || 1 })).filter((x: any) => ids.includes(x.id));
      const alcance = pedidos.flatMap((x: any) => [...(unidades.get(x.id) ?? new Map<number, number>()).entries()]
        .map(([b, u]) => ({ product_id: x.id, factor: x.factor, branch_id: b, alcance: alcanceDe(u, x.factor) })));
      return json({ ok: true, envio, existencias: data ?? [], alcance, receta_ids: [...rec],
        salas: (salas ?? []).map((b: any) => ({ id: b.id, sala: sucursal(b.name), direccion: b.address })) });
    }

    // (2026-10-12, auditoría) Un enlace que sigue vivo se REUSA: antes cada
    // toque en «Pagar» creaba un cobro nuevo en Wompi y una fila más en
    // `app_reservas_pagos`. Vale si se creó hace menos de 25 min (Wompi lo
    // deja vivo 30: el margen es para que no venza con la hoja abierta), sigue
    // sin pagar y es por el MISMO monto — si el total cambió, se crea otro.
    // (2026-10-19) Devuelve también si el enlace es de PRUEBA (`enlace_prueba`,
    // anotado al crearlo): antes el reutilizado contestaba `prueba: false` fijo
    // y la app decía «pago» de un cobro que no era dinero.
    async function enlaceVigente(columna: "reserva_id" | "pedido" | "encargo_id", valor: string | number, monto: number): Promise<{ url: string; prueba: boolean } | null> {
      const { data, error } = await admin.from("app_reservas_pagos").select("enlace_url, monto, enlace_prueba")
        .eq(columna, valor).eq("estado", "creado").not("enlace_url", "is", null)
        .gte("created_at", new Date(Date.now() - 25 * 60_000).toISOString())
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) { console.error("app-clientes: no se pudo buscar un enlace vigente:", error.message); return null; }
      return data && Math.abs(Number(data.monto) - monto) < 0.005 ? { url: String(data.enlace_url), prueba: data.enlace_prueba === true } : null;
    }

    // Un enlace de Wompi por el total de un PEDIDO (una sola transacción).
    // deno-lint-ignore no-explicit-any
    // `reservas` (2026-10-19): los renglones que este cobro cubre. Si uno se
    // cierra antes de que llegue el pago, lo suyo queda a favor; uno que no
    // estaba en la lista no entró en el monto (`app_reserva_pago_confirmar`).
    async function enlaceDePago({ pedido, total, branchId, descripcion, reservas }: { pedido: string; total: number; branchId: any; descripcion: string; reservas: number[] }) {
      const vigente = await enlaceVigente("pedido", pedido, total);
      if (vigente) return { url: vigente.url, total, prueba: vigente.prueba, reutilizado: true };
      const identificador = `${pedido}-${Date.now().toString(36)}`;
      // En paralelo (2026-10-08): la sala, la fila del pago y el token de Wompi.
      const [{ data: salaFila, error: eS }, { error: eP }] = await Promise.all([
        admin.from("branches").select("name").eq("id", branchId).maybeSingle(),
        admin.from("app_reservas_pagos").insert({ pedido, identificador, monto: total, reservas_ids: reservas.length ? reservas : null }),
        calentarWompi(),
      ]);
      if (eS) throw eS;
      if (eP) throw eP;
      const base = `${Deno.env.get("SUPABASE_URL")}/functions/v1/wompi-pagos`;
      try {
        const enlace = await crearEnlace({
          identificador, monto: total, producto: `Pedido ${pedido} (${descripcion})`,
          descripcion: `Pedido ${pedido} · retiro en ${sucursal(salaFila?.name) ?? "sucursal"}`,
          urlRedirect: `${base}?ref=${encodeURIComponent(identificador)}`, urlWebhook: base, minutos: 30,
        });
        const url = enlace.urlEnlaceLargo || enlace.urlEnlace;
        // Anotar el enlace no hace esperar al cliente: el pago se reconoce por el identificador.
        const anotar = admin.from("app_reservas_pagos").update({ enlace_id: enlace.idEnlace, enlace_url: url, enlace_prueba: !enlace.estaProductivo }).eq("identificador", identificador)
          .then(({ error: eU }: any) => { if (eU) console.error("app-clientes: no se guardó el enlace del pedido:", eU.message); });
        try { (globalThis as any).EdgeRuntime?.waitUntil(anotar); } catch { /* sin waitUntil se termina igual */ }
        return { url, total, prueba: !enlace.estaProductivo };
      } catch (e) {
        console.error("app-clientes: wompi no creó el enlace del pedido:", (e as Error)?.message ?? e);
        return null;
      }
    }

    // ── Encargos (2026-10-07): lo que no hay en ninguna sucursal se solicita.
    // La sala del retiro y Bodega confirman precio y fecha (trigger
    // `app_encargos_avisar`); el cliente acepta pagando el anticipo (100 %).
    if (accion === "encargar") {
      const productId = Number(body?.product_id);
      const cantidad = Math.trunc(Number(body?.cantidad));
      const branchId = Number(body?.branch_id);
      if (!Number.isInteger(productId) || !(cantidad >= 1 && cantidad <= 20)) return json({ ok: false, mensaje: "Revisa el producto y la cantidad." });
      const [{ data: p, error: eP }, { data: sala, error: eS }, { data: oc, error: eO }] = await Promise.all([
        admin.from("products").select("id, nombre, activo, oculto_en_ventas").eq("id", productId).maybeSingle(),
        admin.from("branches").select("id").eq("id", branchId).eq("type", "FARMACIA").maybeSingle(),
        admin.from("app_catalogo_ocultos").select("product_id").eq("product_id", productId).maybeSingle(),
      ]);
      if (eP) throw eP; if (eS) throw eS; if (eO) throw eO;
      if (!p || p.activo === false || p.oculto_en_ventas || oc) return json({ ok: false, mensaje: "Este producto ya no está en la tienda." });
      // Bajo receta, con la regla del libro (2026-10-19): un encargo no lleva
      // revisión de receta en la app, así que se sigue pidiendo en la sucursal.
      if ((await bajoReceta(admin, [productId])).has(productId)) return json({ ok: false, mensaje: "Los productos bajo receta se encargan en la sucursal, con la receta." });
      if (!sala) return json({ ok: false, mensaje: "Elige la sucursal donde lo vas a retirar." });
      const { count, error: eC } = await admin.from("app_encargos").select("id", { count: "exact", head: true })
        .eq("customer_id", customerId).in("estado", ["solicitado", "confirmado", "aceptado", "pedido", "listo"]);
      if (eC) throw eC;
      if ((count ?? 0) >= 3) return json({ ok: false, mensaje: "Ya tienes 3 encargos en curso. Cuando llegue uno, podrás pedir otro." });
      const { data: pr, error: ePr } = await admin.from("product_precios").select("factor, presentaciones(tipo)").eq("product_id", productId).eq("activo", true)
        .eq("factor", Number(body?.factor) || 1).order("vineta", { ascending: false }).limit(1).maybeSingle();
      if (ePr) throw ePr;
      const nombre = `${p.nombre}${(pr as any)?.presentaciones?.tipo ? ` · ${(pr as any).presentaciones.tipo}` : ""}`.slice(0, 200);
      const { data: nuevo, error: eI } = await admin.from("app_encargos").insert({
        customer_id: customerId, branch_id: branchId, product_id: productId, producto_nombre: nombre,
        factor: Number(body?.factor) || 1, cantidad, nota_cliente: body?.nota ? String(body.nota).slice(0, 300) : null,
      }).select("id").single();
      if (eI) throw eI;
      return json({ ok: true, id: nuevo.id, codigo: `E-${String(nuevo.id).padStart(6, "0")}` });
    }

    if (accion === "mis_encargos") {
      const { data, error } = await admin.from("app_encargos")
        .select("id, estado, pago_estado, producto_nombre, cantidad, precio_unitario, anticipo, fecha_estimada, nota_sucursal, branch_id, created_at")
        .eq("customer_id", customerId).gte("created_at", new Date(Date.now() - 90 * 86400_000).toISOString())
        .order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      const { data: salas, error: eS } = await admin.from("branches").select("id, name");
      if (eS) throw eS;
      const nombre = new Map((salas ?? []).map((b: any) => [Number(b.id), sucursal(b.name)]));
      return json({ ok: true, encargos: (data ?? []).map((e: any) => ({ ...e, codigo: `E-${String(e.id).padStart(6, "0")}`, sala: nombre.get(Number(e.branch_id)) ?? null })) });
    }

    if (accion === "pagar_encargo") {
      const { data: e, error } = await admin.from("app_encargos").select("id, estado, pago_estado, anticipo, producto_nombre, branch_id")
        .eq("id", Number(body?.id)).eq("customer_id", customerId).maybeSingle();
      if (error) throw error;
      if (!e || e.estado !== "confirmado") return json({ ok: false, mensaje: "Este encargo todavía no está confirmado por la sucursal." });
      if (e.pago_estado === "pagado") return json({ ok: false, mensaje: "Este encargo ya está pagado." });
      const codigo = `E-${String(e.id).padStart(6, "0")}`;
      const vigenteE = await enlaceVigente("encargo_id", e.id, Number(e.anticipo));
      if (vigenteE) return json({ ok: true, url: vigenteE.url, total: Number(e.anticipo), prueba: vigenteE.prueba, reutilizado: true });
      const identificador = `${codigo}-${Date.now().toString(36)}`;
      const { error: eP } = await admin.from("app_reservas_pagos").insert({ encargo_id: e.id, identificador, monto: Number(e.anticipo) });
      if (eP) throw eP;
      const base = `${Deno.env.get("SUPABASE_URL")}/functions/v1/wompi-pagos`;
      try {
        const enlace = await crearEnlace({
          identificador, monto: Number(e.anticipo), producto: `Encargo ${codigo}: ${e.producto_nombre}`.slice(0, 120),
          descripcion: `Anticipo del encargo ${codigo}`, urlRedirect: `${base}?ref=${encodeURIComponent(identificador)}`, urlWebhook: base, minutos: 30,
        });
        const url = enlace.urlEnlaceLargo || enlace.urlEnlace;
        const { error: eU } = await admin.from("app_reservas_pagos").update({ enlace_id: enlace.idEnlace, enlace_url: url, enlace_prueba: !enlace.estaProductivo }).eq("identificador", identificador);
        if (eU) console.error("app-clientes: no se guardó el enlace del encargo:", eU.message);
        return json({ ok: true, url, total: Number(e.anticipo), prueba: !enlace.estaProductivo });
      } catch (err) {
        console.error("app-clientes: wompi no creó el enlace del encargo:", (err as Error)?.message ?? err);
        return json({ ok: false, mensaje: "El pago en línea no está disponible ahora. Intenta en un rato." });
      }
    }

    if (accion === "cancelar_encargo") {
      const { data, error } = await admin.from("app_encargos")
        .update({ estado: "cancelado", cerrado_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", Number(body?.id)).eq("customer_id", customerId).in("estado", ["solicitado", "confirmado"]).neq("pago_estado", "pagado").select("id");
      if (error) throw error;
      return json(data?.length ? { ok: true } : { ok: false, mensaje: "Ese encargo ya no se puede cancelar desde la app. Escríbele a la sucursal." });
    }

    // ── Pedir ser Cliente Mayorista (2026-10-08): queda «en revisión» y lo
    // decide Administración en el portal (Procedimiento de Clientes §3).
    if (accion === "solicitar_mayorista") {
      const { data, error } = await admin.rpc("mayorista_solicitar_app", { p_customer: customerId, p_nota: String(body?.nota ?? "") });
      if (error) throw error;
      return json(data);
    }

    // ── Mis créditos (2026-10-15): sólo LECTURA, sin pagos ──────────────
    // Los créditos con saldo de ESTA ficha (la de la sesión, nunca una que
    // mande el teléfono), del espejo `creditos_de_clientes`. El estado sale de
    // `estadoDeCredito`, la política del portal. El número es el del documento
    // tal como lo conoce el cliente (el mismo recorte que «Mis facturas»).
    if (accion === "mis_creditos") {
      if (!customerId) return json({ ok: true, creditos: [], total: 0, vencidos: 0 });
      const [{ data, error }, { data: salas, error: eSalas }] = await Promise.all([
        admin.from("creditos_de_clientes")
          .select("id, branch_id, numero_doc, tipo_doc, fecha, total, saldo")
          .eq("customer_id", customerId).gt("saldo", 0.004)
          .order("fecha", { ascending: true }).limit(200),
        salasDeLaRed(admin),
      ]);
      if (error) throw error;
      if (eSalas) console.error("mis_creditos: no se pudieron leer las salas:", eSalas.message);
      const nombreSala = new Map((salas ?? []).map((b: any) => [Number(b.id), sucursal(b.name)]));
      const numero = (c: unknown) => (c == null ? null : String(c).split("_")[0].replace(/^0+(?=\d)/, ""));
      const creditos = (data ?? []).map((c: any) => {
        const saldo = Number(c.saldo);
        return {
          id: c.id, numero: numero(c.numero_doc),
          tipo: String(c.tipo_doc ?? "").toUpperCase() === "CCF" ? "credito_fiscal" : "consumidor_final",
          fecha: c.fecha, total: Number(c.total), saldo,
          sala: nombreSala.get(Number(c.branch_id)) ?? null,
          ...estadoDeCredito(c.fecha, saldo),
        };
      });
      const centavos = creditos.reduce((s: number, c: any) => s + Math.round(c.saldo * 100), 0);
      return json({
        ok: true, creditos, total: centavos / 100,
        vencidos: creditos.filter((c: any) => c.estado === "vencido").length,
        plazo_dias: PLAZO_CREDITO,
      });
    }

    // ── Recordatorios de tratamiento (2026-10-07) ───────────────────────
    if (accion === "mis_tratamientos") {
      const { data, error } = await admin.rpc("app_tratamientos_de", { p_customer: customerId });
      if (error) throw error;
      return json({ ok: true, tratamientos: data ?? [] });
    }
    if (accion === "tratamiento_cambiar") {
      const { error } = await admin.rpc("app_tratamiento_cambiar", {
        p_customer: customerId, p_id: Number(body?.id), p_activo: body?.activo === true, p_motivo: String(body?.motivo ?? ""),
      });
      if (error) return json({ ok: false, mensaje: error.code === "P0001" && error.message ? error.message : "No se pudo guardar." });
      return json({ ok: true });
    }

    // ── Encuestas en la app (2026-10-07): las publicadas con el canal «app»
    // que este cliente no ha respondido; responder acredita los puntos solo.
    if (accion === "mis_encuestas") {
      const { data, error } = await admin.rpc("encuesta_app_disponibles", { p_customer: customerId });
      if (error) throw error;
      return json({ ok: true, encuestas: data ?? [] });
    }
    if (accion === "responder_encuesta") {
      const { data, error } = await admin.rpc("encuesta_app_responder", {
        p_customer: customerId, p_id: String(body?.id ?? ""), p_respuestas: body?.respuestas ?? {},
        p_duracion: Number.isFinite(Number(body?.duracion)) ? Math.round(Number(body.duracion)) : null,
      });
      if (error) return json({ ok: false, mensaje: error.code === "P0001" && error.message ? error.message : "No se pudo enviar." });
      return json(data);
    }

    // ── Mis facturas (2026-10-07; rehecha 2026-10-09): consumidor final y
    // crédito fiscal, con el PDF y el JSON del documento (el archivo que el
    // portal guarda en `sales-dte`). Las anuladas salen marcadas y con sus
    // documentos; las notas de crédito, DEBAJO de la factura que corrigen.
    //
    // `periodo`: «reciente» (por defecto) = este mes y el anterior en El
    // Salvador; «todo» = las más recientes hasta el tope (deliberado, menor que
    // el techo de 1000 filas — y el cliente se entera si se llegó a él).
    //
    // Las notas de crédito de venta TODAVÍA NO llegan a `sales_invoices` (medido
    // el 2026-10-09: sólo hay COF y CCF). El amarre se deja escrito para el día
    // que lleguen: una nota trae `relacionada` = id de la factura que corrige;
    // sin eso sale suelta. Las muestras (cuenta de prueba) ya lo usan.
    // Documentos de factura (ver `documentoGuardado`, más abajo): la firma
    // dura un día, lo que este proceso ya está bajando no se pide dos veces, y
    // lo que no hace esperar al cliente sigue después de contestar. Declarados
    // ANTES de `mis_facturas`, que precarga (un `const` leído antes de su
    // línea lanza).
    const FIRMA_DOC = 24 * 3600;
    // deno-lint-ignore no-explicit-any
    const enCurso: Map<string, Promise<any>> = ((globalThis as any).__appClientesDocsEnCurso ??= new Map());
    // Lo que no hace esperar al cliente: sigue después de contestar.
    const enSegundoPlano = (p: Promise<unknown>) => {
      const q = p.catch((e) => console.error("app-clientes: precarga de documento:", (e as Error)?.message ?? e));
      try { (globalThis as any).EdgeRuntime?.waitUntil(q); } catch { /* sin waitUntil se termina igual */ }
    };
    if (accion === "mis_facturas") {
      const todo = body?.periodo === "todo";
      const [a0, m0] = hoySV().split("-").map(Number);
      const desde = todo ? null : `${m0 === 1 ? a0 - 1 : a0}-${String(m0 === 1 ? 12 : m0 - 1).padStart(2, "0")}-01`;
      // Paginada (2026-10-09): de a 30, por CURSOR (la última fecha·hora·id que
      // se mostró) y no por número de página — si entra una factura nueva
      // mientras se baja, no se repite ni se salta ninguna. Hay clientes con
      // decenas de miles de facturas.
      const POR_PAGINA = 30;
      const antes = body?.antes && typeof body.antes === "object" ? body.antes : null;
      const fechaOk = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ""));
      const horaOk = (v: unknown) => /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(String(v ?? ""));
      let q = admin.from("sales_invoices")
        .select("id, fecha, hora, tipo_documento, correlativo, total, codigo_generacion, branch_id, estado")
        .eq("customer_id", customerId)
        .order("fecha", { ascending: false }).order("hora", { ascending: false }).order("id", { ascending: false })
        .limit(30); // = POR_PAGINA
      if (desde) q = q.gte("fecha", desde);
      if (antes && fechaOk(antes.fecha) && horaOk(antes.hora) && Number.isFinite(Number(antes.id))) {
        const F = antes.fecha, H = antes.hora, I = Number(antes.id);
        q = q.or(`fecha.lt.${F},and(fecha.eq.${F},hora.lt.${H}),and(fecha.eq.${F},hora.eq.${H},id.lt.${I})`);
      }
      const { data, error } = await q;
      if (error) throw error;
      const ultima = (data ?? [])[(data ?? []).length - 1];
      const siguiente = (data ?? []).length === POR_PAGINA && ultima ? { fecha: ultima.fecha, hora: ultima.hora, id: ultima.id } : null;
      const { data: salas, error: eS } = await admin.from("branches").select("id, name");
      if (eS) throw eS;
      const nombre = new Map((salas ?? []).map((b: any) => [Number(b.id), sucursal(b.name)]));

      // Muestras de la cuenta de prueba (`tipo = 'factura'`). Sus documentos
      // son los de una factura real de la MISMA ficha (`documento_de`).
      // Las muestras van sólo en la primera página.
      const muestras = antes ? [] : (await muestrasDe(admin, customerId, "factura"))
        .filter((m: any) => m.fecha && (!desde || String(m.fecha) >= desde));
      const prestadas = [...new Set(muestras.map((m: any) => Number(m.documento_de)).filter((n: number) => n > 0))];
      const docDe = new Map<number, any>();
      if (prestadas.length) {
        const { data: ds, error: eD } = await admin.from("sales_invoices").select("id, fecha, codigo_generacion")
          .in("id", prestadas).eq("customer_id", customerId);
        if (eD) throw eD;
        for (const x of ds ?? []) if (x.codigo_generacion) docDe.set(Number(x.id), x);
      }

      const ruta = (f: any) => {
        if (!f?.codigo_generacion) return null;
        const [a, m] = String(f.fecha).split("-");
        return `${a}/${m}/${String(f.codigo_generacion).toUpperCase()}`;
      };
      const filas = (data ?? []).filter((f: any) => f.codigo_generacion);
      const base = [...filas.map(ruta), ...[...docDe.values()].map(ruta)].filter(Boolean) as string[];
      const rutas = [...new Set(base)].flatMap((r) => [`${r}.pdf`, `${r}.json`]);
      const firmadas = new Map<string, string>();
      if (rutas.length) {
        const { data: fs, error: eF } = await admin.storage.from("sales-dte").createSignedUrls(rutas, FIRMA_DOC);
        if (eF) console.error("mis_facturas: no se firmaron:", eF.message);
        for (const f of fs ?? []) if (f.path && f.signedUrl && !f.error) firmadas.set(f.path, f.signedUrl);
      }
      const numero = (c: unknown) => (c == null ? null : String(c).split("_")[0].replace(/^0+(?=\d)/, ""));
      const tipoDe = (t: unknown) => {
        const s = String(t ?? "").toUpperCase();
        return s === "CCF" ? "credito_fiscal" : s === "NC" || s === "NCR" ? "nota_credito" : "consumidor_final";
      };

      // deno-lint-ignore no-explicit-any
      const docs: any[] = [
        ...filas.map((f: any) => {
          const r = ruta(f);
          return {
            id: f.id, clave: String(f.id), fecha: f.fecha, hora: f.hora, total: Number(f.total),
            numero: numero(f.correlativo), tipo: tipoDe(f.tipo_documento), anulada: !venta_valida_js(f.estado),
            sala: nombre.get(Number(f.branch_id)) ?? null, relacionada: null,
            pdf: firmadas.get(`${r}.pdf`) ?? null, json: firmadas.get(`${r}.json`) ?? null,
          };
        }),
        ...muestras.map((m: any) => {
          const r = ruta(docDe.get(Number(m.documento_de)));
          return {
            id: `muestra-${m.id}`, clave: m.clave ? String(m.clave) : `muestra-${m.id}`, fecha: m.fecha, hora: m.hora ?? null,
            total: Number(m.total ?? 0), numero: m.numero ? String(m.numero) : null, tipo: tipoDe(m.tipo_documento),
            anulada: m.anulada === true, sala: sucursal(m.sala) ?? null,
            relacionada: m.relacionada == null ? null : String(m.relacionada),
            pdf: r ? firmadas.get(`${r}.pdf`) ?? null : null, json: r ? firmadas.get(`${r}.json`) ?? null : null,
            sin_documento: !r,
          };
        }),
      ];
      // Precarga (2026-10-14): las más recientes de la primera página cuyo PDF
      // todavía no está guardado se bajan del emisor DESPUÉS de contestar, así
      // el «Ver PDF» de lo que el cliente casi siempre abre (lo último) ya sale
      // del almacenamiento. Acotada: 3 por llamada, de los últimos 60 días, y
      // de a una para no cargarle al emisor una ráfaga.
      if (!antes) {
        const limite = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10);
        const faltan = filas.filter((f: any) => String(f.fecha) >= limite && !firmadas.has(`${ruta(f)}.pdf`)).slice(0, 3);
        if (faltan.length) {
          enSegundoPlano((async () => {
            for (const f of faltan) {
              await documentoGuardado(f, "pdf");
              await documentoGuardado(f, "json");
            }
          })());
        }
      }
      // Cada nota de crédito, debajo de su factura (si la factura está en la lista).
      const porClave = new Map(docs.filter((d) => d.tipo !== "nota_credito").map((d) => [d.clave, d]));
      // deno-lint-ignore no-explicit-any
      const sueltas: any[] = [];
      for (const d of docs) {
        const madre = d.tipo === "nota_credito" && d.relacionada ? porClave.get(d.relacionada) : null;
        if (madre) (madre.notas ??= []).push(d); else sueltas.push(d);
      }
      const orden = (x: any, y: any) => `${y.fecha} ${y.hora ?? ""}`.localeCompare(`${x.fecha} ${x.hora ?? ""}`);
      for (const d of sueltas) d.notas?.sort(orden);
      return json({
        ok: true, periodo: todo ? "todo" : "reciente", desde, siguiente,
        facturas: sueltas.sort(orden),
      });
    }

    // El documento (PDF o JSON) de una factura del cliente, guardado en
    // `sales-dte`: si todavía no estaba, se baja del emisor y se guarda (igual
    // que `sync-sales-dte`). Devuelve la ruta (y, si se pidió, la dirección ya
    // firmada), o el mensaje para el cliente. La usan `factura_documento`,
    // `facturas_enviar` y la precarga de `mis_facturas`.
    //
    // Por qué tardaba (medido el 2026-10-14): de 39,152 facturas con ficha de
    // los últimos 60 días, sólo 20 tenían el PDF guardado — o sea que CASI CADA
    // apertura le pedía el PDF al emisor (1.4 s a 5.6 s medidos, 10 s en el
    // registro) y después firmaba DOS veces. Ahora: la firma de la consulta es
    // la que se devuelve (una ida menos), lo que ya se está bajando en este
    // proceso no se pide dos veces, y `mis_facturas` deja guardadas de
    // antemano las más recientes que falten.
    // deno-lint-ignore no-explicit-any
    async function documentoGuardado(f: any, formato: "pdf" | "json", firmar = false): Promise<{ ruta: string; url?: string } | { mensaje: string }> {
      if (!f?.codigo_generacion) return { mensaje: "Esta factura no tiene documento electrónico." };
      const cg = String(f.codigo_generacion).toUpperCase();
      const [a, m] = String(f.fecha).split("-");
      const ruta = `${a}/${m}/${cg}.${formato}`;
      // Firmar es la consulta por llave: si el objeto no existe, no hay firma
      // (y el error es «not found», el esperado: se baja del emisor).
      const { data: ya, error: eYa } = await admin.storage.from("sales-dte").createSignedUrl(ruta, FIRMA_DOC);
      if (ya?.signedUrl) return { ruta, url: ya.signedUrl };
      if (eYa && !/not.?found/i.test(eYa.message)) console.error("documento: no se pudo consultar el guardado:", eYa.message);
      let trabajo = enCurso.get(ruta);
      if (!trabajo) {
        trabajo = (async (): Promise<{ ruta: string } | { mensaje: string }> => {
          const origen = `https://clientesdte3.oss.com.sv/farma_salud/downloads/dteqr_${formato}.php?codigoGeneracion=${cg}`;
          let buf: Uint8Array | null = null;
          try {
            const res = await fetch(origen, { signal: AbortSignal.timeout(30_000) });
            if (res.ok) buf = new Uint8Array(await res.arrayBuffer());
          } catch (e) { console.error("documento:", (e as Error)?.message); }
          const valido = buf && buf.byteLength > 4 && (formato === "pdf"
            ? buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46
            : (() => { try { return Boolean(JSON.parse(new TextDecoder().decode(buf!))?.identificacion?.numeroControl); } catch { return false; } })());
          if (!valido) return { mensaje: "El documento todavía no está disponible. Intenta más tarde o pídelo en la sucursal." };
          const { error: eU } = await admin.storage.from("sales-dte").upload(ruta, buf!, { contentType: formato === "pdf" ? "application/pdf" : "application/json", upsert: true });
          if (eU) throw eU;
          return { ruta };
        })().finally(() => enCurso.delete(ruta));
        enCurso.set(ruta, trabajo);
      }
      const hecho = await trabajo;
      if ("mensaje" in hecho || !firmar) return hecho;
      const { data: s, error: eS } = await admin.storage.from("sales-dte").createSignedUrl(ruta, FIRMA_DOC);
      if (eS) console.error("documento: no se firmó:", eS.message);
      return { ruta, url: s?.signedUrl };
    }

    // El PDF o el JSON de una factura: si ya está guardado, sale la firma de
    // la consulta (una sola ida al almacenamiento); si no, se baja, se guarda
    // (igual que `sync-sales-dte`) y se firma. Al bajar el PDF, el JSON de la
    // misma factura se guarda detrás, sin hacer esperar. Sólo del cliente. Una
    // muestra (`muestra-N`) usa el documento de la factura real que presta.
    if (accion === "factura_documento") {
      const formato = body?.formato === "json" ? "json" : "pdf";
      let idFactura = Number(body?.id);
      if (String(body?.id ?? "").startsWith("muestra-")) {
        const m = (await muestrasDe(admin, customerId, "factura")).find((x: any) => `muestra-${x.id}` === String(body.id));
        idFactura = Number(m?.documento_de);
        if (!idFactura) return json({ ok: false, mensaje: "Este ejemplo no tiene documento." });
      }
      const { data: f, error } = await admin.from("sales_invoices").select("id, fecha, codigo_generacion")
        .eq("id", idFactura).eq("customer_id", customerId).maybeSingle();
      if (error) throw error;
      const doc = await documentoGuardado(f, formato, true);
      if ("mensaje" in doc) return json({ ok: false, mensaje: doc.mensaje });
      if (formato === "pdf" && f) enSegundoPlano(documentoGuardado(f, "json"));
      return json(doc.url ? { ok: true, url: doc.url } : { ok: false, mensaje: "No se pudo preparar el documento." });
    }

    // ── Facturas por correo (2026-10-09) ─────────────────────────────────
    // `facturas_enviar` {ids, correo}: manda el PDF y el JSON de varias
    // facturas a un correo. Las facturas tienen que ser de ESTA ficha (las
    // muestras `muestra-N` de la cuenta de prueba prestan el documento de una
    // factura real de la misma ficha). Topes: 30 facturas por correo y 10
    // correos enviados por día por ficha.
    //
    // Adjuntos o enlaces: van ADJUNTOS mientras el total quepa holgado en un
    // correo (8 MB sin codificar: el proveedor acepta 40 MB ya codificados y
    // muchos buzones cortan en 10-25 MB). Si no cabe, el correo lleva enlaces
    // firmados que valen 7 días — el cliente igual recibe todo, y un correo
    // que el buzón rechaza no le sirve a nadie.
    //
    // Proveedor: Resend (como `distribucion-correo`): `RESEND_API_KEY` +
    // `CORREO_REMITENTE_CLIENTES` (o `CORREO_REMITENTE`), con el dominio
    // verificado. Sin eso contesta «todavía no está disponible» y no registra.
    //
    // Los correos usados se guardan en `app_cliente_correos` (en el servidor:
    // así siguen ahí al cambiar de teléfono). `correos_lista` los devuelve con
    // el de la ficha primero; `correo_borrar` quita uno guardado.
    const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    const TOPE_FACTURAS_CORREO = 30;
    const TOPE_CORREOS_DIA = 10;
    const TOPE_CORREOS_GUARDADOS = 10;
    const limpiarCorreo = (v: unknown) => String(v ?? "").trim().toLowerCase();
    const correoOk = (c: string) => c.length <= 254 && CORREO_VALIDO.test(c);

    if (accion === "correos_lista") {
      if (!customerId) return json({ ok: true, correos: [] });
      const [{ data: c, error: eC }, { data: g, error: eG }] = await Promise.all([
        admin.from("customers").select("email").eq("id", customerId).maybeSingle(),
        admin.from("app_cliente_correos").select("correo, usado_at").eq("customer_id", customerId)
          .order("usado_at", { ascending: false }).limit(TOPE_CORREOS_GUARDADOS),
      ]);
      if (eC) throw eC;
      if (eG) throw eG;
      const ficha = limpiarCorreo(c?.email);
      const correos = [
        ...(correoOk(ficha) ? [{ correo: ficha, de_ficha: true, usado_at: null }] : []),
        // deno-lint-ignore no-explicit-any
        ...(g ?? []).filter((x: any) => x.correo !== ficha).map((x: any) => ({ correo: x.correo, de_ficha: false, usado_at: x.usado_at })),
      ];
      return json({ ok: true, correos });
    }

    if (accion === "correo_borrar") {
      if (!customerId) return json({ ok: true });
      const correo = limpiarCorreo(body?.correo);
      const { error } = await admin.from("app_cliente_correos").delete().eq("customer_id", customerId).eq("correo", correo);
      if (error) throw error;
      return json({ ok: true });
    }

    if (accion === "facturas_enviar") {
      if (!customerId) return json({ ok: false, mensaje: "Completa tu registro en una sucursal para recibir tus facturas." });
      const correo = limpiarCorreo(body?.correo);
      if (!correoOk(correo)) return json({ ok: false, mensaje: "Ese correo no parece válido. Revísalo e intenta de nuevo." });
      const ids = [...new Set((Array.isArray(body?.ids) ? body.ids : []).map((x: unknown) => String(x ?? "").trim()).filter(Boolean))] as string[];
      if (!ids.length) return json({ ok: false, mensaje: "Elige al menos una factura." });
      if (ids.length > TOPE_FACTURAS_CORREO) return json({ ok: false, mensaje: `Puedes enviar hasta ${TOPE_FACTURAS_CORREO} facturas por correo.` });

      const { count: hoyEnviados, error: eCnt } = await admin.from("app_cliente_correo_envios")
        .select("id", { count: "exact", head: true }).eq("customer_id", customerId).eq("enviado", true)
        .gte("created_at", new Date(Date.now() - 86400_000).toISOString());
      if (eCnt) throw eCnt;
      if ((hoyEnviados ?? 0) >= TOPE_CORREOS_DIA) {
        return json({ ok: false, mensaje: `Ya enviaste ${TOPE_CORREOS_DIA} correos en las últimas 24 horas. Intenta más tarde o descarga tus facturas.` });
      }
      const llave = Deno.env.get("RESEND_API_KEY");
      const remitente = Deno.env.get("CORREO_REMITENTE_CLIENTES") ?? Deno.env.get("CORREO_REMITENTE");
      if (!llave || !remitente) {
        console.error("facturas_enviar: falta RESEND_API_KEY o CORREO_REMITENTE_CLIENTES");
        return json({ ok: false, mensaje: "El envío por correo todavía no está disponible. Mientras tanto, puedes descargar tus facturas." });
      }

      // Qué factura real hay detrás de cada id (las muestras prestan una).
      const tipoDoc = (t: unknown) => {
        const s = String(t ?? "").toUpperCase();
        return s === "CCF" ? "Crédito fiscal" : s === "NC" || s === "NCR" ? "Nota de crédito" : "Factura";
      };
      const numeroDe = (c: unknown) => (c == null ? null : String(c).split("_")[0].replace(/^0+(?=\d)/, ""));
      const muestras = ids.some((i) => i.startsWith("muestra-")) ? await muestrasDe(admin, customerId, "factura") : [];
      const pedidos: { id: string; real: number; muestra: any }[] = [];
      for (const id of ids) {
        if (id.startsWith("muestra-")) {
          const m = muestras.find((x: any) => `muestra-${x.id}` === id);
          if (!m) return json({ ok: false, mensaje: "Alguna de las facturas elegidas no es de tu cuenta." });
          if (!Number(m.documento_de)) return json({ ok: false, mensaje: "Uno de los ejemplos no tiene documento." });
          pedidos.push({ id, real: Number(m.documento_de), muestra: m });
        } else {
          if (!/^\d+$/.test(id)) return json({ ok: false, mensaje: "Alguna de las facturas elegidas no es de tu cuenta." });
          pedidos.push({ id, real: Number(id), muestra: null });
        }
      }
      const reales = [...new Set(pedidos.map((p) => p.real))];
      // ≤ 30 ids únicos (`id` es la llave): la respuesta no se acerca al techo de 1000.
      const { data: fs, error: eF } = await admin.from("sales_invoices")
        .select("id, fecha, codigo_generacion, tipo_documento, correlativo, total")
        .in("id", reales).eq("customer_id", customerId);
      if (eF) throw eF;
      const porId = new Map((fs ?? []).map((f: any) => [Number(f.id), f]));
      if (reales.some((r) => !porId.has(r))) return json({ ok: false, mensaje: "Alguna de las facturas elegidas no es de tu cuenta." });

      // Los dos documentos de cada factura, de a 5 a la vez.
      const rutas = new Map<string, string>(); // `${id}.${formato}` → ruta
      const tareas = reales.flatMap((r) => (["pdf", "json"] as const).map((fmt) => ({ r, fmt })));
      for (let i = 0; i < tareas.length; i += 5) {
        const tanda = await Promise.all(tareas.slice(i, i + 5).map(async ({ r, fmt }) => ({ r, fmt, doc: await documentoGuardado(porId.get(r), fmt) })));
        for (const { r, fmt, doc } of tanda) {
          if ("mensaje" in doc) {
            const f = porId.get(r);
            return json({ ok: false, mensaje: `${tipoDoc(f?.tipo_documento)} N.º ${numeroDe(f?.correlativo) ?? r}: ${doc.mensaje}` });
          }
          rutas.set(`${r}.${fmt}`, doc.ruta);
        }
      }

      // Lo que ve el cliente de cada documento, y el nombre de sus archivos.
      const usados = new Set<string>();
      const renglones = pedidos.map((p) => {
        const f = porId.get(p.real);
        const tipo = p.muestra ? tipoDoc(p.muestra.tipo_documento) : tipoDoc(f.tipo_documento);
        const numero = p.muestra ? (p.muestra.numero ? String(p.muestra.numero) : null) : numeroDe(f.correlativo);
        const fechaDoc = String(p.muestra?.fecha ?? f.fecha);
        const total = Number(p.muestra ? p.muestra.total ?? 0 : f.total ?? 0);
        let base = `${tipo.replace(/[^A-Za-z]+/g, "-").replace(/-+$/, "")}-${String(numero ?? fechaDoc).replace(/[^A-Za-z0-9-]/g, "")}`;
        for (let n = 2; usados.has(base); n++) base = `${base.replace(/_\d+$/, "")}_${n}`;
        usados.add(base);
        return { p, f, tipo, numero, fechaDoc, total, base, pdf: rutas.get(`${p.real}.pdf`)!, json: rutas.get(`${p.real}.json`)! };
      });

      // Adjuntos si caben; si no, enlaces de 7 días.
      const MAX_ADJUNTOS = 8 * 1024 * 1024;
      const b64 = (bytes: Uint8Array) => {
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(bin);
      };
      const bytesDe = new Map<string, Uint8Array>();
      let peso = 0;
      let modo: "adjuntos" | "enlaces" = "adjuntos";
      const unicas = [...new Set(renglones.flatMap((r) => [r.pdf, r.json]))];
      for (let i = 0; i < unicas.length && modo === "adjuntos"; i += 6) {
        const tanda = await Promise.all(unicas.slice(i, i + 6).map(async (ruta) => {
          const { data, error } = await admin.storage.from("sales-dte").download(ruta);
          if (error) throw error;
          return [ruta, new Uint8Array(await data.arrayBuffer())] as const;
        }));
        for (const [ruta, bytes] of tanda) { bytesDe.set(ruta, bytes); peso += bytes.byteLength; }
        if (peso > MAX_ADJUNTOS) modo = "enlaces";
      }
      const enlaces = new Map<string, string>();
      if (modo === "enlaces") {
        bytesDe.clear();
        const { data: sf, error: eSf } = await admin.storage.from("sales-dte").createSignedUrls(unicas, 7 * 86400);
        if (eSf) throw eSf;
        for (const s of sf ?? []) if (s.path && s.signedUrl && !s.error) enlaces.set(s.path, s.signedUrl);
        if (unicas.some((r) => !enlaces.has(r))) return json({ ok: false, mensaje: "No se pudieron preparar los documentos. Intenta de nuevo." });
      }

      const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
      const dinero = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const fechaLarga = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
      const uno = renglones.length === 1;
      const asunto = uno
        ? `${renglones[0].tipo}${renglones[0].numero ? ` N.º ${renglones[0].numero}` : ""} — Farmacia Salud`
        : `Tus ${renglones.length} facturas — Farmacia Salud`;
      const filasHtml = renglones.map((r) => `<tr>
<td style="padding:8px 0;border-bottom:1px solid #eef1f4">${esc(r.tipo)}${r.numero ? ` N.º ${esc(r.numero)}` : ""}<br><span style="color:#5b6675;font-size:12px">${esc(fechaLarga(r.fechaDoc))}</span></td>
<td style="padding:8px 0;border-bottom:1px solid #eef1f4;text-align:right;font-family:monospace">${esc(dinero(r.total))}${modo === "enlaces"
        ? `<br><a href="${esc(enlaces.get(r.pdf))}" style="color:#0f6e7d;font-size:12px">PDF</a> · <a href="${esc(enlaces.get(r.json))}" style="color:#0f6e7d;font-size:12px">JSON</a>` : ""}</td></tr>`).join("");
      const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1c2430">
<table role="presentation" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px" width="100%"><tr><td>
<p style="margin:0 0 4px;font-size:13px;color:#5b6675">Farmacia Salud</p>
<h1 style="margin:0 0 16px;font-size:20px">${uno ? "Tu documento electrónico" : "Tus documentos electrónicos"}</h1>
<p style="margin:0 0 16px;font-size:14px">${modo === "adjuntos"
        ? `Te enviamos ${uno ? "tu documento" : "tus documentos"} desde la app Puntos Salud. Cada uno va adjunto en PDF (para ver o imprimir) y en JSON (el archivo electrónico).`
        : "Te enviamos tus documentos desde la app Puntos Salud. Como son muchos para adjuntarlos, aquí tienes los enlaces para descargarlos: valen 7 días."}</p>
<table role="presentation" width="100%" style="border-collapse:collapse;font-size:13px">${filasHtml}</table>
<p style="margin:16px 0 0;font-size:12px;color:#8a94a3">Si no pediste este correo, puedes ignorarlo.</p>
</td></tr></table></body></html>`;
      const attachments = modo === "adjuntos"
        ? renglones.flatMap((r) => [
          { filename: `${r.base}.pdf`, content: b64(bytesDe.get(r.pdf)!) },
          { filename: `${r.base}.json`, content: b64(bytesDe.get(r.json)!) },
        ])
        : undefined;

      // Se anota ANTES de mandar: si el registro falla, no sale nada.
      const { data: envio, error: eIns } = await admin.from("app_cliente_correo_envios").insert({
        customer_id: customerId, correo, facturas: ids, cantidad: ids.length, modo,
      }).select("id").single();
      if (eIns) throw eIns;

      const huella = (await sha256(`${customerId}|${correo}|${[...ids].sort().join(",")}`)).slice(0, 24);
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${llave}`, "Content-Type": "application/json", "Idempotency-Key": `facturas-${huella}-${Math.floor(Date.now() / 60_000)}` },
        body: JSON.stringify({ from: remitente, to: [correo], subject: asunto, html, attachments }),
        signal: AbortSignal.timeout(45_000),
      }).catch((e) => ({ ok: false, status: 0, text: async () => (e as Error).message }) as unknown as Response);
      const texto = await r.text();
      let proveedorId: string | null = null;
      if (r.ok) { try { proveedorId = JSON.parse(texto).id ?? null; } catch { /* sin id */ } }
      const { error: eUpd } = await admin.from("app_cliente_correo_envios")
        .update({ enviado: r.ok, proveedor_id: proveedorId, error: r.ok ? null : `${r.status}: ${texto.slice(0, 300)}` })
        .eq("id", envio.id);
      if (eUpd) console.error("facturas_enviar: no se anotó el resultado:", eUpd.message);
      if (!r.ok) {
        console.error("facturas_enviar:", r.status, texto.slice(0, 300));
        return json({ ok: false, mensaje: "No se pudo enviar el correo. Intenta de nuevo en un rato." });
      }

      // El correo queda guardado para la próxima vez (tope 10 por ficha), y el
      // registro de envíos de esta ficha se purga a los 365 días.
      const { error: eG } = await admin.from("app_cliente_correos")
        .upsert({ customer_id: customerId, correo, usado_at: new Date().toISOString() }, { onConflict: "customer_id,correo" });
      if (eG) console.error("facturas_enviar: no se guardó el correo:", eG.message);
      else {
        const { data: viejos, error: eV } = await admin.from("app_cliente_correos").select("id").eq("customer_id", customerId)
          .order("usado_at", { ascending: false }).range(TOPE_CORREOS_GUARDADOS, TOPE_CORREOS_GUARDADOS + 50);
        if (eV) console.error("facturas_enviar: no se leyeron los guardados:", eV.message);
        else if (viejos?.length) {
          const { error: eB } = await admin.from("app_cliente_correos").delete().in("id", viejos.map((v: any) => v.id));
          if (eB) console.error("facturas_enviar: no se recortaron los guardados:", eB.message);
        }
      }
      const { error: ePurga } = await admin.from("app_cliente_correo_envios").delete().eq("customer_id", customerId)
        .lt("created_at", new Date(Date.now() - 365 * 86400_000).toISOString());
      if (ePurga) console.error("facturas_enviar: no se purgó el registro:", ePurga.message);

      return json({ ok: true, enviado: true, correo, cantidad: ids.length, modo });
    }

    // ── Modo de prueba: avisos de muestra al teléfono (2026-10-07) ───────
    // Sólo la cuenta de prueba. Manda el aviso de verdad (bandeja + push) para
    // ver la notificación y la pantalla que abre.
    if (accion === "prueba_aviso") {
      if (!(await esDePrueba(customerId))) return json({ ok: false, mensaje: "Sólo en la cuenta de prueba." });
      const TIPOS: Record<string, { tipo: string; titulo: string; cuerpo: string; url: string; cuerpoPublico?: string }> = {
        cumpleanos: { tipo: "cumpleanos", titulo: "¡Feliz cumpleaños! 🎂", cuerpo: "Te regalamos puntos para celebrar. Ábrela y míralos.", url: "/puntos?cumple=1" },
        puntos: { tipo: "ganado", titulo: "Ganaste 25 puntos", cuerpo: "Gracias por tu compra. Mira tu saldo en la app.", url: "/puntos" },
        cupon: { tipo: "ganado", titulo: "Tu cupón del mes 🎟️", cuerpo: "Ya llegó: ráspalo en la app para descubrir cuánto ganaste.", url: "/puntos" },
        nivel: { tipo: "nivel", titulo: "¡Subiste de nivel! 👑", cuerpo: "Desde ahora ganas más puntos con cada compra.", url: "/puntos?nivel=1" },
        // Mayoreo (2026-10-09): la pantalla se ve con el rango de prueba elegido en Cuenta.
        rango: { tipo: "mayoreo", titulo: "¡Subiste a Rubí! 💎", cuerpo: "Tu compra promedio de los últimos 3 meses subió tu rango de mayoreo. Mira tus beneficios.", url: "/puntos?rango=1" },
        precio: { tipo: "mayoreo", titulo: "Ahora tienes precio Mayoreo Plus 🏷️", cuerpo: "Desde hoy pagas a precio Mayoreo Plus en todas las sucursales.", url: "/puntos?precio=1" },
        mayoreo: { tipo: "mayoreo", titulo: "¡Bienvenido a precio de mayoreo! 💎", cuerpo: "Te aprobamos como cliente de mayoreo. Mira tu precio y tu rango.", url: "/puntos?mayoreo=1" },
        restado: { tipo: "restado", titulo: "Usaste 500 puntos 💳", cuerpo: "Ahorraste $5.00 en Salud 1. Te quedan 1,200 puntos.", url: "/puntos" },
        // Con un producto de muestra (2026-10-15): para comprobar que bloqueado
        // no se ve y desbloqueado sí (_shared/avisoPrivado.ts).
        tratamiento: { tipo: "tratamiento", titulo: "¿Ya te toca otra vez? 💊", cuerpo: "Se te está por acabar Losartan 50 mg. Resérvalo y lo tenemos listo.", cuerpoPublico: "Resérvalo y lo tenemos listo. Toca para ver cuál.", url: "/tratamientos" },
        reserva: { tipo: "reserva", titulo: "Tu reserva está lista en Salud 1 🛍️", cuerpo: "Ibuprofeno 400 mg te espera. Pasa a retirarlo antes de mañana a las 6:00 p. m.", cuerpoPublico: "Pasa a retirarla antes de mañana a las 6:00 p. m.", url: "/reservas" },
        // Mis créditos (2026-10-15): el mismo texto que manda avisos-clientes, sin montos.
        credito: { tipo: "credito", titulo: "Tienes un crédito vencido", cuerpo: "Toca para ver el detalle. ¿Dudas? Escríbenos por el chat de la app.", url: "/creditos" },
      };
      const a = TIPOS[String(body?.tipo ?? "")];
      if (!a) return json({ ok: false, mensaje: "Tipo de aviso desconocido." });
      const { error: eA } = await admin.from("app_cliente_avisos").insert({ customer_id: customerId, tipo: a.tipo, ref: `prueba:${Date.now()}`,
        titulo: a.titulo, cuerpo: a.cuerpo, url: a.url, enviado: true });
      if (eA) throw eA;
      const { data: sesiones, error: eS } = await admin.from("app_cliente_sesiones").select("push_token, plataforma")
        .eq("customer_id", customerId).is("revocada_at", null).eq("acepta_avisos", true).not("push_token", "is", null);
      if (eS) throw eS;
      const tokens = (sesiones ?? []) as { push_token: string; plataforma: string | null }[];
      if (!tokens.length) return json({ ok: false, mensaje: "Activa los avisos en Cuenta para recibirlo." });
      // Armado igual que el aviso real: lo que nombra un producto no se lee bloqueado.
      const r = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15_000),
        body: JSON.stringify(tokens.map((t) => mensajePush(a, t.push_token, t.plataforma))),
      });
      return json({ ok: r.ok, enviados: tokens.length });
    }

    // Los datos fiscales de la ficha, para pedir un crédito fiscal: si están
    // completos la app sólo los muestra; si falta algo, los pide.
    if (accion === "mis_datos_fiscales") {
      const { data: c, error } = await admin.from("customers").select("name, nit, nrc, giro, direccion").eq("id", customerId).maybeSingle();
      if (error) throw error;
      const v = validarFiscales({ nombre: c?.name, nit: c?.nit, nrc: c?.nrc, giro: c?.giro, direccion: c?.direccion });
      return json({ ok: true, completos: v.ok, datos: { nombre: c?.name ?? "", nit: c?.nit ?? "", nrc: c?.nrc ?? "", giro: c?.giro ?? "", direccion: c?.direccion ?? "" } });
    }

    if (accion === "reservar_carrito") {
      if (body?.acepta_terminos !== TERMINOS_RESERVA.version) {
        return json({ ok: false, motivo: "terminos", mensaje: "Acepta las condiciones de la reserva para continuar." });
      }
      const branchId = Number(body?.branch_id);
      // deno-lint-ignore no-explicit-any
      const items = (Array.isArray(body?.items) ? body.items : []).map((x: any) => ({
        id: Number(x?.producto_id), factor: Number(x?.factor) || 1, cantidad: Math.trunc(Number(x?.cantidad)),
      })).filter((x: any) => Number.isInteger(x.id) && x.id > 0);
      if (!items.length || items.length > 10) return json({ ok: false, mensaje: "El carrito puede tener de 1 a 10 productos." });
      // Documento: consumidor final o crédito fiscal (con sus datos validados).
      const documento = body?.documento === "credito_fiscal" ? "credito_fiscal" : "consumidor_final";
      let datosFiscales = null;
      if (documento === "credito_fiscal") {
        const v = validarFiscales(body?.datos_fiscales);
        if (!v.ok) return json({ ok: false, motivo: "fiscales", mensaje: v.mensaje });
        datosFiscales = v.datos;
      }
      const pagoEnLinea = body?.pago === "en_linea";
      // A domicilio (2026-10-07): sale de la sucursal elegida, con dirección.
      const aDomicilio = body?.entrega === "domicilio";
      const direccion = aDomicilio ? String(body?.direccion ?? "").replace(/\s+/g, " ").trim().slice(0, 300) : null;
      const envioCfg = aDomicilio ? await ajustesEnvio() : null;
      if (aDomicilio && !envioCfg?.activo) return json({ ok: false, mensaje: "La entrega a domicilio no está disponible ahora." });
      if (aDomicilio && (direccion ?? "").length < 10) return json({ ok: false, motivo: "direccion", mensaje: "Escribe la dirección completa, con una referencia." });
      // Sin existencia en esa sala no se cobra (2026-10-07): se envía para que
      // la sucursal confirme, y se paga al retirar.
      // (2026-10-19) Con lo DISPONIBLE —existencia menos lo apartado por otras
      // reservas—, en unidades, y alcanzando para lo que se pide (antes bastaba
      // con que hubiera una).
      if (pagoEnLinea) {
        const idsP = [...new Set(items.map((x: any) => x.id))];
        const disp = await unidadesPorSala(admin, idsP);
        const pide = new Map<number, number>();
        for (const x of items) pide.set(x.id, (pide.get(x.id) ?? 0) + Math.max(1, x.cantidad) * Math.max(1, x.factor));
        if ([...pide.entries()].some(([id, u]) => (disp.get(id)?.get(branchId) ?? 0) < u)) {
          return json({ ok: false, motivo: "sin_existencia", mensaje: "Esa sucursal no tiene todo lo que pides: envía el pedido para que lo confirmen y pagas al retirar." });
        }
      }
      if (items.some((x: any) => !(x.cantidad >= 1 && x.cantidad <= 5))) return json({ ok: false, mensaje: "Cada producto va de 1 a 5 unidades." });
      const { data: sala, error: eSala } = await admin.from("branches").select("id").eq("id", branchId).eq("type", "FARMACIA").maybeSingle();
      if (eSala) throw eSala;
      if (!sala) return json({ ok: false, mensaje: "Elige la sucursal donde vas a retirar." });
      const ids = [...new Set(items.map((x: any) => x.id))];
      const [{ data: prods, error: eP }, { data: precios, error: ePr }, { data: ocultos, error: eO }, condPrecio, rxC] = await Promise.all([
        admin.from("products").select("id, nombre, activo, oculto_en_ventas").in("id", ids),
        // Los precios por la MISMA función que el catálogo (2026-10-19): antes
        // se leía `product_precios` y la regla se repetía acá, y no coincidía
        // con lo que la app mostraba cuando el VIP era más alto que la viñeta.
        admin.rpc("app_precios_para_cobro", { p_ids: ids }),
        admin.from("app_catalogo_ocultos").select("product_id").in("product_id", ids),
        condicionDePrecio(false),
        bajoReceta(admin, ids),
      ]);
      if (eP) throw eP;
      if (ePr) throw ePr;
      if (eO) throw eO;
      const oculto = new Set((ocultos ?? []).map((o: any) => Number(o.product_id)));
      const porId = new Map((prods ?? []).map((p: any) => [Number(p.id), p]));
      // Bajo receta (2026-10-12): si UN producto la pide, TODO el pedido nace
      // «en revisión» y no se cobra hasta que la sucursal apruebe la receta.
      // Si la rechaza (2026-10-19), sólo se cancelan los renglones bajo receta
      // y lo demás sigue (`reserva_receta_decidir`).
      const conReceta = ids.some((id: number) => rxC.has(id));
      const filas = [];
      for (const x of items) {
        const p: any = porId.get(x.id);
        if (!p || p.activo === false || p.oculto_en_ventas || oculto.has(x.id)) return json({ ok: false, mensaje: "Un producto del carrito ya no está en el catálogo. Quítalo e intenta de nuevo." });
        // La presentación de ese factor: una sola por (producto, factor), la de
        // mayor viñeta — la elige `app_precios_para_cobro` igual que el catálogo.
        const deEse = ((precios ?? []) as any[]).filter((q: any) => Number(q.product_id) === x.id);
        const pr: any = deEse.find((q: any) => (Number(q.factor) || 1) === x.factor);
        if (!pr) return json({ ok: false, mensaje: `«${p.nombre}» cambió de presentación. Quítalo y agrégalo de nuevo.` });
        // ¿Es la caja (la presentación de mayor factor)? Sólo ahí vale el mayoreo.
        const esCaja = x.factor === factorMayor(deEse);
        const vineta = Number(pr.vineta);
        const vip = pr.vip == null ? null : Number(pr.vip);
        // Mayoreo: el precio y la lista salen de `precioDeLista`, el mismo que
        // usa el catálogo. Decide el servidor, nunca el precio que mande la app.
        const lp = esCaja ? precioDeLista(condPrecio.clave, pr.precio_mayoreo, pr.precio_plus) : { precio: null, lista: null };
        filas.push({
          customer_id: customerId, branch_id: branchId, producto_id: x.id,
          producto_nombre: `${p.nombre}${pr.tipo ? ` · ${pr.tipo}` : ""}`.slice(0, 200),
          cantidad: x.cantidad, factor: Math.max(1, x.factor), precio_unitario: lp.precio ?? vip ?? vineta, precio_normal: vineta, terminos_version: TERMINOS_RESERVA.version,
          // Para que la sala facture con la misma lista que se cobró (2026-10-19).
          lista_precio: lp.lista,
          documento, datos_fiscales: datosFiscales,
          entrega: aDomicilio ? "domicilio" : "retiro", direccion_entrega: direccion,
          ...(conReceta ? { estado: "en_revision" } : {}),
        });
      }
      const { data: suyas, error: eR } = await admin.from("app_reservas").select("id, estado, cerrada_at, pedido, vencida_motivo")
        .eq("customer_id", customerId).or(`estado.in.(en_revision,pendiente,lista),and(estado.eq.vencida,cerrada_at.gte.${new Date(Date.now() - 30 * 86400_000).toISOString()})`);
      if (eR) throw eR;
      const activas = new Set((suyas ?? []).filter((r: any) => ["en_revision", "pendiente", "lista"].includes(r.estado)).map((r: any) => r.pedido ?? `r${r.id}`)).size;
      const vencidas = new Set((suyas ?? []).filter(vencidaDelCliente).map((r: any) => r.pedido ?? `r${r.id}`)).size;
      if (vencidas >= 3) return json({ ok: false, mensaje: "Tienes 3 reservas que no se retiraron este mes. Podrás reservar de nuevo en 30 días." });
      if (activas >= 3) return json({ ok: false, mensaje: "Ya tienes 3 reservas activas. Retira o cancela una para reservar otra." });
      const ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
      const pedido = "P-" + Array.from(crypto.getRandomValues(new Uint8Array(6)), (n) => ABC[n % ABC.length]).join("");
      const subtotal = Math.round(filas.reduce((s, f) => s + f.precio_unitario * f.cantidad, 0) * 100) / 100;
      const envio = aDomicilio && envioCfg ? costoDeEnvio(envioCfg, subtotal) : 0;
      const { data: nuevas, error: eI } = await admin.from("app_reservas").insert(filas.map((f) => ({ ...f, pedido, costo_envio: envio }))).select("id");
      if (eI) throw eI;
      const total = Math.round((subtotal + envio) * 100) / 100;
      // Pagar en línea: UN cobro por todo el pedido. Si Wompi no responde, el
      // pedido queda igual (se paga al retirar o luego desde Mis reservas).
      let pago = null;
      if (pagoEnLinea && !conReceta && total > 0) pago = await enlaceDePago({ pedido, total, branchId, descripcion: `${filas.length} productos`, reservas: (nuevas ?? []).map((n: any) => Number(n.id)) });
      // `reservas[0]` es la que se usa para subir la receta de todo el pedido.
      return json({ ok: true, pedido, reservas: (nuevas ?? []).map((n: any) => n.id), total, envio, pago, receta: conReceta });
    }

    if (accion === "cancelar_reserva") {
      const { data, error } = await admin.from("app_reservas")
        .update({ estado: "cancelada", cerrada_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", Number(body?.id)).eq("customer_id", customerId).in("estado", ["en_revision", "pendiente", "lista"])
        // Pagada en línea no se cancela desde la app: habría que devolver el
        // dinero, y eso lo hace una persona desde el panel de Wompi.
        .neq("pago_estado", "pagado").select("id");
      if (error) throw error;
      return json(data?.length ? { ok: true } : { ok: false, mensaje: "Esa reserva ya no se puede cancelar. Si la pagaste en línea, escríbele a la sucursal." });
    }

    // ── Pagar una reserva en línea, con Wompi (2026-10-07) ────────────────
    // Crea un enlace de pago de UN cobro con el total de la reserva —calculado
    // acá, nunca el que mande la app— y devuelve su URL. La app la abre en una
    // hoja del navegador; el pago se confirma en `wompi-pagos`, que es la
    // única que marca «pagado». Se puede pagar apenas reservada o ya lista.
    // ¿Alcanza la existencia para cobrar estos renglones? (2026-10-19,
    // decisión 5). Lo apartado se reparte por ORDEN DE LLEGADA: una reserva
    // cuenta con lo que queda después de las abiertas más viejas de esa sala y
    // producto. Las ya «listas» no se miran: la sala ya las tiene separadas.
    // Devuelve los nombres que no alcanzan (vacío = se puede cobrar).
    // deno-lint-ignore no-explicit-any
    const sinExistenciaParaCobrar = async (mias: any[]): Promise<string[]> => {
      const porMirar = mias.filter((m) => m.estado === "pendiente" && m.pago_estado !== "pagado");
      if (!porMirar.length) return [];
      const branch = Number(porMirar[0].branch_id);
      const prods = [...new Set(porMirar.map((m) => Number(m.producto_id)))];
      const [ex, { data: cola, error: eCola }] = await Promise.all([
        existenciasNetas(admin, prods),
        admin.from("app_reservas").select("id, producto_id, cantidad, factor, created_at").limit(500) // tope deliberado: abiertas de una sala
          .eq("branch_id", branch).in("producto_id", prods).in("estado", ["en_revision", "pendiente", "lista"])
          .order("created_at", { ascending: true }).order("id", { ascending: true }),
      ]);
      if (eCola) throw eCola;
      const existencia = new Map(ex.filter((x) => x.branch_id === branch).map((x) => [x.product_id, x.existencia]));
      const acumulado = new Map<number, number>();
      const hasta = new Map<number, number>();
      for (const c of cola ?? []) {
        const pid = Number(c.producto_id);
        acumulado.set(pid, (acumulado.get(pid) ?? 0) + Number(c.cantidad) * Math.max(1, Number(c.factor) || 1));
        hasta.set(Number(c.id), acumulado.get(pid)!);
      }
      return porMirar.filter((m) => (hasta.get(Number(m.id)) ?? Infinity) > (existencia.get(Number(m.producto_id)) ?? 0))
        .map((m) => String(m.producto_nombre ?? "un producto"));
    };
    const SIN_EXISTENCIA_PAGO = (nombres: string[]) => ({
      ok: false, motivo: "sin_existencia",
      mensaje: `La sucursal todavía no confirma que tenga ${nombres.slice(0, 2).join(" y ")}. Podrás pagar cuando la aparte, o paga al retirar.`,
    });
    if (accion === "pagar_reserva") {
      const { data: r, error } = await admin.from("app_reservas")
        .select("id, estado, pago_estado, producto_id, producto_nombre, cantidad, factor, precio_unitario, branch_id, pedido")
        .eq("id", Number(body?.id)).eq("customer_id", customerId).maybeSingle();
      if (error) throw error;
      // Con la receta en revisión no se cobra (2026-10-12): todavía puede rechazarse.
      const EN_REVISION = { ok: false, motivo: "en_revision", mensaje: "Tu receta está en revisión. Podrás pagar cuando la sucursal la apruebe." };
      if (r?.estado === "en_revision") return json(EN_REVISION);
      // Una reserva de un pedido del carrito se paga con TODO el pedido (2026-10-07).
      if (r?.pedido) {
        const { data: filasT, error: eFp } = await admin.from("app_reservas").select("id, estado, pago_estado, producto_id, producto_nombre, branch_id, factor, precio_unitario, cantidad, costo_envio")
          .eq("pedido", r.pedido).eq("customer_id", customerId).in("estado", ["en_revision", "pendiente", "lista"]);
        if (eFp) throw eFp;
        if ((filasT ?? []).some((f: any) => f.estado === "en_revision")) return json(EN_REVISION);
        const filasP = filasT ?? [];
        if (!filasP.length) return json({ ok: false, mensaje: "Este pedido ya no se puede pagar." });
        if (filasP.every((f: any) => f.pago_estado === "pagado")) return json({ ok: false, mensaje: "Este pedido ya está pagado." });
        const envioP = Math.max(0, ...filasP.map((f: any) => Number(f.costo_envio ?? 0)));
        const totalP = Math.round((filasP.reduce((t: number, f: any) => t + Number(f.precio_unitario ?? 0) * Number(f.cantidad), 0) + envioP) * 100) / 100;
        const faltanP = await sinExistenciaParaCobrar(filasP);
        if (faltanP.length) return json(SIN_EXISTENCIA_PAGO(faltanP));
        const pagoP = await enlaceDePago({ pedido: r.pedido, total: totalP, branchId: r.branch_id, descripcion: `${filasP.length} productos`, reservas: filasP.map((f: any) => Number(f.id)) });
        return json(pagoP ? { ok: true, ...pagoP } : { ok: false, mensaje: "El pago en línea no está disponible ahora. Intenta en un rato o paga al retirar." });
      }
      if (!r || !["pendiente", "lista"].includes(r.estado)) return json({ ok: false, mensaje: "Esta reserva ya no se puede pagar." });
      if (r.pago_estado === "pagado") return json({ ok: false, mensaje: "Esta reserva ya está pagada." });
      const total = Math.round(Number(r.precio_unitario ?? 0) * Number(r.cantidad) * 100) / 100;
      if (!(total > 0)) return json({ ok: false, mensaje: "Esta reserva se paga al retirarla en la sucursal." });
      const codigo = `R-${String(r.id).padStart(6, "0")}`;
      const faltanR = await sinExistenciaParaCobrar([r]);
      if (faltanR.length) return json(SIN_EXISTENCIA_PAGO(faltanR));
      const vigenteR = await enlaceVigente("reserva_id", r.id, total);
      if (vigenteR) return json({ ok: true, url: vigenteR.url, total, prueba: vigenteR.prueba, reutilizado: true });
      // Un identificador por INTENTO: Wompi no deja repetirlo, y el cliente
      // puede cerrar la hoja y volver a tocar «Pagar».
      const identificador = `${codigo}-${Date.now().toString(36)}`;
      const [{ data: salaFila, error: eS }, { error: eP }] = await Promise.all([
        admin.from("branches").select("name").eq("id", r.branch_id).maybeSingle(),
        admin.from("app_reservas_pagos").insert({ reserva_id: r.id, identificador, monto: total, reservas_ids: [r.id] }),
        calentarWompi(),
      ]);
      if (eS) throw eS;
      if (eP) throw eP;
      const base = `${Deno.env.get("SUPABASE_URL")}/functions/v1/wompi-pagos`;
      let enlace;
      try {
        enlace = await crearEnlace({
          identificador, monto: total,
          producto: `${r.producto_nombre}${r.cantidad > 1 ? ` (${r.cantidad} unidades)` : ""}`,
          descripcion: `Reserva ${codigo} · retiro en ${sucursal(salaFila?.name) ?? "sucursal"}`,
          urlRedirect: `${base}?ref=${encodeURIComponent(identificador)}`,
          urlWebhook: base,
          minutos: 30,
        });
      } catch (e) {
        console.error("app-clientes: wompi no creó el enlace:", (e as Error)?.message ?? e);
        return json({ ok: false, mensaje: "El pago en línea no está disponible ahora. Intenta en un rato o paga al retirar." });
      }
      const { error: eU } = await admin.from("app_reservas_pagos")
        .update({ enlace_id: enlace.idEnlace, enlace_url: enlace.urlEnlaceLargo || enlace.urlEnlace, enlace_prueba: !enlace.estaProductivo }).eq("identificador", identificador);
      if (eU) console.error("app-clientes: no se guardó el enlace:", eU.message);
      return json({ ok: true, url: enlace.urlEnlaceLargo || enlace.urlEnlace, total, prueba: !enlace.estaProductivo });
    }

    // La BANDEJA: los avisos que ya se le mandaron, para verlos en la app.
    //
    // Borrar un aviso (2026-10-09) lo OCULTA: marca `oculto_at` y la bandeja
    // ya no lo devuelve, en todos los teléfonos de la persona. La fila NO se
    // borra nunca: `app_cliente_avisos` es también la bitácora que impide
    // mandar dos veces el mismo aviso (UNIQUE customer_id, tipo, ref).
    //
    // Mientras la columna no exista en la base, la bandeja sigue como antes
    // (sin el filtro) y `bandeja_ocultar` contesta `motivo: "sin_columna"`:
    // la app conserva el ocultamiento local y lo reintenta en la próxima carga.
    const sinColumnaOculto = (e: any) => e?.code === "42703" || /oculto_at/.test(String(e?.message ?? ""));
    if (accion === "bandeja" && !customerId) return json({ ok: true, avisos: [], sin_leer: 0 });
    if (accion === "bandeja_leida" && !customerId) return json({ ok: true });
    if (accion === "bandeja_ocultar" && !customerId) return json({ ok: true, ocultos: 0 });
    if ((accion === "bandeja_no_leida" || accion === "bandeja_recuperar") && !customerId) return json({ ok: true });
    // Los ids que manda la app, siempre saneados y con tope. Nunca se confía en
    // ellos: toda escritura va además acotada a la ficha de la sesión.
    const idsDeBandeja = (v: unknown): number[] => (Array.isArray(v)
      ? [...new Set(v.map(Number).filter((n: number) => Number.isSafeInteger(n) && n > 0))].slice(0, 200)
      : []);
    // «Borradas recientemente» (2026-10-14, «la opción de recuperar»): lo
    // ocultado en los últimos 30 días se puede traer de vuelta. Más viejo ya no
    // se ofrece — la fila sigue (es la bitácora), sólo deja de listarse.
    const DIAS_RECUPERAR = 30;
    const desdeRecuperar = () => new Date(Date.now() - DIAS_RECUPERAR * 86400_000).toISOString();
    if (accion === "bandeja" && body?.ocultas === true) {
      const { data, error } = await admin.from("app_cliente_avisos")
        .select("id, tipo, titulo, cuerpo, url, created_at, leido_at, oculto_at")
        .eq("customer_id", customerId).eq("enviado", true).neq("tipo", "chat")
        .not("oculto_at", "is", null).gte("oculto_at", desdeRecuperar())
        .order("oculto_at", { ascending: false }).limit(100);
      if (error && sinColumnaOculto(error)) return json({ ok: true, avisos: [], dias: DIAS_RECUPERAR });
      if (error) throw error;
      return json({ ok: true, avisos: data ?? [], dias: DIAS_RECUPERAR });
    }
    if (accion === "bandeja") {
      const leer = (conFiltro: boolean) => {
        let q = admin.from("app_cliente_avisos")
          .select("id, tipo, titulo, cuerpo, url, created_at, leido_at")
          // Las respuestas del chat no van a la bandeja (2026-10-12): viven en el chat.
          .eq("customer_id", customerId).eq("enviado", true).neq("tipo", "chat");
        if (conFiltro) q = q.is("oculto_at", null);
        return q.order("created_at", { ascending: false }).limit(50);
      };
      let { data, error } = await leer(true);
      if (error && sinColumnaOculto(error)) ({ data, error } = await leer(false));
      if (error) throw error;
      return json({ ok: true, avisos: data ?? [], sin_leer: (data ?? []).filter((a) => !a.leido_at).length });
    }
    // `{ ids: [...] }` oculta esos; `{ todas: true }` oculta todos los que
    // siguen a la vista, y con `hasta_id` sólo hasta ese (el más nuevo que la
    // persona VIO): uno que llegó mientras tanto no se borra sin haberse visto.
    // Siempre acotado a la ficha de la sesión — nunca se confía en los ids.
    if (accion === "bandeja_ocultar") {
      const ids = Array.isArray(body?.ids)
        ? [...new Set(body.ids.map(Number).filter((n: number) => Number.isSafeInteger(n) && n > 0))].slice(0, 200)
        : [];
      const todas = body?.todas === true;
      if (!todas && !ids.length) return json({ ok: false, mensaje: "No hay avisos para borrar." });
      let q = admin.from("app_cliente_avisos").update({ oculto_at: new Date().toISOString() })
        .eq("customer_id", customerId).is("oculto_at", null);
      if (todas) {
        const hasta = Number(body?.hasta_id);
        if (Number.isSafeInteger(hasta) && hasta > 0) q = q.lte("id", hasta);
      } else {
        q = q.in("id", ids);
      }
      const { data, error } = await q.select("id");
      if (error && sinColumnaOculto(error)) return json({ ok: false, motivo: "sin_columna", mensaje: "Se borraron sólo en este teléfono." });
      if (error) throw error;
      return json({ ok: true, ocultos: data?.length ?? 0 });
    }
    // Leída / no leída (2026-10-14, «al tocar una no se borra; que se puedan
    // marcar como leídas»). `bandeja_leida` sin ids marca TODAS (el «Marcar todo
    // como leído»); con `{ ids }` sólo ésas — tocar un aviso marca ése y nada
    // más. `bandeja_no_leida { ids }` (o `leido: false`) las vuelve a encender.
    if (accion === "bandeja_leida" || accion === "bandeja_no_leida") {
      const ids = idsDeBandeja(body?.ids);
      const leido = accion === "bandeja_leida" && body?.leido !== false;
      if (!leido && !ids.length) return json({ ok: false, mensaje: "No hay avisos para marcar." });
      let q = admin.from("app_cliente_avisos").update({ leido_at: leido ? new Date().toISOString() : null })
        .eq("customer_id", customerId);
      q = leido ? q.is("leido_at", null) : q.not("leido_at", "is", null);
      if (ids.length) q = q.in("id", ids);
      else if (Array.isArray(body?.ids)) return json({ ok: true, marcados: 0 }); // vinieron ids, todos inválidos: no es «todas»
      const { data, error } = await q.select("id");
      if (error) throw error;
      return json({ ok: true, marcados: data?.length ?? 0 });
    }
    // Recuperar lo borrado: `{ ids }` o `{ todas: true }` (sólo lo de los
    // últimos 30 días, lo mismo que se lista). Siempre de la ficha de la sesión.
    if (accion === "bandeja_recuperar") {
      const ids = idsDeBandeja(body?.ids);
      const todas = body?.todas === true;
      if (!todas && !ids.length) return json({ ok: false, mensaje: "No hay avisos para recuperar." });
      let q = admin.from("app_cliente_avisos").update({ oculto_at: null })
        .eq("customer_id", customerId).not("oculto_at", "is", null).gte("oculto_at", desdeRecuperar());
      if (!todas) q = q.in("id", ids);
      const { data, error } = await q.select("id");
      if (error && sinColumnaOculto(error)) return json({ ok: false, motivo: "sin_columna", mensaje: "No se pudieron recuperar." });
      if (error) throw error;
      return json({ ok: true, recuperados: data?.length ?? 0, ids: (data ?? []).map((r) => r.id) });
    }

    // ── Lo demás necesita ficha ────────────────────────────────────────────
    if (!customerId) {
      const { data: pre, error: ePre } = await admin.from("app_cliente_preregistros")
        .select("nombre, created_at").eq("id", ses.preregistro_id).maybeSingle();
      if (ePre) throw ePre;
      return json({
        ok: true, pendiente: true, nombre: pre?.nombre ?? null, registrado_el: pre?.created_at ?? null,
        acepta_avisos: ses.acepta_avisos,
      });
    }

    // ── El código del cliente para su tarjeta ─────────────────────────────
    // El mismo código de 7 letras que emite la sala (`puntos_codigo_emitir`),
    // con el mismo alfabeto sin parecidos. Si la ficha todavía no tiene, se le
    // emite UNO la primera vez que abre la app (decisión del usuario,
    // 2026-10-05) y queda en la bitácora como lo emitido en sala. Nunca se
    // REEMPLAZA uno existente: reemitir cambia la credencial con que la
    // persona entra, y eso sólo lo decide la sala.
    async function codigoDelCliente(id: number, nombre: string): Promise<string | null> {
      const { data: hay, error } = await admin.from("puntos_codigo_acceso").select("codigo").eq("customer_id", id).maybeSingle();
      if (error) throw error;
      if (hay?.codigo) return hay.codigo;
      const ALFABETO = "ACDEFGHJKMNPQRTUVWXY34679";
      for (let intento = 0; intento < 20; intento++) {
        const azar = crypto.getRandomValues(new Uint8Array(7));
        const codigo = [...azar].map((b) => ALFABETO[b % ALFABETO.length]).join("");
        const { error: eIns } = await admin.from("puntos_codigo_acceso").insert({ customer_id: id, codigo });
        if (!eIns) {
          const { error: eLog } = await admin.from("audit_logs").insert({
            action: "PUNTOS_CODIGO_EMITIDO", target_id: String(id), source: "SYSTEM", severity: "WARNING",
            details: { cliente: nombre, veces: 1, origen: "app-clientes" },
          });
          if (eLog) console.error("no se pudo anotar el código emitido:", eLog.message);
          return codigo;
        }
        if (eIns.code !== "23505") throw eIns;
        // Choque: o el código ya lo tiene otro (se vuelve a tirar) o esta ficha
        // recibió uno entretanto (otra pestaña, la sala): se usa ése.
        const { data: otro, error: eOtro } = await admin.from("puntos_codigo_acceso").select("codigo").eq("customer_id", id).maybeSingle();
        if (eOtro) throw eOtro;
        if (otro?.codigo) return otro.codigo;
      }
      return null;
    }

    if (accion === "resumen") {
      const { data: c, error: eC } = await admin.from("customers")
        .select("name, acepta_programa_puntos, acepta_promociones, fecha_nacimiento").eq("id", customerId).maybeSingle();
      if (eC) throw eC;
      if (!c) return json({ ok: false, motivo: "sin_sesion" }, 401);

      // Todo lo demás es independiente y va en UNA tanda (2026-10-15): antes
      // eran ~20 consultas EN SERIE y el Inicio esperaba la suma de todas.
      // Cada pieza conserva su manejo del error de antes: las que tumbaban el
      // resumen lo siguen tumbando; las que sólo se anotaban, igual.
      // ¿Es su cumpleaños hoy (hora de El Salvador)? La app lo celebra. La
      // muestra `cumpleanos` lo fuerza, para ver la tarjeta sin esperar al día.
      const hoyMD = new Date(Date.now() - 6 * 3600_000).toISOString().slice(5, 10);
      // El cupón del mes (Platino): puntos que vencen a fin de mes.
      const inicioMes = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 8) + "01";
      const [
        { data: est, error: eEst },
        { data: salas, error: eSalas },
        { data: primero, error: ePri },
        codigo,
        { data: cfgP, error: eCfg },
        nivel,
        { data: cup, error: eCup },
        { data: resAb, error: eRA },
        { data: conv, error: eCv },
        horChat,
        mayorista,
        empleado,
        tratamientos,
        encuesta,
        inyeccionesReales,
        muestras,
        creditos,
        programa,
        saldoFavor,
      ] = await Promise.all([
        admin.rpc("puntos_estado_cuenta", { p_customer_id: customerId }),
        salasDeLaRed(admin),
        // «Socio desde»: la primera vez que ganó puntos (la ficha puede ser más
        // nueva que su historia: se sincroniza desde la caja).
        admin.from("puntos_lote")
          .select("ganado_el").eq("customer_id", customerId).order("ganado_el", { ascending: true }).limit(1).maybeSingle(),
        codigoDelCliente(customerId, c.name)
          .catch((e) => { console.error("no se pudo obtener el código:", (e as Error)?.message); return null; }),
        admin.from("puntos_config").select("puntos_cumpleanos").limit(1).maybeSingle(),
        nivelDeCliente(admin, customerId),
        admin.from("puntos_lote").select("id, puntos, restantes, vence_el, motivo, raspado_el")
          .eq("customer_id", customerId).eq("origen", "cupon").gte("ganado_el", inicioMes).maybeSingle(),
        // Con el producto: la app avisa «ya tienes una reserva de este producto»
        // al agregarlo al carrito o reservarlo otra vez (2026-10-09). Son pocas
        // filas (tope de 3 reservas activas), así que viajan en el resumen.
        admin.from("app_reservas").select("id, estado, producto_id, producto_nombre, pago_estado, pedido")
          .eq("customer_id", customerId).in("estado", ["en_revision", "pendiente", "lista"]),
        // Mensajes del chat sin leer (2026-10-12): el punto de «Pregúntale a la farmacia».
        admin.from("app_chat_conversaciones").select("sin_leer_cliente")
          .eq("customer_id", customerId).maybeSingle(),
        // La burbuja del chat (2026-10-14) dice si la farmacia está en línea:
        // el mismo `horarioFarmacia` del chat, con su minuto de caché por
        // instancia (no agrega una consulta por resumen).
        horarioFarmacia(admin),
        // Cliente Mayorista (2026-10-08): estado, precio y rango (Condiciones).
        (async () => {
          const { data, error } = await admin.rpc("mayorista_de", { p_customer: customerId });
          if (error) { console.error("resumen mayorista:", error.message); return null; }
          return data ?? null;
        })(),
        // Empleado activo (por DUI): tarjeta de Equipo, precio Mayoreo Plus (2026-10-08).
        (async () => {
          const { data, error } = await admin.rpc("cliente_es_empleado", { p_customer: customerId });
          if (error) { console.error("resumen empleado:", error.message); return false; }
          return data === true;
        })(),
        // Los tratamientos activos, los que se acaban primero (Inicio, 2026-10-08).
        (async () => {
          const { data, error } = await admin.rpc("app_tratamientos_de", { p_customer: customerId });
          if (error) { console.error("resumen tratamientos:", error.message); return []; }
          return ((data ?? []) as any[]).filter((x) => x.estado === "activo").slice(0, 3);
        })(),
        // Encuestas por responder (para la tarjeta del Inicio).
        (async () => {
          const { data, error } = await admin.rpc("encuesta_app_disponibles", { p_customer: customerId });
          if (error) { console.error("resumen encuesta:", error.message); return null; }
          const e = (data ?? [])[0];
          return e ? { id: e.id, nombre: e.nombre, puntos: e.puntos } : null;
        })(),
        // Inyecciones por aplicar: el Inicio las muestra (ya no son pestaña).
        (async () => {
          const { count, error: eIn } = await admin.from("inyeccion_aplicaciones").select("id", { count: "exact", head: true })
            .eq("customer_id", customerId).eq("confirmada", true).is("aplicada_at", null).is("mezcla_de", null);
          if (eIn) throw eIn;
          return count ?? 0;
        })(),
        // Casi nadie tiene muestras (`tieneMuestras`): se pregunta una vez y,
        // si no, las lecturas ni se hacen.
        tieneMuestras(customerId).then(async (con) => {
          if (!con) return { prueba: false, cumpleanos: [], inyeccion: [], vencimiento: [] };
          const [prueba, cumpleanos, inyeccion, vencimiento] = await Promise.all([
            esDePrueba(customerId),
            muestrasDe(admin, customerId, "cumpleanos"),
            muestrasDe(admin, customerId, "inyeccion"),
            muestrasDe(admin, customerId, "vencimiento"),
          ]);
          return { prueba, cumpleanos, inyeccion, vencimiento };
        }),
        // Créditos con saldo (2026-10-15): sólo cuántos y cuántos vencidos, para
        // la alerta del Inicio sin otra petición. Usa el índice por ficha y son
        // pocas filas (los que deben son ~100 en toda la red). Si falla, el
        // Inicio sigue sin la alerta: no tumba el resumen.
        (async () => {
          const { data, error } = await admin.from("creditos_de_clientes").select("fecha, saldo")
            .eq("customer_id", customerId).gt("saldo", 0.004).limit(200);
          if (error) { console.error("resumen créditos:", error.message); return null; }
          const filas = data ?? [];
          if (!filas.length) return null;
          return {
            pendientes: filas.length,
            vencidos: filas.filter((f: any) => estadoDeCredito(f.fecha, Number(f.saldo)).estado === "vencido").length,
          };
        })(),
        // El programa como está configurado en el portal (2026-10-19): la
        // escalera, los premios del raspable y lo del mayorista por rango. Si
        // falla, el resumen sigue: la app cae a lo que trae `nivel`.
        programaParaApp(admin).catch((e) => { console.error("resumen programa:", (e as Error)?.message); return null; }),
        // El saldo a favor (2026-10-19): Cuenta lo muestra con su vigencia.
        saldosAFavor(customerId as number),
      ]);
      if (eEst) throw eEst;
      if (eSalas) console.error("no se pudieron leer las salas:", eSalas.message);
      const porCodigo = new Map((salas ?? []).map((b: any) => [String(b.codigo_puntos), sucursal(b.name)]));
      const saldo = Number(est?.saldo ?? 0);
      if (ePri) console.error("no se pudo leer el primer lote:", ePri.message);
      if (eCup) throw eCup;
      if (eCfg) console.error("no se pudo leer la configuración:", eCfg.message);
      const cumpleanos = String(c.fecha_nacimiento ?? "").slice(5, 10) === hoyMD || muestras.cumpleanos.length > 0;
      if (eRA) console.error("no se pudieron leer las reservas:", eRA.message);
      if (eCv) console.error("no se pudo leer el chat:", eCv.message);

      return json({
        ok: true,
        pendiente: false,
        nombre: c.name,
        cumpleanos,
        chat_sin_leer: Number(conv?.sin_leer_cliente ?? 0),
        chat: { sin_leer: Number(conv?.sin_leer_cliente ?? 0), abierta: !!horChat.abierta },
        saldo_a_favor: saldoFavor && saldoFavor.total > 0 ? saldoFavor : null,
        reservas_abiertas: (resAb ?? []).length,
        reservas_listas: (resAb ?? []).filter((r: any) => r.estado === "lista").length,
        reservas_productos: (resAb ?? []).map((r: any) => ({
          id: r.id, producto_id: r.producto_id == null ? null : Number(r.producto_id), producto_nombre: r.producto_nombre,
          estado: r.estado, pagada: r.pago_estado === "pagado", codigo: r.pedido ?? `R-${String(r.id).padStart(6, "0")}`,
        })),
        wallet_serial: `socio-${customerId}`,
        // Android: la app ofrece «Agregar a Google Wallet» sólo si el emisor está configurado.
        google_wallet: googleWalletListo(),
        // El nivel (Plata/Oro/Platino) y cuánto falta para el siguiente.
        nivel,
        // Inyecciones por aplicar: el Inicio las muestra (ya no son pestaña).
        // Cliente Mayorista (2026-10-08): estado, precio y rango (Condiciones).
        mayorista,
        // Empleado activo (por DUI): tarjeta de Equipo, precio Mayoreo Plus (2026-10-08).
        empleado,
        // Los tratamientos activos, los que se acaban primero (Inicio, 2026-10-08).
        tratamientos,
        // Encuestas por responder (para la tarjeta del Inicio).
        encuesta,
        // Más las de muestra (cuenta de prueba): la pantalla las muestra, y el
        // Inicio decía «Al día» mientras adentro había 3 (2026-10-07).
        inyecciones_pendientes: inyeccionesReales + muestras.inyeccion.length,
        // Mis créditos (2026-10-15): null si no debe nada — entonces la app no
        // muestra nada en ningún lado.
        creditos,
        // Cuenta de prueba: la app ofrece el «modo de prueba» en Cuenta.
        prueba: muestras.prueba,
        cupon: cup ? { id: cup.id, puntos: Number(cup.puntos), restantes: Number(cup.restantes), vence: cup.vence_el, titulo: cup.motivo, raspado: !!cup.raspado_el } : null,
        // El regalo de cumpleaños: el del nivel (desde el 2026-10-19 el del nivel
        // de entrada y `puntos_config.puntos_cumpleanos` se guardan juntos), o el
        // del rango si es Cliente Mayorista con sus beneficios encendidos —el
        // mismo criterio que `puntos_dar_cumpleanos`—.
        regalo_cumpleanos: (() => {
          // deno-lint-ignore no-explicit-any
          const m = mayorista as any;
          if (programa?.mayoreo.activos && m?.estado === "aprobado" && m?.rango) {
            const r = programa.mayoreo.rangos.find((x) => x.clave === m.rango);
            if (r) return r.cumpleanos;
          }
          return Number(nivel.cumpleanos ?? cfgP?.puntos_cumpleanos ?? 0);
        })(),
        programa,
        codigo,
        socio_desde: primero?.ganado_el ?? null,
        saldo,
        equivale: Math.round(saldo) / 100,
        acumulados: Number(est?.ganados ?? 0),
        canjeados: Number(est?.usados ?? 0),
        // Todos (con tope), ordenados: la app arma la gráfica de los próximos
        // meses y el aviso de lo que vence en 90 días. Antes iban sólo 3.
        vencimientos: [
          ...(est?.vencimientos ?? []).map((v: any) => ({ vence: v.vence_el, puntos: Number(v.puntos) })),
          ...muestras.vencimiento.map((v: any) => ({ vence: v.vence, puntos: Number(v.puntos) })),
        ].sort((a, b) => String(a.vence).localeCompare(String(b.vence))).slice(0, 36),
        // Paginados: los primeros 10 acá y el resto con `movimientos` de a 20.
        // Un cliente de años tiene cientos y la app no debe bajar ni pintar
        // una lista infinita.
        movimientos: (est?.movimientos ?? []).slice(0, POR_PAGINA_INICIAL).map((m: any) => ({
          tipo: tipoDeMovimiento(m), fecha: m.fecha, puntos: Number(m.puntos),
          sala: porCodigo.get(String(m.sucursal ?? "")) ?? null,
        })),
        movimientos_total: (est?.movimientos ?? []).length,
        consentimiento: {
          programa: c.acepta_programa_puntos ?? null,
          promociones: c.acepta_promociones ?? null,
          textos: { programa: TEXTOS.programa, promociones: TEXTOS.promociones },
        },
        acepta_avisos: ses.acepta_avisos,
      });
    }

    // Las compras del cliente con sus productos, los puntos que dio cada una y
    // lo canjeado en ella. La regla «¿cuenta como venta?» vive en la base
    // (`venta_valida`, dentro de `app_cliente_compras`), no acá.
    if (accion === "compras") {
      const { data, error } = await admin.rpc("app_cliente_compras", { p_customer_id: customerId });
      if (error) throw error;
      return json({ ok: true, compras: conSucursal(data ?? []) });
    }

    // «Volver a pedir» (2026-10-15): lo de una compra (`factura`, el id de Mis
    // compras) o un medicamento de Mis tratamientos (`productos`) vuelve al
    // carrito con su presentación y su cantidad. El servidor dice qué se puede
    // agregar HOY: lo que ya no está en el catálogo, la presentación que ya no
    // se vende y lo que no hay en ninguna sucursal vuelven en `fuera` con su
    // motivo, para que la app lo diga en vez de dejarlo afuera callada. El
    // precio es el del catálogo de hoy (mayoreo sólo en la caja, la regla de
    // `catalogo_producto`), nunca el de la factura; `reservar_carrito` lo
    // vuelve a calcular. Lo bajo receta se agrega marcado: la foto se pide al
    // reservar, como siempre.
    if (accion === "volver_a_pedir") {
      if (!customerId) return json({ ok: false, mensaje: "Completa tu registro en una sucursal para usar esta opción." });
      // factor 0 = no se sabe en qué presentación lo compró: va la mayor, como en la ficha.
      let lineas: { id: number | null; nombre: string; factor: number; cantidad: number }[] = [];
      const facturaId = Number(body?.factura);
      // deno-lint-ignore no-explicit-any
      const deRenglon = (it: any) => ({ id: it.erp_product_id == null ? null : Number(it.erp_product_id), nombre: String(it.descripcion ?? ""),
        factor: Number(it.factor_unidades) || 1, cantidad: Math.max(1, Math.round(Number(it.cantidad) || 1)) });
      if (Number.isInteger(facturaId) && facturaId > 0) {
        const { data: fac, error: eFac } = await admin.from("sales_invoices").select("id")
          .eq("id", facturaId).eq("customer_id", customerId).maybeSingle();
        if (eFac) throw eFac;
        if (!fac) return json({ ok: false, mensaje: "No encontramos esa compra." });
        const { data: its, error: eIts } = await admin.from("sales_invoice_items")
          .select("erp_product_id, descripcion, cantidad, factor_unidades, linea_num").eq("invoice_id", facturaId).order("linea_num");
        if (eIts) throw eIts;
        lineas = (its ?? []).map(deRenglon);
      } else {
        const pids = [...new Set((Array.isArray(body?.productos) ? body.productos : []).map(Number)
          .filter((n: number) => Number.isInteger(n) && n > 0))].slice(0, 10) as number[];
        if (!pids.length) return json({ ok: false, mensaje: "No hay nada que agregar." });
        // Cómo lo compró la ÚLTIMA vez, entre sus 20 compras más recientes.
        // 20 facturas × ≤10 productos × los renglones por lote: lejos de 1000.
        const { data: facs, error: eFs } = await admin.from("sales_invoices").select("id")
          .eq("customer_id", customerId).order("fecha", { ascending: false }).order("hora", { ascending: false }).limit(20);
        if (eFs) throw eFs;
        const orden = new Map((facs ?? []).map((f: any, i: number) => [Number(f.id), i]));
        // deno-lint-ignore no-explicit-any
        let its: any[] = [];
        if (orden.size) {
          const { data, error } = await admin.from("sales_invoice_items")
            .select("invoice_id, erp_product_id, descripcion, cantidad, factor_unidades")
            .in("invoice_id", [...orden.keys()]).in("erp_product_id", pids).range(0, 999);
          if (error) throw error;
          if ((data ?? []).length >= 1000) throw new Error("volver_a_pedir: renglones cortados en 1000 filas");
          its = data ?? [];
        }
        for (const pid of pids) {
          const suyos = its.filter((x) => Number(x.erp_product_id) === pid);
          const ultima = Math.min(...suyos.map((x) => orden.get(Number(x.invoice_id)) ?? 99), 99);
          const deEsa = suyos.filter((x) => (orden.get(Number(x.invoice_id)) ?? 99) === ultima);
          lineas.push(...(deEsa.length ? deEsa.map(deRenglon) : [{ id: pid, nombre: "", factor: 0, cantidad: 1 }]));
        }
      }
      // Los renglones del mismo producto y presentación (un lote por renglón) se juntan.
      const juntas = new Map<string, { id: number | null; nombre: string; factor: number; cantidad: number }>();
      for (const l of lineas) {
        const k = l.id == null ? `x${juntas.size}` : `${l.id}|${l.factor}`;
        const ya = juntas.get(k);
        if (ya) ya.cantidad += l.cantidad; else juntas.set(k, { ...l });
      }
      const ids = [...new Set([...juntas.values()].map((l) => l.id).filter((n): n is number => n != null))].slice(0, 20);
      const [cond, ...fichas] = await Promise.all([
        condicionDePrecio(),
        ...ids.map((id) => admin.rpc("app_catalogo_producto", { p_id: id })),
      ]);
      const ficha = new Map<number, any>();
      ids.forEach((id, i) => {
        const { data, error } = fichas[i] as { data: unknown; error: unknown };
        if (error) throw error;
        if (data) ficha.set(id, data);
      });
      const sinLista = { clave: null, sinPuntos: false };
      // deno-lint-ignore no-explicit-any
      const items: any[] = [], fuera: { id: number | null; nombre: string; motivo: string }[] = [];
      for (const l of juntas.values()) {
        // deno-lint-ignore no-explicit-any
        const d: any = l.id == null ? null : ficha.get(l.id);
        const nombre = String(d?.nombre ?? l.nombre ?? "");
        if (!d) { fuera.push({ id: l.id, nombre, motivo: "Ya no está a la venta en la app." }); continue; }
        const pres = Array.isArray(d.presentaciones) ? d.presentaciones : [];
        const caja = factorMayor(pres);
        // deno-lint-ignore no-explicit-any
        const x: any = pres.find((p: any) => (Number(p?.factor) || 1) === (l.factor || caja));
        if (!x) { fuera.push({ id: l.id, nombre, motivo: "Esa presentación ya no se vende. Elige otra en el producto." }); continue; }
        if (!(Array.isArray(d.existencias) && d.existencias.length)) {
          fuera.push({ id: l.id, nombre, motivo: d.bajo_receta ? "No hay en ninguna sucursal ahora." : "No hay en ninguna sucursal ahora. Puedes pedirlo por encargo desde el producto." });
          continue;
        }
        const factor = Number(x.factor) || 1;
        const conPrecio = conPrecioTuyo(factor === caja ? cond : sinLista)(x);
        items.push({
          id: l.id, nombre: d.nombre, foto: d.foto, tipo: x.tipo, factor, precio: x.precio, precio_vip: x.precio_vip,
          precio_tuyo: conPrecio.precio_tuyo, precio_tuyo_nombre: conPrecio.precio_tuyo_nombre, factor_mayor: caja,
          receta: !!d.bajo_receta, cantidad: Math.min(TOPE_ALCANCE, l.cantidad), pedida: l.cantidad,
        });
      }
      return json({ ok: true, items, fuera });
    }

    // Más movimientos, de a 20 desde `desde`.
    if (accion === "movimientos") {
      const desde = Math.max(0, Number(body?.desde) || 0);
      // `puntos_estado_cuenta` es la FUENTE de la lista (no hay otra consulta
      // que pagine los movimientos), así que cada página la necesita.
      const [{ data: est, error }, { data: salas, error: eSalas }] = await Promise.all([
        admin.rpc("puntos_estado_cuenta", { p_customer_id: customerId }),
        salasDeLaRed(admin),
      ]);
      if (error) throw error;
      if (eSalas) console.error("no se pudieron leer las salas:", eSalas.message);
      const porCodigo = new Map((salas ?? []).map((b: any) => [String(b.codigo_puntos), sucursal(b.name)]));
      const todos = est?.movimientos ?? [];
      return json({
        ok: true,
        total: todos.length,
        movimientos: todos.slice(desde, desde + POR_PAGINA).map((m: any) => ({
          tipo: tipoDeMovimiento(m), fecha: m.fecha, puntos: Number(m.puntos),
          sala: porCodigo.get(String(m.sucursal ?? "")) ?? null,
        })),
      });
    }

    // Sólo las PENDIENTES: lo que el cliente necesita saber es qué le falta
    // aplicarse y dónde puede ir. Las aplicadas son historia de la sala.
    if (accion === "inyecciones") {
      const { data, error } = await admin.rpc("app_cliente_inyecciones", { p_customer_id: customerId });
      if (error) throw error;
      const muestras = (await muestrasDe(admin, customerId, "inyeccion")).map((m: any) => ({ ...m, id: `muestra-${m.id}` }));
      // Y las ya aplicadas del último año (también las que trajo de otra farmacia,
      // si la sala eligió su ficha): el control completo de sus inyecciones.
      return json({
        ok: true,
        disponibles: conSucursal([...((data as any)?.disponibles ?? []), ...muestras]),
        aplicadas: conSucursal((data as any)?.aplicadas ?? []),
      });
    }

    // El enlace para agregar la tarjeta a Apple Wallet (ver el GET de arriba).
    // La tarjeta en base64, para la hoja nativa de Apple dentro de la app
    // (modules/wallet): sin enlaces ni Safari de por medio.
    if (accion === "wallet_pase") {
      const [pedido, extra] = String(body?.nivel_prueba ?? "").split("+");
      const nivelPrueba = NOMBRE_NIVEL[pedido] && await esDePrueba(customerId) ? NOMBRE_NIVEL[pedido] : undefined;
      const bytes = await paseDe(customerId, nivelPrueba, !!nivelPrueba && extra === "equipo");
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return json({ ok: true, pase: btoa(bin), serial: `socio-${customerId}` });
    }

    // Google Wallet (Android): el enlace «Agregar a Google Wallet», con la
    // tarjeta firmada adentro (ver `_shared/paseGoogle.ts`).
    if (accion === "google_wallet_enlace") {
      if (!googleWalletListo()) return json({ ok: false, motivo: "sin_configurar" });
      const [pedido, extra] = String(body?.nivel_prueba ?? "").split("+");
      const nivelPrueba = NOMBRE_NIVEL[pedido] && await esDePrueba(customerId) ? NOMBRE_NIVEL[pedido] : undefined;
      return json({ ok: true, url: await enlaceGoogleWallet(admin, customerId, nivelPrueba, !!nivelPrueba && extra === "equipo") });
    }

    if (accion === "wallet_enlace") {
      const base = Deno.env.get("SUPABASE_URL")!;
      const [pedidoE, extraE] = String(body?.nivel_prueba ?? "").split("+");
      const nivel = NOMBRE_NIVEL[pedidoE] ? `&nivel=${encodeURIComponent(pedidoE + (extraE === "equipo" ? "+equipo" : ""))}` : "";
      return json({ ok: true, url: `${base}/functions/v1/app-clientes?wallet=${await enlaceDePase(customerId)}${nivel}` });
    }

    // Invitar a un amigo: el código propio (se crea la primera vez) y cómo va.
    if (accion === "referido") {
      let { data: cod, error: eC } = await admin.from("app_cliente_referido_codigo")
        .select("codigo").eq("customer_id", customerId).maybeSingle();
      if (eC) throw eC;
      if (!cod) {
        // Sin letras que se confunden al dictarlas (O/0, I/1, L).
        const ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
        for (let i = 0; i < 6 && !cod; i++) {
          const azar = crypto.getRandomValues(new Uint8Array(6));
          const codigo = Array.from(azar, (n) => ABC[n % ABC.length]).join("");
          const { data, error } = await admin.from("app_cliente_referido_codigo")
            .insert({ customer_id: customerId, codigo }).select("codigo").maybeSingle();
          if (!error) cod = data;
          else if (error.code !== "23505") throw error;
          else {
            // Choque: o el código ya era de otro, o esta persona lo creó en paralelo.
            const { data: ya, error: eYa } = await admin.from("app_cliente_referido_codigo").select("codigo").eq("customer_id", customerId).maybeSingle();
            if (eYa) throw eYa;
            if (ya) cod = ya;
          }
        }
      }
      const { data: refs, error: eRefs } = await admin.from("app_cliente_referidos")
        .select("estado, motivo").eq("referidor_id", customerId);
      if (eRefs) throw eRefs;
      // deno-lint-ignore no-explicit-any
      const premiados = (refs ?? []).filter((r: any) => r.estado === "premiado" && !r.motivo).length;
      return json({
        ok: true, codigo: cod?.codigo ?? null, puntos: 50, minimo: 10,
        // deno-lint-ignore no-explicit-any
        invitados: (refs ?? []).length, pendientes: (refs ?? []).filter((r: any) => r.estado === "pendiente").length,
        premiados, ganados: premiados * 50,
      });
    }

    if (accion === "permisos") {
      const programa = typeof body?.programa === "boolean" ? body.programa : null;
      const promociones = typeof body?.promociones === "boolean" ? body.promociones : null;
      if (programa === null && promociones === null) return json({ ok: false, mensaje: "Sin cambios." });
      const g = await guardarPermisos(customerId, programa, promociones);
      return json({ ok: true, programa: g?.acepta_programa_puntos ?? null, promociones: g?.acepta_promociones ?? null });
    }

    return json({ ok: false, mensaje: "Acción desconocida." }, 400);
  } catch (e) {
    console.error("app-clientes:", accion, (e as any)?.message ?? e);
    traza.fallo = true;
    return json({ ok: false, mensaje: "No se pudo completar. Intenta en un rato." }, 503);
  }
}
