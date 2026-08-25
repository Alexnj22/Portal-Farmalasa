#!/usr/bin/env node
/**
 * gate:movil — que no se pueda escribir a mano lo que ya es canónico.
 *
 * Fase 1 de `docs/planes-cerrados/PLAN-CANON-MOVIL-2026-08-07.md`.
 *
 * ── Qué NO hace, y es lo importante ─────────────────────────────────────────
 * Este gate **nunca podrá decir «esta vista se ve bien»**. Leer el fuente no
 * alcanza para saber si algo desborda, si un blanco mide menos de 44pt o si una
 * vista cae a tabla en el teléfono: eso lo mide el barrido dinámico
 * (`tests/e2e/barrido-total-movil.spec.js`), que abre la vista de verdad.
 *
 * Su trabajo es más chico y más honesto: **detectar que alguien volvió a
 * escribir a mano un elemento que ya tiene variante móvil canónica**. Es lo
 * único de las tres capas que se puede ver sin ejecutar nada, y es justo lo que
 * el barrido NO ve, porque una tabla escrita a mano dentro de un carril mide
 * perfecto y aun así es deuda.
 *
 * La tabla de correspondencia elemento→variante vive en `DESIGN.md §32`.
 *
 * ── Por qué el `sinAcuse` no está acá ───────────────────────────────────────
 * El acuse del toque (`hover:` sin `active:`) se pensó para este gate y se sacó
 * al escribirlo: el medidor dinámico ya lo cuenta bien, mirando el atributo
 * `class` renderizado, y detectarlo estáticamente obliga a parsear el tag JSX
 * completo —que puede abarcar quince líneas— para no acusar de más. Dos
 * detectores del mismo defecto, uno peor, es cómo empiezan a divergir los
 * números. Vive en la capa C.
 *
 * Uso:
 *   npm run gate:movil
 *   npm run gate:movil -- --json
 *   npm run gate:movil -- --update-baseline    (solo al BAJAR deuda)
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── `--hook`: leer del ÍNDICE, no del disco ─────────────────────────────────
// El árbol de trabajo es compartido —hay otras sesiones editando— y un gate que
// lee el disco ve archivos a medio guardar. Pasó dos veces el mismo día con
// `gate:design`: rojo en una corrida (`formato-cifra`, después `copy-vacio`) y
// verde en la siguiente sin que nadie tocara nada. Un ratchet que se mueve solo
// deja de ser un ratchet.
//
// En modo hook el contenido sale de `git show :<ruta>`, que es exactamente lo
// que se va a commitear. Fuera del hook se lee el disco, que es lo que uno
// quiere mientras trabaja.
const MODO_HOOK = process.argv.includes('--hook');
const leer = (rutaAbs, rel) => {
    if (!MODO_HOOK) return readFileSync(rutaAbs, 'utf8');
    try {
        return execFileSync('git', ['show', `:${rel}`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    } catch {
        return readFileSync(rutaAbs, 'utf8');   // sin versionar todavía
    }
};

// ── El HTML que se imprime no es la interfaz ─────────────────────────────────
//
// Las reglas buscan patrones de JSX sobre el texto del archivo, y eso también
// alcanzaba a los literales de plantilla. Ocho de los 26 `tabla-a-mano` del
// 2026-08-08 eran cadenas que van a `openPrintWindow`: la boleta de pago y la
// planilla de `PayrollView` (6) y la cotización impresa de `CotizacionesView`
// (2). Una boleta de pago **es** una tabla y `DataTable` no tiene nada que
// hacer ahí — no llega nunca al DOM de la app.
//
// Así que el contenido de los backticks se reemplaza por espacios antes de
// mirar. Espacios y no borrado: los saltos de línea se conservan para que los
// hallazgos que sí quedan sigan reportando su línea real.
//
// JSX no vive dentro de backticks, así que esto no puede esconder un hallazgo
// verdadero. **Salvo un caso, que hoy no ocurre:** una plantilla inyectada con
// `dangerouslySetInnerHTML` sí sería interfaz, y esta regla ya no la vería. Los
// cuatro sitios de hoy son impresión; si alguna vez se inyecta HTML construido
// a mano, hay que revisar esto.
//
// Se aplica a TODAS las reglas y no sólo a `tabla-a-mano`: ninguna busca algo
// que pueda vivir legítimamente dentro de una plantilla de texto.
const sinPlantillas = (texto) => texto.replace(
    /`(?:\\[\s\S]|\$\{(?:[^{}]|\{[^}]*\})*\}|[^\\`])*`/g,
    (bloque) => bloque.replace(/[^\n]/g, ' '),
);

const RAIZ = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const BASELINE_PATH = join(RAIZ, 'scripts/mobile-gate-baseline.json');
const RAICES = ['src/views', 'src/components'];

// ── Excepciones con MOTIVO ───────────────────────────────────────────────────
// Formato: 'ruta/relativa.jsx': { categoria: 'por qué' }
//
// Una excepción NO es lo mismo que un número en el baseline. El baseline dice
// «esto hay que bajarlo»; la excepción dice «esto está bien así». Mezclarlos
// hace que una categoría nunca llegue a cero y que nadie sepa cuál de los dos
// mensajes está leyendo.
const EXCEPCIONES = {
    'src/components/forms/FormPurchaseDteViewer.jsx': {
        'tabla-a-mano': 'Reproduce el documento fiscal del proveedor. Su forma ES una tabla: las columnas son las del DTE y cambiarlas sería mostrar otro documento.',
    },
    'src/components/forms/FormSalesDteViewer.jsx': {
        'tabla-a-mano': 'Igual que el visor de compras: es la representación del DTE emitido, no una lista de registros del portal.',
    },
    'src/views/schedule-tabs/components/ScheduleCalendar.jsx': {
        'tabla-a-mano': 'Calendario semanal: la fila no es un registro, es un empleado cruzado con siete días. Siete columnas no entran en 390px de ninguna forma y deslizar un calendario es lo que se espera de un calendario.',
    },
    'src/views/contabilidad/CorteZView.jsx': {
        'tabla-a-mano': 'Corte Z: documento fiscal con su formato propio, no una lista del portal.',
    },
    // ── Las cuatro del 2026-08-08 ────────────────────────────────────────────
    // Salieron de abrir los 26 hallazgos uno por uno. El criterio es el mismo
    // que ya usaban las de arriba y quedó escrito en DESIGN.md §32: **la fila
    // tiene que ser un registro**. Donde la fila es una entidad CRUZADA con sus
    // columnas —una matriz—, el modo ficha no tiene qué mostrar: una ficha por
    // fila repetiría el nombre de la fila y listaría las columnas debajo, que es
    // exactamente la tabla otra vez, más larga.
    'src/views/EncuestaView.jsx': {
        'tabla-a-mano': 'Las tres son matrices de la encuesta: la fila es un bloque cruzado con dos poblaciones (jefes y colaboradores) más su diferencia en puntos. La fila no es un registro que se pueda abrir.',
    },
    'src/views/EncuestaAdminView.jsx': {
        'tabla-a-mano': 'Matriz empleados × bloques (B1..Bn): la cantidad de columnas la decide la encuesta, no el diseño. Comparar a un empleado con el de al lado es para lo que existe la vista.',
    },
    'src/components/forms/FormAiSchedulerPreview.jsx': {
        'tabla-a-mano': 'Empleados × los siete días de la semana — el mismo caso que ScheduleCalendar, que ya está acá arriba por el mismo motivo. Siete columnas no entran en 390px de ninguna forma y deslizar un horario es lo que se espera de un horario.',
    },
    'src/views/branch-tabs/TabHistory.jsx': {
        'tabla-a-mano': 'Vive dentro de `hidden print:block`: es el reporte que se imprime, no se ve nunca en pantalla. En papel no hay modo ficha ni teléfono.',
    },
};

const exceptuado = (archivo, categoria) => Boolean(EXCEPCIONES[archivo]?.[categoria]);

// ── Recorrido ────────────────────────────────────────────────────────────────
function* archivosJsx(dir) {
    for (const nombre of readdirSync(dir)) {
        const ruta = join(dir, nombre);
        if (statSync(ruta).isDirectory()) { yield* archivosJsx(ruta); continue; }
        if (/\.jsx$/.test(nombre)) yield ruta;
    }
}

const lineaDe = (texto, indice) => texto.slice(0, indice).split('\n').length;


// ── Leer las tablas de un archivo ────────────────────────────────────────────
//
// Un `<DataTable>` se lee entero —etiqueta de apertura, prop `movil` y cuerpo
// hasta su `</DataTable>` PROPIO— porque hay tablas anidadas: el detalle de una
// venta es otra `DataTable` dentro de la fila expandida de la primera. Cortar
// en el primer `</DataTable>` le daba a la de afuera el cuerpo de la de adentro.
//
// El valor de `movil` puede ser un objeto literal o el nombre de una constante
// del mismo archivo (`movil={MOVIL}`). Se resuelve la constante: sin eso el
// detector acusa a una vista que declaró bien lo suyo, que es exactamente cómo
// un gate se termina desactivando.
function leerEtiqueta(texto, inicio) {
    let llaves = 0, cadena = null;
    for (let i = inicio; i < texto.length; i++) {
        const c = texto[i];
        if (cadena) { if (c === cadena && texto[i - 1] !== '\\') cadena = null; continue; }
        if (c === '"' || c === "'" || c === '`') { cadena = c; continue; }
        if (c === '{') llaves++;
        else if (c === '}') llaves--;
        else if (c === '>' && llaves === 0) return { etiqueta: texto.slice(inicio, i + 1), fin: i + 1 };
    }
    return { etiqueta: texto.slice(inicio), fin: texto.length };
}

// El `{...}` balanceado que sigue a `movil=`.
function valorDeMovil(etiqueta) {
    const i = etiqueta.indexOf('movil=');
    if (i === -1) return null;
    const j = etiqueta.indexOf('{', i);
    if (j === -1) return null;
    let llaves = 0;
    for (let k = j; k < etiqueta.length; k++) {
        if (etiqueta[k] === '{') llaves++;
        else if (etiqueta[k] === '}' && --llaves === 0) return etiqueta.slice(j + 1, k).trim();
    }
    return null;
}

function tablasDeDataTable(texto) {
    const out = [];
    for (const m of texto.matchAll(/<DataTable\b/g)) {
        const { etiqueta, fin } = leerEtiqueta(texto, m.index);
        if (etiqueta.endsWith('/>')) continue;                 // tabla sin cuerpo

        // El `</DataTable>` propio: contar aperturas anidadas.
        let profundidad = 1, cursor = fin, cierre = texto.length;
        while (profundidad > 0) {
            const abre  = texto.indexOf('<DataTable', cursor);
            const baja  = texto.indexOf('</DataTable>', cursor);
            if (baja === -1) break;
            if (abre !== -1 && abre < baja) { profundidad++; cursor = abre + 10; continue; }
            profundidad--; cursor = baja + 12;
            if (profundidad === 0) cierre = baja;
        }
        const cuerpo = texto.slice(fin, cierre);

        let movilTexto = valorDeMovil(etiqueta) ?? '';
        // `movil={NOMBRE}` — resolver la constante del mismo archivo.
        if (/^[A-Za-z_$][\w$]*$/.test(movilTexto)) {
            const def = texto.match(new RegExp(`\\bconst\\s+${movilTexto}\\s*=\\s*\\{([^]*?)\\};`));
            if (def) movilTexto = def[1];
            else if (movilTexto !== 'false') movilTexto = '';   // no se pudo leer: no acusar
        }
        const movil = /^\s*false\s*$/.test(movilTexto) ? false : movilTexto;

        // ¿Alguna `<DataRow …>` del cuerpo lleva `onClick`? Se lee la etiqueta
        // completa: un `onClick` suelto puede ser de un botón dentro de una celda.
        let filasConOnClick = false;
        for (const r of cuerpo.matchAll(/<DataRow\b/g)) {
            if (/\bonClick\s*=/.test(leerEtiqueta(cuerpo, r.index).etiqueta)) { filasConOnClick = true; break; }
        }

        out.push({ linea: lineaDe(texto, m.index), movil, movilTexto, cuerpo, filasConOnClick });
    }
    return out;
}

// ── Las reglas ───────────────────────────────────────────────────────────────
// Cada una devuelve hallazgos { categoria, linea, detalle }.
const REGLAS = [
    {
        // Una lista de registros escrita a mano no hereda NADA: ni el modo
        // ficha, ni el alto de fila por densidad, ni el contrato de teclado de
        // la fila clickeable. Y en el teléfono se ve como una tabla, que es el
        // problema que el modo ficha vino a resolver.
        categoria: 'tabla-a-mano',
        aplica: (rel) => !rel.endsWith('common/DataTable.jsx'),
        buscar(texto) {
            return [...texto.matchAll(/<table[\s>]/g)].map(m => ({
                linea: lineaDe(texto, m.index),
                detalle: '`<table>` escrita a mano — usar `DataTable`, que en el teléfono cae solo a fichas. Si la fila NO es un registro, `movil={false}` con el motivo escrito.',
            }));
        },
    },
    {
        // `ModalShell` resuelve CÓMO ENTRA el diálogo (desde abajo, en táctil).
        // Lo que falta después es cómo se ve POR DENTRO: un modal con lo primero
        // y sin lo segundo entra bien y adentro es una pantalla de escritorio
        // encogida.
        //
        // ⚠️ `LiquidModal` CUENTA como cuerpo canónico. La primera versión de
        // esta regla lo trataba como si fuera `ModalShell` crudo y acusó a 11
        // archivos que hacen lo correcto —los cuatro lanzadores del tablero,
        // los modales de Metas y de Pedidos—. `LiquidModal` compone
        // `ModalShell` + `AsaHoja` y su propio encabezado dice por qué no se
        // reescribió sobre `HojaMovil`: es un canónico de composición
        // (`Header`/`Body`/`Footer` con JSX arbitrario) y `HojaMovil` no lo es.
        // Acusar al que hizo bien el trabajo es el modo de falla que este
        // proyecto ya conoce, y es cómo un gate se termina desactivando.
        categoria: 'modal-sin-cuerpo-canonico',
        aplica: (rel) => /^src\/views\//.test(rel),
        // Y se busca el TAG (`<ModalShell`), no el nombre: la segunda ronda de
        // falsos positivos fueron dos archivos donde `ModalShell` aparece sólo
        // dentro de un comentario —«no ModalShell — rendered inside parent's
        // ModalShell»—, o sea que el detector estaba acusando a un archivo por
        // explicar que NO lo usa. Un detector que lee prosa no sólo acusa de
        // más: es inestable, y un ratchet que se mueve solo deja de ser ratchet.
        buscar(texto) {
            if (!/<ModalShell[\s>]/.test(texto)) return [];
            if (/<(HojaMovil|ExpedienteMovil|CuerpoDialogo|LiquidModal)[\s>.]/.test(texto)) return [];
            const m = texto.match(/<ModalShell[\s>]/);
            return [{
                linea: lineaDe(texto, m.index),
                detalle: '`ModalShell` crudo: entra bien pero adentro no tiene anatomía móvil. Usar `LiquidModal` (composición) o `HojaMovil` (cuerpo cerrado), o `ExpedienteMovil` si es el detalle de una fila.',
            }];
        },
    },
    {
        // Cada buscador a mano se lleva su propia copia de los bugs que
        // `ViewTabBar` ya arregló. Pasó con el tamaño del botón: 22 archivos
        // seguían con la medida anterior al arreglo, y hubo que parchear el
        // síntoma dos veces (§32).
        categoria: 'buscador-a-mano',
        aplica: (rel) => /^src\/views\//.test(rel),
        // Tiene que ser un `<input>` LITERAL. Buscar sólo el placeholder acusaba
        // a un `<CatalogSelect placeholder="Buscar y agregar producto…">`, que
        // es un canónico haciendo lo suyo: el patrón que interesa es la píldora
        // + input escrita a mano, no cualquier campo que diga «Buscar».
        buscar(texto) {
            if (/\b(SearchInput|ViewTabBar|useBuscadorDeVista)\b/.test(texto)) return [];
            const out = [];
            for (const m of texto.matchAll(/<input\b/g)) {
                const ventana = texto.slice(m.index, m.index + 500);
                if (!/placeholder\s*=\s*["'`]\s*Buscar/i.test(ventana)) continue;
                out.push({
                    linea: lineaDe(texto, m.index),
                    detalle: 'Buscador propio en vez del canónico — usar `ViewTabBar` o `SearchInput`. Cada copia se lleva los bugs que el canónico ya arregló (§32).',
                });
            }
            return out;
        },
    },
    {
        // ── El toque de la ficha que no lleva a ningún lado ──────────────────
        //
        // `DataTable` no puede saber si el `onClick` de una fila NAVEGA o
        // EXPANDE: desde afuera un manejador es una caja cerrada. Así que el
        // default es lo que siempre existe —su hoja genérica, que lista las
        // columnas restantes— y la vista cuyo toque va a un destino de verdad lo
        // declara con `movil={{ usarAccionDeFila: true }}`.
        //
        // Es un opt-in, o sea una prop que se olvida. Medido el 2026-08-20 sobre
        // las 59 tablas del portal: **16 estaban mal**, o sea el 27%. Entre
        // ellas Facturas de compra y Ventas, donde el toque abre el documento
        // con sus productos y su archivo — y en el teléfono abría una hoja que
        // sólo repetía las columnas de la tarjeta. Lo reportó el usuario:
        // «cuando abro una card me da información, pero muy reducida, no puedo
        // ver los productos, no puedo ver el PDF».
        //
        // El defecto es SILENCIOSO por los dos lados: no hay error, no hay fila
        // de menos, y en escritorio todo funciona. La misma trampa que
        // `inferirPapeles` ya tiene escrita en `DataTable` —«una prop opt-in es
        // una prop olvidada»—, sólo que ahí la inferencia la tapa y acá no hay
        // nada que inferir. Por eso la vigila un gate y no un comentario.
        //
        // ── Lo que este detector NO ve ───────────────────────────────────────
        // Filas envueltas en un componente propio (`memo(EmployeeRow)`): desde
        // el fuente no se puede saber si adentro hay un `onClick`. Es el mismo
        // límite que ya tiene `limpiarFilas` en el canónico, y por eso vale
        // decirlo: un verde acá no prueba que las 59 tablas estén bien, prueba
        // que ninguna de las que se pueden leer quedó sin declarar.
        categoria: 'toque-de-ficha-sin-destino',
        aplica: (rel) => !rel.endsWith('common/DataTable.jsx'),
        buscar(texto) {
            const out = [];
            for (const t of tablasDeDataTable(texto)) {
                if (t.movil === false) continue;              // no hay fichas: no hay toque que redirigir
                if (/usarAccionDeFila\s*:\s*true/.test(t.movilTexto)) continue;
                if (!/<DataRow\b[^]*?\bonClick\s*=/.test(t.cuerpo)) continue;
                // `onClick` dentro de un `<DataRow>`, no en un botón de la celda.
                if (!t.filasConOnClick) continue;
                out.push({
                    linea: t.linea,
                    detalle: 'La fila tiene `onClick` y la tabla no declara `movil={{ usarAccionDeFila: true }}`: en el teléfono el toque abre la hoja genérica —que sólo repite las columnas— en vez del destino real. Si el `onClick` expande un `<tr colSpan>`, el destino en el teléfono es `ExpedienteMovil` (§32).',
                });
            }
            return out;
        },
    },
    {
        // `movil={false}` es la salida legítima para una tabla cuya fila no es
        // un registro. Justamente por eso necesita motivo: sin él es el atajo
        // más fácil para hacer callar al modo ficha cuando cuesta adaptarlo.
        categoria: 'movil-false-sin-motivo',
        aplica: (rel) => !rel.endsWith('common/DataTable.jsx'),
        buscar(texto) {
            const lineas = texto.split('\n');
            const out = [];
            lineas.forEach((l, i) => {
                if (!/movil\s*=\s*\{\s*false\s*\}/.test(l)) return;
                const contexto = lineas.slice(Math.max(0, i - 4), i).join('\n');
                if (/\/\/|\/\*|\*/.test(contexto)) return;   // hay un comentario arriba
                out.push({
                    linea: i + 1,
                    detalle: '`movil={false}` sin motivo escrito arriba. Es la excepción del canon: decir por qué esta fila no es un registro.',
                });
            });
            return out;
        },
    },
];

