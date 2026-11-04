import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import SalyAvatar from '../common/SalyAvatar';
import PiezasDeSaly from './PiezasDeSaly';
import PortalInput from '../common/PortalInput';
import Button from '../common/Button';
import { useSalyAyudaStore } from './salyAyudaStore';
import { calificarAyudaDeSaly, preguntarAyudaDeSaly } from '@nucleo/data/salyAyuda';
import {
    SALY_MAX_PANTALLA, SALY_MAX_PREGUNTA, avisoDeInactividad, claveDePregunta,
    taparDatosPersonales, validarPiezas,
} from '@nucleo/utils/salyAyuda';

/**
 * Saly, ayuda en pantalla (docs/PLAN-SALY-AYUDA-EN-PANTALLA-2026-11-04.md).
 *
 * Una burbuja abajo a la derecha, con su figura. Aparece sólo en las
 * pantallas que se anotaron con `useSalyEnPantalla`. Tres cosas, en orden de
 * costo:
 *
 *   1. AVISOS que arma el portal con sus números (faltante, freno del cierre,
 *      error, rato quieto): cambia de emoción y OFRECE explicar. $0.
 *   2. La EXPLICACIÓN de ese aviso, escrita en la guía. $0.
 *   3. Una PREGUNTA escrita: la única que va a la IA, con lo que se ve en
 *      pantalla (con los datos personales tapados) y el modelo más barato.
 *
 * Nunca guarda, aprueba ni envía: puede poner filtros —quedan marcados con su
 * color— y llevar a otra pantalla. Lo demás lo hace la persona.
 *
 * Se para como la burbuja del chat con clientes y se corre a su izquierda si
 * está. Con un diálogo abierto se esconde, salvo para ofrecer ayuda a quien
 * lleva rato quieto en un formulario: ahí aparece abajo a la IZQUIERDA, donde
 * no tapa los botones del diálogo.
 */

const QUIETO_MS = 3 * 60_000;
// Lo que ya se descartó o se contestó vive lo que la pestaña: así una vuelta
// a la pantalla no repite el mismo aviso, y la misma pregunta no se paga dos veces.
const descartadas = new Set();
const respondidas = new Map();

function marcar(anclas) {
    const marcados = [];
    for (const a of anclas) {
        document.querySelectorAll(`[data-saly-ancla="${CSS.escape(a)}"]`).forEach((el) => {
            el.setAttribute('data-saly-senalado', '');
            marcados.push(el);
        });
    }
    marcados[0]?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    return () => marcados.forEach((el) => el.removeAttribute('data-saly-senalado'));
}

