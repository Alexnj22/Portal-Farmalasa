import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CheckCircle2, ImageOff, MessagesSquare, Package, Phone, Tag, UserRound } from 'lucide-react';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import ConfirmModal from '../../components/common/ConfirmModal';
import Notice from '../../components/common/Notice';
import PhotoLightbox from '../../components/common/PhotoLightbox';
import { SkeletonText } from '../../components/common/StateViews';
import SegmentedControl from '../../components/common/SegmentedControl';
import useMediaQuery from '../../plataforma/useMediaQuery';
import { useAuth } from '@nucleo/context/AuthContext';
import { useAlLlegarAviso } from '@nucleo/hooks/avisosRecibidos';
import { useNowTick } from '@nucleo/hooks/useNowTick';
import usePulsacionLarga from '@nucleo/hooks/usePulsacionLarga';
import { useRefrescoEnVivo } from '@nucleo/hooks/useRefrescoEnVivo';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { cuandoLlego } from '@nucleo/utils/notificacionTexto';
import {
    MENSAJES_POR_PAGINA, fetchMensajes, fetchReacciones, quitarFotoDeCliente, reaccionarAMensaje,
    resolverConversacion, tomarConversacion,
} from '@nucleo/data/chatClientes';
import { BarraDeMensaje, CitaDeMensaje, HojaDeMensaje, ReaccionesDeMensaje } from './AccionesDeMensaje';
import ChipsDeEstado from './ChipsDeEstado';
import ClienteAvatar from './ClienteAvatar';
import Compositor from './Compositor';
import PanelCliente from './PanelCliente';
import { NIVELES, nombreDeCliente, tipoDeCliente } from './etiquetas';
import { empiezaTanda } from '@nucleo/utils/chatClientes';
import { escribeAhora, useRelojDeEscritura } from './escribiendo';

// El hilo de una conversación: el contexto del cliente arriba, los mensajes
// (los del cliente a la izquierda, los del equipo a la derecha con la foto y el
// nombre corto de quien contestó) y el cuadro para responder.
//
// Al abrirla se TOMA (`chat_tomar`): el resto del equipo ve «… está
// respondiendo» durante 10 minutos, y al salir se suelta. Cada mensaje nuevo
// del cliente que llega con el hilo abierto la vuelve a tomar, que es lo que
// deja su contador de «sin leer» en cero.
//
// `conPanelCliente` suma el panel «Cliente» (compras, puntos, reservas…): al
// costado en una pantalla ancha (≥1280px y no `comoPanel`), y si no, como una
// segunda pestaña del hilo — en el teléfono y en el panel de la burbuja.
//
// Presencia (2026-10-12): abajo del hilo, «<cliente> está escribiendo…» y
// también «<compañero> está escribiendo…» —para que dos no contesten a la
// vez—; bajo el último mensaje del equipo, «Visto» si el cliente ya lo leyó
// (`sin_leer_cliente` en 0) o «Enviado». Los datos vienen en `conversacion`
// (la bandeja les pone encima la presencia que le llega por realtime).
//
// Reacciones y respuestas citadas (2026-10-12): sobre cada globo, con el
// ratón encima (escritorio) o manteniéndolo presionado (teléfono), los seis
// emojis, «Responder» y «Copiar». Las reacciones van en píldoras bajo el
// globo y llegan en vivo por realtime de `app_chat_reacciones`.

const ANCHO_LATERAL = '(min-width: 1280px)';

