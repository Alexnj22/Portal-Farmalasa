// El LIBRO que se presenta — la matriz de filas y columnas de cada anexo.
//
// Vive en su propio módulo desde el 2026-08-24 y no dentro de `LibrosIvaView`
// por la regla que este repo ya aplicó tres veces (`semana.js`,
// `usarExpediente.js`, `estadoDialogo.js`): un archivo de componente que además
// exporta una función rompe el refresco en caliente de React — al editar la
// vista, Vite recarga la página entera en vez de sustituir el componente.
//
// Está EXPORTADA porque `tests/unit/anexoColumnas.test.js` la prueba, y ése es
// el punto: es el único camino que produce el archivo que se presenta, así que
// el candado tiene que apretarse sobre ella y no sobre una copia. Dos veces
// seguidas —el 2026-08-11— salió un anexo con una columna de menos y nadie las
// contaba.
//
// Se mudan con ella los ocho ayudantes que usa. Los sigue usando también la
// vista, que ahora los importa: una sola definición, dos consumidores — y no dos
// copias, que es exactamente lo que un libro fiscal no puede permitirse.

import { formatearNit, formatearNrc } from '../../utils/nitUtils';

// DD/MM/YYYY: el formato del libro. Se parte la cadena en vez de construir un
// Date — `new Date('2026-06-01')` es UTC y en El Salvador (−6) retrocede un día.
export const fmtFecha = (iso) => {
    if (!iso) return '';
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
};

// El CSV lleva el número pelado: sin símbolo, sin separador de miles y con
// punto decimal, que es lo que Excel en es-SV interpreta como número. Un
// "$1,234.56" entra como texto y no suma.
const num = (n) => (Number(n) || 0).toFixed(2);

// El correlativo del portal trae el sufijo del tipo ("0000050457_COF"); en el
// libro va el número.
export const soloNumero = (correlativo) => String(correlativo || '').split('_')[0];

//   número de control     `DTE01S001P005000000000019619`  — sin guiones
//   código de generación  `010D5CAF 6015 4E83 B0AC 43B…`  — guiones → ESPACIOS (consumidor)
//   código de generación  `6A1977361C134042BD594F683B45`  — pelado (contribuyentes y anulados)
//
// Y ninguno lleva fila de encabezado: arrancan directo en datos.
const ncPelado  = (nc) => String(nc || '').replace(/-/g, '');
const cgEspacios = (cg) => String(cg || '').toUpperCase().replace(/-/g, ' ');
const cgPelado   = (cg) => String(cg || '').toUpperCase().replace(/-/g, '');
// El NRC y el NIT viajan sin guión: `250887-5` → `2508875`, `01274208-2` →
// `012742082`. En el portal se guardan CON guión, que es como se leen.
const docId = (v) => String(v || '').replace(/-/g, '');


// Este CSV NO replica ningún archivo del origen —no existe uno— así que lleva
// encabezado y va en términos del portal. Es la lista que el contador necesita
// para acreditar la retención al declarar, y por eso trae la identidad completa
// de cada documento aunque en pantalla el ancho no dé para mostrarla toda.
export const csvRetencionVentas = (filas) => {
    const dosDec = (n) => (Number(n) || 0).toFixed(2);
    const suma = (rs, campo) => rs.reduce((s, r) => s + (Number(r[campo]) || 0), 0);
    const vigentes = filas.filter(r => !r.anulada);
    return [
        ...filas.map((r, i) => [
            i + 1, fmtFecha(r.fecha), r.cliente || '',
            formatearNrc(r.nrc), formatearNit(r.nit),
            r.tipo_documento || '', soloNumero(r.correlativo), r.numero_control || '',
            String(r.codigo_generacion || '').toUpperCase(), r.sello_recepcion || '',
            dosDec(r.monto_sujeto), dosDec(r.retencion_iva),
            dosDec(r.total), r.anulada ? 'ANULADO' : '',
        ]),
        ['TOTALES', '', '', '', '', '', '', '', '', '',
         dosDec(suma(filas, 'monto_sujeto')), dosDec(suma(filas, 'retencion_iva')),
         dosDec(suma(filas, 'total')), ''],
        // La segunda fila solo cuando hace falta. El total de arriba incluye los
        // anulados porque las filas están arriba y una suma que no suma lo que
        // se ve es peor que dos filas; el número que se acredita es este.
        ...(vigentes.length === filas.length ? [] : [[
            'ACREDITABLE (SIN ANULADOS)', '', '', '', '', '', '', '', '', '',
            dosDec(suma(vigentes, 'monto_sujeto')), dosDec(suma(vigentes, 'retencion_iva')),
            '', '',
        ]]),
    ];
};
export const CSV_RET_VENTAS_HEADERS = ['N.', 'FECHA', 'CLIENTE', 'NRC', 'NIT', 'TIPO',
    'DOCUMENTO', 'NUMERO DE CONTROL', 'CODIGO DE GENERACION', 'SELLO',
    'BASE', 'IVA RETENIDO', 'TOTAL', 'ESTADO'];

