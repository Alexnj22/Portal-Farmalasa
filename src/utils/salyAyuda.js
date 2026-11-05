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
/** @type {[RegExp, string][]} */
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
/** @param {any} falta @param {{ sala?: string }} [opciones] */
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

/* ── Preguntas frecuentes: respondidas por el portal ($0) ───────────────────
 *
 * Lo que se pregunta siempre sobre la caja ya tiene respuesta escrita, así que
 * no se le paga a la IA por repetirla (usuario, 2026-11-04: «que ya sepa los
 * procesos del portal, para que no use tanto token y sea barata»). Salen como
 * botones al abrir a Saly, y una pregunta escrita que nombra sus `claves`
 * también se contesta acá. Las piezas son las mismas que usa la IA.
 *
 * Cada respuesta se escribió contra el portal real (los botones de Mi caja,
 * los frenos de `hacer-corte-caja`, el catálogo `caja_tipos_movimiento`): si
 * cambia el proceso, se cambia acá. */
const CORTE = {
    id: 'corte', pregunta: '¿Cómo hago un corte?', claves: [['corte', 'hago'], ['corte', 'hacer'], ['contar', 'cajon'], ['como', 'cortar']],
    piezas: [
        { tipo: 'titular', texto: 'Así se hace un corte', sub: 'Mi caja · Hoy' },
        { tipo: 'pasos', items: [
            'Toca **Corte** (Hacer corte).',
            'Cuenta **sólo el efectivo del cajón** y escríbelo. Lo que ya está en las bolsas de hoy lo suma el portal.',
            'Toca **Hacer el corte**: el portal te dice si cuadró, sobró o faltó.',
            '**Confírmalo** si el conteo está bien, o **descártalo** si contaste mal y vuelve a contar.',
        ] },
        { tipo: 'nota', texto: 'Si hay preventas guardadas en la caja, primero hay que finalizarlas: el corte no deja guardar.' },
    ],
    guia: [
        { boton: ['Hacer corte', 'Corte'], texto: 'Toca **Corte**, arriba.' },
        { campo: 'Efectivo en el cajón', texto: 'Cuenta **sólo el efectivo del cajón** y escríbelo aquí. Lo de las bolsas lo suma el portal.' },
        { boton: ['Hacer el corte'], texto: 'Toca **Hacer el corte**: te digo si cuadró, sobró o faltó.' },
        { boton: ['Confirmar'], texto: 'Si el conteo es el real, **Confirmar**. Si contaste mal, **Descartar** y vuelve a contar.' },
    ],
};
const CERRAR = {
    id: 'cerrar', pregunta: '¿Por qué no puedo cerrar el día?', claves: [['cerrar', 'dia'], ['cierre'], ['no', 'deja', 'cerrar']],
    piezas: [
        { tipo: 'titular', texto: 'El cierre tiene cuatro frenos', sub: 'Si uno está en rojo, el día no cierra' },
        { tipo: 'pasos', items: [
            '**Un corte sin resolver**: confírmalo o descártalo.',
            '**Ningún corte confirmado hoy**: haz un corte y confírmalo.',
            '**Entró efectivo después del último conteo**: haz otro corte y confírmalo.',
            '**Preventas sin finalizar** en la caja: finalízalas o elimínalas en la caja.',
        ] },
        { tipo: 'nota', texto: 'Cerrar el día emite el Z y no se deshace. Si nadie cierra, el portal lo cierra solo una hora después de la hora de cierre.' },
    ],
    guia: [
        { boton: ['Cerrar el día', 'Cerrar'], texto: 'Toca **Cerrar**, arriba. Si algo frena el cierre, la ventana te dice qué.' },
    ],
};
const SALIDA = {
    id: 'salida', pregunta: '¿Cómo anoto un gasto o una salida?', claves: [['salida'], ['gasto'], ['vale'], ['pago', 'proveedor'], ['anticipo'], ['compra', 'urgente']],
    piezas: [
        { tipo: 'titular', texto: 'Para sacar efectivo del cajón', sub: 'Mi caja · Hoy → Salida' },
        { tipo: 'pasos', items: [
            'Toca **Salida** y elige el tipo: compra o gasto urgente, pago a proveedor, anticipo, bonificación, devolución, cambio por monedas…',
            'Escribe el monto y el detalle. Si hay boleta o factura, tómale **foto**: es el respaldo.',
            'Elige **quién se lleva el efectivo** y toca **Anotar**.',
        ] },
        { tipo: 'nota', texto: 'Las salidas del día se juntan en un vale de caja al hacer el siguiente corte: no hay que hacerlo a mano.' },
    ],
    guia: [
        { boton: ['Salida'], texto: 'Toca **Salida**, arriba.' },
        { texto: 'Elige el **tipo** de salida, escribe el **monto** y el detalle. Si hay boleta, tómale **foto**.' },
        { boton: ['Anotar', 'Continuar'], texto: 'Toca **Anotar**. Si te pide quién se lleva el efectivo, elígelo.' },
    ],
};
const ENTRADA = {
    id: 'entrada', pregunta: '¿Cómo anoto una entrada o un pago con POS?', claves: [['entrada'], ['pos'], ['promerica'], ['inyeccion'], ['glucosa'], ['mapfre'], ['apartar'], ['domicilio']],
    piezas: [
        { tipo: 'titular', texto: 'Para meter efectivo que no es venta', sub: 'Mi caja · Hoy → Entrada' },
        { tipo: 'pasos', items: [
            'Toca **Entrada** y elige el tipo: aplicación de inyección, prueba de glucosa, POS Promerica, Mapfre, apartado, servicio a domicilio u otro.',
            'En **POS Promerica** la foto de la boleta es obligatoria: llena sola el monto y el número.',
            'Revisa el monto y toca **Anotar**.',
        ] },
        { tipo: 'nota', texto: 'Un mismo número de boleta sólo choca si es la misma terminal y el mismo monto: cada banco numera por su lado.' },
    ],
    guia: [
        { boton: ['Entrada'], texto: 'Toca **Entrada**, arriba.' },
        { texto: 'Elige el **tipo**. En POS Promerica, toma la **foto de la boleta**: llena sola el monto.' },
        { boton: ['Anotar', 'Continuar'], texto: 'Revisa el monto y toca **Anotar**.' },
    ],
};
const FALTANTE = {
    id: 'faltante', pregunta: '¿Qué hago con un faltante o sobrante?', claves: [['faltante'], ['falta'], ['sobrante'], ['sobra'], ['diferencia'], ['no', 'cuadra']],
    piezas: [
        { tipo: 'titular', texto: 'Cuando el conteo no cuadra', sub: 'Faltante = menos de lo esperado · Sobrante = más' },
        { tipo: 'pasos', items: [
            'Vuelve a contar el cajón. Si contaste mal, **descarta** el corte y haz otro.',
            'Busca lo que no se anotó: un gasto o pago sin **Salida**, un cobro con tarjeta marcado como efectivo, un vuelto mal dado.',
            'Anótalo en **Mi caja** y haz otro corte: la diferencia se corrige sola.',
            'Si no aparece, confirma el corte: lo resuelve supervisión en **Efectivo → Diferencias**.',
        ] },
        { tipo: 'nota', texto: 'Los cobros de crédito en efectivo hechos desde el portal ya están sumados en lo esperado.' },
    ],
};
const ABRIR = {
    id: 'abrir', pregunta: '¿Cómo abro la caja o inicio el turno?', claves: [['abrir', 'caja'], ['apertura'], ['iniciar', 'turno'], ['turno']],
    piezas: [
        { tipo: 'titular', texto: 'Al empezar el día', sub: 'Mi caja · Hoy' },
        { tipo: 'pasos', items: [
            'Si la caja está cerrada, toca **Abrir** (Abrir la caja) y escribe con cuánto efectivo arranca. Si arranca en cero, déjalo vacío.',
            'Si está abierta pero el turno está parado, toca **Iniciar turno**: sin turno no se puede vender, cortar ni cerrar.',
        ] },
    ],
    guia: [
        { boton: ['Abrir la caja', 'Abrir', 'Iniciar el turno'], texto: 'Toca **Abrir** (o **Iniciar turno** si la caja ya está abierta).' },
        { campo: 'Monto de apertura', texto: 'Escribe con cuánto efectivo arranca. Si es cero, déjalo vacío.' },
    ],
};
const PESTANAS_EFECTIVO = {
    id: 'pestanas', pregunta: '¿Qué hay en cada pestaña de Efectivo?', claves: [['pestana'], ['diferencias'], ['movimientos'], ['donde', 'veo']],
    piezas: [
        { tipo: 'titular', texto: 'Las pestañas de Efectivo', sub: 'Arriba de la pantalla' },
        { tipo: 'pasos', items: [
            '**Hoy**: tu caja del día — abrir, entradas, salidas, cortes y cierre.',
            '**Cortes**: todos los cortes con su esperado, contado y diferencia.',
            '**Diferencias**: los días con faltante o sobrante y qué falta hacer con cada uno.',
            '**Movimientos**: las entradas y salidas, también las editadas o borradas en la caja.',
        ] },
    ],
};
const CONFIRMAR = {
    id: 'confirmar', pregunta: '¿Cuándo confirmo y cuándo descarto un corte?', claves: [['confirmar'], ['descartar'], ['pendiente'], ['sin', 'confirmar']],
    piezas: [
        { tipo: 'titular', texto: 'Confirmar o descartar', sub: 'Todo corte termina en una de las dos' },
        { tipo: 'cifras', items: [
            { rotulo: 'Confirmar', valor: 'conteo bueno', tono: 'bien' },
            { rotulo: 'Descartar', valor: 'conteo malo', tono: 'mal' },
        ] },
        { tipo: 'pasos', items: [
            '**Confirma** cuando el efectivo que contaste es el real, aunque haya diferencia: la diferencia queda firmada.',
            '**Descarta** cuando contaste mal o fue una prueba: ese conteo no cuenta y se hace otro.',
        ] },
        { tipo: 'nota', texto: 'Un corte pendiente frena el siguiente corte y el cierre del día.' },
    ],
};

