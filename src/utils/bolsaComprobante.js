// Los tres papeles de una bolsa de efectivo.
//
// Qué pidió el usuario (2026-08-15): «en las bolsitas normalmente ponen una
// cinta o un papel con la fecha y monto, pero quiero que los tickets sean eso:
// digan fecha, hora, monto, responsables, y enliste si se sacó dinero de ahí,
// con el monto nuevo total sin esos vales».
//
// Son tres y ninguno reemplaza a otro, porque van a tres lugares distintos:
//
//   · `construirEtiquetaDeBolsa`   — se pega AFUERA. Reemplaza la cinta. UNA
//                                    por bolsa: cada una dice SU saldo nuevo.
//   · `construirValeDeSalida`      — el comprobante de la salida. Se archiva
//                                    aparte, y es UNO por operacion aunque el
//                                    dinero haya salido de cuatro bolsas.
//
// El diseño completo, en `docs/PLAN-BOLSAS-DE-EFECTIVO-2026-08-15.md`.
//
// ── Lo que se rompe solo (§5 de docs/IMPRESION-EN-TICKETERA-2026-08-13.md) ───
// Sólo ASCII —por eso los rótulos de acá van SIN TILDE a propósito, no es un
// descuido—, 54 columnas en letra chica, y el papel no tiene tema: ni colores,
// ni fondos, ni bordes. El ancho NO se pasa: es un ajuste de la computadora que
// tiene la ticketera enchufada.
//
// ── Y una que es de estos documentos ────────────────────────────────────────
// **La etiqueta se vuelve mentira en cuanto sale plata de la bolsa.** Por eso
// lleva número de impresión y dice que anula a la anterior: sobre la mesa de
// administración, dos etiquetas de la misma bolsa se ven iguales y sólo una
// dice la verdad. Y por eso imprime SIEMPRE el estado de hoy — nunca una foto
// guardada al cerrarla.

import { EMPRESA } from '../constants/empresa';
import { formatMoney } from './formatNumber';
import { soloAscii, recortar, fechaCorta, hhmm, selloCorto, juntarSiEntra } from './ticketCampos';

/** El ancho del primer campo de la tabla de cuatro columnas del rollo. */
const ANCHO_MOTIVO = 28;

/**
 * Un importe para la ULTIMA columna de la tabla de cuatro, que mide 8.
 *
 * Existe porque el relleno del rollo **recorta por la izquierda** lo que no
 * entra (`padStart(8).slice(-8)`), y eso no se ve: `$1,234.56` sale `1,234.56`
 * —bien— pero `-1,234.56` sale `1,234.56`, o sea el faltante impreso como
 * sobrante. Con nueve caracteres se pierde el primero, y el primero es el que
 * dice la dirección.
 *
 * Por eso acá: sin `$` y sin signo —la dirección la declara el encabezado de la
 * columna— y sin separador de miles cuando con él no entraría. Alcanza hasta
 * `99999.99`; una bolsa de una sala anda entre $150 y $1,300.
 */
const importeDeColumna = (valor) => {
    const n = Math.abs(Number(valor ?? 0));
    const conSeparador = formatMoney(n, { signo: false });
    return conSeparador.length <= 8 ? conSeparador : n.toFixed(2);
};

/** «1 bolsa» / «2 bolsas» — un rótulo mal conjugado se lee como un descuido. */

/**
 * La fecha y la hora de El Salvador de un sello de tiempo.
 *
 * Existe porque cortar el ISO a mano —`iso.slice(11,16)`— imprime la hora UTC.
 * Se vio en el primer vale real: el papel del vale decía «04:23 p. m.» y la
 * etiqueta de la misma bolsa listaba esa salida a las «22:23». Dos papeles de la
 * misma operación con seis horas de diferencia, y el que miente es el que va
 * pegado afuera.
 */
export function enHoraDeLaSala(iso) {
    if (!iso) return { fecha: '', hora: '' };
    const partes = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/El_Salvador',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(iso));
    const v = (t) => partes.find((x) => x.type === t)?.value || '';
    return { fecha: `${v('year')}-${v('month')}-${v('day')}`, hora: `${v('hour')}:${v('minute')}` };
}

