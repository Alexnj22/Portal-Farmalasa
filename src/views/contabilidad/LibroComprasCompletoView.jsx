import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Download, AlertTriangle, SearchX, Mail, Database } from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
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
// Está separado a propósito y por pedido explícito (2026-08-02): el libro de
// Libros IVA sale del ERP y su valor es que se puede cotejar contra el archivo
// del origen —mismo contenido, mismo formato— para confirmar que no sobra ni
// falta nada. Mezclarlos rompería esa prueba.
//
// Éste responde otra pregunta: **qué compró la farmacia de verdad**. Suma a las
// compras del ERP los DTE que llegaron por correo y nunca se registraron como
// compra. Junio-julio 2026: 528 documentos y $10,921.99 de crédito fiscal que el
// otro libro no ve.
//
// Y hace dos cosas mejor que el ERP, a propósito:
//   · el número de documento va COMPLETO (el ERP lo corta a 20 y así su libro no
//     identifica sus propios documentos);
//   · cada fila dice de dónde salió, para que la diferencia sea auditable.
//
// Lo que NO hace: restar las notas de crédito. El ajuste del Art. 62 está
// pendiente de confirmación con el contador, y meterlo sin esa confirmación
// sería inventar una tercera verdad.
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

const COLS = [
    { key: 'fecha',     label: 'Fecha',      align: 'left'  },
    { key: 'origen',    label: 'Origen',     align: 'left'  },
    { key: 'documento', label: 'Documento',  align: 'left'  },
    { key: 'proveedor', label: 'Proveedor',  align: 'left'  },
    { key: 'nrc',       label: 'NRC',        align: 'left', hideBelow: 'lg' },
    { key: 'nit',       label: 'NIT',        align: 'left', hideBelow: 'xl' },
    { key: 'gravadas',  label: 'Gravadas',   align: 'right' },
    { key: 'credito',   label: 'Crédito',    align: 'right', hideBelow: 'md' },
    { key: 'total',     label: 'Total',      align: 'right' },
];

