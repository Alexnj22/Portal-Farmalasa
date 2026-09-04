import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getCorsHeaders, getErpBranchMap, permisoDeModulo, requireActiveEmployeeUser,
} from "../_shared/security.ts";

// ═══════════════════════════════════════════════════════════════════════════
// El corte de caja, hecho desde el portal — con el conteo A CIEGAS.
//
// EL ORDEN ES EL DISEÑO, y no se puede equivocar (pedido del usuario, 29-ago):
//
//   1. Se escribe UN vale con todas las salidas del día abierto. Antes del
//      corte, o el corte cuenta un dinero que ya no está.
//   2. Se pide el efectivo contado. **Sin decir cuánto debería haber.**
//   3. Se manda el corte y se lee lo que contestó.
//   4. Recién ahí aparece la diferencia, para confirmar o rechazar.
//
// POR QUÉ EL CONTEO A CIEGAS ES EL PUNTO
// La pantalla de la caja muestra lo esperado ANTES de teclear, y su total sale
// de tres casillas —efectivo, tarjeta y cheque— que escribe la misma persona:
// inflando la de tarjeta, la diferencia queda en cero y nadie se entera. Acá el
// portal conoce el esperado y NO lo manda al navegador hasta después del
// conteo, y pide UN número: el efectivo. Las otras dos van en cero, que es lo
// que corresponde — ni la tarjeta ni el crédito pasan por la caja.
//
// ⚠️ El control sólo vale si el corte se hace SÓLO desde acá. Mientras la sala
// pueda cortar en la otra pantalla, ahí ve el esperado y esto es una comodidad,
// no un control. Está dicho porque es la condición, no un detalle.
//
// CÓMO SE ARMA EL ENVÍO
// No se inventa: se pide la pantalla del corte —que ya viene calculada por el
// servidor, 50 campos con las listas de documentos— y se reenvía tal cual,
// cambiando sólo lo que teclea una persona. Reconstruir esos 50 números acá
// sería una segunda opinión sobre lo que la caja ya sabe, y la primera regla de
// este módulo es que el esperado lo sigue calculando ella.
// ═══════════════════════════════════════════════════════════════════════════

const BASE       = "https://clientesdte3.oss.com.sv/farma_salud/";
const LOGIN_URL  = `${BASE}login.php`;
const SESION_URL = `${BASE}cambio_sesion.php`;
const CORTE_URL  = `${BASE}admin_corte.php`;
const PANTALLA   = `${BASE}corte_caja_diario.php`;
/* ── EL CORTE VA A `corte_caja_diario.php`, NO A `cierre_turno.php` ─────────
 *
 * Leído en el JavaScript del origen (`js/funciones/funciones_corte.js`) el
 * 2026-09-02, después de que el usuario reportara que **un corte hecho desde el
 * portal cierra el turno en el sistema y uno hecho desde su pantalla no**:
 *
 *     function corte() {
 *       var form = $("#formulario");
 *       var formdata = new FormData(form[0]);
 *       var formAction = form.attr('action');   // se lee y NO se usa
 *       $.ajax({ type:'POST', url:'corte_caja_diario.php', data: formdata,
 *                contentType:false, processData:false, dataType:'json', ... });
 *     }
 *
 * O sea: la pantalla manda el MISMO formulario, pero a **su propia página**.
 * `cierre_turno.php` es otro script —el que cierra el turno— y el portal lo
 * venía usando desde que existe el módulo.
 *
 * Medido antes de saberlo: del 24 al 31-ago, con todos los cortes hechos en el
 * sistema, el turno NUNCA avanzó (nueve cortes en un día en Salud 1, todos
 * turno 1); desde que corta el portal, Salud 3 fue `1→2→3→3→3` y Salud 4
 * `1→2`, y las salas que no lo usan siguieron en 1.
 *
 * Se deja nombrada la constante vieja para que nadie la vuelva a elegir por su
 * nombre: «cierre de turno» suena a lo que hace un corte y no lo es. */
const CIERRE_TURNO_NO_USAR = `${BASE}cierre_turno.php`;
void CIERRE_TURNO_NO_USAR;   // documenta, no se llama
const CREAR_VALE = `${BASE}agregar_salida_caja.php`;
// Editar el asiento del vale en vez de escribir otro: un tramo tiene UN vale, y
// dos movimientos por las mismas salidas descontarían ese dinero dos veces.
const EDITAR_VALE = `${BASE}editar_movimiento_caja.php`;
const MOV_URL    = `${BASE}admin_movimiento_caja_dt.php`;
const TICKET_URL = `${BASE}corte_caja_diario.php`;

const ID_TIPO_SALIDA = "1";

function getCortesCreds(): { username: string; password: string } {
  const raw = Deno.env.get("ERP_CORTES_CREDS");
  if (!raw) throw new Error("ERP_CORTES_CREDS secret no configurado.");
  return JSON.parse(raw);
}

async function getSessionCookie(u: string, p: string): Promise<string> {
  const res = await fetch(LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: u, password: p, m: "1" }).toString(),
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("login sin cookie de sesión");
  return cookie;
}

async function abrirSala(cookie: string, erpId: number): Promise<void> {
  const r = await fetch(SESION_URL, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ process: "set_sucursal", id_sucursal: String(erpId) }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  let ok = false;
  try { ok = Boolean(JSON.parse(await r.text())?.success); } catch { ok = false; }
  // Cortar la caja de otra sala no se deshace: el corte queda hecho allá y el
  // turno de esta sigue abierto. Si no se pudo fijar, no se sigue.
  if (!ok) throw new Error(`no se pudo abrir la sala ${erpId}`);
}

