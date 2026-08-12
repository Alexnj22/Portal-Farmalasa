import { useState, useEffect } from 'react';
import { Undo2, Check, X, Loader2, Truck, PackageCheck, AlertTriangle, Image as ImageIcon } from 'lucide-react';
import Button from '../../../components/common/Button';
import PortalInput from '../../../components/common/PortalInput';
import Badge from '../../../components/common/Badge';
import { shortEmployeeName } from '../../../utils/nameUtils';
import { getSignedFileUrl, openStoredFile } from '../../../utils/storageFiles';

// La devolución de un renglón, pegada a su diferencia.
//
// Es una conversación de tres turnos y ninguno se saltea: la sala pide, bodega
// decide —y al aceptar el producto sale de la sala—, y bodega confirma la
// entrada. Ese tercero es el que faltaba: sin él el producto queda en tránsito,
// fuera de la sala y todavía no en bodega, que es peor que estar en cualquiera
// de los dos lados.
//
// Por eso el estado `enviada` se pinta en `warning` y no en `success`: salir no
// es haber llegado.

const MOTIVO_LABEL = { faltante: 'No llegó', danado: 'Dañado', vencido: 'Vencido' };

export default function DevolucionBloque({
    dev, item, isBranch, busyAction, empMap = new Map(), readOnly = false,
    onSolicitar, onDecidir, onMover, onRecibir,
}) {
    const [rechazando, setRechazando] = useState(false);
    const [motivoRech, setMotivoRech] = useState('');
    const [firmadas,   setFirmadas]   = useState([]);

    // El bucket es privado: la URL guardada es la de formato público —que no
    // sirve para mirar— y hay que firmarla. Se firma al pintar el bloque y no al
    // guardar, porque una firma vence y lo que se persiste no puede vencer.
    useEffect(() => {
        let vivo = true;
        const urls = dev?.evidencia_urls ?? [];
        if (!urls.length) { setFirmadas([]); return undefined; }
        Promise.all(urls.map(u => getSignedFileUrl(u)))
            .then(r => { if (vivo) setFirmadas(r.filter(Boolean)); });
        return () => { vivo = false; };
    }, [dev?.id, dev?.evidencia_urls]);

    // ── Todavía no hay devolución: la sala la puede pedir ────────────────────
    if (!dev) {
        if (readOnly || !isBranch) return null;
        // Sólo tiene sentido devolver lo que no cuadró por cantidad o por estado
        // del producto. Una diferencia de presentación no se arregla sacando
        // mercadería de la sala.
        if (!['faltante', 'danado', 'vencido'].includes(item?.error_tipo)) return null;
        return (
            <Button tone="chart-4" icon={Undo2} disabled={busyAction === `dev_${item.id}`}
                onClick={() => onSolicitar?.(item)}>
                {busyAction === `dev_${item.id}` ? <Loader2 size={10} className="animate-spin" /> : 'Devolver a bodega'}
            </Button>
        );
    }

    const decidiendo = busyAction === `devdec_${dev.id}`;
    const moviendo   = busyAction === `devmov_${dev.id}`;
    const recibiendo = busyAction === `devrec_${dev.id}`;
    const quienPidio = dev.solicitada_por ? empMap.get(dev.solicitada_por) : null;
    const quienDecidio = dev.decidida_por ? empMap.get(dev.decidida_por) : null;

    const marco = {
        solicitada: 'border-chart-4/30 bg-chart-4/10',
        aceptada:   'border-chart-3/30 bg-chart-3/10',
        enviando:   'border-chart-3/30 bg-chart-3/10',
        enviada:    'border-warning/40 bg-warning/10',
        recibiendo: 'border-warning/40 bg-warning/10',
        recibida:   'border-success/30 bg-success/10',
        rechazada:  'border-danger/30 bg-danger/10',
        error:      'border-danger/40 bg-danger/10',
    }[dev.estado] ?? 'border-divider bg-surface-card';

    const rotulo = {
        solicitada: 'Devolución pedida',
        aceptada:   'Aceptada — falta que salga de la sala',
        enviando:   'Saliendo de la sala…',
        enviada:    'Salió de la sala — falta que entre a bodega',
        recibiendo: 'Entrando a bodega…',
        recibida:   'Entró en bodega',
        rechazada:  'Devolución rechazada',
        error:      'La devolución no se pudo mover',
    }[dev.estado] ?? dev.estado;

    return (
        <div className={`rounded-xl border px-3 py-2.5 space-y-2 ${marco}`}>
            <div className="flex items-center gap-2 flex-wrap">
                <Undo2 size={12} className="text-content-2 shrink-0" />
                <span className="text-label font-bold text-content-2">{rotulo}</span>
                <Badge variant="neutral" size="sm" uppercase={false}>{MOTIVO_LABEL[dev.motivo] ?? dev.motivo}</Badge>
                <span className="text-caption text-content-3">{dev.cantidad}</span>
                {dev.estado === 'recibida' && <PackageCheck size={12} className="text-success shrink-0" />}
            </div>

            <p className="text-caption text-content-3">
                {dev.viaja
                    ? 'El producto viaja de vuelta a bodega.'
                    : 'No viaja nada: quedó en bodega desde el principio.'}
                {quienPidio && <> · Pedida por {shortEmployeeName(quienPidio)}</>}
            </p>

            {dev.nota && <p className="text-caption text-content-2 italic">«{dev.nota}»</p>}

            {/* La foto del daño: lo único que bodega puede mirar para decidir. */}
            {firmadas.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                    {firmadas.map((u, i) => (
                        <button key={i} type="button" onClick={() => openStoredFile(dev.evidencia_urls[i])}
                            aria-label={`Ver la foto ${i + 1} del producto`}
                            className="w-16 h-16 rounded-lg overflow-hidden border border-border-card bg-surface-card-hover">
                            <img src={u} alt={`Foto ${i + 1}`} className="w-full h-full object-cover" />
                        </button>
                    ))}
                    <span className="text-micro text-content-3 flex items-center gap-1">
                        <ImageIcon size={10} />toca para verla completa
                    </span>
                </div>
            )}

            {dev.aviso && (
                <p className="text-caption text-warning-text flex items-start gap-1.5">
                    <AlertTriangle size={11} className="shrink-0 mt-0.5" />{dev.aviso}
                </p>
            )}
            {dev.error_msg && (
                <p className="text-caption text-danger flex items-start gap-1.5">
                    <AlertTriangle size={11} className="shrink-0 mt-0.5" />{dev.error_msg}
                </p>
            )}
            {dev.motivo_rechazo && (
                <p className="text-caption text-danger">
                    <strong>Bodega dijo que no:</strong> {dev.motivo_rechazo}
                    {quienDecidio && <span className="text-content-3"> — {shortEmployeeName(quienDecidio)}</span>}
                </p>
            )}

            {readOnly ? null : (<>
                {/* ── Bodega decide ── */}
                {dev.estado === 'solicitada' && !isBranch && (
                    rechazando ? (
                        <div className="flex gap-2">
                            <PortalInput
                                aria-label="Por qué no se devuelve" className="flex-1" tono="danger" compact autoFocus
                                value={motivoRech} onChange={e => setMotivoRech(e.target.value)}
                                placeholder="Por qué no…"
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && motivoRech.trim()) onDecidir?.(dev.id, 'rechazar', motivoRech);
                                    if (e.key === 'Escape') setRechazando(false);
                                }}
                            />
                            <Button variant="destructive" disabled={decidiendo || !motivoRech.trim()}
                                onClick={() => onDecidir?.(dev.id, 'rechazar', motivoRech)}>
                                {decidiendo ? <Loader2 size={10} className="animate-spin" /> : 'No devolver'}
                            </Button>
                            <Button variant="ghost" onClick={() => setRechazando(false)}>✕</Button>
                        </div>
                    ) : (
                        <div className="flex gap-2">
                            <Button tone="success" icon={Check} disabled={decidiendo}
                                onClick={() => onDecidir?.(dev.id, 'aceptar', '')}>
                                {decidiendo ? <Loader2 size={10} className="animate-spin" /> : 'Aceptar y sacarlo de la sala'}
                            </Button>
                            <Button variant="destructive" icon={X} onClick={() => setRechazando(true)}>No devolver</Button>
                        </div>
                    )
                )}
                {dev.estado === 'solicitada' && isBranch && (
                    <p className="text-caption text-content-3 italic">Esperando que bodega la revise…</p>
                )}

                {/* ── Salió: falta que entre ── */}
                {(dev.estado === 'enviada' || dev.estado === 'error') && !isBranch && dev.id_traslado && (
                    <div className="space-y-1.5">
                        <Button tone="warning" icon={PackageCheck} disabled={recibiendo}
                            onClick={() => onRecibir?.(dev.id)}>
                            {recibiendo ? <Loader2 size={10} className="animate-spin" /> : 'Ya está en bodega'}
                        </Button>
                        <p className="text-micro text-content-3 leading-snug">
                            {dev.viaja
                                ? 'Confírmalo cuando tengas el producto en la mano, no antes.'
                                : 'Como no viaja nada, se puede confirmar ya mismo.'}
                        </p>
                    </div>
                )}
                {dev.estado === 'enviada' && isBranch && (
                    <p className="text-caption text-content-3 italic">
                        {dev.viaja ? 'Falta que bodega lo reciba.' : 'Falta que bodega lo confirme.'}
                    </p>
                )}

                {/* ── Aceptada pero todavía adentro: se vuelve a intentar ──
                    Aceptar y mover son un gesto solo para quien aprieta; acá
                    abajo son dos escrituras, y ésta es la que puede fallar
                    —sin existencia, presentación cambiada, pausa— sin borrar
                    el acuerdo. */}
                {(dev.estado === 'aceptada'
                  || (dev.estado === 'error' && !dev.id_traslado && !dev.detalle?.revisar_a_mano)) && !isBranch && (
                    <Button tone="chart-3" icon={Truck} disabled={moviendo}
                        onClick={() => onMover?.(dev.id)}>
                        {moviendo ? <Loader2 size={10} className="animate-spin" /> : 'Sacarlo de la sala'}
                    </Button>
                )}

                {/* Una línea que se cortó a mitad de camino NO se reintenta sola:
                    puede haber entrado en el sistema sin que se alcanzara a
                    anotar, y repetirla movería el producto dos veces. */}
                {dev.estado === 'error' && dev.detalle?.revisar_a_mano && (
                    <p className="text-caption text-danger-text font-semibold">
                        Hay que revisarla a mano antes de volver a intentar — busca «{dev.clave}».
                    </p>
                )}

                {/* ── Rechazada: la sala puede volver a pedirla ── */}
                {dev.estado === 'rechazada' && isBranch && (
                    <Button tone="chart-4" icon={Undo2} disabled={busyAction === `dev_${item.id}`}
                        onClick={() => onSolicitar?.(item)}>
                        {busyAction === `dev_${item.id}` ? <Loader2 size={10} className="animate-spin" /> : 'Volver a pedirla'}
                    </Button>
                )}
            </>)}
        </div>
    );
}
