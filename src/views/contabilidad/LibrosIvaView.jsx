import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookOpen, AlertTriangle, FileText, Receipt, Percent, Download, Ban, ShoppingCart, UserX, SearchX } from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import ViewTabBar from '../../components/common/ViewTabBar';
import FilterBar from '../../components/common/FilterBar';
import PeriodStepper from '../../components/common/PeriodStepper';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Notice from '../../components/common/Notice';
import Badge from '../../components/common/Badge';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination from '../../components/common/TablePagination';
import { useStaffStore } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import { formatMoney } from '../../utils/formatNumber';
import { normalizeText } from '../../utils/helpers';
import { exportCsv } from '../../utils/csvExport';
import {
    fetchLibroConsumidor, fetchLibroContribuyente, fetchLibroAnulados,
    fetchLibroCompras, fetchLibroPercepcion, fetchLibroRetencion,
    fetchLibroSujetoExcluido,
} from '../../data/librosIva';

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
    { key: 'excluido',      label: 'Excluido'       },
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

// DD/MM/YYYY: el formato del libro. Se parte la cadena en vez de construir un
// Date — `new Date('2026-06-01')` es UTC y en El Salvador (−6) retrocede un día.
const fmtFecha = (iso) => {
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
const soloNumero = (correlativo) => String(correlativo || '').split('_')[0];

const COLS_CONSUMIDOR = [
    { key: 'fecha',     label: 'Fecha',      align: 'left'  },
    { key: 'sucursal',  label: 'Sucursal',   align: 'left', hideBelow: 'md' },
    { key: 'del',       label: 'Del N.º',    align: 'left'  },
    { key: 'al',        label: 'Al N.º',     align: 'left'  },
    { key: 'docs',      label: 'Docs',       align: 'center', hideBelow: 'sm' },
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
    excluido:      { icon: UserX,        monto: 'Compras',      impuesto: 'Crédito fiscal' },
};

// Con una sucursal elegida, la columna Sucursal repite el filtro en cada fila:
// 115px de ancho para un dato que ya está dicho arriba, y son justo los que a
// 1440px empujaban Total fuera del visor (medido: tabla 1164 contra 1046 de
// visor con la columna, 1049 sin ella). No es esconder dato — es no repetirlo.
const sinSucursal = (cols, filtrada) =>
    (filtrada ? cols.filter(c => c.key !== 'sucursal') : cols);

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
        nrc:      r => r.nrc || '',
        nit:      r => r.nit || '',
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
        doc:       r => r.documento_numero || '',
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
    excluido: (nom) => ({
        n:         r => r._n,
        fecha:     r => r.fecha,
        sucursal:  r => nom(r.branch_id),
        proveedor: r => r.proveedor || '',
        nit:       r => r.nit || '',
        dui:       r => r.dui || '',
        doc:       r => r.documento_numero || '',
        total:     r => Number(r.total || 0),
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
const CeldaDocumento = ({ numero }) => (
    numero
        ? <span className="font-mono text-micro text-content-2 whitespace-nowrap">{numero}</span>
        : <Badge variant="danger" size="sm">Sin número</Badge>
);

const CeldaNrc = ({ nrc }) => (
    nrc
        ? <span className="font-mono text-caption whitespace-nowrap">{nrc}</span>
        : <Badge variant="warning" size="sm">Falta</Badge>
);

const CeldaMonto = ({ v, fuerte }) => (
    <span className={`whitespace-nowrap${fuerte ? ' font-black' : ''}`}>{formatMoney(v)}</span>
);

// El `max-w` va en la celda y no en el `<span>`: la tabla es de ancho
// automático, así que sin un tope en el `<td>` la columna crece hasta el nombre
// más largo y el `truncate` no llega a activarse nunca. Es el mismo patrón que
// `VentasView` (`truncate max-w-[140px]` sobre el `DataCell`).
const CeldaProveedor = ({ nombre, anulada }) => (
    <DataCell className="max-w-[11rem]">
        <div className="flex items-center gap-2 min-w-0">
            <span className="truncate" title={nombre || undefined}>{nombre || '—'}</span>
            {anulada && <Badge variant="warning" size="sm" className="shrink-0">Anulada</Badge>}
        </div>
    </DataCell>
);

export default function LibrosIvaView() {
    const { getScope, user } = useAuth();
    const branches = useStaffStore((s) => s.branches);

    const [searchParams, setSearchParams] = useSearchParams();
    const rawTab = searchParams.get('tab');
    const activeTab = TABS.some(t => t.key === rawTab) ? rawTab : 'consumidor';
    const setActiveTab = (tab) => setSearchParams(p => { p.set('tab', tab); return p; });

    const [mes, setMes] = useState(mesActual);
    const [filterBranch, setFilterBranch] = useState(
        getScope('libros_iva') === 'BRANCH' ? String(user?.branchId || '') : ''
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
    const [excluido,      setExcluido]      = useState([]);
    const [loading, setLoading] = useState(true);
    const [error,   setError]   = useState(null);

    const [desde, hasta] = useMemo(() => rangoDelMes(mes), [mes]);

    // Los siete libros se traen JUNTOS aunque solo se vea uno: son de un mes y
    // caben en cientos de filas, así que cambiar de pestaña no vuelve a la red —
    // y el carril puede mostrar el total del período sin importar dónde estés.
    const load = useCallback(async () => {
        setLoading(true);
        const [c, k, a, co, pe, re, ex] = await Promise.all([
            fetchLibroConsumidor(desde, hasta, filterBranch),
            fetchLibroContribuyente(desde, hasta, filterBranch),
            fetchLibroAnulados(desde, hasta, filterBranch),
            fetchLibroCompras(desde, hasta, filterBranch),
            fetchLibroPercepcion(desde, hasta, filterBranch),
            fetchLibroRetencion(desde, hasta, filterBranch),
            fetchLibroSujetoExcluido(desde, hasta, filterBranch),
        ]);
        // Un libro que falla NO puede quedar como "no hubo operaciones": un mes
        // vacío por error de red es indistinguible de un mes sin movimiento, y
        // acá eso se declara a Hacienda. Vale doble para Retención y Sujeto
        // Excluido, que salen vacíos aun cuando todo funciona.
        const fallo = c.error || k.error || a.error || co.error || pe.error || re.error || ex.error;
        setError(fallo ? fallo.message : null);
        setConsumidor(c.data || []);
        setContribuyente(k.data || []);
        setAnulados(a.data || []);
        setCompras(co.data || []);
        setPercepcion(pe.data || []);
        setRetencion(re.data || []);
        setExcluido(ex.data || []);
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

    const totales = useMemo(() => {
        const gravadasCons = consumidor.reduce((s, r) => s + Number(r.ventas_gravadas || 0), 0);
        const exentasCons  = consumidor.reduce((s, r) => s + Number(r.ventas_exentas  || 0), 0);
        const totalCons    = consumidor.reduce((s, r) => s + Number(r.total_diario    || 0), 0);
        const docsCons     = consumidor.reduce((s, r) => s + Number(r.documentos      || 0), 0);

        const gravadasCcf = contribuyente.reduce((s, r) => s + Number(r.ventas_gravadas || 0), 0);
        const exentasCcf  = contribuyente.reduce((s, r) => s + Number(r.ventas_exentas  || 0), 0);
        const debitoCcf   = contribuyente.reduce((s, r) => s + Number(r.debito_fiscal   || 0), 0);
        const totalCcf    = contribuyente.reduce((s, r) => s + Number(r.total           || 0), 0);

        const totalAnul = anulados.reduce((s, r) => s + Number(r.total || 0), 0);

        const suma = (filas, campo) => filas.reduce((s, r) => s + Number(r[campo] || 0), 0);

        return {
            consumidor:    { docs: docsCons, exentas: exentasCons, gravadas: gravadasCons, debito: debitoDeConsumidor(gravadasCons), total: totalCons },
            contribuyente: { docs: contribuyente.length, exentas: exentasCcf, gravadas: gravadasCcf, debito: debitoCcf, total: totalCcf },
            anulados:      { docs: anulados.length, exentas: 0, gravadas: 0, debito: 0, total: totalAnul },
            // En compras la tercera tarjeta es el crédito fiscal, no el débito:
            // es el impuesto que se resta, no el que se paga.
            compras:       { docs: compras.length,
                             exentas:  suma(compras, 'compras_exentas'),
                             gravadas: suma(compras, 'compras_gravadas'),
                             debito:   suma(compras, 'credito_fiscal'),
                             total:    suma(compras, 'total') },
            percepcion:    { docs: percepcion.length, exentas: 0,
                             gravadas: suma(percepcion, 'monto_sujeto'),
                             debito:   suma(percepcion, 'percepcion_iva'),
                             total:    suma(percepcion, 'monto_sujeto') },
            retencion:     { docs: retencion.length, exentas: 0,
                             gravadas: suma(retencion, 'monto_sujeto'),
                             debito:   suma(retencion, 'retencion_iva'),
                             total:    suma(retencion, 'monto_sujeto') },
            excluido:      { docs: excluido.length, exentas: 0, gravadas: 0, debito: 0,
                             total: suma(excluido, 'total') },
        };
    }, [consumidor, contribuyente, anulados, compras, percepcion, retencion, excluido]);

    const t = totales[activeTab];

    // Cuántos CCF del período van a salir sin NRC. Es el dato que decide si el
    // libro de contribuyentes se puede presentar tal cual.
    const ccfSinNrc = useMemo(
        () => contribuyente.filter(r => !r.nrc).length,
        [contribuyente]);

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

    const exportar = () => {
        if (activeTab === 'consumidor') {
            // Art. 83: fecha · del→al · máquina/establecimiento · exentas ·
            // gravadas locales · exportaciones · total diario · cuenta de terceros.
            // Además del Art. 83, la identidad del DTE que el libro del ERP
            // lleva: clase y tipo, el código de generación del primero y del
            // último del día, el sello del primero y los IDs del ERP. Los cinco
            // estaban guardados y este CSV no los sacaba.
            exportCsv(
                ['FECHA', 'CLASE', 'TIPO', 'DEL No', 'AL No',
                 'NUMERO DE CONTROL DEL', 'NUMERO DE CONTROL AL',
                 'CODIGO DE GENERACION DEL', 'CODIGO DE GENERACION AL',
                 'SELLO DE RECEPCION DEL', 'ID INTERNO DEL', 'ID INTERNO AL',
                 'ESTABLECIMIENTO', 'DOCUMENTOS', 'VENTAS EXENTAS',
                 'VENTAS GRAVADAS LOCALES', 'EXPORTACIONES', 'TOTAL VENTAS DIARIAS',
                 'VENTAS CUENTA DE TERCEROS'],
                [
                    ...consumidor.map(r => [
                        fmtFecha(r.fecha), '4', '01',
                        soloNumero(r.correlativo_del), soloNumero(r.correlativo_al),
                        r.numero_control_del || '', r.numero_control_al || '',
                        (r.codigo_gen_del || '').toUpperCase(), (r.codigo_gen_al || '').toUpperCase(),
                        r.sello_del || '', r.erp_id_del || '', r.erp_id_al || '',
                        nombreSucursal(r.branch_id), r.documentos,
                        num(r.ventas_exentas), num(r.ventas_gravadas),
                        num(r.exportaciones), num(r.total_diario), '0.00',
                    ]),
                    // Art. 83 pide totalizar el mes y consignar el resumen del
                    // débito fiscal. Va en el archivo, no solo en la pantalla.
                    ['TOTALES', '', '', '', '', '', '', '', '', '', '', '', '', t.docs,
                     num(t.exentas), num(t.gravadas), '0.00', num(t.total), '0.00'],
                    ['DEBITO FISCAL DEL PERIODO', '', '', '', '', '', '', '', '', '', '', '',
                     '', '', '', num(t.debito), '', '', ''],
                ],
                `libro-consumidor-final_${sufijoArchivo}.csv`);
            return;
        }
        if (activeTab === 'contribuyente') {
            // Art. 85 más la identidad del DTE: sello de recepción, código de
            // generación, NIT, la clase/tipo del documento y —desde el
            // 2026-08-01— el número de control, que es el que faltaba de verdad.
            //
            // Va en columna propia y NO reemplazando a "No CCF", que sigue
            // llevando el correlativo: son dos numeraciones distintas y todavía
            // no está verificado cuál de las dos consigna el reporte en esa
            // columna. Mientras la duda exista, el archivo lleva las dos —
            // sobra un dato, no falta.
            exportCsv(
                ['No', 'FECHA', 'CLASE', 'TIPO', 'No CCF', 'NUMERO DE CONTROL',
                 'CODIGO DE GENERACION',
                 'SELLO DE RECEPCION', 'ID INTERNO', 'CLIENTE', 'NRC', 'NIT', 'DUI',
                 'VENTAS EXENTAS', 'VENTAS GRAVADAS', 'DEBITO FISCAL',
                 'VENTAS CUENTA DE TERCEROS', 'DEBITO CUENTA DE TERCEROS',
                 'IMPUESTO PERCIBIDO', 'TOTAL'],
                [
                    ...contribuyente.map((r, i) => [
                        i + 1, fmtFecha(r.fecha),
                        // Clase 4 = documento tributario electrónico; tipo 03 =
                        // comprobante de crédito fiscal. Son los códigos del
                        // catálogo de Hacienda, no una numeración nuestra.
                        '4', '03',
                        soloNumero(r.correlativo),
                        r.numero_control || '',
                        (r.codigo_generacion || '').toUpperCase(),
                        r.sello_recepcion || '', r.erp_invoice_id || '',
                        r.cliente || '', r.nrc || '', r.nit || '', r.dui || '',
                        num(r.ventas_exentas), num(r.ventas_gravadas), num(r.debito_fiscal),
                        '0.00', '0.00', '0.00', num(r.total),
                    ]),
                    ['TOTALES', '', '', '', '', '', '', '', '', '', '', '', '',
                     num(t.exentas), num(t.gravadas), num(t.debito),
                     '0.00', '0.00', '0.00', num(t.total)],
                ],
                `libro-contribuyentes_${sufijoArchivo}.csv`);
            return;
        }
        if (activeTab === 'anulados') {
            // El sello y el ID del ERP se agregaron el 2026-08-01: el anexo del
            // ERP los lleva y acá estaban guardados sin salir. Al revés, el ERP
            // NO trae fecha, cliente ni total — esas tres quedan porque hacen
            // el anexo legible sin tener que ir a buscar cada documento.
            // El número de control va PRIMERO porque es la columna 1 del anexo,
            // la única de las diez que no se podía llenar hasta hoy. Las seis
            // del medio son constantes verificadas sobre las 80 filas de junio.
            exportCsv(
                ['No', 'NUMERO DE CONTROL', 'FECHA', 'CLASE', 'TIPO', 'CORRELATIVO',
                 'CODIGO DE GENERACION',
                 'SELLO DE RECEPCION', 'ID INTERNO', 'CLIENTE', 'TOTAL'],
                [
                    ...anulados.map((r, i) => [
                        i + 1, r.numero_control || '',
                        fmtFecha(r.fecha), '4',
                        r.tipo_documento === 'CCF' ? '03' : '01',
                        soloNumero(r.correlativo),
                        (r.codigo_generacion || '').toUpperCase(),
                        r.sello_recepcion || '', r.erp_invoice_id || '',
                        r.cliente || '', num(r.total),
                    ]),
                    ['TOTALES', '', '', '', '', '', '', '', '', '', num(t.total)],
                ],
                `anexo-anulados_${sufijoArchivo}.csv`);
            return;
        }
        if (activeTab === 'compras') {
            // Art. 86: correlativo · fecha · clase y número del documento ·
            // NRC · proveedor · exentas · gravadas internas · importaciones ·
            // crédito fiscal · total · percibido · retenido.
            exportCsv(
                ['No', 'FECHA', 'CLASE DE DOCUMENTO', 'No DOCUMENTO', 'NRC', 'NIT',
                 'PROVEEDOR', 'ESTABLECIMIENTO', 'COMPRAS EXENTAS',
                 'COMPRAS GRAVADAS INTERNAS', 'IMPORTACIONES GRAVADAS',
                 'CREDITO FISCAL', 'TOTAL COMPRAS', 'IVA PERCIBIDO', 'IVA RETENIDO',
                 'ANULADA'],
                [
                    ...compras.map((r, i) => [
                        i + 1, fmtFecha(r.fecha), r.documento_tipo || '',
                        r.documento_numero || '', r.nrc || '', r.nit || '',
                        r.proveedor || '', nombreSucursal(r.branch_id),
                        num(r.compras_exentas), num(r.compras_gravadas), '0.00',
                        num(r.credito_fiscal), num(r.total),
                        // Vacío ≠ 0.00: si el documento se sincronizó antes de
                        // que existiera la columna no sabemos si hubo percepción,
                        // y escribir 0.00 sería afirmarlo.
                        r.percepcion_iva == null ? '' : num(r.percepcion_iva),
                        r.retencion_iva  == null ? '' : num(r.retencion_iva),
                        r.anulada ? 'SI' : '',
                    ]),
                    ['TOTALES', '', '', '', '', '', '', '', num(t.exentas), num(t.gravadas),
                     '0.00', num(t.debito), num(t.total), '', '', ''],
                ],
                `libro-compras_${sufijoArchivo}.csv`);
            return;
        }
        if (activeTab === 'percepcion' || activeTab === 'retencion') {
            const esPerc = activeTab === 'percepcion';
            const filasAnexo = esPerc ? percepcion : retencion;
            exportCsv(
                ['No', 'FECHA', 'PROVEEDOR', 'NRC', 'NIT', 'CLASE DE DOCUMENTO',
                 'No DOCUMENTO', 'ESTABLECIMIENTO', 'MONTO SUJETO',
                 esPerc ? 'IVA PERCIBIDO' : 'IVA RETENIDO', 'ANULADA'],
                [
                    ...filasAnexo.map((r, i) => [
                        i + 1, fmtFecha(r.fecha), r.proveedor || '', r.nrc || '',
                        r.nit || '', r.documento_tipo || '', r.documento_numero || '',
                        nombreSucursal(r.branch_id), num(r.monto_sujeto),
                        num(esPerc ? r.percepcion_iva : r.retencion_iva),
                        r.anulada ? 'SI' : '',
                    ]),
                    ['TOTALES', '', '', '', '', '', '', '', num(t.gravadas), num(t.debito), ''],
                ],
                `anexo-${esPerc ? 'percepcion' : 'retencion'}_${sufijoArchivo}.csv`);
            return;
        }
        exportCsv(
            ['No', 'FECHA DE EMISION', 'NOMBRE', 'NIT', 'DUI', 'No DOCUMENTO',
             'ESTABLECIMIENTO', 'TOTAL'],
            [
                ...excluido.map((r, i) => [
                    i + 1, fmtFecha(r.fecha), r.proveedor || '', r.nit || '', r.dui || '',
                    r.documento_numero || '', nombreSucursal(r.branch_id), num(r.total),
                ]),
                ['TOTALES', '', '', '', '', '', '', num(t.total)],
            ],
            `reporte-sujeto-excluido_${sufijoArchivo}.csv`);
    };

    // Memoizado y no un objeto literal suelto: si `filas` cambia de identidad en
    // cada render, se la lleva puesta toda la cadena de `useMemo` de abajo
    // —numerar, filtrar, ordenar, paginar— sobre 467 filas y en cada tecleo del
    // buscador.
    const filas = useMemo(
        () => ({ consumidor, contribuyente, anulados, compras, percepcion, retencion, excluido }[activeTab] ?? []),
        [activeTab, consumidor, contribuyente, anulados, compras, percepcion, retencion, excluido]);

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
            tabs={TABS}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            searchValue={busqueda}
            onSearchChange={setBusqueda}
            placeholder="Buscar proveedor, NRC, documento…"
        />
    );

    const puedeElegirSucursal = getScope('libros_iva') !== 'BRANCH';

    const barraFiltros = (
        <FilterBar
            onClear={() => { setFilterBranch(''); setMes(mesActual()); }}
            activeCount={[filterBranch, mes !== mesActual()].filter(Boolean).length}
            acciones={[{
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
                        <StatCard icon={ETIQUETAS[activeTab].icon} label={ETIQUETAS[activeTab].monto}
                            value={formatMoney(t.total)} sub="Del período" loading={loading} />
                        <StatCard icon={Percent} label={ETIQUETAS[activeTab].impuesto}
                            value={formatMoney(t.debito)} loading={loading}
                            sub={activeTab === 'consumidor' ? 'Calculado 13%' : 'Documentado'} />
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
                {ES_DE_VENTAS.has(activeTab) ? (
                    <Notice variant="info" icon={BookOpen} compact>
                        Solo entran las facturas con sello de Hacienda y estado FINALIZADA; los
                        anulados son los documentos invalidados ante Hacienda.
                    </Notice>
                ) : (
                    <Notice variant="info" icon={BookOpen} compact>
                        Incluye las 7 sucursales. Las compras anuladas van incluidas y marcadas,
                        como pide el libro. Sin columna de sello: el Art. 86 no la exige para
                        compras.
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
                                <DataCell align="center" hideBelow="sm">{r.documentos}</DataCell>
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
                                {/* Acotado como el proveedor (§25.7): sin tope
                                    en la celda la columna crece hasta el nombre
                                    más largo —son razones sociales completas— y
                                    el `truncate` no llega a activarse nunca. */}
                                <DataCell className="truncate max-w-[11rem]" title={r.cliente || undefined}>
                                    {r.cliente || '—'}
                                </DataCell>
                                <DataCell>
                                    {r.nrc
                                        ? <span className="font-mono text-caption">{r.nrc}</span>
                                        : <Badge variant="warning" size="sm">Falta</Badge>}
                                </DataCell>
                                <DataCell hideBelow="xl">
                                    {r.nit
                                        ? <span className="font-mono text-caption whitespace-nowrap">{r.nit}</span>
                                        : <Badge variant="warning" size="sm">Falta</Badge>}
                                </DataCell>
                                <DataCell align="right">{formatMoney(r.ventas_gravadas)}</DataCell>
                                <DataCell align="right" hideBelow="md">{formatMoney(r.debito_fiscal)}</DataCell>
                                <DataCell align="right"><span className="font-black">{formatMoney(r.total)}</span></DataCell>
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
                                <DataCell><CeldaDocumento numero={r.documento_numero} /></DataCell>
                                <CeldaProveedor nombre={r.proveedor} anulada={r.anulada} />
                                <DataCell hideBelow="md"><CeldaNrc nrc={r.nrc} /></DataCell>
                                <DataCell align="right"><CeldaMonto v={r.compras_gravadas} /></DataCell>
                                <DataCell align="right" hideBelow="md"><CeldaMonto v={r.credito_fiscal} /></DataCell>
                                <DataCell align="right"><CeldaMonto v={r.total} fuerte /></DataCell>
                            </DataRow>
                        ))}
                    </DataTable>
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

                {activeTab === 'excluido' && (
                    <DataTable {...propsTabla(sinSucursal(COLS_EXCLUIDO, !!filterBranch))}
                        empty={vacioDe(
                            UserX,
                            `Sin compras a sujetos excluidos en ${etiquetaMes(mes)}`,
                            'Todas las compras registradas son con crédito fiscal: no hay ninguna Factura de Sujeto Excluido.')}>
                        {filasPagina.map((r, i) => (
                            <DataRow key={`${r.branch_id}-${r.documento_numero}-${r._n}`} index={i}>
                                <DataCell align="right">{r._n}</DataCell>
                                <DataCell><CeldaFecha iso={r.fecha} /></DataCell>
                                {!filterBranch && (
                                    <DataCell hideBelow="2xl" className="truncate max-w-[7rem]">{nombreSucursal(r.branch_id)}</DataCell>
                                )}
                                <CeldaProveedor nombre={r.proveedor} />
                                <DataCell hideBelow="md"><span className="font-mono text-caption whitespace-nowrap">{r.nit || '—'}</span></DataCell>
                                <DataCell hideBelow="md"><span className="font-mono text-caption whitespace-nowrap">{r.dui || '—'}</span></DataCell>
                                <DataCell hideBelow="sm"><CeldaDocumento numero={r.documento_numero} /></DataCell>
                                <DataCell align="right"><CeldaMonto v={r.total} fuerte /></DataCell>
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
