// Cortes de caja — la diferencia por tramo y las pistas de revisión.
//
// Vive fuera de la vista a propósito: es la parte que decide si a alguien se le
// señala un faltante, y tiene que poder mirarse (y corregirse) sin abrir un
// componente de 400 líneas.

import { formatMoney } from './formatNumber';

const CENTAVO = 0.005;
const redondear = (n) => Math.round(n * 100) / 100;
const num = (v) => (v == null ? null : Number(v));
/** El signo explícito importa: en caja, «3.39» y «+3.39» no dicen lo mismo. */
const conSignoTxt = (n) => (n > 0 ? `+${formatMoney(n)}` : formatMoney(n));
/** Para meter el concepto de un movimiento en un título sin partirlo en tres. */
const corto = (s, max = 26) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

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
        if (c.tipo !== 'C' || c.estado === 'DESCARTADO') {
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
        out.push(...conTramo([...lista].sort((a, b) => String(a.hora).localeCompare(String(b.hora)))));
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
        pendientes: 0, confirmados: 0, descartados: 0,
    };
    for (const c of cortesConTramo || []) {
        if (c.tipo !== 'C') continue;
        if (c.estado === 'DESCARTADO') { r.descartados += 1; continue; }
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
    const declarado = num(corte?.total_declarado);
    const totalCaja = num(corte?.tk_total_caja);
    const difErp = num(corte?.diferencia_erp);
    if (declarado == null || totalCaja == null || difErp == null) return null;

    const difTicket = redondear(declarado - totalCaja);
    const brecha = redondear(difErp - difTicket);
    const cobros = num(corte?.tk_cobros_credito);

    // Cuántas veces el cobro de crédito explica la brecha. Entero → es el
    // defecto conocido del origen y no hay nada que investigar en la sala.
    const veces = cobros && Math.abs(cobros) >= 0.01 ? brecha / cobros : null;
    const porCobrosCredito = veces != null && Math.abs(veces - Math.round(veces)) < 0.001;

    return {
        difErp,
        difTicket,
        brecha,
        cobros,
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
    const c = contraste(corte);
    if (!c) {
        return { valor: num(corte?.diferencia_erp) ?? 0, fuente: 'guardada', esperado: num(corte?.esperado) };
    }
    // El caso `−1×` es el único donde manda la guardada: significa que el ticket
    // sumó los cobros de crédito del DÍA a un corte que se hizo ANTES de que
    // entraran. Ahí el formulario tenía razón —contó cero porque todavía no
    // había— y el ticket es el que sobra. En cualquier otro múltiplo el que
    // cuenta de más es el formulario.
    //
    // Contrastado contra el aviso de Telegram del 13-ago en Salud 3, que es un
    // testigo independiente y de la misma hora del corte: 12:39 → +$0.75,
    // 12:41 → exacto, 21:03 → −$511.18, 21:21 → −$22.38. Los cuatro salen.
    // `brecha = difErp − difTicket = tk_total_caja − esperado`, o sea el INVERSO
    // del desvío: el caso «el ticket sumó un cobro de más» es brecha = +1×.
    if (c.vecesElCobro === 1) {
        return { valor: c.difErp, fuente: 'guardada', esperado: num(corte?.esperado) };
    }
    return { valor: c.difTicket, fuente: 'ticket', esperado: num(corte?.tk_total_caja) };
}

/**
 * Por qué la cifra que se muestra no es la que guardó el sistema — en palabras.
 *
 * Antes esto salía como «El sistema dice +$0.75; acá se usa −$53.90», que además
 * de incomprensible estaba al revés cuando la buena era la guardada: el texto
 * daba por hecho que siempre se usaba la del ticket. Ahora se arma desde
 * `diferenciaDelCorte`, que es quien decide, así que no puede contradecirla.
 *
 * Devuelve `null` cuando no hay nada que explicar.
 */
export function notaDeCifra(corte) {
    const c = contraste(corte);
    if (!c?.enDisputa) return null;
    const { fuente, valor } = diferenciaDelCorte(corte);
    const cobros = formatMoney(Math.abs(c.cobros ?? 0));

    // Ojo con lo que se nombra: `valor` es el ACUMULADO del día hasta este
    // corte, y el título del modal muestra el TRAMO. Llamar «la diferencia de
    // este corte» al acumulado ponía dos números distintos con el mismo rótulo
    // en la misma pantalla — el usuario lo leyó y no se entendía.
    if (c.porCobrosCredito && fuente === 'guardada') {
        return {
            tono: 'info',
            titulo: 'Se cortó antes de los cobros de crédito',
            detalle: `El comprobante suma ${cobros} de cobros que a esta hora todavía no entraban. Por eso vale ${conSignoTxt(c.difErp)} y no ${conSignoTxt(c.difTicket)}.`,
        };
    }
    if (c.porCobrosCredito) {
        const veces = Math.abs(c.vecesElCobro);
        return {
            tono: 'info',
            titulo: 'Los cobros de crédito se contaron de más',
            detalle: `La otra cifra dice ${conSignoTxt(c.difErp)} porque suma ${cobros} ${veces} ${veces === 1 ? 'vez' : 'veces'} de más. Es una falla al sumarlos, no algo que pasó en la caja. Vale ${conSignoTxt(valor)}, que es lo que dice el comprobante.`,
        };
    }
    return {
        tono: 'danger',
        titulo: 'Revisa los movimientos del día',
        detalle: `Hay dos cifras (${conSignoTxt(c.difErp)} y ${conSignoTxt(c.difTicket)}) y ${formatMoney(Math.abs(c.brecha))} sin explicar. No conviene dar por bueno un faltante así.`,
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
 * El efectivo se DERIVA, y la derivación está verificada contra los cortes de
 * caja del mismo día: `total − tarjeta − crédito` da exactamente el `VENTA` del
 * último corte en 5 de las 6 salas (la sexta difiere $2.20 porque siguió
 * vendiendo después de su último conteo, que es lo esperado).
 *
 * Ni la tarjeta ni el crédito entran a la caja: la tarjeta se cobra por el
 * datáfono y el crédito recién entra cuando el cliente paga, y ahí aparece como
 * cobro de crédito en un corte posterior.
 *
 * No hay transferencias: de los 42 tiquetes capturados al 2026-08-14, 36
 * nombran tarjeta y 33 crédito; **ninguno** nombra transferencia, cheque ni
 * depósito. Si algún día aparecen, este desglose deja de cerrar y hay que
 * agregarlas — por eso devuelve también `otras`, que hoy es siempre cero.
 */
export function desgloseDelCierre(corte) {
    const total = num(corte?.total_declarado) ?? 0;
    const tarjeta = num(corte?.tk_tarjeta) ?? 0;
    const credito = num(corte?.tk_credito) ?? 0;
    return {
        total,
        tarjeta,
        credito,
        efectivo: redondear(total - tarjeta - credito),
        // Un resto distinto de cero significaría una forma de pago que este
        // desglose no conoce. Hoy es imposible por construcción, y justamente
        // por eso conviene que exista: el día que el origen agregue una, se ve.
        otras: 0,
    };
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
export const seConfirmaDeUnClic = (corte) => severidad(corte?.tramo) === 'ok';

/**
 * Qué revisar cuando un tramo no cuadra.
 *
 * La primera pista es la más útil y la más barata: cuando la diferencia es un
 * múltiplo exacto de un movimiento que YA existe en el día, casi siempre es que
 * falta registrar otro igual. Salió sola de los datos del 13-ago en La Popular
 * —diferencia $13.80, con dos «POR ABONO A CREDITO» de $4.60 anotados: 3 × 4.60—
 * y es una hipótesis para confirmar en la sala, no un veredicto.
 *
 * @param {object} corte      corte ya pasado por `conTramo`
 * @param {Array}  movimientos movimientos de caja de ESA sala en ese día
 */
export function sugerenciasDeCorte(corte, movimientos = []) {
    const out = [];

    // Antes que cualquier pista: si las dos fórmulas del origen no coinciden,
    // ninguna cifra de este corte sirve para señalar a nadie. Va primero
    // porque es la única sugerencia que cambia lo que se debe HACER.
    const tramo = corte?.tramo;
    if (tramo == null || Math.abs(tramo) < 0.01) return out;

    const objetivo = Math.abs(tramo);
    const falta = tramo < 0;

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
        if (Math.abs(n - entero) > CENTAVO) continue;
        multiplos.push({ monto, veces, concepto, entero });
    }
    // 1× primero (coincidencia exacta con un movimiento) y, a igual cantidad de
    // veces, el monto más grande: es el que menos se repite por casualidad.
    multiplos.sort((a, b) => a.entero - b.entero || b.monto - a.monto);

    for (const m of multiplos.slice(0, 2)) {
        const concepto = m.concepto || 'sin concepto';
        out.push({
            tono: 'danger',
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
            tono: 'warning',
            titulo: 'Suma los vouchers de tarjeta',
            detalle: `Se anotaron ${formatMoney(tarjeta)}. Si los vouchers suman menos, ahí está el faltante.`,
        });
    }

    // ── 3. Vales: la salida de dinero que deja papel ────────────────────────
    const salidas = movimientos.filter((m) => m.tipo === 'SALIDA');
    if (salidas.length) {
        const total = salidas.reduce((a, m) => a + (num(m.monto) ?? 0), 0);
        out.push({
            tono: 'warning',
            titulo: salidas.length === 1
                ? `Busca el vale por ${formatMoney(total)}`
                : `Busca los ${salidas.length} vales por ${formatMoney(total)}`,
            detalle: 'Un vale sin su papel en la caja se ve igual que un faltante.',
        });
    }

    // ── 4. Cobros de crédito: entra efectivo sin documento de venta ─────────
    const cobros = num(corte.tk_cobros_credito);
    if (cobros != null && cobros > 0) {
        out.push({
            tono: 'info',
            titulo: `Revisa los ${formatMoney(cobros)} de cobros de crédito`,
            detalle: 'Es dinero que entra sin venta. Si no llegó a la caja, falta.',
        });
    }

    // ── 5. Ingresos varios (recibos que se cobran en el mostrador) ──────────
    const entradas = movimientos.filter((m) => m.tipo === 'ENTRADA');
    if (falta && entradas.length >= 5) {
        const total = entradas.reduce((a, m) => a + (num(m.monto) ?? 0), 0);
        out.push({
            tono: 'info',
            titulo: `Revisa los ${entradas.length} ingresos de caja por ${formatMoney(total)}`,
            detalle: 'Un recibo cobrado y no anotado se ve igual que un faltante.',
        });
    }

    // ── 6. Devoluciones y retención, cuando existen ─────────────────────────
    const devol = num(corte.tk_devoluciones);
    if (devol != null && devol > 0) {
        out.push({
            tono: 'info',
            titulo: `Revisa las devoluciones por ${formatMoney(devol)}`,
            detalle: 'Ese dinero tuvo que salir de esta caja y quedar documentado.',
        });
    }

    return out;
}