// ── Corrida ──────────────────────────────────────────────────────────────────
const hallazgos = [];
for (const raiz of RAICES) {
    let dir;
    try { dir = join(RAIZ, raiz); statSync(dir); } catch { continue; }
    for (const ruta of archivosJsx(dir)) {
        const rel = relative(RAIZ, ruta);
        const texto = sinPlantillas(leer(ruta, rel));
        for (const regla of REGLAS) {
            if (regla.aplica && !regla.aplica(rel)) continue;
            if (exceptuado(rel, regla.categoria)) continue;
            for (const h of regla.buscar(texto)) {
                hallazgos.push({ archivo: rel, categoria: regla.categoria, ...h });
            }
        }
    }
}

const porCategoria = {};
for (const h of hallazgos) porCategoria[h.categoria] = (porCategoria[h.categoria] || 0) + 1;
for (const r of REGLAS) porCategoria[r.categoria] ??= 0;

if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ porCategoria, hallazgos }, null, 2));
    process.exit(0);
}

if (process.argv.includes('--update-baseline')) {
    writeFileSync(BASELINE_PATH, JSON.stringify({
        _comment: 'Ratchet de gate:movil. Falla si una categoría SUBE. Regenerar SOLO al bajar deuda: npm run gate:movil -- --update-baseline. Nunca para tapar un hallazgo nuevo: si subió, es código nuevo que hay que arreglar.',
        updated: new Date().toISOString().slice(0, 10),
        categories: porCategoria,
    }, null, 2) + '\n');
    console.log(`✓ Baseline actualizado en ${relative(RAIZ, BASELINE_PATH)}`);
    process.exit(0);
}

