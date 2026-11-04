// Saly, ayuda en pantalla (docs/PLAN-SALY-AYUDA-EN-PANTALLA-2026-11-04.md).
//
// Lo que se puede decidir sin la IA se decide ACÁ, y por eso cuesta $0: los
// avisos («veo un faltante») y sus explicaciones salen de los mismos números
// que la pantalla ya muestra. La IA sólo entra cuando alguien escribe una
// pregunta propia (usuario, 2026-11-04: «que Saly no cueste mucho, lo mínimo
// posible»).
//
// Saly no escribe párrafos: arma su respuesta con PIEZAS fijas. Se lee de un
// vistazo y la IA devuelve pocos datos en vez de texto largo. El mismo
// validador corre en la función del servidor (`_shared/salyPiezas.ts`, gemela
// de ésta): si cambia una regla, cambian las dos.

import { formatMoney } from './formatNumber';

export const SALY_TOPE_DIARIO = 30;

/* EN PRUEBA (usuario, 2026-11-04: «que solo salga a Edwin ahorita, lo probaré
 * bien primero»). Las fichas (`employees.id`) que ven la ayuda; `null` = todos.
 * La función `saly-ayuda` tiene la MISMA lista: para abrirla a todos se cambian
 * las dos. */
export const SALY_AYUDA_SOLO_PARA = ['bbc796d7-7435-495b-9306-a2115f44a18f'];   // Edwin Núñez
export const salyAyudaParaMi = (employeeId) =>
    SALY_AYUDA_SOLO_PARA == null || SALY_AYUDA_SOLO_PARA.includes(String(employeeId ?? ''));
export const SALY_MAX_PANTALLA = 3500;
export const SALY_MAX_PREGUNTA = 300;
export const ANIMOS_DE_AYUDA = ['alegria', 'atencion', 'preocupacion', 'pensando'];

const corto = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const tonos = new Set(['mal', 'bien']);

/** Deja sólo las piezas conocidas, con sus topes. Lo que no se entiende se tira. */
export function validarPiezas(lista) {
    if (!Array.isArray(lista)) return [];
    const salida = [];
    for (const p of lista.slice(0, 8)) {
        if (!p || typeof p !== 'object') continue;
        const tono = (t) => (tonos.has(t) ? t : undefined);
        switch (p.tipo) {
            case 'titular':
                if (corto(p.texto, 90)) salida.push({ tipo: 'titular', texto: corto(p.texto, 90), sub: corto(p.sub, 90) || undefined });
                break;
            case 'cifras': {
                const items = (Array.isArray(p.items) ? p.items : []).slice(0, 3)
                    .map((i) => ({ rotulo: corto(i?.rotulo, 18), valor: corto(i?.valor, 14), tono: tono(i?.tono) }))
                    .filter((i) => i.rotulo && i.valor);
                if (items.length) salida.push({ tipo: 'cifras', items });
                break;
            }
            case 'barras': {
                const items = (Array.isArray(p.items) ? p.items : []).slice(0, 5)
                    .map((i) => ({ rotulo: corto(i?.rotulo, 16), valor: Math.abs(Number(i?.valor)) || 0, texto: corto(i?.texto, 12), tono: tono(i?.tono) }))
                    .filter((i) => i.rotulo);
                if (items.length) salida.push({ tipo: 'barras', items });
                break;
            }
            case 'linea': {
                const items = (Array.isArray(p.items) ? p.items : []).slice(0, 4)
                    .map((i) => ({ hora: corto(i?.hora, 12), texto: corto(i?.texto, 30), tono: tono(i?.tono) }))
                    .filter((i) => i.hora);
                if (items.length >= 2) salida.push({ tipo: 'linea', items });
                break;
            }
            case 'pasos':
            case 'chips': {
                const max = p.tipo === 'pasos' ? 4 : 4;
                const items = (Array.isArray(p.items) ? p.items : []).slice(0, max)
                    .map((t) => corto(t, p.tipo === 'pasos' ? 110 : 30)).filter(Boolean);
                if (items.length) salida.push({ tipo: p.tipo, items });
                break;
            }
            case 'nota':
                if (corto(p.texto, 160)) salida.push({ tipo: 'nota', texto: corto(p.texto, 160) });
                break;
            case 'botones': {
                // Sólo rutas internas: un enlace afuera desde una respuesta de la
                // IA sería una puerta que nadie revisó.
                const items = (Array.isArray(p.items) ? p.items : []).slice(0, 2)
                    .map((b) => ({ texto: corto(b?.texto, 28), ir: /^\/[a-z0-9\-/?=&_]*$/i.test(b?.ir || '') ? b.ir : undefined }))
                    .filter((b) => b.texto && b.ir);
                if (items.length) salida.push({ tipo: 'botones', items });
                break;
            }
            default:
        }
    }
    return salida;
}

