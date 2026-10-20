import React from 'react';
import { Copy, CornerUpLeft, MessageSquareQuote, X } from 'lucide-react';
import HojaMovil from '../../components/common/HojaMovil';
import ListRow from '../../components/common/ListRow';
import ModalShell from '../../components/common/ModalShell';
import Button from '../../components/common/Button';
import { EMOJIS_DE_REACCION } from '@nucleo/data/chatClientes';
import { nombreDeAutor, recorteDeMensaje } from './etiquetas';

// Lo que se hace SOBRE un mensaje del hilo (2026-10-12): reaccionar con uno de
// seis emojis, responderlo citándolo y copiar su texto. En escritorio, una
// barrita que aparece al pasar el ratón; en el teléfono, mantener presionado
// el globo (§32.7) abre la hoja con lo mismo.

// ── La barrita del escritorio (aparece con el ratón encima del globo) ───────
export function BarraDeMensaje({ alLado, conTexto, onReaccionar, onResponder, onCopiar }) {
    return (
        <div data-surface="dropdown" role="toolbar" aria-label="Acciones del mensaje"
            className={`absolute z-tabs -top-9 ${alLado === 'derecha' ? 'right-0' : 'left-0'}
                hidden group-hover:flex group-focus-within:flex items-center gap-0.5 rounded-badge px-1 py-0.5 whitespace-nowrap`}>
            {EMOJIS_DE_REACCION.map((e) => (
                <button key={e} type="button" aria-label={`Reaccionar con ${e}`}
                    onClick={() => onReaccionar(e)}
                    className="w-7 h-7 rounded-full text-body leading-none hover:bg-surface-card-hover active:scale-[0.97]">
                    {e}
                </button>
            ))}
            <span aria-hidden="true" className="w-px h-5 bg-border-card mx-0.5" />
            <button type="button" aria-label="Responder" onClick={onResponder}
                className="w-7 h-7 rounded-full inline-flex items-center justify-center text-content-2 hover:bg-surface-card-hover active:scale-[0.97]">
                <CornerUpLeft size={15} />
            </button>
            {conTexto && (
                <button type="button" aria-label="Copiar el texto" onClick={onCopiar}
                    className="w-7 h-7 rounded-full inline-flex items-center justify-center text-content-2 hover:bg-surface-card-hover active:scale-[0.97]">
                    <Copy size={15} />
                </button>
            )}
        </div>
    );
}

// ── Las reacciones, en píldoras bajo el globo ───────────────────────────────
// Una por emoji, con cuántos y quiénes (en el `title`). La mía va resaltada y
// tocarla la quita; tocar la de otro emoji pone (o cambia) la mía.
export function ReaccionesDeMensaje({ filas, yo, equipo, cliente, alLado, puedeReaccionar, onReaccionar }) {
    if (!filas?.length) return null;
    const grupos = new Map();
    filas.forEach((r) => {
        const g = grupos.get(r.emoji) ?? { emoji: r.emoji, quienes: [], mia: false };
        g.quienes.push(nombreDeAutor(r, equipo, cliente));
        if (r.autor === 'equipo' && yo && String(r.employee_id) === String(yo)) g.mia = true;
        grupos.set(r.emoji, g);
    });
    return (
        // Montadas sobre el borde inferior del globo, como en iMessage/WhatsApp.
        <div className={`relative z-base flex flex-wrap gap-1 -mt-1.5 px-2 ${alLado === 'derecha' ? 'justify-end' : 'justify-start'}`}>
            {[...grupos.values()].map((g) => {
                const titulo = `${g.quienes.join(', ')}${g.mia ? ' · toca para quitar la tuya' : ''}`;
                return (
                    <button key={g.emoji} type="button" title={titulo} aria-label={`${g.emoji} ${g.quienes.length}: ${titulo}`}
                        aria-pressed={g.mia} disabled={!puedeReaccionar}
                        onClick={() => onReaccionar(g.mia ? null : g.emoji)}
                        className={`inline-flex items-center gap-1 rounded-badge border px-2 min-h-[var(--tap-min)] md:min-h-0 md:py-0.5 text-label tabular-nums active:scale-[0.97] disabled:active:scale-100
                            shadow-sm ${g.mia ? 'border-brand bg-surface-card text-brand-text font-semibold' : 'border-border-card bg-surface-card text-content-2'}`}>
                        <span className="text-body-sm leading-none">{g.emoji}</span>
                        {g.quienes.length > 1 && <span>{g.quienes.length}</span>}
                    </button>
                );
            })}
        </div>
    );
}

