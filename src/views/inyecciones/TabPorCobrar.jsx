import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Syringe, CheckCircle2, CircleSlash, HandCoins, Users, Download, Info } from 'lucide-react';
import Notice from '../../components/common/Notice';
import Badge from '../../components/common/Badge';
import StatCard from '../../components/common/StatCard';
import CarrilCards from '../../components/common/CarrilCards';
import FilterBar from '../../components/common/FilterBar';
import PeriodPicker from '../../components/common/PeriodPicker';
import TablePagination from '../../components/common/TablePagination';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import Button from '../../components/common/Button';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import { usePaginaEnUrl } from '../../plataforma/usePaginaEnUrl';
import AsignarCobroModal from './AsignarCobroModal';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import { desvincularCobro } from '@nucleo/data/inyecciones';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { fetchInyeccionesAplicadas } from '@nucleo/data/ventas';
import { formatMoney, formatPct } from '@nucleo/utils/formatNumber';
import {
    DESDE_EL_PORTAL, ESTADOS_DE_COBRO as ESTADOS, CABECERA_CSV_POR_COBRAR, filasCsvPorCobrar, filtrarVentasDeInyeccion,
    nombreDeCobro as nombre, porVendedorDeInyecciones, rangoPorDefecto, resumenPorCobrar,
} from '@nucleo/utils/inyeccionesPorCobrar';
import { exportCsv } from '@nucleo/utils/csvExport';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { hora12 } from '@nucleo/utils/hora';
import { fechaNumerica } from '@nucleo/utils/fecha';

/*
 * «¿A quién se le cobró la aplicación?» — las ventas con inyección del período
 * y, al lado, el cobro de caja que les corresponde.
 *
 * El cruce lo hace la base (`get_inyecciones_aplicadas`), por HORA: la venta y
 * el movimiento de caja no se nombran entre sí. Por eso la pantalla muestra la
 * hora de los dos y quién registró el cobro — es la evidencia del emparejado, y
 * sin ella «Cobrada» sería una afirmación que nadie puede revisar.
 *
 * Los cobros que no encontraron venta se muestran aparte y NO se esconden: casi
 * siempre son de alguien que trajo su inyección o la compró otro día, y sumarlos
 * o callarlos cambiaría la respuesta a la pregunta de la pestaña.
 *
 * Desde el 2026-10-02 el cobro se ASIGNA a la venta al cobrarse (Mi caja →
 * Aplicación de inyección) y el cruce por hora queda sólo para lo de antes y lo
 * que se cobró suelto. Cada venta dice cuál le tocó (`vinculo`): «registrado»
 * es un hecho, «estimado» es una suposición y se muestra como tal.
 */

// El período por defecto, el resumen, el filtro y el CSV salen del núcleo
// (`inyeccionesPorCobrar`): la app cuenta igual.
const fechaCorta = (f) => fechaNumerica(f, { anio: false });

