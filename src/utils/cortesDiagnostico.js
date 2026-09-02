// Cortes de caja — la diferencia por tramo y las pistas de revisión.
//
// Vive fuera de la vista a propósito: es la parte que decide si a alguien se le
// señala un faltante, y tiene que poder mirarse (y corregirse) sin abrir un
// componente de 400 líneas.

import { conSigno, formatMoney } from './formatNumber';

const CENTAVO = 0.005;
const redondear = (n) => Math.round(n * 100) / 100;
const num = (v) => (v == null ? null : Number(v));
/** El signo explícito importa: en caja, «3.39» y «+3.39» no dicen lo mismo. */
/** Para meter el concepto de un movimiento en un título sin partirlo en tres. */
const corto = (s, max = 26) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/**
 * Un corte que NO contó efectivo: el papel lo dice y no hay diferencia que sacar.
 *
 * ── El caso, medido ────────────────────────────────────────────────────────
 * Salud 4, 2-sep 13:09 (corte 14393), nueve minutos después del de las 13:00 y
 * con las mismas cifras del día. Su tiquete termina así:
 *
 *     TOTAL CAJA $:   230.85
 *     EFECTIVO  $:      0.00
 *     EXACTO FELICIDADES $:  0.00
 *
 * O sea: no se contó nada, y el origen igual lo dio por exacto. El portal en
 * cambio hacía su resta —0 − 319.10— y anunciaba un **faltante de $319.10**,
 * con un botón al lado que ofrecía cobrárselo a alguien. Nadie contó cero y
 * perdió la caja del día: no se contó, que es otra cosa.
 *
 * ── Por qué las tres condiciones ───────────────────────────────────────────
 * `declarado = 0` solo no alcanza: una caja realmente vacía también da cero, y
 * ahí el origen SÍ marca el faltante — silenciarlo taparía una alarma buena.
 * Las tres juntas dicen exactamente una cosa: el origen esperaba dinero ese día
 * (`tk_total_caja > 0`), no se contó nada, y el origen **igual lo dio por
 * exacto**. Sobre los 493 cortes capturados eso pasa una vez, y es éste.
 *
 * ── Es la misma falla del 31-ago, un paso más adentro ──────────────────────
 * Aquella vez el corte hecho desde el portal salió tipo **X** porque el
 * desplegable del origen trae X marcado. Acá el tipo salió bien y lo que viajó
 * en su valor por defecto fue el MONTO — la comprobación de
 * `hacer-corte-caja` acepta `efectivo >= 0`, o sea que un cero pasa. Ver
 * [[feedback_reenviar_un_formulario_tal_cual_manda_sus_valores_por_defecto]].
 */
export const noContoEfectivo = (corte) => corte?.tipo === 'C'
    && (num(corte?.total_declarado) ?? 0) === 0
    && (num(corte?.diferencia_erp) ?? 0) === 0
    && (num(corte?.tk_total_caja) ?? 0) > 0;

/**
 * Los cortes de caja son ACUMULATIVOS dentro del día: el de la noche contiene
 * al de la mañana. Entonces la diferencia que importa —la que señala un turno—
 * no es la del corte, es cuánto se movió DESDE el corte anterior.
 *
 * Regla del usuario (2026-08-14): «si en el primer corte confirmado hay
 * diferencia de +$0.25, en el de la noche como mínimo debe haber +$0.25; si no
 * pasa eso, entonces faltan $0.25 en el corte de la noche».
 *
 * ── SÓLO UN CONFIRMADO CORRE LA BASE (usuario, 2026-08-14) ──────────────────
 * La frase de arriba dice «el primer corte CONFIRMADO», y esa palabra es la
 * regla entera: arrastrar una diferencia que nadie firmó le cobra al corte
 * siguiente algo que todavía no es un hecho.
 *
 * Importa porque el sistema de origen no anula cortes: cuando la sala encuentra
 * el error, REHACE el corte. Así que un corte repetido —mismo efectivo, misma
 * venta— es la corrección del anterior, no un tramo nuevo. Corriendo la base
 * con el pendiente, el portal le restaba al bueno la diferencia del que vino a
 * reemplazar, e inventaba un faltante igual y opuesto.
 *
 * Salud 5, 14-ago, el caso que lo destapó: 12:36 declaró $230.07 contra
 * $228.82 esperados —el cobro de crédito de $1.25 no estaba registrado— y
 * sobraba $1.25. Lo registraron y rehicieron el corte: 12:40, mismo efectivo,
 * misma venta, exacto. El portal mostraba «FALTANTE −$1.25» (0.00 − 1.25) sobre
 * un corte que cuadra, y con el botón de confirmarlo al lado. Midiendo contra
 * el último CONFIRMADO —ninguno ese día— los dos dicen lo suyo: +$1.25 y
 * exacto, que es lo mismo que el aviso que la sala lee hace años.
 *
 * Verificado sobre los 35 cortes capturados: enderezaba 6 de los 8 tramos
 * inventados (Salud 5, Salud 3 ×1, Salud 1 ×1, Salud 2, La Popular ×2). Los 2
 * que quedan son de Salud 1 del 13-ago y NO son un defecto del cálculo: el
 * corte de las 19:52 se confirmó estando mal (declaró $834.28 con la caja en
 * $1,456.00) y un confirmado sí corre la base. Se arregla reabriendo esa
 * decisión, no acá.
 *
 * Los DESCARTADOS no cuentan ni como base ni como tramo: un conteo mal hecho no
 * puede desplazar la referencia de los que vienen después.
 *
 * @param {Array} cortesDeLaSala ordenados por hora ascendente
 */
