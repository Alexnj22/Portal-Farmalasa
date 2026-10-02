import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Check, CheckCircle2, Gift, AlertTriangle } from 'lucide-react';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import Checkbox from '../../components/common/Checkbox';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import {
    CARITAS, ACUERDO, recorrido, primeraSinContestar, telefonoValido,
} from '@nucleo/utils/encuestasClientes';

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
 */
export default function FormularioEncuesta({ encuesta, onEnviar, reinicioAuto = null, entrevista = false }) {
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
    const [inicio, setInicio] = useState(() => Date.now());
    const [cuenta, setCuenta] = useState(null);

    const { visibles, limpias } = useMemo(() => recorrido(encuesta?.cuestionario, respuestas), [encuesta?.cuestionario, respuestas]);
    // Las secciones que quedaron sin ninguna pregunta visible se saltan.
    const visiblesDe = (s) => visibles.filter((p) => p.seccionId === s.id);
    const pasos = secciones.filter((s) => visiblesDe(s).length > 0);
    const actual = paso >= 0 ? pasos[paso] || null : null;
    const total = pasos.length + 1;
    const progreso = terminado ? 100 : Math.round((Math.max(enContacto ? pasos.length : paso, 0) / total) * 100);
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
        setInicio(Date.now());
        setPaso(conBienvenida ? -1 : 0);
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
        setRespuestas((r) => ({ ...r, [id]: valor }));
        if (faltante === id) setFaltante(null);
    };

    const siguiente = () => {
        if (actual) {
            const falta = primeraSinContestar(visiblesDe(actual), respuestas);
            if (falta) { setFaltante(falta.id); return; }
        }
        setFaltante(null);
        if (paso + 1 >= pasos.length) { setEnContacto(true); return; }
        setPaso((p) => p + 1);
    };

    const enviar = async (conDatos) => {
        const c = conDatos ? contacto : { consiente: false };
        if (conDatos) {
            if (!c.consiente) { setErrorContacto('Para guardar los datos hay que aceptar el consentimiento.'); return; }
            if (!c.telefono.trim() && !c.nombre.trim()) { setErrorContacto('Escribe el teléfono o el nombre, o envía sin datos.'); return; }
            if (c.telefono.trim() && !telefonoValido(c.telefono)) { setErrorContacto('El teléfono debe tener 8 dígitos.'); return; }
        }
        setErrorContacto(null);
        setErrorEnvio(null);
        if (!onEnviar) { setTerminado(true); return; }
        setEnviando(true);
        try {
            await onEnviar(limpias, conDatos ? { consiente: true, telefono: c.telefono.trim(), nombre: c.nombre.trim() } : null,
                Math.round((Date.now() - inicio) / 1000));
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
            <div className="h-1.5 rounded-full bg-surface-card-hover overflow-hidden" role="progressbar"
                aria-valuenow={progreso} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-brand transition-all duration-[var(--dur-base)]" style={{ width: `${progreso}%` }} />
            </div>

            {terminado ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 py-8">
                    <CheckCircle2 size={48} className="text-success" />
                    <p className="text-body-lg font-semibold text-content">
                        {entrevista ? 'Respuesta guardada' : (encuesta.mensaje_cierre || '¡Gracias por tu opinión!')}
                    </p>
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
                    {errorContacto && <p className="text-micro font-semibold text-danger">{errorContacto}</p>}
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
                    {(actual.titulo || actual.descripcion) && (
                        <div>
                            {actual.titulo && <p className="text-body-lg font-semibold text-content">{actual.titulo}</p>}
                            {actual.descripcion && <p className="text-body-sm text-content-2">{actual.descripcion}</p>}
                        </div>
                    )}
                    <div className="space-y-5 flex-1">
                        {visiblesDe(actual).map((p) => (
                            <Pregunta key={p.id} p={p} valor={respuestas[p.id]} falta={faltante === p.id}
                                onChange={(v) => contestar(p.id, v)} />
                        ))}
                    </div>
                    <div className="flex gap-2 justify-between pt-2">
                        <Button variant="secondary" icon={ArrowLeft} disabled={paso === 0 && !conBienvenida}
                            onClick={() => setPaso((x) => x - 1)}>Atrás</Button>
                        <Button icon={ArrowRight} onClick={siguiente}>Siguiente</Button>
                    </div>
                </>
            )}
        </div>
    );
}

// ── Una pregunta ───────────────────────────────────────────────────────────