export const PREGUNTAS_FRECUENTES = {
    caja: [CORTE, CERRAR, SALIDA, ENTRADA, FALTANTE, CONFIRMAR, ABRIR],
    cortes_caja: [FALTANTE, CONFIRMAR, PESTANAS_EFECTIVO, CERRAR, CORTE],
};

const normal = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * La pregunta frecuente que contesta lo escrito, o `null`. Gana la que reúne
 * TODAS las palabras de alguna de sus `claves`; con varias, la que más reúne.
 * Una pregunta larga y concreta («por qué la salida de las 12 dice…») no se
 * desvía a la frecuente: pasa de 9 palabras, va a la IA.
 */
export function preguntaFrecuente(modulo, texto) {
    const t = normal(texto);
    if (!t || t.split(/\s+/).length > 9) return null;
    let mejor = null, puntos = 0;
    for (const f of PREGUNTAS_FRECUENTES[modulo] || []) {
        for (const grupo of f.claves) {
            if (grupo.every((p) => t.includes(p)) && grupo.length > puntos) { mejor = f; puntos = grupo.length; }
        }
    }
    return mejor;
}

/* ── Nombres: se cambian por un alias antes de salir hacia la IA ────────────
 * Decisión del usuario (2026-11-04, punto 4). El nombre de una persona
 * —empleado o cliente— viaja como «Persona 1», y al volver la respuesta se le
 * devuelve el nombre real. Se cubren el nombre completo y el corto (primer
 * nombre + primer apellido), que es como el portal lo pinta. Los más largos
 * van primero: «KARLA PATRICIA CORTEZ VALLE» antes que «KARLA CORTEZ». */
