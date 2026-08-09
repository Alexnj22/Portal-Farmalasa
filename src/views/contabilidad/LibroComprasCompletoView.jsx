import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Download, AlertTriangle, SearchX, Mail, Percent } from 'lucide-react';
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
import { formatearNit, formatearNrc } from '../../utils/nitUtils';
import { normalizeText } from '../../utils/helpers';
import { exportCsv } from '../../utils/csvExport';
import { mensajeAmigable } from '../../utils/errorMessages';
import { fetchLibroComprasCompleto } from '../../data/libroComprasCompleto';

// ─────────────────────────────────────────────────────────────────────────────
// Libro de compras COMPLETO — vista propia, no una pestaña de Libros IVA.
//
// Separada a propósito y por pedido explícito (2026-08-02): el libro de Libros
// IVA sale del ERP y su valor es que se puede cotejar contra el archivo del
// origen —mismo contenido, mismo formato— para confirmar que no sobra ni falta
// nada. Mezclarlos rompería esa prueba.
//
// Éste responde otra pregunta: **qué compró la farmacia de verdad**. Suma a las
// compras del ERP los DTE que llegaron por correo y nunca se registraron como
// compra.
//
// Y hace dos cosas mejor que el ERP, a propósito:
//   · el número de documento va COMPLETO (el ERP lo corta a 20 y así su libro no
//     identifica sus propios documentos);
//   · cada fila dice de dónde salió, para que la diferencia sea auditable.
//
// Lo que NO hace: restar las notas de crédito. El ajuste del Art. 62 está
// pendiente de confirmación con el contador, y meterlo sin esa confirmación
// sería inventar una tercera verdad.
//
// NOTA DE ESTRUCTURA: los componentes se llaman con la MISMA firma que
// `LibrosIvaView`, que es la vista hermana y la que está probada. La primera
// versión inventó props (`FilterBar.Pill`, `searchValue` en GlassViewLayout,
// `TablePagination` sin `totalPages`) y reventó con React #130 al abrirla. Si
// hay que cambiar algo acá, mirar primero cómo lo hace la de al lado.
// ─────────────────────────────────────────────────────────────────────────────

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const mesActual = () => {
    const sv = new Date(Date.now() - 6 * 3600_000);
    return `${sv.getUTCFullYear()}-${String(sv.getUTCMonth() + 1).padStart(2, '0')}`;
};
const etiquetaMes = (mes) => {
    const [y, m] = mes.split('-').map(Number);
    return `${MESES[m - 1]} ${y}`;
};
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

// DD/MM/YYYY. Se parte la cadena en vez de construir un Date: `new Date('2026-06-01')`
// es UTC y en El Salvador (−6) retrocede un día.
const fmtFecha = (iso) => {
    if (!iso) return '';
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
};

// El dinero va SIEMPRE con dos decimales. Sin esto el CSV escribía el número
// crudo de JavaScript: `5` en vez de `5.00`, y en la fila de totales
// `30549.219999999994` — la suma de flotantes asomando en un archivo contable.
const num = (n) => (Number(n) || 0).toFixed(2);
// Vacío ≠ 0.00: NULL significa "no sabemos si hubo percepción", y escribir cero
// sería afirmar que no la hubo. Misma regla que en el libro de compras.
const numOpcional = (n) => (n == null ? '' : num(n));

// Los rótulos hablan del PORTAL: nunca se nombra el sistema de origen ni la
// procedencia del dato (ver CLAUDE.md). Lo que la vista quiere decir no es "de
// dónde vino" sino en qué estado está: la compra quedó registrada, o solo existe
// el documento que emitió el proveedor.
const TABS = [
    { key: 'todos',      label: 'Todos'          },
    { key: 'sin_compra', label: 'Sin registrar'  },
];

const COLS = [
    { key: 'fecha',     label: 'Fecha',      align: 'left'  },
    { key: 'origen',    label: 'Registro',   align: 'left'  },
    { key: 'documento', label: 'Documento',  align: 'left'  },
    { key: 'proveedor', label: 'Proveedor',  align: 'left'  },
    // `2xl` y no `lg`/`xl`: a 1440 las nueve columnas piden 1,152px contra los
    // 1,046 del marco y **Total se salía 106px**, cortado a media cifra. NRC y
    // NIT son identificadores del proveedor —contexto— y el total es la fila.
    // Los dos siguen enteros en el detalle y en el CSV.
    { key: 'nrc',       label: 'NRC',        align: 'left',  hideBelow: '2xl' },
    { key: 'nit',       label: 'NIT',        align: 'left',  hideBelow: '2xl' },
    { key: 'gravadas',  label: 'Gravadas',   align: 'right' },
    { key: 'credito',   label: 'Crédito',    align: 'right', hideBelow: 'md' },
    { key: 'total',     label: 'Total',      align: 'right' },
];