const opcionCls = (activa) => `min-h-[var(--tap-min)] rounded-xl border px-3 py-2 text-body-sm font-semibold
    transition-colors duration-[var(--dur-fast)] active:scale-[0.97]
    ${activa ? 'bg-brand text-white border-brand' : 'bg-surface-card border-border-card text-content hover:bg-surface-card-hover'}`;

function Pregunta({ p, valor, falta, onChange }) {
    return (
        <fieldset className="space-y-2" aria-invalid={falta || undefined}>
            <legend className="text-body-md font-semibold text-content">
                <span className="text-content-3 mr-1">{p.numero}.</span>
                {p.texto || <span className="text-content-3 italic">Pregunta sin texto</span>}
                {p.obligatoria && <span className="text-danger ml-0.5" aria-label="obligatoria">*</span>}
            </legend>
            {p.ayuda && <p className="text-micro text-content-3">{p.ayuda}</p>}
            <Respuesta p={p} valor={valor} onChange={onChange} />
            {falta && <p className="text-micro font-semibold text-danger">Esta pregunta es obligatoria.</p>}
        </fieldset>
    );
}

function Respuesta({ p, valor, onChange }) {
    switch (p.tipo) {
        case 'nps':
            return (
                <div>
                    <div className="grid grid-cols-6 sm:grid-cols-11 gap-1.5">
                        {Array.from({ length: 11 }, (_, n) => (
                            <button key={n} type="button" className={opcionCls(valor === n)} aria-pressed={valor === n}
                                onClick={() => onChange(n)}>{n}</button>
                        ))}
                    </div>
                    <div className="flex justify-between text-micro text-content-3 mt-1">
                        <span>Nada probable</span><span>Muy probable</span>
                    </div>
                </div>
            );
        case 'csat':
            return (
                <div className="grid grid-cols-5 gap-1.5">
                    {CARITAS.map((c) => (
                        <button key={c.valor} type="button" title={c.label} aria-label={c.label} aria-pressed={valor === c.valor}
                            className={`${opcionCls(valor === c.valor)} flex flex-col items-center gap-0.5`}
                            onClick={() => onChange(c.valor)}>
                            <span className="text-2xl leading-none" aria-hidden>{c.emoji}</span>
                            <span className="text-micro font-medium hidden sm:block">{c.label}</span>
                        </button>
                    ))}
                </div>
            );
        case 'likert':
            return (
                <div className="grid grid-cols-5 gap-1.5">
                    {ACUERDO.map((label, i) => (
                        <button key={label} type="button" aria-pressed={valor === i + 1}
                            className={`${opcionCls(valor === i + 1)} flex flex-col items-center gap-0.5`}
                            onClick={() => onChange(i + 1)}>
                            <span className="text-body-md">{i + 1}</span>
                            <span className="text-micro font-medium leading-tight">{label}</span>
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
        case 'unica':
            return (
                <div className="flex flex-col gap-1.5">
                    {(p.opciones || []).filter((o) => o.texto).map((o) => (
                        <button key={o.id} type="button" className={`${opcionCls(valor === o.id)} text-left`} aria-pressed={valor === o.id}
                            onClick={() => onChange(o.id)}>{o.texto}</button>
                    ))}
                </div>
            );
        case 'multiple': {
            const marcadas = Array.isArray(valor) ? valor : [];
            return (
                <div className="flex flex-col gap-1.5">
                    {(p.opciones || []).filter((o) => o.texto).map((o) => {
                        const on = marcadas.includes(o.id);
                        return (
                            <button key={o.id} type="button" aria-pressed={on}
                                className={`${opcionCls(on)} text-left flex items-center gap-2`}
                                onClick={() => onChange(on ? marcadas.filter((x) => x !== o.id) : [...marcadas, o.id])}>
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
            const ops = (p.opciones || []).filter((o) => o.texto);
            const orden = Array.isArray(valor) && valor.length === ops.length ? valor : ops.map((o) => o.id);
            const moverA = (i, d) => {
                const j = i + d;
                if (j < 0 || j >= orden.length) return;
                const n = [...orden];
                [n[i], n[j]] = [n[j], n[i]];
                onChange(n);
            };
            return (
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
            );
        }
        case 'numero':
            return (
                <PortalInput name={p.id} inputMode="numeric" maskType="INTEGER" value={valor ?? ''}
                    onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} placeholder="0" />
            );
        default:
            return (
                <PortalTextarea name={p.id} rows={3} value={valor || ''} onChange={(e) => onChange(e.target.value)}
                    placeholder="Escribe tu respuesta…" />
            );
    }
}
