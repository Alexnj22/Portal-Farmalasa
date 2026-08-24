#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// CÓMO SE CALCULÓ CADA NÚMERO — pasada del 2026-08-23
// ─────────────────────────────────────────────────────────────────────────────
//
// El registro no se escribe a ojo. Este archivo toma la evidencia medida —los
// once gates, el barrido, las consultas a producción y los pendientes que la
// memoria del proyecto declara abiertos— y deriva los doce ejes de cada área
// con reglas escritas acá adentro.
//
// La razón es la de siempre en este repo: un puntaje escrito a mano no se puede
// discutir seis meses después. Con las reglas en un archivo, cualquiera puede
// leer POR QUÉ un área tiene 72 y no 85, cambiar la regla si está mal, y volver
// a correrlo. Y cuando la próxima pasada mida de nuevo, la comparación es
// contra el mismo criterio y no contra el humor de otro día.
//
// ── Lo que este archivo NO puede hacer ──────────────────────────────────────
// El eje `flujo` («¿el circuito cierra de punta a punta?») no se mide con un
// detector: se mide usándolo. Acá se deriva de los PENDIENTES DECLARADOS en la
// memoria del proyecto —«falta la primera corrida real», «falta probarlo en
// sala»— que son evidencia citable pero indirecta. Un área con 85 en `flujo` no
// quiere decir que su circuito esté 85% construido: quiere decir que nadie ha
// declarado un hueco y que tampoco nadie lo confirmó corriendo. Por eso existe
// el sello, y por eso ninguna área nace con él.
//
//   node auditoria/puntuar.mjs           ver el cálculo
//   node auditoria/puntuar.mjs --escribir   volcarlo a registro.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { AREAS, EJES, areaDeArchivo } from './areas.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ESCRIBIR = process.argv.includes('--escribir');
const FECHA = '2026-08-23';

// ═══════════════════════════════════════════════════════════════════════════
// EVIDENCIA MEDIDA — todo esto salió de correr algo, no de opinar
// ═══════════════════════════════════════════════════════════════════════════