export default function LibroComprasCompletoView() {
    const { getScope } = useAuth();
    const branches = useStaffStore((s) => s.branches);

    const [mes, setMes]           = useState(mesActual());
    const [filterBranch, setFB]   = useState('');
    const [filas, setFilas]       = useState([]);
    const [loading, setLoading]   = useState(true);
    const [error, setError]       = useState('');
    const [busqueda, setBusqueda] = useState('');
    const [pagina, setPagina]     = useState(1);
    const [porPagina, setPorPag]  = useState(50);
    const [soloSinCompra, setSoloSinCompra] = useState(false);

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

    const visibles = useMemo(() => {
        let out = filas;
        if (soloSinCompra) out = out.filter(r => r.origen !== 'ERP');
        if (busqueda) {
            const q = normalizeText(busqueda);
            out = out.filter(r =>
                normalizeText(r.proveedor || '').includes(q) ||
                normalizeText(r.documento_completo || '').includes(q) ||
                normalizeText(r.nit || '').includes(q));
        }
        return out;
    }, [filas, soloSinCompra, busqueda]);

    const totales = useMemo(() => {
        const acc = { docs: 0, gravadas: 0, credito: 0, total: 0, sinCompra: 0, creditoSinCompra: 0 };
        for (const r of filas) {
            acc.docs++;
            acc.gravadas += Number(r.compras_gravadas || 0);
            acc.credito  += Number(r.credito_fiscal || 0);
            acc.total    += Number(r.total || 0);
            if (r.origen !== 'ERP') {
                acc.sinCompra++;
                acc.creditoSinCompra += Number(r.credito_fiscal || 0);
            }
        }
        return acc;
    }, [filas]);

    const paginadas = useMemo(() => {
        const ini = (pagina - 1) * porPagina;
        return visibles.slice(ini, ini + porPagina);
    }, [visibles, pagina, porPagina]);

    useEffect(() => { setPagina(1); }, [busqueda, soloSinCompra, mes, filterBranch]);

    const exportar = useCallback(() => {
        const [desde] = rangoDelMes(mes);
        exportCsv(
            `libro-compras-completo_${desde.slice(0, 7)}`,
            ['FECHA', 'ORIGEN', 'SUCURSAL', 'TIPO', 'DOCUMENTO', 'NRC', 'NIT', 'PROVEEDOR',
             'EXENTAS', 'GRAVADAS', 'CREDITO FISCAL', 'TOTAL', 'PERCEPCION', 'RETENCION', 'ANULADA'],
            [
                ...filas.map(r => [
                    fmtFecha(r.fecha), r.origen, nombreSucursal(r.branch_id),
                    r.documento_tipo || '',
                    // El COMPLETO, no el cortado a 20 del ERP: es justamente lo
                    // que este libro hace mejor.
                    r.documento_completo || '',
                    r.nrc || '', r.nit || '', r.proveedor || '',
                    Number(r.compras_exentas || 0), Number(r.compras_gravadas || 0),
                    Number(r.credito_fiscal || 0), Number(r.total || 0),
                    r.percepcion_iva == null ? '' : Number(r.percepcion_iva),
                    r.retencion_iva == null ? '' : Number(r.retencion_iva),
                    r.anulada ? 'SI' : '',
                ]),
                ['TOTALES', '', '', '', '', '', '', '',
                 '', totales.gravadas, totales.credito, totales.total, '', '', ''],
            ],
        );
        useStaffStore.getState().appendAuditLog('LIBRO_COMPRAS_COMPLETO_EXPORT', mes, {
            documentos: totales.docs, credito_fiscal: totales.credito,
            sin_compra_en_erp: totales.sinCompra,
        });
    }, [filas, mes, totales, nombreSucursal]);

    const puedeElegirSucursal = getScope('libro_compras_completo') !== 'BRANCH';
    const branchOptions = useMemo(
        () => branches.map(b => ({ value: String(b.id), label: b.name })), [branches]);

    const barraFiltros = (
        <FilterBar
            onClear={() => { setFB(''); setMes(mesActual()); setSoloSinCompra(false); }}
            activeCount={[filterBranch, mes !== mesActual(), soloSinCompra].filter(Boolean).length}
            acciones={[{
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
                    isCurrent={mes === mesActual()}
                    onCurrent={() => setMes(mesActual())} />
            </FilterBar.Section>
        </FilterBar>
    );

    return (
        <GlassViewLayout
            title="Libro de Compras Completo"
            icon={BookOpen}
            searchValue={busqueda}
            onSearchChange={setBusqueda}
            searchPlaceholder="Buscar proveedor, documento o NIT..."
            barraFiltros={barraFiltros}>

            <Notice variant="info" icon={BookOpen}>
                No reemplaza al libro de <b>Libros IVA</b>, que sale del ERP y sirve para
                cotejarse contra el archivo del origen. Éste suma las compras del ERP y
                los DTE recibidos por correo que nunca se registraron como compra, y
                exporta el <b>número de documento completo</b>.
            </Notice>

            {totales.sinCompra > 0 && (
                <Notice variant="warning" icon={AlertTriangle}>
                    <b>{totales.sinCompra}</b> documento(s) llegaron por correo y no están
                    registrados como compra en el ERP — <b>{formatMoney(totales.creditoSinCompra)}</b> de
                    crédito fiscal que el libro del ERP no incluye. El Art. 65 de la Ley de IVA
                    da tres períodos para reclamarlo.
                </Notice>
            )}

            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}

            <CarrilCards>
                <StatCard icon={BookOpen} label="Documentos" value={totales.docs}
                    sub={`${totales.docs - totales.sinCompra} del ERP · ${totales.sinCompra} por correo`} />
                <StatCard icon={Database} label="Compras" value={formatMoney(totales.total)}
                    sub="Del período" />
                <StatCard icon={Mail} label="Crédito fiscal" value={formatMoney(totales.credito)}
                    sub="Documentado" />
            </CarrilCards>

            <div className="flex items-center gap-2 flex-wrap">
                <FilterBar.Pill
                    active={soloSinCompra}
                    onClick={() => setSoloSinCompra(v => !v)}
                    label={`Solo los que no están en el ERP (${totales.sinCompra})`} />
            </div>

            {!loading && visibles.length === 0 ? (
                <Notice variant="neutral" icon={SearchX}>
                    {filas.length === 0
                        ? `No hay compras registradas en ${etiquetaMes(mes)}.`
                        : 'Ningún documento coincide con el filtro.'}
                </Notice>
            ) : (
                <>
                    <DataTable columns={COLS} loading={loading}>
                        {paginadas.map((r, i) => (
                            <DataRow key={`${r.origen}-${r.documento_completo}-${i}`}>
                                <DataCell>{fmtFecha(r.fecha)}</DataCell>
                                <DataCell>
                                    <Badge variant={r.origen === 'ERP' ? 'neutral' : 'warning'} size="sm">
                                        {r.origen === 'ERP' ? 'ERP' : 'Por correo'}
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
                                <DataCell hideBelow="lg">
                                    {r.nrc
                                        ? <span className="font-mono text-caption whitespace-nowrap">{formatearNrc(r.nrc)}</span>
                                        : <Badge variant="warning" size="sm">Falta</Badge>}
                                </DataCell>
                                <DataCell hideBelow="xl">
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

                    <TablePagination
                        total={visibles.length}
                        page={pagina}
                        pageSize={porPagina}
                        onPageChange={setPagina}
                        onPageSizeChange={setPorPag}
                        unit="documentos" />
                </>
            )}
        </GlassViewLayout>
    );
}
