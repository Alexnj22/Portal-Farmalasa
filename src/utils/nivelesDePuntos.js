// Las cuentas de las pestañas Niveles y Premios de Puntos (2026-10-19 en el
// portal; al núcleo el 2026-10-22 para que la app del personal diga y calcule
// EXACTAMENTE lo mismo). Sin pantalla: rótulos, la forma de un premio del
// raspable, qué cambió en un nivel, cuánto cuesta en promedio un raspable, qué
// le falta a un regalo para guardarse. La base vuelve a validar todo
// (`puntos_premios_validos`, la escalera de niveles, los rangos): esto sólo
// evita viajes que van a volver con error.
import { formatMoney, formatQty } from './formatNumber';

// 100 puntos = US$1.00 (cláusula 4 del reglamento).
export const dolaresDePremio = (puntos) => formatMoney((Number(puntos) || 0) / 100);
const pts = (n) => formatQty(Number(n) || 0);
export const numeroONulo = (v) => (v === '' || v == null ? null : Number(v));

/** Los campos que se editan de un nivel, con su rótulo. El orden es el de la tarjeta. */
export const CAMPOS_NIVEL = [
    { key: 'nombre', label: 'Nombre', tipo: 'text' },
    { key: 'desde', label: 'Compra en 12 meses desde', prefix: '$', tipo: 'number', ayuda: 'Todas las facturas válidas, no sólo las que dieron puntos.' },
    { key: 'factor', label: 'Puntos por cada $1', tipo: 'number', ayuda: 'De 1 a 5.' },
    { key: 'puntos_cumpleanos', label: 'Puntos de cumpleaños', tipo: 'number' },
    // Las horas de reserva y los días de anticipo de ofertas por nivel se
    // quitaron el 2026-10-24: el Reglamento v2 no los tiene.
];

export const ROTULO_CAMPO_NIVEL = {
    ...Object.fromEntries(CAMPOS_NIVEL.map((c) => [c.key, c.label])),
    cupon_mensual: 'Raspable sin tabla (puntos)',
    cupon_premios: 'Premios del raspable',
    horas_reserva: 'Horas para retirar una reserva',
    dias_anticipo_ofertas: 'Días antes para ver las ofertas',
    cupon_presupuesto_mensual: 'Tope del raspable al mes (puntos)',
    raspable_presupuesto_usd: 'Tope del raspable al mes',
    niveles_activos: 'Niveles encendidos',
    mayoreo_beneficios_activos: 'Beneficios del Cliente Mayorista',
};

/** Cada premio es de PUNTOS (los de siempre), de PRODUCTO o PROMOCIONAL. */
export const TIPOS_DE_PREMIO = [
    { value: 'puntos', label: 'Puntos' },
    { value: 'producto', label: 'Producto' },
    { value: 'promocional', label: 'Promocional' },
];

/**
 * El cupo del mes de un premio de producto o promocional (2026-10-24): cuántos
 * se pueden dar al mes, en toda la red o en cada sucursal (la sala donde más
 * compra el cliente). Vacío = sin cupo; igual no se da sin existencia.
 */
export const CUPO_POR = [
    { value: 'general', label: 'En toda la red' },
    { value: 'sucursal', label: 'En cada sucursal' },
];

/** «hasta 5 al mes en cada sucursal», o null sin cupo. */
export const cupoTexto = (p) => (Number(p?.cupo) > 0
    ? `hasta ${formatQty(Number(p.cupo))} al mes ${p.cupo_por === 'sucursal' ? 'en cada sucursal' : 'en toda la red'}` : null);

/** Un premio en palabras: «300 pts», «2 × MICROPORE», «Termo Salud». */
export const premioTexto = (p) => (p.tipo === 'producto' ? `${Number(p.cantidad) > 1 ? `${p.cantidad} × ` : ''}${p.nombre}`
    : p.tipo === 'promocional' ? p.nombre : `${pts(p.puntos)} pts`);

