/**
 * Las reglas del contrato que el portal tiene que conocer.
 *
 * Todo lo de acá sale del Código de Trabajo verificado el 2026-08-26 contra el
 * texto publicado por la Asamblea Legislativa, no de memoria. Cada función dice
 * su artículo.
 */

/** Art. 18: el tercer ejemplar va al Ministerio dentro de los OCHO días. */
export const PLAZO_MTPS_DIAS = 8;

/**
 * ¿Es un contrato CIVIL y no laboral?
 *
 * Servicios profesionales es un contrato civil. La diferencia no es de
 * vocabulario: arrastra que no haya jornada, ni ISSS ni AFP patronal, ni
 * aguinaldo, ni vacaciones, ni indemnización; que se retenga el 10% de renta; y
 * que **no se remita al Ministerio de Trabajo** — el Art. 18 es para contratos
 * DE TRABAJO.
 */
export const esContratoCivil = (tipo) => tipo === 'SERVICIOS';

/**
 * Art. 20: se PRESUME contrato de trabajo con prestar servicios más de dos días
 * consecutivos, o probando subordinación aunque sea menos tiempo.
 *
 * Por eso fijarle jornada a alguien por servicios profesionales es escribir el
 * indicio de subordinación dentro del propio contrato. La pantalla lo advierte;
 * no lo bloquea, porque quién es subordinado y quién no es una decisión de la
 * empresa y de su abogado, no del formulario.
 */
export const ART20_ADVERTENCIA =
    'Servicios profesionales es un contrato civil, no laboral. El Art. 20 presume ' +
    'contrato de trabajo con prestar servicios más de dos días seguidos o probando ' +
    'subordinación: si esta persona cumple horario en la sala y tiene jefe, la figura ' +
    'correcta es un contrato de trabajo.';

/** Fecha local a partir de 'YYYY-MM-DD'. Nunca `new Date(cadena)`: se lee como
 *  UTC y en El Salvador retrocede un día. */
function fechaLocal(iso) {
    if (!iso) return null;
    const [y, m, d] = String(iso).split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
}

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Estado de la remisión al Ministerio de Trabajo.
 *
 * `aplica` es lo primero que hay que mirar: un contrato civil no se remite, y
 * un contrato sin fecha de firma todavía no empezó a contar. Devolver
 * `diasRestantes: 8` para un contrato de servicios profesionales sería inventar
 * una obligación que no existe.
 *
 * El plazo cuenta desde la CELEBRACIÓN (Art. 18), que no es la fecha de inicio
 * de labores: se firma un día y se empieza otro.
 */
export function estadoRemisionMtps(datos, hoy = new Date()) {
    const tipo = datos?.contract_type;
    const firma = fechaLocal(datos?.contrato_fecha_celebracion);

    if (esContratoCivil(tipo)) {
        return { aplica: false, motivo: 'Un contrato de servicios profesionales es civil: no se remite al Ministerio de Trabajo.' };
    }
    if (!firma) {
        return { aplica: false, motivo: 'El plazo empieza a contar desde la fecha de la firma.' };
    }
    if (datos?.mtps_remitido_fecha) {
        return { aplica: true, remitido: true, fecha: datos.mtps_remitido_fecha };
    }

    const limite = new Date(firma.getTime() + PLAZO_MTPS_DIAS * DIA_MS);
    const cero = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    const dias = Math.round((limite - cero) / DIA_MS);

    return {
        aplica: true,
        remitido: false,
        diasRestantes: dias,
        vencido: dias < 0,
        limite: `${limite.getFullYear()}-${String(limite.getMonth() + 1).padStart(2, '0')}-${String(limite.getDate()).padStart(2, '0')}`,
    };
}

/**
 * Art. 126 — formas de estipulación del salario.
 *
 * No es una etiqueta: el Art. 130 hace depender de ella CUÁNDO el pago se
 * vuelve exigible. Por eso cada opción lleva su plazo en la descripción — es el
 * dato que la vuelve una decisión y no un desplegable más.
 */