export function conTramo(cortesDeLaSala) {
    let previa = 0;
    return cortesDeLaSala.map((c) => {
        // Un corte sin conteo no es un tramo NI corre la base: no midió nada, así
        // que no puede desplazar la referencia de los que vienen después. Mismo
        // criterio que un descartado.
        if (c.tipo !== 'C' || c.estado === 'DESCARTADO' || noContoEfectivo(c)) {
            return { ...c, tramo: null, acumulado: null, fuente: null };
        }
        // La acumulada sale de `diferenciaDelCorte`, no de `diferencia_erp`: el
        // corte manda. Las dos son acumulativas del día, así que restarlas sigue
        // dando el tramo.
        const { valor: dif, fuente, esperado } = diferenciaDelCorte(c);
        const tramo = redondear(dif - previa);
        // Sólo una decisión firmada mueve la referencia. Ver el bloque de
        // arriba: con el pendiente corriéndola, un corte rehecho le restaba al
        // bueno la diferencia del que vino a reemplazar.
        if (c.estado === 'CONFIRMADO') previa = dif;
        return { ...c, tramo, acumulado: dif, fuente, esperadoUsado: esperado };
    });
}

/**
 * `conTramo` aplicado a una lista MEZCLADA de salas y de días.
 *
 * El tramo se mide POR SALA Y POR DÍA: los cortes son acumulativos dentro del
 * día y arrancan de cero cada mañana, así que meter dos días en la misma serie
 * restaría el cierre de ayer contra el primero de hoy y daría un tramo enorme e
 * inventado. Lo mismo mezclando salas.
 *
 * Vive acá y no en la vista porque el módulo y el widget del Inicio lo hacían
 * cada uno por su cuenta —el widget agrupaba sólo por sala, que era correcto
 * mientras sólo miraba HOY y dejó de serlo al abrirle la ventana a los
 * pendientes de días anteriores—. Dos pantallas que calculan por su cuenta
 * terminan diciendo cosas distintas del mismo corte, y acá eso significa
 * señalarle un faltante a alguien por una resta que la otra pantalla no hace.
 */
export function conTramoPorSalaYDia(cortes) {
    const grupos = new Map();
    for (const c of cortes || []) {
        const k = `${c.branch_id}|${c.fecha}`;
        if (!grupos.has(k)) grupos.set(k, []);
        grupos.get(k).push(c);
    }
    const out = [];
    for (const lista of grupos.values()) {
        // Desempate por `id`, igual que `corte_tramo` en el servidor. Sin él,
        // dos cortes de la misma hora quedan en un orden que decide el motor de
        // JavaScript, y el tramo de los dos sale de una resta distinta a la que
        // hace la base — que es la que manda al firmar. El sistema de origen no
        // anula cortes: los REHACE, a veces dentro del mismo minuto.
        out.push(...conTramo([...lista].sort(
            (a, b) => String(a.hora).localeCompare(String(b.hora)) || (a.id - b.id),
        )));
    }
    return out;
}

/**
 * Cómo le fue a un período: cuántos cortes cuadraron, cuántos sobraron y
 * cuántos faltaron, más cuántos siguen sin confirmar.
 *
 * Cuenta CORTES, no días, y sólo los de caja (`tipo === 'C'`): el cierre del día
 * no es un conteo. Los descartados salen del reparto por severidad —un conteo
 * mal hecho no es ni un sobrante ni un faltante— pero se cuentan aparte para que
 * el total no mienta por omisión.
 *
 * @param {Array} cortesConTramo ya pasados por `conTramoPorSalaYDia`
 */
export function resumenDeCortes(cortesConTramo) {
    const r = {
        vivos: 0, cuadrados: 0, exceso: 0, faltante: 0,
        pendientes: 0, confirmados: 0, descartados: 0, sinConteo: 0,
    };
    for (const c of cortesConTramo || []) {
        if (c.tipo !== 'C') continue;
        if (c.estado === 'DESCARTADO') { r.descartados += 1; continue; }
        // Uno que no contó efectivo no es ni cuadrado ni descuadrado: no midió.
        // Contarlo entre los cuadrados —que es lo que hacía, porque su tramo es
        // null y `severidad(null)` da 'ok'— sube el porcentaje del mes con un
        // corte que nadie hizo.
        if (noContoEfectivo(c)) { r.sinConteo += 1; continue; }
        r.vivos += 1;
        if (c.estado === 'PENDIENTE') r.pendientes += 1; else r.confirmados += 1;
        const s = severidad(c.tramo);
        if (s === 'ok') r.cuadrados += 1;
        else if (s === 'sobra') r.exceso += 1;
        else r.faltante += 1;
    }
    return r;
}

/**
 * El estado de la sala en el día: la diferencia del último corte vivo.
 *
 * El conteo se llama `cantidad` y NO `cortes` porque este objeto se mezcla con
 * el de la sala, que sí lleva la lista en `cortes`. Se llamaba igual, el spread
 * quedó después, y el número pisó al array: la vista reventó con
 * «cortes.map is not a function». Un nombre que describe el contenido —una
 * cantidad es un número— no se presta a esa colisión.
 */
export function estadoDelDia(cortesDeLaSala) {
    const vivos = cortesDeLaSala.filter((c) => c.tipo === 'C' && c.estado !== 'DESCARTADO');
    const ultimo = vivos[vivos.length - 1];
    return {
        acumulado: ultimo ? (ultimo.acumulado ?? diferenciaDelCorte(ultimo).valor) : 0,
        cantidad: vivos.length,
        pendientes: vivos.filter((c) => c.estado === 'PENDIENTE').length,
        cierre: cortesDeLaSala.find((c) => c.tipo === 'Z') || null,
    };
}