/* ── Datos personales: se tapan ANTES de que salgan hacia la IA ────────────
 * Decisión del usuario (2026-11-04). DUI, NIT, teléfono, correo y salario. Un
 * nombre de producto o de sala sí viaja: sin él no hay respuesta. */
const PATRONES = [
    [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[correo oculto]'],
    [/\b\d{4}-?\d{6}-?\d{3}-?\d\b/g, '[NIT oculto]'],
    [/\b\d{8}-\d\b/g, '[DUI oculto]'],
    [/(?:\+?503[\s-]?)?\b[267]\d{3}[\s-]?\d{4}\b/g, '[teléfono oculto]'],
    [/((?:salario|sueldo|salary)[^\d$]{0,20})\$?\s?[\d,]+(?:\.\d+)?/gi, '$1[monto oculto]'],
];
export function taparDatosPersonales(texto) {
    let t = String(texto ?? '');
    for (const [re, por] of PATRONES) t = t.replace(re, por);
    return t;
}

/** Huella corta para no volver a pagar la misma pregunta sobre la misma pantalla. */
export function claveDePregunta(modulo, pregunta, pantalla) {
    const s = `${modulo}|${corto(pregunta, SALY_MAX_PREGUNTA).toLowerCase()}|${pantalla}`;
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return `${modulo}:${(h >>> 0).toString(36)}`;
}

const dinero = (v) => formatMoney(Math.abs(Number(v) || 0));
const hora12 = (h) => {
    const [hh, mm] = String(h || '').split(':');
    const n = Number(hh);
    if (!Number.isFinite(n)) return String(h || '');
    return `${((n + 11) % 12) + 1}:${mm || '00'} ${n < 12 ? 'am' : 'pm'}`;
};

/* ── Los avisos que arma el portal ($0) ──────────────────────────────────── */

/**
 * Un corte con faltante en pantalla. `cortes` ya trae `diferencia`, `esperado`
 * y `contado` resueltos por el juez canónico (`diferenciaDelCorte`): acá no se
 * vuelve a calcular nada.
 */
export function avisoDeFaltante(c, { umbral = 1, enMiCaja = false } = {}) {
    if (!c || !(Number(c.diferencia) <= -umbral)) return null;
    const lugar = `${c.sala} · corte de las ${hora12(c.hora)}`;
    return {
        clave: `faltante:${c.id}`,
        animo: 'preocupacion',
        ancla: `corte-${c.id}`,
        oferta: [{ tipo: 'titular', texto: `Veo un faltante de ${dinero(c.diferencia)}`, sub: lugar }],
        explicacion: [
            { tipo: 'titular', texto: `Faltan ${dinero(c.diferencia)} en el cajón`, sub: lugar },
            { tipo: 'cifras', items: [
                { rotulo: 'Esperado', valor: dinero(c.esperado) },
                { rotulo: 'Contado', valor: dinero(c.contado) },
                { rotulo: 'Falta', valor: dinero(c.diferencia), tono: 'mal' },
            ] },
            { tipo: 'pasos', items: [
                'Busca un vale o un pago que no se anotó.',
                enMiCaja ? 'Si lo hay, anótalo aquí en **Hoy**.' : 'Si lo hay, anótalo en **Mi caja**.',
                'Si no aparece, lo decide quien supervisa: eso no lo puedo decidir yo.',
            ] },
            ...(enMiCaja ? [] : [{ tipo: 'botones', items: [{ texto: 'Llévame a Mi caja', ir: `/caja?tab=hoy&sala=${c.branch_id}` }] }]),
        ],
    };
}

/** Entró dinero después del último corte confirmado: el cierre no va a pasar. */
export function avisoDeFaltaPorContar(falta, { sala } = {}) {
    if (!falta) return null;
    if (falta.medido === false) {
        return {
            clave: 'falta-por-contar:no-medido',
            animo: 'atencion',
            ancla: 'cerrar-dia',
            oferta: [{ tipo: 'titular', texto: 'No pude medir lo que falta contar', sub: sala }],
            explicacion: [
                { tipo: 'titular', texto: 'Aún no se puede cerrar el día', sub: 'El último corte no trae su comprobante completo' },
                { tipo: 'pasos', items: ['Haz un corte y cuenta el cajón.', 'Confírmalo.', 'Ya podrás cerrar el día.'] },
            ],
        };
    }
    const monto = Number(falta.falta);
    if (!(monto >= 0.01)) return null;
    return {
        clave: `falta-por-contar:${falta.desde || 'sin-corte'}`,
        animo: 'atencion',
        ancla: 'cerrar-dia',
        oferta: [{ tipo: 'titular', texto: `Hay ${dinero(monto)} sin contar`, sub: 'Entraron después del último conteo' }],
        explicacion: [
            { tipo: 'titular', texto: 'Aún no se puede cerrar el día', sub: 'Entró dinero después del último conteo' },
            { tipo: 'linea', items: falta.hay_corte
                ? [
                    { hora: hora12(falta.desde), texto: 'último corte confirmado', tono: 'bien' },
                    { hora: `+${dinero(monto)}`, texto: 'sin contar', tono: 'mal' },
                    { hora: 'ahora', texto: 'cierre' },
                ]
                : [
                    { hora: 'apertura', texto: 'sin cortes confirmados', tono: 'mal' },
                    { hora: `+${dinero(monto)}`, texto: 'sin contar', tono: 'mal' },
                    { hora: 'ahora', texto: 'cierre' },
                ] },
            { tipo: 'pasos', items: ['Haz un corte y cuenta el cajón.', 'Confírmalo.', 'Ya podrás cerrar el día.'] },
        ],
    };
}

/** Un corte que quedó sin confirmar ni descartar frena el día. */
export function avisoDeCortesSinResolver(cortes) {
    const lista = Array.isArray(cortes) ? cortes : [];
    if (!lista.length) return null;
    const horas = lista.map((c) => hora12(c.hora)).join(', ');
    return {
        clave: `sin-resolver:${lista.map((c) => c.id ?? c.hora).join(',')}`,
        animo: 'atencion',
        oferta: [{ tipo: 'titular', texto: lista.length === 1 ? 'Un corte quedó sin resolver' : `${lista.length} cortes quedaron sin resolver`, sub: horas }],
        explicacion: [
            { tipo: 'titular', texto: 'Hay que resolverlo antes de seguir', sub: horas },
            { tipo: 'nota', texto: 'Mientras un corte no esté confirmado ni descartado, no se puede hacer otro corte ni cerrar el día.' },
            { tipo: 'pasos', items: ['Ábrelo en **Cortes**.', 'Confírmalo si el conteo está bien, o descártalo si fue una prueba.'] },
            { tipo: 'botones', items: [{ texto: 'Ir a Cortes', ir: '/caja?tab=cortes' }] },
        ],
    };
}

/** Algo no cargó. El mensaje ya viene en palabras de la persona. */
export function avisoDeError(mensaje, clave = 'error') {
    if (!mensaje) return null;
    return {
        clave: `${clave}:${corto(mensaje, 60)}`,
        animo: 'preocupacion',
        oferta: [{ tipo: 'titular', texto: 'Algo no cargó bien', sub: corto(mensaje, 90) }],
        explicacion: [
            { tipo: 'titular', texto: 'Algo no cargó bien', sub: corto(mensaje, 90) },
            { tipo: 'pasos', items: ['Revisa que haya internet.', 'Recarga la pantalla.', 'Si sigue igual, avísale a quien administra el portal.'] },
            { tipo: 'nota', texto: 'Lo que ves puede estar incompleto hasta que cargue.' },
        ],
    };
}

/** Mucho rato quieto en un formulario: se ofrece, no se insiste. */
export function avisoDeInactividad(que) {
    return {
        clave: `quieto:${que}`,
        animo: 'atencion',
        oferta: [{ tipo: 'titular', texto: '¿Te ayudo con esto?', sub: `Llevas un rato en ${que}` }],
        explicacion: [
            { tipo: 'titular', texto: '¿En qué parte te trabaste?', sub: que },
            { tipo: 'nota', texto: 'Escríbeme tu duda abajo y te explico lo que ves en pantalla.' },
        ],
    };
}
