import React, { useMemo, useState } from 'react';
import {
    Plus, Trash2, ArrowUp, ArrowDown, Copy, ChevronDown, ChevronRight, GitBranch, X, Layers,
} from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Switch from '../../components/common/Switch';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import IconoPorNombre from '../../components/common/IconoPorNombre';
import { EmptyState } from '../../components/common/StateViews';
import {
    TIPOS_PREGUNTA, tipoDe, nuevaOpcion, mover, preguntasEnOrden,
    cambiarTipo, quitarPregunta, sinCondicion, operadoresPara, puedeSerCondicion, textoDeCondicion,
    cambiarSeccion as cambiarSeccionDe, cambiarPregunta as cambiarPreguntaDe, agregarSeccion as agregarSeccionA,
    agregarPregunta as agregarPreguntaA, duplicarPregunta as duplicarPreguntaDe, moverPregunta as moverPreguntaDe,
    quitarSeccion as quitarSeccionDe, condicionSobre,
} from '@nucleo/utils/encuestasClientes';
import { ICONOS, tintaDeDimension } from './iconos';

/**
 * El constructor del cuestionario: secciones, preguntas, opciones y saltos.
 *
 * No guarda: entrega el cuestionario nuevo a `onChange` y la vista lo guarda
 * sola unos instantes después (por eso este archivo no lleva borrador local:
 * lo que se escribe ya está en la base). Con `soloLectura` pinta lo mismo sin
 * controles — así ve la encuesta quien la revisa.
 */