/**
 * El origen produce DOS diferencias por corte, con dos fórmulas distintas:
 *
 *   1. La que guarda  → `total_declarado − esperado`, con el `esperado` que
 *      calcula el servidor al abrir el formulario del corte.
 *   2. La del ticket   → `total_declarado − TOTAL CAJA`, donde
 *      `TOTAL CAJA = ingresos + venta − vales + cobros de crédito`.
 *
 * ── DÓNDE ESTÁ EL ERROR, medido sobre los 24 cortes del 13-ago ──────────────
 * El desvío entre las dos es SIEMPRE un múltiplo entero exacto de los cobros de
 * crédito de esa sala, y las salas sin cobros de crédito (Salud 2, 4 y 5)
 * coinciden al centavo en todos sus cortes:
 *
 *     Salud 2 · 4 · 5   sin cobros    → desvío 0.00 en los 10 cortes
 *     Salud 1           cobros  4.60  → −1×, −1×, −1×, 0, 0, 0, 0
 *     La Popular        cobros  9.20  → +1×, +3×, +3×
 *     Salud 3           cobros 54.65  → −1×, −1×, +4×, +4×   (los $218.60)
 *
 * O sea: **el `esperado` del origen cuenta mal los cobros de crédito**, un
 * número entero de veces de más o de menos. El ticket los cuenta una sola vez,
 * y su cuenta cierra contra los movimientos del día — verificado en Salud 3:
 * ingresos $1,041.39, abonos $54.65 y vales $704.09 salen exactos de la tabla
 * de movimientos, y dan su TOTAL CAJA de $1,538.35.
 *
 * ── EL TICKET NO DERIVA ────────────────────────────────────────────────────
 * Lo di por sentado y era falso. Se comprobó pidiendo dos tickets del 13-ago de
 * nuevo al día siguiente: devolvieron exactamente los mismos importes que se
 * habían guardado. Ingresos, venta y vales son la foto del corte —varían corte
 * a corte dentro del mismo día— así que un corte leído tarde vale igual que uno
 * leído al minuto. Por eso NO hay que recapturar nada del 13-ago.
 *
 * (El único matiz: los cobros de crédito del ticket son el total del día, no la
 * foto. En un corte temprano puede aparecer un cobro que entró después. Para el
 * corte definitivo —el que se confirma— ya pasaron todos, así que no estorba.)
 */
export function contraste(corte) {
    // Sin conteo no hay dos cifras que contrastar, y restar contra un cero que
    // nadie escribió inventa un faltante del tamaño de la caja del día.
    if (noContoEfectivo(corte)) return null;
    const declarado = num(corte?.total_declarado);
    const totalCaja = num(corte?.tk_total_caja);
    const difErp = num(corte?.diferencia_erp);
    if (declarado == null || totalCaja == null || difErp == null) return null;

    /* ── Cuánto contó el comprobante de cobros de crédito: DERIVADO ────────
     *
     * `tk_cobros_credito` es un renglón sacado del papel con una expresión
     * regular, y el papel a veces no lo imprime. Su ausencia se lee igual que
     * un cero, y las dos cosas no significan lo mismo.
     *
     * La suma del comprobante sí lo dice sin ambigüedad, porque cierra siempre:
     * `subtotal − vales + cobros = total_caja`, verificado al centavo en los
     * **493 cortes** capturados. Despejando, `cobros = total_caja − subtotal +
     * vales`, y ese número no puede quedar en cero porque el origen le cambie
     * el nombre a la línea — que es exactamente el modo de falla que importa,
     * porque un cero de más acá inventa un faltante del tamaño de los cobros
     * del día. */
    const subtotal = num(corte?.tk_subtotal);
    const vales = num(corte?.tk_vales);
    const cobros = (subtotal != null && vales != null)
        ? redondear(totalCaja - subtotal + vales)
        : (num(corte?.tk_cobros_credito) ?? 0);

    /* ── El efectivo que entró al cajón y el comprobante NO contó ──────────
     *
     * Cobrar un crédito desde el portal mete efectivo en la caja, pero el
     * origen lo registra sólo como movimiento del día: no lo suma a INGRESOS
     * ni a la línea COBROS CREDITO. O sea que el esperado del comprobante nace
     * corto, y el conteo de la sala aparece como un sobrante que nadie hizo.
     *
     * Medido el 2026-09-02 en Salud 4, el primer día que hubo cobros desde el
     * portal: el comprobante esperaba $230.85, en el cajón había además $88.25
     * de dos cobros en efectivo (10:03 y 12:39, los dos ANTES del conteo), se
     * contaron $309.25. El portal anunciaba **+$78.40 de sobrante** cuando lo
     * que había era un **faltante de $9.85**.
     *
     * `cobros_portal_efectivo` lo sella un trigger en la fila del corte: la
     * hora es lo que permite saber si el cobro ya había entrado cuando se
     * contó, y los movimientos del origen no la traen. Suponerla ya costó un
     * sobrante inventado de $66.01 (corte 14378 de Salud 3).
     *
     * Se resta lo que el comprobante YA contó para no sumarlo dos veces, y el
     * piso en cero es deliberado: si el comprobante contó MÁS que el portal,
     * son cobros hechos en la pantalla de la caja —que el portal no ve— y no
     * un hallazgo. */
    const enCaja = num(corte?.cobros_portal_efectivo) ?? 0;
    const sinContar = Math.max(0, redondear(enCaja - cobros));
    const esperado = redondear(totalCaja + sinContar);

    const difTicket = redondear(declarado - esperado);
    // Lo que NO explica nadie. `sinContar` sale de la resta porque ya está
    // explicado —es la corrección, no un descuadre—: sin sacarlo, corregir un
    // corte lo dejaría marcado como «hay plata sin explicar» para siempre.
    const brecha = redondear(difErp - difTicket - sinContar);

    // Cuántas veces el cobro de crédito explica la brecha. Entero → es el
    // defecto conocido del origen y no hay nada que investigar en la sala.
    const veces = cobros && Math.abs(cobros) >= 0.01 ? brecha / cobros : null;
    const porCobrosCredito = veces != null && Math.abs(veces - Math.round(veces)) < 0.001;

    return {
        difErp,
        difTicket,
        brecha,
        cobros,
        // Lo que el comprobante dejó fuera y el portal le suma al esperado.
        sinContar,
        // El esperado que MANDA: el del comprobante más lo que no contó.
        esperado,
        vecesElCobro: porCobrosCredito ? Math.round(veces) : null,
        porCobrosCredito,
        enDisputa: Math.abs(brecha) >= 0.01,
    };
}

