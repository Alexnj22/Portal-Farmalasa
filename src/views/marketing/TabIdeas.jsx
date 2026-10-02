import React, { useMemo, useState } from 'react';
import {
    Lightbulb, Plus, Hand, Sparkles, Link2, XCircle, RotateCcw, Pencil, Trash2, Undo2, ArrowUpRight, Check,
} from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import LiquidSelect from '../../components/common/LiquidSelect';
import LiquidModal from '../../components/common/LiquidModal';
import PieDeModal from '../../components/common/PieDeModal';
import ConfirmModal from '../../components/common/ConfirmModal';
import { EmptyState } from '../../components/common/StateViews';
import Campo from '../promociones/Campo';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaHora12 } from '@nucleo/utils/hora';
import { fechaTexto, etiquetaMes } from '@nucleo/utils/fecha';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { FORMATOS, formatoDe } from '@nucleo/utils/marketing';
import { crearIdea, editarIdea, quitarIdea, moverIdea } from '@nucleo/data/marketing';
import { ICONOS_FORMATO, ICONO_DESCONOCIDO, puntoDeMarca } from './iconos';
import { Quien } from './Historial';

const ESTADO_IDEA = {
    nueva:      { label: 'Nueva',      variant: 'chart-3', tono: undefined },
    en_trabajo: { label: 'En trabajo', variant: 'info',    tono: 'brand' },
    usada:      { label: 'Usada',      variant: 'success', tono: 'success' },
    descartada: { label: 'Descartada', variant: 'neutral', tono: undefined },
};

const VISTAS = [
    { value: 'abiertas',   label: 'Abiertas',    pasa: (i) => i.estado === 'nueva' || i.estado === 'en_trabajo' },
    { value: 'usada',      label: 'Usadas',      pasa: (i) => i.estado === 'usada' },
    { value: 'descartada', label: 'Descartadas', pasa: (i) => i.estado === 'descartada' },
    { value: 'todas',      label: 'Todas',       pasa: () => true },
];

const VACIA = { titulo: '', detalle: '', marca_id: '', formato: '' };

/**
 * El banco de ideas. Cualquiera con acceso deja una, y queda quién y a qué
 * hora. Quien diseña la toma («en trabajo») y la resuelve: la convierte en una
 * pieza nueva, la liga a una que ya existe, o la descarta con su motivo. Cada
 * paso queda en la tarjeta con su foto, su nombre y su hora.
 */
