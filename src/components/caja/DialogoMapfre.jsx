import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import Button from '../common/Button';
import LiquidModal from '../common/LiquidModal';
import Notice from '../common/Notice';
import SearchInput from '../common/SearchInput';
import { LoadingState } from '../common/StateViews';
import BuscarFicha from './BuscarFicha';
import FormaDePago from './FormaDePago';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { fetchFacturasMapfre } from '@nucleo/data/bolsas';
import { estadoDeFormaDePago, FORMA_DE_PAGO_INICIAL } from '@nucleo/utils/formaDePago';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { unaSolaVez } from '@nucleo/utils/unaSolaVez';
import { useToastStore } from '@nucleo/store/toastStore';

/**
 * El pago del asegurado de Mapfre (2026-10-19).
 *
 * La venta a Mapfre se factura al crédito y lo que paga el asegurado se
 * descuenta con puntos: el renglón sin producto de la factura. Este cobro es
 * ESE pago, así que nace de la factura y no de un monto escrito:
 *   · se elige la factura de Mapfre de la sala, y el monto sale de ella;
 *   · el asegurado sale del listado de clientes;
 *   · la lista trae sólo las que esperan el pago (las cobradas, o anotadas
 *     como «Otro» ese día, no se ofrecen: cobrarlas contaría el dinero doble),
 *     y sólo desde el 19-oct-2026, cuando el cobro empezó a existir.
 */
const fechaCorta = (f) => fechaNumerica(f, { anio: false });
const factura = (correlativo) => String(correlativo ?? '').replace(/^0+/, '').split('_')[0] || '—';

