import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookOpen, AlertTriangle, FileText, Receipt, Percent, Download, Ban, ShoppingCart, SearchX, Archive, FileJson } from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import ViewTabBar from '../../components/common/ViewTabBar';
import FilterBar from '../../components/common/FilterBar';
import PeriodStepper from '../../components/common/PeriodStepper';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Notice from '../../components/common/Notice';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination from '../../components/common/TablePagination';
import { useStaffStore } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import { formatMoney } from '../../utils/formatNumber';
import { formatearNit, formatearNrc } from '../../utils/nitUtils';
import { normalizeText } from '../../utils/helpers';
import { exportCsv, buildCsvText } from '../../utils/csvExport';
import { fmtFecha, soloNumero, csvRetencionVentas, CSV_RET_VENTAS_HEADERS,
         construirLibro } from './libroIva';
import {
    fetchAnexoRetencionRenta,
    fetchVentasFueraDelLibro,
    fetchLibroConsumidor, fetchLibroContribuyente, fetchLibroAnulados,
    fetchLibroCompras, fetchLibroPercepcion, fetchLibroRetencion,
    fetchNotasCreditoCompras, fetchRetencionVentas, descargarPaqueteDteVenta,
} from '../../data/librosIva';
import { getSignedFileUrl } from '../../utils/storageFiles';

import { registrarEgreso } from '../../data/egreso';
// ─────────────────────────────────────────────────────────────────────────────
// Los siete libros y anexos de IVA del ERP, generados desde el portal:
// ventas desde `sales_invoices`, compras desde `purchase_receipts`.
//
// VENTAS — verificado el 2026-07-31 contra los libros del ERP —7 sucursales × 3
// meses, 84 CSV—: CCF y consumidor 18/18 branch-meses exactos en conteo y monto,
// y los 204 anulados con el md5 del conjunto de `codigo_generacion` idéntico en
// ambos lados. Lo que cierra la diferencia es el filtro del sello: sin él
// sobraban $282.58, que eran exactamente las facturas con `recibido_mh` inválido.
//
// COMPRAS — verificado el 2026-08-01. `purchase_receipts` ya reproducía el libro
// del ERP día por día en Bodega (23 de los 24 días de junio idénticos), pero el
// sync solo corría Bodega y tiraba cuatro campos que el libro necesita. Con las
// 7 sucursales y esos campos, junio cuadra en las 7. Dos cosas que salieron de
// comparar contra el ERP y no de suponer: el libro **incluye las anuladas**
// (Bodega 2026-07-20, 28 docs y $16,321.43 de los dos lados) y el anexo de
// percepción es exactamente el subconjunto con percepción > 0 (226 filas).
//
// Retención y Sujeto Excluido salen vacíos, y eso es correcto: el ERP tampoco
// tiene una sola fila en todo 2025-01 → 2026-07 en las 7 sucursales.
//
// Las columnas y su ORDEN salen del Reglamento del Código Tributario, no del
// CSV del ERP: Art. 83 consumidores, Art. 85 contribuyentes, Art. 86 compras.
// Es la referencia con autoridad y no depende de que un proveedor no cambie su
// exportador. El separador `;` y la fecha DD/MM/YYYY sí se conservan del ERP,
// que es lo que la contadora ya sabe abrir.
// ─────────────────────────────────────────────────────────────────────────────

const IVA_TASA = 0.13;

// El débito fiscal de las ventas a consumidor no está en ninguna columna: se
// calcula, porque el precio al público YA lleva el IVA adentro. Art. 83 lo pide
// explícitamente ("un resumen de cálculo del débito fiscal ... el cual se
// trasladará al libro de operaciones con contribuyentes").
const debitoDeConsumidor = (gravadas) => gravadas * IVA_TASA / (1 + IVA_TASA);

// El orden es el del ERP: primero los libros de ventas, después compras, y al
// final los anexos. Quien arma la declaración los recorre en ese orden.
// Siete pestañas es el récord del portal —el anterior eran cinco— y el ancho de
// la fila es la suma de sus rótulos, así que acá los rótulos son una medida.
// Con "Consumidor Final" y "Sujeto Excluido" completos la fila pedía 1001px y
// solo entraba a partir de 1728: a 1440 (la laptop más común) `ViewTabBar`
// colapsaba con razón al desplegable. Recortados entra a 1440 con margen, y el
// nombre legal completo sigue en el CSV, en su nombre de archivo y en el
// tooltip de Exportar. Por debajo de ~1400 el desplegable toma el relevo, que
// es la degradación correcta y muestra el rótulo entero.
const TABS = [
    { key: 'consumidor',    label: 'Consumidor'     },
    { key: 'contribuyente', label: 'Contribuyentes' },
    { key: 'compras',       label: 'Compras'        },
    { key: 'anulados',      label: 'Anulados'       },
    { key: 'percepcion',    label: 'Percepción'     },
    { key: 'retencion',     label: 'Retención'      },
    // Renta (Art. 156) NO es IVA. Va aparte y al final justamente para que no
    // se lea como una variante de la retención de IVA de al lado.
    { key: 'renta',         label: 'Renta'          },
    // 'excluido' se retiró el 2026-08-02: cero documentos de sujeto excluido en
    // toda la historia y el reporte no existe siquiera en el origen. Una pestaña
    // que siempre sale vacía enseña a ignorar las pestañas vacías — y Retención,
    // que también sale vacía, SÍ hay que seguir mirándola: el día que aparezca
    // una retención es un dato real. El RPC queda vivo para volver a colgarla.
    // Octava, y el rótulo corto no es capricho: "Notas de crédito" completo
    // suma ~120px a una fila que ya colapsa al desplegable a 1440. El nombre
    // entero está en el subtítulo de la sección y en el CSV.
    { key: 'notas',         label: 'N. crédito'     },
];

// Hora SV: se corre el instante 6h y se leen las partes en **UTC**. Leerlas en
// local sobre el instante ya corrido las desplaza DOS veces en una máquina que
// ya está en SV (UTC−6) — así, el 1 de mes antes de las 06:00 esto devolvía el
// mes ANTERIOR, o sea que el libro abría en el período equivocado justo el día
// en que se cierra el anterior. Detectado al replicar este filtro en Facturas
// de Compra (2026-08-01).
const mesActual = () => {
    const sv = new Date(Date.now() - 6 * 3600_000);
    return `${sv.getUTCFullYear()}-${String(sv.getUTCMonth() + 1).padStart(2, '0')}`;
};

// Del 'YYYY-MM' al par de fechas que piden los RPC. `new Date(y, m, 0)` es el
// último día del mes anterior a `m`, o sea el último del mes que se pide.
const rangoDelMes = (mes) => {
    const [y, m] = mes.split('-').map(Number);
    const fin = new Date(y, m, 0).getDate();
    return [`${mes}-01`, `${mes}-${String(fin).padStart(2, '0')}`];
};