export default function LibroComprasCompletoView() {
    const { getScope, hasPermission } = useAuth();
    // Canon de permisos 2026-08-03.
    const canDownload  = hasPermission('libro_compras_completo_descargar');
    const canVerMontos = hasPermission('libro_compras_completo_ver_montos');
    const branches = useStaffStore((s) => s.branches);

    const [activeTab, setActiveTab]   = useState('todos');
    const [mes, setMes]               = useState(mesActual());
    const [filterBranch, setFB]       = useState('');
    const [filas, setFilas]           = useState([]);
    const [loading, setLoading]       = useState(true);
    const [error, setError]           = useState('');
    const [busqueda, setBusqueda]     = useState('');
    const [pagina, setPagina]         = useState(1);
    const [tamPagina, setTamPagina]   = useState(50);

    const cargar = useCallback(async () => {
        setLoading(true);
        setError('');
        const [desde, hasta] = rangoDelMes(mes);
        try {
            const data = await fetchLibroComprasCompleto(desde, hasta, filterBranch);
            // `fetchAllRows` devuelve null si el PRIMER trozo falló. Tratarlo como
            // lista vacía convertiría una consulta rota en "no hay compras", que es
            // exactamente cómo un error vive semanas sin que nadie lo note.
            if (data === null) throw new Error('No se pudo leer el libro completo.');
            setFilas(data);
        } catch (e) {
            setError(mensajeAmigable(e, 'No se pudo cargar el libro de compras completo'));
            setFilas([]);
        } finally {
            setLoading(false);
        }
    }, [mes, filterBranch]);

    useEffect(() => { cargar(); }, [cargar]);

    const nombreSucursal = useCallback(
        (id) => branches.find(b => b.id === id)?.name ?? (id ? `Suc. ${id}` : 'Sin sucursal'),
        [branches]);

    const delTab = useMemo(
        () => (activeTab === 'sin_compra' ? filas.filter(r => r.origen !== 'registrada') : filas),
        [filas, activeTab]);

    const filasVistas = useMemo(() => {
        const q = normalizeText(busqueda.trim());
        if (!q) return delTab;
        return delTab.filter(r =>
            normalizeText(r.proveedor || '').includes(q) ||
            normalizeText(r.documento_completo || '').includes(q) ||
            normalizeText(r.nit || '').includes(q));
    }, [delTab, busqueda]);

    const totales = useMemo(() => {
        const acc = { docs: 0, credito: 0, total: 0, sinCompra: 0, creditoSinCompra: 0 };
        for (const r of filas) {
            acc.docs++;
            acc.credito += Number(r.credito_fiscal || 0);
            acc.total   += Number(r.total || 0);
            if (r.origen !== 'registrada') {
                acc.sinCompra++;
                acc.creditoSinCompra += Number(r.credito_fiscal || 0);
            }
        }
        return acc;
    }, [filas]);

    const totalPaginas = Math.max(1, Math.ceil(filasVistas.length / tamPagina));
    const paginadas = useMemo(() => {
        const ini = (pagina - 1) * tamPagina;
        return filasVistas.slice(ini, ini + tamPagina);
    }, [filasVistas, pagina, tamPagina]);

    useEffect(() => { setPagina(1); }, [busqueda, activeTab, mes, filterBranch]);

    const exportar = useCallback(() => {
        const [desde] = rangoDelMes(mes);
        // El orden es `(headers, rows, filename)`. Estaba llamado
        // `(filename, headers, rows)`, así que `buildCsvText` recibía el nombre
        // del archivo como fila de encabezado y hacía `"…".map(...)` sobre una
        // cadena: TypeError antes de generar un solo byte. El botón no daba
        // ningún aviso — el error moría en la consola y no pasaba nada.
        exportCsv(
            ['FECHA', 'REGISTRO', 'SUCURSAL', 'TIPO', 'DOCUMENTO', 'NRC', 'NIT', 'PROVEEDOR',
             'EXENTAS', 'GRAVADAS', 'CREDITO FISCAL', 'TOTAL', 'PERCEPCION', 'RETENCION', 'ANULADA'],
            [
                ...filas.map(r => [
                    fmtFecha(r.fecha),
                    r.origen === 'registrada' ? 'Registrada' : 'Sin registrar',
                    nombreSucursal(r.branch_id),
                    r.documento_tipo || '',
                    // El COMPLETO, no el cortado a 20 del ERP: es justamente lo
                    // que este libro hace mejor que su origen.
                    r.documento_completo || '',
                    r.nrc || '', r.nit || '', r.proveedor || '',
                    num(r.compras_exentas), num(r.compras_gravadas),
                    num(r.credito_fiscal), num(r.total),
                    numOpcional(r.percepcion_iva),
                    numOpcional(r.retencion_iva),
                    r.anulada ? 'SI' : '',
                ]),
                ['TOTALES', '', '', '', '', '', '', '', '', '',
                 num(totales.credito), num(totales.total), '', '', ''],
            ],
            // Con la extensión: sin ella el navegador guarda un archivo sin tipo
            // y Excel no lo abre con doble click.
            `libro-compras-completo_${desde.slice(0, 7)}.csv`,
        );
        useStaffStore.getState().appendAuditLog('LIBRO_COMPRAS_COMPLETO_EXPORT', mes, {
            documentos: totales.docs, credito_fiscal: totales.credito,
            sin_registrar: totales.sinCompra,
        });
    }, [filas, mes, totales, nombreSucursal]);

    const branchOptions = useMemo(
        () => branches.map(b => ({ value: String(b.id), label: b.name })), [branches]);
    const puedeElegirSucursal = getScope('libro_compras_completo') !== 'BRANCH';

    const filtersContent = (
        <ViewTabBar
            tabs={TABS}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            searchValue={busqueda}
            onSearchChange={setBusqueda}
            placeholder="Buscar proveedor, documento o NIT…"
        />
    );

    const barraFiltros = (
        <FilterBar
            onClear={() => { setFB(''); setMes(mesActual()); }}
            activeCount={[filterBranch, mes !== mesActual()].filter(Boolean).length}
            acciones={!canDownload ? [] : [{
                key: 'exportar',
                icon: Download,
                label: 'Exportar',
                soloIcono: true,
                title: `Exportar el libro de compras completo en CSV — ${filas.length} filas, con el número de documento completo`,
                onClick: exportar,
                disabled: loading || filas.length === 0,
            }]}>
            {puedeElegirSucursal && branchOptions.length > 0 && (
                <FilterBar.Section active={!!filterBranch} onClear={() => setFB('')} label="sucursal">
                    <FilterBar.Sucursal value={filterBranch}
                        onChange={val => setFB(val || '')} options={branchOptions} />
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

    // El vacío se explica en vez de quedar en "no hay datos": un fallo de la
    // consulta y un mes sin movimiento se ven igual, y confundirlos es lo que
    // haría presentar un libro incompleto sin saberlo.
    const vacio = error
        ? { icon: AlertTriangle,
            message: 'No se pudo generar el libro',
            subtext: 'Es un fallo de la consulta, no un mes sin movimiento. No presentes nada de esta pantalla.' }
        : busqueda.trim()
            ? { icon: SearchX,
                message: `Sin coincidencias para «${busqueda.trim()}»`,
                subtext: 'La búsqueda recorta lo que ves; el CSV sigue saliendo con el libro completo.' }
            : { icon: BookOpen,
                message: `Sin compras en ${etiquetaMes(mes)}`,
                subtext: activeTab === 'sin_compra'
                    ? 'Todos los documentos del mes ya están registrados como compra.'
                    : undefined };

    return (
        <GlassViewLayout
            icon={BookOpen}
            title="Compras Completo"
            filtersContent={filtersContent}
            transparentBody={true}
        >
            <div className="p-5 md:p-6 space-y-5">
                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                    <CarrilCards className="flex-1" ariaLabel="Resumen del libro completo">
                        <StatCard icon={BookOpen} label="Documentos" value={totales.docs} loading={loading}
                            sub={`${totales.docs - totales.sinCompra} registradas · ${totales.sinCompra} sin registrar`} />
                        {/* Documentos queda siempre: es lo que dice si el libro está
                            completo (cuántas sin registrar), y no revela cifras. */}
                        {canVerMontos && (
                            <>
                                <StatCard icon={Mail} label="Compras" value={formatMoney(totales.total)}
                                    sub="Del período" loading={loading} />
                                <StatCard icon={Percent} label="Crédito fiscal" value={formatMoney(totales.credito)}
                                    sub="Documentado" loading={loading} />
                            </>
                        )}
                    </CarrilCards>
                    <div className="flex justify-end min-w-0">{barraFiltros}</div>
                </div>

                {error && (
                    <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>
                )}

                <Notice variant="info" icon={BookOpen} compact>
                    Todas las compras del período, incluidas las que llegaron como documento
                    del proveedor y todavía no se registraron. El número de documento va
                    completo. Para presentar, el libro del Art. 86 sigue siendo el de <b>Libros IVA</b>.
                </Notice>

                {!loading && totales.sinCompra > 0 && (
                    <Notice variant="warning" icon={AlertTriangle}>
                        <b>{totales.sinCompra}</b> documento(s) del proveedor todavía no están
                        registrados como compra — <b>{formatMoney(totales.creditoSinCompra)}</b> de
                        crédito fiscal que no entra al libro del Art. 86. La Ley de IVA da tres
                        períodos para reclamarlo.
                    </Notice>
                )}

                {/* La inferencia daba `Fecha` como identidad —es la primera
                    columna con rótulo— y la ficha abría con «05/07/2025» de
                    título. De una compra, lo que la identifica es el PROVEEDOR;
                    la fecha y el estado son contexto. El número de documento va
                    a la hoja, donde entra completo y con su rótulo. */}
                <DataTable columns={COLS} dense loading={loading} empty={vacio}
                    movil={{ identidad: 'proveedor', chips: ['fecha', 'origen'] }}>
                    {paginadas.map((r, i) => (
                        <DataRow key={`${r.origen}-${r.documento_completo}-${i}`}>
                            <DataCell>{fmtFecha(r.fecha)}</DataCell>
                            <DataCell>
                                <Badge variant={r.origen === 'registrada' ? 'neutral' : 'warning'} size="sm">
                                    {r.origen === 'registrada' ? 'Registrada' : 'Sin registrar'}
                                </Badge>
                            </DataCell>
                            <DataCell className="max-w-[15rem]">
                                <span className="font-mono text-micro break-all">
                                    {r.documento_completo || '—'}
                                </span>
                            </DataCell>
                            <DataCell className="max-w-[16rem]">
                                <span className="line-clamp-2 break-words leading-tight">
                                    {r.proveedor || '—'}
                                </span>
                            </DataCell>
                            <DataCell hideBelow="2xl">
                                {r.nrc
                                    ? <span className="font-mono text-caption whitespace-nowrap">{formatearNrc(r.nrc)}</span>
                                    : <Badge variant="warning" size="sm">Falta</Badge>}
                            </DataCell>
                            <DataCell hideBelow="2xl">
                                {r.nit
                                    ? <span className="font-mono text-caption whitespace-nowrap">{formatearNit(r.nit)}</span>
                                    : <Badge variant="warning" size="sm">Falta</Badge>}
                            </DataCell>
                            <DataCell align="right">
                                <span className="whitespace-nowrap">{formatMoney(r.compras_gravadas)}</span>
                            </DataCell>
                            <DataCell align="right" hideBelow="md">
                                <span className="whitespace-nowrap">{formatMoney(r.credito_fiscal)}</span>
                            </DataCell>
                            <DataCell align="right">
                                <span className="font-black whitespace-nowrap">{formatMoney(r.total)}</span>
                            </DataCell>
                        </DataRow>
                    ))}
                </DataTable>

                {filasVistas.length > 0 && (
                    <TablePagination
                        page={pagina}
                        totalPages={totalPaginas}
                        onPageChange={setPagina}
                        pageSize={tamPagina}
                        onPageSizeChange={setTamPagina}
                        total={delTab.length}
                        filteredTotal={busqueda.trim() ? filasVistas.length : undefined}
                        unit="documentos"
                    />
                )}
            </div>
        </GlassViewLayout>
    );
}
