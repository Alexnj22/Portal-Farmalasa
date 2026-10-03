import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, CheckCircle2, Download, Hourglass, Syringe } from 'lucide-react';
import Badge from '../../components/common/Badge';
import PersonaConFoto from '../../components/caja/PersonaConFoto';
import Notice from '../../components/common/Notice';
import StatCard from '../../components/common/StatCard';
import CarrilCards from '../../components/common/CarrilCards';
import FilterBar from '../../components/common/FilterBar';
import PeriodPicker from '../../components/common/PeriodPicker';
import TablePagination from '../../components/common/TablePagination';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { usePaginaEnUrl } from '../../plataforma/usePaginaEnUrl';
import { fetchBitacoraDeAplicaciones } from '@nucleo/data/inyecciones';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fmtMl } from '@nucleo/utils/inyeccionDosis';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { exportCsv } from '@nucleo/utils/csvExport';
import { hoySV } from '@nucleo/utils/fecha';
import { fechaHora12 } from '@nucleo/utils/hora';

/*
 * La bitácora de aplicaciones: UNA fila por aplicación pagada, con quién la
 * cobró, quién la aplicó, cuándo y en qué sala.
 *
 * Es el registro que no existía: hasta el 2026-10-02 lo único que quedaba de
 * una aplicación era un ingreso de caja con un texto libre, y la pestaña de
 * Ventas adivinaba a qué venta iba. Ahora cada aplicación se asigna a su venta
 * al cobrarse, así que esto es un hecho y no una estimación.
 *
 * El período es el del COBRO: lo pagado en el rango, se haya aplicado o no.
 *
 * Quién cobró y quién aplicó van con su FOTO (pedido del usuario, 2026-10-03:
 * «mejora visualmente la bitácora, foto del empleado, que se sienta más
 * moderno»), y la venta dice de qué sala es cuando no es la del cobro.
 */

const ESTADOS = [
    { value: 'todas',      label: 'Todas' },
    { value: 'APLICADA',   label: 'Aplicadas' },
    { value: 'PENDIENTE',  label: 'Pendientes' },
];

function rangoPorDefecto() {
    const hoy = hoySV();
    const [y, m, d] = hoy.split('-').map(Number);
    const desde = new Date(Date.UTC(y, m - 1, d - 30)).toISOString().slice(0, 10);
    return `${desde}|${hoy}`;
}

const horaDe = (ts) => (ts ? fechaHora12(ts) : '—');
const nombre = (n) => (n ? shortEmployeeName(n) : '—');
const factura = (c) => String(c || '').replace(/^0+/, '');