/**
 * Las salidas de una bolsa, con la forma que espera la etiqueta.
 *
 * Vive acá y no en cada pantalla porque estaba escrito dos veces —la baldosa y
 * la pestaña— y las dos tenían el mismo defecto de huso. Una etiqueta la imprime
 * cualquiera de las dos, así que dos versiones significan dos papeles distintos
 * de la misma bolsa.
 *
 * Las anuladas quedan fuera: un vale anulado ya no está adentro.
 */
export function salidasParaEtiqueta(filas = []) {
    return (filas || [])
        .filter((s) => !s.anulado_at && Number(s.monto) < 0)
        .map((s) => ({
            ...enHoraDeLaSala(s.registrado_at),
            motivo: s.etiqueta,
            monto: s.monto,
        }));
}

/**
 * Sólo el nombre. **El NIT no va**: estos tres papeles no salen de la farmacia
 * —se pegan a una bolsa, quedan adentro o los firman dos empleados—, así que el
 * dato que identifica al contribuyente no cumple ninguna función acá y gasta un
 * renglón en cada impresión. Los documentos que SÍ se presentan (el Corte Z, los
 * comprobantes de caja) lo siguen llevando.
 */
const encabezadoDeLaEmpresa = () => ({ titulo: soloAscii(EMPRESA.razonSocial) });

const sumar = (filas, campo = 'monto') => filas
    .reduce((a, f) => a + Math.abs(Number(f?.[campo] ?? 0)), 0);

/** Cómo se comprobó que quien recibe el dinero es quien dice ser. */
const COMO_SE_IDENTIFICO = {
    CLAVE: 'usuario y contrasena',
    CARNE: 'carne escaneado',
};

/**
 * LA ETIQUETA — el papel que va pegado afuera de la bolsa.
 *
 * Reemplaza la cinta escrita a mano, y hace lo que la cinta no puede: listar lo
 * que salió y decir cuánto efectivo debe haber AHORA. Ese último número es el
 * que administración compara contra lo que cuenta.
 *
 * Cuando la bolsa no tiene salidas —el caso normal— no se imprime ni la tabla
 * ni el renglón de vales: una etiqueta de cuatro renglones se lee de un vistazo
 * y gasta menos rollo.
 *
 * @param {object} bolsa      { folio, fecha, hora, caja, monto_inicial, cerrada_at }
 * @param {string} sala       nombre de la sucursal
 * @param {Array}  salidas    [{ fecha, hora, motivo, monto }] — monto en positivo o negativo, da igual
 * @param {string} cerradaPor quién guardó el dinero
 * @param {number} version    cuántas veces se imprimió esta etiqueta, contando ésta
 * @param {string} impresaAt  ISO del momento de imprimir
 * @param {Array}  cheques    [{ hora, cliente, documento, total }] — los que viajan con la bolsa
 */
