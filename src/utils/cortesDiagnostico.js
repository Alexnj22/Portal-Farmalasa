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

/**
 * Los cortes de caja son ACUMULATIVOS dentro del día: el de la noche contiene
 * al de la mañana. Entonces la diferencia que importa —la que señala un turno—
 * no es la del corte, es cuánto se movió DESDE el corte anterior.
 *
 * Regla del usuario (2026-08-14): «si en el primer corte confirmado hay
 * diferencia de +$0.25, en el de la noche como mínimo debe haber +$0.25; si no
 * pasa eso, entonces faltan $0.25 en el corte de la noche».
 *
 * Los DESCARTADOS no cuentan ni como base ni como tramo: un conteo mal hecho no
 * puede desplazar la referencia de los que vienen después. Ejemplo real del
 * 13-ago en Salud 1: 19:52 declaró $834.28 con −$621.17 y 19:53 declaró
 * $1,456.00 con +$0.55 — descartado el primero, el tramo de las 19:53 se mide
 * contra el corte de las 13:22, que es lo correcto.
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
        previa = dif;
        return { ...c, tramo, acumulado: dif, fuente, esperadoUsado: esperado };
    });
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
            titulo: 'Este corte se hizo antes de los cobros de crédito',
            detalle: `Su comprobante suma los ${cobros} de cobros de crédito del día, pero a esta hora ese dinero todavía no había entrado a la caja. Por eso el portal toma la cifra del sistema (${conSignoTxt(c.difErp)}) y no la del comprobante (${conSignoTxt(c.difTicket)}).`,
        };
    }
    if (c.porCobrosCredito) {
        const veces = Math.abs(c.vecesElCobro);
        return {
            tono: 'info',
            titulo: 'El sistema contó de más los cobros de crédito',
            detalle: `Guardó ${conSignoTxt(c.difErp)} porque sumó los ${cobros} de cobros de crédito ${veces} ${veces === 1 ? 'vez' : 'veces'} de más. Es un defecto conocido suyo al sumarlos, no algo que haya pasado en la caja. El portal usa ${conSignoTxt(valor)}, que es lo que dice el comprobante del corte y cierra contra los movimientos del día.`,
        };
    }
    return {
        tono: 'danger',
        titulo: 'Dos cifras que no cuadran entre sí',
        detalle: `El sistema guardó ${conSignoTxt(c.difErp)} y el comprobante del corte da ${conSignoTxt(c.difTicket)}: ${formatMoney(Math.abs(c.brecha))} de diferencia que NO se explica por los cobros de crédito. Revisa los movimientos del día antes de dar por bueno un faltante.`,
    };
}

/** 'ok' | 'sobra' | 'falta' — la forma, no sólo el color. */
export function severidad(monto) {
    const n = num(monto) ?? 0;
    if (Math.abs(n) < 0.01) return 'ok';
    return n < 0 ? 'falta' : 'sobra';
}

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
        out.push({
            tono: 'danger',
            titulo: m.entero === 1
                ? `Hay un movimiento de exactamente ${formatMoney(m.monto)}`
                : `${formatMoney(objetivo)} es exactamente ${m.entero} × ${formatMoney(m.monto)}`,
            detalle: m.entero === 1
                ? `«${m.concepto || 'sin concepto'}». Si se registró de más o de menos, cuadra la diferencia al centavo.`
                : `Hoy hay ${m.veces === 1 ? 'un movimiento' : `${m.veces} movimientos`} de ${formatMoney(m.monto)} («${m.concepto || 'sin concepto'}»). Si entró otro y no se registró, cuadra al centavo. Es una hipótesis para confirmar en la sala.`,
        });
    }

    // ── 2. La tarjeta, que es el número que se teclea ───────────────────────
    const tarjeta = num(corte.tk_tarjeta);
    if (tarjeta != null && tarjeta > 0) {
        out.push({
            tono: 'warning',
            titulo: `¿Cuadran los vouchers de tarjeta?`,
            detalle: `El sistema registra ${formatMoney(tarjeta)}. Ese monto lo escribe quien corta, y si va de más la diferencia se esconde sola.`,
        });
    }

    // ── 3. Vales: la salida de dinero que deja papel ────────────────────────
    const salidas = movimientos.filter((m) => m.tipo === 'SALIDA');
    if (salidas.length) {
        const total = salidas.reduce((a, m) => a + (num(m.monto) ?? 0), 0);
        out.push({
            tono: 'warning',
            titulo: salidas.length === 1
                ? `Un vale por ${formatMoney(total)}`
                : `${salidas.length} vales por ${formatMoney(total)}`,
            detalle: 'Un vale sin su comprobante en la caja se ve igual que un faltante.',
        });
    }

    // ── 4. Cobros de crédito: entra efectivo sin documento de venta ─────────
    const cobros = num(corte.tk_cobros_credito);
    if (cobros != null && cobros > 0) {
        out.push({
            tono: 'info',
            titulo: `Cobros de crédito por ${formatMoney(cobros)}`,
            detalle: 'Es dinero que entra sin venta detrás. Si no llegó a la caja, aparece como faltante.',
        });
    }

    // ── 5. Ingresos varios (recibos que se cobran en el mostrador) ──────────
    const entradas = movimientos.filter((m) => m.tipo === 'ENTRADA');
    if (falta && entradas.length >= 5) {
        const total = entradas.reduce((a, m) => a + (num(m.monto) ?? 0), 0);
        out.push({
            tono: 'info',
            titulo: `${entradas.length} ingresos de caja por ${formatMoney(total)}`,
            detalle: 'Un recibo cobrado y no registrado se ve igual que un faltante.',
        });
    }

    // ── 6. Devoluciones y retención, cuando existen ─────────────────────────
    const devol = num(corte.tk_devoluciones);
    if (devol != null && devol > 0) {
        out.push({
            tono: 'info',
            titulo: `Devoluciones por ${formatMoney(devol)}`,
            detalle: 'Verifica que el dinero devuelto salió de esta caja y quedó documentado.',
        });
    }

    return out;
}
