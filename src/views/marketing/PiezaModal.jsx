import React, { useCallback, useMemo, useState } from 'react';
import { Check, Trash2, MessageSquare, AlertTriangle, ThumbsUp, PencilLine, Megaphone, Link2, Send, EyeOff } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import LiquidSelect from '../../components/common/LiquidSelect';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import TimePicker12 from '../../components/common/TimePicker12';
import Checkbox from '../../components/common/Checkbox';
import FileField from '../../components/common/FileField';
import ConfirmModal from '../../components/common/ConfirmModal';
import AvisoDeBorrador from '../../components/common/AvisoDeBorrador';
import Campo from '../promociones/Campo';
import useBorrador from '@nucleo/hooks/useBorrador';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { rangoDelMes, fechaTexto } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import {
    FORMATOS, PILARES, ESTADOS_PIEZA, ESTADOS_DEL_DISENADOR, estadoDe, objetivoDe,
} from '@nucleo/utils/marketing';
import {
    guardarPieza, borrarPieza, subirDiseno, agregarEnlace, quitarArchivo, revisarPieza,
} from '@nucleo/data/marketing';
import { abrirEnPestanaNueva } from '@plataforma/descargas';
import Disenos from './Disenos';
import Conversacion from './Conversacion';

const VACIA = {
    marca_id: '', fecha: '', hora: '', formato: 'post', redes: [], pilar: '', titulo: '',
    copy: '', hashtags: '', notas: '', estado: 'pendiente', pautar: false, enlace_publicado: '',
};

/**
 * Se monta FRESCO por pieza (la vista le pone `key`): el formulario nace de la
 * fila y no se resincroniza cuando la vista recarga —eso pisaría lo que se está
 * escribiendo—, mientras los diseños y comentarios sí llegan nuevos por props.
 *
 * Una pieza del calendario: qué se publica, cuándo y dónde; sus diseños; y la
 * conversación de la revisión.
 *
 * Quien edita (el diseñador) ve el formulario y sube los diseños. Quien sólo
 * mira ve la ficha y comenta. Quien aprueba, además, aprueba o pide cambios —
 * eso lo decide la base (`marketing_revisar_pieza`), no este botón.
 */
