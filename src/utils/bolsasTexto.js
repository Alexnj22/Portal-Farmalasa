import { fechaTexto } from './fecha';

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