/**
 * La diferencia que MANDA: la del corte.
 *
 * Regla del usuario (2026-08-14): «el corte de caja trae toda la info; para lo
 * que sirven los movimientos de caja es para validar ante una diferencia». Y la
 * medición le da la razón — la del ticket es la que cierra contra los
 * movimientos; la guardada cuenta mal los cobros de crédito. Es además la que
 * la sala viene leyendo hace años en el aviso de Telegram, que se calculaba así.
 *
 * Sin fecha de vencimiento y sin mirar el desfase: el ticket es una foto, no se
 * recalcula. Si no hubiera ticket se cae a la guardada, que es todo lo que
 * queda.
 */
export function diferenciaDelCorte(corte) {
    // `valor: null` y no 0: «no se contó» no es «cuadró». Un cero acá lo dejaba
    // listo para confirmar de un clic, que es peor que el faltante inventado.
    if (noContoEfectivo(corte)) {
        return { valor: null, fuente: 'sin-conteo', esperado: num(corte?.tk_total_caja) };
    }
    const c = contraste(corte);
    if (!c) {
        return { valor: num(corte?.diferencia_erp) ?? 0, fuente: 'guardada', esperado: num(corte?.esperado) };
    }
    /* ── EL TIQUETE SIEMPRE GANA, y está medido (2026-09-01) ──────────────
     *
     * Había una excepción: con `brecha = +1×` los cobros de crédito se usaba la
     * cifra del formulario, leyendo esa firma como «el tiquete sumó cobros del
     * DÍA a un corte hecho ANTES de que entraran». Se quitó, y con datos.
     *
     * **Sobre 485 cortes con todas las líneas del tiquete:**
     *
     *   la suma del tiquete cierra sola      485 / 485   (100%)
     *   el formulario coincide con ella      373
     *   el formulario se aparta              112         (23%)
     *
     * O sea: `subtotal − vales + cobros = total_caja` **nunca** falla, y el
     * `total_corte` del formulario falla en uno de cada cuatro cortes.
     *
     * Y la premisa de la excepción es falsa. Si el tiquete imprimiera el total
     * del DÍA, `tk_cobros_credito` sería igual en todos los cortes de una misma
     * jornada; **crece 40 veces sobre 371 pares consecutivos**, así que reporta
     * lo que YA entró. Un tiquete no puede adelantarse a un cobro que no ocurrió.
     *
     * El «testigo independiente» que sostenía la excepción —el aviso de Telegram
     * del 13-ago— se arma con el número del FORMULARIO, o sea el mismo origen
     * que decía tener razón. No era independiente: era circular.
     *
     * Lo destapó el corte 14378 de Salud 3: tiquete $1,146.46 (su propia suma),
     * contado $1,146.37 —**−$0.09**— y la excepción devolvió **+$66.01**, un
     * sobrante inexistente. Y el intento de arreglarla mirando si era el último
     * del día tampoco servía: un corte de media mañana con la misma firma habría
     * fallado igual. La pregunta del usuario fue exactamente ésa.
     *
     * Sin excepción no hay caso que distinguir: la cifra sale de la suma que
     * cierra siempre. */
    return { valor: c.difTicket, fuente: 'ticket', esperado: c.esperado };
}

/** Las formas de pago de un abono que SÍ entran al cajón. Sólo una, pero se
 *  escribe como conjunto porque la pregunta es «¿entró en efectivo?» y no
 *  «¿es transferencia?»: el día que aparezca una forma nueva, lo seguro es que
 *  NO sea efectivo hasta que alguien lo decida. */
const FORMAS_EN_EFECTIVO = new Set(['efectivo']);
/** Se exporta porque la pantalla necesita el MISMO criterio para decidir qué
 *  renglón marcar. Escrito dos veces, el día que se agregue una forma una de
 *  las dos copias se queda vieja y el número deja de coincidir con la lista. */
export const entroEnEfectivo = (a) => FORMAS_EN_EFECTIVO.has(String(a?.forma || '').trim().toLowerCase());

/**
 * A qué corte pertenece cada cobro de crédito — con la hora, no por deducción.
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 * La línea «COBROS CREDITO» del comprobante es UN número del día, y el sistema
 * de la caja publica sus movimientos sin hora. Con eso, un corte que no cuadra
 * por esa línea no se puede investigar: sólo se puede suponer si el cobro entró
 * antes o después de contar el efectivo. Suponerlo ya costó caro — el corte
 * 14378 de Salud 3 marcó **+$66.01** de sobrante inexistente porque una regla
 * intentaba adivinar justamente eso.
 *
 * Desde que el abono se hace en el portal la hora es un dato. Acá se usa para
 * partir el día en los que ya habían entrado cuando se contó y los que no.
 *
 * ── Lo que esta cuenta NO puede afirmar ────────────────────────────────────
 * Son los cobros hechos DESDE EL PORTAL. Los que se cargan en la pantalla de la
 * caja no están, así que **`hasta < cobros` no es un hallazgo**: es la parte que
 * todavía no pasa por acá. Al revés sí lo es: registrar más de lo que el
 * comprobante cuenta significa que algo entró después de contar, o que el
 * comprobante no lo sumó.
 *
 * ── El efectivo, aparte ────────────────────────────────────────────────────
 * Un abono por transferencia, tarjeta o cheque no entra al cajón (regla del
 * usuario: «sólo entra en efectivo, los otros no, es como pago con tarjeta»).
 * Por eso `enCaja` —y no `hasta`— es lo que se compara contra el comprobante, y
 * `noEfectivo` queda como dato informativo: se cobró, pero no por la caja.
 *
 * ── Y el comprobante NO cuenta el efectivo del portal ──────────────────────
 * Acá decía lo contrario, escrito el 2026-09-02 por la mañana: «el origen ya
 * distingue, sólo el efectivo llega a la línea COBROS CREDITO y al efectivo
 * esperado; no hay nada que descontar». La medición que lo sostenía era
 * correcta —de los tres cobros de esa mañana en Salud 4, el de efectivo
 * aparecía como movimiento y los dos por transferencia no— pero la conclusión
 * no se seguía de ella: **aparecer en la lista de movimientos no es lo mismo
 * que entrar en el esperado**.
 *
 * Lo destapó el corte de las 13:00 de ese mismo día, con un cobro de $79.70 a
 * las 12:39 que hizo grande lo que con $8.55 no se notaba:
 *
 *     INGRESOS del comprobante        $  6.00   ← los seis de $1.00, y nada más
 *     movimientos «POR ABONO A CREDITO» $ 88.25   ← $8.55 + $79.70, en el cajón
 *     línea COBROS CREDITO             ausente
 *
 * O sea que los dos cobros en efectivo no estaban en ninguno de los dos
 * términos de `TOTAL CAJA = INGRESOS + VENTA − VALES + COBROS`. El portal
 * anunciaba **+$78.40 de sobrante** sobre un **faltante de $9.85**.
 *
 * Verificado sobre los 493 cortes capturados: `tk_ingresos` nunca incluye los
 * abonos (111 de 112 sala-días medidos), y donde la línea existe recoge
 * exactamente los movimientos de abono vivos (45 de 48). El único sala-día de
 * toda la historia donde queda efectivo sin contar es ése.
 *
 * La corrección vive en `contraste`, que le suma al esperado lo que el
 * comprobante dejó fuera. Acá sólo se informa.
 *
 * @param {object} corte   el corte, con `hora` y `tk_cobros_credito`
 * @param {Array}  abonos  los del día de esa sala, de `fetchAbonosDelDia`
 */
