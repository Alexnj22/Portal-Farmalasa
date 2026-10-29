import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus, MessageSquareText, Mic, Package, Send, Tag, Trash2, X } from 'lucide-react';
import Badge from '../../components/common/Badge';
import BuscadorDeProducto from '../../components/common/BuscadorDeProducto';
import Button from '../../components/common/Button';
import ConfirmModal from '../../components/common/ConfirmModal';
import ListRow from '../../components/common/ListRow';
import LiquidModal from '../../components/common/LiquidModal';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import SearchInput from '../../components/common/SearchInput';
import { EmptyState, SkeletonText } from '../../components/common/StateViews';
import { useAuth } from '@nucleo/context/AuthContext';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { hoySV, fechaTexto } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { preciosDeProducto } from '@nucleo/data/reservas';
import {
    borrarRespuestaRapida, fetchOfertasVigentes, fetchRespuestasRapidas, guardarRespuestaRapida,
    marcarEscribiendo,
} from '@nucleo/data/chatClientes';
import { FranjaDeRespuesta } from './AccionesDeMensaje';
import useGrabadora from './useGrabadora';
import { guardarBorrador, leerBorrador } from '@nucleo/utils/chatBorradores';

// El cuadro para responder: texto, una foto, una respuesta rápida guardada, o
// un producto / una oferta vigente que el cliente puede tocar en la app.
// Enter envía; Shift+Enter hace un salto de línea. Con el cuadro vacío, el
// botón redondo es un micrófono: graba una nota de voz, como en WhatsApp.
//
// Mientras se escribe, avisa «está escribiendo» (`chat_escribiendo`, vale 6 s)
// a lo sumo cada 3 s: lo ven el cliente en la app y el resto del equipo.
// `respondiendoA` (un mensaje del hilo) se cita en la respuesta.

const TIPOS_FOTO = 'image/jpeg,image/png,image/webp,image/heic';
const MAX_FOTO = 8 * 1024 * 1024;   // el `file_size_limit` del bucket
const CADA_CUANTO_ESCRIBIENDO_MS = 3_000;
const MAX_TEXTO = 2000;

