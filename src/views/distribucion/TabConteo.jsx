import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ClipboardCheck, PlayCircle, Lock, Ban, Loader2, CheckCircle2, AlertTriangle, PackageMinus, Check, X, Search, ListFilter } from 'lucide-react';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import PortalInput from '../../components/common/PortalInput';
import LiquidSelect from '../../components/common/LiquidSelect';
import FilterBar from '../../components/common/FilterBar';
import Campo from './Campo';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import useBorrador from '@nucleo/hooks/useBorrador';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import {
    fetchConteos, fetchConteo, iniciarConteo, contar, cerrarConteo, anularConteo,
    fetchBajas, solicitarBaja, resolverBaja, mensajeDeDistribucion,
} from '@nucleo/data/distribucion';
import { fetchLotes } from '@nucleo/data/distribucionInventario';
import { MOTIVOS_BAJA, leerEntero, resumenDeConteo, renglonesDeConteo, rotuloMotivoBaja, estadoDeBaja, valorDeBajas } from '@nucleo/utils/distribucionBodega';

// Conteo físico y bajas (borrador 0026).
//
// Conteo A CIEGAS: quien cuenta no ve lo que dice el sistema —si lo ve, tiende
// a encontrarlo—; quien administra sí, con la diferencia. Al cerrar, el ajuste
// es relativo a lo que había cuando se contó, así una venta hecha mientras se
// contaba no se pisa.
//
// Bajas: se piden acá y las aprueba quien administra; recién aprobadas salen
// del lote.

const entero = leerEntero;

function RenglonConteo({ it, veSistema, abierto, onGuardado }) {
    const [valor, setValor] = useState(it.contado != null ? String(it.contado) : '');
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState('');
    const n = entero(valor);
    const dif = veSistema && it.contado != null ? it.contado - it.sistema : null;
    const guardar = async () => {
        if (n == null || n === it.contado) return;
        setGuardando(true);
        setError('');
        try { await contar(it.id, n); onGuardado(it.id, n); } catch (e) { setError(mensajeDeDistribucion(e)); } finally { setGuardando(false); }
    };
    return (
        <li className="py-2 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center" data-renglon-conteo={it.id}>
            <div className="sm:col-span-6 min-w-0">
                <p className="text-body-sm font-bold text-content-2 truncate" title={it.nombre}>{it.nombre}</p>
                <p className="text-caption text-content-3">Lote {it.lote}{it.vence ? ` · vence ${fechaNumerica(it.vence)}` : ''}{it.contado_por ? ` · contó ${shortEmployeeName(it.contado_por)}` : ''}</p>
                {error && <p className="text-caption text-danger-text">{error}</p>}
            </div>
            {veSistema && <span className="sm:col-span-2 text-caption text-content-3 tabular-nums sm:text-right">sistema {formatQty(it.sistema)}</span>}
            <div className={veSistema ? 'sm:col-span-2' : 'sm:col-span-4'}>
                <PortalInput name={`contado-${it.id}`} aria-label={`Contado de ${it.nombre} lote ${it.lote}`} inputMode="numeric" value={valor} readOnly={!abierto}
                    onChange={(e) => setValor(e.target.value)} onBlur={guardar} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    compact placeholder="Contado" hasError={valor !== '' && n == null} />
            </div>
            <div className="sm:col-span-2 flex items-center justify-end gap-1">
                {guardando && <Loader2 size={14} className="animate-spin text-content-3" />}
                {!guardando && it.contado != null && dif === null && <CheckCircle2 size={16} className="text-success-text" aria-label="Contado" />}
                {dif != null && (dif === 0
                    ? <Badge size="sm" variant="success" uppercase={false}>cuadra</Badge>
                    : <Badge size="sm" variant={dif < 0 ? 'danger' : 'warning'} uppercase={false}>{dif > 0 ? '+' : ''}{dif}{it.costo ? ` · ${formatMoney(Math.abs(dif) * Number(it.costo))}` : ''}</Badge>)}
            </div>
        </li>
    );
}