export function cobrosDeCredito(corte, abonos = []) {
    // Derivado de la suma del comprobante, no del renglón parseado: ver
    // `contraste`. Sin esto, un comprobante sin la línea daba `cobros: null` y
    // la reconciliación entera se apagaba justo en el caso que hay que mirar.
    const c = contraste(corte);
    const cobros = c ? c.cobros : num(corte?.tk_cobros_credito);
    const hora = String(corte?.hora || '');
    // Un abono anulado no entró: no cuenta ni antes ni después. Se deja fuera
    // acá y no en la consulta para poder listarlo si algún día hace falta.
    const vivos = (abonos || []).filter((a) => !a.anulado);

    const antes = [];
    const despues = [];
    for (const a of vivos) {
        // Las dos horas son de la misma zona y con el mismo formato `HH:MM:SS`,
        // así que comparar el texto ordena igual que comparar el reloj — y no
        // hay que fabricar dos `Date` para saber cuál vino primero.
        (String(a.hora || '') <= hora ? antes : despues).push(a);
    }

    const suma = (l) => redondear(l.reduce((s, a) => s + (num(a.monto) ?? 0), 0));
    const hasta = suma(antes);
    const enCaja = suma(antes.filter(entroEnEfectivo));

    return {
        antes,
        despues,
        // Todo lo cobrado hasta esta hora, entrara al cajón o no.
        hasta,
        // Lo que SÍ entró al cajón. Es lo único comparable contra el
        // comprobante — ver el bloque de arriba: el origen ya deja fuera lo que
        // no fue efectivo, así que compararlo contra `hasta` denunciaría una
        // brecha en cada corte donde alguien pagó por transferencia.
        enCaja,
        // Se cobró, pero no por la caja. Informativo: NO se descuenta de nada.
        noEfectivo: redondear(hasta - enCaja),
        cobros,
        // Lo que el comprobante dejó fuera y el portal le suma al esperado.
        sinContar: c?.sinContar ?? 0,
        // Positiva = el portal registró más efectivo del que el comprobante
        // contó (algo entró después de contar, o no se sumó).
        // Negativa = hay cobros que no pasaron por el portal (no es un defecto).
        brecha: cobros == null ? null : redondear(enCaja - cobros),
        cuadra: cobros != null && Math.abs(redondear(enCaja - cobros)) < CENTAVO,
    };
}

/**
 * Por qué la cifra que se muestra no es la que guardó el sistema — en palabras.
 *
 * Antes esto salía como «El sistema dice +$0.75; acá se usa −$53.90», que además
 * de incomprensible estaba al revés cuando la buena era la guardada: el texto
 * daba por hecho que siempre se usaba la del ticket. Ahora se arma desde
 * `diferenciaDelCorte`, que es quien decide, así que no puede contradecirla.
 *
 * Devuelve `null` cuando no hay nada que explicar, y `alerta` para distinguir
 * la nota al pie del aviso de verdad. NO devuelve un color: la vista decide
 * cómo pintarlo, y así el día que cambie la paleta no hay que tocar acá.
 */
export function notaDeCifra(corte) {
    const c = contraste(corte);
    if (!c) return null;

    /* Lo que el comprobante dejó fuera se explica solo: no es un aviso, es la
     * corrección. Va antes del `enDisputa` porque después de aplicarla las dos
     * cifras del origen ya NO coinciden por construcción, y sin esta nota la
     * pantalla diría «hay plata sin explicar» justamente sobre la plata que
     * acaba de explicar. */
    if (!c.enDisputa && c.sinContar >= 0.01) {
        return {
            alerta: false,
            titulo: 'El comprobante no contó los cobros de crédito',
            detalle: `Entraron ${formatMoney(c.sinContar)} en efectivo por cobros de crédito que el comprobante deja fuera de su cuenta. Con ellos, en la caja debía haber ${formatMoney(c.esperado)}.`,
        };
    }

    if (!c.enDisputa) return null;
    const { fuente, valor } = diferenciaDelCorte(corte);
    const cobros = formatMoney(Math.abs(c.cobros ?? 0));

    if (c.porCobrosCredito && fuente === 'guardada') {
        return {
            alerta: false,
            titulo: 'Se cortó antes de los cobros de crédito',
            detalle: `El comprobante suma ${cobros} de cobros que a esta hora todavía no entraban. Por eso vale ${conSigno(c.difErp)} y no ${conSigno(c.difTicket)}.`,
        };
    }

    // Ojo con lo que se nombra: `valor` es el ACUMULADO del día hasta este
    // corte, y el título del modal muestra el TRAMO. Llamar «la diferencia de
    // este corte» al acumulado ponía dos números distintos con el mismo rótulo
    // en la misma pantalla — el usuario lo leyó y no se entendía.
    if (c.porCobrosCredito) {
        const veces = Math.abs(c.vecesElCobro);
        return {
            alerta: false,
            titulo: 'Los cobros de crédito se contaron de más',
            detalle: `La otra cifra dice ${conSigno(c.difErp)} porque suma ${cobros} ${veces} ${veces === 1 ? 'vez' : 'veces'} de más. Es una falla al sumarlos, no algo que pasó en la caja. Vale ${conSigno(valor)}, que es lo que dice el comprobante.`,
        };
    }
    return {
        // La ÚNICA que cambia lo que hay que hacer: hay plata sin explicar y no
        // conviene firmar. Por eso es la única que la vista pinta como aviso.
        alerta: true,
        titulo: 'Revisa los movimientos del día',
        detalle: `Hay dos cifras (${conSigno(c.difErp)} y ${conSigno(c.difTicket)}) y ${formatMoney(Math.abs(c.brecha))} sin explicar. No conviene dar por bueno un faltante así.`,
    };
}

