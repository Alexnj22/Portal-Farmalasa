import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Plus, Store, ShieldAlert, Search, AlertTriangle, CreditCard, ShieldCheck } from 'lucide-react';
import FilterBar from '../../components/common/FilterBar';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import TablePagination from '../../components/common/TablePagination';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { tokenMatch } from '../../utils/searchUtils';
import { formatMoney } from '../../utils/formatNumber';
import { formatearNit, formatearNrc } from '../../utils/nitUtils';
import { hoySV, sumarDias } from '../../utils/fecha';
import { usePaginaEnUrl } from '../../plataforma/usePaginaEnUrl';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { fetchClientes } from '../../data/distribucion';
import { ubicacionMH } from '../../data/geoCodigosMH';
import ClienteModal from './ClienteModal';
import { TIPO_CLIENTE, rotuloTipoCliente } from './comun';

const COLS = [
    { key: 'nombre',    label: 'Cliente',   align: 'left', className: 'w-[220px]' },
    { key: 'documento', label: 'Documento', align: 'left', hideBelow: 'md' },
    { key: 'licencia',  label: 'Licencia',  align: 'left' },
    { key: 'ruta',      label: 'Ruta',      align: 'left', hideBelow: 'lg' },
    { key: 'credito',   label: 'Crédito',   align: 'right', hideBelow: 'sm' },
];

/** La licencia de la SRS decide si se le puede vender: es la columna que importa. */
function estadoLicencia(c, hoy) {
    if (!c.licencia_srs) return { variant: 'danger', label: 'Sin licencia' };
    if (c.licencia_srs_vence && c.licencia_srs_vence < hoy) return { variant: 'danger', label: 'Vencida' };
    if (c.licencia_srs_vence && c.licencia_srs_vence <= sumarDias(hoy, 30)) return { variant: 'warning', label: 'Vence pronto' };
    return { variant: 'success', label: 'Vigente' };
}