const correrMes = (mes, delta) => {
    const [y, m] = mes.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const etiquetaMes = (mes) => {
    const [y, m] = mes.split('-').map(Number);
    return `${MESES[m - 1]} ${y}`;
};


// ── Formato de los archivos que se replican ──────────────────────────────────
//
// Los tres reportes escriben los mismos datos con puntuación DISTINTA, y no hay
// lógica en la diferencia: hay que copiar cada una como es. Verificado sobre los
// archivos reales de junio 2026 el 2026-08-01.
//

const COLS_CONSUMIDOR = [
    { key: 'fecha',     label: 'Fecha',      align: 'left'  },
    { key: 'sucursal',  label: 'Sucursal',   align: 'left', hideBelow: 'md' },
    { key: 'del',       label: 'Del N.º',    align: 'left'  },
    { key: 'al',        label: 'Al N.º',     align: 'left'  },
    // `2xl`: a 1280 las ocho columnas pedían 1,009px contra 886 y **Total del
    // día se salía 123px**. `Docs` es un conteo —contexto— y su total ya está
    // en el carril de arriba.
    { key: 'docs',      label: 'Docs',       align: 'center', hideBelow: '2xl' },
    // `Exentas` sale de la pantalla, igual que en compras: con `lg` estaba
    // visible a 1440 y empujaba "Total del día" fuera del marco (medido: 1128
    // contra 1046), y devolverla a `2xl` la traía de vuelta justo en 1536,
    // donde tampoco entra. Su total sigue en el carril y en el CSV.
    { key: 'gravadas',  label: 'Gravadas',   align: 'right' },
    { key: 'debito',    label: 'Débito fiscal', align: 'right', hideBelow: 'md' },
    { key: 'total',     label: 'Total del día', align: 'right' },
];

// El NIT entra a la tabla porque el Art. 85 lo pide junto al NRC y porque el
// libro del ERP lo lleva. El sello y el código de generación NO: son 40 y 36
// caracteres que empujarían todo fuera del visor y no se leen de un vistazo —
// van en el CSV, que es donde se necesitan.
const COLS_CONTRIBUYENTE = [
    { key: 'n',         label: 'N.º',        align: 'right' },
    { key: 'fecha',     label: 'Fecha',      align: 'left'  },
    { key: 'ccf',       label: 'N.º CCF',    align: 'left'  },
    { key: 'cliente',   label: 'Cliente',    align: 'left'  },
    { key: 'nrc',       label: 'NRC',        align: 'left'  },
    // `2xl` y no `xl`: 1440 YA es xl, así que el NIT se mostraba ahí y entre él
    // y `Exentas` "Total" quedaba fuera del marco (medido: 1147 contra 1046, y
    // 1076 tras acotar el cliente). Cede el NIT y no el NRC porque el NRC es el
    // que identifica al contribuyente en el libro; los dos van completos al CSV.
    { key: 'nit',       label: 'NIT',        align: 'left', hideBelow: '2xl' },
    // `Exentas` fuera de la pantalla, como en consumidor y compras.
    { key: 'gravadas',  label: 'Gravadas',   align: 'right' },
    { key: 'debito',    label: 'Débito',     align: 'right', hideBelow: 'md' },
    { key: 'total',     label: 'Total',      align: 'right' },
];

// La retención NO tiene columna propia, y no por olvido: se probó y no cabe.
// Esta tabla ya ocupa el 100% exacto del contenedor a 1440 y 1536 —es lo que
// obligó a sacar `Exentas` de la pantalla y a esconder el NIT hasta 2xl—, así
// que una columna más empujaba `Total` fuera del visor en 1280, 1366, 1440 y
// 1536 (medido: tabla 1082 contra contenedor 1046). Va como segunda línea de la
// celda de Total, que es además donde se la busca: es la razón de que
// `Gravadas + Débito` no sume el total.
const COLS_ANULADOS = [
    { key: 'n',         label: 'N.º',        align: 'right' },
    { key: 'fecha',     label: 'Fecha',      align: 'left'  },
    { key: 'tipo',      label: 'Tipo',       align: 'center' },
    { key: 'corr',      label: 'Correlativo', align: 'left' },
    { key: 'cg',        label: 'Código de generación', align: 'left', hideBelow: 'lg' },
    { key: 'cliente',   label: 'Cliente',    align: 'left', hideBelow: 'md' },
    { key: 'total',     label: 'Total',      align: 'right' },
];

// Diez columnas no entran, y el arreglo de la primera vuelta NO funcionó — se
// verificó midiendo el 2026-08-01 y `Total`, la columna que este comentario
// declaraba innegociable, quedaba **fuera del visor a 1280, 1366 y 1440**:
//
//   visor 1280 → contenedor 886 · tabla 1173     visor 1440 → 1046 · 1173
//
// La causa es un clásico del proyecto: `Exentas` llevaba `hideBelow: 'xl'`, que
// oculta **por debajo** de 1280 — o sea que la columna que se suponía que cedía
// estaba visible en TODOS los anchos donde estorbaba, y solo desaparecía en los
// angostos, donde el problema es peor. `DataTable` ya documenta esta trampa al
// pie de `HIDE_BELOW` ("`xl` no alcanzaba porque 1440 YA es xl") y por eso ahí
// existen los peldaños `2xl` y `1440`; acá no se usaron.
//
// Ahora la intención escrita y el código coinciden. Ceden, en este orden:
//   1. **Exentas** — fuera de la pantalla. Es $0.00 en todo el histórico de una
//      farmacia, y su total sigue en el carril y en el CSV. Ceder "a 2xl" era
//      devolverle 105px justo al ancho donde tampoco entra.
//   2. **Sucursal** — `2xl`: es dato repetido, y ya desaparece sola cuando hay
//      una sucursal filtrada.
// Las cinco que se declaran a Hacienda —documento, gravadas, crédito fiscal,
// total y el NRC— no ceden a ningún ancho.
//
// Medido después: a 1440 la tabla pide 954 contra 1046 disponibles y `Total`
// entra sin scroll. A 1280 quedan ~68px de deslizamiento dentro de la tarjeta,
// que es la degradación correcta —la tabla se desliza, no se recorta el marco—
// y el orden de columnas deja lo declarable a la vista primero.
const COLS_COMPRAS = [
    { key: 'n',        label: 'N.º',       align: 'right' },
    { key: 'fecha',    label: 'Fecha',     align: 'left'  },
    { key: 'sucursal', label: 'Sucursal',  align: 'left', hideBelow: '2xl' },
    { key: 'doc',      label: 'Documento', align: 'left'  },
    { key: 'proveedor', label: 'Proveedor', align: 'left' },
    { key: 'nrc',      label: 'NRC',       align: 'left', hideBelow: 'md' },
    { key: 'gravadas', label: 'Gravadas',  align: 'right' },
    // "Crédito", no "Crédito fiscal": el rótulo largo pedía 151px de columna
    // para un número de 6 dígitos. En un libro de compras no hay otro crédito
    // con el que confundirlo, y el CSV sí lleva el nombre legal completo.
    { key: 'credito',  label: 'Crédito',   align: 'right', hideBelow: 'md' },
    { key: 'total',    label: 'Total',     align: 'right' },
];

// Percepción y retención comparten anatomía: el mismo documento, el mismo monto
// sujeto y el impuesto que cambia de nombre.
const colsAnexo = (etiquetaImpuesto) => [
    { key: 'n',         label: 'N.º',       align: 'right' },
    { key: 'fecha',     label: 'Fecha',     align: 'left'  },
    // `2xl`: a 1440 la tabla pedía 1077 contra 1046 y el impuesto —la columna
    // por la que existe el anexo— quedaba fuera. La sucursal es el dato que
    // menos dice acá y ya desaparece sola al filtrar por una.
    { key: 'sucursal',  label: 'Sucursal',  align: 'left', hideBelow: '2xl' },
    { key: 'proveedor', label: 'Proveedor', align: 'left'  },
    { key: 'nrc',       label: 'NRC',       align: 'left', hideBelow: 'md' },
    { key: 'doc',       label: 'Documento', align: 'left', hideBelow: 'sm' },
    { key: 'sujeto',    label: 'Monto sujeto', align: 'right' },
    { key: 'impuesto',  label: etiquetaImpuesto, align: 'right' },
];

// Las tres tarjetas del carril son las mismas en los siete libros, pero no
// significan lo mismo: en ventas el impuesto es débito (se paga) y en compras es
// crédito (se resta). Reusar la etiqueta sería un error contable, no un detalle.
const ES_DE_VENTAS = new Set(['consumidor', 'contribuyente', 'anulados']);

const ETIQUETAS = {
    consumidor:    { icon: Receipt,      monto: 'Ventas',       impuesto: 'Débito fiscal'  },
    contribuyente: { icon: Receipt,      monto: 'Ventas',       impuesto: 'Débito fiscal'  },
    anulados:      { icon: Ban,          monto: 'Anulado',      impuesto: 'Débito fiscal'  },
    compras:       { icon: ShoppingCart, monto: 'Compras',      impuesto: 'Crédito fiscal' },
    percepcion:    { icon: ShoppingCart, monto: 'Monto sujeto', impuesto: 'IVA percibido'  },
    retencion:     { icon: ShoppingCart, monto: 'Monto sujeto', impuesto: 'IVA retenido'   },
    renta:         { icon: ShoppingCart, monto: 'Base sin IVA',  impuesto: 'Retención 10%'  },
    // "Ajuste" y no "Crédito fiscal": este número no es el crédito del período,
    // es lo que hay que MOVERLE — y va neto, porque las de crédito lo bajan y
    // las de débito lo suben.
    notas:         { icon: FileText,     monto: 'Ajuste',       impuesto: 'Ajuste al crédito' },
};

// Con una sucursal elegida, la columna Sucursal repite el filtro en cada fila:
// 115px de ancho para un dato que ya está dicho arriba, y son justo los que a
// 1440px empujaban Total fuera del visor (medido: tabla 1164 contra 1046 de
// visor con la columna, 1049 sin ella). No es esconder dato — es no repetirlo.
const sinSucursal = (cols, filtrada) =>
    (filtrada ? cols.filter(c => c.key !== 'sucursal') : cols);

// No lleva Sucursal, y es el único que no la lleva: estos documentos llegan por
// correo y el origen no la trae. Antes que repartir mal un dato fiscal, no se
// reparte — el aviso de la pestaña lo dice con todas las letras.
// Art. 156 CT. La base va SIN IVA: si la persona natural está inscrita emite
// CCF y la base es el gravado; si no lo está el documento no lleva IVA y la base
// es el total. `monto - iva` cubre los dos casos sin ramas.
const COLS_RENTA = [
    { key: 'n',         label: 'N.º',        align: 'right' },
    { key: 'fecha',     label: 'Fecha',      align: 'left'  },
    { key: 'proveedor', label: 'Proveedor',  align: 'left'  },
    { key: 'nit',       label: 'NIT',        align: 'left', hideBelow: 'lg' },
    { key: 'doc',       label: 'Documento',  align: 'left', hideBelow: 'sm' },
    { key: 'base',      label: 'Base',       align: 'right' },
    { key: 'retencion', label: 'Retención',  align: 'right' },
];

const COLS_NOTAS = [
    { key: 'n',         label: 'N.º',        align: 'right' },
    { key: 'fecha',     label: 'Fecha',      align: 'left'  },
    { key: 'tipo',      label: 'Tipo',       align: 'center' },
    { key: 'doc',       label: 'Documento',  align: 'left'  },
    { key: 'proveedor', label: 'Proveedor',  align: 'left'  },
    { key: 'nrc',       label: 'NRC',        align: 'left', hideBelow: 'md' },
    { key: 'corrige',   label: 'Corrige a',  align: 'left', hideBelow: '2xl' },
    { key: 'compra',    label: 'Compra',     align: 'left', hideBelow: 'lg' },
    { key: 'monto',     label: 'Monto',      align: 'right' },
    { key: 'iva',       label: 'IVA',        align: 'right' },
];

const COLS_EXCLUIDO = [
    { key: 'n',         label: 'N.º',       align: 'right' },
    { key: 'fecha',     label: 'Fecha',     align: 'left'  },
    { key: 'sucursal',  label: 'Sucursal',  align: 'left', hideBelow: '2xl' },
    { key: 'proveedor', label: 'Nombre',    align: 'left'  },
    { key: 'nit',       label: 'NIT',       align: 'left', hideBelow: 'md' },
    { key: 'dui',       label: 'DUI',       align: 'left', hideBelow: 'md' },
    { key: 'doc',       label: 'Documento', align: 'left', hideBelow: 'sm' },
    { key: 'total',     label: 'Total',     align: 'right' },
];

// ── Cómo se saca el valor de cada columna ──────────────────────────────────
// UN solo mapa por pestaña, y no dos listas (una para ordenar y otra para
// buscar). Con dos, el día que se agrega una columna se actualiza una y no la
// otra, y el síntoma es mudo: la columna existe, se ve, y simplemente no
// aparece en los resultados de búsqueda. Acá una columna sin entrada no se
// puede ordenar y no se busca — las dos cosas a la vez, por construcción.
//
// El tipo del valor decide el resto: los `number` ordenan por magnitud y no
// entran al buscador (nadie busca "1129.55"); los `string` ordenan con
// `localeCompare` en español y sí forman el corpus de búsqueda.
const ACCESO = {
    consumidor: (nom) => ({
        fecha:    r => r.fecha,
        sucursal: r => nom(r.branch_id),
        del:      r => soloNumero(r.correlativo_del),
        al:       r => soloNumero(r.correlativo_al),
        docs:     r => Number(r.documentos || 0),
        exentas:  r => Number(r.ventas_exentas || 0),
        gravadas: r => Number(r.ventas_gravadas || 0),
        debito:   r => debitoDeConsumidor(Number(r.ventas_gravadas || 0)),
        total:    r => Number(r.total_diario || 0),
    }),
    contribuyente: () => ({
        n:        r => r._n,
        fecha:    r => r.fecha,
        ccf:      r => soloNumero(r.correlativo),
        cliente:  r => r.cliente || '',
        // Este export es el espejo de la tabla, así que el NIT va formateado
        // igual que en pantalla. El CSV FISCAL no pasa por acá: usa `docId()`,
        // que quita los guiones.
        nrc:      r => formatearNrc(r.nrc),
        nit:      r => formatearNit(r.nit),
        exentas:  r => Number(r.ventas_exentas || 0),
        gravadas: r => Number(r.ventas_gravadas || 0),
        debito:   r => Number(r.debito_fiscal || 0),
        total:    r => Number(r.total || 0),
    }),
    anulados: () => ({
        n:       r => r._n,
        fecha:   r => r.fecha,
        tipo:    r => r.tipo_documento || '',
        corr:    r => soloNumero(r.correlativo),
        cg:      r => r.codigo_generacion || '',
        cliente: r => r.cliente || '',
        total:   r => Number(r.total || 0),
    }),
    compras: (nom) => ({
        n:         r => r._n,
        fecha:     r => r.fecha,
        sucursal:  r => nom(r.branch_id),
        // Ordena por lo que se VE, no por lo que guarda la tabla: la celda
        // muestra el número de control real cuando existe (C3).
        doc:       r => r.numero_control || r.documento_numero || '',
        proveedor: r => r.proveedor || '',
        nrc:       r => r.nrc || '',
        gravadas:  r => Number(r.compras_gravadas || 0),
        credito:   r => Number(r.credito_fiscal || 0),
        total:     r => Number(r.total || 0),
    }),
    percepcion: (nom) => ({
        n:         r => r._n,
        fecha:     r => r.fecha,
        sucursal:  r => nom(r.branch_id),
        proveedor: r => r.proveedor || '',
        nrc:       r => r.nrc || '',
        doc:       r => r.documento_numero || '',
        sujeto:    r => Number(r.monto_sujeto || 0),
        impuesto:  r => Number(r.percepcion_iva || 0),
    }),
    retencion: (nom) => ({
        n:         r => r._n,
        fecha:     r => r.fecha,
        sucursal:  r => nom(r.branch_id),
        proveedor: r => r.proveedor || '',
        nrc:       r => r.nrc || '',
        doc:       r => r.documento_numero || '',
        sujeto:    r => Number(r.monto_sujeto || 0),
        impuesto:  r => Number(r.retencion_iva || 0),
    }),
    notas: () => ({
        n:         r => r._n,
        fecha:     r => r.fecha,
        tipo:      r => (r.tipo_dte === '05' ? 'Crédito' : 'Débito'),
        doc:       r => r.numero_control || '',
        proveedor: r => r.proveedor || '',
        nrc:       r => r.nrc || '',
        corrige:   r => r.documento_corregido || '',
        compra:    r => (r.vinculo === 'ligada' ? r.compra_documento : r.vinculo),
        monto:     r => Number(r.monto || 0),
        iva:       r => Number(r.iva || 0),
    }),
};

// `sortable` no se escribe columna por columna: sale de tener accesor. Es la
// misma razón de arriba — una lista a mano se desincroniza de la otra.
const conOrden = (cols, acceso) =>
    cols.map(c => (acceso[c.key] ? { ...c, sortable: true } : c));

const TAM_PAGINA = 50;

// ── Celdas del lado de compras ─────────────────────────────────────────────
// Existen porque las cuatro tablas nuevas repiten las mismas cinco celdas, y
// porque cada una tiene una regla de corte que no es opcional:
//
// - El **código de documento** son 20 caracteres sin espacios. Envolverlo lo
//   parte a la mitad ("16C60F47–17CF–" / "4697–B") y deja de ser copiable de un
//   vistazo: va `nowrap`.
// - El **nombre del proveedor** llega a "FARMACIAS EUROPEAS S.A. DE C.V. (FARMA
//   VALUE)" y envolvía a tres líneas, rompiendo el alto de fila que fija
//   `--row-h`. Se trunca con el nombre completo en `title` (§25.7).
// - El **badge** no puede truncarse junto al texto: va en un `flex min-w-0` con
//   `shrink-0`, que es el patrón del proyecto para texto + estado.
// - Los **montos** nunca envuelven: un número partido no comunica nada (§25.7).

const CeldaFecha = ({ iso }) => <span className="whitespace-nowrap">{fmtFecha(iso)}</span>;

// `text-micro` y no `text-caption`: son 20 caracteres monoespaciados y a caption
// la columna pedía 168px, que es lo que empujaba Total fuera del visor. Es la
// misma medida que el código de generación en la pestaña de Anulados.
// C3 — el número que se muestra es el que identifica el documento.
//
// En compras, `documento_numero` no es un número de control: es un **código de
// generación cortado a 20 caracteres** (`7EC4501D-6456-4E0D-A`), 778 de 872
// compras desde junio. Con ese string no se busca el documento ni se le reclama
// nada a un proveedor. El número real vive del lado de las facturas que llegan
// por correo y se recupera con el cruce del Libro Completo — 380 de 467 en julio.
//
// El archivo NO cambia: el CSV replica el reporte de referencia y esa columna es
// la clave más discriminante del cotejo, así que sigue llevando lo del origen
// (`generar_csv_libro`, que arma directo de la tabla). Cotejar y presentar no son
// el mismo uso. Que pantalla y archivo lleven distinto se explica UNA vez, en el
// aviso de la pestaña, y no por fila: envolver la celda en `LiquidTooltip` para
// decirlo la trunca —el `inline-block` del wrapper hace que respete el ancho de
// la columna y `DTE-03-M001P001-000000000014693` sale cortado en `…-0000`—, que
// es el mismo choque que §15.10 anota para el caso (A).
const CeldaDocumento = ({ numero, control }) => (
    (control || numero)
        ? <span className="font-mono text-micro text-content-2 whitespace-nowrap">{control || numero}</span>
        : <Badge variant="danger" size="sm">Sin número</Badge>
);

const CeldaNrc = ({ nrc }) => (
    nrc
        ? <span className="font-mono text-caption whitespace-nowrap">{formatearNrc(nrc)}</span>
        : <Badge variant="warning" size="sm">Falta</Badge>
);

// El NIT se REFORMATEA al mostrarlo porque el dato viene guardado con la máscara
// equivocada: `customers.nit` tiene 29 filas con la forma `0177-7948--2`, que es
// un NIT de 9 dígitos —o sea un DUI— vestido con la máscara de 14. Ver
// `src/utils/nitUtils.js`. El CSV del libro no depende de esto: ahí va sin
// guiones.
const CeldaNit = ({ nit }) => (
    nit
        ? <span className="font-mono text-caption whitespace-nowrap">{formatearNit(nit)}</span>
        : <Badge variant="warning" size="sm">Falta</Badge>
);

const CeldaMonto = ({ v, fuerte }) => (
    <span className={`whitespace-nowrap${fuerte ? ' font-black' : ''}`}>{formatMoney(v)}</span>
);

// El `max-w` va en la celda y no en el `<span>`: la tabla es de ancho
// automático, así que sin un tope en el `<td>` la columna crece hasta el nombre
// más largo y el recorte no llega a activarse nunca. Es el mismo patrón que
// `VentasView` (`truncate max-w-[140px]` sobre el `DataCell`).
//
// A DOS LÍNEAS y no `truncate`: en un libro fiscal la razón social es el dato,
// no una etiqueta. Con una sola línea a 11rem, "UNISERFA S.A. DE C.V. (LOS
// ROBLES)" y "CONGELADOS DEL SABOR, EL SALVADOR SA DE CV" quedaban cortadas en
// el paréntesis, que es justo donde vive el nombre con el que la farmacia
// conoce al proveedor. Medido: la mediana son 32 caracteres y el máximo 45
// ("FARMACIAS EUROPEAS S.A. DE C.V. (FARMA VALUE)"), así que a 16rem entran
// completos en dos líneas. El `line-clamp-2` sigue siendo el tope: si algún día
// aparece uno más largo, se recorta en vez de estirar la fila sin control.
const CeldaProveedor = ({ nombre, anulada }) => (
    <DataCell className="max-w-[16rem]">
        <div className="flex items-start gap-2 min-w-0">
            <span className="line-clamp-2 break-words leading-tight" title={nombre || undefined}>
                {nombre || '—'}
            </span>
            {anulada && <Badge variant="warning" size="sm" className="shrink-0">Anulada</Badge>}
        </div>
    </DataCell>
);

// `client-zip` solo hace falta al apretar "Paquete del mes", así que va por
// `await import()` y no en el chunk de la vista — regla de librerías pesadas de
// CLAUDE.md. Mismo patrón (y misma librería) que `facturasCompra.js`: escribe
// entrada por entrada en vez de pedir todo en memoria antes de empezar.
let zipPromise = null;
function getZipLib() {
    if (!zipPromise) {
        zipPromise = import('client-zip')
            .catch(err => { zipPromise = null; throw err; });  // reintentar, no quedar roto
    }
    return zipPromise;
}

// ── El DTE archivado de una venta ───────────────────────────────────────────
//
// `sales-dte` es un bucket PRIVADO: en la base vive la URL formato-public como
// identificador y `getSignedFileUrl` la firma en el momento de abrirla. Guardar
// una firmada sería guardar algo que expira.
function dispararDescarga(blob, nombre) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
}

