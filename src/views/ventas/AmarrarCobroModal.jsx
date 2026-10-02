import React, { useEffect, useMemo, useRef, useState } from 'react';
import Button from '../../components/common/Button';
import LiquidModal from '../../components/common/LiquidModal';
import Notice from '../../components/common/Notice';
import SearchInput from '../../components/common/SearchInput';
import { LoadingState } from '../../components/common/StateViews';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { useStaffStore } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import { fetchVentasParaVincular, vincularCobro } from '@nucleo/data/inyecciones';
import { unaSolaVez } from '@nucleo/utils/unaSolaVez';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { hora12 } from '@nucleo/utils/hora';
import { fechaNumerica } from '@nucleo/utils/fecha';

/*
 * Amarrar a mano un cobro que quedó suelto: los de texto libre de antes del
 * control, y los de «la venta no aparece todavía». Se elige el RENGLÓN y no
 * sólo la venta, porque es el renglón el que tiene el saldo de aplicaciones.
 *
 * La venta tiene que ser de la misma sala que el cobro —lo frena la base—, así
 * que la lista ya viene filtrada por esa sala. Quedan aplicadas a la hora del
 * cobro: es lo que pasó. Se deshace desde la fila de la venta.
 */

const fechaCorta = (f) => fechaNumerica(f, { anio: false });

export default function AmarrarCobroModal({ cobro, onClose, onHecho }) {
    const showToast = useToastStore((s) => s.showToast);
    const [texto, setTexto] = useState('');
    const buscar = useTextoRebotado(texto, 350);
    const [ventas, setVentas] = useState(null);
    const [error, setError] = useState(null);
    const [elegido, setElegido] = useState(null);   // { invoice_id, linea_num }
    const [enviando, setEnviando] = useState(false);

    useEffect(() => {
        let vivo = true;
        fetchVentasParaVincular({ sala: cobro.branch_id, buscar })
            .then((d) => { if (vivo) setVentas(d); })
            .catch((e) => { if (vivo) { setVentas([]); setError(mensajeAmigable(e, 'No se pudieron cargar las ventas')); } });
        return () => { vivo = false; };
    }, [cobro.branch_id, buscar]);

    // Las ventas del día del cobro primero: es casi siempre ahí.
    const ordenadas = useMemo(() => [...(ventas || [])].sort((a, b) =>
        Number(b.fecha === cobro.fecha) - Number(a.fecha === cobro.fecha)), [ventas, cobro.fecha]);

    const cuerpo = useRef(null);
    cuerpo.current = async () => {
        setEnviando(true);
        try {
            const n = await vincularCobro({ cobroId: cobro.id, invoiceId: elegido.invoice_id, lineaNum: elegido.linea_num });
            useStaffStore.getState().appendAuditLog('INYECCION_COBRO_AMARRADO', String(cobro.id),
                { venta: elegido.invoice_id, renglon: elegido.linea_num, aplicaciones: n });
            showToast('Cobro amarrado', n === 1 ? 'Una aplicación, aplicada a la hora del cobro.' : `${n} aplicaciones, aplicadas a la hora del cobro.`, 'success');
            onHecho?.();
        } catch (e) {
            showToast('No se pudo amarrar', mensajeAmigable(e), 'error');
        } finally {
            setEnviando(false);
        }
    };
    const amarrar = useMemo(() => unaSolaVez(() => cuerpo.current()), []);

    return (
        <LiquidModal open onClose={enviando ? undefined : onClose} maxWidth="max-w-lg" ariaLabel="Amarrar el cobro a una venta">
            <div className="p-5 space-y-4">
                <div>
                    <h3 className="text-h3 font-bold text-content">Amarrar el cobro a una venta</h3>
                    <p className="text-body-sm text-content-2 mt-1">
                        {fechaCorta(cobro.fecha)} · {hora12(cobro.hora)} · {formatMoney(cobro.monto)} · {cobro.concepto}
                    </p>
                </div>
                <SearchInput value={texto} onChange={setTexto} placeholder="Cliente o número de factura" />
                {error && <Notice variant="danger">{error}</Notice>}
                {ventas == null ? <LoadingState /> : ordenadas.length === 0 ? (
                    <p className="text-body-sm text-content-3">No hay ventas con inyección que coincidan.</p>
                ) : (
                    <ul className="space-y-2 max-h-[50vh] overflow-y-auto">
                        {ordenadas.map((v) => (
                            <li key={v.id} data-surface="card" className="rounded-xl p-3 ring-1 ring-border-card">
                                <div className="flex items-baseline justify-between gap-2">
                                    <span className="text-body-sm font-bold text-content truncate">{v.cliente || 'Sin nombre'}</span>
                                    <span className="text-caption text-content-3 whitespace-nowrap">{fechaCorta(v.fecha)} · {hora12(v.hora)}</span>
                                </div>
                                <p className="text-caption text-content-3">
                                    Factura {String(v.correlativo || '').replace(/^0+/, '')} · {v.vendedor_nombre ? shortEmployeeName(v.vendedor_nombre) : '—'}
                                </p>
                                <div className="mt-1 space-y-1">
                                    {(v.renglones || []).map((r) => {
                                        const activo = elegido?.invoice_id === v.id && elegido?.linea_num === r.linea_num;
                                        return (
                                            <button key={r.linea_num} type="button" disabled={r.disponibles <= 0}
                                                aria-pressed={activo}
                                                onClick={() => setElegido({ invoice_id: v.id, linea_num: r.linea_num })}
                                                className={`w-full text-left rounded-lg px-2 py-1 text-caption min-h-[var(--tap-min)] active:scale-[0.97]
                                                    ${activo ? 'ring-2 ring-accent text-content font-bold' : 'text-content-2'}
                                                    ${r.disponibles <= 0 ? 'opacity-50' : ''}`}>
                                                {Number(r.cantidad)}× {r.descripcion} · {r.disponibles > 0 ? `${r.disponibles} sin pagar` : 'ya pagadas'}
                                            </button>
                                        );
                                    })}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={onClose} disabled={enviando}>Cancelar</Button>
                    <Button variant="primary" loading={enviando} disabled={!elegido} onClick={amarrar}>Amarrar</Button>
                </div>
            </div>
        </LiquidModal>
    );
}
