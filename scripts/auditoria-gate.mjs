#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// EL CANDADO — lo que ya se auditó no se toca sin pedir permiso ni se cierra
// sin volver a verificar
// ─────────────────────────────────────────────────────────────────────────────
//
// Nació el 2026-08-23 con la auditoría completa del portal. El pedido era de una
// línea: «cuando ya esté finalizado no se toque nada de eso, y si se toca que
// pregunte antes y se haga verificación después».
//
// Las dos mitades de esa frase son dos chequeos DISTINTOS, y por eso el gate
// tiene dos modos que no se parecen:
//
//   `--hook`   (pre-commit, sin red, milisegundos)
//              Bloquea el commit que toca un área CONGELADA. Es el «preguntar
//              antes»: para seguir hay que abrir un desbloqueo a mano, con
//              motivo escrito. Nadie descongela sin querer.
//
//   completo   (`npm run gate:auditoria`, al cerrar el trabajo)
//              Falla si quedó un desbloqueo ABIERTO. Es el «verificar después»:
//              el commit puntual pasa, pero el trabajo no se puede dar por
//              cerrado hasta volver a sellar el área.
//
// ── Por qué son dos y no uno ────────────────────────────────────────────────
// Un gate que bloquea CADA commit de un trabajo en curso enseña a escribir
// `--no-verify`, y a partir de ahí no protege nada. Un gate que sólo avisa se
// olvida el día que hay prisa — es exactamente cómo se perdieron 164 entradas
// del changelog. La única combinación que sobrevive al apuro es: bloquear la
// PRIMERA vez (barato de resolver: se abre el desbloqueo y se sigue) y bloquear
// el CIERRE (que es cuando de verdad importa haber verificado).
//
// ── El chequeo que nadie pidió y es el que más sirve ────────────────────────
// Antes de mirar puntajes, el gate contrasta el mapa contra el DISCO y contra
// producción: archivo sin área, tabla sin área, edge function sin área, cron sin
// área, y lo declarado que ya no existe. Un huérfano no es un detalle de
// contabilidad: es código que ninguna auditoría está mirando y que por lo tanto
// nunca va a aparecer en ningún porcentaje. El día que alguien agregue una vista
// y no la mapee, el portal diría «92% auditado» sobre un denominador viejo.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { AREAS, EJES, TOPE_SIN_SELLO, areaDeArchivo } from '../auditoria/areas.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Los tres archivos que lee se pueden redirigir por entorno. No es un lujo: la
// regla del proyecto es que a un detector no se le cree un cero hasta haberle
// fabricado la regresión que debería cazar, y sin esto la única forma de
// probarlo sería pisar el registro real — con varias sesiones sobre el mismo
// árbol, eso significa borrarle el trabajo a otra.
const dir = process.env.AUDITORIA_DIR || path.join(RAIZ, 'auditoria');
const REGISTRO = path.join(dir, 'registro.json');
const DESBLOQUEOS = path.join(dir, 'desbloqueos.json');

const args = process.argv.slice(2);
const MODO_HOOK = args.includes('--hook');
const SOLO_MAPA = args.includes('--mapa');

// ── El inventario de producción, en vivo cuando se puede ────────────────────
// Hasta el 2026-10-21 el modo completo comparaba contra la foto guardada en
// auditoria/snapshot-produccion.json, y la foto se armaba a mano. Tenía 57 días
// y el gate daba verde con 21 tablas y 17 crons de producción sin área: no
// estaban en la foto, así que no podía verlos. Un verde sobre un inventario
// viejo no dice nada.
//
// Por eso el modo completo lee producción directo (sólo lectura). El hook NO:
// un gate de commit que necesita red enseña a usar `--no-verify`. Si no hay
// canal, cae a la foto — y si la foto pasa de DIAS_FOTO días, el modo completo
// FALLA en vez de avisar.
const DIAS_FOTO = 7;
let vivo = null, errorVivo = null;
// Con AUDITORIA_DIR (las pruebas) los archivos redirigidos SON la verdad,
// foto incluida: leer producción encima pisaría el caso que la prueba arma.
if (!MODO_HOOK && !args.includes('--sin-red') && !process.env.AUDITORIA_DIR) {
    try {
        const { leerCatalogoDeProduccion } = await import('./lib/catalogo-produccion.mjs');
        vivo = { generado: new Date().toISOString(), ...(await leerCatalogoDeProduccion()) };
    } catch (e) { errorVivo = e.message; }
}
const VERBOSO = args.includes('-v') || args.includes('--verbose');