/**
 * El cierre del día (Z) desglosado por forma de pago.
 *
 * Su monto NO es efectivo: es **todo lo vendido**, con la tarjeta y el crédito
 * adentro. El detalle lo mostraba con los mismos rótulos que un corte de caja
 * —«Debía haber en caja», «Se contó»— y eso era literalmente falso: en La
 * Popular del 13-ago decía que se contaron $1,678.83 cuando en la caja hubo
 * $1,602.88. Lo levantó el usuario mirando la pantalla.
 *
 * ── EL DESGLOSE SALE DE LAS FACTURAS, NO DEL TIQUETE ───────────────────────
 * El tiquete Z lista al pie los pagos con tarjeta y las ventas al crédito, y
 * nada más. Derivar el efectivo como `total − tarjeta − crédito` funciona…
 * hasta que aparece una forma de pago que el tiquete no imprime.
 *
 * Y aparece. **Salud 2 del 13-ago cobró $2.20 por transferencia**: el desglose
 * derivado del tiquete decía $1,411.25 de efectivo cuando entraron $1,409.05.
 * Esos mismos $2.20 los había visto antes como «descuadre contra el último
 * corte» y los expliqué como ventas posteriores al conteo. No lo eran, y la
 * explicación cómoda tapó el dato — ver
 * `feedback_el_residuo_sin_explicar_delata_el_diagnostico`.
 *
 * Por eso el desglose sale de `sales_invoices.tipo_pago`, que es una fuente
 * INDEPENDIENTE del tiquete y trae TODAS las formas, incluidas las que el
 * tiquete no nombra. Verificado sobre el 13-ago en las 6 salas: el `efectivo`
 * coincide al centavo con el `VENTA` del último corte de cada sala, y la suma
 * de todas las formas con el total del Z.
 *
 * Ni la tarjeta ni el crédito entran a la caja: la tarjeta se cobra por el POS
 * y el crédito recién entra cuando el cliente paga, y ahí aparece como cobro de
 * crédito en un corte posterior. La transferencia tampoco.
 *
 * @param corte  el cierre (para el total y el respaldo del tiquete)
 * @param ventas filas de `get_ventas_por_forma_de_pago` de ESA sala y ese día
 */
export function desgloseDelCierre(corte, ventas = null) {
    const total = num(corte?.total_declarado) ?? 0;

    // Sin las facturas se cae al tiquete, que es lo único que había antes. Da
    // el mismo número salvo que ese día haya una forma que el tiquete no lista
    // —y entonces el efectivo sale de más—, así que el llamador avisa con
    // `derivado` que la cifra es la mejor disponible y no la medida.
    if (!ventas?.length) {
        const tarjeta = num(corte?.tk_tarjeta) ?? 0;
        const credito = num(corte?.tk_credito) ?? 0;
        return {
            total,
            efectivo: redondear(total - tarjeta - credito),
            formas: [
                { tipo: 'tarjeta', total: tarjeta },
                { tipo: 'credito', total: credito },
            ].filter((f) => Math.abs(f.total) >= 0.01),
            derivado: true,
        };
    }

    const suma = (t) => ventas
        .filter((v) => String(v.tipo_pago).toLowerCase() === t)
        .reduce((a, v) => a + (num(v.total) ?? 0), 0);

    // Todo lo que NO es efectivo, tal como venga: si mañana el origen agrega
    // una forma nueva, aparece sola en la lista en vez de desaparecer dentro
    // del efectivo. Es exactamente lo que falló con la transferencia.
    const formas = ventas
        .filter((v) => String(v.tipo_pago).toLowerCase() !== 'efectivo')
        .map((v) => ({ tipo: String(v.tipo_pago), total: redondear(num(v.total) ?? 0) }))
        .filter((f) => Math.abs(f.total) >= 0.01)
        .sort((a, b) => b.total - a.total);

    return {
        total: redondear(ventas.reduce((a, v) => a + (num(v.total) ?? 0), 0)) || total,
        efectivo: redondear(suma('efectivo')),
        formas,
        derivado: false,
    };
}

/**
 * Las formas de pago del día que el comprobante NO nombra.
 *
 * El tiquete imprime dos secciones y sólo dos —«PAGOS CON TARJETA» y «VENTAS AL
 * CREDITO»—, verificado en los 42 capturados. Todo lo demás cobra, entra al
 * total del cierre y **no aparece en ningún renglón del papel**.
 *
 * No es teórico: `transferencia` lleva 469 documentos y $19,685 en 15 meses, y
 * Salud 3 cobró $206.41 así en un solo día. `cheque` (3) y `bitcoin` (2) son
 * anecdóticos pero existen.
 *
 * Importa por dos cosas. Una, que quien busca el descuadre desde el papel no
 * puede saber que ese dinero existió. Y dos, el cheque: el formulario del corte
 * tiene su casilla y la diferencia se calcula como
 * `(efectivo + tarjeta + cheque) − esperado`, pero la venta con cheque NO está
 * en `VENTA` — así que anotarlo ahí produce un **sobrante igual al cheque**.
 * En los 30 cortes capturados esas casillas van en cero (el declarado nunca
 * incluye la tarjeta), pero no hay ningún cheque en la ventana para comprobarlo.
 */
