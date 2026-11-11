import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Check, CheckCircle2, Gift, AlertTriangle } from 'lucide-react';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import Checkbox from '../../components/common/Checkbox';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import {
    CARITAS, ACUERDO, recorrido, primeraSinContestar, motivoParaNoGuardarContacto, opcionesConTexto, MAX_TEXTO, MAX_NUMERO,
    maximoDe, alternarOpcion, textoDeMaximo, exclusivasDe, TRAMOS_NPS, tramoNps, guionDeEscala, escalaNumerica,
} from '@nucleo/utils/encuestasClientes';
import { nuevaReferencia } from '@nucleo/data/encuestasClientes';
import useMediaQuery from '../../plataforma/useMediaQuery';
import { CORTE_TELEFONO } from '../../components/common/usarExpediente';

/**
 * El cuestionario tal como lo contesta el cliente: una sección por pantalla,
 * las preguntas condicionadas aparecen o desaparecen según lo contestado y, al
 * final, el paso opcional de dejar su teléfono con consentimiento.
 *
 * Es el MISMO componente en la vista previa del constructor, el QR, la tablet
 * y la entrevista: lo que el revisor aprueba mirando la vista previa es lo que
 * el cliente recorre. Por eso no sabe guardar: `onEnviar(respuestas, contacto,
 * segundos)` lo hace quien lo monta, y si lanza, el error se muestra acá y
 * nada se pierde. Sin `onEnviar` (vista previa) sólo muestra el cierre.
 *
 * `reinicioAuto` (segundos): la tablet de sala vuelve sola al principio para
 * el cliente siguiente. `entrevista`: los textos le hablan a quien pregunta.
 * `onReiniciar`: avisa que empieza otra respuesta (la tablet vuelve a mirar
 * si la encuesta sigue abierta).
 *
 * `onEnviar(respuestas, contacto, segundos, referencia)`: la referencia es la
 * misma en cada reintento de ESTA respuesta, para que la base no la guarde
 * dos veces si la red se cortó después de que entró.
 */