async function bajarArchivo(path, nombre) {
    const url = await getSignedFileUrl(path);
    if (!url) throw new Error('No se pudo firmar el enlace del archivo.');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`No se pudo bajar el archivo (HTTP ${res.status}).`);
    dispararDescarga(await res.blob(), nombre);
}

// El ZIP de un documento vive en `librosIva.js` (`descargarPaqueteDteVenta`):
// lo usan los dos lados, la tabla y el modal del documento.

// ── Sección: el IVA que NOS retuvieron ──────────────────────────────────────
//
// Vive en la pestaña de Retención pero es la mitad OPUESTA del anexo que está
// abajo: acá el agente de retención es el cliente y nosotros somos el retenido.
// Separadas y rotuladas porque sumarlas sería declarar un impuesto por otro —
// la misma línea que ya separa la retención de Renta (Art. 156) de la de IVA
// (Art. 162).
//
// Tabla propia y no la de la pestaña: son ≤10 filas por mes en toda la
// historia, así que no necesita buscador ni paginación, y el anexo de abajo
// tiene que conservar los suyos intactos porque es el archivo que se presenta.
const COLS_RET_VENTAS = [
    { key: 'n',      label: 'N.º',       align: 'right' },
    { key: 'fecha',  label: 'Fecha',     align: 'left'  },
    { key: 'sucursal', label: 'Sucursal', align: 'left', hideBelow: 'lg' },
    { key: 'tipo',   label: 'Tipo',      align: 'center' },
    { key: 'cliente', label: 'Cliente',  align: 'left'  },
    // El NRC NO tiene columna, y `Base` cede hasta 2xl. Es cuestión de ancho
    // medido, no de gusto: con las dos, la tabla daba 1159 contra un contenedor
    // de 1076 a 1536 y lo que quedaba fuera del visor era la columna DTE — o
    // sea los botones, que son el motivo de la sección. Ceden estas dos y no el
    // cliente ni la sucursal porque son las únicas que están **a un clic**: la
    // fila abre el documento, que trae NIT y NRC, y las dos van completas al
    // CSV. La base además es el retenido por cien.
    { key: 'doc',    label: 'Documento', align: 'left', hideBelow: '2xl' },
    { key: 'ret',    label: 'Retenido',  align: 'right' },
    { key: 'dte',    label: 'DTE',       align: 'center' },
];

