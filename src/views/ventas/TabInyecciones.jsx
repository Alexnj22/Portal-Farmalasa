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
import { usePaginaEnUrl } from '../../plataforma/usePaginaEnUrl';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { fetchInyeccionesAplicadas } from '../../data/ventas';
import { shortEmployeeName } from '../../utils/nameUtils';
import { smartFilter } from '../../utils/searchUtils';
import { formatMoney, formatPct } from '../../utils/formatNumber';
import { exportCsv } from '../../utils/csvExport';
import { mensajeAmigable } from '../../utils/errorMessages';
import { hora12 } from '../../utils/hora';

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
 */

// Desde este día la aplicación se anota en el portal, con hora y persona. Antes
// se escribía directo en la caja y no hay con qué emparejarla.
const DESDE_EL_PORTAL = '2026-09-03';

const ESTADOS = [
    { value: 'todas', label: 'Todas' },
    { value: 'con',   label: 'Con cobro' },
    { value: 'sin',   label: 'Sin cobro' },
];

/* El período por defecto arranca el día en que la aplicación empezó a anotarse
 * en el portal, y no el 1.º del mes: antes de eso toda venta sale «sin cobro»
 * y el resumen mentiría. Cuando esa fecha quede a más de tres meses —el tope
 * de la función— se vuelve al mes en curso. */
function rangoPorDefecto() {
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/El_Salvador' });
    const [y, m] = hoy.split('-').map(Number);
    const limite = new Date(Date.UTC(y, m - 1, Number(hoy.slice(8)) - 90)).toISOString().slice(0, 10);
    const desde = DESDE_EL_PORTAL >= limite ? DESDE_EL_PORTAL : `${hoy.slice(0, 7)}-01`;
    return `${desde}|${hoy}`;
}

const nombre = (n) => (n ? shortEmployeeName(n) : '—');
const productosTexto = (v) => (v.productos || []).map((p) => p.descripcion).join(' · ');
const fechaCorta = (f) => {
    const [, m, d] = String(f).split('-');
    return `${d}/${m}`;
};

export default function TabInyecciones({
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

    const ventas = useMemo(() => datos?.ventas || [], [datos]);
    const sueltos = useMemo(() => datos?.cobros_sin_venta || [], [datos]);
    const nombreSala = useCallback(
        (id) => (branches || []).find((b) => b.id === id)?.name || '—',
        [branches],
    );

    const conCobro = useMemo(() => ventas.filter((v) => v.cobro), [ventas]);
    const pctCobrado = ventas.length ? (conCobro.length / ventas.length) * 100 : 0;
    const montoSueltos = sueltos.reduce((s, c) => s + Number(c.monto || 0), 0);

    const filtradas = useMemo(() => {
        let r = ventas;
        if (estado === 'con') r = r.filter((v) => v.cobro);
        if (estado === 'sin') r = r.filter((v) => !v.cobro);
        if (searchTerm?.trim()) {
            r = smartFilter(searchTerm, r, (v) => [
                v.correlativo, v.cliente, v.vendedor_nombre, productosTexto(v),
            ]).results;
        }
        return r;
    }, [ventas, estado, searchTerm]);

    const { page, pageSize, totalPages, setPage, setPageSize, resetPage } =
        usePaginaEnUrl({ total: filtradas.length, tamPorDefecto: 50 });
    useEffect(() => { resetPage(); }, [estado, searchTerm, fini, ffin, filterBranch]); // eslint-disable-line react-hooks/exhaustive-deps
    const pagina = filtradas.slice((page - 1) * pageSize, page * pageSize);

    // Por vendedor: quién vende inyecciones y a cuántas les cobra la aplicación.
    const porVendedor = useMemo(() => {
        const m = new Map();
        for (const v of ventas) {
            const k = v.cod_vendedor || '—';
            const a = m.get(k) || { cod: k, nombre: v.vendedor_nombre, ventas: 0, con: 0 };
            a.ventas += 1;
            if (v.cobro) a.con += 1;
            m.set(k, a);
        }
        return [...m.values()].sort((a, b) => b.ventas - a.ventas);
    }, [ventas]);

    const descargar = () => {
        exportCsv(
            ['FECHA', 'HORA', 'SUCURSAL', 'FACTURA', 'CLIENTE', 'PRODUCTOS', 'UNIDADES', 'TOTAL',
             'VENDEDOR', 'APLICACION COBRADA', 'HORA DEL COBRO', 'MONTO DEL COBRO', 'COBRO REGISTRADO POR'],
            filtradas.map((v) => [
                v.fecha, hora12(v.hora), nombreSala(v.branch_id), v.correlativo, v.cliente, productosTexto(v),
                v.unidades, v.total, nombre(v.vendedor_nombre),
                v.cobro ? 'SI' : 'NO', hora12(v.cobro?.hora), v.cobro?.monto ?? '',
                v.cobro ? nombre(v.cobro.registrado_nombre) : '',
            ]),
            `inyecciones_${fini}_${ffin}.csv`,
            'ventas',
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
                        value={loading ? '—' : conCobro.length.toLocaleString()}
                        iconBg="bg-success/10" iconCls="text-success"
                        sub={loading ? undefined : `${formatPct(pctCobrado)} de las ventas`}
                        active={estado === 'con'} tono="success"
                        onClick={() => setEstado((e) => (e === 'con' ? 'todas' : 'con'))}
                        loading={loading} />
                    <StatCard icon={CircleSlash} label="Sin cobro"
                        value={loading ? '—' : (ventas.length - conCobro.length).toLocaleString()}
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
                Cada venta se une con el cobro de «Aplicación de inyección» registrado cerca de su hora,
                el mismo día y en la misma sucursal. La hora de los dos y quién registró el cobro quedan
                a la vista para poder revisarlo.
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
                            <p className="font-semibold text-body">{nombre(r.nombre)}</p>
                            <p className="text-caption text-content-3">Cód. {r.cod}</p>
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
                        <DataCell hideBelow="md" className="text-body-sm">{nombre(v.vendedor_nombre)}</DataCell>
                        <DataCell>
                            {v.cobro ? (
                                <div>
                                    <Badge variant="success" size="sm" dot>Cobrada {formatMoney(v.cobro.monto)}</Badge>
                                    <p className="text-caption text-content-3 mt-1">
                                        {hora12(v.cobro.hora)} · {nombre(v.cobro.registrado_nombre)}
                                    </p>
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
                        ]}
                        minWidth="520px"
                        movil={{ identidad: 'detalle', ancla: 'monto', chips: ['fecha', 'por'] }}
                    >
                        {sueltos.map((c, i) => (
                            <DataRow key={c.id} index={i}>
                                <DataCell className="text-body-sm whitespace-nowrap">
                                    <p className="font-semibold">{fechaCorta(c.fecha)} · {hora12(c.hora)}</p>
                                    {!filterBranch && <p className="text-caption text-content-3">{nombreSala(c.branch_id)}</p>}
                                </DataCell>
                                <DataCell className="text-body-sm">{c.concepto}</DataCell>
                                <DataCell className="text-body-sm">{nombre(c.registrado_nombre)}</DataCell>
                                <DataCell align="right" className="font-semibold text-body-sm">{formatMoney(c.monto)}</DataCell>
                            </DataRow>
                        ))}
                    </DataTable>
                </div>
            )}
        </div>
    );
}