export default function TabIdeas({
    ideas, personas, marcas, piezasDelMes, mes, yoId, puedeEditar, puedeAprobar, busqueda, onCambio, onConvertir, onAbrirPieza,
}) {
    const showToast = useToastStore((s) => s.showToast);
    const [vista, setVista] = useState('abiertas');
    const [form, setForm] = useState(VACIA);
    const [guardando, setGuardando] = useState(false);
    const [cerrando, setCerrando] = useState(null);   // { idea, modo: 'usada' | 'descartada' }
    const [quitando, setQuitando] = useState(null);
    const gestiona = puedeEditar || puedeAprobar;

    const opcionesMarca = marcas.filter((m) => m.activo).map((m) => ({ value: m.id, label: m.nombre, punto: puntoDeMarca(m.color) }));
    const opcionesFormato = FORMATOS.map((f) => ({ value: f.value, label: f.label }));

    const cuenta = useMemo(() => Object.fromEntries(VISTAS.map((v) => [v.value, ideas.filter(v.pasa).length])), [ideas]);
    const visibles = useMemo(() => {
        const v = VISTAS.find((x) => x.value === vista) || VISTAS[0];
        return ideas.filter(v.pasa).filter((i) => !busqueda || tokenMatch(busqueda, `${i.titulo} ${i.detalle || ''}`));
    }, [ideas, vista, busqueda]);

    const fallo = (t) => (err) => showToast(t, mensajeAmigable(err, 'Intenta de nuevo.'), 'error');

    const agregar = async () => {
        if (!form.titulo.trim()) return;
        setGuardando(true);
        try {
            await crearIdea(form, yoId);
            setForm(VACIA);
            setVista('abiertas');
            showToast('Idea guardada', 'Quien diseña ya la puede ver.', 'success');
            onCambio?.();
        } catch (err) {
            fallo('No se pudo guardar la idea')(err);
        } finally {
            setGuardando(false);
        }
    };

    const mover = async (idea, estado) => {
        try {
            await moverIdea(idea.id, estado);
            onCambio?.();
        } catch (err) {
            fallo('No se pudo mover la idea')(err);
        }
    };

    const quitar = async () => {
        try {
            await quitarIdea(quitando.id);
            setQuitando(null);
            onCambio?.();
        } catch (err) {
            setQuitando(null);
            fallo('No se pudo quitar')(err);
        }
    };

    const chip = (activo) => `shrink-0 flex items-center gap-1.5 rounded-full border px-3 min-h-[var(--tap-min)] md:min-h-0 md:py-1.5
        text-label font-semibold transition-colors active:scale-[0.97]
        ${activo ? 'border-brand bg-brand/10 text-content' : 'border-border-card text-content-2 hover:bg-surface-card-hover'}`;

    return (
        <div className="space-y-5">
            <section data-surface="card" className="p-4 md:p-5 space-y-4">
                <header className="flex items-start gap-3">
                    <span className="w-9 h-9 rounded-xl bg-chart-8/15 text-chart-8-text flex items-center justify-center shrink-0">
                        <Lightbulb size={18} aria-hidden />
                    </span>
                    <div className="min-w-0">
                        <h3 className="text-body font-semibold text-content">Deja una idea</h3>
                        <p className="text-caption text-content-3">
                            Un tema, una campaña, algo que viste en la sala. Quien diseña la toma y la convierte en publicación.
                        </p>
                    </div>
                </header>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
                    <PortalInput label="Idea" name="idea_titulo" value={form.titulo} required
                        onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))}
                        placeholder="Ej. Reel: cómo leer la etiqueta de un medicamento" />
                    <Campo rotulo="Marca">
                        <LiquidSelect value={form.marca_id} options={opcionesMarca} placeholder="Cualquiera"
                            onChange={(v) => setForm((f) => ({ ...f, marca_id: v || '' }))} />
                    </Campo>
                    <Campo rotulo="Formato">
                        <LiquidSelect value={form.formato} options={opcionesFormato} placeholder="El que convenga"
                            onChange={(v) => setForm((f) => ({ ...f, formato: v || '' }))} />
                    </Campo>
                </div>
                <PortalTextarea label="Detalle (opcional)" name="idea_detalle" value={form.detalle} rows={2}
                    onChange={(e) => setForm((f) => ({ ...f, detalle: e.target.value }))}
                    placeholder="Para qué, a quién, una referencia, el producto…" />
                <div className="flex justify-end">
                    <Button icon={Plus} loading={guardando} disabled={!form.titulo.trim()} onClick={agregar}>Agregar idea</Button>
                </div>
            </section>

            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide -mx-1 px-1" role="group" aria-label="Qué ideas ver">
                {VISTAS.map((v) => (
                    <button key={v.value} type="button" className={chip(vista === v.value)} aria-pressed={vista === v.value}
                        onClick={() => setVista(v.value)}>
                        {v.label} <span className="tabular-nums text-content-3">{cuenta[v.value]}</span>
                    </button>
                ))}
            </div>

            {visibles.length === 0 ? (
                <EmptyState icon={Lightbulb} title={busqueda ? 'Sin ideas que coincidan' : 'Sin ideas aquí'}
                    subtitle={vista === 'abiertas' ? 'Las ideas nuevas y las que están en trabajo aparecen aquí.' : undefined} />
            ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {visibles.map((i) => (
                        <TarjetaDeIdea key={i.id} idea={i} personas={personas} marcas={marcas} yoId={yoId}
                            gestiona={gestiona} puedeEditar={puedeEditar} opcionesMarca={opcionesMarca} opcionesFormato={opcionesFormato}
                            onMover={mover} onCerrar={(modo) => setCerrando({ idea: i, modo })} onQuitar={() => setQuitando(i)}
                            onConvertir={() => onConvertir(i)} onAbrirPieza={onAbrirPieza} onCambio={onCambio} fallo={fallo} />
                    ))}
                </div>
            )}

            {cerrando && (
                <CerrarIdeaModal key={cerrando.idea.id + cerrando.modo} {...cerrando} piezas={piezasDelMes} mes={mes}
                    onClose={() => setCerrando(null)} onListo={() => { setCerrando(null); onCambio?.(); }} fallo={fallo} />
            )}
            <ConfirmModal isOpen={!!quitando} onClose={() => setQuitando(null)} onConfirm={quitar}
                title="¿Quitar la idea?" message="Se borra para todos." confirmText="Quitar" />
        </div>
    );
}