function SeccionRetencionVentas({ filas, loading, mes, empty, sufijoArchivo, nombreSucursal, onAbrir, onError }) {
    const [bajando, setBajando] = useState(null);

    const total   = filas.reduce((s, r) => s + Number(r.retencion_iva || 0), 0);
    const vigente = filas.filter(r => !r.anulada)
                         .reduce((s, r) => s + Number(r.retencion_iva || 0), 0);
    const anuladas = filas.filter(r => r.anulada).length;

    const correr = async (clave, fn) => {
        setBajando(clave);
        try { await fn(); } catch (e) { onError(e.message); } finally { setBajando(null); }
    };

    return (
        <section data-surface="card" className="p-4 md:p-5 space-y-3">
            <header className="flex flex-wrap items-baseline justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-body font-bold">IVA que nos retuvieron</h3>
                    <p className="text-caption text-content-3">
                        Ventas en las que el cliente retuvo el 1% y lo entera él mismo (Art. 162
                        del Código Tributario). Es impuesto ya pagado: se acredita al declarar.
                    </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    <Button variant="secondary" size="sm" icon={Download}
                        disabled={loading || filas.length === 0}
                        title={`Exportar los ${filas.length} documentos con retención de ${etiquetaMes(mes)} en CSV`}
                        onClick={() => exportCsv(CSV_RET_VENTAS_HEADERS, csvRetencionVentas(filas),
                            `iva-retenido-sobre-ventas_${sufijoArchivo}.csv`, 'libros_iva_retencion')}>
                        Exportar
                    </Button>
                <div className="text-right">
                    <p className="font-mono text-title tabular-nums font-black">{formatMoney(vigente)}</p>
                    <p className="text-micro text-content-3">
                        {filas.length} documento{filas.length === 1 ? '' : 's'} en {etiquetaMes(mes)}
                        {/* La anulada no se acredita, pero su retención SÍ aparece en el
                            Corte Z del período. Decirlo es lo que hace que la resta se
                            entienda en vez de parecer un descuadre. */}
                        {anuladas > 0 && <> · {anuladas} anulado{anuladas === 1 ? '' : 's'} por {formatMoney(total - vigente)}, que no se acredita{anuladas === 1 ? '' : 'n'}</>}
                    </p>
                </div>
                </div>
            </header>

            {/* A sangre dentro de la tarjeta: el `p-4 md:p-5` le cobraba 40px de
                ancho a la tabla, y acá cada píxel se paga —con el padding, la
                columna DTE quedaba fuera del visor a 1280 y 1536—. El borde
                propio de la tabla sigue marcando dónde empieza. */}
            <div className="-mx-4 md:-mx-5">
            {/* El toque abre el documento emitido. Sin `usarAccionDeFila` gana
                la hoja genérica, que sólo repite las columnas de la ficha. */}
            <DataTable columns={COLS_RET_VENTAS} loading={loading} movil={{ usarAccionDeFila: true }} empty={empty}>
                {filas.map((r, i) => (
                    <DataRow key={r.codigo_generacion || `${r.erp_invoice_id}-${i}`} index={i}
                        onClick={() => onAbrir(r)}>
                        <DataCell align="right">{i + 1}</DataCell>
                        <DataCell><CeldaFecha iso={r.fecha} /></DataCell>
                        <DataCell hideBelow="lg" className="whitespace-nowrap">{nombreSucursal(r.branch_id)}</DataCell>
                        {/* Mismo badge que el anexo de anulados. No es decorativo:
                            los dos tipos son dos fundamentos distintos del mismo
                            1% —empresa gran contribuyente contra institución del
                            Estado— y además cada uno cuadra contra una línea
                            distinta del Corte Z (factura y crédito fiscal). */}
                        <DataCell align="center">
                            <Badge variant={r.tipo_documento === 'CCF' ? 'danger' : 'neutral'} size="sm">
                                {r.tipo_documento || '—'}
                            </Badge>
                        </DataCell>
                        {/* SIN recorte: el nombre del cliente es el dato, no una
                            etiqueta, y acá son instituciones ("ISSS, FONDO
                            CIRCULANTE UM CHALATENANGO"). Envuelve en las líneas
                            que haga falta — son ≤10 filas por mes, no una tabla
                            de 400 donde la altura de fila se paga. */}
                        <DataCell className="min-w-[9rem]">
                            {/* `flex-wrap` y el badge SIN `shrink-0`: con el badge
                                fijo, el ancho mínimo de esta celda pasaba a ser
                                "nombre + badge en una línea" —234px medidos— y a
                                1280 eso empujaba la columna de botones fuera del
                                visor. Que baje de línea cuesta una fila más alta
                                en el único documento anulado del mes. */}
                            <div className="flex flex-wrap items-start gap-x-2 gap-y-1 min-w-0">
                                <span className="break-words leading-tight">{r.cliente || '—'}</span>
                                {r.anulada && <Badge variant="warning" size="sm">Anulada</Badge>}
                            </div>
                        </DataCell>
                        {/* El correlativo y no el número de control: el control son
                            31 caracteres monoespaciados y vale ~230px de tabla. Va
                            en el DTE, que se abre acá al lado. */}
                        <DataCell hideBelow="2xl">
                            <CeldaDocumento numero={soloNumero(r.correlativo)} />
                        </DataCell>
                        <DataCell align="right"><CeldaMonto fuerte v={r.retencion_iva} /></DataCell>
                        <DataCell align="center">
                            {/* Deshabilitados y no ocultos cuando el documento no
                                está archivado: que el botón exista y no se pueda
                                apretar dice "falta el archivo"; que no exista dice
                                "acá no hay nada que abrir", que es otra cosa. */}
                            {/* `stopPropagation` en los tres: la fila entera abre el
                                documento, así que sin esto bajar un archivo abriría
                                además el modal encima. */}
                            <div className="flex items-center justify-center gap-1">
                                <Button tone="chart-1" size="sm" iconOnly icon={FileJson}
                                    disabled={!r.json_path || bajando != null}
                                    title={r.json_path ? 'Descargar el JSON del documento' : 'El JSON de este documento no está guardado'}
                                    onClick={(e) => { e.stopPropagation(); correr(`${r.codigo_generacion}-json`,
                                        () => bajarArchivo(r.json_path, `${String(r.codigo_generacion).toUpperCase()}.json`)); }} />
                                <Button tone="chart-1" size="sm" iconOnly icon={FileText}
                                    disabled={!r.pdf_path || bajando != null}
                                    title={r.pdf_path ? 'Descargar el PDF del documento' : 'El PDF de este documento no está guardado'}
                                    onClick={(e) => { e.stopPropagation(); correr(`${r.codigo_generacion}-pdf`,
                                        () => bajarArchivo(r.pdf_path, `${String(r.codigo_generacion).toUpperCase()}.pdf`)); }} />
                                <Button tone="chart-1" size="sm" iconOnly icon={Archive}
                                    disabled={(!r.json_path && !r.pdf_path) || bajando != null}
                                    title="Descargar los dos en un ZIP"
                                    onClick={(e) => { e.stopPropagation(); correr(`${r.codigo_generacion}-zip`,
                                        () => descargarPaqueteDteVenta(r)); }} />
                            </div>
                        </DataCell>
                    </DataRow>
                ))}
            </DataTable>
            </div>
        </section>
    );
}

// ── Totales de un juego de libros ────────────────────────────────────────────
//
// A nivel de módulo y no dentro del componente porque el ZIP los necesita **por
// sucursal**: cada archivo del paquete lleva su propia fila de TOTALES, y
// calcularla sobre el total del mes le pondría a cada sucursal el número de
// todas.
const calcularTotales = (d) => {
    const suma = (filas, campo) => filas.reduce((s, r) => s + Number(r[campo] || 0), 0);
    const gravadasCons = suma(d.consumidor, 'ventas_gravadas');

    return {
        consumidor:    { docs: suma(d.consumidor, 'documentos'),
                         exentas: suma(d.consumidor, 'ventas_exentas'),
                         gravadas: gravadasCons,
                         debito: debitoDeConsumidor(gravadasCons),
                         total: suma(d.consumidor, 'total_diario') },
        contribuyente: { docs: d.contribuyente.length,
                         exentas: suma(d.contribuyente, 'ventas_exentas'),
                         gravadas: suma(d.contribuyente, 'ventas_gravadas'),
                         debito: suma(d.contribuyente, 'debito_fiscal'),
                         // El 1% que retuvo el cliente. No baja la venta ni el
                         // débito: es impuesto ya enterado por él, y por eso el
                         // total del documento es menor que gravadas + débito.
                         retencion: suma(d.contribuyente, 'retencion_iva'),
                         total: suma(d.contribuyente, 'total') },
        anulados:      { docs: d.anulados.length, exentas: 0, gravadas: 0, debito: 0,
                         total: suma(d.anulados, 'total') },
        // En compras la tercera tarjeta es el crédito fiscal, no el débito:
        // es el impuesto que se resta, no el que se paga.
        compras:       { docs: d.compras.length,
                         exentas:  suma(d.compras, 'compras_exentas'),
                         gravadas: suma(d.compras, 'compras_gravadas'),
                         debito:   suma(d.compras, 'credito_fiscal'),
                         total:    suma(d.compras, 'total') },
        percepcion:    { docs: d.percepcion.length, exentas: 0,
                         gravadas: suma(d.percepcion, 'monto_sujeto'),
                         debito:   suma(d.percepcion, 'percepcion_iva'),
                         total:    suma(d.percepcion, 'monto_sujeto') },
        renta:         { docs: d.renta.length, exentas: 0,
                         gravadas: suma(d.renta, 'base_sin_iva'),
                         debito:   suma(d.renta, 'retencion_10'),
                         total:    suma(d.renta, 'base_sin_iva') },
        retencion:     { docs: d.retencion.length, exentas: 0,
                         gravadas: suma(d.retencion, 'monto_sujeto'),
                         debito:   suma(d.retencion, 'retencion_iva'),
                         total:    suma(d.retencion, 'monto_sujeto') },
        // El IVA que nos retuvieron. `debito` va SIN los anulados: es el que se
        // acredita, y es el que muestra el carril de la pestaña.
        retencionVentas: { docs: (d.retencionVentas || []).length, exentas: 0,
                         gravadas: suma(d.retencionVentas || [], 'monto_sujeto'),
                         debito:   suma((d.retencionVentas || []).filter(r => !r.anulada), 'retencion_iva'),
                         total:    suma(d.retencionVentas || [], 'monto_sujeto') },
        // El IVA va NETO: las notas de crédito bajan el crédito fiscal y las
        // de débito lo suben, así que sumarlas todas juntas daría un ajuste
        // mayor al real. Es el número que contabilidad tiene que mover.
        notas:         { docs: d.notas.length, exentas: 0,
                         gravadas: suma(d.notas.filter(r => r.tipo_dte === '05'), 'monto')
                                 - suma(d.notas.filter(r => r.tipo_dte === '06'), 'monto'),
                         debito:   suma(d.notas.filter(r => r.tipo_dte === '05'), 'iva')
                                 - suma(d.notas.filter(r => r.tipo_dte === '06'), 'iva'),
                         total:    suma(d.notas, 'monto') },
    };
};


// ── El paquete del mes: un ZIP con carpeta por libro y un CSV por sucursal ───
//
// Lo que contabilidad hace hoy es entrar ocho veces, cambiar la sucursal seis
// veces y bajar 44 archivos a mano. Un archivo mal nombrado o una sucursal
// salteada en esa rutina no se nota hasta que Hacienda cruza el mes.
//
// Trae los libros SIN filtro de sucursal —una llamada por libro, no una por
// libro y sucursal— y los reparte acá por `branch_id`. Son 8 consultas en vez de
// 44, el servidor ya aplica el scope del usuario, y el orden dentro de cada
// sucursal es el que devolvió el RPC, que es el orden legal.
//
// Renta y notas de crédito NO se reparten: sus documentos llegan por correo y no
// traen sucursal (ver `librosIva.js`). Van sueltos en la raíz del ZIP.
// Inventarles una carpeta de sucursal sería inventarles el dato.
//
// Devuelve `null` si no hay una sola fila en el período — quien llama decide qué
// decir. Lanza si algún libro falla: un paquete al que le falta un libro en
// silencio es peor que no tener paquete.
const POR_SUCURSAL = ['consumidor', 'contribuyente', 'compras', 'anulados',
                      'percepcion', 'retencion', 'retencionVentas'];
const SIN_SUCURSAL = ['renta', 'notas'];
const LIBROS_VACIOS = { consumidor: [], contribuyente: [], anulados: [], compras: [],
                        percepcion: [], retencion: [], notas: [], renta: [],
                        retencionVentas: [] };