export const FORMA_ESTIPULACION_OPTIONS = [
    { value: 'TIEMPO',   label: 'Por unidad de tiempo' },
    { value: 'OBRA',     label: 'Por unidad de obra' },
    { value: 'MIXTO',    label: 'Sistema mixto' },
    { value: 'TAREA',    label: 'Por tarea' },
    { value: 'COMISION', label: 'Por comisión' },
];

/** Cuándo se vuelve exigible el pago, según la estipulación (Art. 130). */
export const PLAZO_DE_PAGO = {
    TIEMPO:   'Al vencer el período (semana, quincena o mes), o el día hábil anterior.',
    OBRA:     'Dentro de los dos días siguientes a la entrega o el recuento.',
    MIXTO:    'Dentro de los dos días siguientes a la entrega o el recuento.',
    TAREA:    'Dentro de los dos días siguientes a la entrega o el recuento.',
    COMISION: 'Al liquidar, y la liquidación se hace por lo menos cada quince días.',
};

/**
 * Art. 120 y Art. 30 nº9. Dos opciones y ninguna es un vale: la ley exige
 * moneda de curso legal y prohíbe expresamente fichas, vales, pagarés y
 * cupones. Un catálogo que incluye lo prohibido invita a elegirlo.
 */
/**
 * ── El lugar de pago NO es texto libre ──────────────────────────────────────
 *
 * El Art. 23 nº 9 exige que el contrato escrito diga «Forma, período y **lugar**
 * de pago» — las tres, y sin excepción por el medio: también cuando se paga por
 * transferencia. Y el Art. 128 dice de dónde sale ese lugar:
 *
 *   «El salario debe pagarse en el lugar convenido o en el establecido por el
 *    REGLAMENTO INTERNO DE TRABAJO y, a falta de estipulación, en el
 *    acostumbrado o donde el trabajador preste sus servicios.»
 *
 * El reglamento interno de esta empresa ya lo estableció. Art. 40, aprobado por
 * la Dirección General de Trabajo (`docs/legal/REGLAMENTO INTERNO...`):
 *
 *   «…será cancelado los días quince y último de cada mes, en las OFICINAS DE LA
 *    EMPRESA o en su LUGAR DE TRABAJO.»
 *
 * O sea que el lugar no se inventa por persona: son esos dos. Un campo de texto
 * libre invita a escribir un tercero, y un contrato que estipule un lugar que el
 * reglamento no contempla se contradice con el documento que la empresa ya tiene
 * aprobado.
 *
 * ── Y el lugar equivocado no es un detalle ──────────────────────────────────
 *
 * Art. 129: está prohibido pagar en centros de vicio, lugares de recreo,
 * expendios de bebidas embriagantes y **tiendas de ventas al por menor**, «a no
 * ser que se trate de los trabajadores de esos establecimientos» — que es
 * justamente el caso de una sala. La sanción es dura: «El pago efectuado en
 * contravención a lo dispuesto en el inciso anterior, SE TENDRÁ POR NO HECHO.»
 */
export const LUGAR_PAGO_OPTIONS = [
    { value: 'LUGAR_TRABAJO', label: 'En su lugar de trabajo' },
    { value: 'OFICINAS',      label: 'En las oficinas de la empresa' },
];

/** Lo que el reglamento interno ya dejó dicho, para mostrarlo al elegir. */
export const REGLAMENTO_LUGAR_PAGO =
    'El reglamento interno ya lo fija: se paga los días quince y último de cada mes, '
    + 'en las oficinas de la empresa o en su lugar de trabajo.';

export const MEDIO_PAGO_OPTIONS = [
    { value: 'EFECTIVO',      label: 'Efectivo' },
    { value: 'TRANSFERENCIA', label: 'Transferencia o depósito' },
];
