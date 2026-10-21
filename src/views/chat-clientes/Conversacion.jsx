import React, { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowDown, Check, CheckCircle2, Clock, FileText, ImageOff, Package, Phone, Sparkles, Tag, Tags, UserRound } from 'lucide-react';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import ConfirmModal from '../../components/common/ConfirmModal';
import Notice from '../../components/common/Notice';
import PhotoLightbox from '../../components/common/PhotoLightbox';
import { Skeleton } from '../../components/common/StateViews';
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
import { diaSV } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import {
    MENSAJES_POR_PAGINA, fetchMensajes, fetchMensajesCambiados, fetchReacciones, quitarFotoDeCliente, reaccionarAMensaje,
    resolverConversacion, responderConversacion, subirFotoDelEquipo, tomarConversacion,
} from '@nucleo/data/chatClientes';
import { guardarHilo, leerHilo } from './hiloEnMemoria';
import { BarraDeMensaje, CitaDeMensaje, HojaDeMensaje, ReaccionesDeMensaje } from './AccionesDeMensaje';
import ChipsDeEstado from './ChipsDeEstado';
import ClienteAvatar from './ClienteAvatar';
import AsignadoA from './AsignadoA';
import Compositor from './Compositor';
import NotaDeVoz from './NotaDeVoz';
import PanelCliente from './PanelCliente';
import { NIVELES, nombreDeCliente, tipoDeCliente } from './etiquetas';
import ChipPreferente from './Preferente';
import { cambiaDeDia, empiezaTanda, etiquetaDeDia, primerSinLeer } from '@nucleo/utils/chatClientes';
import { ChipsDeEtiquetas, EditorDeEtiquetas } from './EtiquetasDelCliente';
import { CalificacionEnLinea } from './Calificacion';
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
// costado en una pantalla ancha (≥1536px y no `comoPanel`), y si no, como una
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
//
// Lo nuevo se ve (2026-10-13, «estilo iMessage con WhatsApp»): al abrir una
// conversación con mensajes sin leer, una franja «N mensajes nuevos» antes
// del primero y el hilo se abre AHÍ, no al fondo. El número se toma de la
// bandeja al montar, ANTES de que `chat_tomar` lo ponga en cero. Con el hilo
// abierto y quien lee más arriba, lo que llega suma en un botón «↓ N nuevos»
// en vez de mover la pantalla; y el globo recién llegado entra con un realce
// breve. Separadores «Hoy / Ayer / fecha», globos agrupados por tanda (la
// hora va al final de cada una) y, en los del equipo, «Enviado» o «Visto»:
// `sin_leer_cliente` dice cuántos de los últimos todavía no leyó.

// La ficha va al costado sólo desde 1536px: a 1280 la bandeja (360) y la ficha
// (320) dejaban el hilo en ~200px, con globos de tres palabras por renglón
// (medido 2026-10-21). Más angosto, se abre con el botón de la barra.
const ANCHO_LATERAL = '(min-width: 1536px)';