/** La tabla de premios en palabras, para el historial. */
export const premiosTexto = (lista) => (Array.isArray(lista) && lista.length
    ? lista.map((p) => `${premioTexto(p)} (${p.peso}${cupoTexto(p) ? `, ${cupoTexto(p)}` : ''})`).join(' · ') : 'ninguno');

const valorTexto = (key, v) => {
    if (key === 'cupon_premios') return premiosTexto(v);
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if ((key === 'cupon_presupuesto_mensual' || key === 'raspable_presupuesto_usd') && v == null) return 'sin tope';
    if (key === 'raspable_presupuesto_usd') return formatMoney(Number(v));
    if (v == null || v === '') return '—';
    if (key === 'desde') return formatMoney(Number(v));
    return String(v);
};

/** Qué cambió entre dos fotos de una fila del historial, en palabras. */
export function diferenciasDeConfig(antes, despues) {
    const claves = new Set([...Object.keys(antes || {}), ...Object.keys(despues || {})]);
    const out = [];
    for (const k of claves) {
        if (['clave', 'orden'].includes(k)) continue;
        const a = antes?.[k]; const d = despues?.[k];
        if (JSON.stringify(a ?? null) === JSON.stringify(d ?? null)) continue;
        out.push(`${ROTULO_CAMPO_NIVEL[k] ?? k}: ${valorTexto(k, a)} → ${valorTexto(k, d)}`);
    }
    return out;
}

/** De qué habla una fila del historial: «Programa», «Nivel Oro», «Mayoreo Jade». */
export function sujetoDelHistorial(h, niveles, mayoreo) {
    if (h.tabla === 'config') return 'Programa';
    const lista = (h.tabla === 'nivel' ? niveles : mayoreo) ?? [];
    const n = lista.find((x) => x.clave === h.clave)?.nombre ?? h.clave;
    return h.tabla === 'nivel' ? `Nivel ${n}` : `Mayoreo ${n}`;
}

export const esRegalo = (p) => p.tipo === 'producto' || p.tipo === 'promocional';

/**
 * Valor esperado de un raspable EN PUNTOS: lo que cuesta en promedio cada uno.
 * Los regalos cuentan como 0 puntos (su costo es de inventario, no de puntos),
 * así que pesan en el total y bajan el promedio.
 */
export function esperadoDelRaspable(premios, defecto) {
    const lista = (premios || []).filter((p) => Number(p.peso) > 0);
    if (!lista.length) return Number(defecto) || 0;
    const total = lista.reduce((a, p) => a + Number(p.peso), 0);
    return lista.reduce((a, p) => a + (esRegalo(p) ? 0 : Number(p.puntos) || 0) * Number(p.peso), 0) / total;
}

/** Qué parte de los raspables sale en regalo, en %. */
export const parteEnRegalos = (premios) => {
    const lista = (premios || []).filter((p) => Number(p.peso) > 0);
    const total = lista.reduce((a, p) => a + Number(p.peso), 0);
    return total ? Math.round((lista.filter(esRegalo).reduce((a, p) => a + Number(p.peso), 0) / total) * 100) : 0;
};

/** «Cada raspable cuesta en promedio …», o null si no cuesta nada. */
export function costoDelRaspableTexto(premiosLimpiosDelForm, defecto) {
    const ev = esperadoDelRaspable(premiosLimpiosDelForm, defecto);
    if (!(ev > 0)) return null;
    const regalo = parteEnRegalos(premiosLimpiosDelForm);
    return `Cada raspable cuesta en promedio ${pts(Math.round(ev))} puntos (${dolaresDePremio(ev)})${regalo > 0 ? ` en puntos; además ${regalo}% de las veces sale un regalo` : ''}.`;
}

/** El % con que sale un premio dentro de su tabla, o '—'. */
export const probabilidadDePremio = (lista, p) => {
    const total = (lista ?? []).reduce((a, x) => a + (Number(x.peso) || 0), 0);
    return total > 0 ? `${Math.round(((Number(p.peso) || 0) / total) * 1000) / 10}%` : '—';
};