export default function SalyBurbuja({ hayDialogo = false, oculta = false }) {
    const navigate = useNavigate();
    const pantalla = useSalyAyudaStore((s) => s.pantalla);
    const avisos = useSalyAyudaStore((s) => s.avisos);
    const enFormulario = useSalyAyudaStore((s) => s.enFormulario);

    const [abierto, setAbierto] = useState(false);
    const [contenido, setContenido] = useState(null);   // { animo, piezas, id?, util? }
    const [pregunta, setPregunta] = useState('');
    const [pensando, setPensando] = useState(false);
    const [, setVersion] = useState(0);                  // repinta al descartar
    const [quieto, setQuieto] = useState(null);
    const desmarcar = useRef(null);
    const raiz = useRef(null);
    const campo = useRef(null);

    const limpiarMarcas = useCallback(() => { desmarcar.current?.(); desmarcar.current = null; }, []);
    const cerrar = useCallback(() => { setAbierto(false); setContenido(null); limpiarMarcas(); }, [limpiarMarcas]);

    // Cambiar de pantalla cierra el globo: lo que decía era de la otra.
    useEffect(() => { cerrar(); }, [pantalla, cerrar]);
    useEffect(() => limpiarMarcas, [limpiarMarcas]);

    // ── Rato quieto en un formulario ────────────────────────────────────────
    useEffect(() => {
        setQuieto(null);
        if (!enFormulario) return undefined;
        let ultimo = Date.now();
        const mover = () => { ultimo = Date.now(); setQuieto(null); };
        const eventos = ['input', 'keydown', 'pointerdown'];
        eventos.forEach((e) => document.addEventListener(e, mover, true));
        const reloj = setInterval(() => {
            if (Date.now() - ultimo >= QUIETO_MS) setQuieto(avisoDeInactividad(enFormulario));
        }, 20_000);
        return () => { clearInterval(reloj); eventos.forEach((e) => document.removeEventListener(e, mover, true)); };
    }, [enFormulario]);

    const aviso = useMemo(
        () => [quieto, ...(avisos || [])].find((a) => a && !descartadas.has(a.clave)) || null,
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `descartadas` cambia con `setVersion`
        [quieto, avisos, abierto],
    );

    const descartar = useCallback((a) => { if (a) descartadas.add(a.clave); setVersion((v) => v + 1); }, []);

    const explicar = useCallback((a) => {
        limpiarMarcas();
        descartadas.add(a.clave);
        setContenido({ animo: a.animo, piezas: a.explicacion });
        setAbierto(true);
        if (a.ancla) desmarcar.current = marcar([a.ancla]);
    }, [limpiarMarcas]);

    const abrirOCerrar = useCallback(() => {
        if (abierto) { cerrar(); return; }
        if (aviso) { explicar(aviso); return; }
        setContenido(null);
        setAbierto(true);
    }, [abierto, aviso, cerrar, explicar]);

    const ir = useCallback((ruta) => { cerrar(); navigate(ruta); }, [cerrar, navigate]);

    const preguntar = useCallback(async (e) => {
        e?.preventDefault?.();
        const texto = pregunta.trim().slice(0, SALY_MAX_PREGUNTA);
        if (!texto || !pantalla || pensando) return;
        limpiarMarcas();

        let vista = '';
        try { vista = JSON.stringify(pantalla.leer()); } catch { vista = '{}'; }
        vista = taparDatosPersonales(vista).slice(0, SALY_MAX_PANTALLA);
        const decl = pantalla.filtros();
        const filtros = Object.fromEntries(Object.entries(decl).map(([k, f]) => [k, {
            rotulo: f.rotulo, valor: f.valor ?? '',
            opciones: (f.opciones || []).slice(0, 30).map((o) => ({ value: String(o.value), label: String(o.label) })),
        }]));

        const clave = claveDePregunta(pantalla.modulo, texto, vista);
        let data = respondidas.get(clave);
        if (!data) {
            setPensando(true);
            setAbierto(true);
            setContenido({ animo: 'pensando', piezas: [{ tipo: 'titular', texto: 'Déjame ver…', sub: 'Estoy leyendo lo que hay en pantalla' }] });
            const r = await preguntarAyudaDeSaly({ modulo: pantalla.modulo, pregunta: texto, pantalla: vista, filtros });
            setPensando(false);
            data = r.data;
            if (r.error || !data?.ok) {
                const tope = data?.motivo === 'TOPE';
                setContenido({ animo: 'preocupacion', piezas: [
                    { tipo: 'titular', texto: tope ? 'Por hoy ya no puedo responder más' : 'No pude responderte ahora',
                        sub: tope ? 'Llegaste a las 30 preguntas del día. Mañana sigo.' : 'Inténtalo de nuevo en un momento.' },
                ] });
                return;
            }
            respondidas.set(clave, data);
        }
        setPregunta('');

        // Los filtros que puso: sólo valores que la pantalla ofrece, y se
        // marcan con su color para que se sepa que fue ella.
        const puestos = [];
        for (const [k, v] of Object.entries(data.filtros || {})) {
            const f = decl[k];
            const op = f?.opciones?.find((o) => String(o.value) === String(v));
            if (!f?.poner || !op) continue;
            f.poner(op.value);
            puestos.push({ ancla: `filtro-${k}`, texto: `${f.rotulo}: ${op.label}` });
        }
        const piezas = validarPiezas(data.piezas);
        if (puestos.length) {
            piezas.splice(1, 0, { tipo: 'chips', items: puestos.map((p) => p.texto) });
            piezas.push({ tipo: 'nota', texto: 'Quita los filtros cuando quieras: no guardé nada.' });
        }
        setContenido({ animo: data.animo || 'atencion', piezas, id: data.id, quedan: data.quedan });
        if (puestos.length) setTimeout(() => { desmarcar.current = marcar(puestos.map((p) => p.ancla)); }, 60);
    }, [pregunta, pantalla, pensando, limpiarMarcas]);

    const calificar = useCallback(async (util) => {
        if (!contenido?.id) return;
        setContenido((c) => ({ ...c, util }));
        const { error } = await calificarAyudaDeSaly(contenido.id, util);
        if (error) console.error('Saly: no se pudo anotar la calificación', error);
    }, [contenido]);

    // Se cierra con Escape y con un toque FUERA (usuario, 2026-11-04: «si doy
    // click afuera no se cierra»). `pointerdown` y en captura, para que ningún
    // componente de la pantalla se lo trague antes con un `stopPropagation`.
    useEffect(() => {
        if (!abierto) return undefined;
        const tecla = (e) => { if (e.key === 'Escape') cerrar(); };
        const afuera = (e) => { if (raiz.current && !raiz.current.contains(e.target)) cerrar(); };
        window.addEventListener('keydown', tecla);
        document.addEventListener('pointerdown', afuera, true);
        return () => {
            window.removeEventListener('keydown', tecla);
            document.removeEventListener('pointerdown', afuera, true);
        };
    }, [abierto, cerrar]);

    // Al abrir sin aviso, el cursor ya está en la pregunta.
    useEffect(() => {
        if (abierto && !contenido) setTimeout(() => campo.current?.querySelector('input')?.focus(), 30);
    }, [abierto, contenido]);

    if (!pantalla || oculta) return null;
    // Con un diálogo encima sólo se asoma a ofrecer ayuda a quien está quieto.
    const sobreDialogo = hayDialogo;
    if (sobreDialogo && !(quieto && aviso === quieto) && !abierto) return null;

    const animo = pensando ? 'pensando' : (abierto ? (contenido?.animo || 'atencion') : (aviso?.animo || 'atencion'));
    const ofreciendo = !abierto && aviso;
    const etiqueta = ofreciendo ? `Saly: ${aviso.oferta?.[0]?.texto || 'tiene algo que contarte'}` : 'Saly: pedir ayuda sobre esta pantalla';

    // Vive en la MISMA columna que la burbuja del chat con clientes, encima de
    // ella: a su lado se encimaba con las flechas de subir/bajar de la lista.
    // Abierta sube a `z-dropdown` para quedar sobre esas flechas.
    const lado = sobreDialogo
        ? 'left-[max(16px,var(--sa-left))] z-toast flex-row-reverse'
        : `right-[max(16px,var(--sa-right))] ${abierto ? 'z-dropdown' : 'z-tabs'}`;

    return (
        <div data-burbuja-saly="" ref={raiz}
            className={`fixed ${lado} flex items-end gap-2 pointer-events-none
                bottom-[calc(var(--alto-nav-inferior,0px)+max(16px,var(--sa-bottom)))]
                [body:has([data-burbuja-chat])_&]:bottom-[calc(var(--alto-nav-inferior,0px)+max(16px,var(--sa-bottom))+4.5rem)]
                [body:has([data-barra-flotante])_&]:bottom-[calc(var(--alto-nav-inferior,0px)+max(16px,var(--sa-bottom))+5rem)]
                [body:has([data-barra-flotante]):has([data-burbuja-chat])_&]:bottom-[calc(var(--alto-nav-inferior,0px)+max(16px,var(--sa-bottom))+9.5rem)]`}>

            {(abierto || ofreciendo) && (
                <div data-surface="dropdown" role="region" aria-live="polite" aria-label="Ayuda de Saly"
                    className={`pointer-events-auto rounded-2xl ${sobreDialogo ? 'rounded-bl-md' : 'rounded-br-md'} overflow-hidden
                        ${abierto ? 'w-[min(22rem,calc(100vw-6.5rem))]' : 'w-[min(16rem,calc(100vw-6.5rem))]'}`}>
                    <div data-animo={animo} className="saly-toque px-4 pb-4 pt-3">
                        {abierto ? (
                            <>
                                <div className="-mr-2 mb-1 flex items-center justify-between">
                                    <span className="text-micro font-black uppercase tracking-widest text-content-3">Saly</span>
                                    <button type="button" onClick={cerrar} aria-label="Cerrar la ayuda de Saly"
                                        className="grid min-h-[var(--tap-min)] min-w-[var(--tap-min)] place-items-center rounded-full text-content-3 hover:text-content active:scale-[0.97]">
                                        <X size={16} aria-hidden="true" />
                                    </button>
                                </div>
                                <div>
                                    <div className="max-h-[min(26rem,60vh)] overflow-y-auto pr-1">
                                        <PiezasDeSaly onIr={ir} piezas={contenido?.piezas || [
                                            { tipo: 'titular', texto: '¿En qué te ayudo?', sub: pantalla.titulo },
                                            { tipo: 'nota', texto: 'Pregúntame sobre lo que ves en esta pantalla. Puedo explicarte, llevarte o poner filtros por ti.' },
                                        ]} />
                                    </div>
                                </div>

                                {contenido?.id && (
                                    <div className="mt-3 flex items-center gap-1 text-caption text-content-3">
                                        <span className="mr-1">¿Te sirvió?</span>
                                        {[[true, ThumbsUp, 'Sí me sirvió'], [false, ThumbsDown, 'No me sirvió']].map(([v, Icono, rot]) => (
                                            <button key={rot} type="button" onClick={() => calificar(v)} aria-label={rot} aria-pressed={contenido.util === v}
                                                className={`grid min-h-[var(--tap-min)] min-w-[var(--tap-min)] place-items-center rounded-lg active:scale-[0.97]
                                                    ${contenido.util === v ? 'text-content' : 'hover:text-content'}`}>
                                                <Icono size={15} aria-hidden="true" />
                                            </button>
                                        ))}
                                    </div>
                                )}

                                <form onSubmit={preguntar} className="mt-4 flex items-center gap-2 border-t border-divider pt-3">
                                    <div className="min-w-0 flex-1" ref={campo}>
                                        <PortalInput name="saly-pregunta" value={pregunta} onChange={(e) => setPregunta(e.target.value)}
                                            placeholder="Escribe tu duda…" readOnly={pensando} aria-label="Pregúntale a Saly"
                                            inputClassName="!text-body-sm !font-medium"
                                            maxLength={SALY_MAX_PREGUNTA} autoComplete="off" />
                                    </div>
                                    <Button type="submit" variant="primary" iconOnly icon={Send}
                                        aria-label="Enviar la pregunta" disabled={!pregunta.trim() || pensando} />
                                </form>
                            </>
                        ) : (
                            <>
                                <PiezasDeSaly piezas={aviso.oferta} onIr={ir} />
                                <div className="mt-3 flex gap-2">
                                    <button type="button" onClick={() => explicar(aviso)}
                                        className="min-h-[var(--tap-min)] rounded-lg bg-surface-card px-3 text-caption font-bold text-content ring-1 ring-inset ring-border-card active:scale-[0.97]">
                                        Explícamelo
                                    </button>
                                    <button type="button" onClick={() => descartar(aviso)}
                                        className="min-h-[var(--tap-min)] rounded-lg px-2 text-caption font-bold text-content-3 hover:text-content active:scale-[0.97]">
                                        Ahora no
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            <button type="button" onClick={abrirOCerrar} aria-label={etiqueta} title={etiqueta}
                aria-expanded={abierto}
                className="pointer-events-auto grid h-14 w-14 shrink-0 place-items-center rounded-full transition-transform duration-[var(--dur-fast)] hover:scale-[1.04] active:scale-[0.97]">
                <span className="drop-shadow-[0_6px_14px_color-mix(in_srgb,var(--saly-rasgo)_40%,transparent)]">
                    <SalyAvatar animo={animo} size={52} decorativa />
                </span>
            </button>
        </div>
    );
}