export default function Conversacion({ conversacion: c, puedeResponder, equipo, asegurarEquipo, comoPanel, conPanelCliente = false, onCambio, onCerrar }) {
    const ancha = useMediaQuery(ANCHO_LATERAL);
    const lateral = conPanelCliente && ancha && !comoPanel;
    const [pestana, setPestana] = useState('mensajes');
    const verCliente = conPanelCliente && !lateral && pestana === 'cliente';
    const ahora = useNowTick(30_000);
    const showToast = useToastStore((s) => s.showToast);
    // Lo que ya había en memoria de esta conversación (ver `hiloEnMemoria`):
    // se pinta en el primer cuadro y la lectura fresca lo pone al día detrás.
    const [enMemoria] = useState(() => leerHilo(c.id));
    const [mensajes, setMensajes] = useState(() => enMemoria?.mensajes ?? null);
    const [hayAnteriores, setHayAnteriores] = useState(() => enMemoria?.hayAnteriores ?? false);
    const [cargandoAnteriores, setCargandoAnteriores] = useState(false);
    const [error, setError] = useState(null);
    const [foto, setFoto] = useState(null);
    const [resolviendo, setResolviendo] = useState(false);
    const [quitarFoto, setQuitarFoto] = useState(false);
    const [quitando, setQuitando] = useState(false);
    const [editandoEtiquetas, setEditandoEtiquetas] = useState(false);
    const listaRef = useRef(null);
    const alFondoRef = useRef(true);
    // Lo sin leer AL ABRIR (antes de tomarla) y dónde va la franja.
    const [sinLeerAlAbrir] = useState(() => Number(c.sin_leer_equipo) || 0);
    const [divisor, setDivisor] = useState(null);       // { id, n }
    const irAlDivisorRef = useRef(false);
    // Lo que llegó mientras se leía más arriba, y los globos recién llegados.
    const [nuevosAbajo, setNuevosAbajo] = useState(0);
    const [recientes, setRecientes] = useState(() => new Set());
    const mensajesRef = useRef(null);
    useEffect(() => { mensajesRef.current = mensajes; }, [mensajes]);

    const id = c.id;
    const { user } = useAuth();
    const yo = user?.id ?? null;
    const nombreCliente = nombreDeCliente(c.cliente);

    // ── Reacciones: `Map<mensajeId, filas>` de los mensajes cargados ────────
    const equipoRef = useRef(equipo);
    useEffect(() => { equipoRef.current = equipo; }, [equipo]);
    const [reacciones, setReacciones] = useState(() => enMemoria?.reacciones ?? new Map());
    const [reaccionIds] = useState(() => new Set([...(enMemoria?.reacciones?.values() ?? [])].flat().map((r) => r.id)));
    const leerReacciones = useCallback(async (ids) => {
        const lista = (ids || []).filter((x) => x != null);
        if (!lista.length) return;
        try {
            const filas = await fetchReacciones(lista);
            filas.forEach((f) => reaccionIds.add(f.id));
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
    }, [asegurarEquipo, reaccionIds]);
    const releerReacciones = useCallback(() => leerReacciones((mensajesRef.current ?? []).filter((m) => !m.temporal).map((m) => m.id)), [leerReacciones]);
    // El canal de reacciones es de TODAS las conversaciones: sólo cuenta lo que
    // toca a un mensaje de este hilo (o borra una reacción que está en pantalla;
    // el DELETE sólo trae el id).
    const ignorarReaccion = useCallback((payload) => {
        if (payload?.eventType === 'DELETE') return !reaccionIds.has(payload.old?.id);
        const mid = payload?.new?.mensaje_id;
        return !(mensajesRef.current ?? []).some((m) => m.id === mid);
    }, [reaccionIds]);
    useRefrescoEnVivo(releerReacciones, { ms: 30_000, tabla: 'app_chat_reacciones', esperaMs: 250, ignorar: ignorarReaccion });

    // Primera página + tomar la conversación; al salir, soltarla.
    useEffect(() => {
        let vivo = true;
        fetchMensajes(id)
            .then((filas) => {
                if (!vivo) return;
                const primero = primerSinLeer(filas, sinLeerAlAbrir);
                if (primero != null) {
                    setDivisor({ id: primero, n: sinLeerAlAbrir });
                    irAlDivisorRef.current = true;
                    alFondoRef.current = false;
                } else {
                    alFondoRef.current = true;
                }
                // Lo que se esté enviando en este momento no se pierde.
                setMensajes((prev) => [...filas, ...(prev ?? []).filter((m) => m.temporal)]);
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

    // El hilo queda en memoria para la próxima vez (sin lo que se está enviando).
    useEffect(() => {
        if (mensajes) guardarHilo(c.id, { mensajes: mensajes.filter((m) => !m.temporal), hayAnteriores, reacciones });
    }, [c.id, mensajes, hayAnteriores, reacciones]);

    // Sólo lo que llegó después del último mensaje que ya se ve.
    // Desde cuándo se buscan cambios (ediciones y borrados del cliente, 2026-10-20).
    const cambiosDesdeRef = useRef(new Date().toISOString());
    const traerNuevos = useCallback(async () => {
        const actuales = mensajesRef.current;
        if (!actuales) return;
        const ultimo = actuales.filter((m) => !m.temporal).at(-1)?.id ?? null;
        try {
            const desde = cambiosDesdeRef.current;
            cambiosDesdeRef.current = new Date(Date.now() - 5000).toISOString();
            const [nuevos, cambiados] = await Promise.all([fetchMensajes(id, { despuesDe: ultimo }), fetchMensajesCambiados(id, desde)]);
            if (cambiados.length) {
                const porId = new Map(cambiados.map((m) => [m.id, m]));
                setMensajes((prev) => (prev ?? []).map((m) => (porId.has(m.id) ? { ...m, ...porId.get(m.id) } : m)));
            }
            if (!nuevos.length) return;
            const lista = listaRef.current;
            alFondoRef.current = !lista || lista.scrollHeight - lista.scrollTop - lista.clientHeight < 120;
            const ids = new Set(actuales.map((m) => m.id));
            const llegados = nuevos.filter((m) => !ids.has(m.id));
            setMensajes((prev) => fusionar(prev, nuevos));
            // Lo del cliente entra con realce; si quien lee está más arriba,
            // suma en el botón en vez de mover la pantalla.
            const delCliente = llegados.filter((m) => m.autor === 'cliente');
            if (delCliente.length) {
                setRecientes((prev) => new Set([...prev, ...delCliente.map((m) => m.id)]));
                if (!alFondoRef.current) setNuevosAbajo((n) => n + delCliente.length);
            }
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

    // Al abrir con mensajes sin leer, a la franja; si no, al fondo cuando
    // llega algo y quien lee ya estaba abajo.
    useLayoutEffect(() => {
        const lista = listaRef.current;
        if (!lista) return;
        if (irAlDivisorRef.current) {
            const franja = lista.querySelector('[data-franja-nuevos]');
            if (franja) {
                irAlDivisorRef.current = false;
                lista.scrollTop += franja.getBoundingClientRect().top - lista.getBoundingClientRect().top - 12;
                alFondoRef.current = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 120;
                return;
            }
        }
        if (alFondoRef.current) lista.scrollTop = lista.scrollHeight;
    }, [mensajes]);

    // El realce de lo recién llegado se apaga solo.
    useEffect(() => {
        if (!recientes.size) return undefined;
        const t = setTimeout(() => setRecientes(new Set()), 2400);
        return () => clearTimeout(t);
    }, [recientes]);

    // Quién lee ¿está abajo? Al llegar al fondo, el botón de nuevos se va.
    const alDesplazar = useCallback(() => {
        const lista = listaRef.current;
        if (!lista) return;
        const abajo = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 120;
        alFondoRef.current = abajo;
        if (abajo) setNuevosAbajo((n) => (n ? 0 : n));
    }, []);
    const bajarAlFondo = () => {
        const lista = listaRef.current;
        if (lista) lista.scrollTo({ top: lista.scrollHeight, behavior: 'smooth' });
        alFondoRef.current = true;
        setNuevosAbajo(0);
    };

    // ── Enviar: el globo aparece AL TOCAR, no cuando contesta el servidor ──
    // Como en la app de clientes: el mensaje entra al hilo como «temporal»
    // (con un reloj en vez de ✓), y cuando el real llega por la lectura de lo
    // nuevo lo reemplaza (`fusionar`). Si falla se queda con «No se envió» y se
    // reintenta tocándolo — antes el texto se quedaba en el cuadro y nada se movía.
    const enviarMensaje = useCallback(async (envio, previo = null) => {
        const tmpId = previo?.id ?? `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const r = envio.respuestaA;
        const temporal = {
            id: tmpId, temporal: true, pendiente: true, envio,
            autor: 'equipo', employee_id: yo, texto: String(envio.texto ?? '').trim() || null,
            foto_ruta: envio.archivo ? 'local' : null,
            foto_url: previo?.foto_url ?? (envio.archivo ? URL.createObjectURL(envio.archivo) : null),
            adjunto: envio.adjunto ?? null, created_at: new Date().toISOString(),
            cita: r ? { id: r.id, autor: r.autor, employee_id: r.employee_id, texto: r.texto, foto_ruta: r.foto_ruta } : null,
        };
        alFondoRef.current = true;
        setNuevosAbajo(0);
        setMensajes((prev) => (previo ? (prev ?? []).map((m) => (m.id === tmpId ? temporal : m)) : [...(prev ?? []), temporal]));
        try {
            const fotoRuta = envio.archivo ? await subirFotoDelEquipo(c.customer_id, envio.archivo) : null;
            await responderConversacion(id, { texto: envio.texto, fotoRuta, adjunto: envio.adjunto, respuestaA: r?.id ?? null });
            await traerNuevos();
            // Si el real todavía no llegó, por lo menos que diga «enviado».
            setMensajes((prev) => (prev ?? []).map((m) => (m.id === tmpId ? { ...m, pendiente: false, enviado: true } : m)));
        } catch (err) {
            console.error('Conversacion: no se pudo enviar', err);
            setMensajes((prev) => (prev ?? []).map((m) => (m.id === tmpId ? { ...m, pendiente: false, fallido: true } : m)));
        }
    }, [id, yo, c.customer_id, traerNuevos]);
    const reintentar = useCallback((m) => enviarMensaje(m.envio, m), [enviarMensaje]);

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
    const hoy = diaSV(ahora);

    // «Enviado» / «Visto» de los mensajes del equipo: `sin_leer_cliente` dice
    // cuántos de los ÚLTIMOS todavía no leyó; los anteriores, ya los vio.
    const sinLeerCliente = c.sin_leer_cliente == null ? null : Number(c.sin_leer_cliente);
    const noVistos = new Set();
    if (sinLeerCliente != null && mensajes) {
        const delEquipo = mensajes.filter((m) => m.autor === 'equipo' && !m.temporal);
        delEquipo.slice(Math.max(0, delEquipo.length - sinLeerCliente)).forEach((m) => noVistos.add(m.id));
    }
    const entregaDe = (m) => (sinLeerCliente == null || m.autor !== 'equipo' || m.temporal ? null : noVistos.has(m.id) ? 'Enviado' : 'Visto');

    return (
        <div data-surface={comoPanel ? undefined : 'card'} className={`flex flex-col min-h-0 ${comoPanel ? 'h-full' : 'flex-1 rounded-card overflow-hidden'}`}>
            {/* ── El cliente ─────────────────────────────────────────────
                Como la barra de una app de mensajería (2026-10-20): foto,
                nombre y estado a la izquierda, las acciones como íconos a la
                derecha. La ficha del cliente se abre desde la barra (ya no es
                una fila de pestañas) y lo secundario —teléfono, calificación,
                asignación, etiquetas— va en una franja fina debajo. */}
            <header className="flex-none flex items-center gap-3 px-3 py-2.5 border-b border-border-card">
                <ClienteAvatar conversacion={c} size={comoPanel ? 'md' : 'lg'} />
                <div className="min-w-0 flex-1">
                    <p className="text-body-sm font-black text-content truncate" title={nombre}>{nombre}</p>
                    <div className="flex flex-wrap items-center gap-1 mt-0.5">
                        <ChipsDeEstado conversacion={c} ahora={ahora}
                            atiende={c.tomada_vigente ? equipo.get(c.tomada_por) ?? null : null} />
                        <ChipPreferente conversacion={c} />
                        {/* «Cliente» es el caso común: sólo se rotula lo que no lo es. */}
                        {(c.es_team || c.es_mayoreo) && <Badge variant={tipo.variant} size="sm" uppercase={false}>{tipo.label}</Badge>}
                        {nivel && <Badge variant={nivel.variant} size="sm" uppercase={false}>{nivel.label}</Badge>}
                    </div>
                </div>
                <div className="flex-none flex items-center gap-0.5">
                    {conPanelCliente && !lateral && (
                        <Button variant={verCliente ? 'secondary' : 'ghost'} size="sm" iconOnly icon={UserRound} aria-pressed={verCliente}
                            title={verCliente ? 'Volver a los mensajes' : 'Ver la ficha del cliente'}
                            onClick={() => setPestana(verCliente ? 'mensajes' : 'cliente')} />
                    )}
                    {puedeResponder && c.foto_ruta && (
                        <Button variant="ghost" size="sm" icon={ImageOff} iconOnly title="Quitar la foto de perfil" onClick={() => setQuitarFoto(true)} />
                    )}
                    {puedeResponder && c.estado === 'abierta' && (
                        <Button variant="secondary" size="sm" icon={CheckCircle2} loading={resolviendo} onClick={resolver}
                            title="Marcar como resuelta" className="ml-1">
                            {comoPanel ? 'Resolver' : 'Marcar como resuelta'}
                        </Button>
                    )}
                </div>
            </header>
            {/* Con la ficha abierta, esta franja la repetiría. */}
            {!verCliente && (c.telefono || c.calificacion || c.asignada_a || c.etiquetas?.length > 0 || puedeResponder) && (
                <div className="flex-none flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 border-b border-border-card text-label text-content-2">
                    {c.telefono && (
                        <a href={`tel:${String(c.telefono).replace(/\D/g, '')}`}
                            className="inline-flex items-center gap-1 rounded-btn hover:text-brand-text tabular-nums min-h-[var(--tap-min)] md:min-h-0 active:scale-[0.97]">
                            <Phone size={12} /> {c.telefono}
                        </a>
                    )}
                    {c.calificacion ? <CalificacionEnLinea conversacion={c} /> : null}
                    {c.asignada_a && <AsignadoA conversacion={c} equipo={equipo} />}
                    {(c.etiquetas?.length > 0 || puedeResponder) && (
                        <span className="inline-flex flex-wrap items-center gap-1">
                            <ChipsDeEtiquetas conversacion={c} />
                            {puedeResponder && (
                                <Button variant="ghost" size="xs" icon={Tags} onClick={() => setEditandoEtiquetas(true)}>
                                    {c.etiquetas?.length ? 'Editar' : 'Etiquetar'}
                                </Button>
                            )}
                        </span>
                    )}
                </div>
            )}

            <div className="flex-1 min-h-0 flex">
            {verCliente && (
                <div className="flex-1 min-w-0 overflow-y-auto overscroll-contain">
                    <PanelCliente customerId={c.customer_id} conversacion={c} />
                </div>
            )}
            <div className={`flex-1 min-w-0 min-h-0 flex-col ${verCliente ? 'hidden' : 'flex'}`}>
            {/* ── Los mensajes ───────────────────────────────────────────── */}
            <div className="relative flex-1 min-h-[240px] flex flex-col">
            <div ref={listaRef} onScroll={alDesplazar} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 sm:px-4 pb-5 bg-brand/5">
                {error && <Notice variant="danger">{error}</Notice>}
                {!mensajes && !error && <HiloCargando />}
                {hayAnteriores && (
                    <div className="flex justify-center pb-2">
                        <Button variant="ghost" size="sm" loading={cargandoAnteriores} onClick={verAnteriores}>Ver anteriores</Button>
                    </div>
                )}
                {(mensajes ?? []).map((m, i) => {
                    const previo = mensajes[i - 1];
                    const siguiente = mensajes[i + 1];
                    const otroDia = cambiaDeDia(m, previo);
                    const nuevoGrupo = otroDia || empiezaTanda(m, previo) || divisor?.id === m.id;
                    const finDeGrupo = !siguiente || cambiaDeDia(siguiente, m) || empiezaTanda(siguiente, m) || divisor?.id === siguiente.id;
                    return (
                        <React.Fragment key={m.id}>
                            {otroDia && <Separador>{etiquetaDeDia(m.created_at, hoy)}</Separador>}
                            {divisor?.id === m.id && (
                                <div data-franja-nuevos="" role="separator" aria-label={`${divisor.n} ${divisor.n === 1 ? 'mensaje nuevo' : 'mensajes nuevos'}`}
                                    className="flex items-center gap-3 py-3">
                                    <span className="flex-1 h-px bg-brand/30" />
                                    <Badge variant="info" size="sm" uppercase={false}>
                                        {divisor.n} {divisor.n === 1 ? 'mensaje nuevo' : 'mensajes nuevos'}
                                    </Badge>
                                    <span className="flex-1 h-px bg-brand/30" />
                                </div>
                            )}
                            <Burbuja mensaje={m} nuevoGrupo={nuevoGrupo} finDeGrupo={finDeGrupo}
                                recien={recientes.has(m.id)}
                                entrega={finDeGrupo ? entregaDe(m) : null}
                                reacciones={reacciones.get(m.id)} yo={yo} equipo={equipo} cliente={nombre}
                                puedeReaccionar={puedeResponder}
                                onReaccionar={reaccionar} onResponder={setRespondiendoA} onCopiar={copiar}
                                onIrA={irAMensaje} onOpciones={abrirOpciones}
                                onFoto={setFoto} onReintentar={reintentar} />
                        </React.Fragment>
                    );
                })}
                {mensajes && !mensajes.length && (
                    <p className="text-body-sm text-content-3 text-center py-10">Todavía no hay mensajes.</p>
                )}
            </div>
            {nuevosAbajo > 0 && (
                <div className="absolute inset-x-0 bottom-3 flex justify-center pointer-events-none">
                    <Button variant="primary" size="sm" icon={ArrowDown} onClick={bajarAlFondo}
                        className="pointer-events-auto shadow-[var(--shadow-glow-brand)] animate-in fade-in slide-in-from-bottom-2 duration-[var(--dur-base)]">
                        {nuevosAbajo} {nuevosAbajo === 1 ? 'nuevo' : 'nuevos'}
                    </Button>
                </div>
            )}
            </div>
            <QuienEscribe conversacion={c} cliente={nombre} yo={user?.id} equipo={equipo} asegurarEquipo={asegurarEquipo} />

            {/* ── Responder ──────────────────────────────────────────────── */}
            {puedeResponder ? (
                <Compositor conversacion={c} onEnviar={enviarMensaje}
                    respondiendoA={respondiendoA} onQuitarRespuesta={() => setRespondiendoA(null)}
                    equipo={equipo} cliente={nombre} />
            ) : (
                <p className="px-4 py-3 border-t border-border-card text-label text-content-3">Puedes leer las conversaciones; para responder hace falta el permiso de editar.</p>
            )}
            </div>
            {lateral && (
                <aside aria-label="Cliente" className="w-[320px] shrink-0 border-l border-border-card overflow-y-auto overscroll-contain">
                    <PanelCliente customerId={c.customer_id} conversacion={c} />
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
            {editandoEtiquetas && (
                <EditorDeEtiquetas abierto conversacion={c} onClose={() => setEditandoEtiquetas(false)} onGuardado={onCambio} />
            )}
        </div>
    );
}

// Agrega al hilo lo que todavía no está, y retira el globo temporal que un
// mensaje real del equipo viene a reemplazar (mismo autor y mismo texto). Los
// temporales que quedan siguen al final, que es donde se escribieron.
function fusionar(prev, nuevos) {
    const base = prev ?? [];
    const ya = new Set(base.map((m) => m.id));
    const entran = nuevos.filter((m) => !ya.has(m.id));
    if (!entran.length) return base;
    const reemplazados = new Set();
    entran.filter((n) => n.autor === 'equipo').forEach((n) => {
        const t = base.find((m) => m.temporal && !m.fallido && !reemplazados.has(m.id)
            && String(m.employee_id) === String(n.employee_id) && (m.texto ?? null) === (n.texto ?? null));
        if (t) {
            reemplazados.add(t.id);
            if (String(t.foto_url ?? '').startsWith('blob:')) URL.revokeObjectURL(t.foto_url);
        }
    });
    const quedan = base.filter((m) => !reemplazados.has(m.id));
    return [...quedan.filter((m) => !m.temporal), ...entran, ...quedan.filter((m) => m.temporal)];
}

// «Hoy», «Ayer», «lunes, 5 de octubre»: una píldora centrada que se queda
// pegada arriba mientras se recorre ese día, como en las apps de mensajería.
function Separador({ children }) {
    return (
        <div role="separator" className="sticky top-0 z-base flex justify-center pt-2 pb-1 pointer-events-none">
            <span className="rounded-badge border border-border-card bg-surface-card px-3 py-1 text-micro font-semibold text-content-2 shadow-sm">{children}</span>
        </div>
    );
}

// Mientras llegan los mensajes: globos con la forma de globos, a los dos lados.
function HiloCargando() {
    return (
        <div aria-hidden="true" className="space-y-3 py-2">
            {['60%', '40%', '50%', '33%'].map((ancho, i) => (
                <div key={ancho} className={`flex ${i % 2 ? 'justify-end' : 'justify-start'}`}>
                    <Skeleton h={36} rounded="1.25rem" w={ancho} />
                </div>
            ))}
        </div>
    );
}

// Un mensaje. Los del cliente a la izquierda; los del equipo a la derecha, y
// el primero de cada tanda lleva la foto y el nombre corto de quien contestó.
// Globos agrupados como en iMessage: dentro de una tanda la esquina del lado
// del autor se achica, y la hora (con ✓ «Enviado» / ✓✓ «Visto») va dentro del
// último globo de la tanda.
// La foto del CATÁLOGO de un producto enviado (bucket público product-photos), no de una persona.
const imagenDeProducto = (a) => a?.foto ?? undefined;

// `memo`: el hilo se vuelve a dibujar con cada relectura de la bandeja y cada
// tic del reloj; sin esto se rehacían TODOS los globos cada vez. Las acciones
// que recibe son estables (`useCallback` en `Conversacion`).
const Burbuja = memo(function Burbuja({
    mensaje: m, nuevoGrupo, finDeGrupo, recien, entrega, reacciones, yo, equipo, cliente, puedeReaccionar,
    onReaccionar, onResponder, onCopiar, onIrA, onOpciones, onFoto, onReintentar,
}) {
    const autor = m.employee_id ? equipo.get(m.employee_id) ?? { id: m.employee_id } : null;
    const conAcciones = m.autor !== 'sistema' && !m.temporal && (puedeReaccionar || !!m.texto);
    // Mantener presionado el globo (teléfono) abre la hoja con las acciones.
    const gestos = usePulsacionLarga({ activo: conAcciones, alMantener: () => onOpciones(m) });
    // La respuesta automática (2026-10-20): del lado del equipo, con su rótulo,
    // para que se vea qué contestó la app sola y se pueda corregir.
    if (m.autor === 'sistema' && m.automatica) {
        return (
            <div data-mensaje-id={m.id} className="flex flex-col items-end pt-1.5">
                <span className="flex items-center gap-1 mb-1 text-micro text-content-3"><Sparkles size={12} /> Respuesta automática</span>
                <div className="max-w-[min(80%,34rem)] rounded-[1.25rem] px-3.5 py-2 space-y-1.5 bg-surface-card text-content border border-brand/30 shadow-sm">
                    {m.adjunto?.tipo === 'producto' && (
                        <span className="flex items-center gap-2.5 rounded-input px-2 py-1.5 bg-surface-card-hover min-w-[13rem]">
                            {m.adjunto.foto
                                ? <img src={imagenDeProducto(m.adjunto)} alt="" className="size-10 shrink-0 rounded-input object-contain bg-surface-card" loading="lazy" />
                                : <Package size={14} className="shrink-0" />}
                            <span className="min-w-0">
                                <span className="block text-body-sm font-semibold truncate">{m.adjunto.nombre}</span>
                                {m.adjunto.precio != null && <span className="block text-label tabular-nums">{formatMoney(Number(m.adjunto.precio))}</span>}
                            </span>
                        </span>
                    )}
                    {m.texto && <p className="text-body-sm whitespace-pre-wrap break-words">{m.texto}</p>}
                    <span className="flex justify-end -mt-0.5 text-micro tabular-nums opacity-75">{hora12(m.created_at)}</span>
                </div>
            </div>
        );
    }
    if (m.autor === 'sistema') {
        return (
            <p className="mx-auto my-2 w-fit max-w-[85%] rounded-input bg-surface-card/70 px-3 py-1.5 text-center text-micro text-content-3">
                {m.texto}
            </p>
        );
    }
    const delEquipo = m.autor === 'equipo';
    const adj = m.adjunto;
    const lado = delEquipo ? 'derecha' : 'izquierda';
    // Las esquinas del lado del autor: redondas al empezar y al terminar la
    // tanda, chicas en el medio (el globo «se pega» al de arriba y al de abajo).
    const esquinas = delEquipo
        ? `${nuevoGrupo ? '' : 'rounded-tr-[0.375rem]'} ${finDeGrupo ? '' : 'rounded-br-[0.375rem]'}`
        : `${nuevoGrupo ? '' : 'rounded-tl-[0.375rem]'} ${finDeGrupo ? '' : 'rounded-bl-[0.375rem]'}`;
    return (
        <div data-mensaje-id={m.id}
            className={`flex flex-col ${delEquipo ? 'items-end' : 'items-start'} ${nuevoGrupo ? 'pt-2.5' : 'pt-0.5'}
                ${recien || m.temporal ? 'animate-in fade-in slide-in-from-bottom-1 duration-[var(--dur-base)]' : ''}`}>
            {nuevoGrupo && delEquipo && (
                <span className="flex items-center gap-1.5 mb-1 text-micro text-content-3 max-w-[80%] min-w-0">
                    <span className="font-semibold text-content-2 truncate">{shortEmployeeName(autor)}</span>
                    <AvatarConEstado emp={autor} px={20} mostrarChip={false} />
                </span>
            )}
            <div className="group relative max-w-[min(80%,34rem)]">
                {conAcciones && puedeReaccionar && (
                    <BarraDeMensaje alLado={lado} conTexto={!!m.texto}
                        onReaccionar={(e) => onReaccionar(m, e)} onResponder={() => onResponder(m)} onCopiar={() => onCopiar(m)} />
                )}
                <div {...gestos}
                    className={`rounded-[1.25rem] ${esquinas} px-3.5 py-2 space-y-1.5 [@media(pointer:coarse)]:select-none [-webkit-touch-callout:none]
                        transition-shadow duration-[var(--dur-lento)]
                        ${delEquipo ? 'bg-brand text-white shadow-sm' : 'bg-surface-card text-content border border-border-card shadow-sm'}
                        ${m.borrado_at ? 'opacity-60' : ''} ${m.pendiente ? 'opacity-75' : ''} ${m.fallido ? 'ring-2 ring-danger/45' : ''}
                        ${recien ? 'ring-2 ring-brand/45 ring-offset-1 ring-offset-transparent' : ''}`}>
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
                        <span className={`flex items-center gap-2.5 rounded-input px-2 py-1.5 min-w-[13rem] ${delEquipo ? 'bg-brand-dark/40' : 'bg-surface-card'}`}>
                            {adj.foto
                                ? <img src={imagenDeProducto(adj)} alt="" className="size-10 shrink-0 rounded-input object-contain bg-surface-card" loading="lazy" />
                                : <Package size={14} className="shrink-0" />}
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
                    {/* La nota de voz del cliente (m4a/AAC). */}
                    {adj?.tipo === 'audio' && <NotaDeVoz key={m.archivo_url ?? 'sin-archivo'} src={m.archivo_url} delEquipo={delEquipo} />}
                    {adj?.tipo === 'pdf' && (
                        <a href={m.archivo_url ?? undefined} target="_blank" rel="noreferrer" title="Abrir el documento"
                            className={`flex items-center gap-2 rounded-input px-2 py-1.5 min-h-[var(--tap-min)] active:scale-[0.97] ${delEquipo ? 'bg-brand-dark/40' : 'bg-surface-card'}`}>
                            <FileText size={14} className="shrink-0" />
                            <span className="text-body-sm font-semibold min-w-0 truncate">{adj.nombre || 'Documento PDF'}</span>
                        </a>
                    )}
                    {m.texto && <p className={`text-body-sm whitespace-pre-wrap break-words ${m.borrado_at ? 'line-through' : ''}`}>{m.texto}</p>}
                    {/* El cliente lo borró (2026-10-20): el equipo lo sigue viendo, tachado y con aviso. */}
                    {m.borrado_at && <p className="text-micro font-semibold opacity-80">El cliente eliminó este mensaje</p>}
                    {/* La hora va DENTRO del globo, abajo a la derecha, con la
                        doble marca de «Visto» en los del equipo. */}
                    {m.fallido ? (
                        <button type="button" onClick={() => onReintentar(m)}
                            className="flex items-center justify-end gap-1 w-full -mt-0.5 text-micro font-semibold min-h-[var(--tap-min)] md:min-h-0 active:scale-[0.97]">
                            <AlertCircle size={12} aria-hidden="true" /> No se envió · Reintentar
                        </button>
                    ) : m.temporal ? (
                        <span className="flex items-center justify-end gap-1 -mt-0.5 text-micro tabular-nums opacity-75">
                            {hora12(m.created_at)}
                            {m.pendiente ? <Clock size={11} aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}
                            <span className="sr-only">{m.pendiente ? 'Enviando' : 'Enviado'}</span>
                        </span>
                    ) : finDeGrupo && (
                        <span className="flex items-center justify-end gap-1 -mt-0.5 text-micro tabular-nums opacity-75">
                            {m.editado_at && !m.borrado_at && <span>Editado ·</span>}
                            {hora12(m.created_at)}
                            {entrega && (
                                <>
                                    {/* Una marca = enviado; dos montadas = visto. Es la
                                        señal de lectura de toda app de mensajería, no el
                                        «hecho» que §12 unificó en `Check`. */}
                                    <span aria-hidden="true" className="inline-flex">
                                        <Check size={13} />
                                        {entrega === 'Visto' && <Check size={13} className="-ml-2" />}
                                    </span>
                                    <span className="sr-only">{entrega}</span>
                                </>
                            )}
                        </span>
                    )}
                </div>
            </div>
            <ReaccionesDeMensaje filas={reacciones} yo={yo} equipo={equipo} cliente={cliente} alLado={lado}
                puedeReaccionar={puedeReaccionar} onReaccionar={(e) => onReaccionar(m, e)} />
        </div>
    );
});

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
