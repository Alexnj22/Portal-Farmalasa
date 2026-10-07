import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Plus, Boxes, Search, AlertTriangle, CalendarClock, CalendarX2, Loader2, Save, History, PackagePlus, Coins, ShieldAlert } from 'lucide-react';
import { formatMoney } from '@nucleo/utils/formatNumber';
import FilterBar from '../../components/common/FilterBar';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import Button from '../../components/common/Button';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidSelect from '../../components/common/LiquidSelect';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import TablePagination from '../../components/common/TablePagination';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { POR_VENCER, TIPO_MOVIMIENTO, estadoDeVencimiento, leerEntero, costosDelCatalogo, lotesConDias, filtrarLotes, resumenDeLotes } from '@nucleo/utils/distribucionBodega';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { usePaginaEnUrl } from '../../plataforma/usePaginaEnUrl';
import { fetchCatalogo, fetchCuarentena, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import CuarentenaModal from './CuarentenaModal';
import { fetchLotes, fetchMovimientosDeLote, entradaDeLote, ajustarLote } from '@nucleo/data/distribucionInventario';
import useBorrador from '@nucleo/hooks/useBorrador';

// El inventario de la distribuidora, por lote y vencimiento.
//
// Lo que entra se carga acá («Entrada de lote»); lo que sale lo descuenta solo
// el documento al facturarse —primero el lote que vence antes, y si no alcanza
// uno se separa en dos renglones—, y vuelve solo si el documento se invalida o
// el pedido se anula. Por eso esta pantalla no tiene «Salida»: una salida
// escrita a mano sería una venta sin documento. Lo que no cuadra con lo que
// hay en la bodega se corrige con un ajuste, que exige su motivo.

const COLS = [
    { key: 'producto',   label: 'Producto',   align: 'left', className: 'w-[280px]' },
    { key: 'lote',       label: 'Lote',       align: 'left' },
    { key: 'vence',      label: 'Vence',      align: 'left' },
    { key: 'existencia', label: 'Existencia', align: 'right' },
];
// El costo sólo lo ve quien administra: es el margen de la empresa.
const COL_COSTO = { key: 'costo', label: 'Al costo', align: 'right', hideBelow: 'md' };

function EntradaModal({ emisorId, onClose, onGuardado }) {
    const [catalogo, setCatalogo] = useState([]);
    const [texto, setTexto] = useState('');
    const [productoId, setProductoId] = useState('');
    const [lote, setLote] = useState('');
    const [vence, setVence] = useState('');
    const [unidades, setUnidades] = useState('');
    const [nota, setNota] = useState('');
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState('');

    // Una entrada de lote se escribe con la caja en la mano, y la sesión se
    // cierra sola a los pocos minutos: lo escrito se guarda como borrador.
    const { recuperado, descartar } = useBorrador(
        emisorId ? `distribucion-entrada-lote-${emisorId}` : null,
        { productoId, lote, vence, unidades, nota },
        { vale: (v) => !!(v?.productoId || v?.lote || v?.unidades) },
    );
    const repuesto = useRef(false);
    useEffect(() => {
        if (repuesto.current || !recuperado) return;
        repuesto.current = true;
        setProductoId(recuperado.productoId ?? '');
        setLote(recuperado.lote ?? '');
        setVence(recuperado.vence ?? '');
        setUnidades(recuperado.unidades ?? '');
        setNota(recuperado.nota ?? '');
    }, [recuperado]);

    useEffect(() => {
        let vivo = true;
        fetchCatalogo()
            .then(r => { if (vivo) setCatalogo(r); })
            .catch(() => { if (vivo) setError('No se pudo cargar el catálogo de la distribuidora.'); });
        return () => { vivo = false; };
    }, []);

    const opciones = useMemo(() => {
        const q = texto.trim();
        return catalogo.filter(p => !q || tokenMatch(q, p.nombre)).slice(0, 50)
            .map(p => ({ value: String(p.product_id), label: p.nombre }));
    }, [catalogo, texto]);

    const cant = leerEntero(unidades);
    const listo = !!productoId && lote.trim() !== '' && cant !== null && cant > 0 && !guardando;

    const guardar = async () => {
        setGuardando(true);
        setError('');
        try {
            const r = await entradaDeLote({
                emisorId, productId: Number(productoId), lote: lote.trim(), vence: vence || null, unidades: cant, nota: nota.trim(),
            });
            useStaff.getState().appendAuditLog('DISTRIBUCION_LOTE_ENTRADA', String(r?.lote_id ?? ''),
                { product_id: Number(productoId), lote: lote.trim().toUpperCase(), vence: vence || null, unidades: cant });
            descartar();
            onGuardado();
        } catch (e) {
            setError(mensajeDeDistribucion(e));
        } finally {
            setGuardando(false);
        }
    };

    return (
        <LiquidModal open onClose={guardando ? undefined : onClose} maxWidth="max-w-lg" ariaLabel="Entrada de lote">
            <LiquidModal.Header>
                <div className="flex items-center gap-2.5 min-w-0">
                    <PackagePlus size={18} className="text-brand-text shrink-0" />
                    <h2 className="text-title font-black text-content truncate">Entrada de lote</h2>
                </div>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="flex flex-col gap-4">
                    {error && <Notice variant="danger" bloque>{error}</Notice>}
                    <PortalInput label="Buscar producto" name="buscar" value={texto} onChange={(e) => setTexto(e.target.value)}
                        placeholder="Nombre del producto" />
                    <LiquidSelect value={productoId} placeholder={opciones.length ? 'Elegir producto…' : 'Ningún producto del catálogo coincide'}
                        options={opciones} onChange={setProductoId} disabled={!opciones.length} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <PortalInput label="Lote" name="lote" value={lote} onChange={(e) => setLote(e.target.value.toUpperCase())}
                            placeholder="Como viene en la caja" />
                        <div>
                            <span className="text-caption font-bold text-content-2 block mb-1.5">Vence</span>
                            <LiquidDatePicker value={vence} onChange={(v) => setVence(v || '')} />
                        </div>
                    </div>
                    <PortalInput label="Unidades" name="unidades" inputMode="numeric" value={unidades}
                        onChange={(e) => setUnidades(e.target.value)} hasError={unidades !== '' && (cant === null || cant <= 0)}
                        errorMessage="Escribe un número entero de unidades"
                        helperText="En unidades sueltas: una caja de 24 son 24." />
                    <PortalTextarea label="Nota (opcional)" name="nota" value={nota} onChange={(e) => setNota(e.target.value)}
                        placeholder="Proveedor, número de factura de compra…" rows={2} />
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <div className="flex items-center justify-end gap-2 w-full">
                    <Button variant="ghost" onClick={onClose} disabled={guardando}>Cancelar</Button>
                    <Button variant="primary" icon={guardando ? Loader2 : Save} disabled={!listo} onClick={guardar}>Registrar entrada</Button>
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

function LoteModal({ lote, puedeAjustar, onClose, onGuardado }) {
    const [movs, setMovs] = useState(null);
    const [existencia, setExistencia] = useState(String(lote.existencia));
    const [vence, setVence] = useState(lote.vence ?? '');
    const [motivo, setMotivo] = useState('');
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let vivo = true;
        fetchMovimientosDeLote(lote.id)
            .then(r => { if (vivo) setMovs(r); })
            .catch(() => { if (vivo) { setMovs([]); setError('No se pudo cargar el historial del lote.'); } });
        return () => { vivo = false; };
    }, [lote.id]);

    const cant = leerEntero(existencia);
    const cambia = cant !== null && (cant !== lote.existencia || (vence || null) !== (lote.vence ?? null));
    const listo = puedeAjustar && cambia && motivo.trim() !== '' && !guardando;

    const guardar = async () => {
        setGuardando(true);
        setError('');
        try {
            await ajustarLote({ loteId: lote.id, existencia: cant, vence: vence || null, nota: motivo.trim() });
            useStaff.getState().appendAuditLog('DISTRIBUCION_LOTE_AJUSTE', String(lote.id),
                { lote: lote.lote, antes: lote.existencia, despues: cant, vence_antes: lote.vence, vence: vence || null, motivo: motivo.trim() });
            onGuardado();
        } catch (e) {
            setError(mensajeDeDistribucion(e));
        } finally {
            setGuardando(false);
        }
    };

    return (
        <LiquidModal open onClose={guardando ? undefined : onClose} maxWidth="max-w-xl" ariaLabel={`Lote ${lote.lote}`}>
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h2 className="text-title font-black text-content truncate">{lote.nombre}</h2>
                    <p className="text-caption text-content-3">Lote {lote.lote} · vence {lote.vence ? fechaNumerica(lote.vence) : 'sin fecha'}</p>
                </div>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="flex flex-col gap-5">
                    {error && <Notice variant="danger" bloque>{error}</Notice>}
                    {puedeAjustar && (
                        <div className="flex flex-col gap-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <PortalInput label="Existencia contada" name="existencia" inputMode="numeric" value={existencia}
                                    onChange={(e) => setExistencia(e.target.value)} hasError={cant === null}
                                    errorMessage="Escribe un número entero" helperText={`Hoy dice ${lote.existencia}`} />
                                <div>
                                    <span className="text-caption font-bold text-content-2 block mb-1.5">Vence</span>
                                    <LiquidDatePicker value={vence} onChange={(v) => setVence(v || '')} />
                                </div>
                            </div>
                            <PortalTextarea label="Motivo del ajuste" name="motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)}
                                placeholder="Conteo físico, producto dañado, fecha mal capturada…" rows={2} />
                        </div>
                    )}
                    <div>
                        <p className="text-caption font-bold text-content-2 mb-2 flex items-center gap-1.5"><History size={14} /> Movimientos</p>
                        {movs === null ? (
                            <p className="text-caption text-content-3">Cargando…</p>
                        ) : movs.length === 0 ? (
                            <p className="text-caption text-content-3">Sin movimientos.</p>
                        ) : (
                            <ul className="divide-y divide-divider">
                                {movs.map(m => {
                                    const t = TIPO_MOVIMIENTO[m.tipo] ?? { label: m.tipo, variant: 'neutral' };
                                    return (
                                        <li key={m.id} className="py-2 flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <Badge size="sm" variant={t.variant}>{t.label}</Badge>
                                                    <span className="text-caption text-content-3">
                                                        {fechaNumerica(m.created_at)} {hora12(m.created_at)}
                                                        {m.employees ? ` · ${shortEmployeeName(m.employees)}` : ''}
                                                    </span>
                                                </div>
                                                {m.nota && <p className="text-caption text-content-2 mt-1">{m.nota}</p>}
                                                {m.pedido_id && !m.nota && <p className="text-caption text-content-3 mt-1">Pedido {m.pedido_id}</p>}
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className={`text-body-sm font-bold tabular-nums ${m.cantidad < 0 ? 'text-danger-text' : 'text-success-text'}`}>
                                                    {m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad}
                                                </p>
                                                <p className="text-caption text-content-3 tabular-nums">queda {m.existencia_despues}</p>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <div className="flex items-center justify-end gap-2 w-full">
                    <Button variant="ghost" onClick={onClose} disabled={guardando}>{puedeAjustar ? 'Cancelar' : 'Cerrar'}</Button>
                    {puedeAjustar && (
                        <Button variant="primary" icon={guardando ? Loader2 : Save} disabled={!listo} onClick={guardar}>Guardar ajuste</Button>
                    )}
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

export default function TabInventario({ emisor, puedeVender, puedeConfigurar, buscar }) {
    const [lotes, setLotes] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');
    const [filtro, setFiltro] = useState('');
    const [entrada, setEntrada] = useState(false);
    const [abierto, setAbierto] = useState(null);
    const [costos, setCostos] = useState(new Map());
    const [cuarentena, setCuarentena] = useState([]);
    const [verCuarentena, setVerCuarentena] = useState(false);
    const pedidoRef = useRef(0);

    const cargar = useCallback(async () => {
        const mio = ++pedidoRef.current;
        setCargando(true);
        setError('');
        try {
            const [r, cat, cua] = await Promise.all([fetchLotes(), puedeConfigurar ? fetchCatalogo() : Promise.resolve([]), fetchCuarentena()]);
            if (mio === pedidoRef.current) {
                // Bodega: lo que va en un camión se mira en «Camiones» (0030).
                setLotes(r.filter(l => !l.en_camion_de));
                setCuarentena(cua);
                // Costo promedio por producto (sin IVA), lo mantienen las compras (borrador 0015).
                setCostos(costosDelCatalogo(cat));
            }
        } catch (e) {
            if (mio !== pedidoRef.current) return;
            console.error('TabInventario', e);
            setError('No se pudo cargar el inventario. Revisa la conexión e intenta de nuevo.');
        } finally {
            if (mio === pedidoRef.current) setCargando(false);
        }
    }, [puedeConfigurar]);
    useEffect(() => { cargar(); }, [cargar]);

    const conDias = useMemo(() => lotesConDias(lotes, costos), [lotes, costos]);

    const filtrados = useMemo(() => filtrarLotes(conDias, { buscar, filtro }), [conDias, buscar, filtro]);
    const stats = useMemo(() => resumenDeLotes(conDias), [conDias]);

    const { page, pageSize, totalPages, setPage, setPageSize } = usePaginaEnUrl({ total: filtrados.length });
    useEffect(() => { setPage(1); }, [buscar, filtro]); // eslint-disable-line react-hooks/exhaustive-deps
    const pagina = filtrados.slice((page - 1) * pageSize, page * pageSize);

    const alternar = (f) => setFiltro(v => (v === f ? '' : f));
    const acciones = puedeVender && emisor
        ? [{ key: 'entrada', icon: Plus, label: 'Entrada de lote', variant: 'primary', onClick: () => setEntrada(true) }]
        : [];

    return (
        <div className="p-5 md:p-6 space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen del inventario">
                    <StatCard icon={Boxes} label="Productos" value={stats.productos} loading={cargando} sub={`${stats.unidades} unidades en existencia`} />
                    <StatCard icon={CalendarClock} label="Por vencer" value={stats.porVencer} loading={cargando}
                        iconBg="bg-warning/10" iconCls="text-warning" sub={`Lotes en ${POR_VENCER} días o menos`}
                        active={filtro === 'porVencer'} tono="warning" onClick={() => alternar('porVencer')} />
                    <StatCard icon={CalendarX2} label="Vencidos" value={stats.vencidos} loading={cargando}
                        iconBg="bg-danger/10" iconCls="text-danger" sub="Con existencia: no se venden"
                        active={filtro === 'vencidos'} tono="danger" onClick={() => alternar('vencidos')} />
                    <StatCard icon={ShieldAlert} label="En cuarentena" value={cuarentena.reduce((t, q) => t + q.unidades, 0)} loading={cargando}
                        iconBg="bg-warning/10" iconCls="text-warning" sub={cuarentena.length ? `${cuarentena.length} devoluciones por decidir` : 'Nada por decidir'}
                        onClick={() => setVerCuarentena(true)} />
                    {puedeConfigurar && (
                        <StatCard icon={Coins} label="Valor al costo" value={formatMoney(stats.valor)} loading={cargando}
                            iconBg="bg-success/10" iconCls="text-success"
                            sub={stats.sinCosto ? `${stats.sinCosto} productos todavía sin costo` : 'Costo promedio, sin IVA'} />
                    )}
                </CarrilCards>
                <FilterBar onClear={() => setFiltro('')} activeCount={filtro ? 1 : 0} acciones={acciones}>
                    <FilterBar.Chip active={filtro === 'agotados'} onToggle={() => alternar('agotados')} tone="brand">
                        Lotes agotados
                    </FilterBar.Chip>
                </FilterBar>
            </div>

            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}

            <DataTable
                columns={puedeConfigurar ? [...COLS, COL_COSTO] : COLS}
                movil={{ usarAccionDeFila: true }}
                loading={cargando}
                minWidth="320px"
                empty={buscar || filtro
                    ? { icon: Search, message: 'Sin resultados', subtext: 'Ningún lote coincide con la búsqueda o el filtro.' }
                    : { icon: Boxes, message: 'Sin existencias', subtext: puedeVender ? 'Registra lo que llega con «Entrada de lote».' : undefined }}
            >
                {pagina.map((l, i) => {
                    const v = estadoDeVencimiento(l.vence);
                    return (
                        <DataRow key={l.id} index={i} onClick={() => setAbierto(l)}>
                            <DataCell>
                                <p className="text-body-sm font-bold text-content-2 truncate max-w-[260px]" title={l.nombre}>{l.nombre}</p>
                            </DataCell>
                            <DataCell><span className="font-mono text-body-sm text-content-2">{l.lote}</span></DataCell>
                            <DataCell>
                                <div className="flex items-center gap-2">
                                    <span className="tabular-nums text-body-sm text-content-2">{l.vence ? fechaNumerica(l.vence) : '—'}</span>
                                    <Badge size="sm" variant={v.variant}>{v.texto}</Badge>
                                </div>
                            </DataCell>
                            <DataCell align="right"><span className="tabular-nums font-bold text-content-2">{l.existencia}</span></DataCell>
                            {puedeConfigurar && (
                                <DataCell align="right" hideBelow="md">
                                    {l.costo === null ? <span className="text-caption text-content-3">Sin costo</span> : (
                                        <div className="flex flex-col items-end">
                                            <span className="tabular-nums text-body-sm font-bold text-content-2">{formatMoney(l.valor)}</span>
                                            <span className="text-micro text-content-3 tabular-nums">{formatMoney(l.costo)} c/u</span>
                                        </div>
                                    )}
                                </DataCell>
                            )}
                        </DataRow>
                    );
                })}
            </DataTable>

            {!cargando && filtrados.length > 0 && (
                <TablePagination pageSize={pageSize} onPageSizeChange={setPageSize} page={page}
                    totalPages={totalPages} onPageChange={setPage} total={filtrados.length} unit="lotes" />
            )}

            {entrada && (
                <EntradaModal emisorId={emisor?.id} onClose={() => setEntrada(false)}
                    onGuardado={() => { setEntrada(false); cargar(); }} />
            )}
            {verCuarentena && (
                <CuarentenaModal filas={cuarentena} puedeResolver={puedeConfigurar} onClose={() => setVerCuarentena(false)}
                    onCambio={cargar} />
            )}
            {abierto && (
                <LoteModal lote={abierto} puedeAjustar={puedeConfigurar} onClose={() => setAbierto(null)}
                    onGuardado={() => { setAbierto(null); cargar(); }} />
            )}
        </div>
    );
}