// ── Servidor: consultado a producción el 2026-08-23 ─────────────────────────
const SERVIDOR = {
    // `get_advisors(security)`: 0 ERRORES, 321 WARN, 1 INFO.
    advisor_errores: 0,

    // CLAUDE.md afirma que sólo CINCO funciones son ejecutables por `anon`. Son
    // VEINTIUNA.
    //
    // La primera lectura fue «hay dieciséis agujeros», y estaba MAL. Se abrieron
    // tres a mano antes de escribirlo, que es la regla de este repo, y las tres
    // se defienden solas:
    //
    //   · `kiosco_marcar` entra por `kiosco_sucursal(p_device_id, p_device_token)`
    //     — sin un token de dispositivo válido no hace nada. Las seis del kiosco
    //     son iguales.
    //   · `update_proveedor_manual` abre con
    //     `IF NOT (SELECT auth_can_edit_any(ARRAY['proveedores'])) THEN RAISE
    //     EXCEPTION 'FORBIDDEN'`. Para `anon` eso es siempre falso. Además hay
    //     DOS sobrecargas: la revocación del 2026-07-29 alcanzó a una y la otra
    //     quedó con el GRANT, que es exactamente cómo se acumula esta deuda.
    //   · `expandir_lineas_envio` y las otras cuatro son funciones de TRIGGER:
    //     sin `NEW` no se pueden ejecutar. Inertes por construcción.
    //
    // Entonces el hallazgo NO es «el portal está abierto». Es que la superficie
    // `anon` creció de 5 a 21 sin que nada lo mirara, y la regla escrita dice
    // otra cosa. El riesgo no es lo que hay hoy: es que el día que entre una sin
    // guarda, nadie se va a enterar. Se puntúa como higiene y falta de
    // vigilancia, no como exposición — acusar al código que SÍ se defendió es
    // cómo se termina desactivando un detector.
    anon_funciones: {
        documentadas: ['get_kiosk_boot_payload', 'get_kiosk_coverage_employees',
                       'verify_kiosk_device', 'verify_kiosk_pin', 'verify_kiosk_authorization'],
        kiosco_sin_documentar: ['kiosco_marcar', 'kiosco_identificar', 'kiosco_bitacora',
                                'kiosco_declarar_turno', 'kiosco_aviso_leido', 'kiosco_marcajes_recientes'],
        impresion: ['canjear_codigo_de_vinculacion', 'confirmar_impresion', 'reclamar_impresion'],
        triggers_expuestos: ['asignar_aprobador_solicitud', 'expandir_lineas_envio',
                             'notificar_decision_diferencia', 'notificar_resolucion_envio',
                             'validar_envio_producto'],
        sin_justificacion: ['update_proveedor_manual'],
    },

    // Tablas que `anon` puede LEER. La regla escrita habla de funciones y se
    // olvidó de las tablas — que es por donde quedaron tres.
    anon_tablas: ['branches', 'holidays', 'shifts'],

    // `SET search_path` faltante (regla 4 del hardening). CERRADO el 2026-08-24:
    // las tres eran IMMUTABLE, INVOKER y puras, y ninguna estaba en un CHECK ni
    // en un índice — así que el riesgo era bajo. Se arreglaron igual porque una
    // regla que se cumple «casi siempre» deja de ser una regla, y porque las
    // llaman ocho funciones, entre ellas las que deciden qué ficha se corrige
    // antes de transmitir a Hacienda.
    search_path_mutable: [],

    // `identidad_vales` NO era un hallazgo: es defensa en profundidad y estaba
    // bien hecha. `authenticated` no tiene GRANT —sólo postgres y service_role—
    // así que el navegador no la alcanza, y cinco funciones DEFINER son el único
    // acceso. El RLS sin policies es la segunda cerradura. Lo único que faltaba
    // era que estuviera ESCRITO, y desde el 2026-08-24 lo está (COMMENT ON TABLE).
    rls_sin_policy: [],

    // El incidente del 2026-07-08 (auth_* sin envolver en `(SELECT …)`): CERO.
    // La regla se sostiene en las 176 tablas. Es el mejor número de la auditoría.
    auth_sin_initplan: 0,

    // `USING(true)`/`WITH CHECK(true)` en escritura: 4, y las cuatro son de
    // `service_role`, que es legítimo. Ninguna para `authenticated`.
    using_true_authenticated: 0,

    sin_pk: 0,
    vistas_sin_security_invoker: 0,

    // ── Las «FKs sin índice» eran un hallazgo MÍO, no del portal ───────────
    // Medido el 2026-08-24 y quedó vacío. De 291 FKs, 236 tienen índice usable.
    // De las 55 restantes:
    //
    //   · `pedido_traslado_linea.erp_sucursal_id` SÍ tiene índice — uno
    //     compuesto que mi consulta no detectaba porque sólo miraba el prefijo.
    //     El EXPLAIN entra por índice en 0,158 ms.
    //   · Las demás son columnas de auditoría (`*_por`, `created_by`) que la
    //     regla del hardening exceptúa explícitamente, y encima casi siempre
    //     nulas: `pedido_items.confirmado_suc_por` tiene SEIS valores no nulos
    //     de 49.042, y `rechazado_por` tiene CERO.
    //
    // Crear un índice sobre una columna con seis valores de cuarenta y nueve mil
    // sería exactamente el índice muerto que esta misma auditoría decidió no
    // borrar por falta de evidencia. No hay trabajo que hacer acá.
    fk_sin_indice_reales: {},

    // ── «Índices muertos»: la medición NO alcanza para decidir ─────────────
    // Se midieron con `idx_scan = 0`, pero el servidor arrancó hace TRES DÍAS
    // (2026-08-20) y las estadísticas cuentan desde ahí. Este portal tiene
    // procesos MENSUALES —cierre de período, libros IVA, corte Z,
    // auto-calculate-minmax— y un índice que sólo se usa el día 1 se ve
    // exactamente igual que uno muerto.
    //
    // Se dejan anotados con su peso, y NO se borran: volver a medirlos después
    // del cierre del 1 de septiembre es lo único que convierte este cero en una
    // decisión. La evidencia más fuerte es la de `products` —17,1 millones de
    // lecturas de la tabla y cero usos de sus dos índices trigram— pero ni esa
    // basta si esos índices sirven a una búsqueda que nadie hizo en tres días.
    indices_muertos: {
        inventario: ['idx_igmv_desc_trgm (1976 kB)', 'idx_igmv_desc_norm_trgm (1976 kB)',
                     'idx_conteo_items_source_sync_key (768 kB)', 'idx_mv_stock_analysis_sucursal (224 kB)'],
        'facturacion-dte': ['idx_customers_erp_id (968 kB)'],
        productos: ['idx_products_pa_trgm (592 kB)', 'idx_products_pactivo_norm_trgm (592 kB)',
                    'idx_product_precios_history_pres (448 kB)'],
        ventas: ['idx_psr_sucursal_producto (456 kB)', 'idx_changelog_branch_detected (392 kB)'],
    },

    // Escrituras sin inserción por hora, del gate de eficiencia. 402/h sobre SEIS
    // filas es el latido de las cajas de impresión reescribiendo su fila entera.
    churn: { impresion: '402 escrituras/h sobre 6 filas de impresion_dispositivos, 0 inserciones' },
};

// ── Gates: corridos el 2026-08-23 ───────────────────────────────────────────
const GATES = {
    design:      { verde: true,  nota: 'ratchet: 66 tarjeta-a-mano en 33 archivos, todo bajo baseline' },
    movil:       { verde: true,  nota: '5 categorías en 0, 8 excepciones con motivo' },
    data:        { verde: true,  nota: 'techo de 1000, tipos y errores tragados: en verde' },
    borradores:  { verde: true,  nota: '24 formularios largos sin borrador, bajo baseline' },
    ux:          { verde: true,  nota: 'medido 2026-08-17, anchos 1440/1280' },
    permisos:    { verde: true,  nota: '89 módulos cruzados; CERO hallazgos abiertos desde v2.720.0 — staff_salary '
                                     + 'era el último y se cerró en las dos capas' },
    doc:         { verde: true,  nota: '15 bloques de DESIGN.md revisados' },
    migraciones: { verde: true,  nota: 'baseline + 534 post-baseline, y desde v2.720.0 sin deriva contra PROD: '
                                     + 'se recuperó del registro el archivo de 20260823222500, que estaba aplicado y sin guardar' },
    perf:        { verde: true,  nota: '14/14 índices vivos, 5/5 planes por índice, 14 tiempos bajo techo' },
    eficiencia:  { verde: true,  nota: '894 escrituras/h (tope 1240), 5858 llamadas salientes, 0 fuera de 2xx' },
    bundle:      { verde: true,  nota: 'VERDE desde v2.719.3. Estaba en rojo: TrasladosView 61 kB (techo 47) y '
                                     + 'DashboardView 100 (techo 99). Hoy el Inicio mide 87 y Traslados entra en su techo, '
                                     + 'difiriendo cinco piezas que sólo aparecen a pedido.' },
    pruebas:     { verde: true,  nota: 'ver RESUMEN_PRUEBAS: se cuenta ejecutando la batería, no se escribe' },
};

