import React, { useEffect, useState } from 'react';
import { Camera, CheckCircle2, XCircle, ZoomIn, ZoomOut } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import LiquidModal from '../../components/common/LiquidModal';
import Notice from '../../components/common/Notice';
import PortalTextarea from '../../components/common/PortalTextarea';
import { SkeletonText } from '../../components/common/StateViews';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaTexto } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { codigoDeReserva, decidirReceta } from '@nucleo/data/reservas';
import { firmarRuta } from '@nucleo/data/chatClientes';

// ═══════════════════════════════════════════════════════════════════════════
// Revisar la receta de una reserva de la app (2026-10-12). Un producto bajo
// receta queda «en revisión» hasta que la sala del retiro mira la foto y
// decide: aprobarla (la reserva se confirma y el cliente ya puede pagar),
// pedir otra foto (con el motivo, que le llega al cliente) o rechazarla (la
// reserva se cancela). La función de la base avisa al cliente y anota la
// bitácora; acá sólo se decide.
// ═══════════════════════════════════════════════════════════════════════════

// Las razones de siempre para pedir otra foto: un toque, y el texto se puede
// completar a mano.
const MOTIVOS_OTRA_FOTO = ['No se lee', 'Está vencida', 'No corresponde al producto', 'Falta firma o sello'];
const ZOOMS = [1, 1.5, 2, 3];

export default function RevisarReceta({ reserva, onClose, onDecidida }) {
    const showToast = useToastStore((s) => s.showToast);
    const [url, setUrl] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [zoom, setZoom] = useState(0);
    // null = mirando; 'otra_foto' | 'rechazada' = escribiendo el motivo.
    const [modo, setModo] = useState(null);
    const [motivo, setMotivo] = useState('');
    const [enviando, setEnviando] = useState(null);
    const decidible = reserva.estado === 'en_revision' && reserva.receta_estado === 'pendiente';

    useEffect(() => {
        let vivo = true;
        firmarRuta(reserva.receta_ruta)
            .then((u) => { if (vivo) setUrl(u); })
            .finally(() => { if (vivo) setCargando(false); });
        return () => { vivo = false; };
    }, [reserva.receta_ruta]);

    const decidir = async (decision) => {
        if (decision !== 'aprobada' && !motivo.trim()) {
            showToast('Falta el motivo', 'El cliente lo recibe en la app: dile qué pasó.', 'error');
            return;
        }
        setEnviando(decision);
        try {
            await decidirReceta(reserva.id, decision, decision === 'aprobada' ? null : motivo);
            showToast(
                decision === 'aprobada' ? 'Receta aprobada' : decision === 'otra_foto' ? 'Se pidió otra foto' : 'Receta rechazada',
                decision === 'aprobada' ? 'La reserva quedó confirmada y el cliente recibió el aviso.'
                    : decision === 'otra_foto' ? 'El cliente recibió el aviso para subir otra.' : 'La reserva se canceló y el cliente recibió el aviso.',
                'success',
            );
            onDecidida?.();
        } catch (err) {
            showToast('No se pudo guardar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setEnviando(null);
        }
    };

    const codigo = reserva.pedido ?? codigoDeReserva(reserva.id);
    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-2xl" ariaLabel="Revisar receta">
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h2 className="text-body-xl font-semibold text-content">Receta de {String(reserva.cliente ?? '').split(/\s+/)[0]}</h2>
                    <p className="text-body-sm text-content-2 truncate">
                        {reserva.cantidad} × {reserva.producto} · {codigo}
                        {reserva.receta_subida_at ? ` · subida el ${fechaTexto(reserva.receta_subida_at, { day: 'numeric', month: 'short' })}, ${hora12(reserva.receta_subida_at)}` : ''}
                        {Number(reserva.receta_fotos) > 1 ? ` · foto ${reserva.receta_fotos}` : ''}
                    </p>
                </div>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-3">
                    {!decidible && reserva.receta_estado === 'otra_foto' && (
                        <Notice variant="info">Esperando nueva foto del cliente{reserva.receta_motivo ? ` · se le pidió: ${reserva.receta_motivo}` : ''}.</Notice>
                    )}
                    <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="xs" iconOnly icon={ZoomOut} title="Alejar"
                            disabled={zoom === 0} onClick={() => setZoom((z) => Math.max(0, z - 1))} />
                        <Badge variant="neutral" uppercase={false}>{Math.round(ZOOMS[zoom] * 100)} %</Badge>
                        <Button variant="ghost" size="xs" iconOnly icon={ZoomIn} title="Acercar"
                            disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))} />
                    </div>
                    <div className="rounded-lg border border-border-subtle bg-surface-card overflow-auto overscroll-contain max-h-[55dvh]">
                        {cargando ? <div className="p-4"><SkeletonText lines={4} /></div>
                            : url ? (
                                <img src={url} alt={`Receta de la reserva ${codigo}`} className="block max-w-none"
                                    style={{ width: `${ZOOMS[zoom] * 100}%` }} />
                            ) : <p className="p-4 text-body-sm text-content-3">No se pudo abrir la foto. Cierra y vuelve a intentarlo.</p>}
                    </div>
                    {decidible && modo && (
                        <div className="space-y-2">
                            <p className="text-label font-semibold text-content-2">
                                {modo === 'otra_foto' ? '¿Por qué hace falta otra foto?' : '¿Por qué se rechaza?'} El cliente lo recibe en la app.
                            </p>
                            {modo === 'otra_foto' && (
                                <div className="flex flex-wrap gap-1.5">
                                    {MOTIVOS_OTRA_FOTO.map((m) => (
                                        <Button key={m} size="xs" variant="secondary"
                                            onClick={() => setMotivo(m)}>{m}</Button>
                                    ))}
                                </div>
                            )}
                            <PortalTextarea label="Motivo" name="motivo" rows={2} maxLength={300} value={motivo}
                                onChange={(e) => setMotivo(e.target.value)} />
                        </div>
                    )}
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                {!decidible ? (
                    <Button variant="secondary" onClick={onClose}>Cerrar</Button>
                ) : modo ? (
                    <>
                        <Button variant="secondary" onClick={() => { setModo(null); setMotivo(''); }}>Volver</Button>
                        <Button variant={modo === 'rechazada' ? 'destructive' : 'primary'}
                            icon={modo === 'rechazada' ? XCircle : Camera} loading={enviando === modo}
                            disabled={!motivo.trim()} onClick={() => decidir(modo)}>
                            {modo === 'rechazada' ? 'Rechazar receta' : 'Pedir otra foto'}
                        </Button>
                    </>
                ) : (
                    <>
                        <Button variant="ghost" icon={XCircle} onClick={() => { setModo('rechazada'); setMotivo(''); }}>Rechazar</Button>
                        <Button variant="secondary" icon={Camera} onClick={() => { setModo('otra_foto'); setMotivo(''); }}>Pedir otra foto</Button>
                        <Button icon={CheckCircle2} loading={enviando === 'aprobada'} disabled={!url}
                            onClick={() => decidir('aprobada')}>Aprobar</Button>
                    </>
                )}
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
