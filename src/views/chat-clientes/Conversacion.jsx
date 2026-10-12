import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CheckCircle2, ImageOff, Package, Phone, Tag } from 'lucide-react';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import ConfirmModal from '../../components/common/ConfirmModal';
import Notice from '../../components/common/Notice';
import PhotoLightbox from '../../components/common/PhotoLightbox';
import { SkeletonText } from '../../components/common/StateViews';
import { useRefrescoEnVivo } from '@nucleo/hooks/useRefrescoEnVivo';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { cuandoLlego } from '@nucleo/utils/notificacionTexto';
import {
    MENSAJES_POR_PAGINA, fetchMensajes, quitarFotoDeCliente, resolverConversacion, tomarConversacion,
} from '@nucleo/data/chatClientes';
import ClienteAvatar from './ClienteAvatar';
import Compositor from './Compositor';
import { NIVELES, nombreDeCliente, tipoDeCliente } from './etiquetas';

// El hilo de una conversación: el contexto del cliente arriba, los mensajes
// (los del cliente a la izquierda, los del equipo a la derecha con la foto y el
// nombre corto de quien contestó) y el cuadro para responder.
//
// Al abrirla se TOMA (`chat_tomar`): el resto del equipo ve «… está
// respondiendo» durante 10 minutos, y al salir se suelta. Cada mensaje nuevo
// del cliente que llega con el hilo abierto la vuelve a tomar, que es lo que
// deja su contador de «sin leer» en cero.