export default function FormularioEncuesta({
    encuesta, onEnviar, onEntregarMuestra, onReiniciar, reinicioAuto = null, entrevista = false,
}) {
    const secciones = useMemo(() => (encuesta?.cuestionario?.secciones || [])
        .filter((s) => (s.preguntas || []).length > 0), [encuesta?.cuestionario]);
    const conBienvenida = !!encuesta?.mensaje_bienvenida && !entrevista;
    const [paso, setPaso] = useState(conBienvenida ? -1 : 0);
    const [respuestas, setRespuestas] = useState({});
    const [faltante, setFaltante] = useState(null);
    const [enContacto, setEnContacto] = useState(false);
    const [contacto, setContacto] = useState({ consiente: false, telefono: '', nombre: '' });
    const [errorContacto, setErrorContacto] = useState(null);
    const [enviando, setEnviando] = useState(false);
    const [errorEnvio, setErrorEnvio] = useState(null);
    const [terminado, setTerminado] = useState(false);
    // La duración cuenta desde la primera respuesta, no desde que la tablet
    // quedó esperando al cliente siguiente.
    const inicio = useRef(null);
    const referencia = useRef(nuevaReferencia());
    const [cuenta, setCuenta] = useState(null);
    const [resultado, setResultado] = useState(null);
    const [entregando, setEntregando] = useState(false);

    const { visibles, limpias } = useMemo(() => recorrido(encuesta?.cuestionario, respuestas), [encuesta?.cuestionario, respuestas]);
    // Las secciones que quedaron sin ninguna pregunta visible se saltan.
    const visiblesDe = (s) => visibles.filter((p) => p.seccionId === s.id);
    // En el teléfono, UNA pregunta por pantalla (pedido del usuario
    // 2026-11-07): botones grandes, sin bajar, y el aviso de «falta» a la
    // vista. En pantalla ancha, una SECCIÓN por pantalla. El orden y las
    // condiciones son los mismos: sólo cambia cuántas se ven a la vez.
    const enTelefono = useMediaQuery(CORTE_TELEFONO);
    const pasos = secciones.flatMap((s) => {
        const ps = visiblesDe(s);
        if (!ps.length) return [];
        return enTelefono ? ps.map((p) => ({ seccion: s, preguntas: [p] })) : [{ seccion: s, preguntas: ps }];
    });
    // Al girar el teléfono o cambiar el ancho, el número de pasos cambia: nunca
    // apuntar más allá del último.
    const pasoReal = paso >= 0 ? Math.min(paso, pasos.length - 1) : -1;
    const actual = pasoReal >= 0 ? pasos[pasoReal] || null : null;
    const total = pasos.length + 1;
    const progreso = terminado ? 100 : Math.round((Math.max(enContacto ? pasos.length : pasoReal, 0) / total) * 100);
    const incentivo = encuesta?.incentivo_tipo === 'puntos' && encuesta?.incentivo_puntos
        ? `Deja tu teléfono y recibe ${encuesta.incentivo_puntos} puntos en tu cuenta.`
        : encuesta?.incentivo_tipo === 'muestra' && entrevista
            ? `Si deja su teléfono, entrégale: ${encuesta.incentivo_descripcion || 'la muestra médica'}.`
            : null;

    const reiniciar = () => {
        setRespuestas({});
        setFaltante(null);
        setEnContacto(false);
        setContacto({ consiente: false, telefono: '', nombre: '' });
        setErrorContacto(null);
        setErrorEnvio(null);
        setTerminado(false);
        setCuenta(null);
        setResultado(null);
        inicio.current = null;
        referencia.current = nuevaReferencia();
        setPaso(conBienvenida ? -1 : 0);
        onReiniciar?.();
    };

    // La tablet vuelve sola al principio: el cliente siguiente no tiene que
    // tocar nada para empezar.
    useEffect(() => {
        if (!terminado || !reinicioAuto) return undefined;
        setCuenta(reinicioAuto); // eslint-disable-line react-hooks/set-state-in-effect -- arranca la cuenta al terminar
        const t = setInterval(() => setCuenta((c) => (c > 1 ? c - 1 : 0)), 1000);
        return () => clearInterval(t);
    }, [terminado, reinicioAuto]);
    useEffect(() => {
        if (cuenta === 0) reiniciar(); // eslint-disable-line react-hooks/set-state-in-effect -- el reinicio de la tablet al terminar la cuenta
    }, [cuenta]); // eslint-disable-line react-hooks/exhaustive-deps -- `reiniciar` sólo reinicia estado

    const contestar = (id, valor) => {
        if (inicio.current == null) inicio.current = Date.now();
        setRespuestas((r) => ({ ...r, [id]: valor }));
        if (faltante === id) setFaltante(null);
    };

    const siguiente = () => {
        if (actual) {
            // Un «ordenar» que no se tocó se muestra con un orden completo: ese
            // orden ES la respuesta. Sin esto contaba como no contestado.
            const porDefecto = {};
            for (const p of actual.preguntas) {
                if (p.tipo !== 'ranking') continue;
                const ops = opcionesConTexto(p);
                const r = respuestas[p.id];
                if (!(Array.isArray(r) && r.length === ops.length)) porDefecto[p.id] = ops.map((o) => o.id);
            }
            const conOrden = Object.keys(porDefecto).length ? { ...respuestas, ...porDefecto } : respuestas;
            if (conOrden !== respuestas) {
                if (inicio.current == null) inicio.current = Date.now();
                setRespuestas(conOrden);
            }
            const falta = primeraSinContestar(actual.preguntas, conOrden);
            if (falta) { setFaltante(falta.id); return; }
        }
        setFaltante(null);
        if (pasoReal + 1 >= pasos.length) { setEnContacto(true); return; }
        setPaso(pasoReal + 1);
    };

    const enviar = async (conDatos) => {
        const c = conDatos ? contacto : { consiente: false };
        if (conDatos) {
            // La regla del contacto: `motivoParaNoGuardarContacto` (núcleo, la misma de la app).
            const motivo = motivoParaNoGuardarContacto(c);
            if (motivo) { setErrorContacto(motivo); return; }
        }
        setErrorContacto(null);
        setErrorEnvio(null);
        if (!onEnviar) { setTerminado(true); return; }
        setEnviando(true);
        try {
            const r = await onEnviar(limpias, conDatos ? { consiente: true, telefono: c.telefono.trim(), nombre: c.nombre.trim() } : null,
                Math.round((Date.now() - (inicio.current ?? Date.now())) / 1000), referencia.current);
            setResultado(r || null);
            setTerminado(true);
        } catch (err) {
            setErrorEnvio(err?.message || 'No se pudo enviar. Intenta de nuevo.');
        } finally {
            setEnviando(false);
        }
    };

    if (!secciones.length) {
        return <Notice variant="info" compact>Todavía no hay preguntas para mostrar.</Notice>;
    }

    return (
        <div className="flex flex-col gap-4 min-h-[420px]">
            <div className="space-y-1">
                <div className="h-1.5 rounded-full bg-surface-card-hover overflow-hidden" role="progressbar"
                    aria-valuenow={progreso} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full bg-brand transition-all duration-[var(--dur-base)]" style={{ width: `${progreso}%` }} />
                </div>
                {/* Dónde va: la barra sola no dice cuánto falta. */}
                {!terminado && pasoReal >= 0 && pasos.length > 1 && (
                    <p className="text-micro text-content-3 text-right">
                        {enContacto ? 'Último paso' : `${enTelefono ? 'Pregunta' : 'Parte'} ${pasoReal + 1} de ${pasos.length}`}
                    </p>
                )}
            </div>

            {terminado ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 py-8">
                    <CheckCircle2 size={48} className="text-success" />
                    <p className="text-body-lg font-semibold text-content">
                        {entrevista ? 'Respuesta guardada' : (encuesta.mensaje_cierre || '¡Gracias por tu opinión!')}
                    </p>
                    <Incentivo r={resultado} entrevista={entrevista} entregando={entregando}
                        onEntregar={onEntregarMuestra && resultado?.id ? async () => {
                            setEntregando(true);
                            try {
                                await onEntregarMuestra(resultado.id);
                                setResultado((x) => ({ ...x, incentivo: { ...x.incentivo, estado: 'entregado' } }));
                            } catch (err) {
                                setErrorEnvio(err?.message || 'No se pudo marcar la entrega.');
                            } finally {
                                setEntregando(false);
                            }
                        } : null} />
                    {errorEnvio && <Notice variant="danger" icon={AlertTriangle} compact>{errorEnvio}</Notice>}
                    {cuenta != null && cuenta > 0 && (
                        <p className="text-body-sm text-content-3">Vuelve a empezar en {cuenta}…</p>
                    )}
                    <Button variant="secondary" onClick={reiniciar}>{entrevista ? 'Otra entrevista' : 'Volver a empezar'}</Button>
                </div>
            ) : enContacto ? (
                <div className="flex-1 flex flex-col gap-4">
                    <div>
                        <p className="text-body-lg font-semibold text-content">
                            {entrevista ? '¿El cliente quiere dejar sus datos?' : '¿Quieres dejarnos tus datos?'}
                        </p>
                        <p className="text-body-sm text-content-2">
                            Es opcional. {entrevista ? 'Sin datos, la respuesta queda anónima.' : 'Si no, tu respuesta queda anónima.'}
                        </p>
                    </div>
                    {incentivo && <Notice variant="success" icon={Gift} compact>{incentivo}</Notice>}
                    <PortalInput label="Teléfono" name="telefono" inputMode="tel" maskType="PHONE" value={contacto.telefono}
                        placeholder="7777-7777" onChange={(e) => setContacto((c) => ({ ...c, telefono: e.target.value }))} />
                    <PortalInput label="Nombre (opcional)" name="nombre" value={contacto.nombre}
                        onChange={(e) => setContacto((c) => ({ ...c, nombre: e.target.value }))} />
                    <Checkbox name="consiente" checked={contacto.consiente}
                        label={entrevista ? 'Consentimiento del cliente' : 'Consentimiento'}
                        description={encuesta.texto_consentimiento}
                        onChange={(v) => setContacto((c) => ({ ...c, consiente: v }))} />
                    {errorContacto && <Notice variant="danger">{errorContacto}</Notice>}
                    {errorEnvio && <Notice variant="danger" icon={AlertTriangle} compact>{errorEnvio}</Notice>}
                    <div className="flex flex-wrap gap-2 justify-between pt-2 mt-auto">
                        <Button variant="secondary" icon={ArrowLeft} disabled={enviando} onClick={() => setEnContacto(false)}>Atrás</Button>
                        <div className="flex flex-wrap gap-2">
                            <Button variant="secondary" disabled={enviando} onClick={() => enviar(false)}>Enviar sin datos</Button>
                            <Button icon={Check} loading={enviando} onClick={() => enviar(true)}>Enviar</Button>
                        </div>
                    </div>
                </div>
            ) : paso === -1 ? (
                <div className="flex-1 flex flex-col justify-center gap-4 py-6">
                    <p className="text-body-lg font-semibold text-content">{encuesta.nombre}</p>
                    <p className="text-body-sm text-content-2 whitespace-pre-line">{encuesta.mensaje_bienvenida}</p>
                    <Button icon={ArrowRight} onClick={() => setPaso(0)}>Empezar</Button>
                </div>
            ) : actual && (
                <>
                    {(actual.seccion.titulo || actual.seccion.descripcion) && (
                        <div>
                            {actual.seccion.titulo && <p className="text-body-lg font-semibold text-content">{actual.seccion.titulo}</p>}
                            {actual.seccion.descripcion && <p className="text-body-sm text-content-2">{actual.seccion.descripcion}</p>}
                        </div>
                    )}
                    <div className="space-y-5 flex-1">
                        {actual.preguntas.map((p) => (
                            <Pregunta key={p.id} p={p} valor={respuestas[p.id]} falta={faltante === p.id} entrevista={entrevista}
                                onChange={(v) => contestar(p.id, v)} />
                        ))}
                    </div>
                    <div className="flex gap-2 justify-between pt-2">
                        <Button variant="secondary" icon={ArrowLeft} disabled={pasoReal === 0 && !conBienvenida}
                            onClick={() => setPaso(pasoReal - 1)}>Atrás</Button>
                        <Button icon={ArrowRight} onClick={siguiente}>Siguiente</Button>
                    </div>
                </>
            )}
        </div>
    );
}