export function construirEtiquetaDeBolsa({
    bolsa, sala, salidas = [], cerradaPor, version = 1, impresaAt, cheques = [],
}) {
    const inicial = Number(bolsa?.monto_inicial ?? 0);
    const sacado = sumar(salidas);
    const efectivo = Math.round((inicial - sacado) * 100) / 100;
    const hubo = salidas.length > 0;
    const conCheque = (cheques || []).length > 0;

    return {
        titulo: 'BOLSA DE EFECTIVO',
        encabezado: encabezadoDeLaEmpresa(),
        // Los rótulos son cortos porque el ancho manda: en dos columnas, media
        // línea son 27 caracteres y `Corte del: 14/08/2026  19:01` (28) obliga a
        // gastar un renglón entero. Lo que se recorta es el rótulo, nunca el
        // dato. Lo que se guardó al cerrar NO va acá: es el primer término de la
        // resta de abajo, y en letra chica entre los datos se lee como una ficha
        // más y no como el número del que se parte.
        datos: [
            ['Bolsa', recortar(bolsa?.folio || '', 24)],
            ['Sala', recortar(sala || '', 34)],
            ['Corte', `${fechaCorta(bolsa?.fecha)} ${hhmm(bolsa?.hora)}`],
            ['Caja', recortar(bolsa?.caja || '', 34)],
            ['Guardo', recortar(cerradaPor || 'Sin registrar', 34)],
            ['Cerrada', selloCorto(bolsa?.cerrada_at)],
        ],
        /* EL CHEQUE — lo único que va con la bolsa y no es un billete.
         *
         * Un cheque no está en NINGÚN número del corte: medido en el del 27-ago
         * en Salud 1, `tk_venta` son los $1,141.30 de efectivo del día y el
         * cheque de $352.50 no aparece por ningún lado. O sea que la etiqueta
         * decía «EFECTIVO $565.21» sobre una bolsa que además llevaba un papel
         * de $352.50 del que no hablaba.
         *
         * Va ARRIBA de la resta y no abajo, y en un bloque y no en los totales,
         * porque no es un sumando: quien cuenta la bolsa cuenta billetes contra
         * el EFECTIVO, y meter el cheque en esa columna invita a sumarlo. Acá
         * dice lo que es —algo más que tiene que estar adentro— antes de que se
         * llegue al número que se compara.
         *
         * ── Se ROTULA, no se advierte (usuario, 2026-08-29) ─────────────────
         * Salió como «OJO: TAMBIEN VA UN CHEQUE» con un renglón que explicaba
         * que no entraba en el efectivo, y el usuario sacó las dos cosas:
         * *«mejor que diga Cheques: […] eso está demás»*. Y es la misma regla
         * que el resto del papel: la etiqueta es una LISTA de lo que hay
         * adentro, no un aviso. El bloque está aparte de los totales y con su
         * propio rótulo, así que el renglón que decía «no entra en el EFECTIVO»
         * repetía en prosa lo que la maqueta ya dice — y en un rollo de veinte
         * renglones eso son dos gastados en nada.
         *
         * Sin plural que conjugar: `Cheques:` sirve para uno y para tres. */
        bloques: conCheque ? [{
            titulo: 'Cheques:',
            filas: cheques.map((c) => [
                recortar(`${hhmm(c.hora)} ${c.cliente || 'Sin cliente'}`, 44),
                formatMoney(Math.abs(Number(c.total ?? 0))),
            ]),
        }] : undefined,
        // Las CUATRO columnas son la geometría medida contra un ticket real del
        // sistema de facturación. La de dos colapsa a «primero … ultimo» y acá
        // perdería justo la fecha y la hora de cada salida, que es lo que
        // permite ir a buscar el vale.
        items: hubo ? {
            columnas: [
                { label: 'SE SACO PARA' },
                { label: 'FECHA', alinear: 'der' },
                { label: 'HORA', alinear: 'der' },
                { label: 'SALIO', alinear: 'der' },
            ],
            filas: salidas.map((s) => [
                recortar(s.motivo || 'Sin motivo', ANCHO_MOTIVO),
                fechaCorta(s.fecha).slice(0, 5),
                hhmm(s.hora),
                importeDeColumna(s.monto),
            ]),
        } : undefined,
        // El destacado es el efectivo y no el total: es la unica cifra que
        // alguien va a contar con las manos. Y va ULTIMO, debajo de los vales
        // (pedido del usuario, 2026-08-17): la etiqueta se lee de arriba abajo
        // como una resta —se guardo tanto, salio tanto en vales, queda esto— y
        // el numero que cierra la cuenta es el que administracion busca.
        //
        // La resta se imprime ENTERA, con su primer termino (pedido del usuario,
        // 2026-08-18, al reimprimir una etiqueta despues de agregar un vale):
        // sin `EFECTIVO INICIAL` el papel muestra el resultado y lo que se
        // resto, pero no de cuanto se partio, asi que la cuenta no se puede
        // rehacer mirandolo. Los vales van CON el signo menos por lo mismo: en
        // esta columna hay lugar de sobra —son 40 caracteres, no las 8 de la
        // tabla de arriba— y el signo dice para que lado va el numero.
        totales: hubo
            ? [
                ['EFECTIVO INICIAL', formatMoney(inicial)],
                [`VALES (${salidas.length})`, formatMoney(-sacado)],
                ['EFECTIVO', formatMoney(efectivo), true],
            ]
            : [['EFECTIVO', formatMoney(inicial), true]],
        // El número de etiqueta y la hora en que se imprimió son UN dato —cuál
        // es la buena— así que van en un renglón, no en dos con un blanco en el
        // medio.
        pie: [
            ...juntarSiEntra(
                version > 1 ? `ETIQUETA #${version} - ANULA LA ANTERIOR` : 'ETIQUETA #1',
                selloCorto(impresaAt),
            ),
            hubo
                ? 'Si sale mas dinero, imprimir otra etiqueta.'
                : 'Si sale dinero de esta bolsa, imprimir otra etiqueta.',
        ],
    };
}