export default function Conversacion({ conversacion: c, puedeResponder, equipo, asegurarEquipo, comoPanel, onCambio, onCerrar }) {
    const showToast = useToastStore((s) => s.showToast);
    const [mensajes, setMensajes] = useState(null);
    const [hayAnteriores, setHayAnteriores] = useState(false);
    const [cargandoAnteriores, setCargandoAnteriores] = useState(false);
    const [error, setError] = useState(null);
    const [foto, setFoto] = useState(null);
    const [resolviendo, setResolviendo] = useState(false);
    const [quitarFoto, setQuitarFoto] = useState(false);
    const [quitando, setQuitando] = useState(false);
    const listaRef = useRef(null);
    const alFondoRef = useRef(true);
    const mensajesRef = useRef(null);
    useEffect(() => { mensajesRef.current = mensajes; }, [mensajes]);

    const id = c.id;

    // Primera página + tomar la conversación; al salir, soltarla.
    useEffect(() => {
        let vivo = true;
        fetchMensajes(id)
            .then((filas) => {
                if (!vivo) return;
                alFondoRef.current = true;
                setMensajes(filas);
                setHayAnteriores(filas.length >= MENSAJES_POR_PAGINA);
                asegurarEquipo(filas.map((m) => m.employee_id));
            })
            .catch((err) => { if (vivo) setError(mensajeAmigable(err, 'No se pudieron cargar los mensajes.')); });
        if (puedeResponder) tomarConversacion(id).then(() => onCambio?.()).catch((err) => console.error('Conversacion: no se pudo tomar', err));
        return () => {
            vivo = false;
            if (puedeResponder) tomarConversacion(id, true).catch(() => {});
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- se toma UNA vez por conversación
    }, [id, puedeResponder]);

    // Sólo lo que llegó después del último mensaje que ya se ve.
    const traerNuevos = useCallback(async () => {
        const actuales = mensajesRef.current;
        if (!actuales) return;
        const ultimo = actuales[actuales.length - 1]?.id ?? null;
        try {
            const nuevos = await fetchMensajes(id, { despuesDe: ultimo });
            if (!nuevos.length) return;
            const lista = listaRef.current;
            alFondoRef.current = !lista || lista.scrollHeight - lista.scrollTop - lista.clientHeight < 120;
            setMensajes((prev) => {
                const ids = new Set((prev ?? []).map((m) => m.id));
                return [...(prev ?? []), ...nuevos.filter((m) => !ids.has(m.id))];
            });
            asegurarEquipo(nuevos.map((m) => m.employee_id));
            if (puedeResponder && nuevos.some((m) => m.autor === 'cliente')) {
                tomarConversacion(id).then(() => onCambio?.()).catch(() => {});
            }
        } catch (err) {
            console.error('Conversacion: no se pudieron traer los mensajes nuevos', err);
        }
    }, [id, puedeResponder, asegurarEquipo, onCambio]);
    useRefrescoEnVivo(traerNuevos, { ms: 20_000, tabla: 'app_chat_mensajes', esperaMs: 250 });

    const verAnteriores = async () => {
        const primero = mensajes?.[0]?.id;
        if (primero == null) return;
        setCargandoAnteriores(true);
        const lista = listaRef.current;
        const altoAntes = lista?.scrollHeight ?? 0;
        try {
            const viejos = await fetchMensajes(id, { antesDe: primero });
            alFondoRef.current = false;
            setMensajes((prev) => [...viejos, ...(prev ?? [])]);
            setHayAnteriores(viejos.length >= MENSAJES_POR_PAGINA);
            asegurarEquipo(viejos.map((m) => m.employee_id));
            // Que la vista no salte: lo que se estaba leyendo queda en su sitio.
            requestAnimationFrame(() => {
                if (lista) lista.scrollTop += lista.scrollHeight - altoAntes;
            });
        } catch (err) {
            showToast('No se pudieron cargar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setCargandoAnteriores(false);
        }
    };

    // Al fondo cuando llega algo y quien lee ya estaba abajo.
    useLayoutEffect(() => {
        const lista = listaRef.current;
        if (lista && alFondoRef.current) lista.scrollTop = lista.scrollHeight;
    }, [mensajes]);

    const resolver = async () => {
        setResolviendo(true);
        try {
            await resolverConversacion(id);
            showToast('Conversación resuelta', 'Si el cliente vuelve a escribir, se abre sola.', 'success');
            onCambio?.();
            onCerrar?.();
        } catch (err) {
            showToast('No se pudo resolver', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setResolviendo(false);
        }
    };

    const confirmarQuitarFoto = async () => {
        setQuitando(true);
        try {
            await quitarFotoDeCliente(c.customer_id);
            showToast('Foto quitada', 'El cliente puede subir otra desde la app.', 'success');
            setQuitarFoto(false);
            onCambio?.();
        } catch (err) {
            showToast('No se pudo quitar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setQuitando(false);
        }
    };

    const tipo = tipoDeCliente(c);
    const nivel = NIVELES[c.nivel];
    const nombre = nombreDeCliente(c.cliente);

    return (
        <div data-surface={comoPanel ? undefined : 'card'} className={`flex flex-col min-h-0 ${comoPanel ? 'h-full' : 'flex-1 rounded-card'}`}>
            {/* ── El cliente ─────────────────────────────────────────────── */}
            <header className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border-subtle">
                <ClienteAvatar conversacion={c} size="lg" />
                <div className="min-w-0 flex-1">
                    <p className="text-body font-semibold text-content truncate">{nombre}</p>
                    <div className="flex flex-wrap items-center gap-1 mt-0.5">
                        <Badge variant={tipo.variant} size="sm" uppercase={false}>{tipo.label}</Badge>
                        {nivel && <Badge variant={nivel.variant} size="sm" uppercase={false}>{nivel.label}</Badge>}
                        {c.telefono && (
                            <a href={`tel:${String(c.telefono).replace(/\D/g, '')}`}
                                className="inline-flex items-center gap-1 text-label text-content-2 hover:text-brand-text min-h-[var(--tap-min)] active:scale-[0.97]">
                                <Phone size={12} /> {c.telefono}
                            </a>
                        )}
                    </div>
                </div>
                {puedeResponder && (
                    <div className="flex flex-wrap items-center gap-1.5">
                        {c.foto_ruta && (
                            <Button variant="ghost" size="sm" icon={ImageOff} onClick={() => setQuitarFoto(true)}>Quitar foto de perfil</Button>
                        )}
                        {c.estado === 'abierta' && (
                            <Button variant="secondary" size="sm" icon={CheckCircle2} loading={resolviendo} onClick={resolver}>Marcar como resuelta</Button>
                        )}
                    </div>
                )}
            </header>

            {/* ── Los mensajes ───────────────────────────────────────────── */}
            <div ref={listaRef} className="flex-1 min-h-[240px] overflow-y-auto overscroll-contain px-4 py-3 space-y-1.5">
                {error && <Notice variant="danger">{error}</Notice>}
                {!mensajes && !error && <SkeletonText lines={4} />}
                {hayAnteriores && (
                    <div className="flex justify-center pb-1">
                        <Button variant="ghost" size="sm" loading={cargandoAnteriores} onClick={verAnteriores}>Ver anteriores</Button>
                    </div>
                )}
                {(mensajes ?? []).map((m, i) => {
                    const previo = mensajes[i - 1];
                    const nuevoGrupo = !previo || previo.autor !== m.autor || previo.employee_id !== m.employee_id
                        || Date.parse(m.created_at) - Date.parse(previo.created_at) > 15 * 60_000;
                    return (
                        <Burbuja key={m.id} mensaje={m} nuevoGrupo={nuevoGrupo}
                            autor={m.employee_id ? equipo.get(m.employee_id) ?? { id: m.employee_id } : null}
                            onFoto={setFoto} />
                    );
                })}
                {mensajes && !mensajes.length && <p className="text-body-sm text-content-3 text-center py-6">Todavía no hay mensajes.</p>}
            </div>

            {/* ── Responder ──────────────────────────────────────────────── */}
            {puedeResponder ? (
                <Compositor conversacion={c} onEnviado={traerNuevos} />
            ) : (
                <p className="px-4 py-3 border-t border-border-subtle text-label text-content-3">Puedes leer las conversaciones; para responder hace falta el permiso de editar.</p>
            )}

            <PhotoLightbox src={foto} alt={`Foto enviada en la conversación con ${nombre}`} onClose={() => setFoto(null)} />
            <ConfirmModal isOpen={quitarFoto} onClose={() => setQuitarFoto(false)} onConfirm={confirmarQuitarFoto}
                isProcessing={quitando} title="¿Quitar la foto de perfil?" confirmText="Quitar foto"
                message={`La foto de ${nombre} deja de verse en el portal y en su app. Puede subir otra cuando quiera.`} />
        </div>
    );
}

// Un mensaje. Los del cliente a la izquierda; los del equipo a la derecha, y
// el primero de cada tanda lleva la foto y el nombre corto de quien contestó.
function Burbuja({ mensaje: m, nuevoGrupo, autor, onFoto }) {
    if (m.autor === 'sistema') {
        return <p className="text-center text-micro text-content-3 py-1">{m.texto}</p>;
    }
    const delEquipo = m.autor === 'equipo';
    const adj = m.adjunto;
    return (
        <div className={`flex flex-col ${delEquipo ? 'items-end' : 'items-start'} ${nuevoGrupo ? 'pt-2' : ''}`}>
            {nuevoGrupo && delEquipo && (
                <span className="flex items-center gap-1.5 mb-1 text-micro text-content-3">
                    <span className="font-semibold text-content-2">{shortEmployeeName(autor)}</span>
                    <AvatarConEstado emp={autor} px={20} mostrarChip={false} />
                </span>
            )}
            <div className={`max-w-[80%] rounded-card px-3 py-2 space-y-1.5 ${delEquipo ? 'bg-brand text-white' : 'bg-surface-card-hover text-content border border-border-subtle'}`}>
                {m.foto_ruta && (
                    m.foto_url ? (
                        <button type="button" onClick={() => onFoto(m.foto_url)} title="Ampliar la foto"
                            className="block rounded-input overflow-hidden active:scale-[0.97] min-h-[var(--tap-min)]">
                            <img src={m.foto_url} alt="Foto enviada en el chat" className="max-h-60 w-auto object-cover" loading="lazy" />
                        </button>
                    ) : <span className="text-label opacity-80">Foto no disponible</span>
                )}
                {adj?.tipo === 'producto' && (
                    <span className={`flex items-center gap-2 rounded-input px-2 py-1.5 ${delEquipo ? 'bg-brand-dark/40' : 'bg-surface-card'}`}>
                        <Package size={14} className="shrink-0" />
                        <span className="min-w-0">
                            <span className="block text-body-sm font-semibold truncate">{adj.nombre}</span>
                            {adj.precio != null && <span className="block text-label tabular-nums">{formatMoney(Number(adj.precio))}</span>}
                        </span>
                    </span>
                )}
                {adj?.tipo === 'oferta' && (
                    <span className={`flex items-center gap-2 rounded-input px-2 py-1.5 ${delEquipo ? 'bg-brand-dark/40' : 'bg-surface-card'}`}>
                        <Tag size={14} className="shrink-0" />
                        <span className="text-body-sm font-semibold min-w-0 truncate">{adj.titulo}</span>
                    </span>
                )}
                {m.texto && <p className="text-body-sm whitespace-pre-wrap break-words">{m.texto}</p>}
            </div>
            <span className="text-micro text-content-3 tabular-nums mt-0.5">{cuandoLlego(m.created_at)}</span>
        </div>
    );
}
