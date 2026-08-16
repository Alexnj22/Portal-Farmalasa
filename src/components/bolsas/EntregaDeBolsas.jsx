import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Send } from 'lucide-react';
import Button from '../common/Button';
import Checkbox from '../common/Checkbox';
import LiquidModal from '../common/LiquidModal';
import Notice from '../common/Notice';
import PruebaDeIdentidad from './PruebaDeIdentidad';
import { entregarBolsas, probarIdentidad } from '../../data/bolsas';
import { formatMoney } from '../../utils/formatNumber';
import { mensajeAmigable } from '../../utils/errorMessages';
import { useToastStore } from '../../store/toastStore';

/**
 * Entregar el efectivo de la sala a quien lo recolecta.
 *
 * Es el paso que el usuario describió así (2026-08-16): «el dependiente de la
 * sala abre el módulo, marca entregar dinero, selecciona los días, y confirma;
 * al confirmar pide que se escanee el carné (o poner usuario y contraseña) y
 * queda registrado quién lo recibió».
 *
 * ── Se elige por DÍA, no bolsa por bolsa ───────────────────────────────────
 * Una sala junta dos o tres bolsas por día y entrega cada tres días, así que lo
 * que la persona tiene delante son «los días que se lleva», no ocho folios
 * sueltos. Cada día se marca entero; el detalle queda visible debajo para poder
 * cotejarlo contra las bolsas físicas antes de firmar.
 *
 * ── Por qué la identidad va acá y no en la remesa ──────────────────────────
 * Éste es el momento de mayor riesgo del circuito: el efectivo sale de la sala y
 * todavía no llegó a administración — no está ni de un lado ni del otro. Sacar
 * una remesa, en cambio, no la pide: quien recibe es el cliente y lo identifica
 * la boleta del POS. Esa diferencia vive en el catálogo
 * (`bolsas_tipos_salida.pide_receptor`), no en un `if` escrito acá.
 */
