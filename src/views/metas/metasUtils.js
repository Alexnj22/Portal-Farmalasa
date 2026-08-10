// Utilidades compartidas de Metas: meses en 'YYYY-MM' contados en el DÍA DE
// NEGOCIO de El Salvador (UTC-6 fijo, la misma convención -6h del resto del
// portal) — con la fecha UTC, desde las 18:00 el portal ya estaría "mañana".

export function ymHoySV() {
    const d = new Date(Date.now() - 6 * 3600_000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Día del mes en el mismo huso que `ymHoySV`. Lo usa Confirmación para no
// mostrar el mes siguiente antes de que el portal lo proponga.
export function diaHoySV() {
    return new Date(Date.now() - 6 * 3600_000).getUTCDate();
}

export function ymSumar(ym, meses) {
    const [y, m] = ym.split('-').map(Number);
    const idx = y * 12 + (m - 1) + meses;
    return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

const MESES_LARGO = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export function ymLabel(ym) {
    const [y, m] = ym.split('-').map(Number);
    return `${MESES_LARGO[m - 1]} ${y}`;
}

export function ymLabelCorto(ym) {
    const [y, m] = ym.split('-').map(Number);
    return `${MESES_CORTO[m - 1]} ${y}`;
}

// El primer mes con ventas sincronizadas en el portal.
export const YM_INICIO_HISTORIA = '2025-05';

// Las salas que venden, en el orden del tablero. Es el mismo conjunto que
// `erp_sucursal_map WHERE NOT es_bodega` y que devuelven todos los RPC del
// módulo — Bodega no vende, así que no tiene meta. Vive acá porque lo necesitan
// el módulo Y el widget del Inicio: tenerlo dos veces es tenerlo mal una vez.
export const SALAS_VENTA = [2, 4, 25, 27, 28, 29];

// El histórico agrupado por mes: un punto por mes, sumando las salas que traiga
// `rows` (si la píldora tiene una sala elegida, ya viene recortado y esto suma
// una sola — el mismo código sirve para los dos casos). Sin meta no hay
// cumplimiento, así que esas filas no cuentan.
//
// Vive acá y no dentro de `GraficasHistorico` porque es matemática pura y ese
// archivo arrastra `recharts` (95 kB gzip) del otro lado de un `import()`. Quien
// llama necesita saber CUÁNTOS meses quedan para decidir si vale la pena bajar
// el gráfico: con el cálculo escondido detrás de la librería, esa pregunta no se
// puede hacer sin bajarla, que es justo lo que se quiere evitar.
export function agruparHistoricoPorMes(rows, meses = 12) {
    const porMes = new Map();
    for (const r of rows || []) {
        if (r.monto_meta == null) continue;
        const m = porMes.get(r.year_month) || { ym: r.year_month, meta: 0, venta: 0 };
        m.meta += Number(r.monto_meta);
        m.venta += Number(r.venta_total || 0);
        porMes.set(r.year_month, m);
    }
    return [...porMes.values()]
        .sort((a, b) => a.ym.localeCompare(b.ym))
        .slice(-meses)
        .map((m) => ({
            ...m,
            mes: ymLabelCorto(m.ym),
            pct: m.meta > 0 ? Math.round((m.venta / m.meta) * 1000) / 10 : null,
        }));
}

// Config del tramo → cómo se pinta y cómo se llama. El texto habla del negocio,
// nunca de la tubería.
//
// **Dos juegos de nombres, y el que manda es si el bono está activo ESE mes**
// (regla del usuario, 2026-08-10). Con las bonificaciones apagadas la pantalla
// no puede nombrar un bono que nadie va a cobrar: los mismos tres tramos —que
// no son del bono, son de la meta— se llaman por lo único que sigue siendo
// cierto. `medio` no lo dictó el usuario; es el tramo del 95%, o sea «llegó
// cerca», y se llama así.
//
// El color y el umbral NO cambian: es el mismo semáforo con otro rótulo.
export const TRAMO_CFG = {
    completo: { label: 'Bono completo', sinBono: 'Meta completa', variante: 'success', textCls: 'text-success-text' },
    medio:    { label: 'Medio bono',    sinBono: 'Casi la meta',  variante: 'warning', textCls: 'text-warning-text' },
    nada:     { label: 'Sin bono',      sinBono: 'Sin meta',      variante: 'danger',  textCls: 'text-danger-text' },
};

/** El nombre del tramo según haya bono o no. `tramo` puede venir vacío. */
export function tramoLabel(tramo, bonoActivo) {
    const cfg = TRAMO_CFG[tramo];
    if (!cfg) return null;
    return bonoActivo ? cfg.label : cfg.sinBono;
}