const sinTildes = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const escapar = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function crearMascaraDeNombres(nombres) {
    const formas = [];
    const alias = new Map();          // alias → nombre corto legible
    let n = 0;
    for (const crudo of nombres || []) {
        const palabras = sinTildes(crudo).trim().split(/\s+/).filter((p) => p.length > 1);
        if (palabras.length < 2) continue;
        const completo = palabras.join(' ');
        if (formas.some((f) => f.forma === completo)) continue;
        const corto = palabras.length >= 4 ? `${palabras[0]} ${palabras[2]}` : `${palabras[0]} ${palabras[1]}`;
        const id = `Persona ${++n}`;
        alias.set(id, corto.split(' ').map((p) => p[0] + p.slice(1).toLowerCase()).join(' '));
        formas.push({ forma: completo, id });
        if (corto !== completo) formas.push({ forma: corto, id });
    }
    formas.sort((a, b) => b.forma.length - a.forma.length);
    /** @type {[RegExp, string][]} */
    const reglas = formas.map((f) => [new RegExp(`\\b${escapar(f.forma).replace(/ /g, '\\s+')}\\b`, 'gi'), f.id]);
    return {
        tapar: (texto) => {
            let t = sinTildes(texto);
            for (const [re, id] of reglas) t = t.replace(re, id);
            return t;
        },
        destapar: (texto) => String(texto ?? '').replace(/Persona \d+/g, (m) => alias.get(m) || 'esa persona'),
    };
}

