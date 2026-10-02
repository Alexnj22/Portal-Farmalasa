import React, { useMemo, useState } from 'react';
import { Send, CheckCircle2, Circle, PenLine, Reply, Pencil, Trash2, X } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import PortalTextarea from '../../components/common/PortalTextarea';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import ConfirmModal from '../../components/common/ConfirmModal';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaHora12 } from '@nucleo/utils/hora';
import { comentar, marcarResuelto, editarComentario, quitarComentario } from '@nucleo/data/marketing';

const TIPO = {
    cambio:     { label: 'Cambio pedido', variant: 'warning' },
    aprobacion: { label: 'Aprobado',      variant: 'success' },
};

/** Ctrl/⌘ + Enter envía, como en cualquier chat. */
const alEnviar = (fn) => (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); fn(); }
};

/**
 * La conversación de una pieza, o del mes entero (`piezaId` vacío). Cada
 * comentario abre un hilo y se responde ahí mismo; responder a una respuesta
 * cuelga del mismo hilo (un nivel, como en los chats: un árbol profundo no se
 * lee en un teléfono).
 *
 * Lo propio se corrige o se quita —esto último mientras nadie haya
 * respondido—. Los pedidos de cambio se marcan resueltos cuando el diseñador
 * los corrige: así quien revisa ve qué quedó pendiente sin releer todo.
 *
 * `asegurarMes`: en un mes que todavía no existe, el primer comentario lo crea.
 */