export default function Conversacion({ conversacion: c, puedeResponder, equipo, asegurarEquipo, comoPanel, conPanelCliente = false, onCambio, onCerrar }) {
    const ancha = useMediaQuery(ANCHO_LATERAL);
    const lateral = conPanelCliente && ancha && !comoPanel;
    const [pestana, setPestana] = useState('mensajes');
    const verCliente = conPanelCliente && !lateral && pestana === 'cliente';
    const ahora = useNowTick(30_000);
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
    const { user } = useAuth();
    const yo = user?.id ?? null;
    const nombreCliente = nombreDeCliente(c.cliente);

    // ── Reacciones: `Map<mensajeId, filas>` de los mensajes cargados ────────
    const equipoRef = useRef(equipo);
    useEffect(() => { equipoRef.current = equipo; }, [equipo]);
    const [reacciones, setReacciones] = useState(() => new Map());
    const reaccionIdsRef = useRef(new Set());
    const leerReacciones = useCallback(async (ids) => {
        const lista = (ids || []).filter((x) => x != null);
        if (!lista.length) return;
        try {
            const filas = await fetchReacciones(lista);
            filas.forEach((f) => reaccionIdsRef.current.add(f.id));
            setReacciones((prev) => {
                const nuevo = new Map(prev);
                lista.forEach((mid) => nuevo.delete(Number(mid)));
                filas.forEach((f) => nuevo.set(f.mensaje_id, [...(nuevo.get(f.mensaje_id) ?? []), f]));
                return nuevo;
            });
            asegurarEquipo(filas.filter((f) => f.employee_id && !equipoRef.current.has(f.employee_id)).map((f) => f.employee_id));
        } catch (err) {
            console.error('Conversacion: no se pudieron leer las reacciones', err);
        }
    }, [asegurarEquipo]);
    const releerReacciones = useCallback(() => leerReacciones((mensajesRef.current ?? []).map((m) => m.id)), [leerReacciones]);
    // El canal de reacciones es de TODAS las conversaciones: sólo cuenta lo que
    // toca a un mensaje de este hilo (o borra una reacción que está en pantalla;
    // el DELETE sólo trae el id).
    const ignorarReaccion = useCallback((payload) => {
        if (payload?.eventType === 'DELETE') return !reaccionIdsRef.current.has(payload.old?.id);
        const mid = payload?.new?.mensaje_id;
        return !(mensajesRef.current ?? []).some((m) => m.id === mid);
    }, []);
    useRefrescoEnVivo(releerReacciones, { ms: 30_000, tabla: 'app_chat_reacciones', esperaMs: 250, ignorar: ignorarReaccion });

    // Primera página + tomar la conversación; al salir, soltarla.
    useEffect(() => {
        let vivo = true;
        fetchMensajes(id)
            .then((filas) => {
                if (!vivo) return;
                alFondoRef.current = true;
                setMensajes(filas);
                setHayAnteriores(filas.length >= MENSAJES_POR_PAGINA);
                asegurarEquipo(filas.flatMap((m) => [m.employee_id, m.cita?.employee_id]));
                leerReacciones(filas.map((m) => m.id));
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
            asegurarEquipo(nuevos.flatMap((m) => [m.employee_id, m.cita?.employee_id]));
            leerReacciones(nuevos.map((m) => m.id));
            if (puedeResponder && nuevos.some((m) => m.autor === 'cliente')) {
                tomarConversacion(id).then(() => onCambio?.()).catch(() => {});
            }
        } catch (err) {
            console.error('Conversacion: no se pudieron traer los mensajes nuevos', err);
        }
    }, [id, puedeResponder, asegurarEquipo, onCambio, leerReacciones]);
    // Realtime es el camino; el reloj (10 s con la pestaña a la vista) y el
    // aviso de la campana de ESTA conversación, el respaldo. El canal trae los
    // mensajes de TODAS las conversaciones: los de otra no releen este hilo.
    const deOtraConversacion = useCallback((payload) => {
        const conv = payload?.new?.conversacion_id;
        return conv != null && String(conv) !== String(id);
    }, [id]);
    useRefrescoEnVivo(traerNuevos, { ms: 10_000, tabla: 'app_chat_mensajes', esperaMs: 250, ignorar: deOtraConversacion });
    useAlLlegarAviso('CHAT_CLIENTE', (aviso) => {
        const conv = aviso?.metadata?.conversacion_id;
        if (conv == null || String(conv) === String(id)) traerNuevos();
    });

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
            asegurarEquipo(viejos.flatMap((m) => [m.employee_id, m.cita?.employee_id]));
            leerReacciones(viejos.map((m) => m.id));
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

    // ── Sobre un mensaje: reaccionar, responderlo citándolo, copiarlo ───────
    const [respondiendoA, setRespondiendoA] = useState(null);
    const [opcionesDe, setOpcionesDe] = useState(null);
    const [opcionesAbiertas, setOpcionesAbiertas] = useState(false);

    const reaccionar = useCallback(async (mensaje, emoji) => {
        try {
            await reaccionarAMensaje(mensaje.id, emoji);
            leerReacciones([mensaje.id]);   // sin esperar el aviso de realtime
        } catch (err) {
            showToast('No se pudo reaccionar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        }
    }, [leerReacciones, showToast]);

    const copiar = useCallback(async (mensaje) => {
        try {
            await navigator.clipboard.writeText(String(mensaje.texto ?? ''));
            showToast('Texto copiado', '', 'success');
        } catch {
            showToast('No se pudo copiar', 'Selecciona el texto y cópialo a mano.', 'error');
        }
    }, [showToast]);

    // Tocar una cita lleva al mensaje original, si está cargado.
    const irAMensaje = useCallback((mensajeId) => {
        const el = listaRef.current?.querySelector(`[data-mensaje-id="${Number(mensajeId)}"]`);
        if (el) {
            alFondoRef.current = false;
            el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        } else {
            showToast('Es un mensaje anterior', 'Toca «Ver anteriores» para cargarlo.', 'info');
        }
    }, [showToast]);

    const abrirOpciones = useCallback((mensaje) => { setOpcionesDe(mensaje); setOpcionesAbiertas(true); }, []);

    // Mi reacción a cada mensaje (para resaltarla en la hoja del teléfono).
    const misReacciones = new Map();
    reacciones.forEach((filas, mid) => {
        const mia = filas.find((r) => r.autor === 'equipo' && yo && String(r.employee_id) === String(yo));
        if (mia) misReacciones.set(mid, mia.emoji);
    });

    const tipo = tipoDeCliente(c);
    const nivel = NIVELES[c.nivel];
    const nombre = nombreCliente;

    // El último mensaje del equipo es el que lleva «Visto» / «Enviado».
    let ultimoDelEquipo = null;
    for (let i = (mensajes?.length ?? 0) - 1; i >= 0; i -= 1) {
        if (mensajes[i].autor === 'equipo') { ultimoDelEquipo = mensajes[i].id; break; }
    }
    const sinLeerCliente = c.sin_leer_cliente == null ? null : Number(c.sin_leer_cliente);
    const entrega = sinLeerCliente == null ? null : sinLeerCliente === 0 ? 'Visto' : 'Enviado';

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
                        <ChipsDeEstado conversacion={c} ahora={ahora}
                            atiende={c.tomada_vigente ? equipo.get(c.tomada_por) ?? null : null} />
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

            {conPanelCliente && !lateral && (
                <div className="px-4 pt-2">
                    <SegmentedControl size="sm" label="Ver" value={pestana} onChange={setPestana}
                        options={[
                            { value: 'mensajes', label: 'Mensajes', icon: MessagesSquare },
                            { value: 'cliente', label: 'Cliente', icon: UserRound },
                        ]} />
                </div>
            )}

            <div className="flex-1 min-h-0 flex">
            {verCliente && (
                <div className="flex-1 min-w-0 overflow-y-auto overscroll-contain">
                    <PanelCliente customerId={c.customer_id} />
                </div>
            )}
            <div className={`flex-1 min-w-0 min-h-0 flex-col ${verCliente ? 'hidden' : 'flex'}`}>
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
                    const nuevoGrupo = empiezaTanda(m, previo);
                    return (
                        <Burbuja key={m.id} mensaje={m} nuevoGrupo={nuevoGrupo}
                            autor={m.employee_id ? equipo.get(m.employee_id) ?? { id: m.employee_id } : null}
                            entrega={m.id === ultimoDelEquipo ? entrega : null}
                            reacciones={reacciones.get(m.id)} yo={yo} equipo={equipo} cliente={nombre}
                            puedeReaccionar={puedeResponder}
                            onReaccionar={reaccionar} onResponder={setRespondiendoA} onCopiar={copiar}
                            onIrA={irAMensaje} onOpciones={abrirOpciones}
                            onFoto={setFoto} />
                    );
                })}
                {mensajes && !mensajes.length && <p className="text-body-sm text-content-3 text-center py-6">Todavía no hay mensajes.</p>}
            </div>
            <QuienEscribe conversacion={c} cliente={nombre} yo={user?.id} equipo={equipo} asegurarEquipo={asegurarEquipo} />

            {/* ── Responder ──────────────────────────────────────────────── */}
            {puedeResponder ? (
                <Compositor conversacion={c} onEnviado={traerNuevos}
                    respondiendoA={respondiendoA} onQuitarRespuesta={() => setRespondiendoA(null)}
                    equipo={equipo} cliente={nombre} />
            ) : (
                <p className="px-4 py-3 border-t border-border-subtle text-label text-content-3">Puedes leer las conversaciones; para responder hace falta el permiso de editar.</p>
            )}
            </div>
            {lateral && (
                <aside aria-label="Cliente" className="w-[320px] shrink-0 border-l border-border-subtle overflow-y-auto overscroll-contain">
                    <PanelCliente customerId={c.customer_id} />
                </aside>
            )}
            </div>

            <HojaDeMensaje abierto={opcionesAbiertas} mensaje={opcionesDe} misReacciones={misReacciones}
                conTexto={!!opcionesDe?.texto} puedeReaccionar={puedeResponder}
                onClose={() => setOpcionesAbiertas(false)}
                onReaccionar={(e) => opcionesDe && reaccionar(opcionesDe, e)}
                onResponder={() => opcionesDe && setRespondiendoA(opcionesDe)}
                onCopiar={() => opcionesDe && copiar(opcionesDe)} />
            <PhotoLightbox src={foto} alt={`Foto enviada en la conversación con ${nombre}`} onClose={() => setFoto(null)} />
            <ConfirmModal isOpen={quitarFoto} onClose={() => setQuitarFoto(false)} onConfirm={confirmarQuitarFoto}
                isProcessing={quitando} title="¿Quitar la foto de perfil?" confirmText="Quitar foto"
                message={`La foto de ${nombre} deja de verse en el portal y en su app. Puede subir otra cuando quiera.`} />
        </div>
    );
}