export default function TabPorCobrar({
    filterBranch, setFilterBranch, branchOptions, branchLocked, searchTerm,
}) {
    // Período PROPIO y no el de las otras pestañas de Ventas: ahí el defecto es
    // el mes en curso, y acá es desde que existe el registro (ver arriba).
    const defaultRange = useMemo(() => rangoPorDefecto(), []);
    const [monthRange, setMonthRange] = useState(defaultRange);
    const branches = useStaff((s) => s.branches);
    const [datos, setDatos] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [estado, setEstado] = useState('todas');
    const [asignando, setAsignando] = useState(null);
    const { hasPermission } = useAuth();
    const puedeAsignar = hasPermission('inyecciones_dosis');
    const showToast = useToastStore((s) => s.showToast);
    const genRef = useRef(0);
    const [fini, ffin] = monthRange.split('|');

    const cargar = useCallback(async () => {
        const gen = ++genRef.current;
        setLoading(true);
        setError(null);
        try {
            const d = await fetchInyeccionesAplicadas({ fini, ffin, branchId: filterBranch || null });
            if (gen !== genRef.current) return;
            setDatos(d);
        } catch (err) {
            if (gen !== genRef.current) return;
            setError(mensajeAmigable(err, 'No se pudieron cargar las inyecciones'));
            setDatos(null);
        } finally {
            if (gen === genRef.current) setLoading(false);
        }
    }, [fini, ffin, filterBranch]);

    useEffect(() => { cargar(); }, [cargar]);
    const recargar = () => { cargar(); };

    const desasignar = async (v) => {
        try {
            await desvincularCobro(v.cobro.id);
            useStaffStore.getState().appendAuditLog('INYECCION_COBRO_DESASIGNADO', String(v.cobro.id), { venta: v.id });
            showToast('Asignación deshecha', 'Vuelve a la lista de cobros sin venta.', 'success');
            recargar();
        } catch (e) {
            showToast('No se pudo deshacer la asignación', mensajeAmigable(e), 'error');
        }
    };

    const ventas = useMemo(() => datos?.ventas || [], [datos]);
    const sueltos = useMemo(() => datos?.cobros_sin_venta || [], [datos]);
    const nombreSala = useCallback(
        (id) => (branches || []).find((b) => b.id === id)?.name || '—',
        [branches],
    );

    const resumen = useMemo(() => resumenPorCobrar(datos), [datos]);
    const pctCobrado = resumen.pct;
    const montoSueltos = resumen.montoSueltos;

    const filtradas = useMemo(() => filtrarVentasDeInyeccion(ventas, estado, searchTerm), [ventas, estado, searchTerm]);

    const { page, pageSize, totalPages, setPage, setPageSize, resetPage } =
        usePaginaEnUrl({ total: filtradas.length, tamPorDefecto: 50 });
    useEffect(() => { resetPage(); }, [estado, searchTerm, fini, ffin, filterBranch]); // eslint-disable-line react-hooks/exhaustive-deps
    const pagina = filtradas.slice((page - 1) * pageSize, page * pageSize);

    // Por vendedor: quién vende inyecciones y a cuántas les cobra la aplicación.
    const porVendedor = useMemo(() => porVendedorDeInyecciones(ventas), [ventas]);

    const descargar = () => {
        exportCsv(
            CABECERA_CSV_POR_COBRAR,
            filasCsvPorCobrar(filtradas, nombreSala),
            `inyecciones_${fini}_${ffin}.csv`,
            'inyecciones',
        );
    };

    const sinHistorial = fini < DESDE_EL_PORTAL;
    const dateDirty = monthRange !== defaultRange;

    return (
        <div className="p-4 md:p-6 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen de inyecciones">
                    <StatCard icon={Syringe} label="Ventas con inyección"
                        value={loading ? '—' : ventas.length.toLocaleString()}
                        sub="Facturas del período" loading={loading} />
                    <StatCard icon={CheckCircle2} label="Con cobro de aplicación"
                        value={loading ? '—' : resumen.con.toLocaleString()}
                        iconBg="bg-success/10" iconCls="text-success"
                        sub={loading ? undefined : `${formatPct(pctCobrado)} de las ventas`}
                        active={estado === 'con'} tono="success"
                        onClick={() => setEstado((e) => (e === 'con' ? 'todas' : 'con'))}
                        loading={loading} />
                    <StatCard icon={CircleSlash} label="Sin cobro"
                        value={loading ? '—' : (ventas.length - resumen.con).toLocaleString()}
                        iconBg="bg-warning/10" iconCls="text-warning" valueCls="text-warning-text"
                        sub="No se encontró su cobro"
                        active={estado === 'sin'} tono="warning"
                        onClick={() => setEstado((e) => (e === 'sin' ? 'todas' : 'sin'))}
                        loading={loading} />
                    <StatCard icon={HandCoins} label="Cobros sin venta"
                        value={loading ? '—' : sueltos.length.toLocaleString()}
                        sub={loading ? undefined : `${formatMoney(montoSueltos)} cobrados`}
                        loading={loading} />
                </CarrilCards>
                <div className="flex justify-end min-w-0">
                    <FilterBar
                        onClear={() => {
                            if (!branchLocked) setFilterBranch('');
                            setMonthRange(defaultRange);
                            setEstado('todas');
                        }}
                        activeCount={[!branchLocked && filterBranch, dateDirty, estado !== 'todas'].filter(Boolean).length}
                        acciones={[{
                            key: 'descargar', icon: Download, label: 'Descargar',
                            soloIcono: true, principal: false,
                            onClick: descargar, disabled: loading || !filtradas.length,
                        }]}
                    >
                        {!branchLocked && (
                            <FilterBar.Section active={!!filterBranch} onClear={() => setFilterBranch('')} label="sucursal">
                                <FilterBar.Sucursal value={filterBranch} onChange={setFilterBranch} options={branchOptions} />
                            </FilterBar.Section>
                        )}
                        <FilterBar.Section active={dateDirty} onClear={() => setMonthRange(defaultRange)} label="fecha">
                            <PeriodPicker value={monthRange} onChange={setMonthRange} />
                        </FilterBar.Section>
                        <FilterBar.Section active={estado !== 'todas'} onClear={() => setEstado('todas')} label="cobro">
                            <FilterBar.Opciones options={ESTADOS} value={estado} onChange={setEstado} label="Cobro" />
                        </FilterBar.Section>
                    </FilterBar>
                </div>
            </div>

            {sinHistorial && (
                <Notice variant="warning" icon={Info}>
                    Antes del 3 de septiembre la aplicación no se registraba en el portal: las ventas
                    anteriores a esa fecha aparecen «sin cobro» aunque se hayan cobrado.
                </Notice>
            )}
            {error && <Notice variant="danger">{error}</Notice>}

            <Notice variant="info" icon={Info}>
                El cobro de la aplicación se asigna a su venta al cobrarse. Los cobros de antes, o los que
                se cobraron sin venta, se unen por hora con la venta más cercana del mismo día y sucursal, y
                se marcan <b>estimado</b>: la hora de los dos y quién cobró quedan a la vista para revisarlo.
            </Notice>

            {/* ── Por vendedor ─────────────────────────────────────────── */}
            <DataTable
                columns={[
                    { key: 'vendedor', label: 'Vendedor' },
                    { key: 'ventas',   label: 'Ventas con inyección', align: 'right' },
                    { key: 'con',      label: 'Con cobro', align: 'right' },
                    { key: 'sin',      label: 'Sin cobro', align: 'right' },
                    { key: 'pct',      label: '% cobrado', align: 'right' },
                ]}
                loading={loading}
                skeletonRows={4}
                empty={{ icon: Users, message: 'Sin ventas de inyecciones en este período' }}
                minWidth="520px"
                movil={{ identidad: 'vendedor', ancla: 'pct', chips: ['ventas', 'sin'] }}
            >
                {porVendedor.map((r, i) => (
                    <DataRow key={r.cod} index={i}>
                        <DataCell>
                            <div className="flex items-center gap-2.5">
                                {r.nombre && <AvatarConEstado emp={{ id: r.id, name: r.nombre }} px={32} radio="rounded-full" marco="" />}
                                <div>
                                    <p className="font-semibold text-body">{nombre(r.nombre)}</p>
                                    <p className="text-caption text-content-3">Cód. {r.cod}</p>
                                </div>
                            </div>
                        </DataCell>
                        <DataCell align="right" className="font-semibold text-body-sm">{r.ventas}</DataCell>
                        <DataCell align="right" className="text-body-sm text-success-text font-semibold">{r.con}</DataCell>
                        <DataCell align="right" className="text-body-sm text-warning-text font-semibold">{r.ventas - r.con}</DataCell>
                        <DataCell align="right" className="font-black text-body">{formatPct((r.con / r.ventas) * 100)}</DataCell>
                    </DataRow>
                ))}
            </DataTable>

            {/* ── Detalle venta por venta ──────────────────────────────── */}
            <DataTable
                columns={[
                    { key: 'fecha',    label: 'Fecha' },
                    { key: 'factura',  label: 'Factura', hideBelow: 'md' },
                    { key: 'cliente',  label: 'Cliente' },
                    { key: 'producto', label: 'Inyección' },
                    { key: 'vendedor', label: 'Vendedor', hideBelow: 'md' },
                    { key: 'cobro',    label: 'Aplicación' },
                ]}
                loading={loading}
                skeletonRows={8}
                empty={{ icon: Syringe, message: estado === 'todas' ? 'Sin ventas de inyecciones en este período' : 'Ninguna venta con ese filtro' }}
                minWidth="860px"
                movil={{ identidad: 'cliente', ancla: 'cobro', chips: ['fecha', 'producto'] }}
            >
                {pagina.map((v, i) => (
                    <DataRow key={v.id} index={i}>
                        <DataCell className="text-body-sm whitespace-nowrap">
                            <p className="font-semibold">{fechaCorta(v.fecha)} · {hora12(v.hora)}</p>
                            {!filterBranch && <p className="text-caption text-content-3">{nombreSala(v.branch_id)}</p>}
                        </DataCell>
                        <DataCell hideBelow="md" className="text-body-sm font-mono">{String(v.correlativo || '').replace(/^0+/, '')}</DataCell>
                        <DataCell className="text-body-sm">{v.cliente || '—'}</DataCell>
                        <DataCell className="text-body-sm">
                            {(v.productos || []).map((p, k) => (
                                <p key={k}>
                                    <span className="font-semibold">{Number(p.cantidad)}×</span> {p.descripcion}
                                </p>
                            ))}
                        </DataCell>
                        <DataCell hideBelow="md" className="text-body-sm">
                            {v.vendedor_nombre ? (
                                <span className="inline-flex items-center gap-2">
                                    <AvatarConEstado emp={{ id: v.vendedor_id, name: v.vendedor_nombre }} px={24} radio="rounded-full" marco="" />
                                    {nombre(v.vendedor_nombre)}
                                </span>
                            ) : '—'}
                        </DataCell>
                        <DataCell>
                            {v.cobro ? (
                                <div>
                                    <Badge variant={v.vinculo === 'estimado' ? 'neutral' : 'success'} size="sm" dot>
                                        Cobrada {formatMoney(v.cobro.monto)}{v.vinculo === 'estimado' ? ' · estimado' : ''}
                                    </Badge>
                                    <p className="text-caption text-content-3 mt-1">
                                        {hora12(v.cobro.hora)} · {nombre(v.cobro.registrado_nombre)}
                                    </p>
                                    {v.vinculo !== 'estimado' && Number(v.dosis) > 1 && (
                                        <p className="text-caption text-content-2">
                                            {v.pagadas} de {v.dosis} pagadas · {v.aplicadas} aplicadas
                                        </p>
                                    )}
                                    {v.vinculo === 'a_mano' && puedeAsignar && (
                                        <Button variant="ghost" size="sm" onClick={() => desasignar(v)}>Deshacer asignación</Button>
                                    )}
                                </div>
                            ) : (
                                <Badge variant="warning" size="sm" dot>Sin cobro</Badge>
                            )}
                        </DataCell>
                    </DataRow>
                ))}
            </DataTable>
            {!loading && filtradas.length > 0 && (
                <TablePagination
                    page={page} totalPages={totalPages} onPageChange={setPage}
                    pageSize={pageSize} onPageSizeChange={setPageSize}
                    total={ventas.length} filteredTotal={filtradas.length} unit="ventas"
                />
            )}

            {/* ── Cobros que no encontraron venta ─────────────────────── */}
            {!loading && sueltos.length > 0 && (
                <div className="space-y-2">
                    <div>
                        <h3 className="text-title-sm font-black text-content">Cobros de aplicación sin venta</h3>
                        <p className="text-body-sm text-content-3">
                            No hay una venta de inyección cerca de su hora. Casi siempre es alguien que trajo su
                            inyección o la compró otro día.
                        </p>
                    </div>
                    <DataTable
                        columns={[
                            { key: 'fecha',   label: 'Fecha' },
                            { key: 'detalle', label: 'Detalle' },
                            { key: 'por',     label: 'Registrado por' },
                            { key: 'monto',   label: 'Monto', align: 'right' },
                            ...(puedeAsignar ? [{ key: 'accion', label: '' }] : []),
                        ]}
                        minWidth="520px"
                        movil={{ identidad: 'detalle', ancla: 'monto', chips: ['fecha', 'por'], acciones: true }}
                    >
                        {sueltos.map((c, i) => (
                            <DataRow key={c.id} index={i}>
                                <DataCell className="text-body-sm whitespace-nowrap">
                                    <p className="font-semibold">{fechaCorta(c.fecha)} · {hora12(c.hora)}</p>
                                    {!filterBranch && <p className="text-caption text-content-3">{nombreSala(c.branch_id)}</p>}
                                </DataCell>
                                <DataCell className="text-body-sm">
                                    {c.concepto}
                                    {c.origen === 'TRAIDA' && <Badge variant="neutral" size="sm" className="ml-2">Traída</Badge>}
                                </DataCell>
                                <DataCell className="text-body-sm">{nombre(c.registrado_nombre)}</DataCell>
                                <DataCell align="right" className="font-semibold text-body-sm">{formatMoney(c.monto)}</DataCell>
                                {puedeAsignar && (
                                    <DataCell align="right">
                                        {c.origen !== 'TRAIDA' && (
                                            <Button variant="secondary" size="sm" onClick={() => setAsignando(c)}>Asignar</Button>
                                        )}
                                    </DataCell>
                                )}
                            </DataRow>
                        ))}
                    </DataTable>
                </div>
            )}

            {asignando && (
                <AsignarCobroModal cobro={asignando} onClose={() => setAsignando(null)}
                    onHecho={() => { setAsignando(null); recargar(); }} />
            )}
        </div>
    );
}
