import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import useBorrador from '@nucleo/hooks/useBorrador';
import { useSearchParams } from 'react-router-dom';
import {
    Receipt, Wallet, Landmark, AlertTriangle, CheckCircle2, Lock, Unlock, Loader2, Printer, PlusCircle, Scale,
} from 'lucide-react';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import PortalInput from '../../components/common/PortalInput';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { hoySV } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { imprimirDocumento } from '@nucleo/utils/ticketPrint';
import { ticketDeCierreDia } from '@nucleo/utils/distribucionDocumento';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fetchCierreDia, registrarDeposito, cerrarDia, reabrirDia, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { FORMA_PAGO, leerMonto } from './comun';
import { rutaSeccion } from './rutas';
import { MARCA_PAPEL } from './marca';

// El cierre del día de la distribuidora (borrador 0024): la empresa entera en
// una pantalla. Lo vendido por forma de pago, lo que entró a la oficina (las
// entregas parciales más lo contado al liquidar), los depósitos al banco y la
// conciliación: recibido − depositado = lo que queda en caja fuerte.
//
// No se cierra con cajas sin liquidar, y lo que no se depositó exige decir
// dónde quedó. Cerrado, las liquidaciones de ese día ya no se reabren sin
// reabrir antes el cierre.

const rotuloForma = (f) => (f === '13' ? 'A crédito' : FORMA_PAGO.find(x => x.value === f)?.label ?? f);