/** La apertura vigente: `id_apertura`, empleado y turno. */
async function aperturaViva(cookie: string) {
  const pagina = await (await fetch(CORTE_URL, {
    headers: { Cookie: cookie }, signal: AbortSignal.timeout(30_000),
  })).text();
  const idEmple = pagina.match(/id=["']id_emple["'][^>]*value=["'](\d+)["']/)?.[1] ?? "0";
  for (const m of pagina.matchAll(/<option value='(\d+)'>\s*Caja[^<]*<\/option>/gi)) {
    const panel = await (await fetch(CORTE_URL, {
      method: "POST",
      headers: {
        Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: new URLSearchParams({ process: "caja", id_caja: m[1], id_empleado: idEmple }).toString(),
      signal: AbortSignal.timeout(30_000),
    })).text();
    /* Las tres piezas viajan en el ENLACE de «hacer corte», y ese enlace
     * DESAPARECE en cuanto el turno ya tiene su corte — que es justo cuando
     * hay que rehacerlo. El número sobrevive en el campo escondido y el turno
     * en el rótulo del panel; el empleado cae al de la sesión, igual que en
     * `operar-caja`. Ver el bloque largo de `estadoDeLaCaja` allá: son dos
     * lectores del mismo panel y se mueven juntos, con `leerPanel` de
     * `sync-aperturas-caja` como tercero.
     *
     * Exigir los tres con `&&` era además lo que convertía un dato ausente en
     * «esta sala no tiene una caja abierta»: un corte rehecho a los dos
     * minutos —el caso normal cuando el conteo salió mal— quedaba imposible. */
    const campo = (etiqueta: string) =>
      (panel.match(new RegExp(`${etiqueta}:\\s*([^<]*)<`))?.[1] ?? "")
        .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || null;
    const aper = panel.match(/id_apertura=(\d+)/)?.[1]
      ?? panel.match(/id=["']id_apertura["'][^>]*value=["'](\d+)["']/)?.[1];
    const emp = panel.match(/emp=(\d+)/)?.[1] ?? idEmple;
    const turno = panel.match(/turno=(\d+)/)?.[1]
      ?? campo("Turno")?.match(/\d+/)?.[0];
    // El enlace del corte sólo está mientras el TURNO corre. Con la apertura
    // viva y el turno parado, el corte C sale bien y el Z sale en CERO — ver el
    // freno del cierre, más abajo.
    const turnoCorriendo = /id_apertura=\d+/.test(panel);
    if (aper && emp && turno) return { aper, emp, turno, turnoCorriendo };
  }
  return null;
}

/**
 * Los campos del formulario del corte, tal como los serializaría el navegador.
 *
 * Se leen TODOS —50 medidos el 29-ago— y se reenvían: las listas de documentos
 * («lista_factura», «t_factuta», los rangos de correlativos) son parte del
 * corte y reconstruirlas acá sería inventar el número que la caja ya calculó.
 */
function camposDelFormulario(html: string): Map<string, string> {
  const campos = new Map<string, string>();
  /* Lo que un navegador DEJA FUERA. Se junta para el registro: es la lista de
   * campos que el portal venía mandando de más. */
  const fuera: string[] = [];
  /* Atributo suelto, no la palabra en cualquier lado: `disabled` dentro de una
   * clase o de un valor no deshabilita nada. */
  const tiene = (t: string, attr: string) =>
    new RegExp(`\\s${attr}(?=[\\s>=/])`, "i").test(t);
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const t = m[0];
    const name = t.match(/name=["']([^"']+)["']/)?.[1];
    if (!name) continue;
    const tipo = (t.match(/type=["']([^"']+)["']/)?.[1] || "text").toLowerCase();
    if (tipo === "button" || tipo === "submit" || tipo === "reset" || tipo === "image") continue;
    /* ── SE SERIALIZA COMO UN NAVEGADOR, NO COMO UN LECTOR DE HTML ─────────
     *
     * `new FormData(form)` —lo que hace `corte1()` en la pantalla del origen—
     * NO manda dos cosas: los campos **deshabilitados** y las casillas
     * (`checkbox`/`radio`) **sin marcar**. Este lector las mandaba las dos, así
     * que el portal enviaba campos que ningún dependiente envía nunca.
     *
     * Lo destapó el usuario el 2026-09-02: **un corte hecho desde el portal
     * cierra el turno en el origen y uno hecho desde su pantalla no.** Medido
     * sobre los cortes reales: del 24 al 31-ago, con todos los cortes hechos
     * allá, el turno NUNCA avanzó —nueve cortes en un día en Salud 1, todos
     * turno 1—; desde que corta el portal, Salud 3 va `1→2→3` y Salud 4 `1→2`,
     * y las salas que no lo usan siguen en 1. O sea que el cierre lo agrega el
     * portal, y la vía por la que puede agregarlo es ésta.
     *
     * `readonly` NO se saltea: un navegador sí lo manda, y el efectivo del Z
     * viaja justamente así.
     *
     * Es la misma lección del `tipo_corte`, que venía con **X** marcado por
     * defecto y se reenviaba tal cual: reenviar un formulario «tal cual» no es
     * reproducir lo que hace la pantalla — hay que reproducir lo que hace el
     * NAVEGADOR con ese formulario. */
    if (tiene(t, "disabled")) { fuera.push(`${name}[deshabilitado]`); continue; }
    if ((tipo === "checkbox" || tipo === "radio") && !tiene(t, "checked")) {
      fuera.push(`${name}[${tipo} sin marcar]`);
      continue;
    }
    campos.set(name, t.match(/value=["']([^"']*)["']/)?.[1] ?? "");
  }
  for (const m of html.matchAll(/<select\b[^>]*name=["']([^"']+)["'][\s\S]{0,900}?<\/select>/gi)) {
    const abre = m[0].match(/<select\b[^>]*?>/i)?.[0] ?? "";
    if (tiene(abre, "disabled")) { fuera.push(`${m[1]}[select deshabilitado]`); continue; }
    const sel = m[0].match(/<option[^>]*selected[^>]*value=["']([^"']*)["']/i)
      ?? m[0].match(/<option[^>]*value=["']([^"']*)["']/i);
    campos.set(m[1], sel?.[1] ?? "");
  }
  /* Al registro del servidor, nunca a la respuesta: sirve para ver si quedó
   * algún campo que decida el cierre del turno y que todavía se esté mandando.
   * Los valores van acá y no a la pantalla —el esperado no viaja antes del
   * conteo—, y son los que permiten reconocer un `process` o una bandera. */
  console.error(`[hacer-corte-caja] formulario · manda: ${
    [...campos].map(([k, v]) => `${k}=${v}`).join("&").slice(0, 1800)
  } · fuera: ${fuera.join(", ") || "nada"}`);
  return campos;
}

const dosDecimales = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/**
 * El tiquete que acaba de salir, y lo que ÉL dice que se esperaba.
 *
 * Existe porque `total_corte` del formulario NO es el efectivo esperado, y eso
 * se midió el 31-ago sobre el primer corte real hecho desde el portal (Salud 3,
 * corte 14319). El portal leyó 893.50, mandó una diferencia de -411.55, y el
 * tiquete que imprimió el mismo documento dice:
 *
 *     (+) VENTA $: 541.75 · (-)VALES $: 150.50 · (+) COBROS CREDITO $: 100.45
 *     TOTAL CAJA $: 491.70 · EFECTIVO $: 481.95
 *
 * O sea que lo esperado eran 491.70 y la diferencia real -9.75. La cuenta del
 * tiquete cierra sola; la del formulario no, porque `total_corte` sale de
 * `ventas - vales` y **no incluye los cobros de crédito** (comprobado: el X de
 * las 12:41 leyó 391.25 = 541.75 - 150.50). El sistema imprime la diferencia
 * que se le manda, sin recalcularla, así que un esperado equivocado se vuelve
 * una afirmación falsa sobre dinero en el papel.
 *
 * Por eso lo que se le muestra a quien contó sale del TIQUETE y no de la cuenta
 * del portal. Es la misma regla que ya rige el módulo —el esperado lo calcula la
 * caja, no nosotros—, aplicada al lugar donde la caja de verdad lo dice.
 */
interface Tiquete {
  texto: string;
  tipo: string | null;
  /** El efectivo declarado, tal como lo imprimió. `null` si no se pudo leer. */
  contado: number | null;
  /** TOTAL CAJA del tiquete — la pieza con la que el portal decide. */
  total_caja: number | null;
  cobros_credito: number | null;
  /**
   * SUBTOTAL y (-) VALES, para DERIVAR los cobros de crédito de la suma del
   * propio tiquete en vez de fiarse del renglón. Ver la nota en `leerTiquete`.
   */
  subtotal: number | null;
  vales: number | null;
  retencion?: number;
  devoluciones?: number;
  /**
   * Las líneas con las que la caja llegó a lo esperado, en su orden.
   *
   * Van al papel que imprime el portal: sin ellas el comprobante diría una
   * diferencia y no de dónde sale, y quien lo lea no tendría cómo comprobarla.
   * Es lo mismo que ya hace el vale de bolsa, que lista de qué bolsa salió cada
   * parte en vez de sólo el total.
   */
  lineas: { rotulo: string; monto: number }[];
  /** Lo que el tiquete dice de sí mismo: identifica el papel sobre la mesa. */
  empleado: string | null;
  caja: string | null;
  turno: string | null;
  /** Contexto, NO parte de la cuenta: ninguna pasa por la caja. Como vengan. */
  formas: { rotulo: string; monto: number }[];
}

async function leerTiquete(
  cookie: string, idCorte: string, erpId: number,
): Promise<Tiquete | null> {
  const r = await fetch(TICKET_URL, {
    method: "POST",
    headers: {
      Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: new URLSearchParams({
      process: "imprimir", id_corte: idCorte, id_sucursal_dom: String(erpId),
    }).toString(),
    signal: AbortSignal.timeout(45_000),
  });
  const mov = JSON.parse(await r.text())?.movimiento ?? null;
  // Tiene que ser el corte PEDIDO: el origen contesta 200 con un tiquete de
  // otro corte cuando el id no es de esta sala. Mismo freno que el sync.
  if (!mov || !new RegExp(`:\\s*${idCorte}\\b`).test(mov)) return null;

  const linea = (rx: RegExp) => {
    const m = String(mov).match(rx);
    if (!m) return null;
    const n = Number(m[1].replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  const totalCaja = linea(/TOTAL CAJA \$:\s*([\d.,-]+)/i);
  const efectivo  = linea(/EFECTIVO \$:\s*([\d.,-]+)/i);
  /* SUBTOTAL y VALES: las dos piezas con las que el portal DERIVA los cobros de
   * crédito de la propia suma del tiquete —`total_caja − subtotal + vales`, que
   * cierra al centavo en los 493 cortes capturados— en vez de leer el renglón
   * «COBROS CREDITO». El papel a veces no lo imprime y su ausencia se lee igual
   * que un cero; un cero de más ahí inventa un faltante del tamaño de los
   * cobros del día. Es exactamente la cuenta que `contraste` ya hace sobre la
   * tabla, y viajan para que el corte recién hecho no se cuente distinto que el
   * mismo corte mirado mañana. */
  const subtotal  = linea(/SUBTOTAL\s*\$:\s*([\d.,-]+)/i);
  const vales     = linea(/\(-\)\s*VALES\s*\$:\s*([\d.,-]+)/i);
  const retencion = linea(/RETENCION \$:\s*([\d.,-]+)/i) ?? 0;
  const devol     = linea(/DEVOLUCIONES\s*\$:\s*([\d.,-]+)/i) ?? 0;
  const texto = String(mov);
  const cabecera = {
    tipo:     texto.match(/CORTE TIPO:\s*([^\n]+)/i)?.[1]?.trim() ?? null,
    empleado: texto.match(/EMPLEADO:\s*([^\n]+)/i)?.[1]?.trim() ?? null,
    caja:     texto.match(/CAJA\s*:\s*(\d+)/i)?.[1] ?? null,
    turno:    texto.match(/TURNO:\s*(\d+)/i)?.[1] ?? null,
  };

  // Sólo las líneas que TRAJO el tiquete: una sala sin caja chica no imprime esa
  // línea, y un cero inventado en el papel se lee como un dato medido.
  const lineas: { rotulo: string; monto: number }[] = [];
  const agregar = (rotulo: string, rx: RegExp, siCero = false) => {
    const v = linea(rx);
    if (v === null || (v === 0 && !siCero)) return;
    lineas.push({ rotulo, monto: v });
  };
  // Los rótulos llevan el signo, igual que el tiquete del origen: en el papel
  // «(-) Vales» se sigue de un vistazo y un menos suelto delante del número se
  // pierde entre los dígitos.
  agregar("Saldo inicial",      /SALDO INICIAL \$:\s*([\d.,-]+)/i);
  agregar("Saldo caja chica",   /SALDO CAJA CHICA \$:\s*([\d.,-]+)/i);
  agregar("(+) Ingresos",       /\(\+\)\s*INGRESOS \$:\s*([\d.,-]+)/i);
  agregar("(+) Venta",          /\(\+\)\s*VENTA \$:\s*([\d.,-]+)/i, true);
  agregar("(-) Vales",          /\(-\)\s*VALES \$:\s*([\d.,-]+)/i);
  agregar("(+) Cobros credito", /\(\+\)\s*COBROS CREDITO \$:\s*([\d.,-]+)/i);
  agregar("(-) Retencion",      /\(-\)\s*RETENCION \$:\s*([\d.,-]+)/i);
  agregar("(-) Devoluciones",   /\(-\)\s*DEVOLUCIONES\s*\$:\s*([\d.,-]+)/i);

  /* Las formas de pago que NO pasan por la caja, LEÍDAS COMO VENGAN.
   *
   * ⚠️ Acá había dos regex fijas —«PAGOS CON TARJETA» y «VENTAS AL CREDITO»— y
   * eso es exactamente el defecto que ya costó los $2.20 de Salud 2 del 13-ago:
   * con las formas escritas a mano, una que el origen empiece a imprimir
   * mañana —cheque, transferencia— no aparece como cero, **desaparece sin
   * dejar rastro**, y el papel sigue cuadrando diciendo de menos. La regla del
   * portal es pintarlas como vengan (ver la nota de `CorteDetalleModal`).
   *
   * La forma del tiquete es: después de la línea DIFERENCIA vienen bloques, y
   * cada uno es un encabezado sin número, sus renglones de detalle, y un
   * `TOTAL <monto>` que lo cierra. Se recorre así, sin saber cuántos son ni
   * cómo se llaman.
   *
   * Del detalle se toma SÓLO el total: el origen lista transacción por
   * transacción y cada renglón dice «COF» y un monto — el mismo rótulo
   * repetido, que no distingue una de otra. Lo único que informa es el total, y
   * con eso el papel del portal baja de 38 renglones a 21.
   *
   * Van al comprobante como contexto y NO entran en la cuenta: ninguna pasa por
   * la caja. Están porque quien lee el papel pregunta «¿y lo que se vendió con
   * tarjeta?» y sin ellas parece que falta plata. */
  const formas: { rotulo: string; monto: number }[] = [];
  {
    const cola = texto.split(/DIFERENCIA\s*\$:[^\n]*\n/i)[1]
      ?? texto.split(/EXACTO[^\n]*\n/i)[1] ?? "";
    let titulo: string | null = null;
    for (const cruda of cola.split("\n")) {
      const l = cruda.trim();
      if (!l) continue;
      const total = l.match(/^TOTAL\s+([\d.,-]+)$/i);
      if (total && titulo) {
        const n = Number(total[1].replace(/,/g, ""));
        if (Number.isFinite(n) && n !== 0) {
          // Como viene, sólo con la primera en mayúscula: el rótulo es del
          // origen y traducirlo acá sería una segunda lista que mantener.
          formas.push({
            rotulo: titulo.charAt(0) + titulo.slice(1).toLowerCase(),
            monto: n,
          });
        }
        titulo = null;
      } else if (!/\d/.test(l)) {
        titulo = l;               // encabezado de bloque: no trae número
      }
    }
  }

  // Un tiquete sin las dos líneas de la cuenta se devuelve igual, con la cuenta
  // en `null`. Inventar un cero acá sería decir «cuadró» sobre algo que no se
  // leyó, que es peor que no saber.
  if (totalCaja === null || efectivo === null) {
    return {
      texto, ...cabecera, contado: null, formas, lineas,
      total_caja: null, cobros_credito: null, subtotal: null, vales: null,
    };
  }
  /* Se devuelven las PIEZAS, no un veredicto.
   *
   * Quién gana entre la cuenta del formulario y la del tiquete ya lo decide
   * `diferenciaDelCorte` en el portal, con una regla que se contrastó contra un
   * testigo independiente (el aviso de la sala del 13-ago) y que tiene un caso
   * en el que la buena es la del FORMULARIO: cuando el tiquete suma un cobro de
   * crédito que a esa hora todavía no había entrado. Resolverlo también acá
   * sería la misma pregunta contestada dos veces, y la segunda respuesta no
   * conoce ese caso. */
  return {
    texto, ...cabecera, contado: efectivo, formas, lineas,
    total_caja: totalCaja,
    cobros_credito: linea(/\(\+\)\s*COBROS CREDITO \$:\s*([\d.,-]+)/i) ?? 0,
    subtotal, vales,
    retencion, devoluciones: devol,
  };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

  try {
    const body = await req.json().catch(() => ({}));
    const simular = body.simular === true;
    const sala = Number(body.sala);
    const efectivo = Number(body.efectivo);
    /* ── EL Z ES UN TIPO DE CORTE, NO UN EFECTO DE CERRAR EL TURNO ─────────
     *
     * Descubierto el 1-sep, cerrando de verdad por primera vez: el portal
     * llamaba `apertura_caja.php process=cerrar_turno` y daba por hecho que eso
     * emitía el Z. **No lo emite.** Cierra el turno y nada más. El día quedó
     * sin Z y hubo que hacerlo a mano en el sistema de la caja.
     *
     * El Z sale por ESTE mismo formulario, el del corte, con `tipo_corte = Z`:
     *
     *     <option value="C">Corte de caja
     *     <option value="X">Corte X          ← el que viene marcado
     *     <option value="Z">Corte Z
     *
     * Y no se le declara nada: el formulario del Z trae el efectivo ya
     * calculado y de sólo lectura. Es lo que dijo el usuario —«el corte Z no se
     * ingresa nada, ya el ERP lo hace solo y finaliza»— y es lo que se ve en su
     * pantalla: `Total Efectivo en Caja` gris con la cifra puesta.
     *
     * Por eso `efectivo` no se exige con `tipo: 'Z'`. */
    const tipo = String(body.tipo ?? "C").toUpperCase() === "Z" ? "Z" : "C";
    const esZ = tipo === "Z";
    if (!Number.isFinite(sala)) return json({ ok: false, error: "Falta la sala." }, 400);
    if (!simular && !esZ && !(Number.isFinite(efectivo) && efectivo >= 0)) {
      return json({ ok: false, error: "Falta el efectivo contado." }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const quien = await requireActiveEmployeeUser(req, supabase);
    if (!quien) return json({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);
    const permiso = await permisoDeModulo(supabase, quien.id, "caja_vales", "can_edit");
    if (permiso.roto) return json({ ok: false, error: permiso.roto }, 503);
    if (!permiso.puede) return json({ ok: false, error: "No tienes permiso para hacer el corte desde el portal." }, 403);
    // El ALCANCE, que hasta el 31-ago no se miraba: `sala` viene del navegador y
    // era lo único que decidía a qué caja se le hacía el corte. Quien tuviera el
    // permiso podía cortar la caja de cualquiera de las siete salas, y un corte
    // no se deshace. El módulo `caja_vales` no ofrecía alcance en la pantalla de
    // permisos, así que tampoco había forma de acotarlo.
    if (!permiso.alcanceTodo && Number(permiso.emp?.branch_id) !== sala) {
      return json({ ok: false, error: "Solo puedes hacer el corte de tu propia sala." }, 403);
    }

    const entrada = getErpBranchMap().find((e) => e.branchId === sala);
    if (!entrada) return json({ ok: false, error: "Esa sala no está configurada." }, 400);

    const { username, password } = getCortesCreds();
    const cookie = await getSessionCookie(username, password);
    await abrirSala(cookie, entrada.erpId);

    /* ── UN DÍA TIENE UN SOLO Z, y hay que frenarlo ANTES de emitirlo ───────
     *
     * Lo pide el arreglo mismo: desde que el cierre del día se PARA cuando el
     * comprobante no confirma que salió un Z, aparece un reintento — y sin este
     * freno el reintento emite un SEGUNDO Z del mismo día. Un Z no se deshace,
     * así que serían dos cierres fiscales de una jornada.
     *
     * Y el caso no es raro: el aviso también salta cuando el comprobante no se
     * pudo LEER, que es un fallo de red sobre un Z que salió perfecto. Ahí quien
     * cierra ve «no se pudo confirmar», aprieta de nuevo, y sin esto se lleva el
     * duplicado.
     *
     * Se pregunta al ORIGEN y no a `cortes_caja`: la tabla del portal se llena
     * con la captura, que corre después, así que recién emitido diría «no hay Z»
     * siempre. Es la misma lectura que hace `operar-caja` para comprobar el
     * cierre, con el mismo recorrido de la tabla.
     *
     * Si la comprobación no se puede hacer, NO se sigue: emitir un Z a ciegas es
     * justo lo que este freno viene a evitar.
     *
     * ⚠️ **VA ANTES DE LEER LA APERTURA, y ese orden es el arreglo.** El Z
     * cierra la apertura al salir, así que en el reintento —el caso para el que
     * este freno existe— ya no hay apertura viva que leer: preguntando primero
     * por ella, el que vuelve a apretar recibía «esa sala no tiene una caja
     * abierta ahora» en vez de «este día ya tiene su corte Z», que es la
     * verdad y además la que su llamador sabe tratar (`ya_estaba`). Las cinco
     * salas que cerraron el 3-sep terminaron viendo el mensaje equivocado. */
    if (esZ) {
      const dia = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
      let yaHayZ: boolean | null = null;
      try {
        const listado = await (await fetch(CORTE_URL, {
          method: "POST",
          headers: {
            Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: new URLSearchParams({ process: "ok", fecha1: dia, fecha2: dia }).toString(),
          signal: AbortSignal.timeout(45_000),
        })).text();
        yaHayZ = [...listado.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].some(([, tr]) => {
          const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
            .map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
          return tds.length >= 8 && tds[5].toUpperCase() === "Z";
        });
      } catch (e) {
        console.error("hacer-corte-caja: no se pudo revisar si ya hay Z:", e);
      }
      if (yaHayZ === null) {
        return json({
          ok: false,
          error: "No se pudo comprobar si el día ya tiene su corte Z. No se emite otro:"
            + " un Z de más no se deshace. Volvé a intentarlo en un momento.",
        }, 503);
      }
      if (yaHayZ) {
        return json({
          ok: false, ya_estaba: true,
          error: "Este día ya tiene su corte Z. No se emite otro.",
        }, 409);
      }
    }

    const viva = await aperturaViva(cookie);
    if (!viva) return json({ ok: false, error: "Esa sala no tiene una caja abierta ahora." }, 409);

    /* ── UN Z CON EL TURNO PARADO ──────────────────────────────────────────
     *
     * ⚠️ **Este freno nació de una lectura equivocada y se deja como red, no
     * como explicación.** Decía que un Z sale en $0.00 porque el turno está
     * parado, medido sobre cuatro casos. El 3-sep en Salud 4 salió en $0.00
     * **con el turno corriendo** —el formulario leído a las 21:16:08 trae
     * `id_apertura=2898` y el paso previo contestó «el turno ya está
     * corriendo»—, así que la causa era otra: la casilla `total_efectivo` se
     * mandaba VACÍA (ver el envío del Z, más abajo). Los cuatro casos eran una
     * correlación: los Z en cero eran los del PORTAL, y los del portal eran los
     * que además venían de un turno recién cerrado.
     *
     * Se conserva igual porque un Z sobre un turno parado sigue sin tener nada
     * que contar, y porque no es un candado sin salida: iniciar el turno se
     * hace desde el propio portal y `cerrarElDia` lo hace solo antes de pedir
     * el Z. */
    if (esZ && !simular && viva.turnoCorriendo === false) {
      console.error(`[hacer-corte-caja] Z frenado sala=${sala}: turno parado (apertura ${viva.aper})`);
      return json({
        ok: false, turno_parado: true,
        error: "El turno está cerrado, y el cierre del día hecho así no cuenta nada. "
             + "Iniciá el turno y volvé a cerrar el día.",
      }, 409);
    }

    /* ── 1. El vale de las salidas del día, ANTES del corte ────────────────
     *
     * El Z NO lo escribe: el corte de caja que lo precede ya lo hizo, y volver
     * a intentarlo con la lista vacía no haría nada — pero con una salida que
     * llegara entre medio escribiría un SEGUNDO vale por dinero que el corte C
     * ya descontó, o sea un faltante fabricado en el cierre del día, que no se
     * deshace. El vale pertenece al conteo, y el Z no cuenta nada. */
    const { data: pend, error: errPend } = esZ
      ? { data: [], error: null }
      : await supabase.rpc("caja_vales_pendientes");
    if (errPend) throw new Error(`leyendo pendientes: ${errPend.message}`);
    const mias = (pend ?? []).filter((p: { branch_id: number }) => Number(p.branch_id) === sala);
    const montoVale = mias.reduce((s: number, p: { monto: number }) => s + Number(p.monto), 0);

    if (simular) {
      /* ── El formulario se LEE, y sus valores van al log, no a la respuesta ──
       *
       * `simular` no escribe una línea —ni el vale, ni el corte— y leer la
       * pantalla del corte es un GET. Se hace acá porque es la única forma de
       * mirar qué trae ese formulario sin cortarle la caja a una sala.
       *
       * Lo que se buscaba: si trae la venta, los ingresos, los vales y los
       * cobros de crédito POR SEPARADO, para armar acá el esperado
       * —`ingresos + venta − vales + cobros`, la cuenta que cierra en los 486
       * tiquetes medidos— en vez de mandar `contado − total_corte`, que arrastra
       * un número del origen que se desvía por un múltiplo entero impredecible
       * de los cobros (+5× en el corte 14319, 0× en el 14378).
       *
       * ⚠️ **La respuesta fue que NO** (medido el 2-sep en Salud 4): los campos
       * existen —los 50 están listados— pero `total_cobros`, `total_salida`,
       * `retencion` y `monto_apertura` llegan VACÍOS en el HTML; los llena el
       * JavaScript de la pantalla del origen después de cargar. Con número sólo
       * vienen `total_entrada`, `total_corte`, `t_factuta` y `total_factura`.
       *
       * O sea que la cuenta por piezas NO se puede armar leyendo el formulario.
       * El camino que queda es el tiquete, que sí trae todo y que esta función
       * ya lee — pero recién DESPUÉS de que el corte salió.
       *
       * ⚠️ Los VALORES van sólo al log del servidor. Devolverlos sería entregar
       * el esperado antes del conteo, que es exactamente lo que el conteo a
       * ciegas viene a esconder — y `simular` es parte del mismo flujo. A la
       * respuesta van los NOMBRES, que no dicen cuánto hay. */
      let campos: Map<string, string> | null = null;
      try {
        const htmlSim = await (await fetch(`${PANTALLA}?aper_id=${viva.aper}`, {
          headers: { Cookie: cookie }, signal: AbortSignal.timeout(45_000),
        })).text();
        campos = camposDelFormulario(htmlSim);
      } catch (e) {
        console.error("hacer-corte-caja: no se pudo leer el formulario:", e);
      }

      /* ── ¿El sistema de la caja mete al cajón un cobro que no fue efectivo? ──
       *
       * El listado de movimientos del origen es la fuente que ya se usa para el
       * freno del vale, y es la MISMA de la que salen los «POR ABONO A CREDITO»
       * que el portal captura: medido sobre 48 sala-días, su suma coincide al
       * centavo con la línea COBROS CREDITO del tiquete en 47.
       *
       * Entonces: si un abono cobrado por transferencia aparece ahí, el origen
       * lo está tratando como efectivo que entró al cajón — y el corte lo va a
       * pedir en billetes. Se cruza por MONTO, que es lo único que el concepto
       * («POR ABONO A CREDITO», idéntico en los 112 medidos) permite comparar.
       *
       * Se devuelve el veredicto y la CANTIDAD de renglones, nunca su suma: el
       * esperado no viaja antes del conteo. */
      let cajon: string | null = null;
      let cuantosAbonosEnLaCaja: number | null = null;
      // Los montos de los «POR ABONO A CREDITO» del día. Se declara afuera
      // porque también los usa la comprobación del esperado, más abajo: son la
      // misma lista y pedirla dos veces sería consultar dos veces al origen.
      let montosDeAbono: number[][] = [];
      try {
        const hoy = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
        const dt = await (await fetch(
          `${MOV_URL}?fechai=${hoy}&fechaf=${hoy}&draw=1&start=0&length=1000`,
          { headers: { Cookie: cookie, "X-Requested-With": "XMLHttpRequest" }, signal: AbortSignal.timeout(60_000) },
        )).json();
        if (Array.isArray(dt?.data)) {
          const montos = (dt.data as string[][])
            .filter((f) => /ABONO A CREDITO/i.test(String(f[1] ?? "")))
            .map((f) => f.map((c) => Number(String(c).replace(/[^0-9.-]/g, "")))
              .filter((n) => Number.isFinite(n) && n > 0));
          cuantosAbonosEnLaCaja = montos.length;
          montosDeAbono = montos;
          /* El `error` NO se descarta, y acá menos que en otros lados: si el
           * select falla, `abonos` llega vacío y el veredicto diría «hoy no
           * hubo cobros que no fueran efectivo» sobre un día que sí los tuvo.
           * Un instrumento que confunde «no pude leer» con «no hay» es peor que
           * no tenerlo. */
          const { data: abonos, error: errAbonos } = await supabase
            .from("creditos_abonos_portal")
            .select("monto, forma, anulado_at")
            .eq("branch_id", sala)
            .gte("created_at", `${hoy}T00:00:00-06:00`)
            .lte("created_at", `${hoy}T23:59:59-06:00`);
          if (errAbonos) throw new Error(`leyendo los cobros del portal: ${errAbonos.message}`);
          const noEfvo = (abonos ?? []).filter((a) => !a.anulado_at
            && String(a.forma ?? "").toLowerCase() !== "efectivo");
          const aparece = (m: number) => montos.some((fila) => fila.some((n) => Math.abs(n - m) < 0.005));
          /* Los de EFECTIVO también se miran, y no es por completitud: si
           * ninguno apareciera, «no entra el que no es efectivo» no probaría
           * nada — sería que el origen no anota NINGÚN abono del portal, que es
           * un defecto peor y con la misma cara. Los dos veredictos juntos son
           * los que distinguen una cosa de la otra. */
          const efvo = (abonos ?? []).filter((a) => !a.anulado_at
            && String(a.forma ?? "").toLowerCase() === "efectivo");
          const cuenta = (l: typeof efvo) => l.filter((a) => aparece(Number(a.monto))).length;
          const veredicto = (l: typeof efvo, n: number) => (!l.length
            ? "no_hubo"
            : n === l.length ? "entran_todos_" + n + "_de_" + l.length
              : n === 0 ? "no_entra_ninguno_de_" + l.length
                : "entran_" + n + "_de_" + l.length);
          cajon = "efectivo:" + veredicto(efvo, cuenta(efvo))
            + " | no_efectivo:" + veredicto(noEfvo, cuenta(noEfvo));
        }
      } catch (e) {
        console.error("hacer-corte-caja: no se pudo leer los movimientos:", e);
      }

      /* ── Quién llena los campos vacíos ─────────────────────────────────
       *
       * Los campos que hacen falta para armar el esperado llegan vacíos en el
       * HTML porque los completa el JavaScript de la pantalla del origen. Eso
       * significa que **existe una llamada que devuelve esos números**, y que
       * el portal la puede hacer igual — sin emitir ningún documento, que es la
       * condición (el usuario: «el X nunca se hace, sólo C y Z»).
       *
       * Acá se listan los `process:` y las URLs que aparecen en los scripts de
       * la página, que es el mapa de esas llamadas. Son NOMBRES: no hay un solo
       * monto, así que no filtra el esperado antes del conteo. */
      // Devuelve lo que va a hacer SIN el esperado: decirlo antes del conteo
      // sería devolver justo lo que el conteo a ciegas viene a esconder.
      return json({
        abonos_en_la_caja: cuantosAbonosEnLaCaja,
        un_cobro_que_no_es_efectivo: cajon,
        ok: true, simulado: true, sala,
        apertura: viva.aper, turno: viva.turno,
        vale_a_escribir: mias.length ? { salidas: mias.length, monto: Number(montoVale.toFixed(2)) } : null,
        campos_del_formulario: campos ? [...campos.keys()] : null,
        /* Cuáles de esos campos traen un número distinto de cero EN EL HTML.
         * Importa porque la pantalla del origen llena varios con JavaScript
         * después de cargar, y `camposDelFormulario` lee el `value=` estático:
         * un campo que existe pero llega en cero no sirve para armar la cuenta,
         * y confundirlo con un dato daría un esperado de menos.
         *
         * Medido el 2-sep en Salud 4: de los 50 campos, sólo `total_entrada`,
         * `total_corte`, `t_factuta` y `total_factura` traen número. Los que
         * harían falta para armar el esperado —`total_cobros`, `total_salida`,
         * `retencion`, `monto_apertura`— llegan VACÍOS. O sea que la cuenta por
         * piezas no se puede armar desde este HTML, y el primer detector que se
         * escribió creyó que un `total_cobros` vacío era un cero medido.
         *
         * Son NOMBRES: no dicen cuánto hay. */
        campos_con_numero: campos
          ? [...campos].filter(([, v]) => Number.isFinite(Number(v)) && Number(v) !== 0)
            .map(([k]) => k)
          : null,
      });
    }

    /* ── El vale abierto de la sala se REUTILIZA o se CIERRA, nunca se duplica ─
     *
     * `caja_vales_portal_abierto_unico` deja UN vale abierto por sala
     * (`PENDIENTE`/`ANOTADO`). Acá se insertaba uno sin mirar si ya había otro,
     * y el índice contestaba 23505 — que el portal traduce a «Ya existe un
     * registro con esos datos», un aviso que no nombra ni al vale ni a la sala.
     *
     * Medido el 2-sep en Salud 3: el vale 1 quedó ANOTADO desde el 1-sep,
     * pasaron OCHO cortes encima —el Z del día incluido— y ninguno lo cerró, así
     * que la sala no podía volver a cortar desde el portal en cuanto tuviera una
     * salida pendiente. Hacían falta las dos cosas a la vez —un vale abierto y
     * salidas nuevas— y por eso el defecto vivió sin que nadie lo viera.
     *
     * La decisión es la que ya toma `anotar-vales-caja`, dicha una sola vez de
     * las dos: si pasó un corte o cambió el día, el vale pertenece a un tramo ya
     * cortado y se CIERRA; si es del mismo tramo, se le SUMA. Un asiento allá y
     * el detalle acá, que es el diseño de la tabla. */
    const { data: ultimoCorte, error: errUltimo } = await supabase
      .from("cortes_caja").select("id")
      .eq("branch_id", sala)
      .order("fecha", { ascending: false }).order("hora", { ascending: false })
      .limit(1);
    if (errUltimo) throw new Error(`leyendo el último corte: ${errUltimo.message}`);
    const corteAlAbrir = ultimoCorte?.[0]?.id ?? null;

    type ValeAbierto = {
      id: number; erp_movimiento_id: number | null; monto: number | string;
      fecha: string; corte_id_al_abrir: number | null;
    };
    const { data: abiertos, error: errAbierto } = await supabase
      .from("caja_vales_portal")
      .select("id, erp_movimiento_id, monto, fecha, corte_id_al_abrir")
      .eq("branch_id", sala).in("estado", ["PENDIENTE", "ANOTADO"]).limit(1);
    if (errAbierto) throw new Error(`leyendo el vale abierto: ${errAbierto.message}`);
    let vale: ValeAbierto | null = (abiertos?.[0] as ValeAbierto | undefined) ?? null;

    /* El del tramo anterior se cierra ACÁ, y no cuando aparezcan salidas nuevas.
     * Dejárselo al cron es lo que trabó a Salud 3: el cron sólo entra a una sala
     * que TIENE pendientes, así que un vale sin salidas nuevas detrás se queda
     * abierto para siempre y le tapa la ranura a todos los cortes que vengan. */
    if (vale && (vale.corte_id_al_abrir !== corteAlAbrir
      || (mias.length > 0 && vale.fecha !== mias[0].dia_abierto))) {
      const ahora = new Date().toISOString();
      const { error } = await supabase.from("caja_vales_portal")
        .update({ estado: "CERRADO", cerrado_at: ahora, updated_at: ahora })
        .eq("id", vale.id);
      if (error) throw new Error(`cerrando el vale del tramo anterior: ${error.message}`);
      vale = null;
    }

    let valeId: number | null = null;
    let movVale: number | null = null;
    let montoDelVale = 0;
    if (mias.length) {
      if (!vale) {
        const { data: creado, error } = await supabase.from("caja_vales_portal")
          .insert({
            branch_id: sala, fecha: mias[0].dia_abierto, monto: 0,
            corte_id_al_abrir: corteAlAbrir, anotado_por: quien.id,
          })
          .select("id, erp_movimiento_id").single();
        if (error) throw new Error(`abriendo el vale: ${error.message}`);
        vale = {
          id: creado.id, erp_movimiento_id: creado.erp_movimiento_id ?? null,
          monto: 0, fecha: mias[0].dia_abierto, corte_id_al_abrir: corteAlAbrir,
        };
      }
      valeId = vale.id;

      /* ── El total del vale se DERIVA de sus salidas, no se acumula ────────
       *
       * Cuántas cubre EN TOTAL y por cuánto, contadas desde las salidas que lo
       * apuntan. El concepto es lo único que se lee del otro lado, y un vale que
       * ya cubría tres no puede anunciarse con las dos de ahora.
       *
       * Derivarlo —en vez de `vale.monto + lo de ahora`— es lo que hace que un
       * reintento sea inocuo. Las dos escrituras que ligan las salidas pasan
       * DESPUÉS de mover el dinero, así que un fallo entre medio deja el vale
       * con su monto ya escrito y las salidas todavía pendientes: sumando, el
       * reintento las contaría dos veces y editaría el asiento al doble. Con la
       * derivación el número sale de lo que está ligado más lo que se va a
       * ligar, que es la verdad en cualquier punto de esa secuencia.
       *
       * Y las anuladas no cuentan: `caja_vales_pendientes` las excluye, así que
       * incluirlas acá haría que las dos mitades de la misma suma no coincidan. */
      const { data: ligadas, error: errCuenta } = await supabase
        .from("bolsas_movimientos").select("monto")
        .eq("caja_vale_id", valeId).is("anulado_at", null).lt("monto", 0);
      if (errCuenta) throw new Error(`contando lo que ya cubre el vale: ${errCuenta.message}`);
      const yaCubiertas = (ligadas ?? []).length;
      montoDelVale = Number(((ligadas ?? [])
        .reduce((t: number, m: { monto: number }) => t - Number(m.monto), 0) + montoVale).toFixed(2));
      const cuantas = yaCubiertas + mias.length;
      const concepto = `VALE DE CAJA ${valeId} (${cuantas} salida${cuantas === 1 ? "" : "s"})`;

      // Freno: ¿ya está escrito? Un reintento no puede duplicar un vale.
      const marca = `VALE DE CAJA ${valeId} `;
      const dt = await (await fetch(
        `${MOV_URL}?fechai=${mias[0].dia_abierto}&fechaf=${mias[0].dia_abierto}&draw=1&start=0&length=1000`,
        { headers: { Cookie: cookie, "X-Requested-With": "XMLHttpRequest" }, signal: AbortSignal.timeout(60_000) },
      )).json().catch(() => null);
      if (!Array.isArray(dt?.data)) throw new Error("no se pudo revisar si el vale ya estaba escrito");
      const yaEsta = (dt.data as string[][]).find((f) => String(f[1] ?? "").startsWith(marca));
      movVale = vale.erp_movimiento_id ?? (yaEsta ? Number(yaEsta[0]) : null);

      /* Con asiento ya escrito se EDITA con el monto nuevo. Escribir un segundo
       * movimiento por las salidas de ahora dejaría DOS vales del mismo tramo y
       * el corte descontaría ese dinero dos veces. */
      const resp = movVale
        ? await (await fetch(EDITAR_VALE, {
          method: "POST",
          headers: {
            Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: new URLSearchParams({
            process: "editar", id_movimiento: String(movVale), id_apertura: viva.aper,
            id_empleado: viva.emp, turno: viva.turno,
            monto: dosDecimales(montoDelVale), concepto,
          }).toString(),
          signal: AbortSignal.timeout(45_000),
        })).text()
        : await (await fetch(CREAR_VALE, {
          method: "POST",
          headers: {
            Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: new URLSearchParams({
            process: "salida", id_apertura: viva.aper, id_empleado: viva.emp, turno: viva.turno,
            monto: dosDecimales(montoDelVale), concepto,
            proveedor: "", tipo_doc: "", n_doc: "", recibe: "PORTAL", id_tipo: ID_TIPO_SALIDA,
          }).toString(),
          signal: AbortSignal.timeout(45_000),
        })).text();
      if (!/"typeinfo"\s*:\s*"Success"/i.test(resp)) {
        throw new Error(`el sistema no aceptó el vale: ${resp.slice(0, 160)}`);
      }
      if (!movVale) movVale = Number(JSON.parse(resp)?.id_mov) || null;

      /* ── Estas DOS escrituras pasan DESPUÉS de mover dinero ─────────────
       *
       * El vale ya está escrito en el sistema de origen. Si el `update` falla y
       * su error se descarta, el vale queda en PENDIENTE con la plata ya
       * movida: la próxima corrida lo vuelve a intentar y sólo el freno de
       * «¿ya está escrito?» evita el duplicado. Y el segundo deja salidas de
       * bolsa sin vale que las cubra, que es justo lo que el corte tiene que
       * poder demostrar.
       *
       * Lanzar acá es lo correcto y no una molestia: quien llama recibe el
       * error, el vale queda pendiente A PROPÓSITO y alguien lo mira — en vez
       * de un corte que se declara completo sobre una anotación que no ocurrió.
       */
      const ahora = new Date().toISOString();
      const { error: errVale } = await supabase.from("caja_vales_portal").update({
        erp_movimiento_id: movVale, monto: montoDelVale,
        estado: "ANOTADO", anotado_at: ahora, updated_at: ahora, ultimo_error: null,
      }).eq("id", valeId);
      if (errVale) {
        throw new Error(`el vale se escribió en el sistema (${movVale}) pero no se pudo`
          + ` anotar en el portal: ${errVale.message}`);
      }
      const { error: errLigar } = await supabase.from("bolsas_movimientos")
        .update({ caja_vale_id: valeId })
        .in("id", mias.map((p: { movimiento_id: number }) => p.movimiento_id));
      if (errLigar) {
        throw new Error(`el vale quedó anotado pero no se pudo ligar a sus salidas:`
          + ` ${errLigar.message}`);
      }
    }

    // ── 2. La pantalla del corte, YA con el vale adentro ────────────────────
    const html = await (await fetch(`${PANTALLA}?aper_id=${viva.aper}`, {
      headers: { Cookie: cookie }, signal: AbortSignal.timeout(45_000),
    })).text();
    const campos = camposDelFormulario(html);
    /* ── `total_corte` NO es un esperado del origen: es SU fórmula ───────────
     *
     * Leído del JavaScript del propio origen
     * (`js/funciones/funciones_corte_caja.js`, 2-sep):
     *
     *     total_corte = total_tike + total_factura + total_credito
     *                 + monto_apertura + total_entrada − total_salida
     *     diferencia  = total_efectivo − total_corte
     *
     * O sea que **NO suma los cobros de crédito** y **SÍ suma las ventas que no
     * fueron en efectivo**. Por eso se aparta de su propio tiquete —cuya cuenta
     * es `ingresos + venta − vales + cobros`— en el 23% de los cortes.
     *
     * ⚠️ **Eso NO lo introdujo el portal: es la misma cuenta que hace la
     * pantalla de la caja.** Medido sobre los 428 cortes anteriores al primer
     * corte hecho desde el portal: **92 (21.5%) ya discrepaban, el peor por
     * $970.40**. El portal reproduce fielmente lo que haría el dependiente.
     *
     * (Hay un `process=total_sistema` en ese JavaScript que sí traería el
     * esperado bueno. Está MUERTO: el campo `#total_sistema` no existe en el
     * formulario de hoy, y el endpoint contesta vacío — probado el 2-sep en las
     * seis salas. No es una salida.)
     *
     * ── DECISIÓN DEL USUARIO (2026-09-02): SE DEJA COMO ESTÁ ───────────────
     *
     *   «el error del ERP dejalo como está, es conocido que da el resultado
     *    incorrectamente de diferencias, por eso en el portal lo dejamos bien»
     *
     * O sea: el portal **reproduce** la cuenta del origen y no la corrige en su
     * registro. **No reproponerlo.** Se evaluó que el portal calculara el
     * esperado por su cuenta —tiene todas las piezas: ventas en efectivo por
     * `tipo_pago`, ingresos/vales/cobros del listado de movimientos, y el saldo
     * de apertura— y se descartó: la empresa ya conoce el defecto del origen y
     * el sitio donde el número tiene que estar bien es el portal.
     *
     * Dónde SÍ se corrige: `diferenciaDelCorte` en el portal, que usa el
     * tiquete. Lo que la pantalla muestra y el papel que imprime el portal
     * llevan la cifra buena; lo que queda con la del origen es el registro del
     * sistema de la caja y su propio tiquete — **a propósito**.
     *
     * Y las BOLSAS no dependen de esto: `bolsa_sugerida` resta de
     * `total_declarado`, que es el efectivo CONTADO, nunca el esperado. */
    const esperado = Number(campos.get("total_corte"));
    if (!campos.size || !Number.isFinite(esperado)) {
      throw new Error("no se pudo leer el formulario del corte");
    }

    /* ── UN CORTE DE $0.00 NO ES UN CONTEO, Y EL ORIGEN LO DA POR EXACTO ────
     *
     * Salud 4, 2-sep 13:09 (corte 14393). Se mandó el corte con el efectivo en
     * cero sobre una caja que esperaba $230.85, y el comprobante salió así:
     *
     *     TOTAL CAJA $:   230.85
     *     EFECTIVO  $:      0.00
     *     EXACTO FELICIDADES $:  0.00
     *
     * O sea: el origen NO calcula la diferencia cuando el declarado es cero —
     * la da por exacta— y publica el corte con total 0.00 y diferencia 0.00. El
     * documento nace inservible: dice haber cuadrado sobre una caja que nadie
     * contó, y no hay forma de arreglarlo después porque el origen no anula
     * cortes. Lo único que queda es descartarlo en el portal y volver a cortar,
     * con el turno ya cerrado del otro lado.
     *
     * Por eso el freno va ACÁ y no en la pantalla: es lo último antes de crear
     * un documento que no se deshace. La pantalla ya exige el campo escrito
     * (`efectivo !== ''`), pero un cero tecleado la pasa igual — y `efectivo`
     * llega por HTTP, así que la pantalla no es donde se decide.
     *
     * Las tres condiciones son las de `noContoEfectivo` en el portal y las de
     * `corte_no_conto_efectivo` en la base, dichas antes de que el corte
     * exista: si la caja NO espera dinero (`esperado <= 0`), un conteo de cero
     * es legítimo y pasa. */
    if (!simular && !esZ && Number(efectivo) === 0 && esperado > 0) {
      return json({
        ok: false,
        error: "No se puede cortar con $0.00: el sistema de la caja da por exacto "
             + "un corte sin efectivo contado, y el comprobante sale sin diferencia. "
             + "Hay que contar el efectivo del cajón y escribir cuánto hay.",
      }, 400);
    }

    // ── 3. El envío: sólo se cambia lo que teclea una persona ──────────────
    // Tarjeta y cheque van en CERO y no en lo que traiga la pantalla: no pasan
    // por la caja, y son las dos casillas por las que se tapa un faltante.
    //
    // Y el TIPO se fija en C, que es lo único que «reenviar el formulario tal
    // cual» no podía acertar. Medido el 31-ago en el formulario vivo de Salud 3:
    //
    //     <option  value="C">
    //     <option selected value="X">   ← el que viene marcado
    //     <option value="Z">
    //
    // O sea que el default del formulario es **X**, que es una LECTURA de
    // ventas y no un corte de efectivo. El portal reproducía fielmente ese
    // default y el primer corte hecho desde acá salió X: tiquete
    // «CORTE TIPO: X», sin línea de efectivo, y encima invisible en el portal
    // porque `sync-cortes-caja` sólo guarda C y Z. La persona lo repitió y el
    // segundo salió C, así que quedaron dos cortes de la misma caja con dos
    // minutos de diferencia.
    //
    // Los de caja son C. No es una preferencia: el X no cuenta el dinero.
    campos.set("tipo_corte", tipo);
    /* El Z NO declara: su formulario trae el efectivo calculado y de sólo
     * lectura —«el corte Z no se ingresa nada, ya el ERP lo hace solo y
     * finaliza» (usuario)—. Se reenvía lo que la pantalla trajo y no se le
     * escribe una diferencia: inventarle un conteo al cierre del día sería
     * declarar un número que nadie contó. */
    const diferencia = esZ ? 0 : Number(efectivo) - esperado;
    if (esZ) {
      /* ── EL Z DECLARA `total_corte`, QUE ES LO QUE ESCRIBE SU PANTALLA ─────
       *
       * Acá decía «el Z se manda como vino, no se le escribe ninguna casilla»,
       * y esa regla —reproducir en vez de mejorar— es la correcta. Lo que
       * estaba mal era creer que «como vino» significa «como está en el HTML»:
       * `total_efectivo` llega VACÍO y lo llena el JavaScript del origen
       * después de cargar, igual que `total_cobros`, `total_salida`,
       * `retencion` y `monto_apertura` — que ya estaba anotado en `simular`.
       * O sea que reenviarlo tal cual NO reproduce a la pantalla: reproduce a
       * un navegador que enviara el formulario antes de que su propio script
       * terminara.
       *
       * Con la casilla vacía el origen guarda **Total 0.00**. Los SEIS Z que
       * emitió el portal salieron así, y ninguno de los hechos desde la
       * pantalla de la caja. El comprobante impreso está bien —el origen lo
       * DERIVA de las ventas del turno; el tiquete del 14457 dice $1,037.20—,
       * pero el listado de cortes muestra el día cerrado en cero.
       *
       * ── Qué número va, y cómo se sabe ─────────────────────────────────────
       * Los **118** Z con total > 0 tienen diferencia exactamente $0.00. Los
       * 118. O sea que el Z no declara un conteo: el origen pone
       * `total_efectivo = total_corte` y la diferencia sale cero por
       * construcción. Se confirma contra el reporte impreso del 14459 (Salud 3,
       * 3-sep): documentos 1,179.60 + ingresos 274.92 − vales 185.79 =
       * **1,268.73**, que es su TOTAL y es la fórmula de `total_corte`.
       *
       * Sigue sin inventarse un conteo: `total_corte` es el número que el
       * propio origen calculó y puso en el formulario. Lo único que se hace es
       * copiarlo a la casilla que su script habría llenado.
       *
       * Si no viniera —nunca pasó: el formulario lo trae con número incluso
       * cuando `total_cobros` y compañía llegan vacíos— NO se emite. Un Z sin
       * su monto no se deshace; un día sin cerrar todavía se puede cerrar. */
      const totalCorte = Number(String(campos.get("total_corte") ?? "").replace(/[^0-9.-]/g, ""));
      if (!Number.isFinite(totalCorte)) {
        console.error(`[hacer-corte-caja] Z frenado sala=${sala}: total_corte ilegible `
          + `(${JSON.stringify(campos.get("total_corte"))})`);
        return json({
          ok: false,
          error: "El sistema de la caja no dio el total del cierre, y un corte Z sin su monto "
               + "no se puede corregir después. Volvé a intentarlo en un momento.",
        }, 503);
      }
      campos.set("total_efectivo", dosDecimales(totalCorte));
      campos.set("total_efectivo1", dosDecimales(totalCorte));
      campos.set("diferencia", "0.00");
      /* ── LO DEMÁS SÍ SE MANDA COMO VINO ───────────────────────────────────
       *
       * Hasta acá el portal le ponía `total_tarjeta` y `monto_ch` en CERO
       * también al Z, y le forzaba `diferencia = 0`. Eso está bien para un
       * corte C —poner tarjeta y cheque en cero ES el control, son las dos
       * casillas por las que se tapa un faltante— y está mal para el Z, por dos
       * motivos:
       *
       * 1. **El cierre del día no cuenta efectivo: cuenta lo VENDIDO**, con la
       *    tarjeta y el crédito adentro. Es lo mismo que ya dice
       *    `desgloseDelCierre` en el portal, y lo que corrigió la pantalla el
       *    13-ago cuando afirmaba que se habían contado $1,678.83 habiendo
       *    $1,602.88 en la caja.
       * 2. **No es lo que hace la pantalla de la caja.** Su `corte1()` serializa
       *    el formulario ENTERO y lo manda tal cual (leído en
       *    `js/funciones/funciones_corte_caja.js`): nadie escribe esas casillas
       *    al cerrar el día. El portal estaba inventando tres valores que el
       *    dependiente no manda.
       *
       * Y un Z **no se deshace**, así que la regla acá es reproducir, no
       * mejorar: se cambia sólo el tipo de documento, que es lo único que
       * «reenviar el formulario tal cual» no puede acertar —su default es X— y
       * la casilla que su propio script llena, que es la de arriba. */
    } else {
      campos.set("total_efectivo", dosDecimales(efectivo));
      campos.set("total_efectivo1", dosDecimales(efectivo));
      // Tarjeta y cheque en CERO: no pasan por la caja, y son las dos casillas
      // por las que se tapa un faltante. Es el control del conteo a ciegas.
      campos.set("total_tarjeta", "0");
      campos.set("monto_ch", "0");
      campos.set("diferencia", dosDecimales(diferencia));
    }
    if (body.observaciones) campos.set("observaciones", String(body.observaciones).slice(0, 200));

    const cuerpo = new URLSearchParams();
    for (const [k, v] of campos) cuerpo.set(k, v);

    // A `corte_caja_diario.php`, que es a donde lo manda `corte()` en la pantalla
    // del origen. Ver el bloque de la constante: mandarlo a `cierre_turno.php`
    // creaba el corte igual y ADEMÁS cerraba el turno.
    const respCorte = await (await fetch(PANTALLA, {
      method: "POST",
      headers: {
        Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: cuerpo.toString(),
      signal: AbortSignal.timeout(60_000),
    })).text();

    let datos: Record<string, unknown> | null = null;
    try { datos = JSON.parse(respCorte); } catch { datos = null; }
    const ok = String(datos?.typeinfo ?? "").toLowerCase() === "success";
    const idCorte = datos?.id_corte ?? null;

    // El tiquete manda sobre la cuenta del portal. Si no se pudo leer, se avisa
    // en vez de caer en silencio a un número que ya sabemos que puede estar mal.
    let tiquete: Tiquete | null = null;
    if (ok && idCorte) {
      try { tiquete = await leerTiquete(cookie, String(idCorte), entrada.erpId); }
      catch (e) { console.error("hacer-corte-caja: tiquete:", e); }
    }

    /* ── El efectivo de los cobros de crédito que el comprobante NO cuenta ──
     *
     * Cobrar un crédito desde el portal mete efectivo en el cajón, y el sistema
     * de la caja lo anota como movimiento del día pero no lo suma ni a INGRESOS
     * ni a la línea COBROS CREDITO: su esperado nace corto y el conteo de la
     * sala aparece como un sobrante que nadie hizo. Ver la sección de cuentas
     * por cobrar de CLAUDE.md — el 2-sep costó anunciar +$78.40 de sobrante
     * sobre un faltante de $9.85.
     *
     * En la tabla eso ya lo sella un trigger en `cobros_portal_efectivo`. Pero
     * el corte RECIÉN HECHO todavía no tiene fila —la escribe `sync-cortes-caja`
     * medio minuto después—, así que el papel que imprime el portal salía con la
     * cuenta sin corregir: el corte 14399 de Salud 4 se imprimió **+$88.40** y
     * la tarjeta, ya con la fila sellada, decía **+$0.15**. Dos números para el
     * mismo corte, y el equivocado es el que queda en papel.
     *
     * Se pregunta por el MISMO canónico que usa el trigger
     * (`cobros_portal_en_efectivo`) y no por una suma escrita acá: dos sumas
     * para la misma pregunta es cómo se vuelve a llegar a dos números. La hora
     * de corte es AHORA, que es lo que la fila va a tener; los abonos que
     * entren después no estaban en el cajón cuando se contó.
     *
     * `null` cuando no se pudo leer, nunca 0: un cero acá se lee como «no hubo
     * cobros» y devuelve en silencio la cifra equivocada. El papel lo declara. */
    let cobrosPortalEfectivo: number | null = null;
    if (ok) {
      const ahoraSv = new Date(Date.now() - 6 * 3600_000).toISOString();
      const { data: cobros, error: errCobros } = await supabase
        .rpc("cobros_portal_en_efectivo", {
          p_branch: sala,
          p_fecha: ahoraSv.slice(0, 10),
          p_hasta: ahoraSv.slice(11, 19),
        });
      if (errCobros) {
        console.error("hacer-corte-caja: cobros del portal:", errCobros.message);
      } else {
        cobrosPortalEfectivo = Number(cobros ?? 0);
      }
    }

    /* ── El tipo que SALIÓ se comprueba, no se supone ──────────────────────
     *
     * El formulario trae **X** marcado por defecto y el portal lo reenviaba tal
     * cual: el 31-ago el primer corte hecho desde acá salió una LECTURA en vez
     * de un corte de efectivo, la respuesta dijo «success», y nadie se enteró.
     * O sea que «pedí un C» y «salió un C» no son la misma afirmación.
     *
     * En el Z importa el doble, porque el cierre del día no se deshace y quien
     * cierra no tiene una segunda oportunidad de mirar. Si el tiquete dice otra
     * cosa —o no se pudo leer— se contesta con aviso, nunca en silencio. */
    /* ── EL COMPROBANTE ROTULA EL TIPO, NO LO DELETREA (2026-09-02) ────────
     *
     * `CORTE TIPO:` trae una ETIQUETA y no la letra que se pidió. Medido:
     *
     *     un C  →  «CORTE DE CAJA»   (14389 y 14394, Salud 3, 2-sep)
     *     un X  →  «X»               (31-ago, el que destapó esta comprobación)
     *
     * Comparándola contra la letra, **todo corte C disparaba la alarma**: «Se
     * pidió un corte C y el sistema emitió uno de tipo CORTE DE CAJA». En rojo,
     * sobre un corte perfecto, y en pantalla justo cuando alguien está por
     * confirmar dinero contado. Una alarma que grita en el caso normal es peor
     * que no tenerla: se aprende a ignorarla, y entonces no sirve el día del
     * caso real —que es el X mudo del 31-ago, el motivo por el que existe—.
     *
     * Se traduce la etiqueta a la letra en vez de compararla cruda, y lo que no
     * se reconoce NO se denuncia como tipo equivocado: se dice que no se pudo
     * confirmar. Afirmar «salió del tipo equivocado» sobre una etiqueta nueva
     * sería el mismo error al revés.
     *
     * La Z va primero a propósito: si algún día el Z se rotula «CORTE DE CAJA
     * Z», preguntar por «CORTE DE CAJA» antes lo leería como un C. */
    const letraDelTiquete = (etiqueta: string | null): "C" | "X" | "Z" | null => {
      const t = (etiqueta ?? "").trim().toUpperCase();
      if (!t) return null;
      if (/\bZ\b/.test(t)) return "Z";
      if (t === "C" || /CORTE DE CAJA/.test(t)) return "C";
      if (/\bX\b/.test(t)) return "X";
      return null;
    };
    const rotulo = tiquete?.tipo?.trim() ?? null;
    const tipoQueSalio = letraDelTiquete(rotulo);
    const avisoTipo = !ok || !idCorte
      ? undefined
      : !tiquete
        ? `El ${tipo} se registró (número ${idCorte}), pero no se pudo leer su comprobante`
          + " para confirmar que salió del tipo correcto."
        : tipoQueSalio === null
          ? `El ${tipo} se registró (número ${idCorte}), pero su comprobante dice «${rotulo}»`
            + " y el portal no reconoce ese tipo. Avisá a Sistemas antes de seguir."
          : tipoQueSalio !== tipo
            ? `Se pidió un corte ${tipo} y el sistema emitió uno de tipo ${rotulo}`
              + ` (número ${idCorte}). Avisá a Sistemas antes de seguir.`
            : undefined;

    /* ── El corte CIERRA el vale de su tramo ──────────────────────────────
     *
     * El vale existe para que las salidas de bolsa estén descontadas cuando se
     * cuenta el cajón. Hecho el corte, ese tramo terminó: la próxima salida
     * abre otro. Estaba escrito en el diseño de la tabla —«cuando aparece un
     * corte, ese vale se cierra»— y no lo hacía nadie acá.
     *
     * Sin esto el vale se queda ANOTADO indefinidamente, y no es sólo desorden:
     * ocupa la única ranura abierta de la sala (`caja_vales_portal_abierto_unico`),
     * así que el siguiente corte con salidas pendientes muere con un 23505. Fue
     * lo que pasó en Salud 3, con OCHO cortes encima del vale 1.
     *
     * Y el otro daño es peor de leer: mientras siga abierto, el cron le puede
     * SUMAR salidas nuevas editando un asiento que este corte ya contó — que es
     * exactamente el hallazgo que la auditoría de v2.838.0 marca, con el portal
     * generando la señal que el portal vigila.
     *
     * No se lanza si falla: el corte ya está hecho y su respuesta es lo que
     * alguien está esperando frente a la caja. Queda en el log y se cura solo —
     * el próximo corte lo encuentra con OTRO `corte_id_al_abrir` y lo cierra. */
    if (ok && !simular && vale) {
      const ahora = new Date().toISOString();
      const { error: errCerrar } = await supabase.from("caja_vales_portal")
        .update({ estado: "CERRADO", cerrado_at: ahora, updated_at: ahora })
        .eq("id", vale.id).in("estado", ["PENDIENTE", "ANOTADO"]);
      if (errCerrar) {
        console.error(`hacer-corte-caja: el corte se hizo pero el vale ${vale.id}`
          + ` quedó abierto: ${errCerrar.message}`);
      }
    }

    /* ── QUIÉN HIZO EL CORTE, que hasta hoy no quedaba en ninguna parte ────
     *
     * El nombre que da el sistema de la caja —el renglón `EMPLEADO:` del
     * tiquete, que viaja como `empleado_texto`— es el de la CUENTA con la que
     * la sala corta, no el de quien cortó. En tres salas ni siquiera es una
     * persona («MI CAJA LA POPULAR») y en las otras tres es una persona que
     * tampoco cortó: el portal opera con las credenciales de la sala. Es el
     * mismo defecto que la apertura mostraba como «Mi La».
     *
     * Y acá era peor, porque no había NADA que preferirle: medido el 3-sep,
     * `cortes_caja.employee_id` estaba en NULL en los 635 cortes capturados.
     *
     * El amarre sale gratis y es exacto: `id_corte` viene en la respuesta del
     * propio corte. No hace falta releer ninguna pantalla —como sí hizo falta
     * en la apertura— ni cruzar por «el último de la sala», que le atribuiría
     * el corte de las 13:00 a quien hizo el de las 09:00.
     *
     * Se escribe ANTES de avisarle al sync, y en el mismo `await`: el sync
     * arranca en cuanto sale esta respuesta y es el que copia `employee_id` a
     * `cortes_caja`. Al revés, la fila del corte nacería sin nombre y sólo lo
     * tomaría en el barrido siguiente. Es la lección de
     * `feedback_el_orden_dentro_de_una_misma_corrida_decide_el_resultado`.
     *
     * No se lanza si falla: el corte YA está hecho y su respuesta es lo que
     * alguien está esperando frente a la caja. Queda en el log — y lo que se
     * pierde es la atribución, no el corte. */
    if (ok && idCorte && !simular) {
      const { error: errQuien } = await supabase.from("caja_cortes_del_portal").insert({
        branch_id: sala, erp_corte_id: Number(idCorte), hecho_por: quien.id, tipo,
      });
      if (errQuien) {
        console.error(`hacer-corte-caja: el corte ${idCorte} se hizo y no se pudo`
          + ` anotar quién lo hizo: ${errQuien.message}`);
      }
    }

    /* ── El portal le avisa al sync que hay un corte nuevo EN ESTA SALA ────
     *
     * El corte queda en el sistema de la caja al instante, pero el portal se
     * entera por `sync-cortes-caja`, que barre cada 30 s. Medido sobre los 170
     * cortes de la semana del 27-ago: la mediana tarda **38 s** y 147 de 170
     * aparecen bajo el minuto. Como el papel ahora sale al CONFIRMAR y la fila
     * hace falta para poder firmar, esos segundos caen justo en el medio: quien
     * lee la diferencia y aprieta confirmar enseguida se choca con «todavía no
     * aparece el corte» y tiene que ir a firmarlo a la otra pantalla.
     *
     * Pidiéndoselo acá, el barrido de esa sala arranca en el mismo momento en
     * que el corte existe, en vez de esperar el próximo turno del reloj.
     *
     * ── Por qué en segundo plano y no esperándolo ─────────────────────────
     * La respuesta es lo que le muestra la diferencia a alguien que está parado
     * frente a la caja: sumarle el barrido la haría esperar por un dato que no
     * está mirando. Arranca ahora y termina mientras esa persona lee, que es
     * justo el hueco que hay que tapar.
     *
     * Y NO puede tumbar el corte: el corte YA está hecho y su respuesta ya está
     * armada. Un fallo acá sólo significa que la fila llega cuando pase el
     * barrido de siempre — o sea, exactamente lo que pasaba antes.
     *
     * `branchId` acota el trabajo a UNA sala: el barrido completo son seis
     * listados, y cinco de ellos no tienen nada nuevo que traer.
     *
     * Y va con `desde`, que es lo que le hace saltear su ventana horaria. El
     * cron no puede traer nada fuera de 7–23 SV —y está bien, porque a esa hora
     * no hay cortes que traer—, pero acá el corte ACABA de ocurrir: es la única
     * prueba que existe de que sí había trabajo. Sin esto, un corte de las
     * 23:10 esperaría hasta las 7 de la mañana. */
    if (ok && idCorte && !simular) {
      const disparar = async () => {
        const secreto = Deno.env.get("ADMIN_INVOKE_SECRET");
        if (!secreto) { console.error("hacer-corte-caja: sin ADMIN_INVOKE_SECRET, no se avisó al sync"); return; }
        const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-cortes-caja`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${secreto}` },
          body: JSON.stringify({
            branchId: sala,
            desde: new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10),
          }),
          signal: AbortSignal.timeout(60_000),
        });
        if (!r.ok) console.error(`hacer-corte-caja: el sync contestó ${r.status}`);
      };
      // @ts-ignore — EdgeRuntime es global del runtime de Supabase
      EdgeRuntime.waitUntil(disparar().catch((e: unknown) => {
        // Nadie a quien contarle: la respuesta ya salió. Que quede en el log,
        // o el aviso al sync falla en silencio.
        console.error("hacer-corte-caja: no se pudo avisar al sync:", (e as Error)?.message ?? e);
      }));
    }

    return json({
      ok,
      aviso: avisoTipo,
      /* Recién ACÁ viaja el esperado: después del conteo, nunca antes.
       *
       * Y viajan LAS DOS CUENTAS, sin elegir: la del formulario —que arrastra
       * el defecto conocido del origen, que suma los cobros de crédito un
       * número entero de veces de más— y las piezas del tiquete. Quién gana lo
       * decide `diferenciaDelCorte` en el portal, que es la MISMA función con
       * la que se lee la tabla de cortes desde el 13-ago.
       *
       * (Hasta v2.931.1 acá decía que esa función «conoce el caso en que la
       * buena es la del formulario». Esa excepción se ELIMINÓ: medido sobre 485
       * cortes, la suma del tiquete cierra sola en el 100% y la del formulario
       * se aparta en el 23%. Hoy el tiquete siempre gana.) */
      esperado, contado: Number(efectivo),
      diferencia: Number(dosDecimales(diferencia)),
      /* La tercera pieza de la cuenta, y la única que no sale del tiquete: el
       * efectivo de cobros de crédito hechos desde el portal que el comprobante
       * deja fuera de su esperado. `null` = no se pudo leer, y el papel lo dice. */
      cobros_portal_efectivo: cobrosPortalEfectivo,
      tipo: tiquete?.tipo ?? null,
      id_corte: idCorte,
      // Lo que necesita el comprobante que imprime el portal, y las piezas con
      // las que decide. El sistema de la caja arma su propio tiquete pero sólo
      // lo imprime desde SU pantalla, así que desde el portal el corte salía sin
      // ningún papel.
      tiquete: tiquete
        ? {
          lineas: tiquete.lineas, empleado: tiquete.empleado,
          caja: tiquete.caja, turno: tiquete.turno, formas: tiquete.formas,
          contado: tiquete.contado, total_caja: tiquete.total_caja,
          cobros_credito: tiquete.cobros_credito,
          subtotal: tiquete.subtotal, vales: tiquete.vales,
        }
        : null,
      vale: valeId ? { id: valeId, movimiento_en_caja: movVale, monto: montoDelVale } : null,
      respuesta: ok ? undefined : respCorte.slice(0, 300),
    });
  } catch (e) {
    console.error("hacer-corte-caja:", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error)?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