/**
 * EL VALE — el comprobante de una salida de efectivo. **Uno por OPERACION.**
 *
 * Reemplaza al papel escrito a mano, y agrega lo que ese papel nunca dijo:
 * **de que bolsa salio cada parte y cuanto le quedo a cada una**. El papel a
 * mano decia cuanto se llevaron, que es la mitad que no sirve para contar.
 *
 * ── Por que UNO y no uno por bolsa (2026-08-28) ────────────────────────────
 *
 * Hasta hoy salia un vale por cada bolsa tocada, y el papel lo decia en su pie:
 * «Este vale queda dentro de la bolsa X». Con esa premisa, cuatro bolsas exigian
 * cuatro papeles — si no, tres bolsas viajaban sin nada adentro que explicara su
 * faltante.
 *
 * El usuario corrigio la premisa mirando los cuatro que salieron de CMB-1032:
 * «los vales y demas se guardan aparte. asi que puede ser solo 1. eso si, debe
 * especificar de donde y cuanto salio». Si el vale se archiva y no viaja dentro
 * de la bolsa, cuatro papeles casi iguales son cuatro salidas APARENTES de una
 * operacion sola — y el faltante de cada bolsa ya lo explica su etiqueta, que
 * sigue siendo una por bolsa y lista la salida con el saldo nuevo.
 *
 * Y el papel no dice donde se guarda ni pide firma: lo primero se sabe, y lo
 * segundo ya lo contesta «Recibe: X (carne escaneado)», que lo escribio el
 * servidor despues de comprobar la identidad — no una raya en el rollo.
 *
 * Por eso la tabla de cuatro columnas: es el unico lugar del papel donde entra
 * el detalle por bolsa. **Cuatro exactas, no tres ni cinco** — con cualquier
 * otra cantidad el camino sin dialogo colapsa a «primera … ultima» (ver
 * `filaDeItem`), o sea que se perderian justo las columnas del medio. Los anchos
 * son 31/5/8/8, medidos contra un ticket real.
 *
 * @param {object} operacion  { folio, motivo, entidad, entidadEtiqueta,
 *                              numero_boleta, monto, nota, leyenda }
 * @param {Array}  lineas     [{ bolsa_folio, bolsa_fecha, bolsa_hora, monto,
 *                              saldo_despues }] — el monto en positivo o
 *                              negativo, da igual
 * @param {string} sala
 * @param {string} registradoPor
 * @param {object} recibidoPor { nombre, metodo } — quien se llevo el efectivo
 * @param {string} registradoAt ISO
 */
