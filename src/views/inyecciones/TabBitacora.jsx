import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, CheckCircle2, Download, Hourglass, Pin, Syringe, X } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import PersonaConFoto from '../../components/caja/PersonaConFoto';
import Notice from '../../components/common/Notice';
import StatCard from '../../components/common/StatCard';
import CarrilCards from '../../components/common/CarrilCards';
import FilterBar from '../../components/common/FilterBar';
import PeriodPicker from '../../components/common/PeriodPicker';
import TablePagination from '../../components/common/TablePagination';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { usePaginaEnUrl } from '../../plataforma/usePaginaEnUrl';
import { buscarBitacoraDeAplicaciones } from '@nucleo/data/inyecciones';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fmtMl } from '@nucleo/utils/inyeccionDosis';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { exportCsv } from '@nucleo/utils/csvExport';
import { hoySV } from '@nucleo/utils/fecha';
import {
    CABECERA_CSV_BITACORA, CAMPOS_DE_BUSQUEDA_BITACORA, ESTADOS_BITACORA, agregarFiltroDeBitacora, filasCsvBitacora,
    filtrosEfectivosDeBitacora, quitarFiltroDeBitacora, rotuloDeFiltroDeBitacora,
} from '@nucleo/utils/inyeccionesPendientes';
import { fechaTexto } from '@nucleo/utils/fecha';
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
 * Buscar va más allá de los 30 días (pedido del usuario, 2026-10-17): con
 * algún filtro y sin un período elegido, se busca en TODO el historial, por
 * páginas que pide la base. Lo escrito se puede FIJAR como filtro de un campo
 * —cliente, medicamento, vendedor, factura— y los fijados se suman.
 *
 * Quién cobró y quién aplicó van con su FOTO (pedido del usuario, 2026-10-03:
 * «mejora visualmente la bitácora, foto del empleado, que se sienta más
 * moderno»), y la venta dice de qué sala es cuando no es la del cobro.
 */

const ESTADOS = ESTADOS_BITACORA;

function rangoPorDefecto() {
    const hoy = hoySV();
    const [y, m, d] = hoy.split('-').map(Number);
    const desde = new Date(Date.UTC(y, m - 1, d - 30)).toISOString().slice(0, 10);
    return `${desde}|${hoy}`;
}

const horaDe = (ts) => (ts ? fechaHora12(ts) : '—');
const factura = (c) => String(c || '').replace(/^0+/, '');