// ── Lo que recibe el cliente, al terminar ──────────────────────────────────

function Incentivo({ r, entrevista, entregando, onEntregar }) {
    const inc = r?.incentivo;
    if (!inc) return null;
    if (inc.tipo === 'puntos') {
        if (inc.estado === 'acreditado') {
            return <Notice variant="success" icon={Gift} compact>
                {entrevista ? `Se acreditaron ${inc.puntos} puntos en la cuenta del cliente.` : `¡Listo! Te acreditamos ${inc.puntos} puntos.`}
            </Notice>;
        }
        if (inc.estado === 'pendiente') {
            return <Notice variant="info" icon={Gift} compact>
                {entrevista
                    ? `Los ${inc.puntos} puntos quedaron pendientes: el teléfono no corresponde a una sola ficha. Se asignan desde el módulo.`
                    : `Tus ${inc.puntos} puntos quedan pendientes: los acreditamos cuando confirmemos tu cuenta.`}
            </Notice>;
        }
        return null;
    }
    if (inc.tipo === 'muestra' && entrevista) {
        if (inc.estado === 'entregado') {
            return <Notice variant="success" icon={Check} compact>Muestra entregada.</Notice>;
        }
        return (
            <div className="w-full space-y-2">
                <Notice variant="warning" icon={Gift} compact>Entrégale al cliente: {inc.descripcion || 'la muestra médica'}.</Notice>
                {onEntregar && <Button icon={Check} loading={entregando} onClick={onEntregar}>Ya la entregué</Button>}
            </div>
        );
    }
    return null;
}

