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

    // `SET search_path` faltante (regla 4 del hardening).
    search_path_mutable: ['es_telefono_sv_valido', 'customer_ficha_estado', 'es_cliente_mostrador'],

    // RLS encendido y CERO policies: nadie puede leerla ni escribirla salvo por
    // una función DEFINER. Puede ser deliberado; no está escrito en ningún lado.
    rls_sin_policy: ['identidad_vales'],

    // El incidente del 2026-07-08 (auth_* sin envolver en `(SELECT …)`): CERO.
    // La regla se sostiene en las 176 tablas. Es el mejor número de la auditoría.
    auth_sin_initplan: 0,

    // `USING(true)`/`WITH CHECK(true)` en escritura: 4, y las cuatro son de
    // `service_role`, que es legítimo. Ninguna para `authenticated`.
    using_true_authenticated: 0,

    sin_pk: 0,
    vistas_sin_security_invoker: 0,

    // FKs sin índice que NO son columnas de auditoría. La regla exceptúa
    // `*_por`/`created_by` en tablas pequeñas; éstas no entran en la excepción.
    fk_sin_indice_reales: {
        pedidos: ['pedido_traslado_linea.erp_sucursal_id (2.5 MB)', 'pedido_apoyo.employee_id',
                  'pedido_recepcion_extras.erp_product_id', 'pedido_recepcion_firmas.employee_id',
                  'pedido_items.confirmado_suc_por + rechazado_por (17 MB — la tabla NO es pequeña)'],
        'cortes-efectivo': ['cortes_caja_eventos.employee_id'],
        acceso: ['intentos_identidad.branch_id'],
        horarios: ['schedule_coverage.home_branch_id'],
        impresion: ['cola_impresion.dispositivo'],
    },

    // Índices que nunca se usaron y pesan >200 kB: se mantienen en cada
    // escritura y no aceleran ninguna lectura. ~8 MB de índice muerto.
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
    pruebas:     { verde: true,  nota: '687 pruebas en 54 archivos, todas verdes' },
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
    'cortes-efectivo': ['falta probar en sala', 'el −$621.17 falso de Salud 1 sin explicar',
                        'falta probar las bolsas en sala'],
    compras:   ['falta correr el barrido contra los documentos reales',
                'falta el plazo de los 163 proveedores y el insert al sistema',
                '6 pares de compras que comparten sello',
                'las recetas están medidas (5 reales) y sin construir'],
    fiscal:    ['art.162 retención IVA $48.95 sin resolver', 'art.156 retención renta $262.52 sin marcar',
                'libros de compras: quedan hallazgos abiertos'],
    ventas:    ['la brecha de mayo/2025 en el acumulado diario: $117,509.80 en 85 pares',
                'falta verlo en sala (lo que no es venta de productos)',
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
const design = JSON.parse(execSync('node scripts/design-gate.mjs --json', { cwd: RAIZ, maxBuffer: 1 << 26 }).toString());
const draft = JSON.parse(fs.readFileSync(path.join(RAIZ, 'scripts/draft-gate-baseline.json'), 'utf8'));

const porArea = id => ({
    barrido: barrido.hallazgos.filter(h => h.area === id),
    design: Object.entries(design.byFile).filter(([f]) => areaDeArchivo(f) === id).flatMap(([, v]) => v),
    borradores: (draft.deuda || []).filter(f => areaDeArchivo(f) === id),
});

// Pruebas: qué archivo de prueba nombra un archivo de esta área.
const pruebasPorArea = {};
for (const dir of ['tests/unit', 'tests/e2e']) {
    for (const f of fs.readdirSync(path.join(RAIZ, dir)).filter(x => /\.(js|jsx)$/.test(x))) {
        const src = fs.readFileSync(path.join(RAIZ, dir, f), 'utf8');
        for (const m of src.matchAll(/['"`](?:\.\.\/)*(src\/[A-Za-z0-9_./-]+)['"`]/g)) {
            let p = m[1];
            if (!/\.(js|jsx)$/.test(p)) for (const e of ['.js', '.jsx']) if (fs.existsSync(path.join(RAIZ, p + e))) { p += e; break; }
            const a = areaDeArchivo(p);
            if (a) (pruebasPorArea[a] ||= new Set()).add(dir + '/' + f);
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
                 + '3 funciones anon abiertas a mano y verificadas: las tres se defienden solas',
        hallazgos: anonMios };

    // ── resiliencia ─────────────────────────────────────────────────────────
    ev.resiliencia = { pct: tope(95 - n('catch-mudo') * 8 - n('submit-sin-freno') * 5 - h.borradores.length * 4, 45),
        evidencia: `barrido: ${n('catch-mudo')} catch callado, ${n('submit-sin-freno')} botón sin freno · gate:borradores: ${h.borradores.length} formulario(s) largo(s) sin borrador`,
        hallazgos: [...h.barrido.filter(x => ['catch-mudo', 'submit-sin-freno'].includes(x.cat)).map(x => `${x.cat}: ${x.archivo}:${x.linea}`),
                    ...h.borradores.map(f => `formulario largo sin borrador: ${f}`)] };

    // ── observabilidad ──────────────────────────────────────────────────────
    ev.observabilidad = { pct: tope(92 - n('escritura-sin-bitacora') * 9, 50),
        evidencia: `barrido: ${n('escritura-sin-bitacora')} archivo(s) de src/data que escriben y no nombran appendAuditLog`,
        hallazgos: h.barrido.filter(x => x.cat === 'escritura-sin-bitacora').map(x => x.archivo) };

    // ── vista ───────────────────────────────────────────────────────────────
    ev.vista = { pct: tope(98 - h.design.length * 3, 55),
        evidencia: `gate:design en verde · ${h.design.length} hallazgo(s) de tarjeta-a-mano bajo baseline`,
        hallazgos: h.design.length ? [`${h.design.length} tarjeta(s) escritas a mano en vez de data-surface="card"`] : [] };

    // ── movil ───────────────────────────────────────────────────────────────
    // El gate está en 0 en las cinco categorías, pero el gate LEE EL FUENTE y hay
    // filas que desde el fuente son una caja cerrada. El barrido de 54 rutas es
    // lo que cierra ese hueco y su última corrida completa es del 2026-08-17.
    // Nada barrido después de esa fecha puede declararse verde.
    // El barrido SÍ se corrió el 2026-08-23 y dijo «54 vistas · 0 por corregir».
    // Ese cero era del INSTRUMENTO: sólo 13 rutas tenían algo que medir y las
    // otras 41 llegaron sin datos —el entorno de pruebas no los tiene, y la
    // cuenta de pruebas no abre todas las pantallas—. Su bandera `vacia` medía
    // el texto del body ENTERO, y el menú lateral solo ya pasaba el umbral, así
    // que ninguna vista sin datos se marcaba nunca.
    //
    // Se arregló el instrumento (ahora informa «MEDIDAS N» y marca las que no
    // pudo medir), pero el eje NO sube: para medir de verdad hace falta correrlo
    // contra un entorno CON datos. Un gate que no pudo medir no puede dar verde.
    ev.movil = { pct: 85,
        evidencia: 'gate:movil con las 5 categorías en 0 · barrido e2e corrido el 2026-08-23: midió 13 de 54 rutas',
        hallazgos: ['el barrido midió 13 de 54 rutas: el entorno de pruebas no tiene datos para las otras 41',
                    'la última corrida sobre un entorno CON datos es del 2026-08-17'] };

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
    const t = (pruebasPorArea[area.id] || new Set()).size
        // `carga-diferida.spec.js` no nombra archivos de `src/` —abre rutas—, así
        // que el detector por importaciones no la ve. Se declara a mano: es la
        // única prueba que verifica que lo diferido vuelve.
        + (['tablero', 'traslados', 'inventario'].includes(area.id) ? 1 : 0);
    ev.pruebas = { pct: tope(t === 0 ? 40 : Math.min(95, 55 + t * 7), 40),
        evidencia: `${t} archivo(s) de prueba nombran archivos de esta área · 687 pruebas en total, todas verdes`,
        hallazgos: t === 0 ? ['ninguna prueba nombra un archivo de esta área'] : [] };

    // ── doc ─────────────────────────────────────────────────────────────────
    const vivos = area.docs.filter(d => fs.existsSync(path.join(RAIZ, d)));
    ev.doc = { pct: tope(vivos.length ? Math.min(95, 65 + vivos.length * 10) : 55, 45),
        evidencia: `${vivos.length} documento(s) vivos: ${vivos.join(', ') || '(ninguno)'}`,
        hallazgos: vivos.length ? [] : ['el área no tiene ni un documento propio en docs/'] };

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