/** Un premio guardado → la fila del formulario (todo en texto). */
export const filaDePremio = (p) => ({
    tipo: p.tipo ?? 'puntos', peso: String(p.peso ?? ''), puntos: p.puntos != null ? String(p.puntos) : '',
    product_id: p.product_id ?? null, presentacion_tipo: p.presentacion_tipo ?? '', factor: p.factor ?? null,
    cantidad: p.cantidad != null ? String(p.cantidad) : '1', nombre: p.nombre ?? '', promocional_id: p.promocional_id ?? null,
    cupo: p.cupo != null ? String(p.cupo) : '', cupo_por: p.cupo_por ?? 'general',
});

/** El cupo tal como lo guarda la base: sólo si hay número. */
const cupoLimpio = (p) => (p.cupo === '' || p.cupo == null || !(Number(p.cupo) > 0) ? {}
    : { cupo: Number(p.cupo), cupo_por: p.cupo_por === 'sucursal' ? 'sucursal' : 'general' });

/** El formulario → la lista que guarda la base, sin filas a medio llenar. */
export const premiosLimpios = (lista) => (lista ?? []).flatMap((p) => {
    if (p.peso === '' || p.peso == null) return [];
    const peso = Number(p.peso);
    if ((p.tipo ?? 'puntos') === 'puntos') return p.puntos === '' ? [] : [{ puntos: Number(p.puntos), peso }];
    if (p.tipo === 'producto') {
        if (!p.product_id || !p.presentacion_tipo || !p.factor) return [];
        return [{ tipo: 'producto', product_id: Number(p.product_id), presentacion_tipo: p.presentacion_tipo,
            factor: Number(p.factor), cantidad: Number(p.cantidad) || 1, nombre: p.nombre, peso, ...cupoLimpio(p) }];
    }
    if (p.tipo === 'promocional') {
        if (!p.promocional_id) return [];
        return [{ tipo: 'promocional', promocional_id: Number(p.promocional_id), nombre: p.nombre, peso, ...cupoLimpio(p) }];
    }
    return [];
});

/** Para comparar con lo guardado: la base reordena las claves de cada premio. */
export const premiosCanonicos = (lista) => JSON.stringify((lista ?? []).map((o) => Object.fromEntries(Object.entries(o).sort())));

/** El formulario de un nivel a partir de su fila. */
export const formDeNivel = (nivel) => ({
    ...Object.fromEntries(CAMPOS_NIVEL.map((c) => [c.key, nivel[c.key] == null ? '' : String(nivel[c.key])])),
    cupon_premios: (nivel.cupon_premios ?? []).map(filaDePremio),
    nota: '',
});

/** Lo que cambió en un nivel: sólo eso viaja a `guardarNivelDePuntos`. */
export function cambiosDeNivel(form, nivel, conRaspable) {
    const c = {};
    for (const campo of CAMPOS_NIVEL) {
        const v = campo.tipo === 'number' ? numeroONulo(form[campo.key]) : String(form[campo.key] ?? '').trim();
        const antes = campo.tipo === 'number' ? numeroONulo(nivel[campo.key]) : nivel[campo.key];
        if (v !== antes) c[campo.key] = v;
    }
    if (conRaspable) {
        const p = premiosLimpios(form.cupon_premios);
        if (premiosCanonicos(p) !== premiosCanonicos(nivel.cupon_premios)) c.cupon_premios = p.length ? p : null;
    }
    return c;
}

/** El formulario de un rango de mayoreo a partir de su fila. */
export const formDeRango = (rango) => ({
    puntos_cumpleanos: String(rango.puntos_cumpleanos ?? 0),
    cupon_premios: (rango.cupon_premios ?? []).map(filaDePremio),
    nota: '',
});

/** Lo que cambió en un rango: sólo eso viaja a `guardarRangoMayoreoDePuntos`. */
export function cambiosDeRango(form, rango, conRaspable) {
    const c = {};
    if (numeroONulo(form.puntos_cumpleanos) !== Number(rango.puntos_cumpleanos)) c.puntos_cumpleanos = numeroONulo(form.puntos_cumpleanos);
    if (conRaspable) {
        const p = premiosLimpios(form.cupon_premios);
        if (premiosCanonicos(p) !== premiosCanonicos(rango.cupon_premios)) c.cupon_premios = p.length ? p : null;
    }
    return c;
}