export default function Constructor({ cuestionario, dimensiones, soloLectura, onChange }) {
    const secciones = useMemo(() => cuestionario?.secciones || [], [cuestionario]);
    const numeradas = useMemo(() => preguntasEnOrden(cuestionario), [cuestionario]);
    const dimPorClave = useMemo(() => Object.fromEntries(dimensiones.map((d) => [d.clave, d])), [dimensiones]);
    const [abierta, setAbierta] = useState(null);

    // Las operaciones sobre el cuestionario: núcleo (`encuestasClientes`), las
    // mismas que usa la app.
    const cambiar = (nuevas) => onChange({ ...cuestionario, secciones: nuevas });
    const cambiarSeccion = (i, cambios) => onChange(cambiarSeccionDe(cuestionario, i, cambios));
    const cambiarPregunta = (si, pi, nueva) => onChange(cambiarPreguntaDe(cuestionario, si, pi, nueva));
    const agregarSeccion = () => onChange(agregarSeccionA(cuestionario));
    const agregarPregunta = (si, tipo) => {
        const r = agregarPreguntaA(cuestionario, si, tipo);
        onChange(r.cuestionario);
        setAbierta(r.id);
    };
    const duplicarPregunta = (si, pi) => {
        const r = duplicarPreguntaDe(cuestionario, si, pi);
        onChange(r.cuestionario);
        setAbierta(r.id);
    };
    const moverPregunta = (si, pi, d) => onChange(moverPreguntaDe(cuestionario, si, pi, d));
    const quitarSeccion = (si) => onChange(quitarSeccionDe(cuestionario, si));

    if (!secciones.length) {
        return (
            <EmptyState icon={Layers} title="Sin preguntas todavía"
                subtitle="Arma la encuesta por secciones: por ejemplo «Tu visita de hoy» y «Para cerrar»."
                action={!soloLectura && <Button icon={Plus} onClick={agregarSeccion}>Agregar una sección</Button>} />
        );
    }

    return (
        <div className="space-y-5">
            {secciones.map((s, si) => (
                <section key={s.id} data-surface="card" className="p-4 space-y-3">
                    <div className="flex items-start gap-2">
                        <span className="text-micro font-bold uppercase tracking-wide text-content-3 pt-1 shrink-0">
                            Sección {si + 1}
                        </span>
                        {soloLectura ? (
                            <div className="flex-1 min-w-0">
                                <p className="text-body-md font-semibold text-content">{s.titulo || 'Sin título'}</p>
                                {s.descripcion && <p className="text-body-sm text-content-2">{s.descripcion}</p>}
                            </div>
                        ) : (
                            <div className="flex-1 min-w-0 grid gap-2">
                                <PortalInput name={`titulo-${s.id}`} value={s.titulo || ''} placeholder="Título de la sección (opcional)"
                                    onChange={(e) => cambiarSeccion(si, { titulo: e.target.value })} />
                                <PortalInput name={`desc-${s.id}`} value={s.descripcion || ''} placeholder="Una línea que explique la sección (opcional)"
                                    onChange={(e) => cambiarSeccion(si, { descripcion: e.target.value })} />
                            </div>
                        )}
                        {!soloLectura && (
                            <div className="flex shrink-0">
                                <Button variant="ghost" size="sm" iconOnly icon={ArrowUp} title="Subir sección" disabled={si === 0}
                                    onClick={() => cambiar(mover(secciones, si, -1))} />
                                <Button variant="ghost" size="sm" iconOnly icon={ArrowDown} title="Bajar sección" disabled={si === secciones.length - 1}
                                    onClick={() => cambiar(mover(secciones, si, 1))} />
                                <Button variant="ghost" size="sm" iconOnly icon={Trash2} title="Quitar la sección y sus preguntas"
                                    onClick={() => quitarSeccion(si)} />
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        {(s.preguntas || []).map((p, pi) => {
                            const num = numeradas.find((x) => x.id === p.id);
                            return (
                                <PreguntaEditor key={p.id} p={p} numero={num?.numero}
                                    anteriores={numeradas.slice(0, (num?.numero || 1) - 1)}
                                    numeradas={numeradas} dimensiones={dimensiones} dimension={dimPorClave[p.dimension]}
                                    soloLectura={soloLectura} abierta={abierta === p.id}
                                    onToggle={() => setAbierta((a) => (a === p.id ? null : p.id))}
                                    onChange={(n) => cambiarPregunta(si, pi, n)}
                                    onSubir={si === 0 && pi === 0 ? null : () => moverPregunta(si, pi, -1)}
                                    onBajar={si === secciones.length - 1 && pi === s.preguntas.length - 1 ? null : () => moverPregunta(si, pi, 1)}
                                    onDuplicar={() => duplicarPregunta(si, pi)}
                                    onQuitar={() => onChange(quitarPregunta(cuestionario, p.id))} />
                            );
                        })}
                        {!(s.preguntas || []).length && (
                            <p className="text-body-sm text-content-3 px-1">Esta sección no tiene preguntas.</p>
                        )}
                    </div>

                    {!soloLectura && (
                        <div className="max-w-xs">
                            <LiquidSelect value="" placeholder="+ Agregar pregunta" clearable={false} icon={Plus}
                                ariaLabel="Agregar pregunta"
                                options={TIPOS_PREGUNTA.map((t) => ({ value: t.value, label: t.label }))}
                                onChange={(v) => v && agregarPregunta(si, v)} />
                        </div>
                    )}
                </section>
            ))}
            {!soloLectura && (
                <Button variant="secondary" icon={Plus} onClick={agregarSeccion}>Agregar sección</Button>
            )}
        </div>
    );
}

// ── Una pregunta ───────────────────────────────────────────────────────────

function Rotulo({ children }) {
    return <span className="block text-label font-semibold text-content-2 mb-1">{children}</span>;
}

function PreguntaEditor({
    p, numero, anteriores, numeradas, dimensiones, dimension, soloLectura, abierta,
    onToggle, onChange, onSubir, onBajar, onDuplicar, onQuitar,
}) {
    const tipo = tipoDe(p.tipo);
    const set = (k) => (v) => onChange({ ...p, [k]: v });
    const candidatas = anteriores.filter((a) => puedeSerCondicion(a.tipo));
    const condicion = p.condicion?.pregunta ? p.condicion : null;
    const mirada = condicion ? numeradas.find((x) => x.id === condicion.pregunta) : null;

    const resumen = (
        <div className="flex items-start gap-2 min-w-0 flex-1">
            <span className="text-body-sm font-bold text-content-3 w-6 shrink-0 pt-0.5">{numero}.</span>
            <IconoPorNombre iconos={ICONOS} nombre={tipo.icono} size={15} className="text-content-3 shrink-0 mt-1" />
            <div className="min-w-0 flex-1">
                <p className={`text-body-sm ${p.texto ? 'text-content font-medium' : 'text-content-3 italic'}`}>
                    {p.texto || 'Pregunta sin texto'}
                    {p.obligatoria && <span className="text-danger ml-0.5">*</span>}
                </p>
                <div className="flex flex-wrap gap-1 mt-1">
                    <Badge size="sm">{tipo.corto}</Badge>
                    {dimension && (
                        <span className={`text-micro font-semibold rounded-full px-2 py-0.5 ${tintaDeDimension(dimension.color)}`}>
                            {dimension.nombre}
                        </span>
                    )}
                    {condicion && (
                        <Badge size="sm" variant="info">
                            <GitBranch size={10} className="inline mr-0.5" />{textoDeCondicion(condicion, numeradas)}
                        </Badge>
                    )}
                </div>
            </div>
        </div>
    );

    if (soloLectura) {
        return (
            <div className="rounded-xl border border-border-card px-3 py-2.5 space-y-2">
                {resumen}
                {tipo.opciones && (
                    <ul className="pl-14 text-body-sm text-content-2 list-disc">
                        {(p.opciones || []).map((o) => <li key={o.id}>{o.texto}</li>)}
                    </ul>
                )}
            </div>
        );
    }

    return (
        <div className={`rounded-xl border ${abierta ? 'border-brand/40 bg-brand/5' : 'border-border-card'}`}>
            <div className="flex items-start gap-1 px-2 py-2">
                <button type="button" onClick={onToggle} aria-expanded={abierta}
                    className="flex items-start gap-1 flex-1 min-w-0 text-left min-h-[var(--tap-min)] active:scale-[0.99]">
                    {abierta ? <ChevronDown size={16} className="text-content-3 mt-1 shrink-0" />
                        : <ChevronRight size={16} className="text-content-3 mt-1 shrink-0" />}
                    {resumen}
                </button>
                <div className="flex shrink-0">
                    <Button variant="ghost" size="sm" iconOnly icon={ArrowUp} title="Subir" disabled={!onSubir} onClick={onSubir} />
                    <Button variant="ghost" size="sm" iconOnly icon={ArrowDown} title="Bajar" disabled={!onBajar} onClick={onBajar} />
                    <Button variant="ghost" size="sm" iconOnly icon={Copy} title="Duplicar" onClick={onDuplicar} />
                    <Button variant="ghost" size="sm" iconOnly icon={Trash2} title="Quitar" onClick={onQuitar} />
                </div>
            </div>

            {abierta && (
                <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border-card">
                    <PortalTextarea label="Pregunta" name={`texto-${p.id}`} rows={2} value={p.texto || ''}
                        placeholder="¿Qué quieres preguntar?" onChange={(e) => set('texto')(e.target.value)} />
                    <div className="grid sm:grid-cols-2 gap-3">
                        <div>
                            <Rotulo>Tipo de respuesta</Rotulo>
                            <LiquidSelect value={p.tipo} clearable={false} ariaLabel="Tipo de respuesta"
                                options={TIPOS_PREGUNTA.map((t) => ({ value: t.value, label: t.label }))}
                                onChange={(v) => v && onChange(cambiarTipo(p, v))} />
                            <p className="text-micro text-content-3 mt-1">{tipo.ayuda}</p>
                        </div>
                        <div>
                            <Rotulo>Qué mide</Rotulo>
                            <LiquidSelect value={p.dimension || ''} placeholder="Sin dimensión" ariaLabel="Dimensión"
                                options={dimensiones.filter((d) => d.activo || d.clave === p.dimension)
                                    .map((d) => ({ value: d.clave, label: d.nombre }))}
                                onChange={(v) => set('dimension')(v || undefined)} />
                            <p className="text-micro text-content-3 mt-1">Agrupa los resultados por tema.</p>
                        </div>
                    </div>
                    <PortalInput label="Ayuda (opcional)" name={`ayuda-${p.id}`} value={p.ayuda || ''}
                        placeholder="Una aclaración debajo de la pregunta" onChange={(e) => set('ayuda')(e.target.value)} />

                    {tipo.opciones && (
                        <div className="space-y-1.5">
                            <Rotulo>Opciones</Rotulo>
                            {(p.opciones || []).map((o, oi) => (
                                <div key={o.id} className="flex items-center gap-1.5">
                                    <div className="flex-1">
                                        <PortalInput name={`op-${p.id}-${o.id}`} value={o.texto} placeholder={`Opción ${oi + 1}`}
                                            onChange={(e) => set('opciones')(p.opciones.map((x) => (x.id === o.id ? { ...x, texto: e.target.value } : x)))} />
                                    </div>
                                    <Button variant="ghost" size="sm" iconOnly icon={ArrowUp} title="Subir opción" disabled={oi === 0}
                                        onClick={() => set('opciones')(mover(p.opciones, oi, -1))} />
                                    <Button variant="ghost" size="sm" iconOnly icon={X} title="Quitar opción" disabled={p.opciones.length <= 2}
                                        onClick={() => set('opciones')(p.opciones.filter((x) => x.id !== o.id))} />
                                </div>
                            ))}
                            <Button variant="ghost" size="sm" icon={Plus} onClick={() => set('opciones')([...(p.opciones || []), nuevaOpcion(p.opciones)])}>
                                Agregar opción
                            </Button>
                        </div>
                    )}

                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                        <ConRotulo texto="Obligatoria">
                            <Switch checked={!!p.obligatoria} onChange={(v) => set('obligatoria')(v)} label="Obligatoria" size="sm" />
                        </ConRotulo>
                        <ConRotulo texto={candidatas.length || condicion ? 'Mostrar sólo si…' : 'Mostrar sólo si… (no hay una pregunta antes que sirva)'}>
                        <Switch checked={!!condicion} disabled={!candidatas.length && !condicion} size="sm"
                            label="Mostrar sólo si"
                            onChange={(on) => {
                                if (!on) { onChange(sinCondicion(p)); return; }
                                onChange({ ...p, condicion: condicionSobre(candidatas[candidatas.length - 1]) });
                            }} />
                        </ConRotulo>
                    </div>

                    {condicion && (
                        <div className="grid sm:grid-cols-3 gap-2 rounded-xl bg-surface-card-hover p-2">
                            <LiquidSelect value={condicion.pregunta} clearable={false} ariaLabel="Pregunta de la que depende"
                                options={candidatas.map((c) => ({ value: c.id, label: `${c.numero}. ${c.texto || 'Sin texto'}` }))}
                                onChange={(v) => {
                                    const c = candidatas.find((x) => x.id === v);
                                    if (c) onChange({ ...p, condicion: condicionSobre(c) });
                                }} />
                            {mirada && (
                                <>
                                    <LiquidSelect value={condicion.operador} clearable={false} ariaLabel="Condición"
                                        options={operadoresPara(mirada.tipo)}
                                        onChange={(v) => v && set('condicion')({ ...condicion, operador: v })} />
                                    <ValorDeCondicion pregunta={mirada} valor={condicion.valor}
                                        onChange={(v) => set('condicion')({ ...condicion, valor: v })} />
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// El `label` de Switch es sólo para lectores de pantalla: el rótulo visible va
// al lado, y envolverlo en <label> hace que tocar el texto también lo cambie.
function ConRotulo({ texto, children }) {
    return (
        <label className="inline-flex items-center gap-2 text-body-sm text-content-2 cursor-pointer min-h-[var(--tap-min)]">
            {children}<span>{texto}</span>
        </label>
    );
}


function ValorDeCondicion({ pregunta, valor, onChange }) {
    if (pregunta.tipo === 'si_no') {
        return (
            <LiquidSelect value={valor ? 'si' : 'no'} clearable={false} ariaLabel="Valor"
                options={[{ value: 'si', label: 'Sí' }, { value: 'no', label: 'No' }]}
                onChange={(v) => onChange(v === 'si')} />
        );
    }
    if (pregunta.opciones) {
        return (
            <LiquidSelect value={valor} clearable={false} ariaLabel="Opción"
                options={pregunta.opciones.map((o) => ({ value: o.id, label: o.texto || '(sin texto)' }))}
                onChange={(v) => v && onChange(v)} />
        );
    }
    const max = pregunta.tipo === 'nps' ? 10 : pregunta.tipo === 'numero' ? 9999 : 5;
    const min = pregunta.tipo === 'nps' ? 0 : 1;
    return (
        <LiquidSelect value={String(valor)} clearable={false} ariaLabel="Valor"
            options={max <= 10 ? Array.from({ length: max - min + 1 }, (_, i) => ({ value: String(i + min), label: String(i + min) }))
                : [{ value: String(valor), label: String(valor) }]}
            creatable={max > 10} onCreateOption={(t) => onChange(Number(t) || 0)}
            onChange={(v) => v !== '' && onChange(Number(v))} />
    );
}