export default function TabClientes({ emisor, puedeVender, buscar }) {
    const [clientes, setClientes] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');
    const [tipo, setTipo] = useState('');
    const [soloSinLicencia, setSoloSinLicencia] = useState(false);
    const [abierto, setAbierto] = useState(null); // cliente, o {} para uno nuevo
    const pedidoRef = useRef(0);
    const hoy = hoySV();

    const cargar = useCallback(async () => {
        const mio = ++pedidoRef.current;
        setCargando(true);
        setError('');
        try {
            const r = await fetchClientes();
            if (mio === pedidoRef.current) setClientes(r);
        } catch (e) {
            if (mio !== pedidoRef.current) return;
            console.error('TabClientes', e);
            setError('No se pudieron cargar los clientes. Revisa la conexión e intenta de nuevo.');
        } finally {
            if (mio === pedidoRef.current) setCargando(false);
        }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const filtrados = useMemo(() => {
        const q = buscar.trim();
        const qd = q.replace(/\D/g, '');
        return clientes.filter(c => (!tipo || c.tipo === tipo)
            && (!soloSinLicencia || estadoLicencia(c, hoy).variant !== 'success')
            // Los documentos se comparan por sus DÍGITOS: «0407-150390» y
            // «0407150390» son el mismo NIT escrito de dos maneras.
            && (!q || tokenMatch(q, c.nombre, c.nombre_comercial, c.ruta)
                || (qd.length >= 3 && tokenMatch(qd, c.num_documento?.replace(/\D/g, ''), c.nrc))));
    }, [clientes, buscar, tipo, soloSinLicencia, hoy]);

    const stats = useMemo(() => ({
        activos: clientes.filter(c => c.activo).length,
        contribuyentes: clientes.filter(c => c.activo && c.contribuyente).length,
        sinLicencia: clientes.filter(c => c.activo && estadoLicencia(c, hoy).variant !== 'success').length,
        credito: clientes.filter(c => c.activo && c.plazo_dias > 0).length,
    }), [clientes, hoy]);

    const { page, pageSize, totalPages, setPage, setPageSize } = usePaginaEnUrl({ total: filtrados.length });
    useEffect(() => { setPage(1); }, [buscar, tipo, soloSinLicencia]); // eslint-disable-line react-hooks/exhaustive-deps
    const pagina = filtrados.slice((page - 1) * pageSize, page * pageSize);

    const abrir = (c) => {
        setAbierto(c);
        if (c.id) useStaff.getState().appendAuditLog('DISTRIBUCION_VER_CLIENTE', String(c.id), { nombre: c.nombre });
    };

    const acciones = puedeVender && emisor
        ? [{ key: 'nuevo', icon: Plus, label: 'Nuevo cliente', variant: 'primary', onClick: () => setAbierto({}) }]
        : [];

    return (
        <div className="p-5 md:p-6 space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen de clientes">
                    <StatCard icon={Store} label="Clientes" value={stats.activos} loading={cargando} sub="Activos" />
                    <StatCard icon={ShieldCheck} label="Con NRC" value={stats.contribuyentes} loading={cargando} sub="Reciben Crédito Fiscal" />
                    <StatCard icon={ShieldAlert} label="Sin licencia" value={stats.sinLicencia} loading={cargando}
                        iconBg="bg-danger/10" iconCls="text-danger" valueCls={stats.sinLicencia ? 'text-danger-text' : undefined}
                        sub="Sin licencia, vencida o por vencer" active={soloSinLicencia} tono="danger"
                        onClick={() => setSoloSinLicencia(v => !v)} />
                    <StatCard icon={CreditCard} label="Con crédito" value={stats.credito} loading={cargando} sub="Plazo aprobado" />
                </CarrilCards>
                <FilterBar onClear={() => { setTipo(''); setSoloSinLicencia(false); }}
                    activeCount={[tipo, soloSinLicencia].filter(Boolean).length} acciones={acciones}>
                    <FilterBar.Section active={!!tipo} onClear={() => setTipo('')} label="tipo">
                        <FilterBar.Opciones options={TIPO_CLIENTE} value={tipo} onChange={v => setTipo(v || '')}
                            label="Tipo" icon={Store} placeholder="Tipo" />
                    </FilterBar.Section>
                </FilterBar>
            </div>

            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}

            <DataTable
                columns={COLS}
                movil={{ usarAccionDeFila: true }}
                loading={cargando}
                minWidth="320px"
                empty={buscar || tipo || soloSinLicencia
                    ? { icon: Search, message: 'Sin resultados', subtext: 'Ningún cliente coincide con la búsqueda o el filtro.' }
                    : { icon: Store, message: 'Sin clientes', subtext: puedeVender ? 'Agrega el primero con «Nuevo cliente».' : undefined }}
            >
                {pagina.map((c, i) => {
                    const lic = estadoLicencia(c, hoy);
                    return (
                        <DataRow key={c.id} index={i} onClick={() => abrir(c)}>
                            <DataCell>
                                <div className="min-w-0 max-w-[200px]">
                                    <p className="text-body-sm font-bold text-content-2 truncate" title={c.nombre}>{c.nombre}</p>
                                    <p className="text-caption text-content-3 truncate">
                                        {rotuloTipoCliente(c.tipo)}{c.gran_contribuyente ? ' · retiene 1%' : ''}{!c.activo ? ' · inactivo' : ''}
                                    </p>
                                </div>
                            </DataCell>
                            <DataCell hideBelow="md">
                                <div className="min-w-0">
                                    <p className="font-mono text-caption text-content-2 truncate">
                                        {c.tipo_documento === '36' ? formatearNit(c.num_documento) : (c.num_documento ?? '—')}
                                    </p>
                                    {c.nrc && <p className="font-mono text-caption text-content-3">NRC {formatearNrc(c.nrc)}</p>}
                                </div>
                            </DataCell>
                            <DataCell><Badge size="sm" variant={lic.variant}>{lic.label}</Badge></DataCell>
                            <DataCell hideBelow="lg">
                                <div className="min-w-0 max-w-[200px]">
                                    <p className="text-caption text-content-2 truncate">{c.ruta ?? '—'}</p>
                                    <p className="text-caption text-content-3 truncate">{ubicacionMH(c.departamento, c.municipio, c.distrito) ?? ''}</p>
                                </div>
                            </DataCell>
                            <DataCell align="right" hideBelow="sm">
                                {c.plazo_dias > 0
                                    ? <div><p className="tabular-nums font-bold text-content-2">{formatMoney(c.limite_credito)}</p>
                                        <p className="text-caption text-content-3">{c.plazo_dias} días</p></div>
                                    : <span className="text-caption text-content-3">Contado</span>}
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>

            {!cargando && filtrados.length > 0 && (
                <TablePagination pageSize={pageSize} onPageSizeChange={setPageSize} page={page}
                    totalPages={totalPages} onPageChange={setPage} total={filtrados.length} unit="clientes" />
            )}

            {abierto && (
                <ClienteModal cliente={abierto} emisorId={emisor?.id} puedeEditar={puedeVender}
                    onClose={() => setAbierto(null)} onGuardado={() => { setAbierto(null); cargar(); }} />
            )}
        </div>
    );
}
