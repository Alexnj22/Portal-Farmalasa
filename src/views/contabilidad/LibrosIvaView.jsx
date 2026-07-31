import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookOpen, AlertTriangle, FileText, Receipt, Percent, Download, Ban } from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import ViewTabBar from '../../components/common/ViewTabBar';
import FilterBar from '../../components/common/FilterBar';
import PeriodStepper from '../../components/common/PeriodStepper';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Notice from '../../components/common/Notice';
import Badge from '../../components/common/Badge';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { useStaffStore } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import { formatMoney } from '../../utils/formatNumber';
import { exportCsv } from '../../utils/csvExport';
import { fetchLibroConsumidor, fetchLibroContribuyente, fetchLibroAnulados } from '../../data/librosIva';

// ─────────────────────────────────────────────────────────────────────────────
// Libros de IVA de ventas, generados desde `sales_invoices`.
//
// Verificado el 2026-07-31 contra los libros del ERP —7 sucursales × 3 meses,
// 84 CSV—: CCF y consumidor 18/18 branch-meses exactos en conteo y monto, y los
// 204 anulados con el md5 del conjunto de `codigo_generacion` idéntico en ambos
// lados. Lo que cierra la diferencia es el filtro del sello: sin él sobraban
// $282.58, que eran exactamente las facturas con `recibido_mh` inválido.
//
// Las columnas y su ORDEN salen del Reglamento del Código Tributario, no del
// CSV del ERP: Art. 83 para consumidores, Art. 85 para contribuyentes. Es la
// referencia con autoridad y no depende de que un proveedor no cambie su
// exportador. El separador `;` y la fecha DD/MM/YYYY sí se conservan del ERP,
// que es lo que la contadora ya sabe abrir.
// ─────────────────────────────────────────────────────────────────────────────

const IVA_TASA = 0.13;

// El débito fiscal de las ventas a consumidor no está en ninguna columna: se
// calcula, porque el precio al público YA lleva el IVA adentro. Art. 83 lo pide
// explícitamente ("un resumen de cálculo del débito fiscal ... el cual se
// trasladará al libro de operaciones con contribuyentes").
const debitoDeConsumidor = (gravadas) => gravadas * IVA_TASA / (1 + IVA_TASA);

const TABS = [
    { key: 'consumidor',    label: 'Consumidor Final' },
    { key: 'contribuyente', label: 'Contribuyentes'   },
    { key: 'anulados',      label: 'Anulados'         },
];

const mesActual = () => {
    const n = new Date(Date.now() - 6 * 3600_000);   // hora SV
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
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
    { key: 'exentas',   label: 'Exentas',    align: 'right', hideBelow: 'lg' },
    { key: 'gravadas',  label: 'Gravadas',   align: 'right' },
    { key: 'debito',    label: 'Débito fiscal', align: 'right', hideBelow: 'md' },
    { key: 'total',     label: 'Total del día', align: 'right' },
];