async function armarPaqueteDelMes({ desde, hasta, mes, nombreSucursal }) {
    const { downloadZip } = await getZipLib();
    const [cons, contrib, anul, comp, perc, ret, nts, rent, rv] = await Promise.all([
        fetchLibroConsumidor(desde, hasta, null),
        fetchLibroContribuyente(desde, hasta, null),
        fetchLibroAnulados(desde, hasta, null),
        fetchLibroCompras(desde, hasta, null),
        fetchLibroPercepcion(desde, hasta, null),
        fetchLibroRetencion(desde, hasta, null),
        fetchNotasCreditoCompras(desde, hasta),
        fetchAnexoRetencionRenta(desde, hasta),
        fetchRetencionVentas(desde, hasta, null),
    ]);
    for (const r of [cons, contrib, anul, comp, perc, ret, nts, rent, rv])
        if (r.error) throw r.error;

    const todo = {
        consumidor: cons.data || [], contribuyente: contrib.data || [],
        anulados: anul.data || [], compras: comp.data || [],
        percepcion: perc.data || [], retencion: ret.data || [],
        notas: nts.data || [], renta: rent.data || [],
        retencionVentas: rv.data || [],
    };

    // Las sucursales que APARECEN en el período, no una lista a mano: el día que
    // abra una sucursal entra sola, y una que no vendió ni compró no genera seis
    // archivos vacíos.
    const ids = [...new Set(POR_SUCURSAL.flatMap(k => todo[k].map(r => r.branch_id)))]
        .filter(id => id != null)
        .sort((a, b) => a - b);

    const entradas = [];
    const agregar = (tab, filasDelLibro, nombre) => {
        if (filasDelLibro.length === 0) return;   // sin filas no hay archivo
        const d = { ...LIBROS_VACIOS, [tab]: filasDelLibro };
        const libro = construirLibro(tab, d, calcularTotales(d)[tab]);
        entradas.push({ name: nombre(libro), input: buildCsvText(libro.headers, libro.rows) });
    };

    for (const tab of POR_SUCURSAL)
        for (const id of ids)
            agregar(tab, todo[tab].filter(r => r.branch_id === id),
                l => `${l.base}/${nombreSucursal(id).replace(/\s+/g, '-')}.csv`);

    for (const tab of SIN_SUCURSAL)
        agregar(tab, todo[tab], l => `${l.base}_${mes}.csv`);

    if (entradas.length === 0) return null;
    return { blob: await downloadZip(entradas).blob(), nombre: `libros-iva_${mes}.zip`, archivos: entradas.length };
}