// Un mensaje. Los del cliente a la izquierda; los del equipo a la derecha, y
// el primero de cada tanda lleva la foto y el nombre corto de quien contestó.
function Burbuja({
    mensaje: m, nuevoGrupo, autor, entrega, reacciones, yo, equipo, cliente, puedeReaccionar,
    onReaccionar, onResponder, onCopiar, onIrA, onOpciones, onFoto,
}) {
    const conAcciones = m.autor !== 'sistema' && (puedeReaccionar || !!m.texto);
    // Mantener presionado el globo (teléfono) abre la hoja con las acciones.
    const gestos = usePulsacionLarga({ activo: conAcciones, alMantener: () => onOpciones(m) });
    if (m.autor === 'sistema') {
        return <p className="text-center text-micro text-content-3 py-1">{m.texto}</p>;
    }
    const delEquipo = m.autor === 'equipo';
    const adj = m.adjunto;
    const lado = delEquipo ? 'derecha' : 'izquierda';
    return (
        <div data-mensaje-id={m.id} className={`flex flex-col ${delEquipo ? 'items-end' : 'items-start'} ${nuevoGrupo ? 'pt-2' : ''}`}>
            {nuevoGrupo && delEquipo && (
                <span className="flex items-center gap-1.5 mb-1 text-micro text-content-3">
                    <span className="font-semibold text-content-2">{shortEmployeeName(autor)}</span>
                    <AvatarConEstado emp={autor} px={20} mostrarChip={false} />
                </span>
            )}
            <div className="group relative max-w-[80%]">
                {conAcciones && puedeReaccionar && (
                    <BarraDeMensaje alLado={lado} conTexto={!!m.texto}
                        onReaccionar={(e) => onReaccionar(m, e)} onResponder={() => onResponder(m)} onCopiar={() => onCopiar(m)} />
                )}
                <div {...gestos}
                    className={`rounded-card px-3 py-2 space-y-1.5 [@media(pointer:coarse)]:select-none [-webkit-touch-callout:none] ${delEquipo ? 'bg-brand text-white' : 'bg-surface-card-hover text-content border border-border-subtle'}`}>
                    <CitaDeMensaje cita={m.cita} equipo={equipo} cliente={cliente} delEquipo={delEquipo} onIr={onIrA} />
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
            </div>
            <ReaccionesDeMensaje filas={reacciones} yo={yo} equipo={equipo} cliente={cliente} alLado={lado}
                puedeReaccionar={puedeReaccionar} onReaccionar={(e) => onReaccionar(m, e)} />
            <span className="text-micro text-content-3 tabular-nums mt-0.5">
                {cuandoLlego(m.created_at)}
                {entrega && <span className={entrega === 'Visto' ? 'font-semibold text-brand-text' : ''}> · {entrega}</span>}
            </span>
        </div>
    );
}

