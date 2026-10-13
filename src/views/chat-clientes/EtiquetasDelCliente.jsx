import React, { useState } from 'react';
import {
    BadgeDollarSign, CalendarClock, Check, FileText, Heart, MessageSquareWarning, Pill, Repeat, Siren, Tags,
} from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import LiquidModal from '../../components/common/LiquidModal';
import Notice from '../../components/common/Notice';
import { etiquetarConversacion } from '@nucleo/data/chatClientes';
import { ETIQUETAS, etiquetasDe } from '@nucleo/utils/chatClientes';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { useToastStore } from '@nucleo/store/toastStore';

// Las etiquetas que el equipo le pone a un cliente en el chat (2026-10-13):
// «Urgente», «Receta», «Cliente frecuente»… El catálogo —clave, rótulo, color
// e ícono— vive en el núcleo (`ETIQUETAS`); acá sólo se dibuja. Una
// conversación por cliente, así que la etiqueta es del cliente.

// Los íconos del catálogo, por nombre (el núcleo no conoce a lucide).
const ICONOS_DE_ETIQUETA = { Siren, Pill, FileText, CalendarClock, BadgeDollarSign, MessageSquareWarning, Repeat, Heart };

/** Las etiquetas como chips. `max` corta la fila y suma «+N». */
export function ChipsDeEtiquetas({ conversacion, max = null }) {
    const claves = etiquetasDe(conversacion);
    if (!claves.length) return null;
    const vistas = max ? claves.slice(0, max) : claves;
    const resto = claves.length - vistas.length;
    return (
        <>
            {vistas.map((k) => {
                const e = ETIQUETAS[k];
                return (
                    <Badge key={k} variant={e.variant} size="sm" uppercase={false}
                        icon={ICONOS_DE_ETIQUETA[e.icono]}>
                        {e.label}
                    </Badge>
                );
            })}
            {resto > 0 && (
                <Badge variant="neutral" size="sm" uppercase={false}
                    title={claves.slice(vistas.length).map((k) => ETIQUETAS[k].label).join(', ')}>
                    +{resto}
                </Badge>
            )}
        </>
    );
}

/**
 * El editor: las ocho etiquetas como interruptores, y Guardar. Reemplaza la
 * lista entera con `chat_etiquetar` (la base valida las claves) y lo anota.
 */
export function EditorDeEtiquetas({ abierto, conversacion, onClose, onGuardado }) {
    const actuales = etiquetasDe(conversacion);
    const [elegidas, setElegidas] = useState(() => new Set(actuales));
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState(null);
    const showToast = useToastStore((s) => s.showToast);

    const alternar = (k) => setElegidas((prev) => {
        const nuevo = new Set(prev);
        if (nuevo.has(k)) nuevo.delete(k); else nuevo.add(k);
        return nuevo;
    });
    const sinCambios = actuales.length === elegidas.size && actuales.every((k) => elegidas.has(k));

    const guardar = async () => {
        setGuardando(true);
        setError(null);
        try {
            const lista = Object.keys(ETIQUETAS).filter((k) => elegidas.has(k));
            await etiquetarConversacion(conversacion.id, lista, actuales);
            showToast('Etiquetas guardadas', lista.length ? lista.map((k) => ETIQUETAS[k].label).join(' · ') : 'Sin etiquetas', 'success');
            onGuardado?.();
            onClose();
        } catch (err) {
            setError(mensajeAmigable(err, 'No se pudieron guardar las etiquetas.'));
        } finally {
            setGuardando(false);
        }
    };

    return (
        <LiquidModal open={abierto} onClose={guardando ? undefined : onClose} maxWidth="max-w-md" ariaLabel="Etiquetas del cliente">
            <LiquidModal.Header>
                <div className="flex items-center gap-2.5 min-w-0">
                    <Tags size={18} className="text-brand-text shrink-0" />
                    <h2 className="text-title font-black text-content truncate">Etiquetas del cliente</h2>
                </div>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="flex flex-col gap-3">
                    <p className="text-caption text-content-2">
                        Las ve todo el equipo, en la bandeja y en esta conversación. «Urgente» la sube al primer lugar.
                    </p>
                    {error && <Notice variant="danger" bloque>{error}</Notice>}
                    <div role="group" aria-label="Etiquetas" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {Object.entries(ETIQUETAS).map(([k, e]) => {
                            const puesta = elegidas.has(k);
                            return (
                                <button key={k} type="button" aria-pressed={puesta} onClick={() => alternar(k)}
                                    data-surface="card"
                                    className={`flex items-center gap-2.5 rounded-btn px-3 py-2 min-h-[var(--tap-min)] text-left
                                        active:scale-[0.97] transition-[box-shadow,background-color] duration-[var(--dur-fast)]
                                        ${puesta ? 'ring-2 ring-brand/45 bg-brand/10' : 'hover:bg-surface-card-hover'}`}>
                                    <Badge variant={e.variant} size="md" uppercase={false} className="!px-1.5"
                                        icon={ICONOS_DE_ETIQUETA[e.icono]}
                                        aria-hidden="true" />
                                    <span className="flex-1 min-w-0 text-body-sm font-semibold text-content truncate">{e.label}</span>
                                    <span aria-hidden="true"
                                        className={`w-5 h-5 shrink-0 rounded-full border flex items-center justify-center
                                            ${puesta ? 'bg-brand border-brand text-white' : 'border-border-card'}`}>
                                        {puesta && <Check size={12} strokeWidth={3} />}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <div className="flex items-center justify-end gap-2 w-full">
                    <Button variant="ghost" onClick={onClose} disabled={guardando}>Cancelar</Button>
                    <Button variant="primary" icon={Check} loading={guardando} disabled={sinCambios} onClick={guardar}>Guardar</Button>
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
