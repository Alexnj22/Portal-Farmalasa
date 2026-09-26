import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FileCheck2, AlertTriangle, Search, Clock, CheckCircle2, Ban } from 'lucide-react';
import FilterBar from '../../components/common/FilterBar';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import TablePagination from '../../components/common/TablePagination';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { tokenMatch } from '../../utils/searchUtils';
import { formatMoney } from '../../utils/formatNumber';
import { fechaNumerica, hoySV, sumarDias } from '../../utils/fecha';
import { usePaginaEnUrl } from '../../plataforma/usePaginaEnUrl';
import { fetchDocumentos } from '../../data/distribucion';
import DocumentoModal from './DocumentoModal';
import { ESTADO_DOCUMENTO, TIPO_DOCUMENTO } from './comun';

const COLS = [
    { key: 'documento', label: 'Documento', align: 'left', className: 'w-[200px]' },
    { key: 'cliente',   label: 'Cliente',   align: 'left', hideBelow: 'md' },
    { key: 'estado',    label: 'Estado',    align: 'left' },
    { key: 'fecha',     label: 'Emitido',   align: 'left', hideBelow: 'sm' },
    { key: 'total',     label: 'Total',     align: 'right' },
];

const FILTRO_ESTADO = [
    { value: 'pendiente', label: 'Sin sello' },
    { value: 'sellado',   label: 'Sellados' },
    { value: 'rechazado', label: 'Rechazados' },
    { value: 'invalidado', label: 'Invalidados' },
];
const PENDIENTE = new Set(['sin_firmar', 'firmado', 'contingencia']);