export default function LibrosIvaView({ openModal }) {
    const { getScope, user, hasPermission } = useAuth();
    // Canon de permisos 2026-08-03. Cada pestaña es un LIBRO distinto, no un
    // corte del mismo dato: un contador externo puede necesitar Compras y no las
    // ventas. Exportar es aparte de mirar, y los montos también.
    const canDownload = hasPermission('libros_iva_descargar');
    const canVerMontos = hasPermission('libros_iva_ver_montos');
    const branches = useStaffStore((s) => s.branches);

    const [searchParams, setSearchParams] = useSearchParams();
    const rawTab = searchParams.get('tab');
    // Mismo patrón que Ventas/Productos/Facturación: la pestaña por defecto es la
    // PRIMERA PERMITIDA, no `consumidor` fijo — si no, quien no tenga ese libro
    // abre la vista en una pestaña que no puede ver.
    const allowedTabs = TABS.filter(t => hasPermission(`libros_iva_tab_${t.key}`));
    const activeTab = allowedTabs.some(t => t.key === rawTab)
        ? rawTab
        : (allowedTabs[0]?.key ?? 'consumidor');
    const setActiveTab = (tab) => setSearchParams(p => { p.set('tab', tab); return p; });

    const [mes, setMes] = useState(mesActual);
    const [filterBranch, setFilterBranch] = useState(
        getScope('libros_iva') !== 'ALL' ? String(user?.branchId || '') : ''
    );

    // Buscar, ordenar y paginar recortan LO QUE SE VE, nunca lo que se declara:
    // el carril sigue mostrando el total del período y el CSV sale con el libro
    // entero en su orden legal. Es la línea que no se puede cruzar — un libro
    // exportado a medias por un filtro de pantalla se presenta igual de bien
    // que uno completo, y nadie lo nota hasta que Hacienda lo cruza.
    const [busqueda, setBusqueda] = useState('');
    const [orden, setOrden] = useState({ key: null, dir: 'asc' });
    const [pagina, setPagina] = useState(1);
    const [tamPagina, setTamPagina] = useState(TAM_PAGINA);

    const [consumidor,    setConsumidor]    = useState([]);
    const [contribuyente, setContribuyente] = useState([]);
    const [anulados,      setAnulados]      = useState([]);
    const [compras,       setCompras]       = useState([]);
    const [percepcion,    setPercepcion]    = useState([]);
    const [retencion,     setRetencion]     = useState([]);
    // La otra mitad de la pestaña de Retención: las ventas donde el cliente nos
    // retuvo. Estado aparte y NO dentro de `datos` a propósito — `datos` es lo
    // que alimenta el buscador, el orden, la paginación y el CSV de la pestaña,
    // y todo eso tiene que seguir siendo el anexo del Art. 162, que es el
    // archivo que se presenta.
    const [retVentas,     setRetVentas]     = useState([]);
    const [renta,         setRenta]         = useState([]);
    const [fuera,         setFuera]         = useState(null);
    const [notas,         setNotas]         = useState([]);
    const [loading, setLoading] = useState(true);
    const [error,   setError]   = useState(null);
    // El paquete del mes vuelve a pedir los ocho libros sin filtro de sucursal,
    // así que tarda más que un CSV suelto y necesita su propio estado.
    const [zipeando, setZipeando] = useState(false);

    const [desde, hasta] = useMemo(() => rangoDelMes(mes), [mes]);

    // Los siete libros se traen JUNTOS aunque solo se vea uno: son de un mes y
    // caben en cientos de filas, así que cambiar de pestaña no vuelve a la red —
    // y el carril puede mostrar el total del período sin importar dónde estés.
    const load = useCallback(async () => {
        setLoading(true);
        const [c, k, a, co, pe, re, nc, rt, fu, rv] = await Promise.all([
            fetchLibroConsumidor(desde, hasta, filterBranch),
            fetchLibroContribuyente(desde, hasta, filterBranch),
            fetchLibroAnulados(desde, hasta, filterBranch),
            fetchLibroCompras(desde, hasta, filterBranch),
            fetchLibroPercepcion(desde, hasta, filterBranch),
            fetchLibroRetencion(desde, hasta, filterBranch),
            // Sin sucursal: el origen no la trae. Ver `fetchNotasCreditoCompras`.
            fetchNotasCreditoCompras(desde, hasta),
            // Sin sucursal, igual que las notas: los documentos llegan a una
            // casilla de la empresa y no traen sucursal.
            fetchAnexoRetencionRenta(desde, hasta),
            fetchVentasFueraDelLibro(desde, hasta, filterBranch),
            fetchRetencionVentas(desde, hasta, filterBranch),
        ]);
        // Un libro que falla NO puede quedar como "no hubo operaciones": un mes
        // vacío por error de red es indistinguible de un mes sin movimiento, y
        // acá eso se declara a Hacienda. Vale doble para Retención y Sujeto
        // Excluido, que salen vacíos aun cuando todo funciona.
        const fallo = c.error || k.error || a.error || co.error || pe.error || re.error || nc.error || rt.error || fu.error || rv.error;
        setError(fallo ? fallo.message : null);
        setConsumidor(c.data || []);
        setContribuyente(k.data || []);
        setAnulados(a.data || []);
        setCompras(co.data || []);
        setPercepcion(pe.data || []);
        setRetencion(re.data || []);
        setNotas(nc.data || []);
        setRenta(rt.data || []);
        setFuera((fu.data ?? [])[0] ?? null);
        setRetVentas(rv.data || []);
        setLoading(false);
    }, [desde, hasta, filterBranch]);

    useEffect(() => { load(); }, [load]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos

    const nombreSucursal = useCallback(
        (id) => branches.find(b => b.id === id)?.name || `Suc. ${id}`,
        [branches]);

    // Las opciones salen de las sucursales que APARECEN en el período, no de una
    // lista escrita a mano: la de ventas ya está codificada en dos vistas y se
    // desincroniza sola el día que abra una sucursal.
    const branchOptions = useMemo(() => {
        const ids = new Set([
            ...consumidor.map(r => r.branch_id),
            ...contribuyente.map(r => r.branch_id),
            ...anulados.map(r => r.branch_id),
            ...compras.map(r => r.branch_id),
        ]);
        return [...ids].sort((a, b) => a - b)
            .map(id => ({ value: String(id), label: nombreSucursal(id) }));
    }, [consumidor, contribuyente, anulados, compras, nombreSucursal]);

    // El juego completo de libros cargados, en un solo objeto: es lo que comen
    // `calcularTotales` y `construirLibro`, y lo que el ZIP arma por sucursal.
    const datos = useMemo(
        () => ({ consumidor, contribuyente, anulados, compras, percepcion, retencion, notas, renta,
                 retencionVentas: retVentas }),
        [consumidor, contribuyente, anulados, compras, percepcion, retencion, notas, renta, retVentas]);

    const totales = useMemo(() => calcularTotales(datos), [datos]);

    // En Retención el carril habla de la sección que TIENE filas. Dejarlo en el
    // anexo del Art. 162 mostraría $0.00 arriba mientras la tabla de abajo
    // muestra $42.92, y de un vistazo eso se lee como un error, no como dos
    // cosas distintas. El cálculo vive en `calcularTotales` —que es también el
    // que usa el paquete del mes— y no acá suelto.
    const t = activeTab === 'retencion' ? totales.retencionVentas : totales[activeTab];

    // Cuántos CCF del período van a salir sin NRC. Es el dato que decide si el
    // libro de contribuyentes se puede presentar tal cual.
    const ccfSinNrc = useMemo(
        () => contribuyente.filter(r => !r.nrc).length,
        [contribuyente]);

    // ¿Este período tiene retención de IVA? Decide si la columna existe — sobre
    // el período completo y no sobre la página que se está mirando.
    const hayRetencion = useMemo(
        () => contribuyente.some(r => Number(r.retencion_iva || 0) > 0),
        [contribuyente]);

    // Abrir el DTE de una venta, como en Facturas de Compra: el documento
    // completo, con su detalle y su PDF. Se le agrega el nombre de la sucursal
    // porque la fila trae el id y el modal no tiene de dónde resolverlo.
    const abrirDte = useCallback((row) => {
        openModal?.('viewSalesDte', {
            document: { ...row, sucursal: nombreSucursal(row.branch_id) },
        });
        useStaffStore.getState().appendAuditLog('LIBROS_IVA_VER_DTE', String(row.erp_invoice_id || ''), {
            codigo_generacion: row.codigo_generacion,
        });
    }, [openModal, nombreSucursal]);

    // Lo mismo del lado de compras: sin NRC del proveedor el Art. 86 no se
    // cumple. Hoy son 2 proveedores del ERP a los que les falta el dato.
    const comprasSinNrc = useMemo(
        () => compras.filter(r => !r.nrc).length,
        [compras]);

    // Documentos que el sync trajo antes de que existieran las columnas del
    // libro. NULL no es cero: si queda alguno, el libro está incompleto y hay
    // que resincronizar ese período — no presentarlo así.
    const comprasSinSincronizar = useMemo(
        () => compras.filter(r => r.documento_numero == null).length,
        [compras]);

    // El número de control se trae documento por documento y puede quedar a
    // medias: si el origen se cae, lo que falte queda en NULL. Cuenta la
    // pestaña que se está mirando, porque cada libro lo lleva en su propia
    // columna —consumidor en dos, el del primero y el del último del día— y un
    // faltante en uno no dice nada del otro.
    const sinNumeroControl = useMemo(() => {
        if (activeTab === 'consumidor')
            return consumidor.filter(r => !r.numero_control_del || !r.numero_control_al).length;
        if (activeTab === 'contribuyente')
            return contribuyente.filter(r => !r.numero_control).length;
        if (activeTab === 'anulados')
            return anulados.filter(r => !r.numero_control).length;
        return 0;
    }, [activeTab, consumidor, contribuyente, anulados]);

    const sufijoArchivo = `${mes}${filterBranch ? `_${nombreSucursal(Number(filterBranch)).replace(/\s+/g, '-')}` : ''}`;

    // Arma UN libro y devuelve sus filas — no descarga nada. La descarga suelta
    // (`exportar`) y el ZIP de todas las sucursales pasan los dos por acá, a
    // propósito: el día que una columna cambie, cambia en los dos archivos o en
    // ninguno. Dos transcripciones del mismo libro fiscal es exactamente el
    // problema que este módulo ya tuvo entre el RPC y `generar_csv_libro`.
    //
    // `d` es el juego de libros y `tot` sus totales — explícitos y no tomados
    // del estado, porque el ZIP los arma POR SUCURSAL.

    const exportar = () => {
        const libro = construirLibro(activeTab, datos, t);
        if (libro) exportCsv(libro.headers, libro.rows, `${libro.base}_${sufijoArchivo}.csv`, 'libros_iva');
    };

    // El armado vive a nivel de módulo (`armarPaqueteDelMes`); acá solo el
    // estado. El `try/catch` tiene que quedar AFUERA del componente: el
    // compilador de React se rinde con un componente que contiene una sentencia
    // `try`, y cuando se rinde pierde la memoización de TODA la vista —lo detectó
    // `react-hooks/set-state-in-effect`, que dejó de reportar en dos líneas que
    // no se habían tocado. Por eso el handler encadena promesas en vez de usar
    // `await` con `try`.
    const descargarZip = () => {
        setZipeando(true);
        armarPaqueteDelMes({ desde, hasta, mes, nombreSucursal })
            .then(paquete => {
                if (!paquete) { setError('No hay libros con datos en este período.'); return; }
                const a = Object.assign(document.createElement('a'), {
                    href: URL.createObjectURL(paquete.blob),
                    download: paquete.nombre,
                });
                a.click();
                URL.revokeObjectURL(a.href);
                registrarEgreso('libros_iva', { formato: 'zip', filas: paquete.archivos ?? null, detalle: { mes, paquete: 'mes-completo' } });
            })
            .catch(e => setError(e?.message || 'No se pudo generar el paquete.'))
            .finally(() => setZipeando(false));
    };

    // Memoizado y no un objeto literal suelto: si `filas` cambia de identidad en
    // cada render, se la lleva puesta toda la cadena de `useMemo` de abajo
    // —numerar, filtrar, ordenar, paginar— sobre 467 filas y en cada tecleo del
    // buscador.
    const filas = useMemo(() => datos[activeTab] ?? [], [datos, activeTab]);

    const acceso = useMemo(
        () => (ACCESO[activeTab] || ACCESO.consumidor)(nombreSucursal),
        [activeTab, nombreSucursal]);

    // El número de orden se fija ACÁ, sobre el libro tal como lo devolvió el
    // RPC, y viaja pegado a la fila. Si se recalculara al pintar (`i + 1` como
    // antes) bastaría ordenar por monto para que el documento 412 pasara a
    // llamarse "1": en un libro fiscal el correlativo de la operación es parte
    // del dato, no la posición en la lista de la pantalla.
    const filasNumeradas = useMemo(
        () => filas.map((r, i) => (r._n === i + 1 ? r : { ...r, _n: i + 1 })),
        [filas]);

    const filasVistas = useMemo(() => {
        const q = normalizeText(busqueda);
        const textos = Object.values(acceso);
        let out = q
            ? filasNumeradas.filter(r => textos.some(fn => {
                const v = fn(r);
                return typeof v === 'string' && normalizeText(v).includes(q);
            }))
            : filasNumeradas;

        const fn = orden.key && acceso[orden.key];
        if (fn) {
            const signo = orden.dir === 'asc' ? 1 : -1;
            out = [...out].sort((a, b) => {
                const va = fn(a), vb = fn(b);
                if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * signo;
                return String(va ?? '').localeCompare(String(vb ?? ''), 'es') * signo;
            });
        }
        return out;
    }, [filasNumeradas, acceso, busqueda, orden]);

    const totalPaginas = Math.max(1, Math.ceil(filasVistas.length / tamPagina));
    const filasPagina = useMemo(
        () => filasVistas.slice((pagina - 1) * tamPagina, pagina * tamPagina),
        [filasVistas, pagina, tamPagina]);

    useEffect(() => { setPagina(1); }, [activeTab, mes, filterBranch, busqueda, tamPagina]); // eslint-disable-line react-hooks/set-state-in-effect -- volver a la página 1 al cambiar de recorte

    const alOrdenar = useCallback((key) => {
        setOrden(o => (o.key === key
            ? { key, dir: o.dir === 'asc' ? 'desc' : 'asc' }
            : { key, dir: 'asc' }));
        setPagina(1);
    }, []);

    // Los tres estados vacíos son distintos y la salida también. El del error
    // importa especialmente: sin él, un libro que falló por red se ve idéntico
    // a un mes sin operaciones —y eso es justo lo que se declara a Hacienda.
    const vacioDe = (icon, message, subtext) => (
        error
            ? { icon: AlertTriangle,
                message: 'No se pudo generar el libro',
                subtext: 'Es un fallo de la consulta, no un mes sin movimiento. No presentes nada de esta pantalla.' }
            : busqueda.trim()
                ? { icon: SearchX,
                    message: `Sin coincidencias para «${busqueda.trim()}»`,
                    subtext: 'La búsqueda recorta lo que ves; el CSV sigue saliendo con el libro completo.' }
                : { icon, message, subtext });

    const propsTabla = (cols) => ({
        columns: conOrden(cols, acceso),
        // `dense` para TODOS los libros, que es donde vive: son tablas de ocho y
        // nueve columnas y `px-6` les cobraba ~12px por columna. El libro de
        // consumidor se pasaba 26px a 1280 y **Total del día** quedaba cortado;
        // esconder una columna entera por 26px habría sido desproporcionado.
        dense: true,
        loading,
        onSort: alOrdenar,
        sortKey: orden.key,
        sortDir: orden.dir,
    });

    // El buscador es Tipo 1 (§24): vive acá y en ningún otro lado. Busca en las
    // columnas de texto de la pestaña abierta —proveedor, NRC, documento,
    // cliente, código de generación—, que son las que uno tiene en la mano
    // cuando la contadora pregunta por UN documento entre 467.
    const filtersContent = (
        <ViewTabBar
            tabs={allowedTabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            searchValue={busqueda}
            onSearchChange={setBusqueda}
            placeholder="Buscar proveedor, NRC, documento…"
        />
    );

    const puedeElegirSucursal = getScope('libros_iva') === 'ALL';

    const barraFiltros = (
        <FilterBar
            onClear={() => { setFilterBranch(''); setMes(mesActual()); }}
            activeCount={[filterBranch, mes !== mesActual()].filter(Boolean).length}
            acciones={!canDownload ? [] : [{
                key: 'exportar',
                icon: Download,
                label: 'Exportar',
                // `soloIcono` es el caso que §17 nombra literalmente para
                // Exportar, y acá no era cosmético: con el rótulo la píldora se
                // llevaba ~94px que le faltaban al carril, y las tarjetas
                // quedaban en 148-155px truncando el número ($229,74…) en vez
                // de encogerlo. El ícono `Download` ya es el de exportar en
                // todo el portal, y el rótulo sigue vivo en el aria y en táctil.
                soloIcono: true,
                title: `Exportar el libro de ${TABS.find(x => x.key === activeTab)?.label} en CSV — ${filas.length} filas, completo y en orden legal (no lo recortan la búsqueda ni el orden de pantalla)`,
                onClick: exportar,
                disabled: loading || filas.length === 0,
            }, {
                key: 'paquete',
                icon: Archive,
                // El rótulo es CONSTANTE a propósito: `FilterBar` mide la fila a
                // partir de los rótulos de las acciones (`claveRotulos`), así que
                // cambiarlo a "Generando…" mientras trabaja vuelve a medir y la
                // píldora parpadea. Es el mismo defecto que se corrigió en
                // v2.349.1 con el avance de la descarga. El estado se muestra
                // deshabilitando el botón, que no toca la medida.
                label: 'Paquete del mes',
                title: `Descargar TODOS los libros de ${etiquetaMes(mes)} en un ZIP, con una carpeta por libro y un archivo por sucursal adentro`,
                onClick: descargarZip,
                disabled: loading || zipeando,
            }]}>
            {puedeElegirSucursal && branchOptions.length > 0 && (
                <FilterBar.Section active={!!filterBranch} onClear={() => setFilterBranch('')} label="sucursal">
                    <FilterBar.Sucursal value={filterBranch}
                        onChange={val => setFilterBranch(val || '')} options={branchOptions} />
                </FilterBar.Section>
            )}
            <FilterBar.Section active={mes !== mesActual()} onClear={() => setMes(mesActual())} label="período">
                <PeriodStepper
                    unit="mes"
                    label={etiquetaMes(mes)}
                    onPrev={() => setMes(m => correrMes(m, -1))}
                    onNext={() => setMes(m => correrMes(m, 1))}
                    nextDisabled={mes >= mesActual()}
                    onReset={() => setMes(mesActual())}
                    isCurrent={mes === mesActual()}
                    resetLabel="Ir al mes actual"
                />
            </FilterBar.Section>
        </FilterBar>
    );

    return (
        <GlassViewLayout
            icon={BookOpen}
            title="Libros IVA"
            filtersContent={filtersContent}
            transparentBody={true}
        >
            <div className="p-5 md:p-6 space-y-5">
                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                    {/* Tres tarjetas FIJAS (§17.0): las mismas tres preguntas en
                        los siete libros, que es lo que deja compararlos de un
                        vistazo al cambiar de pestaña. Lo que cambia es CÓMO se
                        llama cada respuesta — en compras el impuesto es crédito,
                        no débito, y llamarlo igual sería un error contable. */}
                    <CarrilCards className="flex-1" ariaLabel="Resumen del libro">
                        {/* Sin sucursal elegida, una fila del libro de consumidor
                            es un día POR sucursal — decir "180 días" de un mes de
                            30 sería mentir sobre lo que se está mirando. */}
                        {/* `loading` no es opcional acá: sin él, mientras carga
                            las tres tarjetas dicen 0 · $0.00 · $0.00 con la
                            misma tipografía que una cifra real, y en un libro
                            fiscal "cero" es una afirmación, no un placeholder.
                            La tabla ya mostraba esqueleto — eran las tarjetas
                            las que se quedaron afirmando. */}
                        <StatCard icon={FileText} label="Documentos" value={t.docs} loading={loading}
                            sub={activeTab === 'consumidor'
                                ? `${consumidor.length} ${filterBranch ? 'días' : 'filas'}`
                                : undefined} />
                        {/* Las dos tarjetas de dinero van con `libros_iva_ver_montos`;
                            la de Documentos no, porque contar cuántos documentos tiene
                            el libro es lo que hace falta para saber si está completo,
                            y eso no revela ninguna cifra. */}
                        {canVerMontos && (
                            <>
                                <StatCard icon={ETIQUETAS[activeTab].icon} label={ETIQUETAS[activeTab].monto}
                                    value={formatMoney(t.total)} sub="Del período" loading={loading} />
                                <StatCard icon={Percent} label={ETIQUETAS[activeTab].impuesto}
                                    value={formatMoney(t.debito)} loading={loading}
                                    sub={activeTab === 'consumidor' ? 'Calculado 13%' : 'Documentado'} />
                            </>
                        )}
                        {/* Solo cuando el período la tiene: es un número que el
                            contador necesita para declarar (es impuesto ya
                            enterado por el cliente), pero una tarjeta en cero
                            todos los meses lo volvería ruido. */}
                        {activeTab === 'contribuyente' && hayRetencion && (
                            <StatCard icon={Percent} label="Retención de IVA"
                                value={formatMoney(t.retencion)} loading={loading}
                                sub="Retenida por el cliente" />
                        )}
                    </CarrilCards>
                    <div className="flex justify-end min-w-0">{barraFiltros}</div>
                </div>

                {error && (
                    <Notice variant="danger" icon={AlertTriangle}>
                        No se pudo generar el libro: {error}. No lo presentes con estos números.
                    </Notice>
                )}

                {/* La regla del libro, escrita donde se usa. Sin esto el número
                    de la pantalla no se puede defender ante una diferencia.
                    Va `compact`: es una nota de referencia, siempre en pantalla
                    y en las 7 pestañas, así que compitiendo en peso con los
                    avisos accionables de abajo terminaba enseñando lo contrario
                    de lo que quiere decir. Los que piden hacer algo —NRC
                    faltante, documentos sin sincronizar— se quedan a tamaño
                    completo, y ahora se distinguen de un vistazo. */}
                {/* Retención es la única pestaña con las dos mitades —una de
                    ventas y otra de compras—, así que no puede usar ninguno de
                    los dos avisos: el de compras hablaba del Art. 86 y del sello
                    encima de una tabla de ventas. */}
                {activeTab === 'retencion' ? (
                    <Notice variant="info" icon={BookOpen} compact>
                        Dos cosas opuestas en la misma pantalla: arriba, el IVA que los clientes
                        retuvieron sobre nuestras ventas —impuesto ya pagado, que se acredita al
                        declarar—; abajo, el que la empresa habría retenido como agente. Los
                        documentos anulados van incluidos y marcados, y no se acreditan.
                    </Notice>
                ) : ES_DE_VENTAS.has(activeTab) ? (
                    <Notice variant="info" icon={BookOpen} compact>
                        Solo entran las facturas con sello de Hacienda y estado FINALIZADA; los
                        anulados son los documentos invalidados ante Hacienda.
                        {/* La explicación va acá y no en un `title` por documento:
                            se lee una vez y alcanza para las 44 filas de la
                            historia que la tienen. Y hace falta, porque sin ella
                            la fila parece una suma mal hecha. */}
                        {activeTab === 'contribuyente' && hayRetencion && <> En los documentos
                        que lo indican, el cliente retuvo el 1% del IVA y lo entera él mismo
                        (Art. 162 del Código Tributario): por eso el total cobrado es menor que
                        gravadas más débito. Es impuesto ya pagado, no una venta menos.</>}
                    </Notice>
                ) : (
                    <Notice variant="info" icon={BookOpen} compact>
                        Incluye las 7 sucursales. Las compras anuladas van incluidas y marcadas,
                        como pide el libro. Sin columna de sello: el Art. 86 no la exige para
                        compras.{activeTab === 'compras' && <> En pantalla, el documento se muestra
                        con su número de control cuando se pudo identificar; el archivo lleva el
                        número tal como está registrado, para poder cotejarlo.</>}
                    </Notice>
                )}

                {/* C6/H3 — el filtro del sello es correcto, pero hasta acá las
                    ventas que no lo tienen desaparecían del libro sin dejar
                    rastro. Facturación ya las lista una por una; lo que no
                    existía en ningún lado es el MONTO DEL PERÍODO, y es el único
                    número que le importa a quien está armando la declaración.
                    Por eso vive acá y no allá. */}
                {/* No en `anulados`: ahí las filas son documentos invalidados a
                    propósito, y este aviso habla de ventas FINALIZADAS. Mezclarlos
                    en la misma pantalla haría leer "anulada" donde dice "cobrada". */}
                {(activeTab === 'consumidor' || activeTab === 'contribuyente') && (fuera?.documentos ?? 0) > 0 && (
                    <Notice variant="warning" icon={AlertTriangle}>
                        <strong>{formatMoney(fuera.monto)}</strong> en {fuera.documentos} ventas
                        cobradas de {etiquetaMes(mes)} <strong>no entran a este libro</strong> porque
                        les falta el sello de Hacienda. Se resuelven en Facturación:{' '}
                        {fuera.sin_sello > 0 && <>{fuera.sin_sello} en <strong>Pendiente MH</strong></>}
                        {fuera.sin_sello > 0 && fuera.sello_invalido > 0 && ' y '}
                        {fuera.sello_invalido > 0 && <>{fuera.sello_invalido} en <strong>Observaciones</strong></>}.
                    </Notice>
                )}

                {activeTab === 'contribuyente' && ccfSinNrc > 0 && (
                    <Notice variant="warning" icon={AlertTriangle}>
                        <strong>{ccfSinNrc} de {contribuyente.length}</strong> documentos van sin NRC del
                        cliente, que el Art. 85 exige. El portal todavía no captura el receptor del DTE:
                        el libro se puede revisar, pero no presentar hasta completarlo.
                    </Notice>
                )}

                {/* Un documento sin número no es un libro incompleto "cosmético":
                    es una operación que no se puede identificar. Se avisa antes
                    que el faltante de NRC porque invalida más. */}
                {activeTab === 'compras' && comprasSinSincronizar > 0 && (
                    <Notice variant="danger" icon={AlertTriangle}>
                        <strong>{comprasSinSincronizar} de {compras.length}</strong> documentos no tienen
                        registrado su número ni la percepción. Hay que completar {etiquetaMes(mes)} antes
                        de presentar este libro — en blanco no es cero.
                    </Notice>
                )}

                {activeTab === 'compras' && comprasSinNrc > 0 && (
                    <Notice variant="warning" icon={AlertTriangle}>
                        <strong>{comprasSinNrc} de {compras.length}</strong> documentos van sin NRC del
                        proveedor, que el Art. 86 exige. Falta completarlo en la ficha del proveedor.
                    </Notice>
                )}

                {activeTab === 'notas' && notas.length > 0 && (
                    <Notice variant="warning" icon={AlertTriangle}>
                        Estas <strong>{notas.length}</strong> notas <strong>no están dentro del libro
                        de compras</strong> — llegaron por correo y nunca se registraron como
                        documento de compra. El libro de {etiquetaMes(mes)} declara{' '}
                        <strong>{formatMoney(Math.abs(t.debito))}</strong> de crédito fiscal{' '}
                        {t.debito >= 0 ? 'de más' : 'de menos'}. Van sin sucursal porque el documento
                        no la trae.
                    </Notice>
                )}

                {sinNumeroControl > 0 && (
                    <Notice variant="danger" icon={AlertTriangle}>
                        <strong>{sinNumeroControl} de {filas.length}</strong> filas van sin número de
                        control. Es columna obligatoria del libro, así que {etiquetaMes(mes)} todavía no
                        se puede presentar — se completa solo, y si no baja en unas horas hay que revisarlo.
                    </Notice>
                )}

                {activeTab === 'consumidor' && (
                    <DataTable {...propsTabla(COLS_CONSUMIDOR)}
                        empty={vacioDe(BookOpen, `Sin ventas a consumidor final en ${etiquetaMes(mes)}`)}>
                        {filasPagina.map((r, i) => (
                            <DataRow key={`${r.branch_id}-${r.fecha}`} index={i}>
                                <DataCell>{fmtFecha(r.fecha)}</DataCell>
                                <DataCell hideBelow="md">{nombreSucursal(r.branch_id)}</DataCell>
                                <DataCell><span className="font-mono text-caption">{soloNumero(r.correlativo_del)}</span></DataCell>
                                <DataCell><span className="font-mono text-caption">{soloNumero(r.correlativo_al)}</span></DataCell>
                                <DataCell align="center" hideBelow="2xl">{r.documentos}</DataCell>
                                <DataCell align="right">{formatMoney(r.ventas_gravadas)}</DataCell>
                                <DataCell align="right" hideBelow="md">{formatMoney(debitoDeConsumidor(Number(r.ventas_gravadas || 0)))}</DataCell>
                                <DataCell align="right"><span className="font-black">{formatMoney(r.total_diario)}</span></DataCell>
                            </DataRow>
                        ))}
                    </DataTable>
                )}

                {activeTab === 'contribuyente' && (
                    <DataTable {...propsTabla(COLS_CONTRIBUYENTE)}
                        empty={vacioDe(BookOpen, `Sin ventas a contribuyentes en ${etiquetaMes(mes)}`)}>
                        {filasPagina.map((r, i) => (
                            <DataRow key={r.codigo_generacion || `${r.correlativo}-${r._n}`} index={i}>
                                <DataCell align="right">{r._n}</DataCell>
                                <DataCell>{fmtFecha(r.fecha)}</DataCell>
                                <DataCell><span className="font-mono text-caption">{soloNumero(r.correlativo)}</span></DataCell>
                                {/* DOS líneas, como el proveedor de Compras
                                    Completo (§25.7) — no `truncate`.
                                    El tope sigue haciendo falta: sin él la
                                    columna crece hasta la razón social más larga
                                    y se come el resto de la tabla. Pero con UNA
                                    línea el tope cortaba 38 a 49 de cada 50
                                    nombres en TODOS los anchos (medido de 1280 a
                                    2560), y no por falta de espacio —la tabla ya
                                    ocupa el 100% del contenedor y nunca
                                    desborda— sino porque una razón social no
                                    entra en una línea: "RAMIREZ GIRON SOCIEDAD
                                    ANONIMA DE CAPITAL VARIABLE" son 49
                                    caracteres. Dos líneas a 16rem dan ~64. */}
                                <DataCell className="min-w-[12rem] max-w-[16rem]">
                                    <span className="line-clamp-2 break-words leading-tight"
                                          title={r.cliente || undefined}>
                                        {r.cliente || '—'}
                                    </span>
                                </DataCell>
                                <DataCell><CeldaNrc nrc={r.nrc} /></DataCell>
                                {/* `2xl` y no `xl`: TIENE que ser el mismo peldaño
                                    que el `hideBelow` de esta columna en
                                    COLS_CONTRIBUYENTE. Cuando no coinciden, entre
                                    1280 y 1535 el encabezado esconde el NIT y la
                                    celda no: la tabla queda con 9 columnas y 8
                                    títulos, cada monto se lee bajo el rótulo del
                                    vecino —GRAVADAS sobre el NIT, DÉBITO sobre las
                                    gravadas— y Total se sale del encabezado. En
                                    1440, que es el ancho de laptop más común. */}
                                <DataCell hideBelow="2xl"><CeldaNit nit={r.nit} /></DataCell>
                                <DataCell align="right">{formatMoney(r.ventas_gravadas)}</DataCell>
                                <DataCell align="right" hideBelow="md">{formatMoney(r.debito_fiscal)}</DataCell>
                                {/* Segunda línea y no columna: ver el comentario
                                    de COLS_CONTRIBUYENTE. Va acá porque es la
                                    explicación del número de al lado — sin ella
                                    la fila dice 359.79 + 46.77 = 402.96 y parece
                                    una suma mal hecha. */}
                                <DataCell align="right">
                                    <span className="font-black">{formatMoney(r.total)}</span>
                                    {Number(r.retencion_iva) > 0 && (
                                        // Sin `whitespace-nowrap` a propósito: el ancho de
                                        // columna lo fija el contenido, así que forzar una
                                        // línea le sumaba 12px a la tabla y a 1280 —donde ya
                                        // va justa— eso se paga en el visor. Que envuelva.
                                        //
                                        // Y sin `title`: sobre un <span> no es alcanzable por
                                        // teclado ni por toque (§15.10). Lo que significa se
                                        // explica en el aviso de arriba, que se lee una vez,
                                        // en vez de en 44 celdas que hay que sobrevolar.
                                        <span className="block text-micro font-semibold text-content-3 leading-tight">
                                            -{formatMoney(r.retencion_iva)} retenido
                                        </span>
                                    )}
                                </DataCell>
                            </DataRow>
                        ))}
                    </DataTable>
                )}

                {activeTab === 'anulados' && (
                    <DataTable {...propsTabla(COLS_ANULADOS)}
                        empty={vacioDe(Ban, `Sin documentos anulados en ${etiquetaMes(mes)}`)}>
                        {filasPagina.map((r, i) => (
                            <DataRow key={r.codigo_generacion || `${r.correlativo}-${r._n}`} index={i}>
                                <DataCell align="right">{r._n}</DataCell>
                                <DataCell>{fmtFecha(r.fecha)}</DataCell>
                                <DataCell align="center">
                                    <Badge variant={r.tipo_documento === 'CCF' ? 'danger' : 'neutral'} size="sm">
                                        {r.tipo_documento || '—'}
                                    </Badge>
                                </DataCell>
                                <DataCell><span className="font-mono text-caption">{soloNumero(r.correlativo)}</span></DataCell>
                                <DataCell hideBelow="lg"><span className="font-mono text-micro text-content-3">{r.codigo_generacion || '—'}</span></DataCell>
                                <DataCell hideBelow="md">{r.cliente || '—'}</DataCell>
                                <DataCell align="right">{formatMoney(r.total)}</DataCell>
                            </DataRow>
                        ))}
                    </DataTable>
                )}

                {activeTab === 'compras' && (
                    <DataTable {...propsTabla(sinSucursal(COLS_COMPRAS, !!filterBranch))}
                        empty={vacioDe(ShoppingCart, `Sin compras en ${etiquetaMes(mes)}`)}>
                        {filasPagina.map((r, i) => (
                            <DataRow key={`${r.branch_id}-${r.documento_numero}-${r._n}`} index={i}>
                                <DataCell align="right">{r._n}</DataCell>
                                <DataCell><CeldaFecha iso={r.fecha} /></DataCell>
                                {!filterBranch && (
                                    <DataCell hideBelow="2xl" className="truncate max-w-[7rem]">{nombreSucursal(r.branch_id)}</DataCell>
                                )}
                                <DataCell><CeldaDocumento numero={r.documento_numero} control={r.numero_control} /></DataCell>
                                <CeldaProveedor nombre={r.proveedor} anulada={r.anulada} />
                                <DataCell hideBelow="md"><CeldaNrc nrc={r.nrc} /></DataCell>
                                <DataCell align="right"><CeldaMonto v={r.compras_gravadas} /></DataCell>
                                <DataCell align="right" hideBelow="md"><CeldaMonto v={r.credito_fiscal} /></DataCell>
                                <DataCell align="right"><CeldaMonto v={r.total} fuerte /></DataCell>
                            </DataRow>
                        ))}
                    </DataTable>
                )}

                {/* La pestaña de Retención lleva las DOS mitades, y en este
                    orden: primero la que tiene filas. La de abajo es el anexo
                    del Art. 162 —lo que la empresa retiene como agente— y sale
                    vacío porque no lo es; si fuera lo primero que se ve, la
                    pestaña parecería no tener nada. */}
                {activeTab === 'retencion' && (
                    <SeccionRetencionVentas
                        filas={retVentas}
                        loading={loading}
                        mes={mes}
                        empty={vacioDe(Percent,
                            `Sin retención de IVA en ${etiquetaMes(mes)}`,
                            'Ningún cliente practicó retención sobre las ventas del período.')}
                        sufijoArchivo={sufijoArchivo}
                        nombreSucursal={nombreSucursal}
                        onAbrir={abrirDte}
                        onError={setError}
                    />
                )}

                {activeTab === 'retencion' && (
                    <div className="pt-1">
                        <h3 className="text-body font-bold">IVA que retuvo la empresa</h3>
                        <p className="text-caption text-content-3">
                            El anexo del Art. 162: las retenciones practicadas como agente. Es la
                            mitad opuesta de la de arriba y por eso va aparte — sumarlas sería
                            declarar un impuesto por otro.
                        </p>
                    </div>
                )}

                {/* Percepción y retención son la misma tabla con otro impuesto.
                    El vacío se explica en vez de quedar en "no hay datos": en
                    retención es el estado normal, no una falla. */}
                {(activeTab === 'percepcion' || activeTab === 'retencion') && (
                    <DataTable
                        {...propsTabla(sinSucursal(
                            colsAnexo(activeTab === 'percepcion' ? 'IVA percibido' : 'IVA retenido'),
                            !!filterBranch))}
                        empty={vacioDe(
                            Percent,
                            activeTab === 'percepcion'
                                ? `Sin percepción de IVA en ${etiquetaMes(mes)}`
                                : `Sin retención de IVA en ${etiquetaMes(mes)}`,
                            activeTab === 'retencion'
                                ? 'La empresa no es agente de retención: no hay ninguna operación registrada en todo el histórico.'
                                : undefined)}>
                        {filasPagina.map((r, i) => (
                            <DataRow key={`${r.branch_id}-${r.documento_numero}-${r._n}`} index={i}>
                                <DataCell align="right">{r._n}</DataCell>
                                <DataCell><CeldaFecha iso={r.fecha} /></DataCell>
                                {!filterBranch && (
                                    <DataCell hideBelow="2xl" className="truncate max-w-[7rem]">{nombreSucursal(r.branch_id)}</DataCell>
                                )}
                                <CeldaProveedor nombre={r.proveedor} anulada={r.anulada} />
                                <DataCell hideBelow="md"><CeldaNrc nrc={r.nrc} /></DataCell>
                                <DataCell hideBelow="sm"><CeldaDocumento numero={r.documento_numero} /></DataCell>
                                <DataCell align="right"><CeldaMonto v={r.monto_sujeto} /></DataCell>
                                <DataCell align="right">
                                    <CeldaMonto fuerte v={activeTab === 'percepcion' ? r.percepcion_iva : r.retencion_iva} />
                                </DataCell>
                            </DataRow>
                        ))}
                    </DataTable>
                )}

                {activeTab === 'renta' && (
                    <DataTable {...propsTabla(COLS_RENTA)}
                        empty={vacioDe(
                            ShoppingCart,
                            `Sin retención de Renta en ${etiquetaMes(mes)}`,
                            'Ningún proveedor está marcado como sujeto a retención del Art. 156. Se marca en su ficha, en Proveedores.')}>
                        {filasPagina.map((r, i) => (
                            <DataRow key={`${r.codigo_generacion}-${r._n}`} index={i}>
                                <DataCell align="right">{r._n}</DataCell>
                                <DataCell><CeldaFecha iso={r.fecha} /></DataCell>
                                <CeldaProveedor nombre={r.proveedor} />
                                <DataCell hideBelow="lg"><CeldaNit nit={r.nit} /></DataCell>
                                <DataCell hideBelow="sm"><CeldaDocumento numero={r.numero_control} /></DataCell>
                                <DataCell align="right"><CeldaMonto v={r.base_sin_iva} /></DataCell>
                                <DataCell align="right"><CeldaMonto fuerte v={r.retencion_10} /></DataCell>
                            </DataRow>
                        ))}
                    </DataTable>
                )}

                {activeTab === 'notas' && (
                    <DataTable {...propsTabla(COLS_NOTAS)}
                        empty={vacioDe(
                            FileText,
                            `Sin notas de crédito ni débito en ${etiquetaMes(mes)}`,
                            'Ningún proveedor envió documentos que corrijan una compra del período.')}>
                        {filasPagina.map((r, i) => (
                            <DataRow key={r.codigo_generacion || `${r.numero_control}-${r._n}`} index={i}>
                                <DataCell align="right">{r._n}</DataCell>
                                <DataCell><CeldaFecha iso={r.fecha} /></DataCell>
                                <DataCell align="center">
                                    {/* Las de crédito restan y las de débito suman:
                                        distinguirlas es el dato, no un adorno. */}
                                    <Badge variant={r.tipo_dte === '05' ? 'warning' : 'neutral'}>
                                        {r.tipo_dte === '05' ? 'Crédito' : 'Débito'}
                                    </Badge>
                                </DataCell>
                                <DataCell><CeldaDocumento numero={r.numero_control} /></DataCell>
                                <CeldaProveedor nombre={r.proveedor} />
                                <DataCell hideBelow="md"><CeldaNrc nrc={r.nrc} /></DataCell>
                                {/* Guión y no `CeldaDocumento`: esa celda marca el
                                    vacío con un badge rojo "Sin número", y acá
                                    puede faltar porque el proveedor no declaró qué
                                    documento corrige. No es un error nuestro, y
                                    pintarlo en rojo sería alarma falsa. */}
                                <DataCell hideBelow="2xl">
                                    {r.documento_corregido
                                        ? <span className="font-mono text-micro text-content-2 whitespace-nowrap">{r.documento_corregido}</span>
                                        : <span className="text-content-3">—</span>}
                                </DataCell>
                                {/* A qué compra del libro corresponde la nota. Es
                                    lo que la contadora necesita para saber qué
                                    ajustar, y hasta hoy no existía: la relación
                                    apuntaba de la nota a otro DTE recibido por
                                    correo, así que si el CCF original no llegó a
                                    la casilla no había a qué apuntar. */}
                                <DataCell hideBelow="lg">
                                    {r.vinculo === 'ligada'
                                        ? <span className="font-mono text-micro text-content-2 whitespace-nowrap">
                                              {r.compra_documento}
                                          </span>
                                        : <Badge variant="neutral" size="sm">
                                              {r.vinculo === 'sin referencia' ? 'Sin referencia' : 'No está en el libro'}
                                          </Badge>}
                                </DataCell>
                                <DataCell align="right"><CeldaMonto v={r.monto} /></DataCell>
                                <DataCell align="right"><CeldaMonto v={r.iva} fuerte /></DataCell>
                            </DataRow>
                        ))}
                    </DataTable>
                )}

                {/* Hermana de la tabla en el flujo, sin envoltorio (§14). El
                    libro más cargado medido son 467 compras en un mes: sin
                    paginar eran 4,670 celdas y 20,588px de tabla —23 pantallas—
                    y `DataTable` está dimensionada para "~15-50 filas, no 200"
                    según su propio encabezado.

                    `total` es el libro entero y `filteredTotal` lo que dejó la
                    búsqueda, así que el rango dice "1–50 de 467" y pasa a
                    "1–3 de 3" al buscar, mientras el carril sigue mostrando el
                    total del período. Son dos preguntas distintas y ahora se
                    ven las dos. */}
                {!loading && filas.length > 0 && (
                    <TablePagination
                        page={pagina}
                        totalPages={totalPaginas}
                        onPageChange={setPagina}
                        pageSize={tamPagina}
                        onPageSizeChange={setTamPagina}
                        total={filas.length}
                        filteredTotal={busqueda.trim() ? filasVistas.length : undefined}
                        unit={activeTab === 'consumidor' ? 'días-sucursal' : 'documentos'}
                    />
                )}
            </div>
        </GlassViewLayout>
    );
}
