import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Truck, Plus, Loader2, PackageOpen, FileText, AlertTriangle, Trash2, Undo2, Boxes } from 'lucide-react';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import FilterBar from '../../components/common/FilterBar';
import Notice from '../../components/common/Notice';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalInput from '../../components/common/PortalInput';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import Campo from './Campo';
import useBorrador from '@nucleo/hooks/useBorrador';
import { useToastStore } from '@nucleo/store/toastStore';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { formatQty } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import {
    fetchCamiones, cargarCamion, descargarCamion, emitirNotaRemision, fetchVendedores, mensajeDeDistribucion,
} from '@nucleo/data/distribucion';
import { fetchLotes } from '@nucleo/data/distribucionInventario';
import { ESTADO_DOCUMENTO } from './comun';
import { cargaSinNota, resumenDeCamiones, lotesCargables, yaEnLaCarga, validarUnidadesDeCarga, cuentaDeDescarga } from '@nucleo/utils/distribucionRutas';

// Autoventa (borrador 0030): lo que lleva cada camión.
//
// Cargar mueve unidades de un lote en bodega al MISMO lote en el camión del
// vendedor; la carga sale con su Nota de Remisión (Código Tributario art. 109:
// la mercadería no circula sin documento). Al volver, se cuenta lo que quedó:
// lo contado vuelve a bodega y lo que falta queda anotado, con su motivo.

const COLS = [
    { key: 'producto', label: 'Producto', align: 'left', className: 'w-[260px]' },
    { key: 'lote',     label: 'Lote',     align: 'left', hideBelow: 'sm' },
    { key: 'cargado',  label: 'Cargado',  align: 'right', hideBelow: 'md' },
    { key: 'vendido',  label: 'Vendido',  align: 'right', hideBelow: 'md' },
    { key: 'queda',    label: 'En el camión', align: 'right' },
];