export function formasFueraDelComprobante(ventas) {
    const ENELPAPEL = new Set(['efectivo', 'tarjeta', 'credito', 'crédito']);
    return (ventas || [])
        .filter((v) => !ENELPAPEL.has(String(v.tipo_pago).toLowerCase()))
        .map((v) => ({ tipo: String(v.tipo_pago), total: redondear(num(v.total) ?? 0) }))
        .filter((f) => Math.abs(f.total) >= 0.01)
        .sort((a, b) => b.total - a.total);
}

/**
 * Reparte un total entre `n` personas sin perder ni inventar centavos: el resto
 * se lo llevan las primeras.
 *
 * Vive acá y no en el componente porque es aritmética de dinero y hay que poder
 * probarla: dividir $1.25 entre dos da 0.63 y 0.62. Redondear cada parte por su
 * cuenta da dos de 0.63 —que suman 1.26— o dos de 0.62 —que suman 1.24—, y el
 * servidor rechaza el reparto que no cierra exacto. Un centavo de más es una
 * persona pagando lo que no debe.
 */
export function repartirEnPartes(total, n) {
    if (n <= 0) return [];
    const c = Math.abs(Math.round(Number(total || 0) * 100));
    const base = Math.floor(c / n);
    const resto = c - base * n;
    return Array.from({ length: n }, (_, i) => (base + (i < resto ? 1 : 0)) / 100);
}

/** 'ok' | 'sobra' | 'falta' — la forma, no sólo el color. */
export function severidad(monto) {
    const n = num(monto) ?? 0;
    if (Math.abs(n) < 0.01) return 'ok';
    return n < 0 ? 'falta' : 'sobra';
}

/**
 * LA REGLA de cuándo alcanza un clic: un corte que cuadra al centavo se
 * confirma de una; uno con diferencia abre el detalle y se firma después de
 * ver cuánto es, de dónde sale la cifra y qué revisar.
 *
 * Vive acá —una sola línea, un solo sitio— porque la aplican `TarjetaCorte` (el
 * módulo y la baldosa del Inicio) y la campana. Escrita en dos lados, el día
 * que se desincronice va a significar que desde una pantalla se puede dar por
 * bueno un faltante sin verlo.
 */
export const seConfirmaDeUnClic = (corte) => corte?.tramo != null
    && severidad(corte.tramo) === 'ok';

/**
 * Qué revisar cuando un tramo no cuadra.
 *
 * La primera pista es la más útil y la más barata: cuando la diferencia es un
 * múltiplo exacto de un movimiento que YA existe en el día, casi siempre es que
 * falta registrar otro igual. Salió sola de los datos del 13-ago en La Popular
 * —diferencia $13.80, con dos «POR ABONO A CREDITO» de $4.60 anotados: 3 × 4.60—
 * y es una hipótesis para confirmar en la sala, no un veredicto.
 *
 * ── Sin `tono`: el ORDEN es la jerarquía ───────────────────────────────────
 * Cada pista salía con su severidad y la pantalla la pintaba, así que un corte
 * con cuatro pistas mostraba cuatro cajas de color —rojo, ámbar, ámbar, azul—
 * que competían con la cifra y entre ellas. Ninguna es un veredicto: son
 * hipótesis para ir a mirar. Se devuelven ORDENADAS por cuán barato es
 * descartarlas y la vista las numera, que dice lo mismo sin gastar un color.
 * Reportado por el usuario (2026-08-14): «siento que hay demasiados colores».
 *
 * @param {object} corte      corte ya pasado por `conTramo`
 * @param {Array}  movimientos movimientos de caja de ESA sala en ese día
 * @param {Array}  invisibles  formas de pago que el comprobante no nombra
 */