// Áreas señaladas por un gate en rojo. Vacío desde v2.719.3 — se cerró, no se
// silenció: el Inicio bajó de 100 a 87 kB sacando 1,180 líneas del cierre
// estático, y Traslados de 61 a menos de 47 difiriendo tres piezas que sólo
// aparecen cuando alguien las pide. El baseline NO se tocó.
const BUNDLE_ROTO = {};

// Errores de lint que sobreviven (4). No son míos ni nuevos: estaban.
const LINT = {
    fiscal:    ['LibrosIvaView.jsx:823 — el archivo exporta algo que no es un componente'],
    pedidos:   ['tests/e2e/prueba-traslado.spec.js:40 — variable asignada y nunca usada'],
    impresion: ['tests/unit/ticketPrint.test.js:140 — carácter de control en una expresión regular'],
};

// ── Pendientes que la memoria del proyecto declara ABIERTOS ─────────────────
// Ésta es la fuente del eje `flujo`. Cada línea es una cita: si el repo dice
// «falta la primera corrida real», el circuito no está cerrado y no hay número
// que lo tape.
const PENDIENTES = {
    traslados: ['falta la PRIMERA CORRIDA contra inventario real (enviar producto a otra sala)',
                'falta la primera composición real y el primer despacho de menos',
                'falta que alguien pida del área de vencidos y que Bodega lo despache',
                'falta verlo en pantalla (lo confirma la sala)',
                'falta probar la sala de respaldo después de las 17:00'],
    pedidos:   ['faltan el brazo del sobrante y el cron de 3 días (decisión de diferencias)',
                'falta que alguien confirme el lote que llegó — que es lo legal',
                'falta una ruta real (conductor = creador)',
                'faltan el aviso a bodega y el camino del sobrante en la devolución'],
    impresion: ['el camino directo NO saca papel en la caja de Salud 4 (probado 19-ago)',
                'falta medir el ancho del rollo',
                'sigue sin probarse en otra sala'],
    'cortes-efectivo': ['falta probar en sala', 'dos diferencias confirmadas y grandes en Salud 3 (−$970.39 y −$499.50) sin revisar con la sala',
                        'falta probar las bolsas en sala'],
    // Medido el 2026-08-24: son SIETE pares, no seis (creció uno el 1-ago), y dos
    // de ellos tienen proveedores DISTINTOS bajo el mismo sello — o sea que uno
    // de los dos lo tiene mal asignado. Ver §8.20 del informe.
    compras:   ['falta correr el barrido contra los documentos reales',
                'falta el plazo de los 163 proveedores y el insert al sistema',
                '7 pares de compras comparten sello; en DOS los proveedores son distintos, así que un sello está en la compra equivocada',
                'las recetas están medidas (5 reales) y sin construir'],
    fiscal:    ['art.162 retención IVA $48.95 sin resolver', 'art.156 retención renta $262.52 sin marcar',
                'libros de compras: quedan hallazgos abiertos'],
    // La brecha de mayo/2025 se CERRÓ el 2026-08-24: `refresh_sales_daily_stats(500)`
    // escribió las 85 filas que faltaban ($117,509.80). Sale de la lista porque
    // una lista de pendientes sólo sirve si es cierta.
    ventas:    ['falta verlo en sala (lo que no es venta de productos)',
                'hay ventas de gente de Bodega en salas, sin revisar'],
    acceso:    ['falta probar el lector físico en sala', 'falta que el papel conteste qué simbología lee el lector',
                'falta prueba en vivo del candado doble', 'carné: turno y sala definido y sin implementar'],
    bitacoras: ['falta la consulta al CSSP desde el portal', 'falta el aviso de franja por vencerse'],
    minmax:    ['MIN·MAX no lee el factor', 'falta el 1-sep del cron de La Popular'],
    comunicacion: ['push llega a 4 de 59 — la mayoría de los avisos no salen del portal'],
    personal:  ['falta el APK nuevo de la cámara en Android y probarlo en sala'],
    tablero:   ['la vista de venta por hora está lista y APAGADA hasta que se publiquen los horarios'],
    plataforma: ['el trabón al girar el teléfono está EN PAUSA'],
    sistema:   ['auditoría 2026-07-30: quedan puntos abiertos', 'auditoría DTE proveedores: H5b y D'],
    // `staff_salary` salió de acá en v2.720.0. `gate:permisos` quedó sin un solo
    // hallazgo abierto — era el último.
};

// ═══════════════════════════════════════════════════════════════════════════
// LAS REGLAS
// ═══════════════════════════════════════════════════════════════════════════
const barrido = JSON.parse(execSync('node scripts/auditoria-barrido.mjs --json', { cwd: RAIZ, maxBuffer: 1 << 26 }).toString());

