import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Wallet, Receipt, HandCoins, Undo2, AlertTriangle, CheckCircle2, Printer, Loader2, Lock, Unlock, FileText, Banknote, UserRound } from 'lucide-react';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import PortalInput from '../../components/common/PortalInput';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { hoySV } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { imprimirDocumento } from '@nucleo/utils/ticketPrint';
import { ticketDeLiquidacion } from '@nucleo/utils/distribucionDocumento';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import {
    fetchLiquidacion, fetchLiquidacionesDelDia, cerrarLiquidacion, reabrirLiquidacion, mensajeDeDistribucion, fetchVendedores,
} from '@nucleo/data/distribucion';
import FilterBar from '../../components/common/FilterBar';
import FiltroDia from './FiltroDia';
import CajaDelVendedor from './CajaDelVendedor';
import { FORMA_PAGO, leerMonto, TIPO_DOCUMENTO } from './comun';
import { MARCA_PAPEL } from './marca';

// La liquidación diaria del vendedor (borrador 0020): lo que vendió, lo que
// cobró, lo que le devolvieron y el efectivo que tiene que entregar. El día y
// el vendedor van en la dirección (`?fecha=`, `?vendedor=`), así un enlace
// abre exactamente esa liquidación.
//
// Un vendedor ve la suya. Quien administra ve a todos los que tuvieron
// movimiento ese día, cuenta el efectivo y cierra: una diferencia exige motivo.

const COLS_VENTAS = [
    { key: 'documento', label: 'Documento', align: 'left' },
    { key: 'cliente', label: 'Cliente', align: 'left', hideBelow: 'sm' },
    { key: 'hora', label: 'Hora', align: 'left', hideBelow: 'md' },
    { key: 'total', label: 'Total', align: 'right' },
];
const rotuloForma = (f) => (f === '13' ? 'A crédito' : FORMA_PAGO.find(x => x.value === f)?.label ?? f);