let baseline = {};
try { baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).categories || {}; } catch { /* sin baseline: todo es deuda nueva */ }

const categorias = [...new Set([...Object.keys(porCategoria), ...Object.keys(baseline)])].sort();
const subieron = categorias.filter(c => (porCategoria[c] || 0) > (baseline[c] ?? 0));

if (subieron.length) {
    const malas = new Set(subieron);
    const porArchivo = {};
    for (const h of hallazgos) {
        if (!malas.has(h.categoria)) continue;
        (porArchivo[h.archivo] ??= []).push(h);
    }
    for (const [archivo, hs] of Object.entries(porArchivo)) {
        console.log(`\n${archivo} (${hs.length})`);
        for (const h of hs.slice(0, 8)) console.log(`  L${h.linea} [${h.categoria}] ${h.detalle}`);
    }
}

console.log('\n── Estado por categoría ' + '─'.repeat(34));
for (const c of categorias) {
    const ahora = porCategoria[c] || 0;
    const tope = baseline[c] ?? 0;
    const marca = ahora > tope ? '✗' : ahora < tope ? '↓' : ahora === 0 ? '✓' : '·';
    const nota = ahora > tope ? `SUBIÓ +${ahora - tope}`
        : ahora < tope ? `bajó -${tope - ahora} (correr --update-baseline)` : '';
    console.log(`  ${marca} ${c.padEnd(24)} ${String(ahora).padStart(4)} / ${String(tope).padEnd(4)} ${nota}`);
}
const conMotivo = Object.values(EXCEPCIONES).reduce((n, o) => n + Object.keys(o).length, 0);
console.log(`\n  excepciones con motivo escrito: ${conMotivo}  ·  canon: DESIGN.md §32`);

if (subieron.length) {
    console.log(`\n✗ ${subieron.length} categoría(s) con deuda nueva: ${subieron.join(', ')}\n`);
    process.exit(1);
}
console.log(`\n✓ Sin deuda nueva. ${hallazgos.length} hallazgo(s) bajo baseline.\n`);
process.exit(0);
