import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Crosshair, ListChecks, MessagesSquare, Send, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import SalyAvatar from '../common/SalyAvatar';
import PiezasDeSaly from './PiezasDeSaly';
import PortalInput from '../common/PortalInput';
import Button from '../common/Button';
import { useSalyAyudaStore } from './salyAyudaStore';
import { calificarAyudaDeSaly, fetchPreguntasDeLaSemana, preguntarAyudaDeSaly } from '@nucleo/data/salyAyuda';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { buscarObjetivo } from './guiaEnPantalla';
import {
    PREGUNTAS_FRECUENTES, SALY_MAX_PANTALLA, SALY_MAX_PREGUNTA, avisoDeInactividad, claveDePregunta,
    crearMascaraDeNombres, destaparPiezas, montosInventados, preguntaFrecuente, taparDatosPersonales, validarPiezas,
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
 * Para preguntar por algo CONCRETO (usuario, 2026-11-04: «si arrastro a Saly o
 * algo para que me dé info?») hay dos caminos y los dos terminan igual:
 * ARRASTRAR a Saly encima de una fila, o tocar «Señalar» y después la fila. Lo
 * señalado se marca con su color y su texto visible viaja con la pregunta. No
 * pregunta solo: señalar no cuesta, preguntar sí.
 *
 * Los avisos no se gastan al leerlos: mientras sigan vigentes, quedan en la
 * lista «Lo que veo ahora» al abrir la burbuja. Antes, explicar uno lo daba
 * por visto y al volver a abrir ya no estaba.
 *
 * Nunca guarda, aprueba ni envía: puede poner filtros —quedan marcados con su
 * color— y llevar a otra pantalla. Lo demás lo hace la persona.
 */

const QUIETO_MS = 3 * 60_000;
const MOVER_PARA_ARRASTRAR = 8;
// Lo que se apartó con «Ahora no» o se contestó vive lo que la pestaña: así
// el mismo aviso no vuelve a asomarse solo, y la misma pregunta no se paga dos veces.
const apartados = new Set();
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

/** El bloque con sentido debajo de un punto: una ficha, una fila, una tarjeta. */
function bloqueEn(x, y, propio) {
    let el = document.elementFromPoint(x, y);
    if (!el || propio?.contains(el)) return null;
    const candidato = el.closest('[data-saly-ancla], [data-surface="card"], tr, li, article, [role="row"], section');
    el = candidato && candidato !== document.body ? candidato : el;
    // Un bloque que es casi la página entera no dice nada: se queda el de abajo.
    if (el.getBoundingClientRect().height > window.innerHeight * 0.8) el = document.elementFromPoint(x, y);
    if (!el || el === document.body || el === document.documentElement) return null;
    return el;
}

const textoDe = (el) => taparDatosPersonales(String(el?.innerText || '').replace(/\s+/g, ' ').trim()).slice(0, 600);

export default function SalyBurbuja({ hayDialogo = false, oculta = false }) {
    const navigate = useNavigate();
    const pantalla = useSalyAyudaStore((s) => s.pantalla);
    const avisos = useSalyAyudaStore((s) => s.avisos);
    const enFormulario = useSalyAyudaStore((s) => s.enFormulario);

    const [abierto, setAbierto] = useState(false);
    const [contenido, setContenido] = useState(null);   // { animo, piezas, id?, util? }
    const [pregunta, setPregunta] = useState('');
    const [pensando, setPensando] = useState(false);
    const [, setVersion] = useState(0);                  // repinta al apartar
    const [quieto, setQuieto] = useState(null);
    const [senalado, setSenalado] = useState(null);     // { texto }
    const [apuntando, setApuntando] = useState(false);  // modo «Señalar»
    const [arrastre, setArrastre] = useState(null);     // { x, y } mientras se arrastra
    const [guia, setGuia] = useState(null);             // { pasos, i, hallado }
    const [semana, setSemana] = useState(null);         // preguntas de la semana (Auditoría)
    const { hasPermission } = useAuth();
    const puedeVerPreguntas = hasPermission('auditview', 'can_view');
    const employees = useStaffStore((s) => s.employees);
    const desmarcar = useRef(null);
    const marcaSenalado = useRef(null);
    const raiz = useRef(null);
    const campo = useRef(null);
    const inicio = useRef(null);
    const huboArrastre = useRef(false);

    const limpiarMarcas = useCallback(() => { desmarcar.current?.(); desmarcar.current = null; }, []);
    const soltarSenalado = useCallback(() => {
        marcaSenalado.current?.removeAttribute('data-saly-senalado');
        marcaSenalado.current = null;
        setSenalado(null);
    }, []);
    const cerrar = useCallback(() => {
        setAbierto(false); setContenido(null); limpiarMarcas(); soltarSenalado(); setApuntando(false);
        setGuia(null); setSemana(null);
    }, [limpiarMarcas, soltarSenalado]);

    // Cambiar de MÓDULO cierra el globo. No de título: el título se completa
    // cuando llega el nombre de la sala, y eso no es cambiar de pantalla.
    const modulo = pantalla?.modulo;
    useEffect(() => { cerrar(); }, [modulo, cerrar]);
    useEffect(() => () => { limpiarMarcas(); marcaSenalado.current?.removeAttribute('data-saly-senalado'); }, [limpiarMarcas]);

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

    const vigentes = useMemo(() => [quieto, ...(avisos || [])].filter(Boolean), [quieto, avisos]);
    // El que se asoma solo: el primero que nadie apartó.
    const aviso = useMemo(
        () => vigentes.find((a) => !apartados.has(a.clave)) || null,
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `apartados` cambia con `setVersion`
        [vigentes, abierto],
    );

    const apartar = useCallback((a) => { if (a) apartados.add(a.clave); setVersion((v) => v + 1); }, []);

    const explicar = useCallback((a) => {
        limpiarMarcas();
        apartados.add(a.clave);   // ya no se asoma solo; sigue en la lista
        setContenido({ animo: a.animo, piezas: a.explicacion, volver: true });
        setAbierto(true);
        if (a.anclas?.length || a.ancla) desmarcar.current = marcar(a.anclas?.length ? a.anclas : [a.ancla]);
    }, [limpiarMarcas]);

    const abrirInicio = useCallback(() => { limpiarMarcas(); setContenido(null); setAbierto(true); }, [limpiarMarcas]);

    const abrirOCerrar = useCallback(() => {
        if (huboArrastre.current) { huboArrastre.current = false; return; }
        if (abierto) { cerrar(); return; }
        if (aviso) { explicar(aviso); return; }
        abrirInicio();
    }, [abierto, aviso, cerrar, explicar, abrirInicio]);

    const ir = useCallback((ruta) => { cerrar(); navigate(ruta); }, [cerrar, navigate]);

    // ── Señalar: tomar un bloque de la pantalla ─────────────────────────────
    const tomar = useCallback((el) => {
        soltarSenalado();
        limpiarMarcas();
        const texto = textoDe(el);
        if (!texto) return;
        el.setAttribute('data-saly-senalado', '');
        marcaSenalado.current = el;
        setSenalado({ texto });
        setContenido(null);
        setAbierto(true);
        setTimeout(() => campo.current?.querySelector('input')?.focus(), 30);
    }, [soltarSenalado, limpiarMarcas]);

    // Resaltado mientras se pasa por encima (en modo Señalar o arrastrando).
    const sobre = useRef(null);
    const resaltar = useCallback((el) => {
        if (sobre.current === el) return;
        if (sobre.current && sobre.current !== marcaSenalado.current) sobre.current.removeAttribute('data-saly-senalado');
        sobre.current = el;
        el?.setAttribute('data-saly-senalado', '');
    }, []);
    const quitarResaltado = useCallback(() => resaltar(null), [resaltar]);

    useEffect(() => {
        if (!apuntando) return undefined;
        const mover = (e) => resaltar(bloqueEn(e.clientX, e.clientY, raiz.current));
        const tocar = (e) => {
            if (raiz.current?.contains(e.target)) return;
            e.preventDefault(); e.stopPropagation();
            const el = bloqueEn(e.clientX, e.clientY, raiz.current);
            quitarResaltado();
            setApuntando(false);
            // El `click` de este mismo toque llega DESPUÉS de que el modo se
            // apaga: sin esto la fila señalada se abriría igual.
            const unaVez = (ev) => { ev.preventDefault(); ev.stopPropagation(); document.removeEventListener('click', unaVez, true); };
            document.addEventListener('click', unaVez, true);
            setTimeout(() => document.removeEventListener('click', unaVez, true), 600);
            if (el) tomar(el); else setAbierto(true);
        };
        const tecla = (e) => { if (e.key === 'Escape') { quitarResaltado(); setApuntando(false); setAbierto(true); } };
        // El clic se traga en captura: tocar una fila para señalarla no la abre.
        const tragar = (e) => { if (!raiz.current?.contains(e.target)) { e.preventDefault(); e.stopPropagation(); } };
        document.addEventListener('pointermove', mover, true);
        document.addEventListener('pointerdown', tocar, true);
        document.addEventListener('click', tragar, true);
        window.addEventListener('keydown', tecla);
        document.body.style.cursor = 'crosshair';
        return () => {
            document.removeEventListener('pointermove', mover, true);
            document.removeEventListener('pointerdown', tocar, true);
            document.removeEventListener('click', tragar, true);
            window.removeEventListener('keydown', tecla);
            document.body.style.cursor = '';
            quitarResaltado();
        };
    }, [apuntando, resaltar, quitarResaltado, tomar]);

    // Arrastrar a Saly encima de algo.
    const alApretar = useCallback((e) => {
        if (e.button != null && e.button !== 0) return;
        inicio.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        huboArrastre.current = false;
    }, []);
    useEffect(() => {
        const mover = (e) => {
            const i = inicio.current;
            if (!i || e.pointerId !== i.id) return;
            if (!huboArrastre.current && Math.hypot(e.clientX - i.x, e.clientY - i.y) < MOVER_PARA_ARRASTRAR) return;
            huboArrastre.current = true;
            e.preventDefault();
            setArrastre({ x: e.clientX, y: e.clientY });
            resaltar(bloqueEn(e.clientX, e.clientY, raiz.current));
        };
        const soltar = (e) => {
            const i = inicio.current;
            inicio.current = null;
            if (!i || !huboArrastre.current) return;
            setArrastre(null);
            const el = bloqueEn(e.clientX, e.clientY, raiz.current);
            quitarResaltado();
            if (el) tomar(el);
            // El `click` que sigue al soltar no tiene que abrir/cerrar la burbuja.
            setTimeout(() => { huboArrastre.current = false; }, 0);
        };
        window.addEventListener('pointermove', mover, { passive: false });
        window.addEventListener('pointerup', soltar);
        window.addEventListener('pointercancel', soltar);
        return () => {
            window.removeEventListener('pointermove', mover);
            window.removeEventListener('pointerup', soltar);
            window.removeEventListener('pointercancel', soltar);
        };
    }, [resaltar, quitarResaltado, tomar]);

    // ── Guía en pantalla: marca el botón real de cada paso ──────────────────
    // Se busca cada medio segundo porque el objetivo del paso siguiente suele
    // estar en un diálogo que todavía no se abrió. Avanza sola cuando la
    // persona toca el objetivo de ese paso —o de uno posterior: si se adelantó,
    // la guía la alcanza— y, en un campo, cuando deja de escribir.
    const guiar = useCallback((pasos) => {
        limpiarMarcas(); soltarSenalado();
        setContenido(null);
        setGuia({ pasos, i: 0, hallado: false });
        setAbierto(true);
    }, [limpiarMarcas, soltarSenalado]);

    useEffect(() => {
        if (!guia) return undefined;
        const paso = guia.pasos[guia.i];
        if (!paso) return undefined;
        let marcado = null;
        let desplazado = false;
        const buscar = () => {
            const el = buscarObjetivo(paso, raiz.current);
            if (el === marcado) return;
            marcado?.removeAttribute('data-saly-senalado');
            marcado = el;
            if (el) {
                el.setAttribute('data-saly-senalado', '');
                if (!desplazado) { el.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); desplazado = true; }
            }
            setGuia((g) => (g && g.i === guia.i && g.hallado !== !!el ? { ...g, hallado: !!el } : g));
        };
        buscar();
        const reloj = setInterval(buscar, 500);
        const avanzar = (a) => setGuia((g) => (g ? { ...g, i: a, hallado: false } : g));
        const tocar = (e) => {
            if (raiz.current?.contains(e.target)) return;
            for (let k = guia.i; k < guia.pasos.length; k++) {
                const el = k === guia.i ? marcado : buscarObjetivo(guia.pasos[k], raiz.current);
                if (el && el.contains(e.target) && !guia.pasos[k].campo) { setTimeout(() => avanzar(k + 1), 350); return; }
            }
        };
        let escribiendo = null;
        const escribir = (e) => {
            if (!paso.campo || !marcado?.contains(e.target)) return;
            clearTimeout(escribiendo);
            escribiendo = setTimeout(() => avanzar(guia.i + 1), 1500);
        };
        document.addEventListener('click', tocar, true);
        document.addEventListener('input', escribir, true);
        return () => {
            clearInterval(reloj); clearTimeout(escribiendo);
            document.removeEventListener('click', tocar, true);
            document.removeEventListener('input', escribir, true);
            marcado?.removeAttribute('data-saly-senalado');
        };
    }, [guia?.i, guia?.pasos]); // eslint-disable-line react-hooks/exhaustive-deps -- `hallado` lo escribe este mismo efecto

    const verSemana = useCallback(async () => {
        setContenido(null);
        setSemana({ cargando: true });
        const { data, error } = await fetchPreguntasDeLaSemana();
        if (error) { setSemana({ error: true }); return; }
        // Las que no sirvieron primero; después las que se repiten.
        const cuenta = new Map();
        for (const f of data) {
            const k = `${f.modulo}|${String(f.pregunta).toLowerCase().trim()}`;
            const c = cuenta.get(k) || { pregunta: f.pregunta, modulo: f.modulo, veces: 0, malas: 0 };
            c.veces += 1; if (f.util === false) c.malas += 1;
            cuenta.set(k, c);
        }
        const lista = [...cuenta.values()].sort((a, b) => (b.malas - a.malas) || (b.veces - a.veces));
        setSemana({ total: data.length, lista: lista.slice(0, 12) });
    }, []);

    const preguntar = useCallback(async (e, textoFijo) => {
        e?.preventDefault?.();
        const texto = (textoFijo || pregunta).trim().slice(0, SALY_MAX_PREGUNTA);
        if (!texto || !pantalla || pensando) return;
        limpiarMarcas();

        // Lo de siempre se contesta acá, sin IA. Con algo señalado no: la
        // pregunta es sobre ESO y la respuesta escrita sería genérica.
        const frecuente = !senalado && preguntaFrecuente(pantalla.modulo, texto);
        if (frecuente) {
            setPregunta('');
            setAbierto(true);
            setContenido({ animo: 'alegria', piezas: frecuente.piezas, guia: frecuente.guia, volver: true });
            return;
        }

        let crudo = '';
        try { crudo = JSON.stringify(pantalla.leer()); } catch { crudo = '{}'; }
        // Los nombres de las personas del portal salen como «Persona N» y se
        // devuelven al mostrar la respuesta: la IA no necesita saber quién es.
        const mascara = crearMascaraDeNombres((employees || []).map((x) => x.name));
        const vista = mascara.tapar(taparDatosPersonales(crudo)).slice(0, SALY_MAX_PANTALLA);
        const decl = pantalla.filtros();
        const filtros = Object.fromEntries(Object.entries(decl).map(([k, f]) => [k, {
            rotulo: f.rotulo, valor: f.valor ?? '',
            opciones: (f.opciones || []).slice(0, 30).map((o) => ({ value: String(o.value), label: String(o.label) })),
        }]));
        const lo = mascara.tapar(senalado?.texto || '');

        const clave = claveDePregunta(pantalla.modulo, texto, `${vista}|${lo}`);
        let data = respondidas.get(clave);
        if (!data) {
            setPensando(true);
            setAbierto(true);
            setContenido({ animo: 'pensando', piezas: [{ tipo: 'titular', texto: 'Déjame ver…', sub: lo ? 'Estoy leyendo lo que señalaste' : 'Estoy leyendo lo que hay en pantalla' }] });
            const r = await preguntarAyudaDeSaly({ modulo: pantalla.modulo, pregunta: mascara.tapar(texto), pantalla: vista, filtros, senalado: lo || undefined });
            setPensando(false);
            data = r.data;
            if (r.error || !data?.ok) {
                const tope = data?.motivo === 'TOPE';
                setContenido({ animo: 'preocupacion', volver: true, piezas: [
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
        let piezas = destaparPiezas(validarPiezas(data.piezas), mascara.destapar);
        // Un monto que no sale de la pantalla no se muestra: es el error que
        // más daño hace, porque se lee como un dato. Se quita la pieza que lo
        // trae; si se cae la respuesta misma, se dice en vez de adivinar.
        const fuentes = [crudo, senalado?.texto, texto];
        const limpias = piezas.filter((p) => !montosInventados([p], fuentes).length);
        if (limpias.length !== piezas.length) {
            console.warn('Saly: quité una pieza con un monto que no está en pantalla', montosInventados(piezas, fuentes));
            piezas = limpias[0]?.tipo === 'titular' ? limpias : [
                { tipo: 'titular', texto: 'Prefiero no darte un número que no veo', sub: 'Señala la fila o el corte y te lo explico con sus montos' },
                ...limpias.filter((p) => p.tipo !== 'titular'),
            ];
        }
        if (puestos.length) {
            piezas.splice(1, 0, { tipo: 'chips', items: puestos.map((p) => p.texto) });
            piezas.push({ tipo: 'nota', texto: 'Quita los filtros cuando quieras: no guardé nada.' });
        }
        setContenido({ animo: data.animo || 'atencion', piezas, id: data.id, quedan: data.quedan, volver: true });
        if (puestos.length) setTimeout(() => { desmarcar.current = marcar(puestos.map((p) => p.ancla)); }, 60);
    }, [pregunta, pantalla, pensando, limpiarMarcas, senalado, employees]);

    const calificar = useCallback(async (util) => {
        if (!contenido?.id) return;
        setContenido((c) => ({ ...c, util }));
        const { error } = await calificarAyudaDeSaly(contenido.id, util);
        if (error) console.error('Saly: no se pudo anotar la calificación', error);
    }, [contenido]);

    // Se cierra con Escape y con un toque FUERA. `pointerdown` y en captura,
    // para que ningún componente de la pantalla se lo trague antes.
    useEffect(() => {
        if (!abierto || apuntando || guia) return undefined;
        const tecla = (e) => { if (e.key === 'Escape') cerrar(); };
        const afuera = (e) => { if (raiz.current && !raiz.current.contains(e.target)) cerrar(); };
        window.addEventListener('keydown', tecla);
        document.addEventListener('pointerdown', afuera, true);
        return () => {
            window.removeEventListener('keydown', tecla);
            document.removeEventListener('pointerdown', afuera, true);
        };
    }, [abierto, apuntando, cerrar, guia]);

    useEffect(() => {
        if (abierto && !contenido) setTimeout(() => campo.current?.querySelector('input')?.focus(), 30);
    }, [abierto, contenido]);

    if (!pantalla || oculta) return null;
    // Con un diálogo encima sólo se asoma a ofrecer ayuda a quien está quieto.
    const sobreDialogo = hayDialogo;
    if (sobreDialogo && !(quieto && aviso === quieto) && !abierto) return null;

    const animo = pensando ? 'pensando' : (abierto ? (contenido?.animo || (senalado ? 'pensando' : 'atencion')) : (aviso?.animo || 'atencion'));
    const ofreciendo = !abierto && !apuntando && !arrastre && aviso;
    const etiqueta = ofreciendo ? `Saly: ${aviso.oferta?.[0]?.texto || 'tiene algo que contarte'}` : 'Saly: pedir ayuda sobre esta pantalla. Arrástrala sobre algo para preguntar por eso.';

    const lado = sobreDialogo
        ? 'left-[max(16px,var(--sa-left))] z-toast flex-row-reverse'
        : `right-[max(16px,var(--sa-right))] ${abierto || apuntando ? 'z-dropdown' : 'z-tabs'}`;

    const inicioPiezas = senalado
        ? [{ tipo: 'titular', texto: '¿Qué quieres saber de esto?', sub: 'Lo marqué en la pantalla' }]
        : [{ tipo: 'titular', texto: '¿En qué te ayudo?', sub: pantalla.titulo }];

    return (
        <>
            {apuntando && (
                <div className="pointer-events-none fixed inset-x-0 top-[max(12px,var(--sa-top))] z-toast flex justify-center px-4">
                    <div data-surface="dropdown" className="saly-toque rounded-full px-4 py-2 text-caption font-bold text-content">
                        Toca lo que quieres que te explique · Esc para salir
                    </div>
                </div>
            )}
            {arrastre && (
                <div aria-hidden="true" className="pointer-events-none fixed z-toast" style={{ left: arrastre.x - 26, top: arrastre.y - 26 }}>
                    <SalyAvatar animo="pensando" size={52} decorativa />
                </div>
            )}

            <div data-burbuja-saly="" ref={raiz}
                className={`fixed ${lado} flex items-end gap-2 pointer-events-none
                    bottom-[calc(var(--alto-nav-inferior,0px)+max(16px,var(--sa-bottom)))]
                    [body:has([data-burbuja-chat])_&]:bottom-[calc(var(--alto-nav-inferior,0px)+max(16px,var(--sa-bottom))+4.5rem)]
                    [body:has([data-barra-flotante])_&]:bottom-[calc(var(--alto-nav-inferior,0px)+max(16px,var(--sa-bottom))+5rem)]
                    [body:has([data-barra-flotante]):has([data-burbuja-chat])_&]:bottom-[calc(var(--alto-nav-inferior,0px)+max(16px,var(--sa-bottom))+9.5rem)]`}>

                {((abierto && !apuntando) || ofreciendo) && (
                    <div data-surface="dropdown" role="region" aria-live="polite" aria-label="Ayuda de Saly"
                        className={`pointer-events-auto rounded-2xl ${sobreDialogo ? 'rounded-bl-md' : 'rounded-br-md'} overflow-hidden
                            ${abierto ? 'w-[min(22rem,calc(100vw-6.5rem))]' : 'w-[min(16rem,calc(100vw-6.5rem))]'}`}>
                        <div data-animo={animo} className="saly-toque rounded-[inherit] px-4 pb-4 pt-3">
                            {abierto ? (
                                <>
                                    <div className="-mr-2 mb-1 flex items-center justify-between">
                                        {(contenido?.volver || semana) && !guia ? (
                                            <button type="button" onClick={() => { setSemana(null); abrirInicio(); }}
                                                className="-ml-1 min-h-[var(--tap-min)] rounded-lg px-1 text-micro font-black uppercase tracking-widest text-content-3 hover:text-content active:scale-[0.97]">
                                                ‹ Saly
                                            </button>
                                        ) : (
                                            <span className="text-micro font-black uppercase tracking-widest text-content-3">Saly</span>
                                        )}
                                        <button type="button" onClick={cerrar} aria-label="Cerrar la ayuda de Saly"
                                            className="grid min-h-[var(--tap-min)] min-w-[var(--tap-min)] place-items-center rounded-full text-content-3 hover:text-content active:scale-[0.97]">
                                            <X size={16} aria-hidden="true" />
                                        </button>
                                    </div>

                                    {guia ? (
                                        <div className="grid gap-3">
                                            {guia.i < guia.pasos.length ? (
                                                <>
                                                    <p className="text-micro font-black uppercase tracking-widest text-content-3">
                                                        Paso {guia.i + 1} de {guia.pasos.length}
                                                    </p>
                                                    <PiezasDeSaly piezas={[{ tipo: 'pasos', desde: guia.i, items: [guia.pasos[guia.i].texto] }]} />
                                                    {(guia.pasos[guia.i].boton || guia.pasos[guia.i].campo) && !guia.hallado && (
                                                        <p className="text-caption text-content-3">Todavía no lo veo en pantalla: te lo marco en cuanto aparezca.</p>
                                                    )}
                                                    <div className="flex gap-2">
                                                        <Button variant="secondary" size="sm" onClick={() => setGuia((g) => ({ ...g, i: g.i + 1, hallado: false }))}>
                                                            {guia.i + 1 < guia.pasos.length ? 'Siguiente' : 'Listo'}
                                                        </Button>
                                                        <Button variant="ghost" size="sm" onClick={cerrar}>Terminar</Button>
                                                    </div>
                                                </>
                                            ) : (
                                                <>
                                                    <PiezasDeSaly piezas={[{ tipo: 'titular', texto: '¡Listo!', sub: 'Así se hace. Cuando quieras, te guío otra vez.' }]} />
                                                    <Button variant="secondary" size="sm" onClick={cerrar}>Cerrar</Button>
                                                </>
                                            )}
                                        </div>
                                    ) : (
                                    <div className="max-h-[min(26rem,60vh)] overflow-y-auto pr-1">
                                        {semana ? (
                                            semana.cargando ? <PiezasDeSaly piezas={[{ tipo: 'titular', texto: 'Déjame ver…', sub: 'Leyendo lo que se preguntó' }]} />
                                            : semana.error ? <PiezasDeSaly piezas={[{ tipo: 'titular', texto: 'No pude leer las preguntas', sub: 'Inténtalo de nuevo en un momento.' }]} />
                                            : (
                                                <div className="grid gap-2">
                                                    <PiezasDeSaly piezas={[{ tipo: 'titular', texto: `${semana.total} preguntas esta semana`, sub: 'Primero las que no sirvieron, después las que más se repiten' }]} />
                                                    {semana.lista.map((f) => (
                                                        <div key={`${f.modulo}-${f.pregunta}`} className="flex items-start gap-2 text-body-sm">
                                                            <span className="min-w-0 flex-1 text-content-2">{f.pregunta}</span>
                                                            <span className="shrink-0 text-caption tabular-nums text-content-3">
                                                                {f.veces > 1 ? `×${f.veces}` : ''}{f.malas ? ` · 👎${f.malas}` : ''}
                                                            </span>
                                                        </div>
                                                    ))}
                                                    <p className="text-caption text-content-3">Lo que se repite conviene pasarlo a pregunta rápida: así se contesta sin IA.</p>
                                                </div>
                                            )
                                        ) : (
                                        <PiezasDeSaly onIr={ir} piezas={contenido?.piezas || inicioPiezas} />
                                        )}

                                        {contenido?.guia?.length > 0 && (
                                            <Button className="mt-3" variant="primary" size="sm" icon={ListChecks} onClick={() => guiar(contenido.guia)}>
                                                Guíame en la pantalla
                                            </Button>
                                        )}

                                        {!contenido && senalado && (
                                            <div className="mt-3">
                                                <p className="line-clamp-3 rounded-xl px-3 py-2 text-caption text-content-2" data-saly-senalado="">{senalado.texto}</p>
                                                <div className="mt-2 flex flex-wrap gap-1.5">
                                                    {['Explícame esto', '¿Está bien esto?', '¿Qué hago con esto?'].map((t) => (
                                                        <Button key={t} variant="secondary" size="sm" onClick={() => preguntar(null, t)} disabled={pensando}>{t}</Button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {!contenido && !senalado && !semana && (
                                            <div className="mt-3 grid gap-3">
                                                {vigentes.length > 0 && (
                                                    <div>
                                                        <p className="mb-1 text-micro font-black uppercase tracking-widest text-content-3">Lo que veo ahora</p>
                                                        <div className="grid gap-1">
                                                            {vigentes.map((a) => (
                                                                <button key={a.clave} type="button" onClick={() => explicar(a)}
                                                                    className="flex min-h-[var(--tap-min)] items-center gap-2 rounded-xl px-2 text-left hover:bg-surface-card-hover active:scale-[0.99]">
                                                                    <span className="min-w-0 flex-1">
                                                                        <span className="block truncate text-body-sm font-bold text-content">{a.oferta?.[0]?.texto}</span>
                                                                        {a.oferta?.[0]?.sub && <span className="block truncate text-caption text-content-3">{a.oferta[0].sub}</span>}
                                                                    </span>
                                                                    <ChevronRight size={16} className="shrink-0 text-content-3" aria-hidden="true" />
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                {(PREGUNTAS_FRECUENTES[pantalla.modulo] || []).length > 0 && (
                                                    <div>
                                                        <p className="mb-1.5 text-micro font-black uppercase tracking-widest text-content-3">Preguntas rápidas</p>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {PREGUNTAS_FRECUENTES[pantalla.modulo].slice(0, 5).map((f) => (
                                                                <Button key={f.id} variant="secondary" size="sm"
                                                                    onClick={() => setContenido({ animo: 'alegria', piezas: f.piezas, guia: f.guia, volver: true })}>
                                                                    {f.pregunta}
                                                                </Button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                <button type="button" onClick={() => setApuntando(true)}
                                                    className="flex min-h-[var(--tap-min)] items-center gap-2 rounded-xl px-2 text-left hover:bg-surface-card-hover active:scale-[0.99]">
                                                    <Crosshair size={16} className="shrink-0 text-content-2" aria-hidden="true" />
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block text-body-sm font-bold text-content">Señalar algo de la pantalla</span>
                                                        <span className="block text-caption text-content-3">O arrástrame encima de una fila</span>
                                                    </span>
                                                </button>
                                                {puedeVerPreguntas && (
                                                    <button type="button" onClick={verSemana}
                                                        className="flex min-h-[var(--tap-min)] items-center gap-2 rounded-xl px-2 text-left hover:bg-surface-card-hover active:scale-[0.99]">
                                                        <MessagesSquare size={16} className="shrink-0 text-content-2" aria-hidden="true" />
                                                        <span className="min-w-0 flex-1">
                                                            <span className="block text-body-sm font-bold text-content">Lo que me preguntan</span>
                                                            <span className="block text-caption text-content-3">Las de esta semana, para mejorarme</span>
                                                        </span>
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    )}

                                    {!guia && contenido?.id && (
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

                                    {!guia && <form onSubmit={preguntar} className="mt-4 flex items-center gap-2 border-t border-divider pt-3">
                                        <div className="min-w-0 flex-1" ref={campo}>
                                            <PortalInput name="saly-pregunta" value={pregunta} onChange={(e) => setPregunta(e.target.value)}
                                                placeholder={senalado ? 'O escribe tu pregunta…' : 'Escribe tu duda…'} readOnly={pensando} aria-label="Pregúntale a Saly"
                                                inputClassName="!text-body-sm !font-medium"
                                                maxLength={SALY_MAX_PREGUNTA} autoComplete="off" />
                                        </div>
                                        <Button type="submit" variant="primary" iconOnly icon={Send}
                                            aria-label="Enviar la pregunta" disabled={!pregunta.trim() || pensando} />
                                    </form>}
                                </>
                            ) : (
                                <>
                                    <PiezasDeSaly piezas={aviso.oferta} onIr={ir} />
                                    <div className="mt-3 flex gap-2">
                                        <Button variant="secondary" size="sm" onClick={() => explicar(aviso)}>Explícamelo</Button>
                                        <Button variant="ghost" size="sm" onClick={() => apartar(aviso)}>Ahora no</Button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}

                <button type="button" onClick={abrirOCerrar} onPointerDown={alApretar} aria-label={etiqueta} title={etiqueta}
                    aria-expanded={abierto}
                    className={`pointer-events-auto grid h-14 w-14 shrink-0 touch-none select-none place-items-center rounded-full transition-transform duration-[var(--dur-fast)] hover:scale-[1.04] active:scale-[0.97] cursor-grab
                        ${arrastre ? 'opacity-30' : ''}`}>
                    <span className="drop-shadow-[0_6px_14px_color-mix(in_srgb,var(--saly-rasgo)_40%,transparent)]">
                        <SalyAvatar animo={animo} size={52} decorativa />
                    </span>
                </button>
            </div>
        </>
    );
}
