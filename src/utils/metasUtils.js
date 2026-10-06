import { relojSV } from './fecha';
// Utilidades compartidas de Metas: meses en 'YYYY-MM' contados en el DÍA DE
// NEGOCIO de El Salvador (UTC-6 fijo, la misma convención -6h del resto del
// portal) — con la fecha UTC, desde las 18:00 el portal ya estaría "mañana".

export function ymHoySV() {
    const d = relojSV();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Día del mes en el mismo huso que `ymHoySV`. Lo usa Confirmación para no
// mostrar el mes siguiente antes de que el portal lo proponga.
export function diaHoySV() {
    return relojSV().getUTCDate();
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

/**
 * Las cifras de arriba del tablero: la meta y lo vendido SÓLO de las salas con
 * meta (sumar lo vendido de una sin meta inflaría el % de cumplimiento), la
 * proyección, cuántas van en cada tramo y cuántas no tienen meta.
 * (Vivía en `TabTablero`; se mudó el 2026-10-05 para la app.)
 */
export function resumenDeMetas(rows) {
    const conMeta = (rows || []).filter((r) => r.monto_meta != null);
    const tiers = { completo: 0, medio: 0, nada: 0 };
    conMeta.forEach((r) => { if (tiers[r.bono_tier] != null) tiers[r.bono_tier] += 1; });
    return {
        meta: conMeta.reduce((s, r) => s + Number(r.monto_meta), 0),
        vendidoConMeta: conMeta.reduce((s, r) => s + Number(r.venta_acumulada || 0), 0),
        proy: conMeta.reduce((s, r) => s + Number(r.proyeccion || 0), 0),
        tiers,
        conMeta: conMeta.length,
        sinMeta: (rows || []).length - conMeta.length,
    };
}

// ── Semestres del bono ───────────────────────────────────────────────────────
// 'AAAA-S1' = enero–junio, se paga en la 1ª quincena de julio.
// 'AAAA-S2' = julio–diciembre, se paga en la 1ª quincena de enero del año
// siguiente. Regla del usuario, 2026-09-22.
export function semestreDe(ym) {
    const [y, m] = ym.split('-').map(Number);
    return `${y}-S${m <= 6 ? 1 : 2}`;
}

export function semestreSumar(sem, n) {
    const [y, s] = [Number(sem.slice(0, 4)), Number(sem.slice(-1))];
    const idx = y * 2 + (s - 1) + n;
    return `${Math.floor(idx / 2)}-S${(idx % 2) + 1}`;
}

export function semestreLabel(sem) {
    const y = sem.slice(0, 4);
    return sem.endsWith('1') ? `Enero–junio ${y}` : `Julio–diciembre ${y}`;
}

export function semestrePagoLabel(sem) {
    const y = Number(sem.slice(0, 4));
    return sem.endsWith('1') ? `1ª quincena de julio ${y}` : `1ª quincena de enero ${y + 1}`;
}

// ── El mes en curso de una sala (`get_metas_mes_en_curso`) ───────────────────
// Lo que dibujan «Día por día» y el termómetro. Vivía en `GraficaMes`; se mudó
// el 2026-10-06 para que la app dibuje los MISMOS días, el mismo ritmo y el
// mismo tramo proyectado que el portal.
//
// Los días llegan sólo hasta hoy (los que no empezaron no tienen barra: se
// dicen como «días por venir»). Hoy va marcado porque todavía no termina, y NO
// cuenta para «días cerrados por encima del ritmo».
export function resumenDelMesEnCurso(data) {
    const diasMes = Number(data?.dias_mes || 30);
    const diaHoy = Math.min(diasMes, Math.max(1, Number(data?.dia_hoy || diasMes)));
    const porDia = new Map((data?.dias || []).map((d) => [Number(d.dia), d]));
    const dias = Array.from({ length: diaHoy }, (_, i) => {
        const n = i + 1;
        const d = porDia.get(n);
        return { dia: n, venta: d ? Number(d.venta) : null, esHoy: !!d?.es_hoy };
    });
    const ritmo = Number(data?.ritmo_diario || 0);
    const cerrados = dias.filter((d) => d.venta != null && !d.esHoy);
    const meta = Number(data?.meta || 0);
    const acum = Number(data?.acumulado || 0);
    const proy = data?.proyeccion != null ? Number(data.proyeccion) : null;
    const pctProy = meta > 0 && proy != null ? (proy / meta) * 100 : null;
    const diasRestantes = Math.max(0, Number(data?.dias_mes || 0) - Number(data?.dia_hoy || 0) + 1);
    return {
        dias,
        diasMes,
        diaHoy,
        porVenir: Math.max(0, diasMes - diaHoy),
        ritmo,
        cerrados: cerrados.length,
        sobreRitmo: cerrados.filter((d) => d.venta >= ritmo).length,
        meta,
        acum,
        proy,
        pct: meta > 0 ? (acum / meta) * 100 : null,
        pctProy,
        tramoProy: pctProy == null ? null
            : pctProy >= Number(data.umbral_total) ? 'completo'
            : pctProy >= Number(data.umbral_medio) ? 'medio' : 'nada',
        falta: meta - acum,
        diasRestantes,
        porDiaParaLlegar: meta - acum > 0 && diasRestantes > 0 ? (meta - acum) / diasRestantes : null,
        umbralMedio: Number(data?.umbral_medio ?? 95),
        umbralTotal: Number(data?.umbral_total ?? 100),
    };
}

// ── El ranking de vendedores del mes ─────────────────────────────────────────
// Tres maneras de ordenar la MISMA lista. «Por hora» sólo existe cuando TODOS
// tienen horario: con uno sin horas, su venta por hora sería 0 y saldría último
// por un dato que falta, no por vender poco. (Vivía en `RankingVendedores`.)
export const ORDENES_RANKING = [
    { value: 'total', label: 'Total' },
    { value: 'dia',   label: 'Por día' },
    { value: 'hora',  label: 'Por hora' },
];
const CLAVE_RANKING    = { total: 'venta',          dia: 'venta_dia',    hora: 'venta_hora'    };
const PROMEDIO_RANKING = { total: 'promedio_venta', dia: 'promedio_dia', hora: 'promedio_hora' };
export const SUFIJO_RANKING = { total: '', dia: ' por día', hora: ' por hora' };

export function rankingDeVendedores(data, orden = 'total') {
    const horaDisponible = Number(data?.personas || 0) > 0
        && Number(data?.con_horario || 0) === Number(data?.personas);
    const ordenActivo = orden === 'hora' && !horaDisponible ? 'total' : orden;
    const clave = CLAVE_RANKING[ordenActivo];
    const base = (data?.vendedores || []).map((v) => ({
        ...v,
        venta: Number(v.venta),
        ticket: Number(v.ticket),
        dias: Number(v.dias),
        venta_dia: Number(v.venta_dia),
        horas: Number(v.horas || 0),
        dias_horario: Number(v.dias_horario || 0),
        venta_hora: Number(v.venta_hora || 0),
        dias_sin_turno: Number(v.dias_sin_turno || 0),
    }));
    const filas = [...base].sort((a, b) => b[clave] - a[clave]);
    return {
        filas,
        clave,
        ordenActivo,
        horaDisponible,
        promedio: Number(data?.[PROMEDIO_RANKING[ordenActivo]] || 0),
        maximo: filas.length ? filas[0][clave] : 0,
        total: filas.reduce((s, v) => s + v[clave], 0),
    };
}