export default function Compositor({ conversacion, onEnviar, respondiendoA = null, onQuitarRespuesta, equipo, cliente }) {
    const showToast = useToastStore((s) => s.showToast);
    // Arranca con lo que quedó escrito en esta conversación (`borradores`).
    const [texto, setTexto] = useState(() => leerBorrador(conversacion.id)?.texto ?? '');
    const [archivo, setArchivo] = useState(() => leerBorrador(conversacion.id)?.archivo ?? null);
    const [adjunto, setAdjunto] = useState(() => leerBorrador(conversacion.id)?.adjunto ?? null);
    useEffect(() => { guardarBorrador(conversacion.id, { texto, archivo, adjunto }); }, [conversacion.id, texto, archivo, adjunto]);
    const [hoja, setHoja] = useState(null); // 'respuestas' | 'producto' | 'oferta'
    const fileRef = useRef(null);
    const campoRef = useRef(null);
    const ultimoAvisoRef = useRef(0);

    // El campo crece con lo que se escribe; el tope lo pone su `max-h-40`.
    useLayoutEffect(() => {
        const el = campoRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
    }, [texto]);

    const escribir = (valor) => {
        setTexto(valor);
        if (!valor.trim()) return;
        const ahora = Date.now();
        if (ahora - ultimoAvisoRef.current < CADA_CUANTO_ESCRIBIENDO_MS) return;
        ultimoAvisoRef.current = ahora;
        // Una señal efímera: si falla, no se le dice nada a quien escribe.
        marcarEscribiendo(conversacion.id).catch((err) => console.error('Compositor: no se pudo avisar que escribe', err));
    };

    const vista = useMemo(() => (archivo ? URL.createObjectURL(archivo) : null), [archivo]);
    useEffect(() => () => { if (vista) URL.revokeObjectURL(vista); }, [vista]);

    const elegirFoto = (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        if (f.size > MAX_FOTO) { showToast('Foto muy pesada', 'El máximo es 8 MB.', 'error'); return; }
        setArchivo(f);
    };

    // ── Nota de voz ── (al llegar al tope de duración se envía sola)
    const alTopeRef = useRef(null);
    const grabadora = useGrabadora({ onTope: () => alTopeRef.current?.() });
    const enviarVoz = async () => {
        const voz = await grabadora.detener();
        if (!voz) { showToast('No se grabó nada', 'Intenta de nuevo.', 'error'); return; }
        onEnviar({ voz, respuestaA: respondiendoA });
        onQuitarRespuesta?.();
    };
    useEffect(() => { alTopeRef.current = enviarVoz; });
    const grabar = async () => {
        try {
            await grabadora.empezar();
        } catch (err) {
            console.error('Compositor: no se pudo usar el micrófono', err);
            showToast('No se pudo usar el micrófono',
                err?.name === 'NotAllowedError' ? 'Permite el micrófono para este sitio en el navegador.' : 'Revisa que haya un micrófono conectado.',
                'error');
        }
    };
    const grabando = grabadora.estado === 'grabando';

    // El envío lo hace el hilo (`onEnviar`), que pinta el globo al instante:
    // acá sólo se vacía el cuadro, sin esperar a la red. Así se puede escribir
    // el siguiente mensaje mientras el anterior viaja.
    const puedeEnviar = !!(texto.trim() || archivo || adjunto);
    const enviar = () => {
        if (!puedeEnviar) return;
        onEnviar({ texto, archivo, adjunto, respuestaA: respondiendoA });
        setTexto('');
        setArchivo(null);
        setAdjunto(null);
        onQuitarRespuesta?.();
        campoRef.current?.focus();
    };

    return (
        <div className="border-t border-border-card px-3 pt-2.5 space-y-1.5 pb-[max(0.5rem,var(--sa-bottom))]">
            {respondiendoA && (
                <FranjaDeRespuesta mensaje={respondiendoA} equipo={equipo ?? new Map()} cliente={cliente} onQuitar={onQuitarRespuesta} />
            )}
            {(archivo || adjunto) && (
                <div className="flex flex-wrap items-center gap-2">
                    {archivo && (
                        <span className="relative inline-block">
                            <img src={vista} alt="Foto por enviar" className="h-16 w-16 rounded-input object-cover border border-border-card" />
                            <Button variant="secondary" size="xs" iconOnly icon={X} title="Quitar la foto" className="absolute -top-2 -right-2"
                                onClick={() => setArchivo(null)} />
                        </span>
                    )}
                    {adjunto && (
                        <Badge variant="info" uppercase={false} icon={adjunto.tipo === 'producto' ? Package : Tag}>
                            {adjunto.tipo === 'producto' ? `${adjunto.nombre}${adjunto.precio != null ? ` · ${formatMoney(adjunto.precio)}` : ''}` : adjunto.titulo}
                        </Badge>
                    )}
                    {adjunto && <Button variant="ghost" size="xs" iconOnly icon={X} title="Quitar el adjunto" onClick={() => setAdjunto(null)} />}
                </div>
            )}
            {/* El campo crece con el texto (hasta ~6 renglones) y el botón de
                enviar va a su lado: la forma de cualquier app de mensajería.
                Las herramientas, en una tira fina debajo. Con UN renglón el
                campo mide exactamente lo que el botón (`max(--tap-min,
                --control-h)`, el alto de `Button md`): antes el campo medía
                ~46px y el micrófono 40, y se veía torcido (2026-10-21). El 28
                es el renglón (leading-6 = 24px) más los 2px de borde arriba y abajo. */}
            {grabando ? (
                <div className="flex items-center gap-2 min-h-[var(--tap-min)]">
                    <Button variant="ghost" size="md" iconOnly icon={Trash2} title="Descartar la nota de voz" onClick={grabadora.cancelar}
                        className="shrink-0" />
                    <span className="flex-1 min-w-0 flex items-center gap-2 rounded-input bg-surface-card border border-border-card px-3 h-10" role="status">
                        <span className="size-2.5 rounded-full bg-danger animate-pulse shrink-0" aria-hidden="true" />
                        <span className="text-body-sm font-semibold tabular-nums text-content">
                            {Math.floor(grabadora.segundos / 60)}:{String(grabadora.segundos % 60).padStart(2, '0')}
                        </span>
                        <span className="text-label text-content-3 truncate">Grabando nota de voz…</span>
                    </span>
                    <Button size="md" iconOnly icon={Send} title="Enviar la nota de voz" onClick={enviarVoz} className="shrink-0" />
                </div>
            ) : (
            <div className="flex items-end gap-2">
                <PortalTextarea name="chat-respuesta" aria-label="Escribe una respuesta" placeholder="Escribe una respuesta…" rows={1} compact
                    ref={campoRef} className="flex-1 min-w-0" textareaClassName="!font-medium max-h-40 overflow-y-auto leading-6 !py-[calc((max(var(--tap-min),var(--control-h))_-_28px)_/_2)]"
                    value={texto} onChange={(e) => escribir(e.target.value.slice(0, MAX_TEXTO))}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing) { e.preventDefault(); enviar(); } }} />
                {!puedeEnviar && grabadora.soportada ? (
                    <Button size="md" iconOnly icon={Mic} title="Grabar una nota de voz" loading={grabadora.estado === 'pidiendo'}
                        onClick={grabar} className="shrink-0" />
                ) : (
                    <Button size="md" iconOnly icon={Send} title="Enviar" disabled={!puedeEnviar} onClick={enviar}
                        className="shrink-0" />
                )}
            </div>
            )}
            <div className={`flex items-center gap-0.5 ${grabando ? 'hidden' : ''}`}>
                <input ref={fileRef} type="file" accept={TIPOS_FOTO} className="sr-only" onChange={elegirFoto} />
                <Button variant="ghost" size="xs" iconOnly icon={ImagePlus} title="Adjuntar una foto" onClick={() => fileRef.current?.click()} />
                <Button variant="ghost" size="xs" iconOnly icon={MessageSquareText} title="Respuestas rápidas" onClick={() => setHoja('respuestas')} />
                <Button variant="ghost" size="xs" iconOnly icon={Package} title="Enviar un producto" onClick={() => setHoja('producto')} />
                <Button variant="ghost" size="xs" iconOnly icon={Tag} title="Enviar una oferta" onClick={() => setHoja('oferta')} />
                <span className="ml-auto pr-1 text-micro text-content-3 tabular-nums">
                    {texto.length > MAX_TEXTO - 200
                        ? `${texto.length}/${MAX_TEXTO}`
                        : <span className="hidden md:inline whitespace-nowrap">Shift+Enter: otra línea</span>}
                </span>
            </div>

            {hoja === 'respuestas' && (
                <RespuestasRapidas textoActual={texto} onClose={() => setHoja(null)}
                    onElegir={(t) => { setTexto((prev) => (prev.trim() ? `${prev.trimEnd()} ${t}` : t)); setHoja(null); }} />
            )}
            {hoja === 'producto' && (
                <ElegirProducto onClose={() => setHoja(null)} onElegir={(a) => { setAdjunto(a); setHoja(null); }} />
            )}
            {hoja === 'oferta' && (
                <ElegirOferta onClose={() => setHoja(null)} onElegir={(a) => { setAdjunto(a); setHoja(null); }} />
            )}
        </div>
    );
}