export default function TabCierreDia({ emisor }) {
    const showToast = useToastStore(s => s.showToast);
    const [params, setParams] = useSearchParams();
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(params.get('fecha') ?? '') ? params.get('fecha') : hoySV();
    const cambiarFecha = (v) => setParams(p => { const n = new URLSearchParams(p); if (v && v !== hoySV()) n.set('fecha', v); else n.delete('fecha'); return n; }, { replace: true });

    const [d, setD] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');
    const [dep, setDep] = useState({ monto: '', banco: '', referencia: '' });
    const [nota, setNota] = useState('');
    const [ocupado, setOcupado] = useState('');
    const [reabriendo, setReabriendo] = useState(false);
    const [motivo, setMotivo] = useState('');

    // El depósito y la nota del cierre, a medio escribir, no se pierden.
    const { recuperado, descartar } = useBorrador(`distribucion-cierre-dia-${fecha}`, { dep, nota },
        { vale: (v) => !!(v?.dep?.monto || v?.dep?.referencia || v?.nota) });
    const repuesto = useRef(false);
    useEffect(() => {
        if (repuesto.current || !recuperado) return;
        repuesto.current = true;
        if (recuperado.dep) setDep(recuperado.dep);
        setNota(recuperado.nota ?? '');
    }, [recuperado]);

    const cargar = useCallback(async () => {
        setCargando(true);
        setError('');
        try {
            setD(await fetchCierreDia(fecha));
        } catch (e) {
            console.error('cierre del día', e);
            setError(mensajeDeDistribucion(e));
        } finally {
            setCargando(false);
        }
    }, [fecha]);
    useEffect(() => { cargar(); }, [cargar]);

    const recibido = Number(d?.efectivo_recibido ?? 0);
    const depositado = Number(d?.depositado ?? 0);
    const queda = Math.round((recibido - depositado) * 100) / 100;
    const formas = useMemo(() => {
        const m = new Map();
        for (const f of d?.por_forma ?? []) m.set(f.forma, (m.get(f.forma) ?? 0) + Number(f.monto));
        return [...m.entries()];
    }, [d]);
    const cerrado = !!d?.cierre;
    const nDep = leerMonto(dep.monto);

    const correr = async (clave, fn, ok) => {
        setOcupado(clave);
        setError('');
        try { const r = await fn(); ok?.(r); await cargar(); } catch (e) { setError(mensajeDeDistribucion(e)); } finally { setOcupado(''); }
    };
    const depositar = () => correr('dep', () => registrarDeposito(fecha, nDep, dep.banco.trim(), dep.referencia.trim()), (id) => {
        useStaff.getState().appendAuditLog('DISTRIBUCION_DEPOSITO', String(id), { fecha, monto: nDep, banco: dep.banco.trim(), referencia: dep.referencia.trim() });
        showToast('Depósito registrado', formatMoney(nDep), 'success');
        setDep({ monto: '', banco: dep.banco, referencia: '' });
    });
    const cerrar = () => correr('cerrar', () => cerrarDia(fecha, nota.trim()), (id) => {
        useStaff.getState().appendAuditLog('DISTRIBUCION_CIERRE_DIA', String(id), { fecha, recibido, depositado, queda });
        showToast('Día cerrado', queda ? `Quedan ${formatMoney(queda)} sin depositar: ${nota.trim()}` : 'Todo lo recibido se depositó.', 'success');
        setNota('');
        descartar();
    });
    const reabrir = () => correr('reabrir', () => reabrirDia(d.cierre.id, motivo.trim()), () => {
        useStaff.getState().appendAuditLog('DISTRIBUCION_CIERRE_DIA_REABIERTO', String(d.cierre.id), { fecha, motivo: motivo.trim() });
        setReabriendo(false); setMotivo('');
    });
    const imprimir = () => imprimirDocumento(ticketDeCierreDia(d, MARCA_PAPEL, emisor ?? {}))
        .catch(e => showToast('No se pudo imprimir', mensajeAmigable(e), 'warning'));

    return (
        <div className="p-3 md:p-5 flex flex-col gap-4" data-cierre-dia={cerrado ? 'cerrado' : 'abierto'}>
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="w-56"><LiquidDatePicker value={fecha} onChange={cambiarFecha} max={hoySV()} /></div>
                {d && <Button variant="secondary" icon={Printer} onClick={imprimir}>Imprimir cierre</Button>}
            </div>
            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}

            {d && (<>
                <CarrilCards ariaLabel="Resumen del día">
                    <StatCard icon={Receipt} label="Vendido" value={formatMoney(Number(d.ventas.total))} loading={cargando}
                        iconBg="bg-brand/10" iconCls="text-brand-text"
                        sub={`${formatQty(Number(d.ventas.documentos))} documentos${Number(d.devoluciones) > 0 ? ` · ${formatMoney(Number(d.devoluciones))} devuelto` : ''}`} />
                    <StatCard icon={Wallet} label="Efectivo recibido" value={formatMoney(recibido)} loading={cargando}
                        iconBg="bg-success/10" iconCls="text-success"
                        sub={`Fondos entregados ${formatMoney(Number(d.fondos))} · gastos ${formatMoney(Number(d.gastos))}`} />
                    <StatCard icon={Landmark} label="Depositado" value={formatMoney(depositado)} loading={cargando}
                        iconBg="bg-chart-3/10" iconCls="text-chart-3" sub={`${formatQty(d.depositos.length)} depósitos`} />
                    <StatCard icon={Scale} label="Queda en caja fuerte" value={formatMoney(queda)} loading={cargando}
                        iconBg="bg-warning/10" iconCls="text-warning" valueCls={queda < 0 ? 'text-danger-text' : undefined}
                        sub={Number(d.diferencias) === 0 ? 'Liquidaciones sin diferencia' : `Diferencias ${formatMoney(Number(d.diferencias))}`} />
                </CarrilCards>

                {d.pendientes > 0 && (
                    <Notice variant="warning" icon={AlertTriangle} data-testid="cierre-pendientes">
                        {d.pendientes === 1 ? 'Falta 1 vendedor por liquidar' : `Faltan ${d.pendientes} vendedores por liquidar`}: el día se cierra cuando todos entregaron.
                    </Notice>
                )}

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                    <section data-surface="card" className="p-4 flex flex-col gap-2 xl:col-span-2" aria-label="Vendedores">
                        <h3 className="text-body font-black text-content">Vendedores</h3>
                        {d.vendedores.length === 0 ? <p className="text-caption text-content-3">Nadie vendió ni cobró este día.</p> : (
                            <ul className="divide-y divide-divider">
                                {d.vendedores.map(v => (
                                    <li key={v.id} className="py-2 flex items-center gap-3">
                                        <AvatarConEstado emp={{ id: v.id, name: v.name }} px={28} radio="rounded-full" marco="" />
                                        <a href={rutaSeccion('liquidacion', `vendedor=${v.id}${fecha !== hoySV() ? `&fecha=${fecha}` : ''}`)}
                                            className="flex-1 min-w-0 text-body-sm font-bold text-content-2 truncate hover:underline">{shortEmployeeName(v.name)}</a>
                                        <span className="text-caption text-content-3 tabular-nums hidden sm:inline">vendió {formatMoney(Number(v.ventas))}</span>
                                        {v.cierre_id
                                            ? <Badge size="sm" variant={Number(v.diferencia) === 0 ? 'success' : 'warning'} uppercase={false}>
                                                {Number(v.diferencia) === 0 ? `Entregó ${formatMoney(Number(v.contado))}` : `Entregó ${formatMoney(Number(v.contado))} (${formatMoney(Number(v.diferencia))})`}
                                            </Badge>
                                            : <Badge size="sm" variant="neutral" uppercase={false}>Por liquidar {formatMoney(Number(v.esperado))}</Badge>}
                                    </li>
                                ))}
                            </ul>
                        )}
                        <h3 className="text-body font-black text-content mt-2">Por forma de pago</h3>
                        <ul className="divide-y divide-divider">
                            {formas.map(([f, m]) => (
                                <li key={f} className="py-1.5 flex justify-between text-body-sm"><span className="text-content-2">{rotuloForma(f)}</span><span className="tabular-nums font-bold">{formatMoney(m)}</span></li>
                            ))}
                        </ul>
                        {d.gastos_lista.length > 0 && (<>
                            <h3 className="text-body font-black text-content mt-2">Gastos de ruta</h3>
                            <ul className="text-caption text-content-2">{d.gastos_lista.map((g, i) => <li key={i}>{g.concepto} · {formatMoney(Number(g.monto))}</li>)}</ul>
                        </>)}
                    </section>

                    <section data-surface="card" className="p-4 flex flex-col gap-3" aria-label="Depósitos y cierre">
                        <h3 className="text-body font-black text-content flex items-center gap-2"><Landmark size={16} className="text-brand-text" /> Depósitos</h3>
                        {d.depositos.length === 0 ? <p className="text-caption text-content-3">Sin depósitos este día.</p> : (
                            <ul className="text-body-sm divide-y divide-divider">
                                {d.depositos.map(x => <li key={x.id} className="py-1.5 flex justify-between gap-2"><span className="truncate">{x.banco} · {x.referencia}</span><span className="tabular-nums font-bold">{formatMoney(Number(x.monto))}</span></li>)}
                            </ul>
                        )}
                        {!cerrado && (
                            <div className="flex flex-col gap-2">
                                <div className="grid grid-cols-2 gap-2">
                                    <PortalInput label="Monto" name="dep-monto" inputMode="decimal" value={dep.monto} onChange={(e) => setDep(x => ({ ...x, monto: e.target.value }))}
                                        placeholder={queda > 0 ? queda.toFixed(2) : '0.00'} />
                                    <PortalInput label="Banco" name="dep-banco" value={dep.banco} onChange={(e) => setDep(x => ({ ...x, banco: e.target.value }))} />
                                </div>
                                <PortalInput label="Número de boleta" name="dep-referencia" value={dep.referencia} onChange={(e) => setDep(x => ({ ...x, referencia: e.target.value }))} />
                                <Button variant="secondary" icon={ocupado === 'dep' ? Loader2 : PlusCircle}
                                    disabled={!(nDep > 0) || !dep.banco.trim() || !dep.referencia.trim() || !!ocupado} onClick={depositar}>Registrar depósito</Button>
                            </div>
                        )}

                        <div className="border-t border-divider pt-3 flex flex-col gap-2">
                            {cerrado ? (<>
                                <p className="text-body-sm font-black text-success-text flex items-center gap-1.5"><Lock size={15} /> Día cerrado</p>
                                <p className="text-caption text-content-3">Cerró {shortEmployeeName(d.cierre.cerrado_por)} a las {hora12(d.cierre.cerrado_at)}{d.cierre.nota ? ` · ${d.cierre.nota}` : ''}.</p>
                                {reabriendo ? (<>
                                    <PortalInput label="¿Por qué se reabre?" name="motivo-reabrir-dia" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                                    <div className="flex justify-end gap-2">
                                        <Button size="sm" variant="ghost" onClick={() => setReabriendo(false)}>Cancelar</Button>
                                        <Button size="sm" variant="secondary" icon={ocupado === 'reabrir' ? Loader2 : Unlock} disabled={!motivo.trim() || !!ocupado} onClick={reabrir}>Reabrir el día</Button>
                                    </div>
                                </>) : <div><Button size="sm" variant="ghost" icon={Unlock} onClick={() => setReabriendo(true)}>Reabrir el día</Button></div>}
                            </>) : (<>
                                {queda !== 0 && (
                                    <PortalInput label={queda > 0 ? `Quedan ${formatMoney(queda)} sin depositar: ¿dónde?` : 'Se depositó más de lo recibido: ¿por qué?'}
                                        name="nota-cierre-dia" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Caja fuerte, fondo de mañana…" />
                                )}
                                {queda === 0 && d.pendientes === 0 && <p className="text-caption text-success-text flex items-center gap-1.5"><CheckCircle2 size={14} /> Todo lo recibido está depositado.</p>}
                                <Button variant="primary" icon={ocupado === 'cerrar' ? Loader2 : Lock}
                                    disabled={d.pendientes > 0 || (queda !== 0 && !nota.trim()) || !!ocupado} onClick={cerrar}>Cerrar el día</Button>
                            </>)}
                        </div>
                    </section>
                </div>
            </>)}
        </div>
    );
}