// «… está escribiendo», abajo del hilo: el cliente (por su primer nombre) y,
// si es OTRA persona del equipo, quién —para que no contesten dos a la vez—.
// Se apaga sola a los 6 s con su propio reloj, sin esperar otro aviso.
function QuienEscribe({ conversacion: c, cliente, yo, equipo, asegurarEquipo }) {
    const otroId = c.escribiendo_por && String(c.escribiendo_por) !== String(yo) ? c.escribiendo_por : null;
    const ahora = useRelojDeEscritura([c.cliente_escribiendo_at, otroId ? c.escribiendo_at : null]);
    const escribeCliente = escribeAhora(c.cliente_escribiendo_at, ahora);
    const escribeOtro = otroId != null && escribeAhora(c.escribiendo_at, ahora);
    const companero = otroId ? equipo.get(otroId) ?? null : null;

    // La ficha del compañero, si todavía no está (para su nombre corto y su foto).
    useEffect(() => {
        if (escribeOtro && !companero) asegurarEquipo([otroId]);
    }, [escribeOtro, companero, otroId, asegurarEquipo]);

    const primerNombre = String(cliente ?? '').split(/\s+/)[0] || 'El cliente';
    return (
        <div role="status" aria-live="polite" className="px-4 empty:hidden">
            {escribeCliente && (
                <span className="flex items-center gap-2 py-1 text-label text-content-3">
                    <Puntos />
                    <span className="truncate">{primerNombre} está escribiendo…</span>
                </span>
            )}
            {escribeOtro && (
                <span className="flex items-center gap-1.5 py-1 text-label font-semibold text-brand-text min-w-0">
                    <AvatarConEstado emp={companero ?? { id: otroId }} px={18} mostrarChip={false} />
                    <span className="truncate">{companero ? shortEmployeeName(companero) : 'Alguien del equipo'} está escribiendo…</span>
                    <Puntos />
                </span>
            )}
        </div>
    );
}

// Los tres puntos que laten, uno detrás del otro.
function Puntos() {
    return (
        <span aria-hidden="true" className="inline-flex items-center gap-0.5 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse [animation-delay:200ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse [animation-delay:400ms]" />
        </span>
    );
}