// ── Respuestas rápidas: compartidas por todo el equipo ──────────────────────
function RespuestasRapidas({ textoActual, onClose, onElegir }) {
    const { user } = useAuth();
    const showToast = useToastStore((s) => s.showToast);
    const [filas, setFilas] = useState(null);
    const [busca, setBusca] = useState('');
    const [titulo, setTitulo] = useState('');
    const [nuevoTexto, setNuevoTexto] = useState(textoActual ?? '');
    const [guardando, setGuardando] = useState(false);
    const [borrar, setBorrar] = useState(null);
    const [borrando, setBorrando] = useState(false);

    const cargar = async () => {
        try { setFilas(await fetchRespuestasRapidas()); }
        catch (err) { showToast('No se pudieron cargar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error'); setFilas([]); }
    };
    useEffect(() => { cargar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- la carga inicial

    const guardar = async () => {
        if (!titulo.trim() || !nuevoTexto.trim()) return;
        setGuardando(true);
        try {
            await guardarRespuestaRapida({ titulo, texto: nuevoTexto }, user?.id);
            setTitulo('');
            setNuevoTexto('');
            showToast('Respuesta guardada', 'Ya la puede usar todo el equipo.', 'success');
            cargar();
        } catch (err) {
            showToast('No se pudo guardar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setGuardando(false);
        }
    };

    const confirmarBorrar = async () => {
        setBorrando(true);
        try { await borrarRespuestaRapida(borrar.id); setBorrar(null); cargar(); }
        catch (err) { showToast('No se pudo borrar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error'); }
        finally { setBorrando(false); }
    };

    const visibles = (filas ?? []).filter((r) => !busca || tokenMatch(busca, r.titulo, r.texto));
    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-lg" ariaLabel="Respuestas rápidas">
            <LiquidModal.Header titulo="Respuestas rápidas" onClose={onClose} />
            <LiquidModal.Body>
                <div className="space-y-3">
                    <SearchInput value={busca} onChange={setBusca} placeholder="Buscar respuesta…" ariaLabel="Buscar una respuesta rápida" />
                    {!filas ? <SkeletonText lines={3} /> : !visibles.length ? (
                        <EmptyState icon={MessageSquareText} compact title={busca ? 'Sin resultados' : 'Todavía no hay respuestas'}
                            subtitle="Guarda abajo las que el equipo escribe seguido." />
                    ) : (
                        <ul className="space-y-1.5">
                            {visibles.map((r) => (
                                <li key={r.id} className="flex items-center gap-1">
                                    <ListRow surface="card" density="sm" className="flex-1 min-h-[var(--tap-min)]" title={r.titulo} subtitle={r.texto}
                                        onClick={() => onElegir(r.texto)} />
                                    <Button variant="ghost" size="sm" iconOnly icon={Trash2} title={`Borrar «${r.titulo}»`} onClick={() => setBorrar(r)} />
                                </li>
                            ))}
                        </ul>
                    )}
                    <div className="space-y-2 pt-2 border-t border-border-card">
                        <p className="text-label font-semibold text-content-2">Guardar una respuesta nueva</p>
                        <PortalInput label="Título" name="respuesta-titulo" maxLength={60} value={titulo} onChange={(e) => setTitulo(e.target.value)} />
                        <PortalTextarea label="Texto" name="respuesta-texto" rows={3} compact maxLength={1000} value={nuevoTexto}
                            onChange={(e) => setNuevoTexto(e.target.value)} />
                    </div>
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onClose}>Cerrar</Button>
                <Button loading={guardando} disabled={!titulo.trim() || !nuevoTexto.trim()} onClick={guardar}>Guardar respuesta</Button>
            </LiquidModal.Footer>
            <ConfirmModal isOpen={!!borrar} onClose={() => setBorrar(null)} onConfirm={confirmarBorrar} isProcessing={borrando}
                title="¿Borrar la respuesta?" confirmText="Borrar"
                message={`«${borrar?.titulo ?? ''}» deja de estar disponible para todo el equipo.`} />
        </LiquidModal>
    );
}

// ── Un producto del catálogo, con su precio por unidad ──────────────────────
function ElegirProducto({ onClose, onElegir }) {
    const showToast = useToastStore((s) => s.showToast);
    const [buscando, setBuscando] = useState(false);
    const elegir = async (p) => {
        setBuscando(true);
        try {
            const precios = await preciosDeProducto(p.id);
            // La presentación más chica (factor menor) es la que el cliente compra suelta.
            const precio = precios[0]?.precio ?? null;
            onElegir({ tipo: 'producto', id: p.id, nombre: p.nombre, precio });
        } catch (err) {
            showToast('No se pudo leer el precio', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setBuscando(false);
        }
    };
    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-lg" ariaLabel="Enviar un producto">
            <LiquidModal.Header titulo="Enviar un producto" onClose={onClose} />
            <LiquidModal.Body>
                {buscando ? <SkeletonText lines={2} /> : (
                    <BuscadorDeProducto onElegir={elegir} placeholder="Nombre del producto"
                        invitacion={{ icono: Package, texto: 'Busca el producto que le quieres mostrar al cliente.' }} />
                )}
            </LiquidModal.Body>
        </LiquidModal>
    );
}

// ── Una oferta que el cliente ve hoy en la app ──────────────────────────────
function ElegirOferta({ onClose, onElegir }) {
    const showToast = useToastStore((s) => s.showToast);
    const [ofertas, setOfertas] = useState(null);
    const [busca, setBusca] = useState('');
    useEffect(() => {
        let vivo = true;
        fetchOfertasVigentes(hoySV())
            .then((o) => { if (vivo) setOfertas(o); })
            .catch((err) => { if (vivo) { setOfertas([]); showToast('No se pudieron cargar las ofertas', mensajeAmigable(err, 'Intenta de nuevo.'), 'error'); } });
        return () => { vivo = false; };
    }, [showToast]);
    const visibles = (ofertas ?? []).filter((o) => !busca || tokenMatch(busca, o.titulo, o.etiqueta ?? ''));
    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-lg" ariaLabel="Enviar una oferta">
            <LiquidModal.Header titulo="Enviar una oferta" onClose={onClose} />
            <LiquidModal.Body>
                <div className="space-y-3">
                    <SearchInput value={busca} onChange={setBusca} placeholder="Buscar oferta…" ariaLabel="Buscar una oferta" />
                    {!ofertas ? <SkeletonText lines={3} /> : !visibles.length ? (
                        <EmptyState icon={Tag} compact title="Sin ofertas vigentes" subtitle="Sólo se pueden enviar las que el cliente ve hoy en la app." />
                    ) : (
                        <ul className="space-y-1.5">
                            {visibles.map((o) => (
                                <li key={o.id}>
                                    <ListRow surface="card" density="sm" icon={Tag} className="min-h-[var(--tap-min)]" title={o.titulo}
                                        subtitle={`${o.etiqueta ? `${o.etiqueta} · ` : ''}hasta el ${fechaTexto(o.fin, { day: 'numeric', month: 'short' })}`}
                                        onClick={() => onElegir({ tipo: 'oferta', id: o.id, titulo: o.titulo })} />
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </LiquidModal.Body>
        </LiquidModal>
    );
}