export default function TabLiquidacion({ emisor, puedeConfigurar }) {
    const { user } = useAuth();
    const showToast = useToastStore(s => s.showToast);
    const [params, setParams] = useSearchParams();
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(params.get('fecha') ?? '') ? params.get('fecha') : hoySV();
    const vendedorId = puedeConfigurar ? (params.get('vendedor') || null) : user?.id ?? null;
    const cambiar = (k, v) => setParams(p => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });

    const [delDia, setDelDia] = useState([]);
    const [vendedores, setVendedores] = useState([]);
    const [liq, setLiq] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');
    const [contado, setContado] = useState('');
    const [nota, setNota] = useState('');
    const [ocupado, setOcupado] = useState('');
    const [reabriendo, setReabriendo] = useState(false);
    const [motivo, setMotivo] = useState('');

    const cargar = useCallback(async () => {
        setCargando(true);
        setError('');
        try {
            const [lista, todos] = puedeConfigurar ? await Promise.all([fetchLiquidacionesDelDia(fecha), fetchVendedores()]) : [[], []];
            setDelDia(lista);
            setVendedores(todos);
            const quien = vendedorId ?? lista[0]?.id ?? null;
            setLiq(quien ? await fetchLiquidacion(quien, fecha) : null);
        } catch (e) {
            console.error('liquidación', e);
            setError(mensajeDeDistribucion(e));
        } finally {
            setCargando(false);
        }
    }, [fecha, vendedorId, puedeConfigurar]);
    useEffect(() => { cargar(); }, [cargar]);
    useEffect(() => { setContado(''); setNota(''); setReabriendo(false); }, [fecha, vendedorId]);

    const esperado = Number(liq?.efectivo?.esperado ?? 0);
    const cont = leerMonto(contado);
    const dif = cont == null ? null : Math.round((cont - esperado) * 100) / 100;
    const listo = cont != null && (dif === 0 || nota.trim() !== '') && !ocupado;
    const formas = useMemo(() => {
        const m = new Map();
        for (const f of liq?.por_forma ?? []) {
            const x = m.get(f.forma) ?? { forma: f.forma, ventas: 0, cobros: 0 };
            x[f.origen] += Number(f.monto);
            m.set(f.forma, x);
        }
        return [...m.values()];
    }, [liq]);

    const cerrar = async () => {
        setOcupado('cerrar');
        setError('');
        try {
            const r = await cerrarLiquidacion(liq.vendedor.id, fecha, cont, nota.trim());
            useStaff.getState().appendAuditLog('DISTRIBUCION_LIQUIDACION_CERRADA', String(r?.id ?? ''),
                { vendedor: liq.vendedor.id, fecha, esperado: r?.esperado, contado: r?.contado, diferencia: r?.diferencia });
            showToast('Liquidación cerrada', Number(r?.diferencia) === 0 ? 'Sin diferencia.' : `${Number(r.diferencia) > 0 ? 'Sobrante' : 'Faltante'} de ${formatMoney(Math.abs(Number(r.diferencia)))}.`,
                Number(r?.diferencia) === 0 ? 'success' : 'warning');
            await cargar();
        } catch (e) {
            setError(mensajeDeDistribucion(e));
        } finally {
            setOcupado('');
        }
    };
    const reabrir = async () => {
        setOcupado('reabrir');
        setError('');
        try {
            await reabrirLiquidacion(liq.cierre.id, motivo.trim());
            useStaff.getState().appendAuditLog('DISTRIBUCION_LIQUIDACION_REABIERTA', String(liq.cierre.id), { motivo: motivo.trim() });
            setReabriendo(false); setMotivo('');
            await cargar();
        } catch (e) {
            setError(mensajeDeDistribucion(e));
        } finally {
            setOcupado('');
        }
    };
    const imprimir = () => imprimirDocumento(ticketDeLiquidacion(liq, MARCA_PAPEL, emisor ?? {}))
        .catch(e => showToast('No se pudo imprimir', mensajeAmigable(e), 'warning'));

    const c = liq?.cierre;
    return (
        <div className="p-3 md:p-5 flex flex-col gap-4">
            {/* Resumen a la izquierda, la píldora de filtros a la derecha (DESIGN §17). */}
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                {liq ? (
                    <CarrilCards className="flex-1" ariaLabel="Resumen de la liquidación">
                        <StatCard icon={Receipt} label="Vendido" value={formatMoney(Number(liq.ventas.total))} loading={cargando}
                            iconBg="bg-brand/10" iconCls="text-brand-text" sub={`${formatQty(Number(liq.ventas.documentos))} documentos · ${formatMoney(Number(liq.credito))} a crédito`} />
                        <StatCard icon={HandCoins} label="Cobrado de cartera" value={formatMoney(Number(liq.cobros.total))} loading={cargando}
                            iconBg="bg-success/10" iconCls="text-success" sub={`${formatQty(liq.cobros.lista.length)} cobros`} />
                        <StatCard icon={Undo2} label="Devuelto" value={formatMoney(Number(liq.devoluciones.total))} loading={cargando}
                            iconBg="bg-warning/10" iconCls="text-warning" sub={Number(liq.devoluciones.a_favor) > 0 ? `${formatMoney(Number(liq.devoluciones.a_favor))} a favor de clientes` : 'Notas de crédito'} />
                        <StatCard icon={Wallet} label="Efectivo a entregar" value={formatMoney(esperado)} loading={cargando}
                            iconBg="bg-chart-3/10" iconCls="text-chart-3"
                            sub={Number(liq.efectivo.fondo) > 0 ? `Incluye ${formatMoney(Number(liq.efectivo.fondo))} de fondo de cambio` : `${formatMoney(Number(liq.efectivo.ventas))} ventas + ${formatMoney(Number(liq.efectivo.cobros))} cobros`} />
                    </CarrilCards>
                ) : <div className="flex-1" />}
                <div className="flex justify-end min-w-0">
                    <FilterBar onClear={() => { cambiar('fecha', ''); cambiar('vendedor', ''); }}
                        activeCount={(fecha !== hoySV() ? 1 : 0) + (params.get('vendedor') ? 1 : 0)}
                        acciones={liq ? [{ key: 'imprimir', icon: Printer, label: 'Imprimir liquidación', onClick: imprimir }] : []}>
                        <FilterBar.Section active={fecha !== hoySV()} onClear={() => cambiar('fecha', '')} label="fecha">
                            <FiltroDia fecha={fecha} onChange={(d) => cambiar('fecha', d !== hoySV() ? d : '')} />
                        </FilterBar.Section>
                        {puedeConfigurar && (
                            <FilterBar.Section active={!!params.get('vendedor')} onClear={() => cambiar('vendedor', '')} label="vendedor">
                                <FilterBar.Opciones label="Vendedor" icon={UserRound} umbral={1} ancho="200px"
                                    value={vendedorId ?? delDia[0]?.id ?? ''} onChange={(v) => cambiar('vendedor', v || '')}
                                    options={[...delDia, ...vendedores.filter(v => !delDia.some(d => d.id === v.id))]
                                        .map(v => ({ value: v.id, label: shortEmployeeName(v.name) }))} />
                            </FilterBar.Section>
                        )}
                    </FilterBar>
                </div>
            </div>
            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}

            {/* Quien administra: los vendedores del día y su estado —un vistazo,
                no un filtro: el filtro es la ranura «vendedor» de la píldora—. */}
            {puedeConfigurar && delDia.length > 0 && (
                <section data-surface="card" className="p-3 flex flex-wrap gap-2" aria-label="Vendedores del día">
                    {delDia.map(v => {
                        const activo = (vendedorId ?? delDia[0]?.id) === v.id;
                        return (
                            <button key={v.id} type="button" aria-pressed={activo} data-vendedor={v.id}
                                onClick={() => cambiar('vendedor', v.id)}
                                className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 min-h-[var(--tap-min)] text-left transition-colors active:scale-[0.98] ${activo ? 'border-brand bg-brand/10' : 'border-divider hover:bg-surface-card-hover'}`}>
                                <AvatarConEstado emp={{ id: v.id, name: v.name, photo_url: v.photo_url }} px={28} radio="rounded-full" marco="" />
                                <span className="min-w-0">
                                    <span className="block text-body-sm font-bold text-content-2 truncate">{shortEmployeeName(v.name)}</span>
                                    <span className="block text-caption text-content-3 tabular-nums">{formatMoney(Number(v.esperado))} en efectivo</span>
                                </span>
                                {v.cierre_id
                                    ? <Badge size="sm" variant={Number(v.diferencia) === 0 ? 'success' : 'warning'} uppercase={false}>{Number(v.diferencia) === 0 ? 'Cerrada' : `Cerrada ${formatMoney(Number(v.diferencia))}`}</Badge>
                                    : <Badge size="sm" variant="neutral" uppercase={false}>Por cerrar</Badge>}
                            </button>
                        );
                    })}
                </section>
            )}

            {liq && (<>
                <CajaDelVendedor liq={liq} fecha={fecha} esHoy={fecha === hoySV()} puedeAdministrar={!!liq.puede_cerrar} onCambio={cargar} />

                {Number(liq.devoluciones.a_favor) > 0 && (
                    <Notice variant="info" icon={Undo2}>
                        Hay {formatMoney(Number(liq.devoluciones.a_favor))} de devoluciones a favor de clientes. No se restan del efectivo:
                        si el vendedor se lo devolvió en la ruta, anótalo como motivo de la diferencia.
                    </Notice>
                )}

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                    <section data-surface="card" className="p-4 flex flex-col gap-3 xl:col-span-2" aria-label="Formas de pago">
                        <h3 className="text-body font-black text-content flex items-center gap-2"><Banknote size={16} className="text-brand-text" /> Por forma de pago</h3>
                        {formas.length === 0 ? <p className="text-caption text-content-3">Sin pagos este día.</p> : (
                            <ul className="divide-y divide-divider">
                                {formas.map(f => (
                                    <li key={f.forma} className="py-2 flex items-center justify-between gap-3 text-body-sm" data-forma={f.forma}>
                                        <span className="font-bold text-content-2">{rotuloForma(f.forma)}</span>
                                        <span className="text-caption text-content-3 tabular-nums flex-1 text-right">
                                            {f.ventas ? `ventas ${formatMoney(f.ventas)}` : ''}{f.ventas && f.cobros ? ' · ' : ''}{f.cobros ? `cobros ${formatMoney(f.cobros)}` : ''}
                                        </span>
                                        <span className="font-black tabular-nums text-content w-28 text-right">{formatMoney(f.ventas + f.cobros)}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                        {liq.cheques.length > 0 && (
                            <div>
                                <p className="text-caption font-bold text-content-2 mb-1">Cheques a entregar</p>
                                <ul className="text-caption text-content-2">
                                    {liq.cheques.map((ch, i) => <li key={i} className="tabular-nums">{ch.cliente} · {ch.referencia ?? 'sin número'} · {formatMoney(Number(ch.monto))}</li>)}
                                </ul>
                            </div>
                        )}
                    </section>

                    {/* ── El cierre ── */}
                    <section data-surface="card" className="p-4 flex flex-col gap-3" aria-label="Cierre" data-cierre={c ? 'cerrada' : 'abierta'}>
                        <h3 className="text-body font-black text-content flex items-center gap-2">
                            {c ? <Lock size={16} className="text-success-text" /> : <Unlock size={16} className="text-warning-text" />}
                            {c ? 'Liquidación cerrada' : 'Por cerrar'}
                        </h3>
                        {c ? (<>
                            <dl className="grid grid-cols-2 gap-y-1 text-body-sm">
                                <dt className="text-content-3">Esperado</dt><dd className="text-right tabular-nums">{formatMoney(Number(c.esperado))}</dd>
                                <dt className="text-content-3">Contado</dt><dd className="text-right tabular-nums">{formatMoney(Number(c.contado))}</dd>
                                <dt className="text-content-3">Diferencia</dt>
                                <dd className={`text-right tabular-nums font-black ${Number(c.diferencia) === 0 ? 'text-success-text' : 'text-danger-text'}`} data-diferencia>
                                    {Number(c.diferencia) === 0 ? 'Sin diferencia' : `${Number(c.diferencia) > 0 ? 'Sobrante' : 'Faltante'} ${formatMoney(Math.abs(Number(c.diferencia)))}`}
                                </dd>
                            </dl>
                            {c.nota && <p className="text-caption text-content-2">Motivo: {c.nota}</p>}
                            <p className="text-caption text-content-3">Cerró {shortEmployeeName(c.cerrada_por)} a las {hora12(c.cerrada_at)}.</p>
                            {c.cambio_despues && (
                                <Notice variant="warning" icon={AlertTriangle} bloque>
                                    Hubo ventas o cobros después del cierre: el efectivo a entregar ahora es {formatMoney(esperado)}. Reábrela para volver a contar.
                                </Notice>
                            )}
                            {liq.puede_cerrar && (reabriendo ? (
                                <div className="flex flex-col gap-2">
                                    <PortalInput label="¿Por qué se reabre?" name="motivo-reabrir" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                                    <div className="flex justify-end gap-2">
                                        <Button size="sm" variant="ghost" onClick={() => setReabriendo(false)}>Cancelar</Button>
                                        <Button size="sm" variant="secondary" icon={ocupado === 'reabrir' ? Loader2 : Unlock} disabled={!motivo.trim() || !!ocupado} onClick={reabrir}>Reabrir</Button>
                                    </div>
                                </div>
                            ) : <Button size="sm" variant="ghost" icon={Unlock} onClick={() => setReabriendo(true)}>Reabrir</Button>)}
                        </>) : liq.puede_cerrar ? (<>
                            <PortalInput label="Efectivo contado" name="efectivo-contado" inputMode="decimal" value={contado}
                                onChange={(e) => setContado(e.target.value)} placeholder={esperado.toFixed(2)}
                                hasError={contado !== '' && cont == null} errorMessage="Escribe un monto" />
                            {dif != null && (
                                <p className={`text-body-sm font-black tabular-nums ${dif === 0 ? 'text-success-text' : 'text-danger-text'}`} data-diferencia-previa>
                                    {dif === 0 ? <><CheckCircle2 size={14} className="inline -mt-0.5" /> Cuadra</> : `${dif > 0 ? 'Sobran' : 'Faltan'} ${formatMoney(Math.abs(dif))}`}
                                </p>
                            )}
                            {dif != null && dif !== 0 && (
                                <PortalInput label="Motivo de la diferencia" name="motivo-diferencia" value={nota} onChange={(e) => setNota(e.target.value)}
                                    placeholder="Ej.: devolvió $5 al cliente de la nota de crédito" />
                            )}
                            <Button variant="primary" icon={ocupado === 'cerrar' ? Loader2 : Lock} disabled={!listo} onClick={cerrar}>Cerrar liquidación</Button>
                        </>) : (
                            <p className="text-caption text-content-3">La cierra quien recibe el efectivo.</p>
                        )}
                    </section>
                </div>

                <DataTable columns={COLS_VENTAS} movil={{ usarAccionDeFila: false }} loading={cargando} minWidth="320px"
                    empty={{ icon: FileText, message: 'Sin ventas', subtext: 'No facturó este día.' }}>
                    {liq.ventas.lista.map((v, i) => (
                        <DataRow key={v.id} index={i}>
                            <DataCell>
                                <p className="text-body-sm font-bold text-content-2">{TIPO_DOCUMENTO[v.tipo]?.largo}</p>
                                <p className="text-caption text-content-3 font-mono">{v.numero_control}</p>
                            </DataCell>
                            <DataCell hideBelow="sm"><span className="text-body-sm text-content-2">{v.cliente}</span></DataCell>
                            <DataCell hideBelow="md"><span className="text-caption tabular-nums text-content-3">{hora12(v.hora)}</span></DataCell>
                            <DataCell align="right"><span className="tabular-nums font-black text-content">{formatMoney(Number(v.total))}</span></DataCell>
                        </DataRow>
                    ))}
                </DataTable>
                {liq.cobros.lista.length > 0 && (
                    <section data-surface="card" className="p-4" aria-label="Cobros del día">
                        <h3 className="text-body font-black text-content mb-2">Cobros de cartera</h3>
                        <ul className="divide-y divide-divider">
                            {liq.cobros.lista.map(r => (
                                <li key={r.id} className="py-2 flex items-center justify-between gap-3 text-body-sm">
                                    <span className="min-w-0 truncate text-content-2">{r.cliente}</span>
                                    <span className="text-caption text-content-3">{rotuloForma(r.forma)} · {hora12(r.hora)}</span>
                                    <span className="font-black tabular-nums">{formatMoney(Number(r.monto))}</span>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}
            </>)}
            {!liq && !cargando && !puedeConfigurar && (
                <Notice variant="info" icon={FileText}>Este día no vendiste ni cobraste.</Notice>
            )}
        </div>
    );
}