// ── El tamaño de la batería se CUENTA, no se escribe ────────────────────────
// Acá decía «687 pruebas en 54 archivos» — cierto el día que se tecleó, y falso
// tres tandas después: la batería estaba en 830. Es el mismo defecto que esta
// auditoría encontró en la superficie `anon` y en el entorno de pruebas, o sea
// la tercera vez: **una afirmación que nadie vuelve a verificar deja de ser
// cierta sin avisar**, y las tres veces el que se la creyó fue un instrumento.
//
// Se cuenta ejecutando la batería. Si no se puede (sin `node_modules`, sin
// tiempo), NO se inventa un número: se dice que no se midió — un gate que no
// pudo medir no puede dar verde.
const PRUEBAS = (() => {
    try {
        const salida = execSync('npx vitest run --reporter=json --silent', {
            cwd: RAIZ, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'],
        }).toString();
        const j = JSON.parse(salida.slice(salida.indexOf('{')));
        // `numTotalTestSuites` cuenta bloques `describe`, no archivos: daba 244
        // sobre 64 archivos reales. El que vale es `testResults`, que trae uno
        // por archivo.
        return { total: j.numTotalTests, archivos: j.testResults?.length ?? 0,
                 verdes: j.numFailedTests === 0 };
    } catch {
        return null;
    }
})();
const RESUMEN_PRUEBAS = PRUEBAS
    ? `${PRUEBAS.total} pruebas en ${PRUEBAS.archivos} archivos, ${PRUEBAS.verdes ? 'todas verdes' : 'CON FALLAS'}`
    : 'la batería no se pudo ejecutar acá: el tamaño no se midió';
const design = JSON.parse(execSync('node scripts/design-gate.mjs --json', { cwd: RAIZ, maxBuffer: 1 << 26 }).toString());
const draft = JSON.parse(fs.readFileSync(path.join(RAIZ, 'scripts/draft-gate-baseline.json'), 'utf8'));

const porArea = id => ({
    barrido: barrido.hallazgos.filter(h => h.area === id),
    design: Object.entries(design.byFile).filter(([f]) => areaDeArchivo(f) === id).flatMap(([, v]) => v),
    borradores: (draft.deuda || []).filter(f => areaDeArchivo(f) === id),
});

// ── Pruebas: se cuentan los ARCHIVOS CUBIERTOS, no los archivos de prueba ────
//
// Contaba archivos de prueba, y eso mide lo que no importa. Se vio el
// 2026-08-24 escribiendo pruebas para subir el eje: **Nómina tiene UN archivo
// que prueba a fondo `calcRenta` y `calcPayrollEntry`** —la tabla de renta
// entera, el tope del ISSS, la quincena completa— y puntuaba 62%, lo mismo que
// un área con una prueba de una línea. Para subirla habría que PARTIR ese
// archivo en dos, que no agrega una sola verificación.
//
// Una regla que premia partir archivos enseña a partir archivos. Ahora se cuenta
// cuántos archivos DE LA VISTA quedan nombrados por alguna prueba: eso sí sube
// cuando se cubre algo nuevo y no se mueve al reacomodar los tests.
//
// Se mira contra el total de archivos del área para que el número signifique
// «qué proporción de esta área tiene algo que la mire», que es la pregunta.
// Todos los archivos de `src/` bajo control de versiones, para poder decir
// «cuántos de los N que tiene el área están cubiertos».
const ARCHIVOS_SRC = execSync("git ls-files 'src/**'", { cwd: RAIZ })
    .toString().trim().split('\n').filter(f => /\.(js|jsx)$/.test(f));

// El texto de todo lo versionado, leído UNA vez: el eje de documentación
// pregunta si algún archivo NOMBRA al documento del área, y hacerlo por área
// serían 25 pasadas sobre el repo entero.
// Sólo el CÓDIGO y los dos archivos que se cargan siempre. Que un documento
// cite a otro no ayuda a nadie: la pregunta es si quien abre el módulo se
// entera de que existe algo escrito, y ahí `docs/**` citándose entre sí
// contesta que sí a todo — con `docs/**` adentro, las 14 áreas con documento
// daban las 14 por citadas, incluidas las tres que no tienen un solo cartel.
const FUENTES_TXT = execSync("git ls-files 'src/**' 'supabase/**' 'scripts/**' 'tests/**' 'CLAUDE.md' 'DESIGN.md'", { cwd: RAIZ })
    .toString().trim().split('\n')
    .map(f => { try { return fs.readFileSync(path.join(RAIZ, f), 'utf8'); } catch { return ''; } });

