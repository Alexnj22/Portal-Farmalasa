// Extracted from TabMinMax.jsx (Bloque 6.C) — shared by the main tab and its
// extracted sub-components, kept here so neither side duplicates the other.

// Normalize legacy demand_variability values → X/Y/Z
export const normXyz = (v) => ({ stable: 'X', moderate: 'Y', erratic: 'Z' }[v] ?? v ?? 'X');
import { formatMoneyCorto } from '../../../utils/formatNumber';

// `translateDbError` vivía acá y se eliminó el 2026-08-01: sus 7 reglas se
// mudaron a `utils/errorMessages`, que es el único traductor del portal.
//
// El motivo de mudarlas y no dejarlas: terminaba en `return msg` — cuando NO
// reconocía el error, mostraba el texto crudo de Postgres. Que es justo el caso
// donde el texto es peor, porque un error no previsto es el que trae nombres de
// función y volcados HTML. Un traductor cuyo último renglón es "y si no,
// mostralo tal cual" no traduce: pospone la fuga.

// Riesgo de regla de despacho: el MAX efectivo (publicado + manual), llevado
// a la unidad de despacho del producto (factor de presentación de la regla ×
// múltiplo), redondea a 0 incluso en el mejor caso posible (repunte completo
// desde stock 0 hasta MAX). Si eso pasa, este producto NUNCA va a generar un
// pedido real con su MIN/MAX actual — hay que bajarlo a 0/0 o subir el MAX
// para que supere el umbral. Mismo umbral del 40% que usa get_pedido_preview
// para decidir si reponer una unidad completa. Solo aplica a productos con
// regla de despacho explícita (dispatch_pres_factor no nulo) — el resto no
// se marca. Se calcula al vuelo con datos que ya trae get_stock_analysis,
// sin tocar la RPC.
export function hasDispatchRisk(maxValue, dispatchPresFactor, dispatchMultiplo) {
    if (!dispatchPresFactor || !maxValue || maxValue <= 0) return false;
    const unitBase = dispatchPresFactor * (dispatchMultiplo || 1);
    if (!unitBase) return false;
    const whole = Math.floor(maxValue / unitBase);
    const remainder = maxValue % unitBase;
    const rounded = whole + (remainder >= 0.4 * unitBase ? 1 : 0);
    return rounded === 0;
}

export const fmtMoney = (n) => formatMoneyCorto(n ?? 0);

export function sortedPres(presentations) {
    return [...new Map((presentations || []).map(p => [p.factor, p])).values()]
        .filter(p => p.factor > 1).sort((a, b) => b.factor - a.factor);
}

export function smallestPres(presentations) {
    const all = presentations || [];
    const unit = all.find(p => p.factor === 1);
    return unit ?? ([...all].sort((a, b) => a.factor - b.factor)[0] ?? null);
}

export function formatUnits(units, presentations) {
    const n = Number(units);
    if (n === 0) return '0';
    const pres = sortedPres(presentations);
    if (!pres.length) return `${n.toLocaleString()} und`;
    let rem = n;
    const parts = [];
    for (const { tipo, factor } of pres) {
        if (rem >= factor) { parts.push(`${Math.floor(rem / factor)} ${tipo.trim()}`); rem %= factor; }
    }
    if (rem > 0) parts.push(`${rem} und`);
    return parts.length ? parts.join(' + ') : `${n.toLocaleString()} und`;
}

export function formatDominant(units, presentations) {
    const n = Number(units);
    if (!n) return '0';
    const pres = sortedPres(presentations);
    if (!pres.length) return `${n.toLocaleString()} und`;
    const { tipo, factor } = pres[0];
    // ceil: boxes are indivisible — always round up so the displayed quantity covers the unit threshold
    return `≥${Math.ceil(n / factor)} ${tipo.trim()}`;
}

/**
 * El MÁX más chico que hace que la regla de despacho se pueda cumplir.
 *
 * `hasDispatchRisk` dice que el par NO alcanza; esto dice hasta dónde hay que
 * subirlo. El umbral es el mismo 40% de `get_pedido_preview`: con el stock en
 * cero, el pedido redondea a una unidad de despacho recién cuando el MÁX llega
 * al 40% del paquete. Se usa `ceil` porque un MÁX es entero y quedarse un
 * decimal abajo deja el producto exactamente igual de trabado.
 *
 * El MÍN acompaña: se conserva la proporción del par que ya existía —quien puso
 * 3·6 quería la mitad— y nunca queda por encima del MÁX nuevo menos uno, que es
 * lo que exige `chk_min_lt_max`.
 */
export function sugerenciaParaLaRegla(minActual, maxActual, dispatchPresFactor, dispatchMultiplo) {
    const paquete = Number(dispatchPresFactor || 0) * Number(dispatchMultiplo || 1);
    if (!paquete) return null;
    const maxNuevo = Math.max(1, Math.ceil(0.4 * paquete));
    const proporcion = maxActual > 0 ? Number(minActual || 0) / Number(maxActual) : 0.5;
    const minNuevo = Math.min(
        Math.max(0, Math.round(maxNuevo * proporcion)),
        Math.max(0, maxNuevo - 1),
    );
    return { paquete, minNuevo, maxNuevo };
}