function TarjetaDeIdea({
    idea, personas, marcas, yoId, gestiona, puedeEditar, opcionesMarca, opcionesFormato,
    onMover, onCerrar, onQuitar, onConvertir, onAbrirPieza, onCambio, fallo,
}) {
    const [editando, setEditando] = useState(false);
    const [borrador, setBorrador] = useState(() => ({
        titulo: idea.titulo, detalle: idea.detalle || '', marca_id: idea.marca_id || '', formato: idea.formato || '',
    }));
    const [guardando, setGuardando] = useState(false);
    const est = ESTADO_IDEA[idea.estado] || ESTADO_IDEA.nueva;
    const marca = marcas.find((m) => m.id === idea.marca_id);
    const formato = idea.formato ? formatoDe(idea.formato) : null;
    const IconoFormato = formato ? (ICONOS_FORMATO[formato.icono] || ICONO_DESCONOCIDO) : null;
    const mia = idea.autor_id === yoId;
    const abierta = idea.estado === 'nueva' || idea.estado === 'en_trabajo';

    const guardar = async () => {
        if (!borrador.titulo.trim()) return;
        setGuardando(true);
        try {
            await editarIdea(idea.id, borrador);
            setEditando(false);
            onCambio?.();
        } catch (err) {
            fallo('No se pudo corregir')(err);
        } finally {
            setGuardando(false);
        }
    };

    return (
        <article data-surface="card" data-tono={est.tono} className={`p-4 flex flex-col gap-3 ${idea.estado === 'descartada' ? 'opacity-70' : ''}`}>
            <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={est.variant} size="sm">{est.label}</Badge>
                {marca && (
                    <span className="flex items-center gap-1 text-micro text-content-2">
                        <span className={`w-2 h-2 rounded-full ${puntoDeMarca(marca.color)}`} aria-hidden />{marca.nombre}
                    </span>
                )}
                {formato && (
                    <span className="flex items-center gap-1 text-micro text-content-2">
                        <IconoFormato size={12} aria-hidden />{formato.label}
                    </span>
                )}
            </div>

            {editando ? (
                <div className="space-y-3">
                    <PortalInput label="Idea" name={`idea_${idea.id}`} value={borrador.titulo} required
                        onChange={(e) => setBorrador((b) => ({ ...b, titulo: e.target.value }))} />
                    <div className="grid grid-cols-2 gap-2">
                        <Campo rotulo="Marca">
                            <LiquidSelect value={borrador.marca_id} options={opcionesMarca} placeholder="Cualquiera"
                                onChange={(v) => setBorrador((b) => ({ ...b, marca_id: v || '' }))} />
                        </Campo>
                        <Campo rotulo="Formato">
                            <LiquidSelect value={borrador.formato} options={opcionesFormato} placeholder="El que convenga"
                                onChange={(v) => setBorrador((b) => ({ ...b, formato: v || '' }))} />
                        </Campo>
                    </div>
                    <PortalTextarea label="Detalle" name={`detalle_${idea.id}`} value={borrador.detalle} rows={2}
                        onChange={(e) => setBorrador((b) => ({ ...b, detalle: e.target.value }))} />
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setEditando(false)}>Cancelar</Button>
                        <Button size="sm" icon={Check} loading={guardando} disabled={!borrador.titulo.trim()} onClick={guardar}>Guardar</Button>
                    </div>
                </div>
            ) : (
                <div className="space-y-1">
                    <h4 className={`text-body font-semibold text-content break-words ${idea.estado === 'descartada' ? 'line-through' : ''}`}>
                        {idea.titulo}
                    </h4>
                    {idea.detalle && <p className="text-body-sm text-content-2 whitespace-pre-wrap break-words">{idea.detalle}</p>}
                </div>
            )}

            {/* Quién y cuándo, cada paso. */}
            <ol className="space-y-1.5 rounded-xl bg-surface-card-hover px-3 py-2.5">
                <Paso rotulo="Propuesta" id={idea.autor_id} cuando={idea.created_at} personas={personas} />
                {idea.tomada_at && <Paso rotulo="En trabajo" id={idea.tomada_por} cuando={idea.tomada_at} personas={personas} />}
                {idea.estado === 'usada' && (
                    <Paso rotulo="Usada" id={idea.cerrada_por} cuando={idea.cerrada_at} personas={personas} />
                )}
                {idea.estado === 'descartada' && (
                    <Paso rotulo="Descartada" id={idea.cerrada_por} cuando={idea.cerrada_at} personas={personas} />
                )}
            </ol>

            {idea.estado === 'usada' && idea.pieza && (
                <button type="button" onClick={() => onAbrirPieza(idea.pieza)}
                    className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 px-3 min-h-[var(--tap-min)] text-left active:scale-[0.97]">
                    <Link2 size={14} className="text-success-text shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1">
                        <span className="block text-label font-semibold text-content truncate">{idea.pieza.titulo}</span>
                        <span className="block text-micro text-content-3">
                            {fechaTexto(idea.pieza.fecha, { weekday: 'short', day: 'numeric', month: 'short' })}
                        </span>
                    </span>
                    <ArrowUpRight size={14} className="text-content-3 shrink-0" aria-hidden />
                </button>
            )}
            {idea.nota_cierre && <p className="text-caption text-content-2 italic">«{idea.nota_cierre}»</p>}

            {!editando && (
                <div className="flex items-center gap-1 flex-wrap mt-auto pt-1 -ml-1.5">
                    {gestiona && idea.estado === 'nueva' && (
                        <Button variant="secondary" size="sm" icon={Hand} onClick={() => onMover(idea, 'en_trabajo')}>Tomarla</Button>
                    )}
                    {gestiona && abierta && puedeEditar && (
                        <Button size="sm" icon={Sparkles} onClick={onConvertir}>Crear pieza</Button>
                    )}
                    {gestiona && abierta && (
                        <Button variant="ghost" size="sm" icon={Link2} onClick={() => onCerrar('usada')}>Ligar a pieza</Button>
                    )}
                    {gestiona && idea.estado === 'en_trabajo' && (
                        <Button variant="ghost" size="sm" icon={Undo2} onClick={() => onMover(idea, 'nueva')}>Soltarla</Button>
                    )}
                    {gestiona && abierta && (
                        <Button variant="ghost" size="sm" icon={XCircle} onClick={() => onCerrar('descartada')}>Descartar</Button>
                    )}
                    {gestiona && !abierta && (
                        <Button variant="ghost" size="sm" icon={RotateCcw} onClick={() => onMover(idea, 'nueva')}>Reabrir</Button>
                    )}
                    {mia && idea.estado === 'nueva' && (
                        <>
                            <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setEditando(true)}>Editar</Button>
                            <Button variant="ghost" size="sm" icon={Trash2} onClick={onQuitar}>Quitar</Button>
                        </>
                    )}
                </div>
            )}
        </article>
    );
}