export default function TabDocumentos({ puedeVender, buscar }) {
    const [docs, setDocs] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');
    const [estado, setEstado] = useState('');
    const [tipo, setTipo] = useState('');
    const [abierto, setAbierto] = useState(null);
    const pedidoRef = useRef(0);

    const cargar = useCallback(async () => {
        const mio = ++pedidoRef.current;
        setCargando(true);
        setError('');
        try {
            const r = await fetchDocumentos({ desde: sumarDias(hoySV(), -120) });
            if (mio === pedidoRef.current) setDocs(r);
        } catch (e) {
            if (mio !== pedidoRef.current) return;
            console.error('TabDocumentos', e);
            setError('No se pudieron cargar los documentos. Revisa la conexión e intenta de nuevo.');
        } finally {
            if (mio === pedidoRef.current) setCargando(false);
        }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const filtrados = useMemo(() => {
        const q = buscar.trim();
        return docs.filter(d =>
            (!estado || (estado === 'pendiente' ? PENDIENTE.has(d.estado) : d.estado === estado))
            && (!tipo || d.tipo === tipo)
            && (!q || tokenMatch(q, d.dist_clientes?.nombre, d.numero_control)));
    }, [docs, buscar, estado, tipo]);

    const stats = useMemo(() => ({
        pendientes: docs.filter(d => PENDIENTE.has(d.estado)).length,
        sellados: docs.filter(d => d.estado === 'sellado').length,
        rechazados: docs.filter(d => d.estado === 'rechazado').length,
        vendido: docs.filter(d => d.estado === 'sellado' && (d.tipo === '01' || d.tipo === '03'))
            .reduce((a, d) => a + Number(d.total_pagar), 0),
    }), [docs]);

    const { page, pageSize, totalPages, setPage, setPageSize } = usePaginaEnUrl({ total: filtrados.length });
    useEffect(() => { setPage(1); }, [buscar, estado, tipo]); // eslint-disable-line react-hooks/exhaustive-deps
    const pagina = filtrados.slice((page - 1) * pageSize, page * pageSize);

    return (
        <div className="p-5 md:p-6 space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen de documentos">
                    <StatCard icon={Clock} label="Sin sello" value={stats.pendientes} loading={cargando}
                        iconBg="bg-warning/10" iconCls="text-warning" valueCls={stats.pendientes ? 'text-warning-text' : undefined}
                        sub="Firmados o por firmar" active={estado === 'pendiente'} tono="warning"
                        onClick={() => setEstado(v => (v === 'pendiente' ? '' : 'pendiente'))} />
                    <StatCard icon={CheckCircle2} label="Sellados" value={stats.sellados} loading={cargando}
                        iconBg="bg-success/10" iconCls="text-success" sub="Recibidos por Hacienda" />
                    <StatCard icon={Ban} label="Rechazados" value={stats.rechazados} loading={cargando}
                        iconBg="bg-danger/10" iconCls="text-danger" valueCls={stats.rechazados ? 'text-danger-text' : undefined}
                        sub="Hay que emitirlos de nuevo" active={estado === 'rechazado'} tono="danger"
                        onClick={() => setEstado(v => (v === 'rechazado' ? '' : 'rechazado'))} />
                    <StatCard icon={FileCheck2} label="Vendido" value={formatMoney(stats.vendido)} loading={cargando}
                        sub="Facturas y CCF sellados, 120 días" />
                </CarrilCards>
                <FilterBar onClear={() => { setEstado(''); setTipo(''); }} activeCount={[estado, tipo].filter(Boolean).length}>
                    <FilterBar.Section active={!!estado} onClear={() => setEstado('')} label="estado">
                        <FilterBar.Opciones options={FILTRO_ESTADO} value={estado} onChange={v => setEstado(v || '')}
                            label="Estado" icon={FileCheck2} placeholder="Estado" />
                    </FilterBar.Section>
                    <FilterBar.Section active={!!tipo} onClear={() => setTipo('')} label="tipo">
                        <FilterBar.Opciones value={tipo} onChange={v => setTipo(v || '')} label="Tipo" placeholder="Tipo"
                            options={Object.entries(TIPO_DOCUMENTO).map(([value, t]) => ({ value, label: t.largo }))} />
                    </FilterBar.Section>
                </FilterBar>
            </div>

            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}

            <DataTable
                columns={COLS}
                movil={{ usarAccionDeFila: true }}
                loading={cargando}
                minWidth="320px"
                empty={buscar || estado || tipo
                    ? { icon: Search, message: 'Sin resultados', subtext: 'Ningún documento coincide con la búsqueda o el filtro.' }
                    : { icon: FileCheck2, message: 'Sin documentos', subtext: 'Se crean al facturar un pedido.' }}
            >
                {pagina.map((d, i) => {
                    const est = ESTADO_DOCUMENTO[d.estado];
                    return (
                        <DataRow key={d.id} index={i} onClick={() => setAbierto(d.id)}>
                            <DataCell>
                                <div className="min-w-0 max-w-[190px]">
                                    <p className="text-body-sm font-bold text-content-2 truncate">
                                        {TIPO_DOCUMENTO[d.tipo]?.largo}
                                        {d.ambiente === '00' && <span className="text-caption text-content-3 font-normal"> · prueba</span>}
                                    </p>
                                    <p className="font-mono text-caption text-content-3 truncate" title={d.numero_control}>{d.numero_control}</p>
                                </div>
                            </DataCell>
                            <DataCell hideBelow="md">
                                <span className="text-caption text-content-2 truncate block max-w-[200px]" title={d.dist_clientes?.nombre}>
                                    {d.dist_clientes?.nombre ?? '—'}
                                </span>
                            </DataCell>
                            <DataCell><Badge size="sm" variant={est.variant}>{est.label}</Badge></DataCell>
                            <DataCell hideBelow="sm">
                                <span className="text-label text-content-2 tabular-nums">{fechaNumerica(d.fec_emi)}</span>
                            </DataCell>
                            <DataCell align="right">
                                <span className="tabular-nums font-bold text-content-2">{formatMoney(d.total_pagar)}</span>
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>

            {!cargando && filtrados.length > 0 && (
                <TablePagination pageSize={pageSize} onPageSizeChange={setPageSize} page={page}
                    totalPages={totalPages} onPageChange={setPage} total={filtrados.length} unit="documentos" />
            )}

            {abierto && (
                <DocumentoModal id={abierto} puedeVender={puedeVender} onClose={() => setAbierto(null)}
                    onCambio={cargar} />
            )}
        </div>
    );
}
