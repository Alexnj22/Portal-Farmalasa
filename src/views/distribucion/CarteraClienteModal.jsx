import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { HandCoins, Wallet, Loader2, Printer, Ban, AlertTriangle, CheckCircle2, FileText, SlidersHorizontal } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import PortalInput from '../../components/common/PortalInput';
import LiquidSelect from '../../components/common/LiquidSelect';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import Interruptor from './Interruptor';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { fechaHora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { useToastStore } from '@nucleo/store/toastStore';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { imprimirDocumento } from '@nucleo/utils/ticketPrint';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { ticketDeRecibo, ticketDeEstadoDeCuenta } from '@nucleo/utils/distribucionDocumento';
import { fetchEstadoCuenta, cobrar, anularRecibo, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { FORMA_PAGO, leerMonto } from './comun';
import { repartirCobro } from './cartera';
import { MARCA_PAPEL } from './marca';

// La ficha de cobro de un cliente: qué debe, cobrarle y lo que ya pagó.
//
// El cobro se arma aquí y lo decide la base (`dist_cobrar`, borrador 0014): la
// pantalla muestra antes de cobrar a qué documentos va cada centavo —con la
// misma regla que la base, primero lo que vence antes— o deja repartirlo a
// mano. Un reintento no cobra dos veces (`clientUuid`), el monto no puede
// pasar de lo que se debe, y un cheque o una transferencia llevan su número.

const FORMAS_COBRO = FORMA_PAGO; // sin «a crédito»: un abono no se fía
const aC = (n) => Math.round(Number(n || 0) * 100);

export default function CarteraClienteModal({ cliente, emisor, puedeCobrar, puedeAnular, onClose, onCambio }) {
    const showToast = useToastStore(s => s.showToast);
    const [estado, setEstado] = useState(null);
    const [error, setError] = useState('');
    const [monto, setMonto] = useState('');
    const [forma, setForma] = useState('01');
    const [referencia, setReferencia] = useState('');
    const [recibido, setRecibido] = useState('');
    const [nota, setNota] = useState('');
    const [aMano, setAMano] = useState(false);
    const [manual, setManual] = useState({});      // cxc_id → monto escrito
    const [imprimir, setImprimir] = useState(true);
    const [cobrando, setCobrando] = useState(false);
    const [uuid, setUuid] = useState(() => crypto.randomUUID());
    const [anulando, setAnulando] = useState(null); // recibo id
    const [motivo, setMotivo] = useState('');

    const cargar = useCallback(() => {
        fetchEstadoCuenta(cliente.id).then(setEstado).catch(e => setError(mensajeDeDistribucion(e)));
    }, [cliente.id]);
    useEffect(() => { cargar(); }, [cargar]);

    const cr = estado?.credito ?? {};
    const abiertas = useMemo(() => (estado?.cuentas ?? []).filter(x => x.estado === 'abierta'), [estado]);
    const saldo = Number(cr.saldo ?? 0);
    const vencido = Number(cr.vencido ?? 0);

    // El reparto: a mano (lo escrito por cuenta) o el automático de la base.
    const n = leerMonto(monto) ?? 0;
    const reparto = useMemo(() => {
        if (!aMano) return repartirCobro(abiertas, n).reparto;
        return abiertas.map(x => ({ cxc_id: x.id, monto: leerMonto(manual[x.id]) ?? 0, saldo: Number(x.saldo), queda: Number(x.saldo) - (leerMonto(manual[x.id]) ?? 0) }))
            .filter(r => r.monto > 0);
    }, [aMano, abiertas, n, manual]);
    const totalManual = reparto.reduce((a, r) => a + aC(r.monto), 0) / 100;
    const montoFinal = aMano ? totalManual : n;
    const porCuenta = new Map(reparto.map(r => [r.cxc_id, r]));
    const recibidoN = leerMonto(recibido);
    const cambio = forma === '01' && recibidoN != null ? (aC(recibidoN) - aC(montoFinal)) / 100 : null;

    // Lo que impide cobrar, dicho antes de apretar.
    const problema = !puedeCobrar ? 'No tienes permiso para cobrar.'
        : !(montoFinal > 0) ? null
        : aC(montoFinal) > aC(saldo) ? `El cliente debe ${formatMoney(saldo)}: no se puede cobrar más.`
        : aMano && reparto.some(r => aC(r.monto) > aC(r.saldo)) ? 'A una cuenta se le abona más de lo que debe.'
        : ['04', '05'].includes(forma) && !referencia.trim() ? 'Un cheque o una transferencia llevan su número.'
        : cambio != null && cambio < 0 ? 'Lo entregado no alcanza.'
        : null;
    const listo = montoFinal > 0 && !problema && !cobrando;

    const hacerCobro = async () => {
        if (!listo) return;
        setCobrando(true);
        setError('');
        try {
            const recibo = await cobrar({
                clienteId: cliente.id, monto: montoFinal, forma, clientUuid: uuid,
                referencia: referencia.trim() || null, recibido: forma === '01' ? recibidoN : null, nota: nota.trim() || null,
                aplicacion: aMano ? reparto.map(r => ({ cxc_id: r.cxc_id, monto: r.monto })) : null,
            });
            useStaff.getState().appendAuditLog('DISTRIBUCION_COBRO', String(recibo.id), { cliente: cliente.id, monto: montoFinal, forma });
            showToast('Cobro registrado', `${formatMoney(montoFinal)} · queda debiendo ${formatMoney(recibo.saldo_cliente)}`, 'success');
            if (imprimir) {
                imprimirDocumento(ticketDeRecibo(recibo, MARCA_PAPEL, emisor ?? {}))
                    .catch(e => showToast('No se pudo imprimir el recibo', mensajeAmigable(e), 'warning'));
            }
            setMonto(''); setReferencia(''); setRecibido(''); setNota(''); setManual({}); setAMano(false);
            setUuid(crypto.randomUUID());
            cargar();
            onCambio?.();
        } catch (e) {
            setError(mensajeDeDistribucion(e));
        } finally {
            setCobrando(false);
        }
    };

    const confirmarAnulacion = async (id) => {
        if (!motivo.trim()) return;
        try {
            await anularRecibo(id, motivo.trim());
            useStaff.getState().appendAuditLog('DISTRIBUCION_COBRO_ANULADO', String(id), { motivo: motivo.trim() });
            showToast('Cobro anulado', 'El saldo volvió a las cuentas.', 'success');
            setAnulando(null); setMotivo('');
            cargar();
            onCambio?.();
        } catch (e) {
            setError(mensajeDeDistribucion(e));
        }
    };

    const imprimirEstado = () => {
        imprimirDocumento(ticketDeEstadoDeCuenta({ cliente: cliente.nombre, estado, marca: MARCA_PAPEL, emisor: emisor ?? {} }))
            .catch(e => showToast('No se pudo imprimir', mensajeAmigable(e), 'warning'));
    };

    const nombreForma = (f) => FORMA_PAGO.find(x => x.value === f)?.label ?? f;

    return (
        <LiquidModal open onClose={cobrando ? undefined : onClose} maxWidth="max-w-4xl" ariaLabel={`Cuenta de ${cliente.nombre}`}>
            <LiquidModal.Header>
                <div className="flex flex-wrap items-start justify-between gap-3 w-full">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2.5">
                            <HandCoins size={18} className="text-brand-text shrink-0" />
                            <h2 className="text-title font-black text-content truncate">{cliente.nombre}</h2>
                        </div>
                        <p className="text-caption text-content-3 mt-1">{cliente.ruta ?? ''}{cliente.telefono ? ` · Tel. ${cliente.telefono}` : ''}</p>
                    </div>
                    <div className="text-right">
                        <p className="text-caption text-content-3">Debe</p>
                        <p className="text-display font-black text-brand-text tabular-nums" data-testid="saldo-cliente">{formatMoney(saldo)}</p>
                    </div>
                </div>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="flex flex-col gap-4">
                    {error && <Notice variant="danger" icon={AlertTriangle} bloque>{error}</Notice>}
                    {!estado && !error && <p className="text-caption text-content-3">Cargando…</p>}
                    {estado && (<>
                        {/* Crédito: límite, lo que debe, lo vencido y lo que le queda. */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {[
                                ['Límite', formatMoney(cr.limite)],
                                ['Vencido', formatMoney(vencido), vencido > 0 ? 'text-danger-text' : ''],
                                ['Atraso máximo', cr.dias_atraso > 0 ? `${cr.dias_atraso} días` : 'Al día', cr.dias_atraso > 0 ? 'text-danger-text' : 'text-success-text'],
                                ['Disponible', formatMoney(cr.disponible), Number(cr.disponible) <= 0 ? 'text-warning-text' : ''],
                            ].map(([r, v, tono]) => (
                                <div key={r} data-surface="card" className="px-3 py-2">
                                    <p className="text-caption text-content-3">{r}</p>
                                    <p className={`text-body font-black tabular-nums ${tono || 'text-content'}`}>{v}</p>
                                </div>
                            ))}
                        </div>
                        {saldo > Number(cr.limite ?? 0) && (
                            <Notice variant="warning" compact>Debe más que su límite de crédito: no se le puede vender a crédito hasta que abone.</Notice>
                        )}

                        {/* ── Cuentas abiertas: qué documento, cuánto y cuánto le toca de este cobro ── */}
                        <div data-surface="card" className="overflow-hidden">
                            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-divider">
                                <p className="text-micro font-bold uppercase tracking-wide text-content-3">{abiertas.length} documento{abiertas.length === 1 ? '' : 's'} por cobrar</p>
                                {puedeCobrar && abiertas.length > 1 && (
                                    <Button size="sm" variant="ghost" icon={SlidersHorizontal} onClick={() => { setAMano(v => !v); setManual({}); }}>
                                        {aMano ? 'Repartir automático' : 'Repartir a mano'}
                                    </Button>
                                )}
                            </div>
                            {abiertas.length === 0 && (
                                <p className="px-3 py-4 text-caption text-content-3 flex items-center gap-2"><CheckCircle2 size={14} className="text-success-text" /> No debe nada.</p>
                            )}
                            {abiertas.map(x => {
                                const r = porCuenta.get(x.id);
                                const atraso = Number(x.dias);
                                return (
                                    <div key={x.id} data-cuenta={x.id}
                                        className={`grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_7rem_7rem_8rem] gap-2 sm:gap-3 px-3 py-2 border-b border-divider last:border-b-0 items-center ${r ? 'bg-brand/5' : ''}`}>
                                        <div className="min-w-0">
                                            <p className="text-body-sm font-bold text-content-2 font-mono truncate">{x.numero_control}</p>
                                            <p className="text-caption text-content-3">
                                                {fechaNumerica(x.fecha)} · vence {fechaNumerica(x.vence)}
                                                {atraso > 0 && <span className="text-danger-text font-bold"> · {atraso} días de atraso</span>}
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-caption text-content-3 sm:hidden">Debe</p>
                                            <p className="font-black tabular-nums text-content">{formatMoney(x.saldo)}</p>
                                            {Number(x.abonado) > 0 && <p className="text-micro text-content-3 tabular-nums">de {formatMoney(x.monto)}</p>}
                                        </div>
                                        <div className="hidden sm:block text-right text-caption text-content-3 tabular-nums">
                                            {r ? <span className="text-success-text font-bold">−{formatMoney(r.monto)}</span> : '—'}
                                        </div>
                                        <div className="col-span-2 sm:col-span-1 flex justify-end">
                                            {aMano ? (
                                                <PortalInput compact name={`abono-${x.id}`} inputMode="decimal" prefix="$" placeholder="0.00" className="w-32"
                                                    value={manual[x.id] ?? ''} aria-label={`Abono a ${x.numero_control}`}
                                                    onChange={(e) => setManual(m => ({ ...m, [x.id]: e.target.value.replace(/[^0-9.]/g, '') }))} />
                                            ) : r ? (
                                                <span className="text-caption tabular-nums text-content-2">queda {formatMoney(r.queda)}</span>
                                            ) : null}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* ── El cobro ── */}
                        {puedeCobrar && abiertas.length > 0 && (
                            <section data-surface="card" className="p-3 flex flex-col gap-3" data-cobro-cartera
                                onKeyDown={(e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); hacerCobro(); } }}>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-body font-black text-content">Cobrar</p>
                                    {!aMano && (
                                        <div className="flex flex-wrap gap-1.5">
                                            {vencido > 0 && vencido < saldo && (
                                                <Button size="sm" variant="secondary" onClick={() => setMonto(vencido.toFixed(2))}>Lo vencido {formatMoney(vencido)}</Button>
                                            )}
                                            <Button size="sm" variant="secondary" onClick={() => setMonto(saldo.toFixed(2))}>Todo {formatMoney(saldo)}</Button>
                                        </div>
                                    )}
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    {aMano ? (
                                        <div className="flex flex-col justify-end">
                                            <span className="text-caption text-content-3">Monto (suma del reparto)</span>
                                            <span className="text-title font-black tabular-nums text-content">{formatMoney(totalManual)}</span>
                                        </div>
                                    ) : (
                                        <PortalInput label="Monto" name="monto-cobro" inputMode="decimal" prefix="$" placeholder="0.00" value={monto} autoFocus
                                            hasError={aC(n) > aC(saldo)} onChange={(e) => setMonto(e.target.value.replace(/[^0-9.]/g, ''))} />
                                    )}
                                    <div className="flex flex-col gap-1.5">
                                        <span className="text-micro font-bold uppercase tracking-wide text-content-3 px-1">Forma de pago</span>
                                        <LiquidSelect value={forma} options={FORMAS_COBRO} clearable={false} icon={Wallet} ariaLabel="Forma de pago"
                                            onChange={(v) => { setForma(v || '01'); setRecibido(''); }} />
                                    </div>
                                    {forma === '01' ? (
                                        <PortalInput label="Entrega" name="recibido-cobro" inputMode="decimal" prefix="$" placeholder={montoFinal ? montoFinal.toFixed(2) : '0.00'}
                                            value={recibido} hasError={cambio != null && cambio < 0}
                                            onChange={(e) => setRecibido(e.target.value.replace(/[^0-9.]/g, ''))}
                                            helperText={cambio != null && cambio > 0 ? `Cambio ${formatMoney(cambio)}` : undefined} />
                                    ) : (
                                        <PortalInput label={['04', '05'].includes(forma) ? 'Número (obligatorio)' : 'Número o autorización'} name="referencia-cobro"
                                            value={referencia} onChange={(e) => setReferencia(e.target.value)} />
                                    )}
                                </div>
                                <PortalInput label="Nota (opcional)" name="nota-cobro" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: abono acordado por teléfono" />
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <Interruptor checked={imprimir} onChange={setImprimir} label="Imprimir el recibo" />
                                    <div className="flex items-center gap-3 ml-auto">
                                        {problema && <p className="text-caption text-danger-text">{problema}</p>}
                                        <Button variant="primary" icon={cobrando ? Loader2 : HandCoins} disabled={!listo} onClick={hacerCobro} data-cobrar-cartera>
                                            {montoFinal > 0 ? `Cobrar ${formatMoney(montoFinal)}` : 'Cobrar'}
                                        </Button>
                                    </div>
                                </div>
                            </section>
                        )}

                        {/* ── Lo que ya pagó ── */}
                        <div className="flex flex-col gap-2">
                            <p className="text-micro font-bold uppercase tracking-wide text-content-3">Cobros recientes</p>
                            {(estado.recibos ?? []).length === 0 && <p className="text-caption text-content-3">Sin cobros registrados.</p>}
                            {(estado.recibos ?? []).slice(0, 12).map(r => (
                                <div key={r.id} data-surface="card" className={`px-3 py-2 flex flex-col gap-2 ${r.anulado_at ? 'opacity-60' : ''}`} data-recibo={r.id}>
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            {r.recibido_por && <AvatarConEstado emp={r.recibido_por} px={28} radio="rounded-full" marco="" />}
                                            <div className="min-w-0">
                                                <p className="text-body-sm font-bold text-content-2">
                                                    Recibo {r.id} · {nombreForma(r.forma)}{r.referencia ? ` ${r.referencia}` : ''}
                                                    {r.anulado_at && <Badge size="sm" variant="neutral" uppercase={false} className="ml-2">Anulado</Badge>}
                                                </p>
                                                <p className="text-caption text-content-3">
                                                    {fechaHora12(r.created_at)} · {shortEmployeeName(r.recibido_por) || '—'} · {(r.abonos ?? []).length} documento{(r.abonos ?? []).length === 1 ? '' : 's'}
                                                    {r.anulado_at ? ` · ${r.anulado_motivo}` : ''}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <span className="font-black tabular-nums text-content">{formatMoney(r.monto)}</span>
                                            <Button size="sm" variant="ghost" iconOnly icon={Printer} title="Imprimir el recibo"
                                                onClick={() => imprimirDocumento(ticketDeRecibo(r, MARCA_PAPEL, emisor ?? {})).catch(() => {})} />
                                            {puedeAnular && !r.anulado_at && anulando !== r.id && (
                                                <Button size="sm" variant="ghost" iconOnly icon={Ban} title="Anular este cobro" onClick={() => { setAnulando(r.id); setMotivo(''); }} />
                                            )}
                                        </div>
                                    </div>
                                    {anulando === r.id && (
                                        <div className="flex flex-wrap items-end gap-2">
                                            <div className="flex-1 min-w-[12rem]">
                                                <PortalInput label="¿Por qué se anula?" name={`motivo-anular-${r.id}`} value={motivo} autoFocus
                                                    onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: el cheque rebotó" />
                                            </div>
                                            <Button size="sm" variant="ghost" onClick={() => setAnulando(null)}>Cancelar</Button>
                                            <Button size="sm" variant="secondary" tone="danger" icon={Ban} disabled={!motivo.trim()} onClick={() => confirmarAnulacion(r.id)}>Anular cobro</Button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </>)}
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <div className="flex flex-wrap items-center justify-end gap-2 w-full">
                    <Button variant="ghost" onClick={onClose} disabled={cobrando}>Cerrar</Button>
                    {estado && abiertas.length > 0 && (
                        <Button variant="secondary" icon={FileText} onClick={imprimirEstado}>Imprimir estado de cuenta</Button>
                    )}
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