export default function TabConteo({ puedeVender, puedeConfigurar, buscar }) {
    const showToast = useToastStore(s => s.showToast);
    const [conteos, setConteos] = useState([]);
    const [conteo, setConteo] = useState(null);
    const [bajas, setBajas] = useState([]);
    const [lotes, setLotes] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');
    const [ocupado, setOcupado] = useState('');
    const [nota, setNota] = useState('');
    const [soloSinContar, setSoloSinContar] = useState(false);
    const [baja, setBaja] = useState({ lote: '', unidades: '', motivo: 'vencido', detalle: '' });
    const [rechazo, setRechazo] = useState({});

    // La baja a medio escribir no se pierde si la sesión se cierra sola.
    const { recuperado, descartar } = useBorrador('distribucion-baja-nueva', baja, { vale: (v) => !!(v?.lote || v?.detalle) });
    const repuesto = useRef(false);
    useEffect(() => { if (!repuesto.current && recuperado) { repuesto.current = true; setBaja(b => ({ ...b, ...recuperado })); } }, [recuperado]);

    const cargar = useCallback(async () => {
        setCargando(true);
        setError('');
        try {
            const [cs, bs, ls] = await Promise.all([fetchConteos(), fetchBajas(), fetchLotes()]);
            setConteos(cs); setBajas(bs); setLotes(ls.filter(l => l.existencia > 0 && !l.en_camion_de));
            const abierto = cs.find(c => c.estado === 'abierto');
            setConteo(abierto ? await fetchConteo(abierto.id) : null);
        } catch (e) {
            console.error('conteo', e);
            setError(mensajeDeDistribucion(e));
        } finally {
            setCargando(false);
        }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const items = useMemo(() => renglonesDeConteo(conteo, { buscar, soloSinContar }), [conteo, buscar, soloSinContar]);
    const dif = useMemo(() => resumenDeConteo(conteo), [conteo]);
    const { contados, total } = dif;
    const alGuardar = (id, n) => setConteo(c => ({ ...c, items: c.items.map(it => (it.id === id ? { ...it, contado: n } : it)) }));

    const correr = async (clave, fn, ok) => {
        setOcupado(clave);
        setError('');
        try { const r = await fn(); ok?.(r); await cargar(); } catch (e) { setError(mensajeDeDistribucion(e)); } finally { setOcupado(''); }
    };
    const iniciar = () => correr('iniciar', () => iniciarConteo(null, nota.trim()), (id) => {
        useStaff.getState().appendAuditLog('DISTRIBUCION_CONTEO_INICIADO', String(id), { nota: nota.trim() });
        setNota('');
    });
    const cerrar = () => correr('cerrar', () => cerrarConteo(conteo.id, nota.trim()), (r) => {
        useStaff.getState().appendAuditLog('DISTRIBUCION_CONTEO_CERRADO', String(conteo.id), r);
        showToast('Conteo cerrado', `${r.ajustados} lotes ajustados · faltante ${formatMoney(Number(r.faltante))} · sobrante ${formatMoney(Number(r.sobrante))}${r.sin_contar ? ` · ${r.sin_contar} sin contar (no se tocaron)` : ''}`,
            Number(r.faltante) ? 'warning' : 'success');
        setNota('');
    });
    const anular = () => correr('anular', () => anularConteo(conteo.id, nota.trim()), () => {
        useStaff.getState().appendAuditLog('DISTRIBUCION_CONTEO_ANULADO', String(conteo.id), { motivo: nota.trim() });
        setNota('');
    });
    const loteSel = lotes.find(l => String(l.id) === String(baja.lote));
    const nBaja = entero(baja.unidades);
    const pedirBaja = () => correr('baja', () => solicitarBaja(Number(baja.lote), nBaja, baja.motivo, baja.detalle.trim()), (id) => {
        useStaff.getState().appendAuditLog('DISTRIBUCION_BAJA_SOLICITADA', String(id), { lote: Number(baja.lote), unidades: nBaja, motivo: baja.motivo });
        showToast('Baja pedida', puedeConfigurar ? 'Apruébala abajo para que salga del lote.' : 'Queda esperando la aprobación de quien administra.', 'success');
        setBaja({ lote: '', unidades: '', motivo: 'vencido', detalle: '' });
        descartar();
    });
    const resolver = (b, aprobar) => correr(`res-${b.id}`, () => resolverBaja(b.id, aprobar, rechazo[b.id] ?? ''), () => {
        useStaff.getState().appendAuditLog(aprobar ? 'DISTRIBUCION_BAJA_APROBADA' : 'DISTRIBUCION_BAJA_RECHAZADA', String(b.id), { unidades: b.unidades });
    });
    const pendientes = bajas.filter(b => b.estado === 'pendiente');
    const valorBajas = valorDeBajas(bajas);

    return (
        <div className="p-5 md:p-6 space-y-5">
            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen de conteo y bajas">
                    <StatCard icon={ClipboardCheck} label="Conteo" value={conteo ? `${formatQty(contados)} / ${formatQty(total)}` : 'Sin abrir'} loading={cargando}
                        iconBg="bg-brand/10" iconCls="text-brand-text" sub={conteo ? 'lotes contados' : 'Nadie está contando'} />
                    {conteo?.ve_sistema && (
                        <StatCard icon={AlertTriangle} label="Diferencias" value={formatQty(dif.conDif)} loading={cargando}
                            iconBg="bg-warning/10" iconCls="text-warning" sub={`faltante ${formatMoney(dif.faltante)} · sobrante ${formatMoney(dif.sobrante)}`} />
                    )}
                    <StatCard icon={PackageMinus} label="Bajas por aprobar" value={formatQty(pendientes.length)} loading={cargando}
                        iconBg="bg-danger/10" iconCls="text-danger" sub={`aprobadas: ${formatMoney(valorBajas)} al costo`} />
                </CarrilCards>
                {conteo && (
                    <div className="flex justify-end min-w-0">
                        <FilterBar onClear={() => setSoloSinContar(false)} activeCount={soloSinContar ? 1 : 0}>
                            <FilterBar.Section active={soloSinContar} onClear={() => setSoloSinContar(false)} label="lotes">
                                <FilterBar.Opciones label="Lotes" icon={ListFilter} value={soloSinContar ? 'sin' : 'todos'} onChange={(v) => setSoloSinContar(v === 'sin')}
                                    options={[{ value: 'todos', label: 'Todos' }, { value: 'sin', label: 'Sin contar' }]} />
                            </FilterBar.Section>
                        </FilterBar>
                    </div>
                )}
            </div>

            {/* ── Conteo ── */}
            <section data-surface="card" className="p-4 flex flex-col gap-3" aria-label="Conteo físico" data-conteo={conteo ? 'abierto' : 'ninguno'}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-body font-black text-content flex items-center gap-2"><ClipboardCheck size={16} className="text-brand-text" /> Conteo físico</h3>
                    {conteo && <span className="text-caption text-content-3">Abierto por {shortEmployeeName(conteo.creado_por)}{conteo.nota ? ` · ${conteo.nota}` : ''}</span>}
                </div>
                {!conteo && (puedeConfigurar ? (
                    <div className="flex flex-wrap items-end gap-2">
                        <PortalInput label="Nota (opcional)" name="nota-conteo" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Conteo de fin de mes" className="flex-1 min-w-[200px]" />
                        <Button variant="primary" icon={ocupado === 'iniciar' ? Loader2 : PlayCircle} disabled={!!ocupado} onClick={iniciar}>Iniciar conteo</Button>
                    </div>
                ) : <p className="text-caption text-content-3">No hay conteo abierto. Lo inicia quien administra.</p>)}
                {conteo && (<>
                    {!conteo.ve_sistema && <Notice variant="info" compact>Cuenta lo que hay en cada lote. No se muestra lo que dice el sistema, a propósito.</Notice>}
                    {items.length === 0 ? (
                        <p className="text-caption text-content-3 flex items-center gap-1.5"><Search size={14} /> {soloSinContar ? 'Todo está contado.' : 'Ningún lote coincide.'}</p>
                    ) : (
                        <ul className="divide-y divide-divider" aria-label="Lotes a contar">
                            {items.map(it => <RenglonConteo key={it.id} it={it} veSistema={conteo.ve_sistema} abierto={conteo.estado === 'abierto'} onGuardado={alGuardar} />)}
                        </ul>
                    )}
                    {puedeConfigurar && (
                        <div className="flex flex-wrap items-end gap-2 border-t border-divider pt-3">
                            <PortalInput label="Nota del cierre (o motivo para anular)" name="nota-cierre-conteo" value={nota} onChange={(e) => setNota(e.target.value)} className="flex-1 min-w-[200px]" />
                            <Button variant="ghost" icon={ocupado === 'anular' ? Loader2 : Ban} disabled={!nota.trim() || !!ocupado} onClick={anular}>Anular</Button>
                            <Button variant="primary" icon={ocupado === 'cerrar' ? Loader2 : Lock} disabled={!contados || !!ocupado} onClick={cerrar}>
                                Cerrar y ajustar{total - contados ? ` (${total - contados} sin contar)` : ''}
                            </Button>
                        </div>
                    )}
                </>)}
                {conteos.filter(c => c.estado !== 'abierto').slice(0, 3).length > 0 && (
                    <div className="border-t border-divider pt-2">
                        <p className="text-caption font-bold text-content-2 mb-1">Conteos anteriores</p>
                        <ul className="text-caption text-content-3">
                            {conteos.filter(c => c.estado !== 'abierto').slice(0, 3).map(c => (
                                <li key={c.id}>
                                    {fechaNumerica(c.created_at)} · {c.estado === 'anulado' ? `anulado: ${c.nota}` : `${c.resumen?.ajustados ?? 0} ajustes · faltante ${formatMoney(Number(c.resumen?.faltante ?? 0))} · sobrante ${formatMoney(Number(c.resumen?.sobrante ?? 0))}`}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </section>

            {/* ── Bajas ── */}
            <section data-surface="card" className="p-4 flex flex-col gap-3" aria-label="Bajas">
                <h3 className="text-body font-black text-content flex items-center gap-2"><PackageMinus size={16} className="text-danger-text" /> Bajas</h3>
                {(puedeVender || puedeConfigurar) && (
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                        <Campo label="Lote" className="md:col-span-5">
                            <LiquidSelect value={baja.lote} onChange={(v) => setBaja(b => ({ ...b, lote: v ?? '' }))} placeholder="Lote…" icon={PackageMinus} ariaLabel="Lote de la baja"
                                options={lotes.map(l => ({ value: String(l.id), label: `${l.nombre} · ${l.lote}`, sublabel: `${l.existencia} unidades${l.vence ? ` · vence ${fechaNumerica(l.vence)}` : ''}` }))} />
                        </Campo>
                        <PortalInput label="Unidades" name="unidades-baja" inputMode="numeric" value={baja.unidades} onChange={(e) => setBaja(b => ({ ...b, unidades: e.target.value }))}
                            className="md:col-span-2" hasError={baja.unidades !== '' && (nBaja == null || (loteSel && nBaja > loteSel.existencia))} errorMessage={loteSel ? `Hasta ${loteSel.existencia}` : 'Entero'} />
                        <Campo label="Motivo" className="md:col-span-2">
                            <LiquidSelect value={baja.motivo} onChange={(v) => setBaja(b => ({ ...b, motivo: v ?? 'vencido' }))} options={MOTIVOS_BAJA} clearable={false} icon={AlertTriangle} ariaLabel="Motivo" />
                        </Campo>
                        <PortalInput label="Qué pasó" name="detalle-baja" value={baja.detalle} onChange={(e) => setBaja(b => ({ ...b, detalle: e.target.value }))} className="md:col-span-3" />
                        <div className="md:col-span-12 flex justify-end">
                            <Button variant="secondary" icon={ocupado === 'baja' ? Loader2 : PackageMinus}
                                disabled={!baja.lote || !(nBaja > 0) || (loteSel && nBaja > loteSel.existencia) || !baja.detalle.trim() || !!ocupado} onClick={pedirBaja}>Pedir baja</Button>
                        </div>
                    </div>
                )}
                {bajas.length === 0 ? <p className="text-caption text-content-3">Sin bajas.</p> : (
                    <ul className="divide-y divide-divider">
                        {bajas.slice(0, 20).map(b => (
                            <li key={b.id} className="py-2 flex flex-col gap-1" data-baja={b.estado}>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="min-w-0 truncate text-body-sm"><b className="text-content-2">{b.products?.nombre}</b> · lote {b.dist_lotes?.lote} · {b.unidades} u · {rotuloMotivoBaja(b.motivo)}</span>
                                    <Badge size="sm" variant={b.estado === 'aprobada' ? 'danger' : b.estado === 'rechazada' ? 'neutral' : 'warning'} uppercase={false}>
                                        {estadoDeBaja(b, formatMoney)}
                                    </Badge>
                                </div>
                                <span className="text-caption text-content-3">{b.detalle} · pidió {shortEmployeeName(b.solicitante?.name)} el {fechaNumerica(b.created_at)}{b.nota_resolucion ? ` · ${b.nota_resolucion}` : ''}</span>
                                {b.estado === 'pendiente' && puedeConfigurar && (
                                    <div className="flex flex-wrap items-end gap-2">
                                        <PortalInput label="Nota (obligatoria para rechazar)" name={`nota-baja-${b.id}`} value={rechazo[b.id] ?? ''} onChange={(e) => setRechazo(r => ({ ...r, [b.id]: e.target.value }))} className="flex-1 min-w-[180px]" compact />
                                        <Button size="sm" variant="ghost" icon={X} disabled={!(rechazo[b.id] ?? '').trim() || !!ocupado} onClick={() => resolver(b, false)}>Rechazar</Button>
                                        <Button size="sm" variant="secondary" tone="danger" icon={ocupado === `res-${b.id}` ? Loader2 : Check} disabled={!!ocupado} onClick={() => resolver(b, true)}>Aprobar baja</Button>
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}
