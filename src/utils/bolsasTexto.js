import { diasEntre, fechaTexto, hoySV } from './fecha';

/* ── El rango de días que cubre una tanda, dicho corto ──────────────────────
 *
 * Vive acá y no en `ConteosDeBolsas` porque lo leen los DOS lados —la tabla de
 * conteos y la ranura de la píldora, que la arma `CircuitoDeBolsas`— y ese
 * componente se carga en diferido: importarlo desde el motor para sacar una
 * función de tres líneas rompería el corte del bundle.
 *
 * Un solo día se dice «17 ago» y no «17 ago → 17 ago», que sería decir dos
 * veces lo mismo.
 */
export const rangoDeDias = (desde, hasta) => {
    if (!desde) return '—';
    const corto = (f) => fechaTexto(f, { day: 'numeric', month: 'short' });
    return desde === hasta ? corto(desde) : `${corto(desde)} → ${corto(hasta)}`;
};

/* ── La bitácora de una bolsa, dicha en palabras ────────────────────────────
 *
 * Vive acá y no en `DetalleDeBolsa` porque la app nativa pinta la misma
 * bitácora: un rótulo escrito dos veces se queda viejo en una de las dos, y la
 * acción sin rótulo sale en CÓDIGO («DEPOSITAR», «CORTE_DESCARTADO»), que es
 * jerga de la tubería en la única pantalla donde alguien lee qué le pasó a ese
 * dinero. Los porqués de cada rótulo están junto al detalle del portal.
 */
export const ACCION_DE_BOLSA = {
    CREAR: 'Se guardó', SALIDA: 'Salió dinero', REINTEGRO: 'Volvió dinero',
    ABRIR: 'Se abrió', ANULAR_SALIDA: 'Se anuló una salida',
    ENTREGAR: 'Se entregó', RECIBIR: 'Se recibió', CONTAR: 'Se contó',
    RESOLVER: 'Se resolvió la diferencia', ANULAR: 'Se anuló la bolsa',
    DEPOSITAR: 'Se depositó', REABRIR: 'Se reabrió',
    REGULARIZAR: 'Se regularizó',
    CORTE_DESCARTADO: 'El corte se descartó',
    REAJUSTAR: 'Se corrigió el monto',
};

/** Cómo se identificó quien recibió el dinero de una salida. */
export const COMO_SE_IDENTIFICO = { CARNE: 'carné escaneado', CLAVE: 'usuario y contraseña' };

/** A partir de cuántos días una bolsa pendiente es alarma. */
export const DIAS_DE_ALARMA_BOLSA = 4;

/**
 * La bolsa más vieja de lo que sigue pendiente (en la sala, en camino o por
 * contar) y cuántos días lleva. La antigüedad se cuenta desde la fecha del
 * CORTE, que es cuando ese efectivo dejó de estar en la caja.
 *
 * @returns {{ bolsa, dias }}  `bolsa` null si no hay pendientes
 */
export function laMasVieja(pendientes, hoy = hoySV()) {
    const bolsa = (pendientes || []).reduce(
        (peor, b) => (peor && String(peor.fecha) <= String(b.fecha) ? peor : b), null);
    return { bolsa, dias: bolsa ? Math.max(0, diasEntre(bolsa.fecha, hoy)) : 0 };
}