export default function DialogoMapfre({ abierto, ocupado, sala, onClose, onCobrar }) {
    const [texto, setTexto] = useState('');
    const buscar = useTextoRebotado(texto, 350);
    // Sólo las que esperan el pago (pedido del usuario): una cobrada no tiene
    // nada que hacer acá, y su cobro se ve en la lista del día.
    const [todas, setFacturas] = useState(null);
    const facturas = useMemo(() => (todas == null ? null : todas.filter((f) => f.estado === 'POR_COBRAR')), [todas]);
    const [error, setError] = useState(null);
    const [vuelta, setVuelta] = useState(0);
    const [elegidaId, setElegidaId] = useState(null);
    const [asegurado, setAsegurado] = useState(null);
    const [pago, setPago] = useState(FORMA_DE_PAGO_INICIAL);
    const [enviando, setEnviando] = useState(false);
    const claveDeEnvio = useRef(null);
    if (claveDeEnvio.current === null) claveDeEnvio.current = globalThis.crypto?.randomUUID?.() ?? `mapfre-${elegidaId}-${texto}`;

    useEffect(() => {
        let vivo = true;
        fetchFacturasMapfre(sala, buscar)
            .then((f) => { if (vivo) { setFacturas(f); setError(null); } })
            .catch((e) => { if (vivo) { setFacturas([]); setError(mensajeAmigable(e)); } });
        return () => { vivo = false; };
    }, [sala, buscar, vuelta]);

    const elegida = useMemo(() => (facturas || []).find((f) => f.id === elegidaId) || null, [facturas, elegidaId]);
    const monto = elegida ? Number(elegida.asegurado) : null;
    const estadoPago = estadoDeFormaDePago(pago, monto);
    const porCobrar = (facturas || []).filter((f) => f.estado === 'POR_COBRAR').length;
    const valido = !!elegida && elegida.estado === 'POR_COBRAR' && !!asegurado && estadoPago.valido;

    const showToast = useToastStore((s) => s.showToast);
    const cuerpo = useRef(null);
    cuerpo.current = async () => {
        setEnviando(true);
        try {
            await onCobrar({ clave: claveDeEnvio.current, monto, factura: elegida, asegurado, pago });
        } catch (e) {
            // `onCobrar` ya avisa lo que el servidor rechaza; esto es lo que
            // reventó antes de llegar (la red, la foto): sin aviso, el botón se
            // reactivaba y nadie sabía que no se cobró.
            showToast('No se pudo cobrar', mensajeAmigable(e), 'error');
        } finally {
            setEnviando(false);
        }
    };
    const cobrar = useMemo(() => unaSolaVez(() => cuerpo.current()), []);

    if (!abierto) return null;

    return (
        <LiquidModal open onClose={enviando ? undefined : onClose} maxWidth="max-w-2xl" ariaLabel="Pago de asegurado Mapfre">
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">Pago de asegurado Mapfre</h2>
                <p className="text-body-sm text-content-2">
                    Elige la factura de Mapfre: lo que paga el asegurado sale del descuento de la factura.
                </p>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-4">
                    <div className="flex items-center gap-2">
                        <SearchInput value={texto} onChange={setTexto} placeholder="Factura o producto" className="flex-1" />
                        <Button variant="ghost" size="sm" icon={RefreshCw} iconOnly title="Actualizar la lista"
                            onClick={() => setVuelta((v) => v + 1)} />
                    </div>

                    {porCobrar > 0 && !elegida && (
                        <Notice variant="warning" compact icon={ShieldCheck}>
                            {porCobrar === 1 ? 'Una factura de Mapfre no tiene' : `${porCobrar} facturas de Mapfre no tienen`} el
                            pago del asegurado anotado.
                        </Notice>
                    )}
                    {error && <Notice variant="danger" compact>{error}</Notice>}

                    {facturas == null ? <LoadingState /> : facturas.length === 0 ? (
                        <p className="text-body-sm text-content-3">
                            {buscar ? 'Ninguna factura de Mapfre por cobrar coincide.' : 'No hay facturas de Mapfre por cobrar en esta sala. Una venta recién hecha tarda hasta un minuto en llegar.'}
                        </p>
                    ) : (
                        <ul className="space-y-2 max-h-[40vh] overflow-y-auto">
                            {facturas.map((f) => {
                                const activa = f.id === elegidaId;
                                return (
                                    <li key={f.id}>
                                        <button type="button" aria-pressed={activa}
                                            onClick={() => setElegidaId(f.id)} data-surface="card"
                                            className={`w-full text-left rounded-xl p-3 min-h-[var(--tap-min)] active:scale-[0.97]
                                                ${activa ? 'ring-2 ring-accent' : 'ring-1 ring-border-card'}`}>
                                            <div className="flex items-baseline justify-between gap-2">
                                                <span className="text-body-sm font-bold text-content">Factura {factura(f.correlativo)}</span>
                                                <span className="text-caption text-content-3 whitespace-nowrap">
                                                    {fechaCorta(f.fecha)} · {hora12(f.hora)}
                                                </span>
                                            </div>
                                            <p className="text-caption text-content-2 mt-0.5">
                                                Paga el asegurado <b className="tabular-nums">{formatMoney(Number(f.asegurado))}</b>
                                                {' · '}Mapfre {formatMoney(Number(f.total_mapfre))}
                                            </p>
                                            {(f.productos || []).slice(0, 3).map((p, i) => (
                                                <p key={i} className="text-caption text-content-3">
                                                    {Number(p.cantidad)}× {p.descripcion}
                                                </p>
                                            ))}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}

                    {elegida && (
                        <>
                            <div>
                                <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5">Asegurado</p>
                                <BuscarFicha ficha={asegurado} onElegir={setAsegurado} rotulo="Asegurado"
                                    ayuda="Búscalo en el listado de clientes. Si no tiene ficha, créala primero en Clientes." />
                            </div>
                            <FormaDePago valor={pago} onCambiar={setPago} monto={monto} montoFijo />
                        </>
                    )}
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="ghost" onClick={onClose} disabled={enviando}>Cancelar</Button>
                <Button variant="primary" loading={enviando} disabled={ocupado || !valido} onClick={cobrar}>
                    {enviando ? 'Cobrando…' : `Cobrar ${monto != null ? formatMoney(monto) : ''}`}
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