// ── Una pregunta ───────────────────────────────────────────────────────────

// `activaCls`: el color de lo marcado cuando no es el de la marca (los tramos del NPS).
const opcionCls = (activa, activaCls = 'bg-brand text-white border-brand') => `min-h-[var(--tap-min)] rounded-xl border px-3 py-2 text-body-sm font-semibold
    transition-colors duration-[var(--dur-fast)] active:scale-[0.97]
    ${activa ? activaCls : 'bg-surface-card border-border-card text-content hover:bg-surface-card-hover'}`;

// Literales completos: Tailwind no ve una clase armada con `${tono}`.
const TRAMO_SOLIDO = {
    danger: 'bg-danger-solid border-danger-solid text-white',
    warning: 'bg-warning-solid border-warning-solid text-white',
    success: 'bg-success-solid border-success-solid text-white',
};
const TRAMO_PUNTO = { danger: 'bg-danger-solid', warning: 'bg-warning-solid', success: 'bg-success-solid' };
const TRAMO_TEXTO = { danger: 'text-danger-text', warning: 'text-warning-text', success: 'text-success-text' };

function Pregunta({ p, valor, falta, onChange, entrevista }) {
    const guion = entrevista ? guionDeEscala(p) : null;
    return (
        <fieldset className="space-y-2" aria-invalid={falta || undefined}>
            <legend className="text-body-md font-semibold text-content">
                <span className="text-content-3 mr-1">{p.numero}.</span>
                {p.texto || <span className="text-content-3 italic">Pregunta sin texto</span>}
                {p.obligatoria && <span className="text-danger ml-0.5" aria-label="obligatoria">*</span>}
            </legend>
            {guion && <Notice variant="info" compact>{guion}</Notice>}
            {p.ayuda && <p className="text-micro text-content-3">{p.ayuda}</p>}
            <Respuesta p={p} valor={valor} onChange={onChange} entrevista={entrevista} />
            {falta && <p className="text-micro font-semibold text-danger">Esta pregunta es obligatoria.</p>}
        </fieldset>
    );
}