/** Le devuelve los nombres a las piezas que contestó la IA. */
export function destaparPiezas(piezas, destapar) {
    const d = (v) => (typeof v === 'string' ? destapar(v) : v);
    return (piezas || []).map((p) => ({
        ...p,
        texto: d(p.texto), sub: d(p.sub),
        items: Array.isArray(p.items) ? p.items.map((i) => (typeof i === 'string' ? d(i)
            : { ...i, rotulo: d(i.rotulo), valor: d(i.valor), texto: d(i.texto), hora: d(i.hora) })) : p.items,
    }));
}

/* ── Los números de una respuesta se comprueban (punto 5) ───────────────────
 * Un monto que la IA inventa es el peor error posible en la caja: se lee como
 * un dato. Toda cantidad con centavos o con `$` que aparezca en la respuesta
 * tiene que salir de lo que la pantalla mostró —o ser la suma o la resta de
 * dos de esas cantidades, que es lo que una explicación hace—. Si no, la
 * respuesta no se muestra. Los números chicos sin centavos (pasos, horas,
 * «4 frenos») no se miran: no son dinero. */
const MONTO_EN_RESPUESTA = /\$\s?-?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*\.\d{2}\b/g;
const NUMERO_EN_FUENTE = /-?\d[\d,]*(?:\.\d+)?/g;
const aCentavos = (s) => Math.round(Math.abs(Number(String(s).replace(/[$,\s]/g, ''))) * 100);

function textoDePiezas(piezas) {
    const partes = [];
    for (const p of piezas || []) {
        partes.push(p.texto, p.sub);
        for (const i of p.items || []) {
            if (typeof i === 'string') partes.push(i);
            else partes.push(i.rotulo, i.valor, i.texto, i.hora);
        }
    }
    return partes.filter(Boolean).join(' \n ');
}

/** Los montos de la respuesta que NO salen de las fuentes. Vacío = todo bien. */
export function montosInventados(piezas, fuentes) {
    const conocidos = new Set();
    for (const f of fuentes || []) {
        for (const m of String(f ?? '').match(NUMERO_EN_FUENTE) || []) {
            const c = aCentavos(m);
            if (Number.isFinite(c)) conocidos.add(c);
        }
    }
    const lista = [...conocidos];
    const derivados = new Set(lista);
    if (lista.length <= 200) {
        for (let i = 0; i < lista.length; i++) {
            for (let j = i + 1; j < lista.length; j++) {
                derivados.add(lista[i] + lista[j]);
                derivados.add(Math.abs(lista[i] - lista[j]));
            }
        }
    }
    const malos = [];
    for (const m of textoDePiezas(piezas).match(MONTO_EN_RESPUESTA) || []) {
        const c = aCentavos(m);
        if (Number.isFinite(c) && c > 0 && !derivados.has(c)) malos.push(m.trim());
    }
    return malos;
}

