import React, { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Check, CheckCircle2 } from 'lucide-react';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import {
    CARITAS, ACUERDO, preguntasEnOrden, cumpleCondicion, primeraSinContestar,
} from '@nucleo/utils/encuestasClientes';

/**
 * El cuestionario tal como lo contesta el cliente: una sección por pantalla,
 * las preguntas condicionadas aparecen o desaparecen según lo contestado.
 *
 * Hoy lo usa la vista previa del constructor; en la fase 2 es el formulario
 * real (QR, entrevista y tablet). Por eso NO sabe guardar: recibe `onTerminar`
 * con las respuestas. Lo que el revisor aprueba mirando la vista previa es
 * exactamente lo que el cliente va a recorrer.
 */
export default function FormularioEncuesta({ encuesta, onTerminar, onReiniciar }) {
    const secciones = useMemo(() => (encuesta?.cuestionario?.secciones || [])
        .filter((s) => (s.preguntas || []).length > 0), [encuesta?.cuestionario]);
    const numeradas = useMemo(() => preguntasEnOrden(encuesta?.cuestionario), [encuesta?.cuestionario]);
    const [paso, setPaso] = useState(encuesta?.mensaje_bienvenida ? -1 : 0);
    const [respuestas, setRespuestas] = useState({});
    const [faltante, setFaltante] = useState(null);
    const [terminado, setTerminado] = useState(false);

    // Las secciones que quedaron sin ninguna pregunta visible se saltan.
    const visiblesDe = (s) => numeradas
        .filter((p) => p.seccionId === s.id && cumpleCondicion(p.condicion, respuestas));
    const pasos = secciones.map((s, i) => ({ s, i })).filter(({ s }) => visiblesDe(s).length > 0);
    const actual = pasos[paso] || null;
    const progreso = pasos.length ? Math.round(((terminado ? pasos.length : Math.max(paso, 0)) / pasos.length) * 100) : 0;

    const contestar = (id, valor) => {
        setRespuestas((r) => ({ ...r, [id]: valor }));
        if (faltante === id) setFaltante(null);
    };

    const siguiente = () => {
        if (actual) {
            const falta = primeraSinContestar(visiblesDe(actual.s), respuestas);
            if (falta) { setFaltante(falta.id); return; }
        }
        setFaltante(null);
        if (paso + 1 >= pasos.length) {
            // Lo que quedó escondido por una condición no viaja: el cliente no
            // lo vio, aunque lo hubiera contestado antes de cambiar de opinión.
            const vistas = new Set(numeradas.filter((p) => cumpleCondicion(p.condicion, respuestas)).map((p) => p.id));
            const limpias = Object.fromEntries(Object.entries(respuestas).filter(([k]) => vistas.has(k)));
            setTerminado(true);
            onTerminar?.(limpias);
            return;
        }
        setPaso((p) => p + 1);
    };

    const reiniciar = () => {
        setRespuestas({});
        setFaltante(null);
        setTerminado(false);
        setPaso(encuesta?.mensaje_bienvenida ? -1 : 0);
        onReiniciar?.();
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
                        {encuesta.mensaje_cierre || '¡Gracias por tu opinión!'}
                    </p>
                    <Button variant="secondary" onClick={reiniciar}>Volver a empezar</Button>
                </div>
            ) : paso === -1 ? (
                <div className="flex-1 flex flex-col justify-center gap-4 py-6">
                    <p className="text-body-lg font-semibold text-content">{encuesta.nombre}</p>
                    <p className="text-body-sm text-content-2 whitespace-pre-line">{encuesta.mensaje_bienvenida}</p>
                    <Button icon={ArrowRight} onClick={() => setPaso(0)}>Empezar</Button>
                </div>
            ) : actual && (
                <>
                    {(actual.s.titulo || actual.s.descripcion) && (
                        <div>
                            {actual.s.titulo && <p className="text-body-lg font-semibold text-content">{actual.s.titulo}</p>}
                            {actual.s.descripcion && <p className="text-body-sm text-content-2">{actual.s.descripcion}</p>}
                        </div>
                    )}
                    <div className="space-y-5 flex-1">
                        {visiblesDe(actual.s).map((p) => (
                            <Pregunta key={p.id} p={p} valor={respuestas[p.id]} falta={faltante === p.id}
                                onChange={(v) => contestar(p.id, v)} />
                        ))}
                    </div>
                    <div className="flex gap-2 justify-between pt-2">
                        <Button variant="secondary" icon={ArrowLeft} disabled={paso === 0 && !encuesta.mensaje_bienvenida}
                            onClick={() => setPaso((x) => x - 1)}>Atrás</Button>
                        <Button icon={paso + 1 >= pasos.length ? Check : ArrowRight} onClick={siguiente}>
                            {paso + 1 >= pasos.length ? 'Enviar' : 'Siguiente'}
                        </Button>
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