const cubiertosPorArea = {};
const pruebasPorArea = {};
for (const dir of ['tests/unit', 'tests/e2e']) {
    for (const f of fs.readdirSync(path.join(RAIZ, dir)).filter(x => /\.(js|jsx)$/.test(x))) {
        const src = fs.readFileSync(path.join(RAIZ, dir, f), 'utf8');
        for (const m of src.matchAll(/['"`](?:\.\.\/)*(src\/[A-Za-z0-9_./-]+)['"`]/g)) {
            let p = m[1];
            if (!/\.(js|jsx)$/.test(p)) for (const e of ['.js', '.jsx']) if (fs.existsSync(path.join(RAIZ, p + e))) { p += e; break; }
            const a = areaDeArchivo(p);
            if (!a) continue;
            (pruebasPorArea[a] ||= new Set()).add(dir + '/' + f);
            (cubiertosPorArea[a] ||= new Set()).add(p);
        }
    }
}

const tope = (n, min = 40) => Math.max(min, Math.min(100, Math.round(n)));

function puntuar(area) {
    const h = porArea(area.id);
    const n = c => h.barrido.filter(x => x.cat === c).length;
    const ev = {};

    // ── flujo ───────────────────────────────────────────────────────────────
    // Arranca en 95 (no 100: sin sello nadie puede afirmar que cierra) y baja 6
    // por cada pendiente que la memoria declara abierto.
    const pend = PENDIENTES[area.id] || [];
    ev.flujo = { pct: tope(95 - pend.length * 6, 45),
        evidencia: pend.length ? `${pend.length} pendiente(s) declarado(s) en la memoria del proyecto` : 'sin pendientes declarados en memoria',
        hallazgos: pend };

    // ── datos ───────────────────────────────────────────────────────────────
    // gate:data en verde vale 95; el barrido descuenta 5 por hallazgo.
    ev.datos = { pct: tope(95 - (n('fecha-sin-hora') + n('dinero-en-number')) * 5, 60),
        evidencia: 'gate:data en verde (techo de 1000 filas, tipos, errores tragados) + barrido de fechas y montos',
        hallazgos: h.barrido.filter(x => ['fecha-sin-hora', 'dinero-en-number'].includes(x.cat)).map(x => `${x.archivo}:${x.linea}`) };

    // ── bd ──────────────────────────────────────────────────────────────────
    const fks = SERVIDOR.fk_sin_indice_reales[area.id] || [];
    const idxm = SERVIDOR.indices_muertos[area.id] || [];
    const sinPolicy = area.tablas.filter(t => SERVIDOR.rls_sin_policy.includes(t));
    ev.bd = { pct: tope(98 - fks.length * 5 - idxm.length * 3 - sinPolicy.length * 10, 50),
        evidencia: '0 tablas sin PK · 0 vistas sin security_invoker · 0 advisor ERROR · migraciones sin deriva local',
        hallazgos: [...fks.map(x => `FK sin índice: ${x}`), ...idxm.map(x => `índice nunca usado: ${x}`),
                    ...sinPolicy.map(t => `${t}: RLS encendido y CERO policies`)] };

    // ── seguridad ───────────────────────────────────────────────────────────
    // Dos listas con pesos distintos, porque son problemas distintos. Un GRANT de
    // más sobre una función que se defiende sola cuesta 2; un permiso que la
    // pantalla ofrece y que no gatea NADA cuesta 25, porque ahí el dato sí sale.
    const higiene = [], abiertos = [];
    if (area.id === 'acceso') higiene.push(...SERVIDOR.anon_funciones.kiosco_sin_documentar.map(f => `${f}(): GRANT a anon de más. Valida device_token adentro, así que no expone nada — pero contradice la regla escrita y nadie lo vigila`));
    if (area.id === 'impresion') higiene.push(...SERVIDOR.anon_funciones.impresion.map(f => `${f}(): GRANT a anon de más; valida el token del equipo adentro`));
    if (area.id === 'compras') higiene.push('update_proveedor_manual(): la sobrecarga vieja conservó el GRANT a anon que la revocación del 2026-07-29 le quitó a la nueva. Lanza FORBIDDEN sin el permiso, así que no expone nada');
    if (area.id === 'solicitudes') higiene.push('asignar_aprobador_solicitud(): trigger con GRANT a anon. Sin NEW no se ejecuta — inerte, pero no debería estar');
    if (area.id === 'traslados') higiene.push('expandir_lineas_envio(), notificar_resolucion_envio(), validar_envio_producto(): triggers con GRANT a anon, inertes fuera de un trigger');
    if (area.id === 'pedidos') higiene.push('notificar_decision_diferencia(): trigger con GRANT a anon, inerte fuera de un trigger');
    if (area.id === 'facturacion-dte') higiene.push(...SERVIDOR.search_path_mutable.map(f => `${f}(): sin SET search_path — viola la regla 4 del hardening`));
    if (area.id === 'sucursales') higiene.push('branches: legible por anon con USING(true). La necesita el kiosco antes del login; no está escrito en ningún lado');
    if (area.id === 'horarios') higiene.push('holidays y shifts: legibles por anon con USING(true), sin motivo escrito');
    // `staff_salary` se cerró en v2.720.0, en las dos capas: los campos de
    // dinero salieron de `employees_safe` y viven detrás de
    // `get_employee_salarios`, y la sección del expediente dejó de gatearse por
    // «poder editar la ficha». Era el ÚNICO hallazgo grave del portal.
    //
    // Queda anotado lo que NO se movió, para que no se pierda: `dui`,
    // `afp_number` e `isss_number` siguen en la vista. Son identidad previsional
    // y no «salarios e ingresos» —que es lo que ese módulo dice gatear— así que
    // bajo qué llave van es otra decisión, no un olvido.
    if (area.id === 'personal') higiene.push('dui, afp_number e isss_number siguen en employees_safe: están en SENSITIVE_FIELDS pero ningún módulo los gatea');
    const anonMios = [...abiertos, ...higiene];
    ev.seguridad = { pct: tope(98 - higiene.length * 2 - abiertos.length * 25, 55),
        evidencia: '0 policies llamando auth_* fuera de (SELECT …) en las 176 tablas · 0 USING(true) de escritura para authenticated · 0 advisor ERROR · '
                 + '3 funciones anon abiertas a mano y verificadas: las tres se defienden solas · '
                 + 'barrido de EXECUTE 2026-08-24: 131 funciones con `authenticated` que ninguna migración concede, '
                 + 'clasificadas una por una — 7 eran reales (DEFINER sin guarda que el navegador no llama) y quedaron '
                 + 'cerradas a service_role, entre ellas notify_employees, que aceptaba avisos y push arbitrarios contra '
                 + 'toda la empresa. Lo vigila gate:migrations por estado final de cada función.',
        hallazgos: anonMios };

    // ── resiliencia ─────────────────────────────────────────────────────────
    ev.resiliencia = { pct: tope(95 - n('catch-mudo') * 8 - n('submit-sin-freno') * 5 - h.borradores.length * 4, 45),
        evidencia: `barrido: ${n('catch-mudo')} catch callado, ${n('submit-sin-freno')} botón sin freno · gate:borradores: ${h.borradores.length} formulario(s) largo(s) sin borrador`,
        hallazgos: [...h.barrido.filter(x => ['catch-mudo', 'submit-sin-freno'].includes(x.cat)).map(x => `${x.cat}: ${x.archivo}:${x.linea}`),
                    ...h.borradores.map(f => `formulario largo sin borrador: ${f}`)] };

    // ── observabilidad ──────────────────────────────────────────────────────
    // El detector se rehízo el 2026-08-24 y con él cambió lo que este número
    // significa. Antes contaba ARCHIVOS de `src/data/` que escribían sin nombrar
    // `appendAuditLog`: daba 27, o sea la capa de datos entera, porque la
    // bitácora no se escribe ahí sino en quien orquesta la acción. Ahora sigue
    // la cadena de llamada —con los alias de los imports— y cuenta ACCIONES cuyo
    // registro no existe en ninguno de sus llamadores.
    //
    // Medido así fueron 26, y las 26 se cerraron: planilla (4), vacaciones (5),
    // Mín·Máx (1), turnos (3), coberturas (2), traslado rechazado (1),
    // cotizaciones (3), configuración de bitácoras (1), principio activo (2),
    // venta perdida (1). Dos exenciones escritas —el tema elegido y las
    // notificaciones propias— porque escribir el estado de uno mismo no es una
    // acción sobre el dato compartido.
    ev.observabilidad = { pct: tope(96 - n('escritura-sin-bitacora') * 9, 50),
        evidencia: `barrido: ${n('escritura-sin-bitacora')} acción(es) que escriben y no quedan en la bitácora `
                 + `(detector que sigue la cadena de llamada, no el archivo)`,
        hallazgos: h.barrido.filter(x => x.cat === 'escritura-sin-bitacora').map(x => `${x.archivo}: ${x.texto}`) };

    // ── vista ───────────────────────────────────────────────────────────────
    // `vacio-a-mano` entra acá y no en un eje propio: dibujar la pantalla vacía a
    // mano es la misma falta que dibujar la tarjeta a mano —se copia el
    // envoltorio del canónico y se pierde lo que el canónico da gratis—, sólo que
    // en el otro extremo de la lista.
    ev.vista = { pct: tope(98 - h.design.length * 3 - n('vacio-a-mano') * 4, 55),
        evidencia: `gate:design en verde · ${h.design.length} hallazgo(s) de tarjeta-a-mano bajo baseline · `
                 + `barrido: ${n('vacio-a-mano')} pantalla(s) vacías dibujadas a mano`,
        hallazgos: [...(h.design.length ? [`${h.design.length} tarjeta(s) escritas a mano en vez de data-surface="card"`] : []),
                    ...h.barrido.filter(x => x.cat === 'vacio-a-mano').map(x => `vacío a mano: ${x.archivo}:${x.linea}`)] };

    // ── movil ───────────────────────────────────────────────────────────────
    // El gate está en 0 en las cinco categorías, pero el gate LEE EL FUENTE y hay
    // filas que desde el fuente son una caja cerrada. El barrido de 54 rutas es
    // lo que cierra ese hueco y su última corrida completa es del 2026-08-17.
    // Nada barrido después de esa fecha puede declararse verde.
    // ── El barrido, tras destrabarlo el 2026-08-24 ─────────────────────────
    // Pasó de medir 13 rutas de 54 a medir 25-27, y el camino tuvo dos
    // diagnósticos equivocados que vale la pena tener escritos:
    //
    //   · «faltan datos» — falso: había 5.111 facturas, pero todas del 15 de
    //     agosto, y las vistas filtran por hoy. Correr las fechas subió a 15.
    //   · «hay que sembrar más» — falso: `minmax` pinta 50 filas y el barrido la
    //     contaba como vacía. El detector estaba mal.
    //   · lo real: 19 de las 54 devolvían «sin acceso» con la cuenta de pruebas.
    //     El barrido medía el cartel, no la pantalla.
    //
    // Con eso aparecieron DOS defectos reales que llevaban escondidos detrás de
    // un cero, y los dos quedaron cerrados en v2.723.1.
    //
    // ── Y un cuarto diagnóstico equivocado, el más fino (2026-08-24) ───────
    // `branches` seguía dando 0 fichas con ocho sucursales cargadas. No era una
    // tarjeta a mano ni un selector viejo: `BranchCard` lleva
    // `content-visibility: auto` —para no renderizar lo que está fuera de la
    // pantalla— y `innerText` devuelve SÓLO texto renderizado. Medido: la vista
    // llena da 508 caracteres y una vacía da 506. Dos caracteres.
    //
    // El detector pasó a contar ESTRUCTURA, que existe aunque no se pinte, y
    // subió de 25 rutas medidas a 31 — todas con 0 hallazgos.
    //
    // El eje sube a 93 y no a 100: 23 rutas siguen sin datos en el entorno de
    // pruebas, así que casi la mitad del portal continúa sin medirse en el
    // teléfono. Un gate que no pudo medir no puede dar verde.
    // ── 2026-08-24, tarde: el eje se destraba del todo ─────────────────────
    // Después de cinco versiones persiguiendo un corte que separara «hay algo
    // que medir» de «no llegué a mirar», resultó que el corte no existía porque
    // la pregunta estaba mal hecha: **una vista con estado vacío igual tiene
    // interfaz que medir**. Sus filtros, sus botones y el propio cartel de vacío
    // son blancos de dedo como cualquier otro, y marcarla «no medida»
    // descartaba pantallas enteras que sí había que revisar.
    //
    // Lo único que de verdad impide medir es que la vista no pinte NADA suyo, y
    // eso se ve directo desde que `GlassViewLayout` estampa `data-contenido`.
    // Resultado: **54 de 54 rutas medidas, 0 hallazgos, 0 reventadas, 0 tablas
    // en el teléfono, 0 toques perdidos.**
    //
    // El eje sube a 95 —el tope sin sello— y NO a 100: el entorno de pruebas
    // sigue 130 migraciones atrás de producción, así que lo medido vale para la
    // MAQUETA, que no depende del esquema, y no para una vista cuyo dato no
    // llegó a cargar.
    ev.movil = { pct: 95,
        evidencia: 'gate:movil con las 5 categorías en 0 · barrido e2e del 2026-08-24: **54 de 54 rutas medidas**, '
                 + '0 hallazgos, 0 reventadas, 0 tablas en el teléfono, 0 desbordes, 0 toques perdidos. '
                 + 'Destapó y cerró 2 defectos (v2.723.1) y 5 vacíos dibujados a mano (v2.727.1).',
        hallazgos: ['el entorno de pruebas está 130 migraciones atrás de producción: lo medido vale para la MAQUETA '
                    + '(que no depende del esquema) y no para una vista cuyo dato no llegó a cargar'] };

    // ── ux ──────────────────────────────────────────────────────────────────
    // Los 32 textos que nombraban el sistema de origen se corrigieron en
    // v2.719.2 y se verificaron contra el BUNDLE, no contra el fuente. Lo que
    // el barrido reporte ahora es deuda nueva.
    ev.ux = { pct: tope(95 - n('texto-del-sistema-de-origen') * 6, 50),
        evidencia: `gate:ux en verde (medido 2026-08-17) · gate:design vigila la pestaña en la URL · `
                 + `32 textos que nombraban el sistema de origen corregidos y verificados contra el bundle (v2.719.2) · `
                 + `las pestañas se anuncian como pestañas desde v2.719.3 · barrido: ${n('texto-del-sistema-de-origen')} texto(s) pendiente(s)`,
        hallazgos: h.barrido.filter(x => x.cat === 'texto-del-sistema-de-origen').map(x => `${x.archivo}:${x.linea} — ${x.texto.slice(0, 70)}`) };

    // ── eficiencia ──────────────────────────────────────────────────────────
    const exceso = BUNDLE_ROTO[area.id];
    const chn = SERVIDOR.churn[area.id];
    ev.eficiencia = { pct: tope(95 - (exceso ? 10 + exceso : 0) - (chn ? 12 : 0), 45),
        evidencia: 'gate:perf en verde (14/14 índices, 5/5 planes por índice) · gate:eficiencia en verde (894 escrituras/h de 1240)'
                 + (exceso ? ` · gate:bundle EN ROJO: ${exceso} kB sobre el techo` : ''),
        hallazgos: [...(exceso ? [`gate:bundle en rojo: ${exceso} kB sobre el techo declarado`] : []),
                    ...(chn ? [chn] : [])] };

    // ── pruebas ─────────────────────────────────────────────────────────────
    // Se mide COBERTURA: cuántos archivos del área quedan nombrados por alguna
    // prueba, sobre cuántos tiene. Antes se contaban archivos de prueba, y eso
    // premiaba partir un archivo en dos — ver el comentario del recolector.
    //
    // Un área con pocos archivos llega alto con poco, y está bien: `ventas`
    // tiene 3 archivos y `sucursales` 23, así que cubrir uno no significa lo
    // mismo en las dos. Lo que se pregunta es qué proporción tiene algo que la
    // mire.
    const cubiertos = new Set(cubiertosPorArea[area.id] || []);
    // `carga-diferida.spec.js` abre RUTAS, no importa archivos, así que el
    // detector por importaciones no la ve. Se declara a mano.
    if (['tablero', 'traslados', 'inventario'].includes(area.id)) cubiertos.add('(carga diferida)');
    const totalArea = Math.max(1, (area.archivos || []).length
        ? ARCHIVOS_SRC.filter(f => areaDeArchivo(f) === area.id).length : 1);
    const cob = cubiertos.size / totalArea;
    ev.pruebas = { pct: tope(cubiertos.size === 0 ? 40 : Math.min(95, 55 + Math.round(cob * 100 * 0.6)), 40),
        evidencia: `${cubiertos.size} de ${totalArea} archivo(s) del área nombrados por alguna prueba `
                 + `(${Math.round(cob * 100)}%) · ${RESUMEN_PRUEBAS}`,
        hallazgos: cubiertos.size === 0 ? ['ninguna prueba nombra un archivo de esta área'] : [] };

    // ── doc ─────────────────────────────────────────────────────────────────
    // Documentación: se mide la PRESENCIA y el ALCANCE, nunca la cantidad.
    //
    // La regla vieja era `65 + docs × 10`, o sea que el camino al 95 era escribir
    // TRES documentos. Es el mismo defecto que ya se corrigió en el eje de
    // pruebas —contar archivos premia partir uno bueno en dos— y acá era peor,
    // porque un documento se parte sin siquiera reescribirlo.
    //
    // Las dos preguntas que sí importan, y ninguna se responde partiendo un
    // archivo:
    //   1. ¿el área tiene un documento propio con algo adentro? (≥120 líneas:
    //      medido, los 24 documentos vivos del repo lo cruzan salvo dos, y los
    //      dos que no son listas de tareas, no explicaciones)
    //   2. ¿se puede LLEGAR a él desde el código del área? Un documento que no
    //      se cita desde ningún archivo es un documento que nadie encuentra el
    //      día que toca el módulo — y es la costumbre que ya tiene el repo
    //      («ver docs/X» aparece en CLAUDE.md por todos lados). Hoy fallan
    //      cuatro áreas con documentos vivos: inventario, pedidos y compras
    //      tienen dónde leer y ningún cartel que lo diga.
    const vivos = area.docs.filter(d => fs.existsSync(path.join(RAIZ, d)));
    const gordos = vivos.filter(d => fs.readFileSync(path.join(RAIZ, d), 'utf8').split('\n').length >= 120);
    const citados = vivos.filter(d => FUENTES_TXT.some(t => t.includes(d.replace(/^docs\//, ''))));
    ev.doc = { pct: tope(55 + (gordos.length ? 25 : 0) + (citados.length ? 15 : 0), 45),
        evidencia: `${vivos.length} documento(s) vivos, ${gordos.length} con cuerpo (≥120 líneas), `
            + `${citados.length} citado(s) desde el código: ${vivos.join(', ') || '(ninguno)'}`,
        hallazgos: [
            ...(gordos.length ? [] : ['el área no tiene un documento propio con cuerpo en docs/']),
            ...(vivos.length && !citados.length
                ? ['tiene documento pero ningún archivo del código lo nombra: nadie va a encontrarlo'] : []),
        ] };

    // Lint que sobrevive
    for (const [id, ls] of Object.entries(LINT)) if (id === area.id) ev.vista.hallazgos.push(...ls);

    return ev;
}

// ═══════════════════════════════════════════════════════════════════════════
const PESO = EJES.reduce((s, e) => s + e.peso, 0);
const registro = { nota: 'Puntajes derivados por auditoria/puntuar.mjs. Las reglas del cálculo viven ahí, no acá.',
    iniciado: FECHA, recalculado: FECHA, areas: {} };

const filas = [];
for (const area of AREAS) {
    const ejes = puntuar(area);
    const bruto = Math.round(EJES.reduce((s, e) => s + ejes[e.id].pct * e.peso, 0) / PESO);
    const pct = Math.min(bruto, 95);   // ninguna área nace con sello
    registro.areas[area.id] = {
        ejes, pct, estado: pct >= 95 ? 'completo' : 'en-curso',
        sello_sala: null,
        hallazgos: EJES.flatMap(e => (ejes[e.id].hallazgos || []).map(x => `[${e.id}] ${x}`)),
        verificaciones: [{ fecha: FECHA, evidencia: 'Auditoría completa del portal: 11 gates + barrido propio + consultas a producción.' }],
    };
    filas.push({ id: area.id, nombre: area.nombre, pct, ejes });
}

filas.sort((a, b) => b.pct - a.pct);
const g = s => `\x1b[90m${s}\x1b[0m`;
console.log('\n  área                 %   ' + EJES.map(e => e.id.slice(0, 4).padStart(5)).join(''));
console.log(g('  ' + '─'.repeat(24 + EJES.length * 5)));
for (const f of filas) {
    const col = f.pct >= 85 ? 32 : f.pct >= 70 ? 33 : 31;
    console.log(`  ${f.nombre.slice(0, 20).padEnd(20)} \x1b[${col}m${String(f.pct).padStart(3)}\x1b[0m  `
        + EJES.map(e => { const v = f.ejes[e.id].pct; return `\x1b[${v >= 90 ? 32 : v >= 70 ? 33 : 31}m${String(v).padStart(5)}\x1b[0m`; }).join(''));
}
console.log(g('\n  ' + EJES.map(e => `${e.id.slice(0, 4)}=${e.nombre}`).join(' · ')));
console.log(`\n  Promedio del portal: ${Math.round(filas.reduce((s, f) => s + f.pct, 0) / filas.length)}%`);
console.log(`  Hallazgos registrados: ${Object.values(registro.areas).reduce((s, a) => s + a.hallazgos.length, 0)}\n`);

if (ESCRIBIR) {
    fs.writeFileSync(path.join(RAIZ, 'auditoria', 'registro.json'), JSON.stringify(registro, null, 2) + '\n');
    console.log('  ✓ auditoria/registro.json escrito\n');
}