function CargarModal({ vendedores, vendedorInicial, onClose, onListo }) {
    const showToast = useToastStore(s => s.showToast);
    const [vendedor, setVendedor] = useState(vendedorInicial ?? '');
    const [lotes, setLotes] = useState(null);
    const [lote, setLote] = useState('');
    const [unidades, setUnidades] = useState('');
    const [items, setItems] = useState([]);
    const [nota, setNota] = useState('');
    const [ocupado, setOcupado] = useState(false);
    const [error, setError] = useState('');

    // Una carga a medio armar sobrevive a que la sesión se cierre sola.
    const { recuperado, descartar } = useBorrador('distribucion-carga-camion', { vendedor, items, nota },
        { vale: (v) => !!(v?.items?.length || v?.nota) });
    const repuesto = useRef(false);
    useEffect(() => {
        if (repuesto.current || !recuperado) return;
        repuesto.current = true;
        if (recuperado.vendedor) setVendedor(recuperado.vendedor);
        setItems(Array.isArray(recuperado.items) ? recuperado.items : []);
        setNota(recuperado.nota ?? '');
    }, [recuperado]);

    useEffect(() => {
        let vivo = true;
        fetchLotes()
            .then(r => { if (vivo) setLotes(lotesCargables(r)); })
            .catch(e => { if (vivo) setError(mensajeDeDistribucion(e)); });
        return () => { vivo = false; };
    }, []);

    const porId = useMemo(() => new Map((lotes ?? []).map(l => [String(l.id), l])), [lotes]);
    const yaPuesto = (id) => yaEnLaCarga(items, id);
    const sel = porId.get(lote);
    const { n, libre, malo: nMalo } = validarUnidadesDeCarga(sel, items, unidades);

    const agregar = () => {
        if (!sel || nMalo || !n) return;
        setItems(xs => [...xs, { lote_id: sel.id, unidades: n }]);
        setLote(''); setUnidades('');
    };

    const cargar = async () => {
        setOcupado(true);
        setError('');
        try {
            const carga = await cargarCamion(vendedor, items, nota);
            useStaff.getState().appendAuditLog('DISTRIBUCION_CAMION_CARGADO', String(carga), { vendedor, items });
            descartar();
            // La Nota de Remisión va de una vez: sin ella el camión no debería salir.
            try {
                const r = await emitirNotaRemision(carga);
                showToast('Camión cargado', r?.numero_control ? `Nota de Remisión ${r.numero_control}` : (r?.aviso ?? ''), 'success');
            } catch (e) {
                showToast('Camión cargado, falta la Nota de Remisión', mensajeDeDistribucion(e), 'warning');
            }
            onListo();
        } catch (e) {
            setError(mensajeDeDistribucion(e));
        } finally {
            setOcupado(false);
        }
    };

    const opcionesLotes = (lotes ?? []).map(l => ({
        value: String(l.id),
        label: `${l.nombre} · ${l.lote}`,
        sublabel: `${formatQty(Number(l.existencia) - yaPuesto(l.id))} en bodega${l.vence ? ` · vence ${fechaNumerica(l.vence)}` : ''}`,
    })).filter(o => !o.sublabel.startsWith('0 '));

    return (
        <LiquidModal open onClose={ocupado ? undefined : onClose} maxWidth="max-w-2xl" ariaLabel="Cargar camión">
            <LiquidModal.Header>
                <div className="flex items-center gap-2.5 min-w-0">
                    <Truck size={18} className="text-brand-text shrink-0" />
                    <h2 className="text-title font-black text-content truncate">Cargar camión</h2>
                </div>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="flex flex-col gap-4" data-cargar-camion>
                    {error && <Notice variant="danger" bloque>{error}</Notice>}
                    <Campo label="Vendedor">
                        <LiquidSelect value={vendedor} onChange={(v) => setVendedor(v ?? '')} placeholder="Elegir vendedor…" ariaLabel="Vendedor"
                            options={vendedores.map(v => ({ value: v.id, label: shortEmployeeName(v) }))} />
                    </Campo>
                    <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_8rem_auto] gap-2 items-end">
                        <Campo label="Lote en bodega">
                            <LiquidSelect value={lote} onChange={(v) => setLote(v ?? '')} options={opcionesLotes} ariaLabel="Lote en bodega"
                                placeholder={lotes ? 'Elegir lote…' : 'Cargando…'} disabled={!lotes} icon={Boxes} />
                        </Campo>
                        <PortalInput label="Unidades" name="unidades-carga" inputMode="numeric" value={unidades}
                            onChange={(e) => setUnidades(e.target.value.replace(/\D/g, ''))}
                            hasError={nMalo} errorMessage={sel ? `Hasta ${libre}` : 'Elige el lote'} />
                        <Button variant="secondary" icon={Plus} onClick={agregar} disabled={!sel || !n || nMalo}>Agregar</Button>
                    </div>
                    {items.length > 0 && (
                        <ul className="divide-y divide-divider rounded-xl border border-divider" aria-label="Lo que se carga">
                            {items.map((it, i) => {
                                const l = porId.get(String(it.lote_id));
                                return (
                                    <li key={`${it.lote_id}-${i}`} className="flex items-center gap-3 px-3 py-2">
                                        <div className="min-w-0 flex-1">
                                            <p className="text-body-sm font-bold text-content truncate">{l?.nombre}</p>
                                            <p className="text-caption text-content-3">Lote {l?.lote}{l?.vence ? ` · vence ${fechaNumerica(l.vence)}` : ''}</p>
                                        </div>
                                        <span className="tabular-nums font-black text-content">{formatQty(it.unidades)}</span>
                                        <Button size="sm" variant="ghost" iconOnly icon={Trash2} title="Quitar" onClick={() => setItems(xs => xs.filter((_, j) => j !== i))} />
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    <PortalInput label="Nota (opcional)" name="nota-carga" value={nota} onChange={(e) => setNota(e.target.value)}
                        placeholder="Ej.: ruta del martes" />
                    <p className="text-caption text-content-3">
                        Al cargar se emite la Nota de Remisión que ampara la mercadería en el camión.
                    </p>
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <div className="flex items-center justify-end gap-2 w-full">
                    <Button variant="ghost" onClick={onClose} disabled={ocupado}>Cancelar</Button>
                    <Button variant="primary" icon={ocupado ? Loader2 : Truck} disabled={!vendedor || !items.length || ocupado} onClick={cargar}>
                        Cargar {items.length ? `(${items.length})` : ''}
                    </Button>
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

function DescargarModal({ camion, onClose, onListo }) {
    const lotesConAlgo = camion.lotes.filter(l => Number(l.queda) > 0);
    const [contado, setContado] = useState(() => Object.fromEntries(lotesConAlgo.map(l => [l.lote_id, String(l.queda)])));
    const [nota, setNota] = useState('');
    const [ocupado, setOcupado] = useState(false);
    const [error, setError] = useState('');
    const cuenta = cuentaDeDescarga(camion.lotes, contado, nota);
    const { malos, faltan } = cuenta;
    const listo = cuenta.listo && !ocupado;

    const descargar = async () => {
        setOcupado(true);
        setError('');
        try {
            const r = await descargarCamion(camion.vendedor_id,
                lotesConAlgo.map(l => ({ lote_id: l.lote_id, contado: Number(contado[l.lote_id]) })), nota);
            useStaff.getState().appendAuditLog('DISTRIBUCION_CAMION_DESCARGADO', String(r?.carga_id ?? ''), { vendedor: camion.vendedor_id, ...r });
            onListo(r);
        } catch (e) {
            setError(mensajeDeDistribucion(e));
        } finally {
            setOcupado(false);
        }
    };

    return (
        <LiquidModal open onClose={ocupado ? undefined : onClose} maxWidth="max-w-2xl" ariaLabel="Descargar camión">
            <LiquidModal.Header>
                <div className="flex items-center gap-2.5 min-w-0">
                    <Undo2 size={18} className="text-brand-text shrink-0" />
                    <h2 className="text-title font-black text-content truncate">Descargar · {shortEmployeeName(camion.vendedor)}</h2>
                </div>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="flex flex-col gap-3" data-descargar-camion>
                    {error && <Notice variant="danger" bloque>{error}</Notice>}
                    <p className="text-caption text-content-3">Cuenta lo que quedó en el camión. Lo contado vuelve a bodega.</p>
                    {lotesConAlgo.length === 0 ? (
                        <Notice variant="info" compact>El camión volvió vacío: se cierra la carga.</Notice>
                    ) : (
                        <ul className="divide-y divide-divider rounded-xl border border-divider">
                            {lotesConAlgo.map(l => (
                                <li key={l.lote_id} className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3 items-center px-3 py-2">
                                    <div className="min-w-0">
                                        <p className="text-body-sm font-bold text-content truncate">{l.nombre}</p>
                                        <p className="text-caption text-content-3">Lote {l.lote} · debería haber {formatQty(Number(l.queda))}</p>
                                    </div>
                                    <PortalInput compact name={`contado-${l.lote_id}`} inputMode="numeric" inputClassName="text-right"
                                        aria-label={`Contado de ${l.nombre}`} value={contado[l.lote_id] ?? ''}
                                        onChange={(e) => setContado(c => ({ ...c, [l.lote_id]: e.target.value.replace(/\D/g, '') }))}
                                        hasError={malos.includes(l)} errorMessage={`0 a ${l.queda}`} />
                                </li>
                            ))}
                        </ul>
                    )}
                    {faltan > 0 && (
                        <Notice variant="warning" icon={AlertTriangle} compact data-faltante={faltan}>
                            Faltan {formatQty(faltan)} unidades: quedan anotadas como faltante del camión.
                        </Notice>
                    )}
                    <PortalInput label={faltan > 0 ? '¿Qué pasó con lo que falta?' : 'Nota (opcional)'} name="nota-descarga"
                        value={nota} onChange={(e) => setNota(e.target.value)} />
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <div className="flex items-center justify-end gap-2 w-full">
                    <Button variant="ghost" onClick={onClose} disabled={ocupado}>Cancelar</Button>
                    <Button variant="primary" icon={ocupado ? Loader2 : Undo2} disabled={!listo} onClick={descargar}>Descargar y cerrar</Button>
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

export default function TabCamiones({ puedeConfigurar, buscar }) {
    const showToast = useToastStore(s => s.showToast);
    const [camiones, setCamiones] = useState([]);
    const [vendedores, setVendedores] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');
    const [cargar, setCargar] = useState(null);       // { vendedor? }
    const [descargar, setDescargar] = useState(null); // camión
    const [emitiendo, setEmitiendo] = useState(null);
    const pedidoRef = useRef(0);

    const recargar = useCallback(async () => {
        const mio = ++pedidoRef.current;
        setCargando(true);
        setError('');
        try {
            const [c, v] = await Promise.all([fetchCamiones(), puedeConfigurar ? fetchVendedores() : Promise.resolve([])]);
            if (mio !== pedidoRef.current) return;
            setCamiones(c); setVendedores(v);
        } catch (e) {
            if (mio === pedidoRef.current) setError(mensajeDeDistribucion(e));
        } finally {
            if (mio === pedidoRef.current) setCargando(false);
        }
    }, [puedeConfigurar]);
    useEffect(() => { recargar(); }, [recargar]);

    const emitir = async (cam) => {
        setEmitiendo(cam.carga.id);
        try {
            const r = await emitirNotaRemision(cam.carga.id);
            showToast('Nota de Remisión', r?.numero_control ?? r?.aviso ?? '', 'success');
            recargar();
        } catch (e) {
            showToast('No se pudo emitir la Nota de Remisión', mensajeDeDistribucion(e), 'error');
        } finally {
            setEmitiendo(null);
        }
    };

    const q = (buscar ?? '').trim();
    const visibles = camiones.map(c => ({ ...c, lotes: (c.lotes ?? []).filter(l => !q || tokenMatch(q, l.nombre, l.lote)) }));
    const totales = useMemo(() => resumenDeCamiones(camiones), [camiones]);

    const acciones = puedeConfigurar
        ? [{ key: 'cargar', icon: Plus, label: 'Cargar camión', variant: 'primary', onClick: () => setCargar({}) }]
        : [];

    return (
        <div className="p-5 md:p-6 space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen de camiones">
                    <StatCard icon={Truck} label="Camiones en ruta" value={formatQty(totales.camiones)} loading={cargando}
                        iconBg="bg-brand/10" iconCls="text-brand-text" sub="Con carga abierta" />
                    <StatCard icon={PackageOpen} label="Unidades en camiones" value={formatQty(totales.unidades)} loading={cargando}
                        sub="Fuera de bodega, sin vender" />
                    <StatCard icon={FileText} label="Sin Nota de Remisión" value={formatQty(totales.sinNota)} loading={cargando}
                        iconBg="bg-warning/10" iconCls="text-warning" sub="No deberían circular así" />
                </CarrilCards>
                <div className="flex justify-end min-w-0">
                    <FilterBar acciones={acciones} />
                </div>
            </div>

            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
            {!cargando && !error && camiones.length === 0 && (
                <Notice variant="info" icon={Truck}>Ningún camión lleva mercadería. Para vender desde el camión, cárgalo primero.</Notice>
            )}

            {visibles.map(c => {
                const sinNota = cargaSinNota(c.carga);
                const est = c.carga?.dte ? ESTADO_DOCUMENTO[c.carga.dte.estado] : null;
                return (
                    <section key={c.vendedor_id} data-surface="card" className="p-4 flex flex-col gap-3" aria-label={`Camión de ${shortEmployeeName(c.vendedor)}`} data-camion={c.vendedor_id}>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                                <AvatarConEstado emp={c.vendedor} px={36} radio="rounded-full" marco="" />
                                <div className="min-w-0">
                                    <p className="text-body font-black text-content truncate">{shortEmployeeName(c.vendedor)}</p>
                                    <p className="text-caption text-content-3">
                                        {c.carga ? `Cargado el ${fechaNumerica(c.carga.created_at)}` : 'Sin carga abierta'}
                                        {c.carga?.dte ? ` · NR ${c.carga.dte.numero_control.slice(-6)}` : ''}
                                    </p>
                                </div>
                                {est && <Badge size="sm" variant={est.variant ?? 'neutral'}>{est.label}</Badge>}
                                {sinNota && <Badge size="sm" variant="warning">Sin Nota de Remisión</Badge>}
                            </div>
                            {puedeConfigurar && (
                                <div className="flex flex-wrap gap-2">
                                    {sinNota && (
                                        <Button size="sm" variant="secondary" icon={emitiendo === c.carga.id ? Loader2 : FileText}
                                            disabled={!!emitiendo} onClick={() => emitir(c)}>Emitir Nota de Remisión</Button>
                                    )}
                                    {c.carga && !c.carga.dte && (
                                        <Button size="sm" variant="ghost" icon={Plus} onClick={() => setCargar({ vendedor: c.vendedor_id })}>Cargar más</Button>
                                    )}
                                    <Button size="sm" variant="primary" icon={Undo2} onClick={() => setDescargar(c)}>Descargar</Button>
                                </div>
                            )}
                        </div>
                        <DataTable columns={COLS} movil={{ usarAccionDeFila: false }} minWidth="320px"
                            empty={{ icon: PackageOpen, message: 'Sin productos', subtext: q ? 'Ningún producto coincide.' : 'El camión está vacío.' }}>
                            {c.lotes.map((l, i) => (
                                <DataRow key={l.lote_id} index={i}>
                                    <DataCell>
                                        <p className="text-body-sm font-bold text-content-2 truncate max-w-[240px]" title={l.nombre}>{l.nombre}</p>
                                    </DataCell>
                                    <DataCell hideBelow="sm">
                                        <span className="text-caption text-content-3">{l.lote}{l.vence ? ` · ${fechaNumerica(l.vence)}` : ''}</span>
                                    </DataCell>
                                    <DataCell align="right" hideBelow="md"><span className="tabular-nums text-content-3">{formatQty(Number(l.cargado))}</span></DataCell>
                                    <DataCell align="right" hideBelow="md"><span className="tabular-nums text-content-2">{formatQty(Number(l.vendido))}</span></DataCell>
                                    <DataCell align="right"><span className="tabular-nums font-black text-content">{formatQty(Number(l.queda))}</span></DataCell>
                                </DataRow>
                            ))}
                        </DataTable>
                    </section>
                );
            })}

            {cargar && (
                <CargarModal vendedores={vendedores} vendedorInicial={cargar.vendedor} onClose={() => setCargar(null)}
                    onListo={() => { setCargar(null); recargar(); }} />
            )}
            {descargar && (
                <DescargarModal camion={descargar} onClose={() => setDescargar(null)}
                    onListo={(r) => {
                        setDescargar(null);
                        showToast('Camión descargado', `${formatQty(r?.devuelto ?? 0)} unidades volvieron a bodega${r?.faltante ? ` · faltan ${formatQty(r.faltante)}` : ''}`, r?.faltante ? 'warning' : 'success');
                        recargar();
                    }} />
            )}
        </div>
    );
}