export function sugerenciasDeCorte(corte, movimientos = [], invisibles = [], cobrosDelDia = null) {
    const out = [];

    // Antes que cualquier pista: si las dos fórmulas del origen no coinciden,
    // ninguna cifra de este corte sirve para señalar a nadie. Va primero
    // porque es la única sugerencia que cambia lo que se debe HACER.
    const tramo = corte?.tramo;
    if (tramo == null || Math.abs(tramo) < 0.01) return out;

    const objetivo = Math.abs(tramo);
    const falta = tramo < 0;

    // ── 0. Una forma de pago que el comprobante no nombra ───────────────────
    // Va PRIMERO porque es la única pista que no se puede encontrar mirando el
    // papel: el tiquete no imprime transferencias ni cheques, así que quien
    // busca el descuadre no sabe siquiera que ese cobro existió.
    //
    // Sólo para sobrantes, y eso es deliberado. Estas formas no entran a la
    // caja, así que confundirlas con efectivo hace que SOBRE dinero declarado,
    // nunca que falte. Ofrecerla ante un faltante mandaría a buscar donde no es.
    if (!falta) {
        for (const f of invisibles) {
            if (Math.abs(Math.abs(f.total) - objetivo) > CENTAVO) continue;
            out.push({
                titulo: `El sobrante es igual a ${formatMoney(Math.abs(f.total))} de ${f.tipo}`,
                detalle: `Ese cobro no pasa por la caja y el comprobante no lo nombra. Si se contó como efectivo al hacer el corte, ahí está el sobrante.`,
            });
        }
    }

    // ── 0-bis. NO hay pista por los cobros de crédito del portal ────────────
    // Acá vivió una, escrita el 2-sep: «el faltante es igual a $X de cobros que
    // no entraron en efectivo». La hipótesis era que el comprobante contaba
    // como efectivo un cobro por transferencia, y eso sigue siendo falso: el
    // comprobante no cuenta NINGÚN cobro del portal, ni el de transferencia ni
    // el de efectivo.
    //
    // Y por eso tampoco hace falta una pista para el de efectivo: no es algo
    // que haya que ir a mirar a la caja, es un término que le faltaba al
    // esperado, y `contraste` se lo suma. Una pista sobre algo ya corregido le
    // quita el turno a las que sí mandan a buscar.
    //
    // Se deja escrito y no se borra en silencio: la pista es plausible, alguien
    // la va a volver a proponer, y lo que la descarta es una medición. El
    // detalle está en `cobrosDeCredito`.

    // ── 1. ¿La diferencia es N veces un movimiento conocido? ────────────────
    const porMonto = new Map();
    for (const m of movimientos) {
        const v = Math.abs(num(m.monto) ?? 0);
        // Debajo de $1 el múltiplo deja de ser señal: con centavos cualquier
        // cifra "calza" con algo y la pista se vuelve ruido.
        if (v < 1) continue;
        const clave = v.toFixed(2);
        const y = porMonto.get(clave);
        if (y) { y.veces += 1; } else { porMonto.set(clave, { monto: v, veces: 1, concepto: m.concepto }); }
    }

    const multiplos = [];
    for (const { monto, veces, concepto } of porMonto.values()) {
        const n = objetivo / monto;
        const entero = Math.round(n);
        if (entero < 1 || entero > 6) continue;
        /* La tolerancia va en DÓLARES, no en la razón. Con `|n − entero|` el
         * margen crece con la cifra: sobre $319.10, medio centésimo de razón
         * son **40 centavos**, y así el corte de las 13:09 de Salud 4 ofrecía
         * «la diferencia es 4 × $79.70» cuando 4 × 79.70 = $318.80. Mandaba a
         * buscar un movimiento que no existe, y el número ni siquiera cerraba
         * — una pista que no suma es peor que ninguna: se va a mirar, no se
         * encuentra, y la próxima ya no se lee. */
        if (Math.abs(objetivo - entero * monto) > CENTAVO) continue;
        multiplos.push({ monto, veces, concepto, entero });
    }
    // 1× primero (coincidencia exacta con un movimiento) y, a igual cantidad de
    // veces, el monto más grande: es el que menos se repite por casualidad.
    multiplos.sort((a, b) => a.entero - b.entero || b.monto - a.monto);

    for (const m of multiplos.slice(0, 2)) {
        const concepto = m.concepto || 'sin concepto';
        out.push({
            // El título dice qué HACER y el detalle por qué. En el múltiplo el
            // concepto entra en el título —es lo que hay que ir a buscar— pero
            // recortado: hay conceptos largos y ahí el título se parte en tres
            // renglones y tapa la acción.
            titulo: m.entero === 1
                ? `Revisa el movimiento de ${formatMoney(m.monto)}`
                : `Busca otro «${corto(concepto)}» de ${formatMoney(m.monto)} sin anotar`,
            detalle: m.entero === 1
                ? `«${concepto}» es justo la diferencia. Si está anotado de más o de menos, cuadra.`
                : `La diferencia es ${m.entero} × ${formatMoney(m.monto)}, y hoy hay ${m.veces === 1 ? 'uno' : m.veces}. Con uno más, cuadra.`,
        });
    }

    // ── 2. La tarjeta, que es el número que se teclea ───────────────────────
    const tarjeta = num(corte.tk_tarjeta);
    if (tarjeta != null && tarjeta > 0) {
        out.push({
            titulo: 'Suma los vouchers de tarjeta',
            detalle: `Se anotaron ${formatMoney(tarjeta)}. Si los vouchers suman menos, ahí está el faltante.`,
        });
    }

    // ── 3. Vales: la salida de dinero que deja papel ────────────────────────
    const salidas = movimientos.filter((m) => m.tipo === 'SALIDA');
    if (salidas.length) {
        const total = salidas.reduce((a, m) => a + (num(m.monto) ?? 0), 0);
        out.push({
            titulo: salidas.length === 1
                ? `Busca el vale por ${formatMoney(total)}`
                : `Busca los ${salidas.length} vales por ${formatMoney(total)}`,
            detalle: 'Un vale sin su papel en la caja se ve igual que un faltante.',
        });
    }

    // ── 4. Cobros de crédito: entra efectivo sin documento de venta ─────────
    // Se calla cuando el detalle ya los explica: si TODOS se cobraron desde el
    // portal, en efectivo, y suman lo mismo que el comprobante, no queda nada
    // que ir a revisar — y una pista que manda a mirar algo ya resuelto le
    // quita el turno a las que sí valen. Antes se ofrecía siempre, porque hasta
    // ahora esa línea era un número sin detrás.
    // `noEfectivo` NO entra en la condición: el comprobante tampoco lo cuenta
    // (medido, ver `cobrosDeCredito`), así que un cobro por transferencia no
    // deja nada sin explicar. Lo que importa es que el efectivo cuadre y que no
    // haya entrado ninguno después de contar.
    const yaExplicados = !!cobrosDelDia?.cuadra && cobrosDelDia.despues.length === 0;
    const cobros = num(corte.tk_cobros_credito);
    if (cobros != null && cobros > 0 && !yaExplicados) {
        out.push({
            titulo: `Revisa los ${formatMoney(cobros)} de cobros de crédito`,
            detalle: 'Es dinero que entra sin venta. Si no llegó a la caja, falta.',
        });
    }

    // ── 5. Ingresos varios (recibos que se cobran en el mostrador) ──────────
    const entradas = movimientos.filter((m) => m.tipo === 'ENTRADA');
    if (falta && entradas.length >= 5) {
        const total = entradas.reduce((a, m) => a + (num(m.monto) ?? 0), 0);
        out.push({
            titulo: `Revisa los ${entradas.length} ingresos de caja por ${formatMoney(total)}`,
            detalle: 'Un recibo cobrado y no anotado se ve igual que un faltante.',
        });
    }

    // ── 6. Devoluciones y retención, cuando existen ─────────────────────────
    const devol = num(corte.tk_devoluciones);
    if (devol != null && devol > 0) {
        out.push({
            titulo: `Revisa las devoluciones por ${formatMoney(devol)}`,
            detalle: 'Ese dinero tuvo que salir de esta caja y quedar documentado.',
        });
    }

    return out;
}
