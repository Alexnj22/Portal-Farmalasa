/**
 * formatNumber — el formato canónico de toda cifra que ve el usuario.
 *
 * Existe porque no existía. Al medirlo (2026-07-29, F1 de
 * `docs/PLAN-IDENTIDAD-2026-07-29.md`) el portal tenía **50 `toFixed(2)`**,
 * **15 combinaciones distintas de opciones `Intl`** y **4 locales** en uso
 * (`es-SV` 89, `es` 69, `es-ES` 20, `en-US` 17, más un `es-VE` suelto). Y las
 * locales no son intercambiables:
 *
 *     es-SV   1,234.56      ← la convención de El Salvador
 *     en-US   1,234.56
 *     es      1234,56       ← coma decimal, SIN separador de miles
 *     es-ES   1234,56
 *     es-VE   1.234,56      ← punto de miles + coma decimal
 *
 * Entonces el Dashboard mostraba `$1234,56` (seis lugares, incluidos los KPI
 * "Monto cotizado" y "Facturado hoy") y EmployeeAnnouncementsView `$1.234,56`,
 * mientras el resto del portal mostraba `$1,234.56`. El mismo monto se veía
 * distinto según la pantalla.
 *
 * **El locale es fijo `es-SV`, no se hereda del navegador.** El portal es de un
 * solo país: un navegador configurado en `es-ES` no debería cambiarle los
 * separadores al ERP entero.
 *
 * Nulo → `'—'`, nunca `'$NaN'`. Antes cada sitio resolvía el nulo a su manera y
 * había `$NaN` alcanzable.
 *
 * Lo que NO pasa por acá (y por eso el gate `formato-cifra` los excepciona con
 * su motivo): las cifras destinadas a una máquina — `csvExport.js`, el archivo
 * de banco de `PayrollView`, el ancho CSS de `StockBar` — donde un separador de
 * miles rompe el consumidor. Y `toFixed()` usado para **redondear** (`round2`)
 * no es formato, es cálculo: se queda.
 *
 * Mesa de pruebas:
 *
 *     formatMoney(1234.5)        → '$1,234.50'
 *     formatMoney(1234.5, {decimales: 0}) → '$1,235'
 *     formatMoney(0)             → '$0.00'
 *     formatMoney(-89.9)         → '-$89.90'
 *     formatMoney(1234.5, {signo: false}) → '1,234.50'
 *     formatMoney(null)          → '—'
 *     formatMoney('abc')         → '—'
 *     formatQty(18364)           → '18,364'
 *     formatQty(2.5, {decimales: 2}) → '2.50'
 *     formatPct(12.34)           → '12.3%'
 */

const LOCALE = 'es-SV';
const VACIO = '—';

/** Un número usable, o null. Cubre null, undefined, '', NaN e Infinity. */
const aNumero = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
};

const conSeparador = (n, decimales) =>
    n.toLocaleString(LOCALE, {
        minimumFractionDigits: decimales,
        maximumFractionDigits: decimales,
    });

/** Hasta `max` decimales, recortando los ceros de la derecha: 2.5 → '2.5'. */
const hastaDecimales = (n, max) =>
    n.toLocaleString(LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: max });

/**
 * Monto en dólares. `$1,234.56`
 *
 * El signo negativo va ANTES del `$` (`-$89.90`): es como lo escribe la
 * convención local y como lo lee un contador, no `$-89.90`.
 *
 * @param {number|string|null} valor
 * @param {{decimales?: number, signo?: boolean, vacio?: string}} [opts]
 *        `signo: false` omite el `$` (para una columna que ya lo dice en el
 *        encabezado). `vacio` cambia el placeholder del nulo.
 */
export const formatMoney = (valor, { decimales = 2, signo = true, vacio = VACIO } = {}) => {
    const n = aNumero(valor);
    if (n === null) return vacio;
    const cuerpo = conSeparador(Math.abs(n), decimales);
    const menos = n < 0 ? '-' : '';
    return signo ? `${menos}$${cuerpo}` : `${menos}${cuerpo}`;
};

/**
 * Cantidad de unidades. `18,364`
 *
 * Por defecto sin decimales: casi todo lo que se cuenta en el portal son
 * unidades enteras. Con `decimales` para las velocidades (`2.50 und/día`).
 *
 * `decimalesMax` es el otro caso que ya existía disperso: **hasta** N decimales,
 * recortando los ceros de la derecha (`2.5` sale `2.5`, no `2.50`). Lo usan las
 * columnas de cantidad donde el factor de presentación da fracciones — forzar
 * dos decimales ahí llenaría la columna de `.00` inútiles.
 *
 * @param {number|string|null} valor
 * @param {{decimales?: number, decimalesMax?: number, vacio?: string}} [opts]
 */
export const formatQty = (valor, { decimales = 0, decimalesMax, vacio = VACIO } = {}) => {
    const n = aNumero(valor);
    if (n === null) return vacio;
    return decimalesMax !== undefined ? hastaDecimales(n, decimalesMax) : conSeparador(n, decimales);
};

/**
 * Monto abreviado para una celda angosta. `$1.25M` · `$450k` · `$5.4k` · `$89.90`
 *
 * Existía dos veces, y **distinto**: `TabSinVenta` y `tabminmax/helpers` tenían
 * la misma escalera copiada, pero a la de `TabSinVenta` le faltaba el peldaño de
 * los miles. O sea que $5,400 salía `$5.4k` en MIN·MAX y `$5,400.00` en Sin
 * Venta. Es la escalera completa la que queda.
 *
 * @param {number|string|null} valor
 * @param {{vacio?: string}} [opts]
 */
export const formatMoneyCorto = (valor, { vacio = VACIO } = {}) => {
    const n = aNumero(valor);
    if (n === null) return vacio;
    const abs = Math.abs(n);
    const menos = n < 0 ? '-' : '';
    if (abs >= 1_000_000) return `${menos}$${hastaDecimales(abs / 1_000_000, 2)}M`;
    if (abs >= 100_000)   return `${menos}$${hastaDecimales(Math.round(abs / 1_000), 0)}k`;
    if (abs >= 1_000)     return `${menos}$${hastaDecimales(abs / 1_000, 1)}k`;
    return formatMoney(n);
};

/**
 * Porcentaje ya calculado. `formatPct(12.34)` → `'12.3%'`
 *
 * Recibe el número tal como se muestra (12.34), no la fracción (0.1234).
 *
 * @param {number|string|null} valor
 * @param {{decimales?: number, vacio?: string}} [opts]
 */
export const formatPct = (valor, { decimales = 1, vacio = VACIO } = {}) => {
    const n = aNumero(valor);
    if (n === null) return vacio;
    return `${conSeparador(n, decimales)}%`;
};