// ── El mensaje citado, arriba del globo que lo responde ─────────────────────
export function CitaDeMensaje({ cita, equipo, cliente, delEquipo, onIr }) {
    if (!cita) return null;
    return (
        <button type="button" onClick={() => onIr(cita.id)} title="Ir al mensaje citado"
            className={`block w-full text-left rounded-input px-2 py-1 active:scale-[0.97] min-h-[var(--tap-min)] md:min-h-0
                ${delEquipo ? 'bg-brand-dark/40' : 'bg-surface-card border border-border-card'}`}>
            <span className="block text-micro font-semibold truncate">{nombreDeAutor(cita, equipo, cliente)}</span>
            <span className="block text-label opacity-90 line-clamp-2 break-words">{recorteDeMensaje(cita)}</span>
        </button>
    );
}

// ── La franja «Respondiendo a…» sobre el cuadro de respuesta ────────────────
export function FranjaDeRespuesta({ mensaje, equipo, cliente, onQuitar }) {
    if (!mensaje) return null;
    return (
        <div className="flex items-center gap-2 rounded-input border border-border-card bg-surface-card-hover px-2 py-1.5">
            <MessageSquareQuote size={14} className="shrink-0 text-brand-text" />
            <span className="min-w-0 flex-1">
                <span className="block text-micro font-semibold text-content-2 truncate">
                    Respondiendo a {nombreDeAutor(mensaje, equipo, cliente)}
                </span>
                <span className="block text-label text-content-3 truncate">{recorteDeMensaje(mensaje)}</span>
            </span>
            <Button variant="ghost" size="xs" iconOnly icon={X} title="No responder a ese mensaje" onClick={onQuitar} />
        </div>
    );
}

// ── La hoja del teléfono (mantener presionado un globo) ─────────────────────
export function HojaDeMensaje({ abierto, mensaje, misReacciones, conTexto, puedeReaccionar, onClose, onReaccionar, onResponder, onCopiar }) {
    const mia = mensaje ? misReacciones.get(mensaje.id) ?? null : null;
    return (
        <ModalShell open={abierto} onClose={onClose} align="bottom" maxWidthClass="max-w-none" surface={null}
            ariaLabel="Opciones del mensaje">
            {mensaje && (
                <HojaMovil titulo="Mensaje" subtitulo={recorteDeMensaje(mensaje)}>
                    <div className="space-y-3">
                        {puedeReaccionar && (
                            <div role="group" aria-label="Reaccionar" className="flex flex-wrap justify-between gap-1">
                                {EMOJIS_DE_REACCION.map((e) => (
                                    <button key={e} type="button" aria-label={mia === e ? `Quitar ${e}` : `Reaccionar con ${e}`}
                                        aria-pressed={mia === e}
                                        onClick={() => { onReaccionar(mia === e ? null : e); onClose(); }}
                                        className={`min-w-[var(--tap-min)] min-h-[var(--tap-min)] rounded-full text-body-xl leading-none active:scale-[0.97]
                                            ${mia === e ? 'bg-brand/15 ring-2 ring-brand/45' : ''}`}>
                                        {e}
                                    </button>
                                ))}
                            </div>
                        )}
                        <div className="space-y-2">
                            {puedeReaccionar && (
                                <ListRow icon={CornerUpLeft} title="Responder" subtitle="Citar este mensaje en tu respuesta"
                                    onClick={() => { onResponder(); onClose(); }} />
                            )}
                            {conTexto && (
                                <ListRow icon={Copy} title="Copiar el texto" onClick={() => { onCopiar(); onClose(); }} />
                            )}
                        </div>
                    </div>
                </HojaMovil>
            )}
        </ModalShell>
    );
}