/* ── La revisión de los movimientos del día (punto 2, $0) ──────────────────
 * Lo que una persona de supervisión miraría fila por fila, hecho por el
 * portal. Devuelve `Map<clave, motivos[]>` sobre las líneas de `lineasDelDia`.
 * Sólo marca lo que tiene arreglo HOY, antes del cierre. Lo que la fila ya
 * dice sola («No llegó a la caja», «Falta autorizarlo») no se repite en la
 * fila: va sólo en la explicación de la burbuja. */
const MIN = 60_000;
export function revisarMovimientos(lineas, { ahora = Date.now() } = {}) {
    const motivos = new Map();
    const poner = (l, m) => { if (!motivos.has(l.clave)) motivos.set(l.clave, []); motivos.get(l.clave).push(m); };
    const vivas = (lineas || []).filter((l) => !l.anulado && l.movimiento);

    for (const l of vivas) {
        const edad = l.cuando ? ahora - new Date(l.cuando).getTime() : 0;
        // Sólo donde hay un papel que respaldar: compra, gasto o proveedor. Un
        // cambio por monedas o un anticipo no traen boleta.
        const conPapel = /compra|gasto|proveedor/i.test(`${l.titulo || ''} ${l.movimiento?.concepto || ''}`);
        if (l.clase === 'sale' && conPapel && !l.foto) poner(l, { corto: 'Sin foto del respaldo', largo: 'una salida sin foto de la boleta o factura', enFila: true });
        if (l.sinCaja && edad > 10 * MIN) poner(l, { corto: 'No llegó a la caja', largo: 'se anotó en el portal pero no llegó a la caja', enFila: false });
        if (l.autorizacion === 'PENDIENTE' && edad > 30 * MIN) poner(l, { corto: 'Lleva rato sin autorizar', largo: 'lleva más de media hora esperando autorización', enFila: false });
    }
    // La misma boleta con el mismo monto dos veces: casi siempre se anotó doble.
    const vistas = new Map();
    for (const l of vivas) {
        const b = l.movimiento?.numero_boleta;
        if (!b) continue;
        const k = `${String(b).replace(/^0+/, '')}|${l.monto.toFixed(2)}`;
        if (vistas.has(k)) {
            const otra = vistas.get(k);
            poner(l, { corto: 'Boleta repetida', largo: `la misma boleta y el mismo monto que otra de hoy`, enFila: true });
            if (!(motivos.get(otra.clave) || []).some((m) => m.corto === 'Boleta repetida')) {
                poner(otra, { corto: 'Boleta repetida', largo: 'la misma boleta y el mismo monto que otra de hoy', enFila: true });
            }
        } else vistas.set(k, l);
    }
    return motivos;
}

/** El aviso de la burbuja con lo que encontró la revisión. */
export function avisoDeRevision(lineas, motivos) {
    if (!motivos?.size) return null;
    const porClave = new Map((lineas || []).map((l) => [l.clave, l]));
    const filas = [...motivos.entries()].map(([clave, ms]) => ({ l: porClave.get(clave), ms })).filter((f) => f.l);
    if (!filas.length) return null;
    const titulo = (l) => String(l.titulo || '').split(' · ')[0];
    return {
        clave: `revision:${[...motivos.keys()].sort().join(',')}`,
        animo: 'atencion',
        ancla: `mov-${filas[0].l.clave}`,
        oferta: [{ tipo: 'titular', texto: `Revisé los movimientos: ${filas.length} para mirar`, sub: 'Mejor arreglarlo antes del cierre' }],
        explicacion: [
            { tipo: 'titular', texto: filas.length === 1 ? 'Un movimiento para mirar' : `${filas.length} movimientos para mirar`, sub: 'Los marqué en la lista' },
            { tipo: 'pasos', items: filas.slice(0, 4).map(({ l, ms }) =>
                `**${titulo(l)}** (${formatMoney(l.monto)}): ${ms.map((m) => m.largo).join('; ')}.`) },
            { tipo: 'nota', texto: 'Ábrelo y usa **Corregir** para agregar la foto o arreglar el dato. Si una boleta quedó doble, pide anular una.' },
        ],
        anclas: filas.map(({ l }) => `mov-${l.clave}`),
    };
}