const c = {
    rojo: s => `\x1b[31m${s}\x1b[0m`,   verde: s => `\x1b[32m${s}\x1b[0m`,
    ama:  s => `\x1b[33m${s}\x1b[0m`,   gris:  s => `\x1b[90m${s}\x1b[0m`,
    ne:   s => `\x1b[1m${s}\x1b[0m`,
};

const fallas = [];
const avisos = [];

// ── Lectura tolerante ───────────────────────────────────────────────────────
// Un archivo que todavía no existe NO es una falla: el gate tiene que poder
// correr el día que se instala, antes de que exista un solo puntaje.
function leerJson(ruta, porDefecto) {
    try { return JSON.parse(fs.readFileSync(ruta, 'utf8')); }
    catch { return porDefecto; }
}

const registro = leerJson(REGISTRO, { areas: {} });
const desbloqueos = leerJson(DESBLOQUEOS, { abiertos: [] });

// ═══ 1. COHERENCIA DEL MAPA CONTRA EL DISCO ═════════════════════════════════
function verificarMapa() {
    // -- archivos --
    let archivos = [];
    try {
        archivos = execSync("git ls-files 'src/**'", { cwd: RAIZ })
            .toString().trim().split('\n')
            .filter(f => /\.(js|jsx)$/.test(f));
    } catch { /* fuera de un repo: se saltea */ }

    const huerfanos = archivos.filter(f => !areaDeArchivo(f));
    if (huerfanos.length) {
        fallas.push({
            titulo: `${huerfanos.length} archivo(s) de src/ sin área`,
            detalle: huerfanos.slice(0, 12),
            arreglo: 'Agregalo a `archivos` del área que corresponda en auditoria/areas.mjs. '
                   + 'Un archivo sin área no entra en ningún porcentaje: el portal diría estar '
                   + 'auditado sobre un denominador que ya no es el suyo.',
        });
    }

    // -- edge functions --
    const dirFunciones = path.join(RAIZ, 'supabase', 'functions');
    if (fs.existsSync(dirFunciones)) {
        const enDisco = fs.readdirSync(dirFunciones)
            .filter(d => !d.startsWith('_') && !d.startsWith('.'))
            .filter(d => fs.statSync(path.join(dirFunciones, d)).isDirectory());
        const declaradas = new Map();
        AREAS.forEach(a => a.edge.forEach(e => {
            if (declaradas.has(e)) declaradas.get(e).push(a.id); else declaradas.set(e, [a.id]);
        }));

        const sinArea = enDisco.filter(e => !declaradas.has(e));
        if (sinArea.length) fallas.push({
            titulo: `${sinArea.length} edge function(s) sin área`, detalle: sinArea,
            arreglo: 'Agregala a `edge` del área donde produce el EFECTO, no donde se dispara.',
        });

        const fantasmas = [...declaradas.keys()].filter(e => !enDisco.includes(e));
        if (fantasmas.length) fallas.push({
            titulo: `${fantasmas.length} edge function(s) declarada(s) que ya no existen`, detalle: fantasmas,
            arreglo: 'Quitala del área. Un inventario que nombra piezas muertas no se puede usar para decidir nada.',
        });

        const dobles = [...declaradas].filter(([, as]) => as.length > 1);
        if (dobles.length) fallas.push({
            titulo: `${dobles.length} edge function(s) en más de un área`,
            detalle: dobles.map(([e, as]) => `${e} → ${as.join(', ')}`),
            arreglo: 'Una pieza tiene UN dueño. Con dos, queda congelada por ambas y descongelada por cualquiera.',
        });
    }

    // -- funciones: el área que se les asignó tiene que existir --
    {
        const ids = new Set(AREAS.map(a => a.id));
        const mapa = leerJson(path.join(dir, 'funciones.json'), { funciones: {} }).funciones || {};
        const malas = Object.entries(mapa).filter(([, v]) => v.area && !ids.has(v.area));
        if (malas.length) fallas.push({
            titulo: `${malas.length} función(es) asignada(s) a un área que no existe`,
            detalle: malas.slice(0, 20).map(([n, v]) => `${n} → ${v.area}`),
            arreglo: 'Corregir el área en auditoria/funciones.json (los ids están en auditoria/areas.mjs).',
        });
    }

    // -- tablas y crons: el snapshot de producción --
    // No se consulta la base acá a propósito: este gate corre en el hook de
    // pre-commit y un chequeo que necesita red falla sin conexión, que es como
    // se le enseña a la gente a usar `--no-verify`. El contraste contra
    // producción lo hace `npm run auditoria:sincronizar`, que sí puede tardar.
    const snapshot = vivo || leerJson(path.join(dir, 'snapshot-produccion.json'), null);
    if (snapshot) {
        for (const [clave, campo, etiqueta] of [['tablas', 'tablas', 'tabla'], ['crons', 'crons', 'cron']]) {
            const declaradas = new Map();
            AREAS.forEach(a => a[campo].forEach(v => {
                if (declaradas.has(v)) declaradas.get(v).push(a.id); else declaradas.set(v, [a.id]);
            }));
            const reales = snapshot[clave] || [];
            const sinArea = reales.filter(v => !declaradas.has(v));
            if (sinArea.length) fallas.push({
                titulo: `${sinArea.length} ${etiqueta}(s) de producción sin área`, detalle: sinArea,
                arreglo: `Agregala a \`${campo}\` del área que la usa.`,
            });
            const fantasmas = [...declaradas.keys()].filter(v => !reales.includes(v));
            if (fantasmas.length) avisos.push({
                titulo: `${fantasmas.length} ${etiqueta}(s) declarada(s) que no están en el último snapshot`,
                detalle: fantasmas,
                arreglo: `Puede ser que se hayan borrado, o que el snapshot esté viejo. `
                       + `Refrescalo con \`npm run auditoria:sincronizar\`.`,
            });
        }
        // -- superficie `anon`: lo que se puede tocar SIN credenciales --
        // Va acá, con el resto del contraste contra producción, porque es la
        // misma clase de pregunta: ¿lo que hay allá afuera es lo que alguien
        // decidió? La regla escrita decía CINCO funciones y había VEINTICUATRO.
        // Ninguna estaba abierta —se verificaron a mano—, pero el número creció
        // solo durante un mes y no lo detectó nada. Una afirmación sobre quién
        // puede entrar sin credenciales que nadie verifica deja de ser cierta
        // sin avisar.
        const declarada = leerJson(path.join(dir, 'superficie-anon.json'), null);
        if (declarada && snapshot.anon) {
            for (const [clave, etiqueta] of [['funciones', 'función'], ['tablas', 'tabla']]) {
                const nombres = new Set((declarada[clave] || []).map(x => x.nombre));
                const reales = snapshot.anon[clave] || [];
                const nuevas = reales.filter(x => !nombres.has(x));
                if (nuevas.length) fallas.push({
                    titulo: `${nuevas.length} ${etiqueta}(s) alcanzable(s) por \`anon\` sin declarar`,
                    detalle: nuevas,
                    arreglo: 'Cada cosa que se puede tocar SIN iniciar sesión va declarada en '
                           + 'auditoria/superficie-anon.json con su guarda y su motivo. Si no tiene '
                           + 'motivo, no va: revocale el EXECUTE (o la policy) en vez de declararla.',
                });
                const sobran = [...nombres].filter(x => !reales.includes(x));
                if (sobran.length) avisos.push({
                    titulo: `${sobran.length} ${etiqueta}(s) declarada(s) que anon ya no alcanza`,
                    detalle: sobran,
                    arreglo: 'Se revocaron: sacalas de superficie-anon.json.',
                });
            }
        } else if (!declarada) {
            avisos.push({ titulo: 'No hay superficie `anon` declarada', detalle: ['auditoria/superficie-anon.json'], arreglo: '' });
        }

        // -- funciones de la base --
        // Hasta el 2026-10-21 no estaban en el mapa: ~1,200 funciones donde
        // vive buena parte de la lógica no entraban en ningún porcentaje. Su
        // área vive en auditoria/funciones.json (la propone
        // `npm run auditoria:funciones`). Sólo en vivo: la foto no las trae.
        if (vivo?.funciones) {
            const mapa = leerJson(path.join(dir, 'funciones.json'), { funciones: {} }).funciones || {};
            const sinArea = vivo.funciones.filter(n => !mapa[n]?.area);
            if (sinArea.length) fallas.push({
                titulo: `${sinArea.length} función(es) de producción sin área`,
                detalle: sinArea.slice(0, 20),
                arreglo: 'Correr `npm run auditoria:funciones -- --escribir`, revisar lo que propone y commitear '
                       + 'auditoria/funciones.json. Lo que no resuelva solo, a mano con "manual": true.',
            });
            const muertas = Object.keys(mapa).filter(n => !vivo.funciones.includes(n));
            if (muertas.length) avisos.push({
                titulo: `${muertas.length} función(es) en auditoria/funciones.json que ya no existen`,
                detalle: muertas.slice(0, 20),
                arreglo: 'Correr `npm run auditoria:funciones -- --escribir`.',
            });
        }

        // -- tablas sin created_at: cada una con su motivo --
        // La regla 1 del hardening pide created_at en toda tabla nueva. Las
        // que no lo tienen están declaradas por grupo en
        // auditoria/tablas-sin-created-at.json (PENDIENTES 31). La auditoría
        // del 2026-08-23 contó 45; en octubre eran 48 y nadie lo había
        // decidido. Sólo en vivo: la foto no las trae.
        if (vivo?.sin_created_at) {
            const grupos = leerJson(path.join(dir, 'tablas-sin-created-at.json'), { grupos: {} }).grupos || {};
            const declaradas = new Set(Object.values(grupos).flatMap(g => Object.keys(g.tablas || {})));
            const nuevas = vivo.sin_created_at.filter(t => !declaradas.has(t));
            if (nuevas.length) fallas.push({
                titulo: `${nuevas.length} tabla(s) sin \`created_at\` y sin motivo declarado`,
                detalle: nuevas,
                arreglo: 'Agregale `created_at timestamptz NOT NULL DEFAULT now()` (regla 1 del hardening), '
                       + 'o declarala en auditoria/tablas-sin-created-at.json en el grupo que corresponda.',
            });
            const sobran = [...declaradas].filter(t => !vivo.sin_created_at.includes(t));
            if (sobran.length) avisos.push({
                titulo: `${sobran.length} tabla(s) declarada(s) sin created_at que ya lo tienen o no existen`,
                detalle: sobran,
                arreglo: 'Sacalas de auditoria/tablas-sin-created-at.json.',
            });
        }

        // -- la causa, no sólo el síntoma --
        // Medido el 2026-10-21: toda función nueva nacía ejecutable por `anon`
        // porque así estaban los privilegios por defecto. Revocar las que
        // aparecen es secar el piso con la canilla abierta; esto vigila la
        // canilla. Sólo en vivo: la foto guardada no lo trae.
        if (vivo?.defaults_funciones) {
            const abiertos = vivo.defaults_funciones.filter(d => /(^|[{,])(anon)?=X/.test(d.acl))
                .map(d => `privilegios por defecto de postgres en ${d.esquema}: ${d.acl}`);
            // Sin la entrada global, Postgres vuelve a su default de fábrica:
            // EXECUTE para PUBLIC. Que FALTE es tan abierto como que diga =X.
            for (const esq of ['*', 'public'])
                if (!vivo.defaults_funciones.some(d => d.esquema === esq))
                    abiertos.push(`falta la entrada de privilegios por defecto de postgres en ${esq}`);
            if (abiertos.length) fallas.push({
                titulo: 'Las funciones NUEVAS nacen ejecutables sin iniciar sesión',
                detalle: abiertos,
                arreglo: 'Alguien volvió a abrir el default. Repetir el bloque 2 de la migración '
                       + '20261021194340_anon_no_ejecuta_funciones_nuevas. Lo que deba llamarse sin '
                       + 'sesión lleva su GRANT ... TO anon explícito.',
            });
        }

        const edad = snapshot.generado
            ? Math.floor((Date.now() - Date.parse(snapshot.generado)) / 86_400_000) : null;
        if (!vivo && edad !== null && edad > DIAS_FOTO) (MODO_HOOK ? avisos : fallas).push({
            titulo: `El snapshot de producción tiene ${edad} días y no se pudo leer producción en vivo`,
            detalle: [`generado: ${snapshot.generado}`, ...(errorVivo ? [`motivo: ${errorVivo}`] : [])],
            arreglo: 'Refrescalo con `npm run auditoria:sincronizar`. Un inventario viejo da falsos verdes: '
                   + 'una tabla o un cron nuevo sin área no aparece en ningún porcentaje.',
        });
    } else {
        avisos.push({
            titulo: 'No hay snapshot de producción',
            detalle: ['auditoria/snapshot-produccion.json'],
            arreglo: 'Generalo con `npm run auditoria:sincronizar`. Sin él, el gate no puede ver '
                   + 'una tabla o un cron que nadie mapeó.',
        });
    }
}

// ═══ 2. COHERENCIA DEL REGISTRO DE PUNTAJES ═════════════════════════════════
const PESO_TOTAL = EJES.reduce((s, e) => s + e.peso, 0);

export function calcularPct(entrada) {
    if (!entrada || !entrada.ejes) return 0;
    let suma = 0;
    for (const eje of EJES) {
        const v = entrada.ejes[eje.id];
        const pct = (v && typeof v.pct === 'number') ? v.pct : 0;
        suma += pct * eje.peso;
    }
    const bruto = Math.round(suma / PESO_TOTAL);
    // El sello de sala es un TOPE, no un sumando: doce ejes perfectos sin una
    // corrida real llegan a 95, nunca a 100. Si fuera un sumando, un área podría
    // compensar la falta de prueba real con puntaje de otro lado — que es
    // exactamente la confusión entre «construido» y «funciona».
    // Sellada = 100. Los doce ejes en verde valen 95 y el sello —una corrida
    // real en sala— es lo que completa el resto: no es un sumando que se pueda
    // compensar desde el escritorio. Tiene que decir lo MISMO que `pctDe` del
    // CLI; si divergen, el gate rechaza un `pct` que el propio CLI escribió.
    // El sello completa el 95 → 100, pero SÓLO mientras los ejes lo sigan
    // sosteniendo. Sin la segunda condición, un área sellada valía 100 aunque
    // después le bajaran un eje a 40 — lo cazó
    // `auditoriaGate.test.js › rechaza un pct escrito a mano`, que es
    // exactamente para lo que esa prueba existe. Un candado que protege algo
    // que ya no se cumple es peor que no tener candado, porque da confianza.
    return (entrada.sello_sala && bruto >= TOPE_SIN_SELLO) ? 100 : Math.min(bruto, TOPE_SIN_SELLO);
}

function verificarRegistro() {
    const idsValidos = new Set(AREAS.map(a => a.id));
    const idsEje = new Set(EJES.map(e => e.id));

    for (const id of Object.keys(registro.areas || {})) {
        if (!idsValidos.has(id)) fallas.push({
            titulo: `El registro puntúa un área que no existe: ${id}`, detalle: [],
            arreglo: 'Renombrala o quitala. Un puntaje sin área es un número que nadie puede rastrear.',
        });
    }

    for (const area of AREAS) {
        const e = registro.areas?.[area.id];
        if (!e) { avisos.push({ titulo: `Área sin auditar: ${area.id}`, detalle: [], arreglo: '' }); continue; }

        const faltantes = EJES.filter(x => !e.ejes?.[x.id]).map(x => x.id);
        if (faltantes.length && e.estado !== 'sin-auditar') avisos.push({
            titulo: `${area.id}: ${faltantes.length} eje(s) sin puntuar`, detalle: faltantes, arreglo: '',
        });

        for (const k of Object.keys(e.ejes || {})) {
            if (!idsEje.has(k)) fallas.push({
                titulo: `${area.id}: eje desconocido «${k}»`, detalle: [], arreglo: '',
            });
        }

        // Un puntaje sin evidencia es una opinión. El eje que declara 100 tiene
        // que decir CÓMO se comprobó — si no, el 100 se hereda de la sesión
        // anterior y nadie puede volver a mirarlo.
        for (const [k, v] of Object.entries(e.ejes || {})) {
            if (v?.pct >= 90 && !v?.evidencia) fallas.push({
                titulo: `${area.id}/${k}: ${v.pct}% sin evidencia escrita`, detalle: [],
                arreglo: 'Un puntaje alto sin evidencia es una opinión. Escribí qué se corrió o qué se leyó.',
            });
        }

        const calculado = calcularPct(e);
        if (typeof e.pct === 'number' && e.pct !== calculado) fallas.push({
            titulo: `${area.id}: pct guardado (${e.pct}) ≠ calculado (${calculado})`, detalle: [],
            arreglo: 'Corré `npm run auditoria:recalcular`. El pct se DERIVA de los ejes; escribirlo a mano '
                   + 'permite declarar 100% sin haber movido un solo eje.',
        });

        if (e.estado === 'congelado') {
            if (calculado < 100) fallas.push({
                titulo: `${area.id}: congelada con ${calculado}%`, detalle: [],
                arreglo: 'Sólo se congela lo que llegó a 100 — los doce ejes en verde MÁS el sello de sala.',
            });
            if (!e.sello_sala) fallas.push({
                titulo: `${area.id}: congelada sin sello de sala`, detalle: [],
                arreglo: 'Congelar sin una corrida real es congelar algo que nadie usó nunca.',
            });
        }
    }
}

// ═══ 3. EL CANDADO ══════════════════════════════════════════════════════════
function areasCongeladas() {
    return new Set(AREAS.map(a => a.id).filter(id => registro.areas?.[id]?.estado === 'congelado'));
}

function desbloqueoDe(areaId) {
    return (desbloqueos.abiertos || []).find(d => d.area === areaId) || null;
}

function verificarCandado() {
    const congeladas = areasCongeladas();
    if (!congeladas.size) return;

    let preparados = [];
    // `!== undefined` y no truthy: una lista VACÍA inyectada tiene que ganarle al
    // índice real. Con la comparación truthy, una prueba que dice «no hay nada
    // preparado» caía al `git diff --cached` del árbol compartido y leía los
    // archivos de OTRA sesión — que es como una prueba pasa o falla según lo que
    // esté haciendo alguien más en ese momento.
    if (process.env.AUDITORIA_PREPARADOS !== undefined) {
        preparados = process.env.AUDITORIA_PREPARADOS.split(',').filter(Boolean);
    } else {
        try {
            preparados = execSync('git diff --cached --name-only --diff-filter=ACMR', { cwd: RAIZ })
                .toString().trim().split('\n').filter(Boolean);
        } catch { return; }
    }
    if (!preparados.length) return;

    const tocadas = new Map();
    for (const f of preparados) {
        const a = areaDeArchivo(f);
        if (a && congeladas.has(a)) {
            if (!tocadas.has(a)) tocadas.set(a, []);
            tocadas.get(a).push(f);
        }
    }

    for (const [areaId, archivos] of tocadas) {
        const d = desbloqueoDe(areaId);
        const area = AREAS.find(a => a.id === areaId);
        if (!d) {
            fallas.push({
                titulo: `«${area.nombre}» está CONGELADA y este commit la toca`,
                detalle: archivos.slice(0, 10),
                arreglo: `Esta área se auditó y quedó al 100%. Antes de cambiarla:\n`
                       + `      1. Preguntale al usuario si de verdad quiere tocarla.\n`
                       + `      2. Abrí el desbloqueo con el motivo:\n`
                       + `         npm run auditoria:desbloquear -- ${areaId} "por qué se toca"\n`
                       + `      3. Al terminar, volvé a verificar y sellá:\n`
                       + `         npm run auditoria:sellar -- ${areaId} "qué se corrió"`,
            });
        } else {
            avisos.push({
                titulo: `«${area.nombre}» está descongelada desde ${d.desde}`,
                detalle: [`motivo: ${d.motivo}`, `ejes a reverificar: ${(d.reverificar || []).join(', ') || '(todos)'}`],
                arreglo: `Al cerrar: npm run auditoria:sellar -- ${areaId} "qué se corrió"`,
            });
        }
    }
}

// ═══ 4. DESBLOQUEOS ABIERTOS (sólo en modo completo) ════════════════════════
function verificarDesbloqueosAbiertos() {
    const abiertos = desbloqueos.abiertos || [];
    if (!abiertos.length) return;
    fallas.push({
        titulo: `${abiertos.length} área(s) descongelada(s) sin volver a sellar`,
        detalle: abiertos.map(d => `${d.area} — ${d.motivo} (desde ${d.desde})`),
        arreglo: 'Esta es la mitad «verificación después» del pedido. El commit puntual pasó; el trabajo '
               + 'no se cierra hasta reverificar el área y sellarla:\n'
               + '      npm run auditoria:sellar -- <area> "qué se corrió"',
    });
}

// ═══ INFORME ════════════════════════════════════════════════════════════════
function informe() {
    const filas = AREAS.map(a => {
        const e = registro.areas?.[a.id];
        const pct = e ? calcularPct(e) : 0;
        return { id: a.id, nombre: a.nombre, pct, estado: e?.estado || 'sin-auditar', sello: !!e?.sello_sala };
    }).sort((x, y) => y.pct - x.pct);

    const barra = p => {
        const n = Math.round(p / 5);
        const s = '█'.repeat(n) + '░'.repeat(20 - n);
        return p >= 100 ? c.verde(s) : p >= 70 ? c.ama(s) : c.rojo(s);
    };
    const icono = { congelado: '🔒', completo: '✔', 'en-curso': '·', 'sin-auditar': '?' };

    console.log(c.ne('\n  ESTADO DEL PORTAL POR ÁREA\n'));
    for (const f of filas) {
        console.log(`  ${icono[f.estado] || '?'} ${barra(f.pct)} ${String(f.pct).padStart(3)}%  `
                  + `${f.nombre}${f.sello ? c.gris('  · sellada en sala') : ''}`);
    }
    const prom = Math.round(filas.reduce((s, f) => s + f.pct, 0) / filas.length);
    const congeladas = filas.filter(f => f.estado === 'congelado').length;
    console.log(c.ne(`\n  Promedio del portal: ${prom}%   ·   ${congeladas}/${filas.length} áreas congeladas\n`));
}

// ═══ SALIDA ═════════════════════════════════════════════════════════════════
verificarMapa();
if (!SOLO_MAPA) {
    verificarRegistro();
    verificarCandado();
    if (!MODO_HOOK) verificarDesbloqueosAbiertos();
}

const etiqueta = MODO_HOOK ? 'gate:auditoria (hook)' : 'gate:auditoria';
if (!MODO_HOOK) console.log(c.gris(vivo
    ? `\n  Inventario de producción: leído en vivo (${vivo.tablas.length} tablas, ${vivo.crons.length} crons).`
    : `\n  Inventario de producción: foto guardada${errorVivo ? ` — sin canal en vivo (${errorVivo})` : ''}.`));

if (fallas.length) {
    console.error(`\n  ${c.rojo('✗')} ${c.ne(etiqueta)} — ${fallas.length} hallazgo(s) bloqueante(s)\n`);
    for (const f of fallas) {
        console.error(`  ${c.rojo('•')} ${c.ne(f.titulo)}`);
        (f.detalle || []).forEach(d => console.error(`      ${c.gris(d)}`));
        if (f.arreglo) console.error(`      ${f.arreglo}\n`);
        else console.error('');
    }
    if (avisos.length && VERBOSO) avisos.forEach(a => console.error(`  ${c.ama('!')} ${a.titulo}`));
    process.exit(1);
}

if (avisos.length && (!MODO_HOOK || VERBOSO)) {
    console.log(`\n  ${c.ama('!')} ${avisos.length} aviso(s):`);
    for (const a of avisos) {
        console.log(`    ${c.ama('·')} ${a.titulo}`);
        if (VERBOSO) {
            (a.detalle || []).forEach(d => console.log(`        ${c.gris(d)}`));
            if (a.arreglo) console.log(`        ${c.gris(a.arreglo)}`);
        }
    }
}

if (!MODO_HOOK && !SOLO_MAPA) informe();
console.log(`  ${c.verde('✓')} ${etiqueta}\n`);