export default function PiezaModal({
    open, onClose, mes, pieza, fechaInicial, catalogos, personas, comentarios, firmadas,
    puedeEditar, puedeAprobar, yoId, onCambio, onEditarPauta,
}) {
    const showToast = useToastStore((s) => s.showToast);
    const esNueva = !pieza?.id;
    const [form, setForm] = useState(() => {
        const activas = catalogos.marcas.filter((m) => m.activo);
        const marcaUnica = activas.length === 1 ? activas[0].id : '';
        return pieza?.id
            ? { ...VACIA, ...pieza, hora: pieza.hora || '', marca_id: pieza.marca_id ?? '' }
            : { ...VACIA, marca_id: marcaUnica, fecha: fechaInicial || '', ...(pieza || {}) };
    });
    const [guardando, setGuardando] = useState(false);
    const [subiendo, setSubiendo] = useState(false);
    const [enlace, setEnlace] = useState('');
    const [borrando, setBorrando] = useState(false);
    const [decision, setDecision] = useState(null);   // 'cambios' mientras se escribe el pedido
    const [textoCambio, setTextoCambio] = useState('');
    const [decidiendo, setDecidiendo] = useState(false);

    // Borrador sólo de una pieza NUEVA: al editar una ya guardada, la fila de la
    // base es la verdad y un borrador viejo la pisaría.
    const { recuperado, cuando, descartar, hayBorrador } = useBorrador(
        esNueva && puedeEditar ? `marketing_pieza_${mes?.id}` : null, form, { activo: open && esNueva });
    const reponer = useCallback(() => {
        if (!recuperado) return;
        setForm({ ...VACIA, ...recuperado });
        descartar();
    }, [recuperado, descartar]);

    const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }));
    const [desde, hasta] = mes ? rangoDelMes(mes.mes) : [undefined, undefined];

    const opcionesMarca = catalogos.marcas
        .filter((m) => m.activo || m.id === form.marca_id)
        .map((m) => ({ value: m.id, label: m.nombre }));
    const redesVisibles = catalogos.redes.filter((r) => r.activo || form.redes?.includes(r.clave));

    // El diseñador mueve su flujo; `aprobado` sólo lo pone quien revisa, y
    // `publicado` sólo tiene sentido después de aprobada.
    const opcionesEstado = ESTADOS_PIEZA
        .filter((e) => ESTADOS_DEL_DISENADOR.includes(e.value)
            || e.value === form.estado
            || (e.value === 'publicado' && ['aprobado', 'publicado'].includes(pieza?.estado)))
        .map((e) => ({ value: e.value, label: e.label }));

    const falta = !form.titulo?.trim() || !form.fecha || !form.marca_id || !form.formato;

    const guardar = async () => {
        if (falta) return;
        setGuardando(true);
        try {
            const datos = { ...form, hora: form.hora || null, pilar: form.pilar || null };
            if (datos.estado === 'publicado' && !pieza?.publicado_en) datos.publicado_en = new Date().toISOString();
            await guardarPieza(mes.id, datos);
            descartar();
            showToast(esNueva ? 'Pieza agregada' : 'Pieza guardada', form.titulo, 'success');
            onCambio?.();
            onClose();
        } catch (err) {
            showToast('No se pudo guardar la pieza', mensajeAmigable(err, 'Revisa los datos e intenta de nuevo.'), 'error');
        } finally {
            setGuardando(false);
        }
    };

    const subir = async (archivo) => {
        if (!archivo || !pieza?.id) return;
        setSubiendo(true);
        try {
            await subirDiseno({ mesId: mes.id, piezaId: pieza.id, archivo, orden: pieza.archivos?.length || 0, subidoPor: yoId });
            showToast('Diseño agregado', archivo.name, 'success');
            onCambio?.();
        } catch (err) {
            showToast('No se pudo subir el diseño', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setSubiendo(false);
        }
    };

    const agregar = async () => {
        if (!/^https?:\/\//i.test(enlace.trim())) {
            showToast('Enlace no válido', 'Pega el enlace completo, que empiece con https://', 'error');
            return;
        }
        try {
            await agregarEnlace({ piezaId: pieza.id, enlace, orden: pieza.archivos?.length || 0, subidoPor: yoId });
            setEnlace('');
            onCambio?.();
        } catch (err) {
            showToast('No se pudo agregar el enlace', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        }
    };

    const quitar = async (archivo) => {
        try {
            await quitarArchivo(archivo);
            onCambio?.();
        } catch (err) {
            showToast('No se pudo quitar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        }
    };

    const borrar = async () => {
        setGuardando(true);
        try {
            await borrarPieza(pieza.id, pieza.titulo, pieza.archivos || []);
            showToast('Pieza quitada', pieza.titulo, 'success');
            setBorrando(false);
            onCambio?.();
            onClose();
        } catch (err) {
            showToast('No se pudo quitar la pieza', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setGuardando(false);
        }
    };

    const decidir = async (tipo) => {
        if (tipo === 'cambios' && !textoCambio.trim()) return;
        setDecidiendo(true);
        try {
            await revisarPieza(pieza.id, tipo, tipo === 'cambios' ? textoCambio : null);
            showToast(tipo === 'aprobar' ? 'Pieza aprobada' : 'Cambios pedidos', pieza.titulo, 'success');
            setDecision(null);
            setTextoCambio('');
            onCambio?.();
        } catch (err) {
            showToast('No se pudo registrar la revisión', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setDecidiendo(false);
        }
    };

    const publicado = !!mes?.publicado_at;
    const archivos = pieza?.archivos || [];
    const misComentarios = useMemo(
        () => (comentarios || []).filter((c) => c.pieza_id === pieza?.id),
        [comentarios, pieza?.id]);
    const puedeRevisar = puedeAprobar && publicado && pieza?.id
        && ['finalizado', 'cambios', 'aprobado'].includes(pieza.estado);
    const est = estadoDe(pieza?.estado || form.estado);

    if (!open) return null;

    return (
        <>
            <LiquidModal open={open} onClose={onClose} maxWidth="max-w-4xl"
                ariaLabel={esNueva ? 'Nueva pieza' : `Pieza ${pieza.titulo}`}>
                <LiquidModal.Header>
                    <div className="flex items-center gap-2 min-w-0">
                        <h2 className="text-body-xl font-semibold text-content truncate">
                            {esNueva ? 'Nueva pieza' : pieza.titulo}
                        </h2>
                        {!esNueva && <Badge variant={est.variant} size="sm">{est.label}</Badge>}
                    </div>
                </LiquidModal.Header>
                <LiquidModal.Body>
                    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
                        {/* ── Los datos de la pieza ── */}
                        <div className="space-y-4 min-w-0">
                            {hayBorrador && <AvisoDeBorrador cuando={cuando} onRecuperar={reponer} onDescartar={descartar} />}
                            {puedeEditar ? (
                                <>
                                    <PortalInput label="Título" name="titulo" value={form.titulo} onChange={set('titulo')}
                                        placeholder="Ej. Reel: 3 tips para el resfriado" required />
                                    <div className="grid grid-cols-2 gap-3">
                                        <Campo rotulo="Marca" falta>
                                            <LiquidSelect value={form.marca_id} onChange={set('marca_id')} options={opcionesMarca}
                                                placeholder="Marca" clearable={false} />
                                        </Campo>
                                        <Campo rotulo="Formato" falta>
                                            <LiquidSelect value={form.formato} onChange={set('formato')} clearable={false}
                                                options={FORMATOS.map((f) => ({ value: f.value, label: f.label }))} />
                                        </Campo>
                                        <Campo rotulo="Fecha" falta>
                                            <LiquidDatePicker value={form.fecha} onChange={set('fecha')} min={desde} max={hasta} />
                                        </Campo>
                                        <Campo rotulo="Hora">
                                            <TimePicker12 value={form.hora} onChange={set('hora')} />
                                        </Campo>
                                        <Campo rotulo="Pilar">
                                            <LiquidSelect value={form.pilar} onChange={set('pilar')} placeholder="De qué habla"
                                                options={PILARES.map((p) => ({ value: p.value, label: p.label }))} />
                                        </Campo>
                                        <Campo rotulo="Estado">
                                            <LiquidSelect value={form.estado} onChange={set('estado')} options={opcionesEstado} clearable={false} />
                                        </Campo>
                                    </div>
                                    <Campo rotulo="Redes">
                                        <div className="flex flex-wrap gap-x-4 gap-y-2">
                                            {redesVisibles.map((r) => (
                                                <Checkbox key={r.clave} label={r.nombre} checked={form.redes?.includes(r.clave)}
                                                    onChange={(on) => setForm((f) => ({
                                                        ...f,
                                                        redes: (on?.target ? on.target.checked : on)
                                                            ? [...new Set([...(f.redes || []), r.clave])]
                                                            : (f.redes || []).filter((x) => x !== r.clave),
                                                    }))} />
                                            ))}
                                        </div>
                                    </Campo>
                                    <PortalTextarea label="Texto de la publicación (copy)" name="copy" value={form.copy || ''}
                                        onChange={set('copy')} rows={4} placeholder="Lo que va en la descripción del post" />
                                    <PortalInput label="Hashtags" name="hashtags" value={form.hashtags || ''} onChange={set('hashtags')}
                                        placeholder="#Salud #Farmacia" />
                                    <PortalTextarea label="Notas para el diseño" name="notas" value={form.notas || ''}
                                        onChange={set('notas')} rows={2} placeholder="Referencias, producto, precio, colores…" />
                                    {form.estado === 'publicado' && (
                                        <PortalInput label="Enlace de la publicación" name="enlace_publicado"
                                            value={form.enlace_publicado || ''} onChange={set('enlace_publicado')}
                                            placeholder="https://www.instagram.com/p/…" />
                                    )}
                                    <Checkbox label="Se pautará" description="Aparece en la pestaña Pauta para planificar la inversión"
                                        checked={!!form.pautar} onChange={(on) => setForm((f) => ({ ...f, pautar: on?.target ? on.target.checked : on }))} />
                                </>
                            ) : (
                                <FichaDeLectura pieza={pieza} catalogos={catalogos} />
                            )}

                            {!esNueva && pieza.pautar && (
                                <div data-surface="card" className="p-3 space-y-1">
                                    <div className="flex items-center gap-2">
                                        <Megaphone size={14} className="text-content-3" />
                                        <span className="text-label uppercase tracking-wide font-semibold text-content-2">Pauta</span>
                                        {puedeEditar && onEditarPauta && (
                                            <Button variant="ghost" size="xs" className="ml-auto" onClick={() => onEditarPauta(pieza)}>
                                                {pieza.pauta ? 'Editar' : 'Planificar'}
                                            </Button>
                                        )}
                                    </div>
                                    {pieza.pauta ? (
                                        <p className="text-body-sm text-content-2">
                                            {formatMoney(pieza.pauta.presupuesto)} · {objetivoDe(pieza.pauta.objetivo).label}
                                            {pieza.pauta.gastado != null && <> · gastado {formatMoney(pieza.pauta.gastado)}</>}
                                        </p>
                                    ) : (
                                        <p className="text-body-sm text-content-3">Sin presupuesto asignado</p>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* ── Diseños y revisión ── */}
                        <div className="space-y-4 min-w-0">
                            <section className="space-y-2">
                                <h3 className="text-label uppercase tracking-wide font-semibold text-content-2">Diseños</h3>
                                {esNueva ? (
                                    <p className="text-body-sm text-content-3">Guarda la pieza para poder subir sus diseños.</p>
                                ) : (
                                    <>
                                        {!archivos.length && !puedeEditar && !publicado && (
                                            <Notice icon={EyeOff} compact>
                                                Los diseños se ven cuando el diseñador envíe el mes a revisión.
                                            </Notice>
                                        )}
                                        {!archivos.length && (puedeEditar || publicado) && (
                                            <p className="text-body-sm text-content-3">Sin diseños todavía.</p>
                                        )}
                                        <Disenos archivos={archivos} firmadas={firmadas} onQuitar={puedeEditar ? quitar : undefined} />
                                        {puedeEditar && (
                                            <>
                                                <FileField label="Subir imagen o video" accept="image/*,video/*,.pdf" maxSizeMB={200}
                                                    file={null} onChange={subir} busy={subiendo} busyLabel="Subiendo diseño…"
                                                    conEditor={false} conTelefono={false} />
                                                <div className="flex items-end gap-2">
                                                    <div className="flex-1 min-w-0">
                                                        <PortalInput label="O pega un enlace (Drive, Canva)" name="enlace" value={enlace}
                                                            onChange={(e) => setEnlace(e.target.value)} placeholder="https://…" />
                                                    </div>
                                                    <Button variant="secondary" icon={Link2} disabled={!enlace.trim()} onClick={agregar}>
                                                        Agregar
                                                    </Button>
                                                </div>
                                                {pieza.estado === 'aprobado' && (
                                                    <p className="text-caption text-content-3">
                                                        Cambiar el diseño o el texto de una pieza aprobada la devuelve a revisión.
                                                    </p>
                                                )}
                                            </>
                                        )}
                                    </>
                                )}
                            </section>

                            {puedeRevisar && (
                                <section className="space-y-2">
                                    <h3 className="text-label uppercase tracking-wide font-semibold text-content-2">Revisión</h3>
                                    {decision === 'cambios' ? (
                                        <div className="space-y-2">
                                            <PortalTextarea label="¿Qué hay que cambiar?" name="cambio" value={textoCambio}
                                                onChange={(e) => setTextoCambio(e.target.value)} rows={3}
                                                placeholder="Sé específico: texto, colores, producto, fecha…" />
                                            <div className="flex justify-end gap-2">
                                                <Button variant="secondary" onClick={() => setDecision(null)}>Cancelar</Button>
                                                <Button icon={Send} tone="warning" loading={decidiendo}
                                                    disabled={!textoCambio.trim()} onClick={() => decidir('cambios')}>
                                                    Pedir cambios
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex flex-wrap gap-2">
                                            {pieza.estado !== 'aprobado' && (
                                                <Button icon={ThumbsUp} tone="success" loading={decidiendo} onClick={() => decidir('aprobar')}>
                                                    Aprobar
                                                </Button>
                                            )}
                                            <Button variant="secondary" icon={PencilLine} onClick={() => setDecision('cambios')}>
                                                Pedir cambios
                                            </Button>
                                        </div>
                                    )}
                                </section>
                            )}

                            {!esNueva && (
                                <section className="space-y-2">
                                    <h3 className="text-label uppercase tracking-wide font-semibold text-content-2 flex items-center gap-1.5">
                                        <MessageSquare size={13} /> Comentarios
                                    </h3>
                                    <Conversacion comentarios={misComentarios} personas={personas}
                                        mesId={mes.id} piezaId={pieza.id} yoId={yoId}
                                        puedeResolver={puedeEditar || puedeAprobar} onCambio={onCambio} />
                                </section>
                            )}
                        </div>
                    </div>
                </LiquidModal.Body>
                <LiquidModal.Footer>
                    {!esNueva && puedeEditar && ['pendiente', 'en_proceso'].includes(pieza.estado) && (
                        <Button variant="ghost" icon={Trash2} onClick={() => setBorrando(true)} className="mr-auto">Quitar</Button>
                    )}
                    {!esNueva && pieza.estado === 'cambios' && (
                        <span className="text-caption text-warning flex items-center gap-1 mr-auto">
                            <AlertTriangle size={13} /> Con cambios pedidos
                        </span>
                    )}
                    <Button variant="secondary" onClick={onClose}>{puedeEditar ? 'Cancelar' : 'Cerrar'}</Button>
                    {puedeEditar && (
                        <Button icon={Check} loading={guardando} disabled={falta} onClick={guardar}>
                            {esNueva ? 'Agregar' : 'Guardar'}
                        </Button>
                    )}
                </LiquidModal.Footer>
            </LiquidModal>

            <ConfirmModal isOpen={borrando} onClose={() => setBorrando(false)} onConfirm={borrar}
                title="¿Quitar esta pieza?" message={`«${pieza?.titulo}» sale del calendario con sus diseños y comentarios.`}
                confirmText="Quitar" isProcessing={guardando} />
        </>
    );
}

/** La pieza para quien no la edita: lo mismo que el formulario, sin controles. */
function FichaDeLectura({ pieza, catalogos }) {
    if (!pieza) return null;
    const marca = catalogos.marcas.find((m) => m.id === pieza.marca_id);
    const redes = (pieza.redes || []).map((c) => catalogos.redes.find((r) => r.clave === c)?.nombre || c);
    const filas = [
        ['Marca', marca?.nombre],
        ['Fecha', [fechaTexto(pieza.fecha, { weekday: 'long', day: 'numeric', month: 'long' }), hora12(pieza.hora)].filter(Boolean).join(' · ')],
        ['Formato', FORMATOS.find((f) => f.value === pieza.formato)?.label],
        ['Pilar', PILARES.find((p) => p.value === pieza.pilar)?.label],
        ['Redes', redes.join(', ')],
    ].filter(([, v]) => v);
    return (
        <div className="space-y-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-body-sm">
                {filas.map(([k, v]) => (
                    <React.Fragment key={k}>
                        <dt className="text-content-3">{k}</dt>
                        <dd className="text-content">{v}</dd>
                    </React.Fragment>
                ))}
            </dl>
            {pieza.copy && (
                <div>
                    <p className="text-label uppercase tracking-wide font-semibold text-content-2 mb-1">Copy</p>
                    <p className="text-body-sm text-content whitespace-pre-wrap">{pieza.copy}</p>
                    {pieza.hashtags && <p className="text-body-sm text-brand mt-1">{pieza.hashtags}</p>}
                </div>
            )}
            {pieza.notas && (
                <div>
                    <p className="text-label uppercase tracking-wide font-semibold text-content-2 mb-1">Notas</p>
                    <p className="text-body-sm text-content-2 whitespace-pre-wrap">{pieza.notas}</p>
                </div>
            )}
            {pieza.enlace_publicado && (
                <Button variant="ghost" size="sm" icon={Link2} onClick={() => abrirEnPestanaNueva(pieza.enlace_publicado)}>
                    Ver la publicación
                </Button>
            )}
        </div>
    );
}