// Exportada para `tests/unit/anexoColumnas.test.js`: es el único camino que
// produce el archivo que se presenta, así que el candado tiene que apretarse
// sobre ella y no sobre una copia. Dos veces seguidas —el 2026-08-11— salió un
// anexo con una columna de menos y nadie las contaba.
export const construirLibro = (tab, d, tot) => {
    if (tab === 'consumidor') {
        // Art. 83: fecha · del→al · máquina/establecimiento · exentas ·
        // gravadas locales · exportaciones · total diario · cuenta de terceros.
        // Además del Art. 83, la identidad del DTE que el libro del ERP
        // lleva: clase y tipo, el código de generación del primero y del
        // último del día, el sello del primero y los IDs del ERP. Los cinco
        // estaban guardados y este CSV no los sacaba.
        // **23 columnas**, sin encabezado. Eran 22 hasta el 2026-08-11: se
        // cotejó contra el anexo de junio que el contador presenta y contra el
        // manual del F-07 v14, y sobraba un '0.0000' entre "no sujetas" y
        // "gravadas locales" que corría TODO el resto un lugar. Con $1,164.98
        // de ventas de un día, la casilla de gravadas quedaba en cero y el
        // monto se declaraba como **exportación dentro del área
        // centroamericana**. Los cuatro decimales eran la pista: acá Hacienda
        // toma dos en todas.
        //
        // Las que faltaban al final son las de enero 2025, y para una farmacia
        // son constantes: tipo de operación 1 (gravada) y tipo de ingreso 3
        // (actividades comerciales).
        //
        // Ahora las columnas sí están identificadas —salen del manual, no de
        // mirar ceros—: 11 exentas · 12 exentas no sujetas a proporcionalidad ·
        // 13 no sujetas · 14 gravadas locales (con IVA) · 15-17 exportaciones
        // dentro de CA, fuera de CA y de servicios · 18 zonas francas y DPA ·
        // 19 cuenta de terceros · 20 total.
        //
        // Las de código de generación son las DOS que el reporte original
        // trae MAL, y el 2026-08-11 apareció la causa: el origen toma el
        // **mínimo y el máximo alfabéticos** del código de generación del día,
        // no el del primer y último documento emitido. Verificado contra el
        // anexo de junio del contador, sucursal S001P005 del 01/06: trae
        // `010D5CAF…` y `FF69D633…`, que son exactamente `min()` y `max()` del
        // texto de los UUID de ese día; los reales son `A8AEE366…` (erp 297361,
        // correlativo 51106) y `E0CA8B8C…` (erp 298111, correlativo 51241) —
        // los mismos ids internos que el propio archivo declara dos columnas
        // antes. Un UUID no tiene orden temporal, así que cuál cae de cada lado
        // es azar: por eso en unos días salen invertidos y en otros no.
        //
        // Acá van las correctas. Replicar un dato equivocado en un libro que se
        // declara sería copiar el error, no el formato — misma decisión que con
        // las notas de crédito.
        return { base: 'libro-consumidor-final', headers: null, rows:
            d.consumidor.map(r => [
                fmtFecha(r.fecha), '4', '01',
                ncPelado(r.numero_control_del),
                r.sello_del || '',
                r.erp_id_del || '', r.erp_id_al || '',
                cgEspacios(r.codigo_gen_del), cgEspacios(r.codigo_gen_al),
                '',
                num(r.ventas_exentas), '0.00', '0.00',
                num(r.ventas_gravadas),
                '0.00', '0.00', '0.00', '0.00', '0.00',
                num(r.total_diario),
                '1', '3', '2',
            ]) };
    }
    if (tab === 'contribuyente') {
        // Art. 85 más la identidad del DTE: sello de recepción, código de
        // generación, NIT, la clase/tipo del documento y —desde el
        // 2026-08-01— el número de control, que es el que faltaba de verdad.
        //
        // Va en columna propia y NO reemplazando a "No CCF", que sigue
        // llevando el correlativo: son dos numeraciones distintas y todavía
        // no está verificado cuál de las dos consigna el reporte en esa
        // columna. Mientras la duda exista, el archivo lleva las dos —
        // sobra un dato, no falta.
        // **20 columnas**, sin encabezado. Eran 19 hasta el 2026-08-11: se
        // cotejó documento por documento contra `JUNIO 2026 VCT`, el archivo
        // que el contador presenta. Los 49 CCF de junio son los mismos de los
        // dos lados —mismo sello, mismo código de generación, mismo NRC, mismas
        // gravadas al centavo—; lo que no coincidía era la estructura: sobraba
        // un '0' entre "no sujetas" y "gravadas locales" que corría todo un
        // lugar, y con $15.53 de gravadas el archivo declaraba cero gravadas,
        // las gravadas como débito, el débito como venta a cuenta de terceros y
        // **el total dentro de la casilla del DUI**.
        //
        // El TOTAL es ahora la BASE (exentas + gravadas), no el cobrado: el
        // débito ya tiene su columna, y el Art. 85 literal l) pide el «total de
        // ventas por documento», la suma de las anteriores. Eso además cierra
        // el hueco de la retención — no forma parte de la base.
        //
        // Clase 4 = documento tributario electrónico; tipo 03 = comprobante de
        // crédito fiscal — códigos del catálogo de Hacienda, no una numeración
        // nuestra.
        //
        // La RETENCIÓN de IVA no va en este archivo, y quedó zanjado leyendo el
        // reglamento (2026-08-04). El **Art. 85 RCT** enumera las doce columnas
        // del libro y entre ellas está «impuesto PERCIBIDO» (literal k) — pero
        // **no existe una de impuesto retenido**. Tampoco en el Art. 83, el de
        // consumidor. La retención es un anticipo del impuesto (Art. 162 CT):
        // va en la declaración, respaldada por los comprobantes de retención,
        // no en una columna del libro.
        //
        // Por eso la pantalla la muestra y el archivo no la lleva — y por eso
        // viaja como CSV aparte en el paquete del mes, que es papel de trabajo
        // para declarar. No era «no supimos en cuál columna»: no hay columna.
        //
        // Lo que SÍ quedó abierto es otra cosa y está en
        // `docs/planes-cerrados/RETENCION-IVA-VENTAS-2026-08-04.md`: el literal l) pide el
        // «total de ventas por documento», que es la suma de las columnas
        // anteriores —la retención no está entre ellas, así que no se resta—, y
        // hoy acá va el total COBRADO. Son $48.95 del período contable. No se
        // cambió porque mueve números ya declarados.
        //
        // Este reporte SÍ trae bien sus identificadores —número de control,
        // sello y código de generación coinciden con el documento de la
        // fila—, a diferencia del de consumidor.
        return { base: 'libro-contribuyentes', headers: null, rows:
            d.contribuyente.map(r => {
                // H es NIT **o** NRC, y es excluyente con Q (el DUI).
                const h = docId(r.nrc) || docId(r.nit);
                return [
                    fmtFecha(r.fecha), '4', '03',
                    ncPelado(r.numero_control),
                    r.sello_recepcion || '',
                    cgPelado(r.codigo_generacion),
                    r.erp_invoice_id || '',
                    h,
                    r.cliente || '',
                    // J exentas · K no sujetas · L gravadas · M débito
                    num(r.ventas_exentas), '0.00',
                    num(r.ventas_gravadas), num(r.debito_fiscal),
                    // N cuenta de terceros · O su débito
                    '0.00', '0.00',
                    // P total de ventas = la BASE, no el cobrado
                    num(Number(r.ventas_exentas || 0) + Number(r.ventas_gravadas || 0)),
                    // Q DUI, sólo si H quedó vacía
                    h ? '' : docId(r.dui),
                    // R gravada · S comerciales · T número de anexo
                    '1', '3', '1',
                ];
            }) };
    }
    if (tab === 'anulados') {
        // El sello y el ID del ERP se agregaron el 2026-08-01: el anexo del
        // ERP los lleva y acá estaban guardados sin salir. Al revés, el ERP
        // NO trae fecha, cliente ni total — esas tres quedan porque hacen
        // el anexo legible sin tener que ir a buscar cada documento.
        // Réplica del archivo real (10 columnas, sin encabezado). El número
        // de control es la PRIMERA, y era la única que no se podía llenar
        // hasta el backfill del 2026-08-01.
        //
        // Las seis constantes (`4`, `0`, `0`, `D`, `0`, `0`) se verificaron
        // sobre las 80 filas de junio: son iguales en todas. El anexo no
        // lleva fecha, cliente ni total — por eso no van, aunque la pantalla
        // sí los muestre para poder leer la fila sin ir a buscar cada
        // documento.
        return { base: 'anexo-anulados', headers: null, rows:
            d.anulados.map(r => [
                ncPelado(r.numero_control),
                '4', '0', '0',
                r.tipo_documento === 'CCF' ? '03' : '01',
                'D',
                r.sello_recepcion || '',
                '0', '0',
                cgPelado(r.codigo_generacion),
            ]) };
    }
    if (tab === 'compras') {
        // Art. 86: correlativo · fecha · clase y número del documento ·
        // NRC · proveedor · exentas · gravadas internas · importaciones ·
        // crédito fiscal · total · percibido · retenido.
        // Réplica del archivo real (23 columnas, sin encabezado), verificada
        // contra junio 2026 en Bodega. La columna 5 es el **NIT**, no el NRC
        // (INCOFA `06142609031027`, LETERAGO `06142505071078`), y las
        // gravadas son `subtotal − percepción` — LETERAGO: 577.71 − 5.72 =
        // 571.99, que es exactamente lo que trae el archivo.
        //
        // La percepción va con CUATRO decimales, no dos.
        //
        // Las constantes `1;1;2;5;3` de las columnas 17-21 son iguales en
        // todas las filas de la muestra; no se pudo determinar qué
        // significan, así que se copian tal cual.
        //
        // La última columna es el SELLO y sale vacía. Vacío y no un cero,
        // porque no sabemos el valor — declararlo sería inventarlo.
        //
        // Ojo, el motivo cambió: hasta C1 era que el sello «no venía en la
        // fuente», y eso resultó falso — está en la columna 22 del reporte de
        // referencia y desde v2.348.0 el sync lo guarda en
        // `purchase_receipts.sello_recibido`. Hoy el motivo es que todavía no
        // está en todas las compras: julio 56.7% (265 de 467), junio y agosto
        // 0%, porque el sello solo se captura cuando el sync vuelve a correr
        // ese rango. Emitirlo ahora daría un archivo que dice el sello en
        // unos meses y no en otros. **Primero el backfill de junio y agosto
        // —en ventanas de ≤10 días, que es lo que aguanta la fuente—, después
        // se emite.** Cuando se haga, cambiar también el `''` final de la
        // rama `compras` de `generar_csv_libro`: son dos transcripciones
        // independientes a propósito, y el verificador compara una contra
        // otra.
        //
        // Lo de arriba cierra el §4.3 del doc de formato, que daba por
        // sentado que el dato no existía.
        return { base: 'libro-compras', headers: null, rows:
            d.compras.map(r => [
                fmtFecha(r.fecha), '4', '',
                r.documento_numero || '',
                docId(r.nit),
                r.proveedor || '',
                num(r.compras_exentas), '0.00', '0.00',
                num(r.compras_gravadas),
                '0.00', '0.00', '0.00',
                num(r.credito_fiscal),
                num(r.total),
                '',
                '1', '1', '2', '5', '3',
                // Vacío ≠ 0.0000: si el documento se sincronizó antes de
                // que existiera la columna no sabemos si hubo percepción,
                // y escribir cero sería afirmar que no la hubo.
                r.percepcion_iva == null ? '' : (Number(r.percepcion_iva) || 0).toFixed(4),
                '',
            ]) };
    }
    if (tab === 'renta') {
        // Lo que CORRESPONDERÍA retener, no lo retenido: la retención se
        // practica al pagar y el portal registra lo que se factura. El
        // encabezado lo dice para que nadie lo presente como otra cosa.
        return { base: 'anexo-retencion-renta',
            headers: ['N.', 'FECHA', 'PROVEEDOR', 'NIT', 'NRC', 'TIPO', 'NUMERO DE CONTROL',
                      'CODIGO DE GENERACION', 'MONTO', 'BASE SIN IVA', 'RETENCION 10%'],
            rows: [
                ...d.renta.map((r, i) => [
                    i + 1, fmtFecha(r.fecha), r.proveedor || '',
                    formatearNit(r.nit), formatearNrc(r.nrc),
                    r.tipo_documento || '', r.numero_control || '',
                    (r.codigo_generacion || '').toUpperCase(),
                    num(r.monto_total), num(r.base_sin_iva), num(r.retencion_10),
                ]),
                ['TOTALES', '', '', '', '', '', '', '',
                 '', num(tot.gravadas), num(tot.debito)],
            ] };
    }

    if (tab === 'retencionVentas') {
        // El IVA que NOS retuvieron. No replica ningún archivo del origen —no
        // existe uno— así que lleva encabezado, y usa el MISMO armador que el
        // botón de la sección: dos transcripciones del mismo libro se separan
        // sin que nadie lo note.
        return { base: 'iva-retenido-sobre-ventas',
            headers: CSV_RET_VENTAS_HEADERS,
            rows: csvRetencionVentas(d.retencionVentas) };
    }

    if (tab === 'percepcion' || tab === 'retencion') {
        const esPerc = tab === 'percepcion';
        const filasAnexo = esPerc ? d.percepcion : d.retencion;
        // Réplica del anexo real (9 columnas, sin encabezado), verificada
        // contra Bodega en junio 2026. Los montos van con CUATRO decimales.
        //
        // Dos diferencias conocidas, y las dos son de origen:
        //
        //   · El SELLO (columna 7) sale vacío: el anexo del ERP lo trae, pero
        //     no viene en la fuente que alimenta Compras. Vacío y no cero —
        //     no sabemos el valor.
        //   · El monto sujeto va a diferir en la tercera y cuarta decimal:
        //     el ERP guarda 577.7115 y el sync redondea a 577.71 al
        //     guardarlo, así que acá sale 571.9900 donde el anexo dice
        //     571.9915. Son ~0.0015 por fila. Recuperarlo exige cambiar la
        //     precisión del sync, no el exportador.
        //
        // El de retención usa el mismo formato porque es su hermano, pero eso
        // NO está verificado con datos: el archivo del ERP salió vacío en
        // toda su historia (2025-01 → 2026-07, 7 sucursales).
        return { base: `anexo-${esPerc ? 'percepcion' : 'retencion'}`, headers: null, rows:
            filasAnexo.map((r, i) => [
                i + 1, fmtFecha(r.fecha),
                r.proveedor || '',
                docId(r.nit),
                r.documento_tipo === 'CCF' ? '03' : '01',
                r.documento_numero || '',
                '',
                (Number(r.monto_sujeto) || 0).toFixed(4),
                (Number(esPerc ? r.percepcion_iva : r.retencion_iva) || 0).toFixed(4),
            ]) };
    }
    if (tab === 'notas') {
        // No replica ningún reporte: este archivo no existe del otro lado,
        // que es justamente el problema que la sección hace visible. Las
        // columnas son las que trae el documento, y el TOTAL va NETO —
        // crédito menos débito— porque es el ajuste que hay que aplicar.
        return { base: 'notas-credito-compras',
            headers: ['No', 'FECHA', 'TIPO', 'CODIGO', 'NUMERO DE CONTROL',
                      'CODIGO DE GENERACION', 'PROVEEDOR', 'NRC', 'NIT',
                      'DOCUMENTO QUE CORRIGE', 'MONTO', 'IVA'],
            rows: [
                ...d.notas.map((r, i) => [
                    i + 1, fmtFecha(r.fecha),
                    r.tipo_dte === '05' ? 'NOTA DE CREDITO' : 'NOTA DE DEBITO',
                    r.tipo_dte,
                    r.numero_control || '',
                    (r.codigo_generacion || '').toUpperCase(),
                    r.proveedor || '', formatearNrc(r.nrc), formatearNit(r.nit),
                    r.documento_corregido || '',
                    num(r.monto), num(r.iva),
                ]),
                ['TOTALES', '', '', '', '', '', '', '', '', '',
                 num(tot.total), num(d.notas.reduce((s, r) =>
                     s + (r.tipo_dte === '05' ? 1 : -1) * Number(r.iva || 0), 0))],
                ['AJUSTE NETO AL CREDITO FISCAL', '', '', '', '', '', '', '', '', '',
                 '', num(tot.debito)],
            ] };
    }
    return null;
};