// Literales completos para que Tailwind los vea.
const COLUMNAS = { 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5', 6: 'grid-cols-6' };
const COLUMNAS_SM = { 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4', 5: 'sm:grid-cols-5', 6: 'sm:grid-cols-6', 7: 'sm:grid-cols-7',
    8: 'sm:grid-cols-8', 9: 'sm:grid-cols-9', 10: 'sm:grid-cols-10', 11: 'sm:grid-cols-11' };

// Una «opción única» de números seguidos (1…10) pintada como escala: cuadrícula,
// qué es cada punta y lo marcado en palabras. Guarda el id de la opción, igual
// que la lista de antes (`escalaNumerica`).
function EscalaNumerica({ escala, valor, onChange }) {
    const { opciones, min, max, etiquetaMin, etiquetaMax } = escala;
    const marcada = opciones.find((o) => o.id === valor);
    const porFila = opciones.length > 6 ? Math.ceil(opciones.length / 2) : opciones.length;
    return (
        <div className="space-y-2">
            <div className={`grid gap-1 sm:gap-1.5 ${COLUMNAS[porFila]} ${COLUMNAS_SM[opciones.length]}`}>
                {opciones.map((o) => (
                    <button key={o.id} type="button" aria-pressed={valor === o.id} className={`${opcionCls(valor === o.id)} !px-0`}
                        onClick={() => onChange(o.id)}>{o.n}</button>
                ))}
            </div>
            {(etiquetaMin || etiquetaMax) && (
                <div className="flex justify-between gap-3 text-micro text-content-2">
                    <span>{min} = {etiquetaMin || '—'}</span><span className="text-right">{max} = {etiquetaMax || '—'}</span>
                </div>
            )}
            {marcada && (
                <p className="text-body-sm font-semibold text-brand-text" aria-live="polite">
                    Marcó {marcada.n} de {max}{marcada.n === min && etiquetaMin ? `: ${etiquetaMin}` : marcada.n === max && etiquetaMax ? `: ${etiquetaMax}` : ''}.
                </p>
            )}
        </div>
    );
}

function Respuesta({ p, valor, onChange, entrevista }) {
    switch (p.tipo) {
        case 'nps': {
            // Cada tramo con su color, en la leyenda y en el botón marcado, y lo
            // marcado repetido en palabras: con la cuadrícula partida en dos filas
            // «nada / muy probable» ya no marcaba las puntas (TRAMOS_NPS).
            const marcado = tramoNps(valor);
            return (
                <div className="space-y-2">
                    {/* En el teléfono, 7 por fila: 0–6 arriba y 7–10 abajo, así cada
                        fila coincide con su tramo (con 6 por fila el 6, que es
                        «poco probable», caía en la fila de los buenos). */}
                    <div className="grid grid-cols-7 sm:grid-cols-11 gap-1 sm:gap-1.5">
                        {Array.from({ length: 11 }, (_, n) => {
                            const t = tramoNps(n);
                            const activa = valor === n;
                            return (
                                <button key={n} type="button" aria-pressed={activa} aria-label={`${n} · ${t.label}`}
                                    className={`${opcionCls(activa, TRAMO_SOLIDO[t.tono])} !px-0`}
                                    onClick={() => onChange(n)}>{n}</button>
                            );
                        })}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-micro text-content-2">
                        {TRAMOS_NPS.map((t) => (
                            <span key={t.tono} className="inline-flex items-center gap-1.5">
                                <span className={`size-2 rounded-full ${TRAMO_PUNTO[t.tono]}`} aria-hidden />
                                {t.desde}–{t.hasta} {t.label.toLowerCase()}
                            </span>
                        ))}
                    </div>
                    {marcado && (
                        <p className={`text-body-sm font-semibold ${TRAMO_TEXTO[marcado.tono]}`} aria-live="polite">
                            Marcó {valor}: {marcado.label.toLowerCase()} que recomiende la farmacia.
                        </p>
                    )}
                </div>
            );
        }
        case 'csat': {
            // El rótulo va SIEMPRE: en el teléfono iba escondido, y sin él
            // 🙁, 😐 y 🙂 se parecen demasiado.
            const marcada = CARITAS.find((c) => c.valor === valor);
            return (
                <div className="space-y-2">
                    <div className="grid grid-cols-5 gap-1 sm:gap-1.5">
                        {CARITAS.map((c) => (
                            <button key={c.valor} type="button" title={c.label} aria-label={c.label} aria-pressed={valor === c.valor}
                                className={`${opcionCls(valor === c.valor)} !px-1 flex flex-col items-center gap-1`}
                                onClick={() => onChange(c.valor)}>
                                <span className="text-2xl leading-none" aria-hidden>{c.emoji}</span>
                                <span className="text-micro font-medium leading-tight text-center">{c.label}</span>
                            </button>
                        ))}
                    </div>
                    {marcada && <p className="text-body-sm font-semibold text-brand-text" aria-live="polite">Marcó: {marcada.label.toLowerCase()}.</p>}
                </div>
            );
        }
        case 'likert':
            return (
                // En el teléfono, una lista (como la app): en cinco columnas de
                // 60 px «Totalmente de acuerdo» se partía en tres renglones.
                <div className="flex flex-col sm:grid sm:grid-cols-5 gap-1.5">
                    {ACUERDO.map((label, i) => (
                        <button key={label} type="button" aria-pressed={valor === i + 1}
                            className={`${opcionCls(valor === i + 1)} flex sm:flex-col items-center gap-2 sm:gap-0.5 text-left sm:text-center`}
                            onClick={() => onChange(i + 1)}>
                            <span className="text-body-md w-5 sm:w-auto shrink-0">{i + 1}</span>
                            <span className="text-body-sm sm:text-micro font-medium leading-tight">{label}</span>
                        </button>
                    ))}
                </div>
            );
        case 'si_no':
            return (
                <div className="grid grid-cols-2 gap-2">
                    {[[true, 'Sí'], [false, 'No']].map(([v, l]) => (
                        <button key={l} type="button" className={opcionCls(valor === v)} aria-pressed={valor === v}
                            onClick={() => onChange(v)}>{l}</button>
                    ))}
                </div>
            );
        case 'unica': {
            const escala = escalaNumerica(p);
            if (escala) return <EscalaNumerica escala={escala} valor={valor} onChange={onChange} />;
            return (
                <div className="flex flex-col gap-1.5">
                    {opcionesConTexto(p).map((o) => (
                        <button key={o.id} type="button" className={`${opcionCls(valor === o.id)} text-left`} aria-pressed={valor === o.id}
                            onClick={() => onChange(o.id)}>{o.texto}</button>
                    ))}
                </div>
            );
        }
        case 'multiple': {
            const marcadas = Array.isArray(valor) ? valor : [];
            const maximo = maximoDe(p);
            const exclusivas = exclusivasDe(p);
            const lleno = !!maximo && marcadas.length >= maximo;
            return (
                <div className="flex flex-col gap-1.5">
                    {maximo && (
                        <p className="text-micro text-content-3" aria-live="polite">
                            {textoDeMaximo(maximo)} {marcadas.length > 0 && `Llevas ${marcadas.length}.`}
                        </p>
                    )}
                    {opcionesConTexto(p).map((o) => {
                        const on = marcadas.includes(o.id);
                        return (
                            <button key={o.id} type="button" aria-pressed={on} disabled={!on && lleno && !exclusivas.includes(o.id)}
                                className={`${opcionCls(on)} text-left flex items-center gap-2 disabled:opacity-40`}
                                onClick={() => onChange(alternarOpcion(marcadas, o.id, maximo, exclusivas))}>
                                <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0
                                    ${on ? 'border-current' : 'border-border-card'}`}>{on && <Check size={11} />}</span>
                                {o.texto}
                            </button>
                        );
                    })}
                </div>
            );
        }
        case 'ranking': {
            const ops = opcionesConTexto(p);
            const orden = Array.isArray(valor) && valor.length === ops.length ? valor : ops.map((o) => o.id);
            const moverA = (i, d) => {
                const j = i + d;
                if (j < 0 || j >= orden.length) return;
                const n = [...orden];
                [n[i], n[j]] = [n[j], n[i]];
                onChange(n);
            };
            return (
                <div className="space-y-1.5">
                <p className="text-micro text-content-3">Use las flechas para cambiar el orden. Si ya está como lo dijo, siga.</p>
                <ol className="flex flex-col gap-1.5">
                    {orden.map((id, i) => (
                        <li key={id} data-surface="card" className="flex items-center gap-2 px-3 py-1.5">
                            <span className="text-body-sm font-bold text-content-3 w-5">{i + 1}</span>
                            <span className="flex-1 text-body-sm text-content">{ops.find((o) => o.id === id)?.texto}</span>
                            <Button variant="ghost" size="sm" iconOnly icon={ArrowUp} title="Subir" disabled={i === 0} onClick={() => moverA(i, -1)} />
                            <Button variant="ghost" size="sm" iconOnly icon={ArrowDown} title="Bajar" disabled={i === orden.length - 1} onClick={() => moverA(i, 1)} />
                        </li>
                    ))}
                </ol>
                </div>
            );
        }
        case 'numero':
            return (
                <PortalInput name={p.id} inputMode="numeric" maskType="INTEGER" value={valor ?? ''}
                    onChange={(e) => {
                        if (e.target.value === '') { onChange(''); return; }
                        const n = Number(e.target.value);
                        // La base no acepta más de nueve cifras: se frena al teclear.
                        if (Number.isFinite(n) && Math.abs(n) <= MAX_NUMERO) onChange(n);
                    }} placeholder="Escriba la cantidad" />
            );
        default:
            return (
                <PortalTextarea name={p.id} rows={3} value={valor || ''} maxLength={MAX_TEXTO}
                    onChange={(e) => onChange(e.target.value.slice(0, MAX_TEXTO))}
                    placeholder={entrevista ? 'Lo que respondió, con sus palabras' : 'Escribe tu respuesta…'} />
            );
    }
}