export default function Conversacion({
    comentarios, personas, mesId, piezaId = null, yoId, puedeResolver, onCambio, onVerMarca, asegurarMes,
    placeholder = 'Escribe un comentario…',
}) {
    const showToast = useToastStore((s) => s.showToast);
    const [texto, setTexto] = useState('');
    const [enviando, setEnviando] = useState(false);
    const [respondiendo, setRespondiendo] = useState(null);   // id del hilo con la caja abierta
    const [quitando, setQuitando] = useState(null);

    // Raíces en orden, cada una con sus respuestas.
    const hilos = useMemo(() => {
        const lista = comentarios || [];
        const respuestas = {};
        for (const c of lista) if (c.respuesta_a) (respuestas[c.respuesta_a] ||= []).push(c);
        return lista.filter((c) => !c.respuesta_a).map((c) => ({ ...c, respuestas: respuestas[c.id] || [] }));
    }, [comentarios]);

    const fallo = (titulo) => (err) => showToast(titulo, mensajeAmigable(err, 'Intenta de nuevo.'), 'error');

    const enviar = async () => {
        if (!texto.trim()) return;
        setEnviando(true);
        try {
            const id = mesId || (await asegurarMes?.())?.id;
            if (!id) throw new Error('El mes todavía no está creado.');
            await comentar({ mesId: id, piezaId, texto, autorId: yoId });
            setTexto('');
            onCambio?.();
        } catch (err) {
            fallo('No se pudo enviar el comentario')(err);
        } finally {
            setEnviando(false);
        }
    };

    const resolver = async (c) => {
        try {
            await marcarResuelto(c.id, !c.resuelto);
            onCambio?.();
        } catch (err) {
            fallo('No se pudo actualizar')(err);
        }
    };

    const quitar = async () => {
        const c = quitando;
        try {
            await quitarComentario(c.id);
            setQuitando(null);
            onCambio?.();
        } catch (err) {
            setQuitando(null);
            fallo('No se pudo quitar')(err);
        }
    };

    return (
        <div className="space-y-4">
            {!hilos.length && (
                <p className="text-body-sm text-content-3 text-center py-4">
                    Todavía no hay comentarios. El primero abre la conversación.
                </p>
            )}
            {hilos.length > 0 && (
                <ul className="space-y-4">
                    {hilos.map((h) => (
                        <li key={h.id} className="space-y-2">
                            <Mensaje c={h} personas={personas} yoId={yoId} puedeResolver={puedeResolver}
                                onResolver={resolver} onVerMarca={onVerMarca} onQuitar={setQuitando}
                                onResponder={() => setRespondiendo((r) => (r === h.id ? null : h.id))}
                                onCambio={onCambio} fallo={fallo} />
                            {(h.respuestas.length > 0 || respondiendo === h.id) && (
                                <div className="pl-9 md:pl-11 space-y-2">
                                    {h.respuestas.map((r) => (
                                        <Mensaje key={r.id} c={r} personas={personas} yoId={yoId} chico
                                            onQuitar={setQuitando} onCambio={onCambio} fallo={fallo}
                                            onResponder={() => setRespondiendo(h.id)} />
                                    ))}
                                    {respondiendo === h.id && (
                                        <CajaDeRespuesta hilo={h} yoId={yoId} personas={personas}
                                            onCerrar={() => setRespondiendo(null)} onCambio={onCambio} fallo={fallo} />
                                    )}
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            <div className="flex items-end gap-2 pt-1">
                <div className="flex-1 min-w-0">
                    <PortalTextarea label="Nuevo comentario" name="comentario" value={texto}
                        onChange={(e) => setTexto(e.target.value)} onKeyDown={alEnviar(enviar)}
                        rows={2} placeholder={placeholder} />
                </div>
                <Button icon={Send} loading={enviando} disabled={!texto.trim()} onClick={enviar}>Enviar</Button>
            </div>

            <ConfirmModal isOpen={!!quitando} onClose={() => setQuitando(null)} onConfirm={quitar}
                title="¿Quitar el comentario?" message="Se borra para todos. Si ya tiene respuestas, no se puede quitar."
                confirmText="Quitar" />
        </div>
    );
}

/** Un mensaje: foto, nombre, cuándo, el texto y lo que se puede hacer con él. */
function Mensaje({ c, personas, yoId, chico = false, puedeResolver, onResolver, onVerMarca, onQuitar, onResponder, onCambio, fallo }) {
    const [editando, setEditando] = useState(false);
    const [borrador, setBorrador] = useState(c.texto);
    const [guardando, setGuardando] = useState(false);
    const quien = personas?.[c.autor_id];
    const tipo = TIPO[c.tipo];
    const mio = c.autor_id === yoId;
    const esCharla = c.tipo === 'comentario';
    const sinRespuestas = !c.respuestas?.length;

    const guardar = async () => {
        if (!borrador.trim() || borrador.trim() === c.texto) { setEditando(false); return; }
        setGuardando(true);
        try {
            await editarComentario(c.id, borrador);
            setEditando(false);
            onCambio?.();
        } catch (err) {
            fallo('No se pudo corregir')(err);
        } finally {
            setGuardando(false);
        }
    };

    return (
        <div className="flex gap-2.5 min-w-0">
            <AvatarConEstado emp={quien || { id: c.autor_id }} px={chico ? 26 : 32} radio="rounded-full" marco="" />
            <div className="min-w-0 flex-1">
                <div className={`rounded-2xl rounded-tl-md border px-3.5 py-2.5
                    ${mio ? 'bg-brand/10 border-brand/20' : 'bg-surface-card-hover border-border-card'}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-label font-semibold text-content">{shortEmployeeName(quien?.name)}</span>
                        <span className="text-micro text-content-3">
                            {fechaHora12(c.created_at, { day: 'numeric', month: 'short' })}
                            {c.editado_at ? ' · editado' : ''}
                        </span>
                        {tipo && <Badge variant={tipo.variant} size="sm">{tipo.label}</Badge>}
                        {c.resuelto && <Badge variant="success" size="sm">Resuelto</Badge>}
                    </div>
                    {editando ? (
                        <div className="mt-2 space-y-2">
                            <PortalTextarea label="Corregir comentario" name={`editar_${c.id}`} value={borrador} rows={2}
                                onChange={(e) => setBorrador(e.target.value)} onKeyDown={alEnviar(guardar)} />
                            <div className="flex justify-end gap-2">
                                <Button variant="ghost" size="sm" icon={X} onClick={() => { setBorrador(c.texto); setEditando(false); }}>Cancelar</Button>
                                <Button size="sm" loading={guardando} disabled={!borrador.trim()} onClick={guardar}>Guardar</Button>
                            </div>
                        </div>
                    ) : (
                        <p className={`mt-0.5 text-body-sm whitespace-pre-wrap break-words ${c.resuelto ? 'text-content-3 line-through' : 'text-content'}`}>
                            {c.texto}
                        </p>
                    )}
                </div>
                {!editando && (
                    <div className="flex items-center gap-0.5 flex-wrap mt-0.5 -ml-1.5">
                        <Button variant="ghost" size="xs" icon={Reply} onClick={onResponder}>Responder</Button>
                        {c.archivo_id && c.marca && onVerMarca && (
                            <Button variant="ghost" size="xs" icon={PenLine} onClick={() => onVerMarca(c)}>Ver sobre el diseño</Button>
                        )}
                        {(c.tipo === 'cambio' || c.marca) && puedeResolver && onResolver && (
                            <Button variant="ghost" size="xs" icon={c.resuelto ? CheckCircle2 : Circle} onClick={() => onResolver(c)}>
                                {c.resuelto ? 'Reabrir' : 'Marcar resuelto'}
                            </Button>
                        )}
                        {mio && esCharla && (
                            <Button variant="ghost" size="xs" icon={Pencil} onClick={() => setEditando(true)}>Editar</Button>
                        )}
                        {mio && esCharla && sinRespuestas && (
                            <Button variant="ghost" size="xs" icon={Trash2} onClick={() => onQuitar(c)}>Quitar</Button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

/** La caja para responder dentro de un hilo. */
function CajaDeRespuesta({ hilo, yoId, personas, onCerrar, onCambio, fallo }) {
    const [texto, setTexto] = useState('');
    const [enviando, setEnviando] = useState(false);
    const a = shortEmployeeName(personas?.[hilo.autor_id]?.name);
    const enviar = async () => {
        if (!texto.trim()) return;
        setEnviando(true);
        try {
            await comentar({ mesId: hilo.mes_id, piezaId: hilo.pieza_id, texto, autorId: yoId, respuestaA: hilo.id });
            setTexto('');
            onCerrar();
            onCambio?.();
        } catch (err) {
            fallo('No se pudo responder')(err);
        } finally {
            setEnviando(false);
        }
    };
    return (
        <div className="space-y-2">
            <PortalTextarea label={`Responder a ${a}`} name={`respuesta_${hilo.id}`} value={texto} rows={2} autoFocus
                onChange={(e) => setTexto(e.target.value)} onKeyDown={alEnviar(enviar)} placeholder="Escribe tu respuesta…" />
            <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" icon={X} onClick={onCerrar}>Cancelar</Button>
                <Button size="sm" icon={Reply} loading={enviando} disabled={!texto.trim()} onClick={enviar}>Responder</Button>
            </div>
        </div>
    );
}