export default function EntregaDeBolsas({ abierto, bolsas, saldoDe, nombreSala, onClose, onHecho }) {
    const showToast = useToastStore((s) => s.showToast);

    const [dias, setDias] = useState(() => new Set());
    const [quien, setQuien] = useState('');
    const [metodo, setMetodo] = useState('CARNE');
    const [secreto, setSecreto] = useState('');
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState(null);

    // Al cerrar se olvida TODO, y la clave la primera: un secreto que sobrevive
    // al diálogo es un secreto que alguien puede volver a mandar sin saberlo.
    useEffect(() => {
        if (abierto) return;
        setDias(new Set()); setQuien(''); setSecreto(''); setError(null);
    }, [abierto]);

    // Los días con bolsas en la sala, del más viejo al más nuevo: lo que lleva
    // más tiempo esperando es lo que primero hay que sacar.
    const porDia = useMemo(() => {
        const m = new Map();
        for (const b of bolsas || []) {
            if (!m.has(b.fecha)) m.set(b.fecha, []);
            m.get(b.fecha).push(b);
        }
        return [...m.entries()]
            .map(([fecha, lista]) => ({
                fecha,
                lista: [...lista].sort((a, b) => String(a.hora).localeCompare(String(b.hora))),
                total: lista.reduce((a, b) => a + Number(saldoDe?.(b) ?? b.monto_inicial ?? 0), 0),
            }))
            .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
    }, [bolsas, saldoDe]);

    // Preseleccionar TODOS los días al abrir: entregar todo lo que hay es el
    // caso normal, y desmarcar es más rápido que marcar de a uno.
    useEffect(() => {
        if (!abierto) return;
        setDias(new Set(porDia.map((d) => d.fecha)));
        // Sólo al abrir: si siguiera a `porDia`, recargar la lista de fondo
        // volvería a marcar los días que la persona acaba de desmarcar.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [abierto]);

    const elegidas = useMemo(
        () => porDia.filter((d) => dias.has(d.fecha)).flatMap((d) => d.lista),
        [porDia, dias],
    );
    const total = useMemo(
        () => elegidas.reduce((a, b) => a + Number(saldoDe?.(b) ?? b.monto_inicial ?? 0), 0),
        [elegidas, saldoDe],
    );

    const alternarDia = useCallback((fecha) => setDias((prev) => {
        const s = new Set(prev);
        if (s.has(fecha)) s.delete(fecha); else s.add(fecha);
        return s;
    }), []);

    const falta = useMemo(() => {
        if (!elegidas.length) return 'Falta elegir qué días se lleva.';
        if (!quien) return 'Falta quién se lleva el efectivo.';
        if (!secreto.trim()) {
            return metodo === 'CARNE' ? 'Falta escanear el carné.' : 'Falta la contraseña.';
        }
        return null;
    }, [elegidas, quien, secreto, metodo]);

    const confirmar = useCallback(async () => {
        if (falta || guardando) return;
        setGuardando(true);
        setError(null);
        try {
            // Dos llamadas a propósito: la del secreto confirma sola, así que un
            // intento fallido queda registrado aunque la entrega no llegue a
            // escribirse. Ver `probarIdentidad` en `data/bolsas.js`.
            const { data: vale, error: idErr } = await probarIdentidad({
                employeeId: quien, metodo, secreto,
            });
            setSecreto('');   // se olvida apenas se manda, salga bien o mal
            if (idErr) { setError(mensajeAmigable(idErr, 'Vuelve a intentar.')); return; }

            const { data: entrega, error: err } = await entregarBolsas(
                elegidas.map((b) => b.id), quien, vale,
            );
            if (err) { setError(mensajeAmigable(err, 'Vuelve a intentar en un momento.')); return; }

            showToast?.('Efectivo entregado',
                `${entrega.folio} · ${elegidas.length} ${elegidas.length === 1 ? 'bolsa' : 'bolsas'} · ${formatMoney(total)}`,
                'success');
            onHecho?.(entrega, elegidas);
            onClose?.();
        } catch (e) {
            setSecreto('');
            setError(mensajeAmigable(e, 'No se pudo entregar.'));
        } finally {
            setGuardando(false);
        }
    }, [falta, guardando, quien, metodo, secreto, elegidas, total, showToast, onHecho, onClose]);

    return (
        <LiquidModal open={!!abierto} onClose={guardando ? undefined : onClose}
            maxWidth="max-w-lg" className="h-fit" ariaLabel="Entregar el efectivo">
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h3 className="text-body font-bold text-content">Entregar el efectivo</h3>
                    <p className="text-caption text-content-3">
                        {nombreSala ? `${nombreSala} · ` : ''}
                        {porDia.length
                            ? `${porDia.length} ${porDia.length === 1 ? 'día' : 'días'} en la sala`
                            : 'No hay bolsas en la sala'}
                    </p>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body className="space-y-4">
                {!porDia.length && (
                    <Notice variant="info" icon={AlertTriangle}>
                        <span className="font-bold">No hay nada que entregar</span>
                        <span className="block mt-0.5 font-normal text-content-2">
                            Las bolsas nacen al confirmar un corte.
                        </span>
                    </Notice>
                )}

                {porDia.map((d) => (
                    <div key={d.fecha} data-surface="card" className="p-3">
                        <label className="flex items-start gap-2.5 cursor-pointer">
                            <span className="mt-0.5 shrink-0">
                                <Checkbox
                                    size="sm"
                                    checked={dias.has(d.fecha)}
                                    onChange={() => alternarDia(d.fecha)}
                                    aria-label={`Entregar las bolsas del ${d.fecha}`}
                                />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="flex items-baseline justify-between gap-2">
                                    <span className="text-label font-bold text-content">
                                        {d.fecha}
                                    </span>
                                    <span className="text-label font-bold tabular-nums text-content shrink-0">
                                        {formatMoney(d.total)}
                                    </span>
                                </span>
                                <span className="block text-caption text-content-3 mt-0.5">
                                    {d.lista.length} {d.lista.length === 1 ? 'bolsa' : 'bolsas'}
                                    {' · '}
                                    {d.lista.map((b) => b.folio).join(', ')}
                                </span>
                            </span>
                        </label>
                    </div>
                ))}

                {porDia.length > 0 && (
                    <PruebaDeIdentidad
                        quien={quien} onQuien={setQuien}
                        metodo={metodo} onMetodo={setMetodo}
                        secreto={secreto} onSecreto={setSecreto}
                    />
                )}

                {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <div className="flex items-center justify-between gap-3 w-full flex-wrap">
                    <span className="text-caption text-content-3 min-w-0 truncate">
                        {falta || `Se imprime el comprobante que firman los dos · ${formatMoney(total)}`}
                    </span>
                    <div className="flex items-center gap-2 ml-auto">
                        <Button variant="ghost" onClick={onClose} disabled={guardando}>Cancelar</Button>
                        <Button variant="primary" icon={Send} loading={guardando}
                            disabled={!!falta} onClick={confirmar}>
                            Entregar {elegidas.length ? `${elegidas.length} · ${formatMoney(total)}` : ''}
                        </Button>
                    </div>
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