export function construirValeDeSalida({
    operacion = {}, lineas = [], sala, registradoPor, recibidoPor, registradoAt,
}) {
    const vivas = (lineas || []).filter((l) => !l.anulado_at);
    const total = Math.abs(Number(operacion?.monto ?? sumar(vivas)));

    const datos = [
        ['Vale', recortar(operacion?.folio || '', 24)],
        ['Sala', recortar(sala || '', 34)],
        ['Motivo', recortar(operacion?.motivo || 'Sin motivo', 30)],
    ];
    // El rotulo lo dice el TIPO de salida, no este archivo: una remesa se le
    // entrega a una remesadora y un pago a un proveedor, y el papel escrito a
    // mano decia «Banco» sobre las dos. Sale de `bolsas_tipos_salida`, que es
    // de donde sale tambien el rotulo del formulario — un rotulo escrito en dos
    // lugares se desincroniza el dia que alguien cambia uno.
    if (operacion?.entidad) {
        datos.push([recortar(soloAscii(operacion.entidadEtiqueta || 'Entidad'), 16),
                    recortar(operacion.entidad, 30)]);
    }
    if (operacion?.numero_boleta) datos.push(['No. de boleta', recortar(operacion.numero_boleta, 24)]);

    const identificacion = recibidoPor?.metodo
        ? COMO_SE_IDENTIFICO[recibidoPor.metodo] || 'identificado en el portal'
        : null;

    /* El motivo puede traer algo que hay que saber al LEER este papel — hoy,
     * que el dinero de un cambio por monedas no salio de la sala. Va antes del
     * detalle escrito a mano y no despues: dice QUE ES esta salida, mientras
     * que el detalle cuenta el caso.
     *
     * Sale del catalogo (`bolsas_tipos_salida.leyenda`) y no de un `if` sobre
     * el codigo del motivo: el dia que otro motivo necesite advertir algo, lo
     * declara ahi y este archivo no se toca. */
    const bloques = [
        ...(operacion?.leyenda ? [{ titulo: 'NOTA', texto: recortar(operacion.leyenda, 160) }] : []),
        ...(operacion?.nota ? [{ titulo: 'DETALLE', texto: recortar(operacion.nota, 160) }] : []),
    ];

    return {
        titulo: 'VALE DE EFECTIVO',
        encabezado: encabezadoDeLaEmpresa(),
        datos,
        bloques: bloques.length ? bloques : undefined,
        /* «De donde y cuanto», que es lo que el usuario pidio que dijera.
         *
         * El folio de la bolsa NO alcanza para saber cual es sobre la mesa: las
         * de una sala se distinguen por el corte del que nacieron, y eso —dia y
         * hora— es lo que dice la etiqueta pegada afuera. Por eso la fecha y la
         * hora gastan dos de las cuatro columnas.
         *
         * Y la ultima es lo que QUEDA, no lo que habia: es el numero contra el
         * que administracion va a contar esa bolsa, y el unico que el papel a
         * mano nunca dijo. */
        items: {
            columnas: [
                { label: 'DE QUE BOLSA' },
                { label: 'HORA', alinear: 'der' },
                { label: 'SALIO', alinear: 'der' },
                { label: 'QUEDA', alinear: 'der' },
            ],
            filas: vivas.map((l) => [
                recortar(`${l.bolsa_folio || ''} ${fechaCorta(l.bolsa_fecha).slice(0, 5)}`.trim(), ANCHO_MOTIVO),
                hhmm(l.bolsa_hora),
                importeDeColumna(l.monto),
                importeDeColumna(l.saldo_despues),
            ]),
        },
        // El destacado es el TOTAL de la operacion: es lo que se llevaron y lo
        // que se firma. El detalle por bolsa ya esta arriba, renglon por
        // renglon, asi que repetirlo aca seria decir dos veces lo mismo.
        totales: [
            [vivas.length === 1 ? 'SALE DE LA BOLSA' : `SALE DE ${vivas.length} BOLSAS`,
             formatMoney(total), true],
        ],
        /* Quién y cuándo son un solo hecho, y quién retira y cómo se comprobó
         * también: cada par entra en un renglón mientras los nombres quepan, y
         * `juntarSiEntra` los separa cuando no —un nombre de 40 caracteres
         * desborda el rollo y la impresora lo parte a mitad de palabra—.
         *
         * ── SIN renglón de firma (usuario, 2026-08-28) ─────────────────────
         * «firma no es necesaria ya quien hace el proceso queda ahi». Y es más
         * fuerte que una firma: el nombre de quien retira no lo escribió nadie
         * en el papel, lo puso el SERVIDOR después de comprobar su carné o su
         * contraseña contra la base. Una raya para firmar al lado de eso pide a
         * mano una prueba que el portal ya tiene mejor. */
        pie: [
            ...juntarSiEntra(
                `Registro: ${recortar(registradoPor || 'Sin registrar', 40)}`,
                selloCorto(registradoAt),
            ),
            ...(recibidoPor?.nombre
                ? juntarSiEntra(`Recibe: ${recortar(recibidoPor.nombre, 40)}`,
                                `(${identificacion})`, { union: ' ' })
                : []),
        ],
    };
}

/* EL COMPROBANTE DE ENTREGA se quitó el 2026-08-24.
 *
 * Entregar imprimía un papel que firmaban la sala y quien retira. El usuario lo
 * sacó —«ya queda registrado»— y tenía razón: la entrega guarda folio, hora,
 * quién entregó y quién retiró (identificado por su carné contra el servidor), y
 * la recepción la firma después administración. El papel no probaba nada que el
 * registro no probara mejor, y obligaba a la sala a tener ticketera para poder
 * entregar el efectivo del día.
 *
 * Los dos papeles que sí siguen viven en el mundo físico: la ETIQUETA que se
 * pega afuera de la bolsa y el VALE que queda adentro. Ésos son contra lo que
 * administración cuenta, así que no tienen reemplazo digital.
 */