export default function TabBitacora({ filterBranch, setFilterBranch, branchOptions, branchLocked, searchTerm, limpiarBusqueda }) {
    const defaultRange = useMemo(() => rangoPorDefecto(), []);
    const [monthRange, setMonthRange] = useState(defaultRange);
    const [estado, setEstado] = useState('todas');
    const [fijados, setFijados] = useState([]);
    const [res, setRes] = useState(null);
    const [error, setError] = useState(null);
    const genRef = useRef(0);
    const dateDirty = monthRange !== defaultRange;
    const filtros = useMemo(() => filtrosEfectivosDeBitacora(fijados, searchTerm), [fijados, searchTerm]);
    // Con un filtro y sin período elegido, todo el historial: lo acota el filtro.
    const todoElHistorial = filtros.length > 0 && !dateDirty;
    const [desde, hasta] = todoElHistorial ? [null, null] : monthRange.split('|');

    const total = res?.total_filtrado ?? 0;
    const { page, pageSize, totalPages, setPage, setPageSize, resetPage } =
        usePaginaEnUrl({ total, tamPorDefecto: 50 });
    const claveFiltros = JSON.stringify(filtros);
    useEffect(() => { resetPage(); }, [estado, claveFiltros, desde, hasta, filterBranch]); // eslint-disable-line react-hooks/exhaustive-deps

    const pedir = useCallback((extra) => buscarBitacoraDeAplicaciones({
        sala: filterBranch || null, desde, hasta, filtros, estado, ...extra,
    }), [filterBranch, desde, hasta, filtros, estado]);

    const cargar = useCallback(async () => {
        const gen = ++genRef.current;
        setRes(null);
        try {
            const d = await pedir({ limite: pageSize, offset: (page - 1) * pageSize });
            if (gen === genRef.current) { setRes(d); setError(null); }
        } catch (e) {
            if (gen === genRef.current) { setRes({ filas: [], total: 0, aplicadas: 0, monto: 0, total_filtrado: 0 }); setError(mensajeAmigable(e, 'No se pudo cargar la bitácora')); }
        }
    }, [pedir, page, pageSize]);
    useEffect(() => { cargar(); }, [cargar]);

    const pagina = res?.filas || [];
    const cargando = res == null;
    const aplicadas = res?.aplicadas ?? 0;

    const fijar = (campo) => { setFijados((f) => agregarFiltroDeBitacora(f, campo, searchTerm)); limpiarBusqueda?.(); };

    // El CSV es el conjunto entero que se está viendo, no la página.
    const [bajando, setBajando] = useState(false);
    const descargar = async () => {
        setBajando(true);
        try {
            const d = await pedir({ limite: 5000, offset: 0 });
            exportCsv(CABECERA_CSV_BITACORA, filasCsvBitacora(d.filas), `aplicaciones_${desde || 'historial'}_${hasta || hoySV()}.csv`, 'inyecciones');
        } catch (e) {
            setError(mensajeAmigable(e, 'No se pudo descargar'));
        } finally { setBajando(false); }
    };

    return (
        <div className="p-4 md:p-6 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen de la bitácora">
                    <StatCard icon={Syringe} label="Aplicaciones pagadas"
                        value={cargando ? '—' : res.total.toLocaleString()}
                        sub={cargando ? undefined : `${formatMoney(res.monto)} cobrados`} loading={cargando}
                        active={estado === 'todas'} onClick={() => setEstado('todas')} />
                    <StatCard icon={CheckCircle2} label="Aplicadas" tono="success"
                        value={cargando ? '—' : aplicadas.toLocaleString()}
                        iconBg="bg-success/10" iconCls="text-success" loading={cargando}
                        active={estado === 'APLICADA'} onClick={() => setEstado((e) => (e === 'APLICADA' ? 'todas' : 'APLICADA'))} />
                    <StatCard icon={Hourglass} label="Pendientes" tono="warning"
                        value={cargando ? '—' : (res.total - aplicadas).toLocaleString()}
                        iconBg="bg-warning/10" iconCls="text-warning" valueCls="text-warning-text" loading={cargando}
                        active={estado === 'PENDIENTE'} onClick={() => setEstado((e) => (e === 'PENDIENTE' ? 'todas' : 'PENDIENTE'))} />
                </CarrilCards>
                <div className="flex justify-end min-w-0">
                    <FilterBar
                        onClear={() => { if (!branchLocked) setFilterBranch(''); setMonthRange(defaultRange); setEstado('todas'); setFijados([]); }}
                        activeCount={[!branchLocked && filterBranch, dateDirty, estado !== 'todas'].filter(Boolean).length}
                        acciones={[{
                            key: 'descargar', icon: Download, label: 'Descargar', soloIcono: true, principal: false,
                            onClick: descargar, disabled: !total || bajando,
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

            {(searchTerm?.trim() || fijados.length > 0) && (
                <div className="flex flex-wrap items-center gap-2" aria-label="Filtros de la búsqueda">
                    {fijados.map((f, i) => (
                        <Button key={`${f.campo}-${f.texto}`} size="xs" variant="secondary" icon={X}
                            title={`Quitar ${rotuloDeFiltroDeBitacora(f)}`}
                            onClick={() => setFijados((l) => quitarFiltroDeBitacora(l, i))}>
                            {rotuloDeFiltroDeBitacora(f)}
                        </Button>
                    ))}
                    {searchTerm?.trim() && (
                        <>
                            <span className="text-caption text-content-3 inline-flex items-center gap-1">
                                <Pin size={12} /> Fijar «{searchTerm.trim()}» como
                            </span>
                            {CAMPOS_DE_BUSQUEDA_BITACORA.filter((c) => c.id !== 'todo').map((c) => (
                                <Button key={c.id} size="xs" variant="ghost" onClick={() => fijar(c.id)}>{c.label}</Button>
                            ))}
                        </>
                    )}
                    {todoElHistorial && !cargando && (
                        <span className="text-caption text-content-3">
                            · en todo el historial{res?.desde ? ` (desde ${fechaTexto(res.desde)})` : ''}
                        </span>
                    )}
                </div>
            )}

            {error && <Notice variant="danger">{error}</Notice>}

            <DataTable
                columns={[
                    { key: 'cobro',    label: 'Cobró' },
                    { key: 'cliente',  label: 'Cliente' },
                    { key: 'producto', label: 'Inyección' },
                    { key: 'precio',   label: 'Precio', align: 'right', hideBelow: 'md' },
                    { key: 'estado',   label: 'Aplicación' },
                ]}
                loading={cargando}
                skeletonRows={8}
                empty={{ icon: BookOpen, message: filtros.length ? 'Ninguna aplicación cumple esos filtros' : 'Sin aplicaciones en este período' }}
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
            {!cargando && total > 0 && (
                <TablePagination
                    page={page} totalPages={totalPages} onPageChange={setPage}
                    pageSize={pageSize} onPageSizeChange={setPageSize}
                    total={res.total} filteredTotal={total} unit="aplicaciones"
                />
            )}
        </div>
    );
}