/**
 * Desde el 2026-10-24 los niveles y los beneficios del Cliente Mayorista ya no
 * se encienden a mano: rigen desde `reglas_v2_desde()` (2026-11-15), la fecha
 * del Reglamento v2. Esto lo dice en palabras.
 */
export function vigenciaDelReglamentoTexto(config, hoy = new Date()) {
    const desde = config?.reglas_v2_desde;
    if (!desde) return null;
    const [a, m, d] = String(desde).slice(0, 10).split('-').map(Number);
    const fecha = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${a}`;
    const vigente = config?.v2_vigente ?? (hoy >= new Date(a, m - 1, d));
    return vigente
        ? `Rigen desde el ${fecha}: cada cliente está en el nivel de su compra de 12 meses, y el Cliente Mayorista recibe lo de su rango.`
        : `Rigen desde el ${fecha}, con el reglamento nuevo. Hasta entonces todos están en el nivel de entrada y no hay raspable.`;
}

/** «Este mes van $13.00 de $150.00.» — el tope del raspable en dólares. */
export function usoDelTopeTexto(config, usadoUsd) {
    const usado = formatMoney(Number(usadoUsd) || 0);
    const tope = config?.raspable_presupuesto_usd;
    return tope == null ? `Sin tope. Este mes van ${usado}.` : `Este mes van ${usado} de ${formatMoney(Number(tope))}.`;
}

// ── Premios del raspable que no son puntos (pestaña Premios) ────────────────

/** Estado de un premio por entregar, con la variante de su insignia. */
export const ESTADO_DE_PREMIO = {
    POR_RETIRAR: { texto: 'Por retirar', variante: 'info' },
    ENTREGANDO: { texto: 'Entregándose', variante: 'warning' },
    ENTREGADO: { texto: 'Entregado', variante: 'success' },
    VENCIDO: { texto: 'Vencido', variante: 'neutral' },
};

/**
 * Dónde se retira un premio (2026-10-20: en CUALQUIER sucursal). Un regalo
 * apartado se retira en la suya; uno pedido espera el envío.
 */
export const dondeSeRetiraElPremio = (p, nombreSala) => (p.reserva_branch ? `Apartado en ${nombreSala(p.reserva_branch)}`
    : p.espera_envio ? `Pedido para ${nombreSala(p.branch_id)} · esperando el envío`
        : p.estado === 'ENTREGADO' ? `Entregado en ${nombreSala(p.entregado_branch)}`
            : 'Se retira en cualquier sucursal');

/** «PS-000123 · Producto · CAJA · Raspable Oro». */
export const detalleDelPremio = (p) => `${p.codigo} · ${p.tipo === 'producto' ? `Producto${p.presentacion ? ` · ${p.presentacion}` : ''}` : 'Regalo promocional'}${p.nivel ? ` · Raspable ${p.nivel}` : ''}`;

export const TITULO_DIALOGO_REGALO = { nuevo: 'Nuevo regalo', editar: 'Editar regalo', entrada: 'Entrada o ajuste', enviar: 'Enviar a una sucursal' };

/** Qué le falta al formulario de un regalo promocional para guardarse, o null. */
export function faltaEnRegalo(modo, f) {
    const n = Number(f.cantidad);
    if (modo === 'nuevo' || modo === 'editar') return String(f.nombre ?? '').trim().length < 2 ? 'Escribe el nombre.' : null;
    if (modo === 'entrada') {
        return !f.sala ? 'Elige la sucursal.' : !Number.isInteger(n) || n === 0 ? 'Escribe la cantidad (negativa para restar).'
            : n < 0 && String(f.nota ?? '').trim().length < 3 ? 'Para restar, di por qué.' : null;
    }
    return !f.sala || !f.hacia ? 'Elige de dónde y a dónde.' : String(f.sala) === String(f.hacia) ? 'Tienen que ser sucursales distintas.'
        : !Number.isInteger(n) || n <= 0 ? 'Escribe cuántos se mandan.' : null;
}
