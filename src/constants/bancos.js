/**
 * Bancos e instituciones financieras de El Salvador — UNA lista.
 *
 * Vivía escrita a mano dentro de `EmployeeFormModal` (`BANKS_OPTIONS`) para la
 * cuenta de planilla. Se mudó acá el 2026-10-14 porque la orden de descuento
 * también necesita «qué banco», y dos listas escritas a mano divergen
 * (`feedback_lista_a_mano_se_desincroniza_del_registro`).
 *
 * ⚠️ El `value` ES el dato: `employees.bank_name` y `ordenes_descuento.banco`
 * guardan este texto. Cambiar un `value` existente exige migración; agregar
 * uno no. Los diez primeros son, palabra por palabra, los de antes (en
 * producción hay 9 fichas con «Banco Davivienda»).
 *
 * Los que se agregaron son los que otorgan préstamos por orden de descuento
 * —bancos, bancos cooperativos y sociedades de ahorro y crédito—, que es
 * justamente de donde vienen esas órdenes.
 */
export const BANCOS = [
    { value: 'Banco Agrícola', label: 'Banco Agrícola' },
    { value: 'Banco Cuscatlán', label: 'Banco Cuscatlán' },
    { value: 'BAC Credomatic', label: 'BAC Credomatic' },
    { value: 'Banco Davivienda', label: 'Banco Davivienda' },
    { value: 'Banco Promerica', label: 'Banco Promerica' },
    { value: 'Banco Hipotecario', label: 'Banco Hipotecario' },
    { value: 'Banco de Fomento Agropecuario', label: 'Banco Fomento Agropecuario' },
    { value: 'Banco Azul', label: 'Banco Azul' },
    { value: 'Banco Industrial', label: 'Banco Industrial' },
    { value: 'Sistema Fedecrédito', label: 'Sistema Fedecrédito' },
    // ── 2026-10-14 ──
    { value: 'Banco Atlántida', label: 'Banco Atlántida' },
    { value: 'Banco Abank', label: 'Banco Abank' },
    { value: 'Mi Banco', label: 'Mi Banco' },
    { value: 'Primer Banco de los Trabajadores', label: 'Primer Banco de los Trabajadores' },
    { value: 'Banco Izalqueño de los Trabajadores', label: 'Banco Izalqueño de los Trabajadores' },
    { value: 'Banco Cooperativo Visionario (Bancovi)', label: 'Bancovi' },
    { value: 'Comedica', label: 'Comedica' },
    { value: 'ACCOVI', label: 'ACCOVI' },
    { value: 'Credicomer', label: 'Credicomer' },
    { value: 'Óptima Servicios Financieros', label: 'Óptima' },
    { value: 'Apoyo Integral', label: 'Apoyo Integral' },
    { value: 'Caja de Crédito', label: 'Caja de Crédito (Fedecrédito)' },
    { value: 'Otro', label: 'Otro...' },
];

const normal = (t) => String(t ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

// Palabras que identifican al banco aunque el papel lo escriba distinto
// («BANCO DAVIVIENDA SALVADOREÑO, S.A.», «DAVIVIENDA»). Van de la más
// específica a la más general: «PRIMER BANCO DE LOS TRABAJADORES» no puede
// caer en un genérico «BANCO».
const PISTAS = [
    ['DAVIVIENDA', 'Banco Davivienda'],
    ['AGRICOLA', 'Banco Agrícola'],
    ['CUSCATLAN', 'Banco Cuscatlán'],
    ['CREDOMATIC', 'BAC Credomatic'],
    // BAC = Banco de América Central: el mismo.
    ['AMERICA CENTRAL', 'BAC Credomatic'],
    ['BAC', 'BAC Credomatic'],
    ['PROMERICA', 'Banco Promerica'],
    ['HIPOTECARIO', 'Banco Hipotecario'],
    ['FOMENTO AGROPECUARIO', 'Banco de Fomento Agropecuario'],
    ['ATLANTIDA', 'Banco Atlántida'],
    ['ABANK', 'Banco Abank'],
    ['PRIMER BANCO DE LOS TRABAJADORES', 'Primer Banco de los Trabajadores'],
    ['IZALQUENO', 'Banco Izalqueño de los Trabajadores'],
    ['BANCOVI', 'Banco Cooperativo Visionario (Bancovi)'],
    ['VISIONARIO', 'Banco Cooperativo Visionario (Bancovi)'],
    // Multi Inversiones Mi Banco es la razón social de Mi Banco.
    ['MULTI INVERSIONES', 'Mi Banco'],
    ['MI BANCO', 'Mi Banco'],
    ['COMEDICA', 'Comedica'],
    ['ACCOVI', 'ACCOVI'],
    ['CREDICOMER', 'Credicomer'],
    ['OPTIMA', 'Óptima Servicios Financieros'],
    ['APOYO INTEGRAL', 'Apoyo Integral'],
    ['INDUSTRIAL', 'Banco Industrial'],
    ['AZUL', 'Banco Azul'],
    ['FEDECREDITO', 'Sistema Fedecrédito'],
    ['CAJA DE CREDITO', 'Caja de Crédito'],
];

/**
 * El banco del catálogo que nombra un texto leído de un papel, o `null`.
 * Nunca inventa: sin pista reconocible devuelve `null` y la persona elige.
 */
export function bancoDelTexto(texto) {
    const t = normal(texto);
    if (!t) return null;
    const exacto = BANCOS.find(b => normal(b.value) === t || normal(b.label) === t);
    if (exacto && exacto.value !== 'Otro') return exacto.value;
    for (const [pista, valor] of PISTAS) if (t.includes(pista)) return valor;
    return null;
}