function Paso({ rotulo, id, cuando, personas }) {
    return (
        <li className="flex items-center gap-2 min-w-0">
            <span className="w-[74px] shrink-0 text-micro uppercase tracking-wide font-semibold text-content-3">{rotulo}</span>
            <span className="min-w-0 flex-1"><Quien id={id} personas={personas} px={18} /></span>
            <span className="text-micro text-content-3 shrink-0 tabular-nums">
                {cuando ? fechaHora12(cuando, { day: 'numeric', month: 'short' }) : ''}
            </span>
        </li>
    );
}

/** Ligar la idea a una pieza del mes, o descartarla; las dos con nota. */
function CerrarIdeaModal({ idea, modo, piezas, mes, onClose, onListo, fallo }) {
    const [piezaId, setPiezaId] = useState('');
    const [nota, setNota] = useState('');
    const [guardando, setGuardando] = useState(false);
    const usar = modo === 'usada';
    const opciones = (piezas || []).map((p) => ({
        value: p.id, label: `${fechaTexto(p.fecha, { day: 'numeric', month: 'short' })} · ${p.titulo}`,
    }));
    const listo = async () => {
        setGuardando(true);
        try {
            await moverIdea(idea.id, modo, { piezaId: usar ? piezaId : null, nota });
            onListo();
        } catch (err) {
            fallo('No se pudo guardar')(err);
        } finally {
            setGuardando(false);
        }
    };
    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-md" ariaLabel={usar ? 'Ligar idea a una pieza' : 'Descartar idea'}>
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">{usar ? 'Ligar a una pieza' : 'Descartar la idea'}</h2>
                <p className="text-caption text-content-3 truncate">«{idea.titulo}»</p>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-3">
                    {usar && (
                        <Campo rotulo={`Pieza de ${mes ? etiquetaMes(mes).toLowerCase() : 'este mes'}`} falta>
                            {opciones.length ? (
                                <LiquidSelect value={piezaId} options={opciones} placeholder="Elige la pieza" onChange={(v) => setPiezaId(v || '')} />
                            ) : (
                                <p className="text-body-sm text-content-3">Este mes no tiene piezas. Cambia de mes arriba o crea la pieza desde la idea.</p>
                            )}
                        </Campo>
                    )}
                    <PortalTextarea label={usar ? 'Nota (opcional)' : 'Por qué (opcional)'} name="nota_idea" value={nota}
                        onChange={(e) => setNota(e.target.value)} rows={2}
                        placeholder={usar ? 'Cómo se usó…' : 'Ya se hizo, no aplica, fuera de temporada…'} />
                    <p className="text-caption text-content-3">Quien la propuso recibe un aviso.</p>
                </div>
            </LiquidModal.Body>
            <PieDeModal>
                <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                <Button icon={usar ? Link2 : XCircle} variant={usar ? 'primary' : 'destructive'} loading={guardando}
                    disabled={usar && !piezaId} onClick={listo}>
                    {usar ? 'Ligar' : 'Descartar'}
                </Button>
            </PieDeModal>
        </LiquidModal>
    );
}