const COLS_CONTRIBUYENTE = [
    { key: 'n',         label: 'N.º',        align: 'right' },
    { key: 'fecha',     label: 'Fecha',      align: 'left'  },
    { key: 'ccf',       label: 'N.º CCF',    align: 'left'  },
    { key: 'cliente',   label: 'Cliente',    align: 'left'  },
    { key: 'nrc',       label: 'NRC',        align: 'left'  },
    { key: 'exentas',   label: 'Exentas',    align: 'right', hideBelow: 'lg' },
    { key: 'gravadas',  label: 'Gravadas',   align: 'right' },
    { key: 'debito',    label: 'Débito fiscal', align: 'right', hideBelow: 'md' },
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

    const [consumidor,    setConsumidor]    = useState([]);
    const [contribuyente, setContribuyente] = useState([]);
    const [anulados,      setAnulados]      = useState([]);
    const [loading, setLoading] = useState(true);
    const [error,   setError]   = useState(null);

    const [desde, hasta] = useMemo(() => rangoDelMes(mes), [mes]);

    // Los tres libros se traen JUNTOS aunque solo se vea uno: son de un mes y
    // caben en cientos de filas, así que cambiar de pestaña no vuelve a la red —
    // y el carril puede mostrar el total del período sin importar dónde estés.
    const load = useCallback(async () => {
        setLoading(true);
        const [c, k, a] = await Promise.all([
            fetchLibroConsumidor(desde, hasta, filterBranch),
            fetchLibroContribuyente(desde, hasta, filterBranch),
            fetchLibroAnulados(desde, hasta, filterBranch),
        ]);
        // Un libro que falla NO puede quedar como "no hubo ventas": un mes
        // vacío por error de red es indistinguible de un mes sin operaciones, y
        // acá eso se declara a Hacienda.
        const fallo = c.error || k.error || a.error;
        setError(fallo ? fallo.message : null);
        setConsumidor(c.data || []);
        setContribuyente(k.data || []);
        setAnulados(a.data || []);
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
        ]);
        return [...ids].sort((a, b) => a - b)
            .map(id => ({ value: String(id), label: nombreSucursal(id) }));
    }, [consumidor, contribuyente, anulados, nombreSucursal]);

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

        return {
            consumidor:    { docs: docsCons, exentas: exentasCons, gravadas: gravadasCons, debito: debitoDeConsumidor(gravadasCons), total: totalCons },
            contribuyente: { docs: contribuyente.length, exentas: exentasCcf, gravadas: gravadasCcf, debito: debitoCcf, total: totalCcf },
            anulados:      { docs: anulados.length, exentas: 0, gravadas: 0, debito: 0, total: totalAnul },
        };
    }, [consumidor, contribuyente, anulados]);

    const t = totales[activeTab];

    // Cuántos CCF del período van a salir sin NRC. Es el dato que decide si el
    // libro de contribuyentes se puede presentar tal cual.
    const ccfSinNrc = useMemo(
        () => contribuyente.filter(r => !r.nrc).length,
        [contribuyente]);

    const sufijoArchivo = `${mes}${filterBranch ? `_${nombreSucursal(Number(filterBranch)).replace(/\s+/g, '-')}` : ''}`;

    const exportar = () => {
        if (activeTab === 'consumidor') {
            // Art. 83: fecha · del→al · máquina/establecimiento · exentas ·
            // gravadas locales · exportaciones · total diario · cuenta de terceros.
            exportCsv(
                ['FECHA', 'DEL No', 'AL No', 'ESTABLECIMIENTO', 'VENTAS EXENTAS',
                 'VENTAS GRAVADAS LOCALES', 'EXPORTACIONES', 'TOTAL VENTAS DIARIAS',
                 'VENTAS CUENTA DE TERCEROS'],
                [
                    ...consumidor.map(r => [
                        fmtFecha(r.fecha), soloNumero(r.correlativo_del), soloNumero(r.correlativo_al),
                        nombreSucursal(r.branch_id), num(r.ventas_exentas), num(r.ventas_gravadas),
                        num(r.exportaciones), num(r.total_diario), '0.00',
                    ]),
                    // Art. 83 pide totalizar el mes y consignar el resumen del
                    // débito fiscal. Va en el archivo, no solo en la pantalla.
                    ['TOTALES', '', '', '', num(t.exentas), num(t.gravadas), '0.00', num(t.total), '0.00'],
                    ['DEBITO FISCAL DEL PERIODO', '', '', '', '', num(t.debito), '', '', ''],
                ],
                `libro-consumidor-final_${sufijoArchivo}.csv`);
            return;
        }
        if (activeTab === 'contribuyente') {
            // Art. 85: correlativo de la operación · fecha · N.º del CCF ·
            // formulario único · cliente · NRC · exentas · gravadas · débito ·
            // terceros · débito de terceros · percibido · total.
            exportCsv(
                ['No', 'FECHA', 'No CCF', 'FORMULARIO UNICO', 'CLIENTE', 'NRC',
                 'VENTAS EXENTAS', 'VENTAS GRAVADAS', 'DEBITO FISCAL',
                 'VENTAS CUENTA DE TERCEROS', 'DEBITO CUENTA DE TERCEROS',
                 'IMPUESTO PERCIBIDO', 'TOTAL'],
                [
                    ...contribuyente.map((r, i) => [
                        i + 1, fmtFecha(r.fecha), soloNumero(r.correlativo), '',
                        r.cliente || '', r.nrc || '', num(r.ventas_exentas),
                        num(r.ventas_gravadas), num(r.debito_fiscal), '0.00', '0.00', '0.00',
                        num(r.total),
                    ]),
                    ['TOTALES', '', '', '', '', '', num(t.exentas), num(t.gravadas),
                     num(t.debito), '0.00', '0.00', '0.00', num(t.total)],
                ],
                `libro-contribuyentes_${sufijoArchivo}.csv`);
            return;
        }
        exportCsv(
            ['No', 'FECHA', 'TIPO', 'CORRELATIVO', 'CODIGO DE GENERACION', 'CLIENTE', 'TOTAL'],
            [
                ...anulados.map((r, i) => [
                    i + 1, fmtFecha(r.fecha), r.tipo_documento || '', soloNumero(r.correlativo),
                    r.codigo_generacion || '', r.cliente || '', num(r.total),
                ]),
                ['TOTALES', '', '', '', '', '', num(t.total)],
            ],
            `anexo-anulados_${sufijoArchivo}.csv`);
    };

    const filas = activeTab === 'consumidor' ? consumidor
        : activeTab === 'contribuyente' ? contribuyente : anulados;

    const filtersContent = (
        <ViewTabBar
            tabs={TABS}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            showSearch={false}
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
                title: `Exportar el libro de ${TABS.find(x => x.key === activeTab)?.label} en CSV`,
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
                        los tres libros, que es lo que deja compararlos de un
                        vistazo al cambiar de pestaña. */}
                    <CarrilCards className="flex-1" ariaLabel="Resumen del libro">
                        {/* Sin sucursal elegida, una fila del libro de consumidor
                            es un día POR sucursal — decir "180 días" de un mes de
                            30 sería mentir sobre lo que se está mirando. */}
                        <StatCard icon={FileText} label="Documentos" value={t.docs}
                            sub={activeTab === 'consumidor'
                                ? `${consumidor.length} ${filterBranch ? 'días' : 'filas'}`
                                : undefined} />
                        <StatCard icon={Receipt} label="Ventas" value={formatMoney(t.total)}
                            sub="Del período" />
                        <StatCard icon={Percent} label="Débito fiscal" value={formatMoney(t.debito)}
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
                    de la pantalla no se puede defender ante una diferencia. */}
                <Notice variant="info" icon={BookOpen}>
                    Solo entran las facturas con sello de Hacienda (40 caracteres) y estado
                    FINALIZADA; los anulados son los DTE invalidados en MH. Verificado contra
                    los libros del ERP en 7 sucursales × 3 meses.
                </Notice>

                {activeTab === 'contribuyente' && ccfSinNrc > 0 && (
                    <Notice variant="warning" icon={AlertTriangle}>
                        <strong>{ccfSinNrc} de {contribuyente.length}</strong> documentos van sin NRC del
                        cliente, que el Art. 85 exige. El portal todavía no captura el receptor del DTE:
                        el libro se puede revisar, pero no presentar hasta completarlo.
                    </Notice>
                )}

                {activeTab === 'consumidor' && (
                    <DataTable columns={COLS_CONSUMIDOR} loading={loading}
                        empty={{ icon: BookOpen, message: `Sin ventas a consumidor final en ${etiquetaMes(mes)}` }}>
                        {consumidor.map((r, i) => (
                            <DataRow key={`${r.branch_id}-${r.fecha}`} index={i}>
                                <DataCell>{fmtFecha(r.fecha)}</DataCell>
                                <DataCell hideBelow="md">{nombreSucursal(r.branch_id)}</DataCell>
                                <DataCell><span className="font-mono text-caption">{soloNumero(r.correlativo_del)}</span></DataCell>
                                <DataCell><span className="font-mono text-caption">{soloNumero(r.correlativo_al)}</span></DataCell>
                                <DataCell align="center" hideBelow="sm">{r.documentos}</DataCell>
                                <DataCell align="right" hideBelow="lg">{formatMoney(r.ventas_exentas)}</DataCell>
                                <DataCell align="right">{formatMoney(r.ventas_gravadas)}</DataCell>
                                <DataCell align="right" hideBelow="md">{formatMoney(debitoDeConsumidor(Number(r.ventas_gravadas || 0)))}</DataCell>
                                <DataCell align="right"><span className="font-black">{formatMoney(r.total_diario)}</span></DataCell>
                            </DataRow>
                        ))}
                    </DataTable>
                )}

                {activeTab === 'contribuyente' && (
                    <DataTable columns={COLS_CONTRIBUYENTE} loading={loading}
                        empty={{ icon: BookOpen, message: `Sin ventas a contribuyentes en ${etiquetaMes(mes)}` }}>
                        {contribuyente.map((r, i) => (
                            <DataRow key={r.codigo_generacion || `${r.correlativo}-${i}`} index={i}>
                                <DataCell align="right">{i + 1}</DataCell>
                                <DataCell>{fmtFecha(r.fecha)}</DataCell>
                                <DataCell><span className="font-mono text-caption">{soloNumero(r.correlativo)}</span></DataCell>
                                <DataCell>{r.cliente || '—'}</DataCell>
                                <DataCell>
                                    {r.nrc
                                        ? <span className="font-mono text-caption">{r.nrc}</span>
                                        : <Badge variant="warning" size="sm">Falta</Badge>}
                                </DataCell>
                                <DataCell align="right" hideBelow="lg">{formatMoney(r.ventas_exentas)}</DataCell>
                                <DataCell align="right">{formatMoney(r.ventas_gravadas)}</DataCell>
                                <DataCell align="right" hideBelow="md">{formatMoney(r.debito_fiscal)}</DataCell>
                                <DataCell align="right"><span className="font-black">{formatMoney(r.total)}</span></DataCell>
                            </DataRow>
                        ))}
                    </DataTable>
                )}

                {activeTab === 'anulados' && (
                    <DataTable columns={COLS_ANULADOS} loading={loading}
                        empty={{ icon: Ban, message: `Sin documentos anulados en ${etiquetaMes(mes)}` }}>
                        {anulados.map((r, i) => (
                            <DataRow key={r.codigo_generacion || `${r.correlativo}-${i}`} index={i}>
                                <DataCell align="right">{i + 1}</DataCell>
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
            </div>
        </GlassViewLayout>
    );
}