export default function TabBitacora({ filterBranch, setFilterBranch, branchOptions, branchLocked, searchTerm }) {
    const defaultRange = useMemo(() => rangoPorDefecto(), []);
    const [monthRange, setMonthRange] = useState(defaultRange);
    const [estado, setEstado] = useState('todas');
    const [filas, setFilas] = useState(null);
    const [error, setError] = useState(null);
    const genRef = useRef(0);
    const [desde, hasta] = monthRange.split('|');

    const cargar = useCallback(async () => {
        const gen = ++genRef.current;
        setFilas(null);
        try {
            const d = await fetchBitacoraDeAplicaciones({ sala: filterBranch || null, desde, hasta, buscar: searchTerm });
            if (gen === genRef.current) { setFilas(d); setError(null); }
        } catch (e) {
            if (gen === genRef.current) { setFilas([]); setError(mensajeAmigable(e, 'No se pudo cargar la bitácora')); }
        }
    }, [filterBranch, desde, hasta, searchTerm]);
    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga al cambiar filtros

    const visibles = useMemo(
        () => (filas || []).filter((f) => estado === 'todas' || f.estado === estado),
        [filas, estado],
    );
    const aplicadas = (filas || []).filter((f) => f.estado === 'APLICADA').length;
    const monto = (filas || []).reduce((s, f) => s + Number(f.precio || 0), 0);

    const { page, pageSize, totalPages, setPage, setPageSize, resetPage } =
        usePaginaEnUrl({ total: visibles.length, tamPorDefecto: 50 });
    useEffect(() => { resetPage(); }, [estado, searchTerm, desde, hasta, filterBranch]); // eslint-disable-line react-hooks/exhaustive-deps
    const pagina = visibles.slice((page - 1) * pageSize, page * pageSize);

    const descargar = () => exportCsv(
        ['COBRADA', 'SALA', 'ORIGEN', 'FACTURA', 'VENTA DE', 'CLIENTE', 'INYECCION', 'PRECIO', 'COBRADA POR',
         'ESTADO', 'APLICADA', 'APLICADA POR', 'APLICADA EN'],
        visibles.map((f) => [
            horaDe(f.cobrada_at), f.sala, f.origen === 'TRAIDA' ? 'TRAIDA' : 'COMPRADA', factura(f.correlativo), f.venta_sala || '',
            f.cliente || '', f.dosis_ml != null ? `${f.producto} (${fmtMl(f.dosis_ml)} ml)` : f.producto, f.precio, nombre(f.cobrada_por),
            f.estado, f.aplicada_at ? horaDe(f.aplicada_at) : '', f.aplicada_por ? nombre(f.aplicada_por) : '',
            f.aplicada_en || '',
        ]),
        `aplicaciones_${desde}_${hasta}.csv`,
        'inyecciones',
    );

    const dateDirty = monthRange !== defaultRange;

    return (
        <div className="p-4 md:p-6 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen de la bitácora">
                    <StatCard icon={Syringe} label="Aplicaciones pagadas"
                        value={filas == null ? '—' : filas.length.toLocaleString()}
                        sub={filas == null ? undefined : `${formatMoney(monto)} cobrados`} loading={filas == null}
                        active={estado === 'todas'} onClick={() => setEstado('todas')} />
                    <StatCard icon={CheckCircle2} label="Aplicadas" tono="success"
                        value={filas == null ? '—' : aplicadas.toLocaleString()}
                        iconBg="bg-success/10" iconCls="text-success" loading={filas == null}
                        active={estado === 'APLICADA'} onClick={() => setEstado((e) => (e === 'APLICADA' ? 'todas' : 'APLICADA'))} />
                    <StatCard icon={Hourglass} label="Pendientes" tono="warning"
                        value={filas == null ? '—' : (filas.length - aplicadas).toLocaleString()}
                        iconBg="bg-warning/10" iconCls="text-warning" valueCls="text-warning-text" loading={filas == null}
                        active={estado === 'PENDIENTE'} onClick={() => setEstado((e) => (e === 'PENDIENTE' ? 'todas' : 'PENDIENTE'))} />
                </CarrilCards>
                <div className="flex justify-end min-w-0">
                    <FilterBar
                        onClear={() => { if (!branchLocked) setFilterBranch(''); setMonthRange(defaultRange); setEstado('todas'); }}
                        activeCount={[!branchLocked && filterBranch, dateDirty, estado !== 'todas'].filter(Boolean).length}
                        acciones={[{
                            key: 'descargar', icon: Download, label: 'Descargar', soloIcono: true, principal: false,
                            onClick: descargar, disabled: !visibles.length,
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
                        <FilterBar.Section active={estado !== 'todas'} onClear={() => setEstado('todas')} label="estado">
                            <FilterBar.Opciones options={ESTADOS} value={estado} onChange={setEstado} label="Estado" />
                        </FilterBar.Section>
                    </FilterBar>
                </div>
            </div>

            {error && <Notice variant="danger">{error}</Notice>}

            <DataTable
                columns={[
                    { key: 'cobro',    label: 'Cobró' },
                    { key: 'cliente',  label: 'Cliente' },
                    { key: 'producto', label: 'Inyección' },
                    { key: 'precio',   label: 'Precio', align: 'right', hideBelow: 'md' },
                    { key: 'estado',   label: 'Aplicación' },
                ]}
                loading={filas == null}
                skeletonRows={8}
                empty={{ icon: BookOpen, message: 'Sin aplicaciones en este período' }}
                minWidth="820px"
                movil={{ identidad: 'cliente', ancla: 'estado', chips: ['producto', 'cobro'] }}
            >
                {pagina.map((f, i) => (
                    <DataRow key={f.id} index={i}>
                        <DataCell>
                            <PersonaConFoto id={f.cobrada_por_id} nombre={f.cobrada_por}
                                detalle={`${horaDe(f.cobrada_at)}${!filterBranch ? ` · ${f.sala}` : ''}`} />
                        </DataCell>
                        <DataCell className="text-body-sm">
                            <p className="font-semibold text-content">{f.cliente || 'Sin nombre'}</p>
                            <p className="text-caption text-content-3 flex flex-wrap items-center gap-1.5 mt-0.5">
                                {f.origen === 'TRAIDA'
                                    ? <Badge variant="neutral" size="sm">Traída por el cliente</Badge>
                                    : <span>Factura {factura(f.correlativo)}</span>}
                                {f.venta_sala && <Badge variant="info" size="sm">Venta de {f.venta_sala}</Badge>}
                                {f.asignada_a_mano && <Badge variant="neutral" size="sm">Asignada después</Badge>}
                            </p>
                        </DataCell>
                        <DataCell className="text-body-sm">
                            <p className="text-content">{f.producto}</p>
                            {(f.dosis_ml != null || f.mezclada) && (
                                <p className="flex flex-wrap gap-1.5 mt-1">
                                    {/* La dosis, para quien la aplique (se cobró por ml). */}
                                    {f.dosis_ml != null && <Badge variant="info" size="sm">{fmtMl(f.dosis_ml)} ml por aplicación</Badge>}
                                    {f.mezclada && <Badge variant="info" size="sm">Mezcladas · una aplicación</Badge>}
                                </p>
                            )}
                        </DataCell>
                        <DataCell align="right" hideBelow="md" className="text-body-sm font-semibold tabular-nums">{formatMoney(f.precio)}</DataCell>
                        <DataCell>
                            {f.estado === 'APLICADA' ? (
                                <div className="space-y-1.5">
                                    <Badge variant="success" size="sm" dot>Aplicada</Badge>
                                    <PersonaConFoto id={f.aplicada_por_id} nombre={f.aplicada_por} px={22}
                                        detalle={`${horaDe(f.aplicada_at)}${f.aplicada_en && f.aplicada_en !== f.sala ? ` · en ${f.aplicada_en}` : ''}`} />
                                </div>
                            ) : (
                                <Badge variant="warning" size="sm" dot>Pendiente</Badge>
                            )}
                        </DataCell>
                    </DataRow>
                ))}
            </DataTable>
            {filas != null && visibles.length > 0 && (
                <TablePagination
                    page={page} totalPages={totalPages} onPageChange={setPage}
                    pageSize={pageSize} onPageSizeChange={setPageSize}
                    total={(filas || []).length} filteredTotal={visibles.length} unit="aplicaciones"
                />
            )}
        </div>
    );
}
