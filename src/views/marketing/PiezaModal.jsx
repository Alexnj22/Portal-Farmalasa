import React, { useCallback, useMemo, useState } from 'react';
import {
    Check, Trash2, MessageSquare, AlertTriangle, ThumbsUp, PencilLine, Megaphone, Link2, Send, EyeOff,
    CalendarCheck, Type, CalendarDays, Share2, Image as ImageIcon, History, ShieldCheck, Tag, X, Paperclip,
} from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import LiquidSelect from '../../components/common/LiquidSelect';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import TimePicker12 from '../../components/common/TimePicker12';
import Switch from '../../components/common/Switch';
import FileField from '../../components/common/FileField';
import SegmentedControl from '../../components/common/SegmentedControl';
import ConfirmModal from '../../components/common/ConfirmModal';
import AvisoDeBorrador from '../../components/common/AvisoDeBorrador';
import Campo from '../promociones/Campo';
import useBorrador from '@nucleo/hooks/useBorrador';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { rangoDelMes, fechaTexto, etiquetaMes } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import {
    FORMATOS, PILARES, ESTADOS_PIEZA, ESTADOS_DEL_DISENADOR, ESTADOS_DE_SALIDA, estadoDe, objetivoDe,
    asignadoEnPauta,
} from '@nucleo/utils/marketing';
import {
    guardarPieza, borrarPieza, subirDiseno, agregarEnlace, quitarArchivo, revisarPieza, moverPieza,
    guardarPauta, quitarPauta,
} from '@nucleo/data/marketing';
import { abrirEnPestanaNueva } from '@plataforma/descargas';
import Disenos from './Disenos';
import PieDeModal from './PieDeModal';
import VistaPrevia from './VistaPrevia';
import EfectoEnVentas from './EfectoEnVentas';
import Conversacion from './Conversacion';
import SeleccionMultiple from './SeleccionMultiple';
import Historial, { Quien } from './Historial';
import { puntoDeMarca } from './iconos';

const VACIA = {
    marcas: [], fecha: '', hora: '', formato: 'post', redes: [], pilar: '', titulo: '', promocion_id: '',
    copy: '', hashtags: '', notas: '', estado: 'pendiente', pautar: false, enlace_publicado: '', monto: '',
};
// Lo que la red muestra antes del «más»: lo importante va antes.
const CORTE_DEL_TEXTO = 125;

/** Un bloque del formulario: ícono, título y su contenido. */
function Bloque({ icon: Icono, titulo, accion, children }) {
    return (
        <section data-surface="card" className="p-4 space-y-3">
            <header className="flex items-center gap-2 min-w-0">
                <Icono size={15} className="text-brand shrink-0" aria-hidden />
                <h3 className="text-label uppercase tracking-wide font-semibold text-content-2 truncate">{titulo}</h3>
                {accion && <div className="ml-auto shrink-0">{accion}</div>}
            </header>
            {children}
        </section>
    );
}

/**
 * Una pieza del calendario: qué se publica, cuándo y dónde; sus diseños; la
 * revisión, el historial y la conversación.
 *
 * Se monta FRESCO por pieza (la vista le pone `key`): el formulario nace de la
 * fila y no se resincroniza cuando la vista recarga —eso pisaría lo que se está
 * escribiendo—, mientras diseños, historial y comentarios sí llegan nuevos.
 *
 * Sólo quien CREÓ la pieza la mueve (estado, día) o la quita: lo vuelve a
 * exigir la base. Una pieza nueva ya acepta diseños y enlaces: se suben al
 * guardarla.
 */
export default function PiezaModal({
    open, onClose, mes, pieza, fechaInicial, catalogos, promociones, personas, comentarios, historial, firmadas,
    piezasDelMes, puedeEditar, puedeAprobar, yoId, esSU, onCambio, onEditarPauta,
}) {
    const showToast = useToastStore((s) => s.showToast);
    const esNueva = !pieza?.id;
    const [form, setForm] = useState(() => {
        const activas = catalogos.marcas.filter((m) => m.activo);
        if (pieza?.id) {
            return {
                ...VACIA, ...pieza, hora: pieza.hora || '', promocion_id: pieza.promocion_id ?? '',
                marcas: pieza.marcas?.length ? pieza.marcas : [pieza.marca_id],
                monto: pieza.pauta?.presupuesto ? String(pieza.pauta.presupuesto) : '',
            };
        }
        return {
            ...VACIA, fecha: fechaInicial || '',
            marcas: pieza?.marca_id ? [pieza.marca_id] : (activas.length === 1 ? [activas[0].id] : []),
            ...(pieza || {}),
        };
    });
    const [pendientes, setPendientes] = useState([]);   // diseños de una pieza nueva, se suben al guardar
    const [guardando, setGuardando] = useState(false);
    const [subiendo, setSubiendo] = useState(false);
    const [enlace, setEnlace] = useState('');
    const [borrando, setBorrando] = useState(false);
    const [decision, setDecision] = useState(null);
    const [textoCambio, setTextoCambio] = useState('');
    const [decidiendo, setDecidiendo] = useState(false);
    const [verPrevia, setVerPrevia] = useState('disenos');

    const { recuperado, cuando, descartar, hayBorrador } = useBorrador(
        esNueva && puedeEditar ? `marketing_pieza_${mes?.id}` : null, form, { activo: open && esNueva });
    const reponer = useCallback(() => {
        if (!recuperado) return;
        setForm({ ...VACIA, ...recuperado });
        descartar();
    }, [recuperado, descartar]);

    const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }));
    const [desde, hasta] = mes ? rangoDelMes(mes.mes) : [undefined, undefined];

    const esCreador = esNueva || !pieza.created_by || pieza.created_by === yoId || esSU;
    const puedeMover = puedeEditar && esCreador;

    const opcionesMarca = catalogos.marcas
        .filter((m) => m.activo || form.marcas.includes(m.id))
        .map((m) => ({ value: m.id, label: m.nombre, punto: puntoDeMarca(m.color) }));
    const opcionesRed = catalogos.redes
        .filter((r) => r.activo || form.redes?.includes(r.clave))
        .map((r) => ({ value: r.clave, label: r.nombre }));
    const despuesDeAprobar = ['aprobado', 'programado', 'publicado'].includes(pieza?.estado);
    const opcionesEstado = ESTADOS_PIEZA
        .filter((e) => ESTADOS_DEL_DISENADOR.includes(e.value)
            || e.value === form.estado
            || (ESTADOS_DE_SALIDA.includes(e.value) && despuesDeAprobar))
        .map((e) => ({ value: e.value, label: e.label }));
    const opcionesPromocion = (promociones || [])
        .filter((p) => p.estado === 'activa' || p.id === form.promocion_id)
        .map((p) => ({ value: p.id, label: p.nombre }));

    // La pauta: el tope lo fija gerencia y el diseñador lo reparte.
    const limite = Number(mes?.presupuesto_pauta) || 0;
    const otros = asignadoEnPauta(piezasDelMes, pieza?.id);
    const monto = Number(form.monto) || 0;
    const disponible = limite - otros - monto;
    const pasado = form.pautar && monto > 0 && disponible < 0;

    const largoTexto = (form.copy || '').length;
    const falta = !form.titulo?.trim() || !form.fecha || !form.marcas.length || !form.formato || pasado;

    const subirUno = async (piezaId, mesId, item, orden) => {
        if (item.tipo === 'archivo') {
            await subirDiseno({ mesId, piezaId, archivo: item.archivo, orden, subidoPor: yoId });
        } else {
            await agregarEnlace({ piezaId, enlace: item.enlace, orden, subidoPor: yoId });
        }
    };

    const guardar = async () => {
        if (falta) return;
        setGuardando(true);
        try {
            const { monto: _monto, ...resto } = form;
            const datos = {
                ...resto, hora: form.hora || null, pilar: form.pilar || null, promocion_id: form.promocion_id || null,
                marca_id: form.marcas[0],
            };
            if (datos.estado === 'publicado' && !pieza?.publicado_en) datos.publicado_en = new Date().toISOString();
            const fila = await guardarPieza(mes.id, datos);
            // La pauta va aparte (su propia tabla y su tope). Desmarcar «se
            // pautará» libera lo asignado.
            if (form.pautar && (monto !== Number(pieza?.pauta?.presupuesto || 0) || !pieza?.pauta)) {
                await guardarPauta(fila.id, { presupuesto: monto, redes: form.redes });
            } else if (!form.pautar && pieza?.pauta) {
                await quitarPauta(fila.id);
            }
            for (const [i, item] of pendientes.entries()) await subirUno(fila.id, mes.id, item, i);
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

    const elegirArchivo = async (archivo) => {
        if (!archivo) return;
        if (esNueva) {
            setPendientes((p) => [...p, { tipo: 'archivo', archivo, id: `${Date.now()}-${archivo.name}` }]);
            return;
        }
        setSubiendo(true);
        try {
            await subirUno(pieza.id, mes.id, { tipo: 'archivo', archivo }, pieza.archivos?.length || 0);
            showToast('Diseño agregado', archivo.name, 'success');
            onCambio?.();
        } catch (err) {
            showToast('No se pudo subir el diseño', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setSubiendo(false);
        }
    };

    const agregarElEnlace = async () => {
        if (!/^https?:\/\//i.test(enlace.trim())) {
            showToast('Enlace no válido', 'Pega el enlace completo, que empiece con https://', 'error');
            return;
        }
        if (esNueva) {
            setPendientes((p) => [...p, { tipo: 'enlace', enlace: enlace.trim(), id: `${Date.now()}-enlace` }]);
            setEnlace('');
            return;
        }
        try {
            await subirUno(pieza.id, mes.id, { tipo: 'enlace', enlace }, pieza.archivos?.length || 0);
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

    const marcarSalida = async (estado) => {
        setGuardando(true);
        try {
            await moverPieza(pieza.id, estado === 'publicado'
                ? { estado, publicado_en: new Date().toISOString() } : { estado });
            showToast(estado === 'publicado' ? 'Marcada como publicada' : 'Marcada como programada', pieza.titulo, 'success');
            onCambio?.();
            onClose();
        } catch (err) {
            showToast('No se pudo marcar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setGuardando(false);
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
    const misComentarios = useMemo(() => (comentarios || []).filter((c) => c.pieza_id === pieza?.id), [comentarios, pieza?.id]);
    const miHistorial = useMemo(() => (historial || []).filter((h) => h.pieza_id === pieza?.id), [historial, pieza?.id]);
    const puedeRevisar = puedeAprobar && publicado && pieza?.id && ['finalizado', 'cambios', 'aprobado'].includes(pieza.estado);
    const est = estadoDe(pieza?.estado || form.estado);
    const marcaPrincipal = catalogos.marcas.find((m) => m.id === form.marcas[0]);

    if (!open) return null;

    return (
        <>
            <LiquidModal open={open} onClose={onClose} maxWidth="max-w-5xl"
                ariaLabel={esNueva ? 'Nueva pieza' : `Pieza ${pieza.titulo}`}>
                <LiquidModal.Header>
                    <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 min-w-0">
                            <h2 className="text-body-xl font-semibold text-content truncate">
                                {esNueva ? 'Nueva pieza' : pieza.titulo}
                            </h2>
                            <Badge variant={est.variant} size="sm">{est.label}</Badge>
                        </div>
                        <div className="flex items-center gap-2 text-caption text-content-3 min-w-0">
                            <span>{mes ? etiquetaMes(mes.mes) : ''}</span>
                            {!esNueva && pieza.created_by && (
                                <>
                                    <span aria-hidden>·</span>
                                    <span className="shrink-0">creada por</span>
                                    <Quien id={pieza.created_by} personas={personas} px={18} />
                                </>
                            )}
                        </div>
                    </div>
                </LiquidModal.Header>
                <LiquidModal.Body>
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                        {/* ── Columna izquierda: la pieza ── */}
                        <div className="space-y-4 min-w-0">
                            {hayBorrador && <AvisoDeBorrador cuando={cuando} onRecuperar={reponer} onDescartar={descartar} />}
                            {!puedeEditar && <FichaDeLectura pieza={pieza} catalogos={catalogos} promociones={promociones} />}
                            {puedeEditar && !esCreador && (
                                <Notice icon={ShieldCheck} compact>
                                    La creó otra persona: puedes editar el contenido, pero el estado, el día y quitarla
                                    los decide quien la creó.
                                </Notice>
                            )}

                            {puedeEditar && (
                                <>
                                    <Bloque icon={Type} titulo="Qué se publica">
                                        <PortalInput label="Título" name="titulo" value={form.titulo} onChange={set('titulo')}
                                            placeholder="Ej. Reel: 3 tips para el resfriado" required />
                                        <Campo rotulo="Marcas" falta>
                                            <SeleccionMultiple opciones={opcionesMarca} valores={form.marcas} onChange={set('marcas')} />
                                        </Campo>
                                        <div className="grid grid-cols-2 gap-3">
                                            <Campo rotulo="Formato" falta>
                                                <LiquidSelect value={form.formato} onChange={set('formato')} clearable={false}
                                                    options={FORMATOS.map((f) => ({ value: f.value, label: f.label }))} />
                                            </Campo>
                                            <Campo rotulo="Tema">
                                                <LiquidSelect value={form.pilar} onChange={set('pilar')} placeholder="De qué habla"
                                                    options={PILARES.map((p) => ({ value: p.value, label: p.label }))} />
                                            </Campo>
                                        </div>
                                        <Campo rotulo="Promoción ligada">
                                            <LiquidSelect value={form.promocion_id} onChange={set('promocion_id')}
                                                placeholder="Ninguna" options={opcionesPromocion} />
                                        </Campo>
                                    </Bloque>

                                    <Bloque icon={CalendarDays} titulo="Cuándo y en qué estado">
                                        <div className="grid grid-cols-2 gap-3">
                                            <Campo rotulo="Fecha" falta>
                                                {puedeMover ? (
                                                    <LiquidDatePicker value={form.fecha} onChange={set('fecha')} min={desde} max={hasta} />
                                                ) : (
                                                    <p className="text-body-sm text-content py-2">
                                                        {fechaTexto(form.fecha, { weekday: 'long', day: 'numeric', month: 'long' })}
                                                    </p>
                                                )}
                                            </Campo>
                                            <Campo rotulo="Hora">
                                                <TimePicker12 value={form.hora} onChange={set('hora')} />
                                            </Campo>
                                        </div>
                                        <Campo rotulo="Estado">
                                            <LiquidSelect value={form.estado} onChange={set('estado')} options={opcionesEstado}
                                                clearable={false} disabled={!puedeMover} />
                                        </Campo>
                                        {form.estado === 'publicado' && (
                                            <PortalInput label="Enlace de la publicación" name="enlace_publicado"
                                                value={form.enlace_publicado || ''} onChange={set('enlace_publicado')}
                                                placeholder="https://www.instagram.com/p/…" />
                                        )}
                                    </Bloque>

                                    <Bloque icon={Share2} titulo="Dónde y con qué texto">
                                        <Campo rotulo="Redes">
                                            <SeleccionMultiple opciones={opcionesRed} valores={form.redes} onChange={set('redes')}
                                                columnas="grid-cols-2 sm:grid-cols-3" />
                                        </Campo>
                                        <PortalTextarea label="Texto de la publicación" name="copy" value={form.copy || ''}
                                            onChange={set('copy')} rows={4} placeholder="Lo que va en la descripción del post"
                                            helperText={`${largoTexto} caracteres${largoTexto > CORTE_DEL_TEXTO ? ` · la red muestra los primeros ${CORTE_DEL_TEXTO}` : ''}`} />
                                        <PortalInput label="Hashtags" name="hashtags" value={form.hashtags || ''} onChange={set('hashtags')}
                                            placeholder="#Salud #Farmacia" />
                                        <PortalTextarea label="Notas para el diseño" name="notas" value={form.notas || ''}
                                            onChange={set('notas')} rows={2} placeholder="Referencias, producto, precio, colores…" />
                                    </Bloque>

                                    <Bloque icon={Megaphone} titulo="Pauta"
                                        accion={<Switch checked={!!form.pautar} label="Se pautará"
                                            onChange={(on) => setForm((f) => ({ ...f, pautar: on }))} />}>
                                        {!form.pautar ? (
                                            <p className="text-body-sm text-content-3">
                                                Actívala para invertir en esta pieza. Presupuesto de {mes ? etiquetaMes(mes.mes) : 'este mes'}:{' '}
                                                {limite > 0 ? `${formatMoney(limite - otros)} libres de ${formatMoney(limite)}` : 'gerencia todavía no lo fija'}.
                                            </p>
                                        ) : limite === 0 ? (
                                            <Notice variant="warning" icon={AlertTriangle} compact>
                                                Gerencia todavía no fijó el presupuesto de pauta del mes. Se puede marcar para
                                                pautar; el monto se asigna cuando lo fije.
                                            </Notice>
                                        ) : (
                                            <div className="space-y-2">
                                                <PortalInput label="Monto para esta pieza" name="monto" inputMode="decimal" maskType="DECIMAL"
                                                    prefix="$" value={form.monto} onChange={set('monto')} placeholder="0.00"
                                                    hasError={pasado} errorMessage={pasado ? 'Supera lo disponible del mes' : undefined} />
                                                <BarraDePresupuesto limite={limite} otros={otros} esta={monto} />
                                                {!esNueva && pieza.pauta && onEditarPauta && (
                                                    <Button variant="ghost" size="xs" onClick={() => onEditarPauta(pieza)}>
                                                        Objetivo, fechas y resultados
                                                    </Button>
                                                )}
                                            </div>
                                        )}
                                    </Bloque>
                                </>
                            )}

                            {!esNueva && !puedeEditar && pieza.pauta && (
                                <Bloque icon={Megaphone} titulo="Pauta">
                                    <p className="text-body-sm text-content-2">
                                        {formatMoney(pieza.pauta.presupuesto)} · {objetivoDe(pieza.pauta.objetivo).label}
                                        {pieza.pauta.gastado != null && <> · gastado {formatMoney(pieza.pauta.gastado)}</>}
                                    </p>
                                </Bloque>
                            )}
                            {!esNueva && pieza.promocion_id && <EfectoEnVentas pieza={pieza} />}
                        </div>

                        {/* ── Columna derecha: diseños, revisión, historial, conversación ── */}
                        <div className="space-y-4 min-w-0">
                            <Bloque icon={ImageIcon} titulo="Diseños"
                                accion={(puedeEditar || publicado) && (archivos.length > 0 || form.copy) ? (
                                    <SegmentedControl size="sm" value={verPrevia} onChange={setVerPrevia} label="Ver"
                                        options={[{ value: 'disenos', label: 'Archivos' }, { value: 'previa', label: 'Vista previa' }]} />
                                ) : null}>
                                {verPrevia === 'previa' ? (
                                    <VistaPrevia pieza={{ ...(pieza || {}), ...form }} archivos={archivos} firmadas={firmadas}
                                        marca={marcaPrincipal} />
                                ) : (
                                    <>
                                        {!archivos.length && !pendientes.length && !puedeEditar && !publicado && (
                                            <Notice icon={EyeOff} compact>
                                                Los diseños se ven cuando el diseñador envíe el mes a revisión.
                                            </Notice>
                                        )}
                                        {!archivos.length && !pendientes.length && (puedeEditar || publicado) && (
                                            <p className="text-body-sm text-content-3">Sin diseños todavía.</p>
                                        )}
                                        <Disenos archivos={archivos} firmadas={firmadas} onQuitar={puedeEditar ? quitar : undefined} />
                                        {pendientes.length > 0 && (
                                            <ul className="space-y-1">
                                                {pendientes.map((p) => (
                                                    <li key={p.id} className="flex items-center gap-2 min-w-0 text-body-sm text-content-2">
                                                        {p.tipo === 'archivo' ? <Paperclip size={13} className="shrink-0" /> : <Link2 size={13} className="shrink-0" />}
                                                        <span className="truncate flex-1">{p.tipo === 'archivo' ? p.archivo.name : p.enlace}</span>
                                                        <Button variant="ghost" size="xs" iconOnly icon={X} title="No subir"
                                                            onClick={() => setPendientes((l) => l.filter((x) => x.id !== p.id))} />
                                                    </li>
                                                ))}
                                                <li className="text-caption text-content-3">Se suben al guardar la pieza.</li>
                                            </ul>
                                        )}
                                        {puedeEditar && (
                                            <>
                                                <FileField label="Imagen, video o PDF" accept="image/*,video/*,.pdf" maxSizeMB={200}
                                                    file={null} onChange={elegirArchivo} busy={subiendo} busyLabel="Subiendo diseño…"
                                                    conEditor={false} conTelefono={false} />
                                                <div className="flex items-end gap-2">
                                                    <div className="flex-1 min-w-0">
                                                        <PortalInput label="O un enlace (Drive, Canva)" name="enlace" value={enlace}
                                                            onChange={(e) => setEnlace(e.target.value)} placeholder="https://…" />
                                                    </div>
                                                    <Button variant="secondary" icon={Link2} disabled={!enlace.trim()} onClick={agregarElEnlace}>
                                                        Agregar
                                                    </Button>
                                                </div>
                                                {['aprobado', 'programado'].includes(pieza?.estado) && (
                                                    <p className="text-caption text-content-3">
                                                        Cambiar el diseño o el texto de una pieza aprobada la devuelve a revisión.
                                                    </p>
                                                )}
                                            </>
                                        )}
                                    </>
                                )}
                            </Bloque>

                            {puedeRevisar && (
                                <Bloque icon={ThumbsUp} titulo="Revisión">
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
                                </Bloque>
                            )}

                            {!esNueva && (
                                <Bloque icon={History} titulo="Historial">
                                    <Historial entradas={miHistorial} personas={personas} />
                                </Bloque>
                            )}

                            {!esNueva && (
                                <Bloque icon={MessageSquare} titulo="Comentarios">
                                    <Conversacion comentarios={misComentarios} personas={personas}
                                        mesId={mes.id} piezaId={pieza.id} yoId={yoId}
                                        puedeResolver={puedeEditar || puedeAprobar} onCambio={onCambio} />
                                </Bloque>
                            )}
                        </div>
                    </div>
                </LiquidModal.Body>
                <PieDeModal izquierda={(!esNueva && puedeMover && pieza.estado !== 'publicado' && (
                    <Button variant="ghost" icon={Trash2} onClick={() => setBorrando(true)}>Quitar</Button>
                )) || (!esNueva && pieza.estado === 'cambios' && !puedeMover && (
                    <span className="text-caption text-warning flex items-center gap-1">
                        <AlertTriangle size={13} /> Con cambios pedidos
                    </span>
                ))}>
                    {!esNueva && puedeMover && pieza.estado === 'aprobado' && (
                        <Button variant="secondary" icon={CalendarCheck} loading={guardando} onClick={() => marcarSalida('programado')}>
                            Programada
                        </Button>
                    )}
                    {!esNueva && puedeMover && ['aprobado', 'programado'].includes(pieza.estado) && (
                        <Button variant="secondary" icon={Send} loading={guardando} onClick={() => marcarSalida('publicado')}>
                            Publicada
                        </Button>
                    )}
                    <Button variant="secondary" onClick={onClose}>{puedeEditar ? 'Cancelar' : 'Cerrar'}</Button>
                    {puedeEditar && (
                        <Button icon={Check} loading={guardando} disabled={falta} onClick={guardar}>
                            {esNueva ? (pendientes.length ? `Agregar y subir ${pendientes.length}` : 'Agregar') : 'Guardar'}
                        </Button>
                    )}
                </PieDeModal>
            </LiquidModal>

            <ConfirmModal isOpen={borrando} onClose={() => setBorrando(false)} onConfirm={borrar}
                title="¿Quitar esta pieza?"
                message={`«${pieza?.titulo}» sale del calendario con sus diseños y comentarios.${publicado ? ' Quien revisa recibe el aviso.' : ''}`}
                confirmText="Quitar" isProcessing={guardando} />
        </>
    );
}

/** Cuánto hay, cuánto ya se repartió y cuánto toma esta pieza. */
function BarraDePresupuesto({ limite, otros, esta }) {
    const pct = (n) => `${Math.max(0, Math.min(100, (n / limite) * 100))}%`;
    const libre = limite - otros - esta;
    return (
        <div className="space-y-1">
            <div className="h-2 rounded-full bg-surface-input overflow-hidden flex" data-medida="dato"
                role="img" aria-label={`Asignado en otras piezas ${formatMoney(otros)}, esta ${formatMoney(esta)}, libre ${formatMoney(Math.max(libre, 0))}`}>
                <span className="h-full bg-chart-4" style={{ width: pct(otros) }} />
                <span className={`h-full ${libre < 0 ? 'bg-danger' : 'bg-brand'}`} style={{ width: pct(esta) }} />
            </div>
            <p className={`text-caption ${libre < 0 ? 'text-danger' : 'text-content-3'}`}>
                {libre < 0
                    ? `Te pasas por ${formatMoney(-libre)}. Quedan ${formatMoney(limite - otros)} de ${formatMoney(limite)}.`
                    : `Quedan ${formatMoney(libre)} de ${formatMoney(limite)} · ${formatMoney(otros)} en otras piezas`}
            </p>
        </div>
    );
}

/** La pieza para quien no la edita: lo mismo que el formulario, sin controles. */
function FichaDeLectura({ pieza, catalogos, promociones }) {
    if (!pieza) return null;
    const marcas = (pieza.marcas?.length ? pieza.marcas : [pieza.marca_id])
        .map((id) => catalogos.marcas.find((m) => m.id === id)?.nombre).filter(Boolean);
    const redes = (pieza.redes || []).map((c) => catalogos.redes.find((r) => r.clave === c)?.nombre || c);
    const filas = [
        ['Marcas', marcas.join(', ')],
        ['Fecha', [fechaTexto(pieza.fecha, { weekday: 'long', day: 'numeric', month: 'long' }), hora12(pieza.hora)].filter(Boolean).join(' · ')],
        ['Formato', FORMATOS.find((f) => f.value === pieza.formato)?.label],
        ['Tema', PILARES.find((p) => p.value === pieza.pilar)?.label],
        ['Redes', redes.join(', ')],
        ['Promoción', (promociones || []).find((p) => p.id === pieza.promocion_id)?.nombre],
    ].filter(([, v]) => v);
    return (
        <Bloque icon={Tag} titulo="La pieza">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-body-sm">
                {filas.map(([k, v]) => (
                    <React.Fragment key={k}>
                        <dt className="text-content-3">{k}</dt>
                        <dd className="text-content">{v}</dd>
                    </React.Fragment>
                ))}
            </dl>
            {pieza.copy && <p className="text-body-sm text-content whitespace-pre-wrap">{pieza.copy}</p>}
            {pieza.hashtags && <p className="text-body-sm text-brand">{pieza.hashtags}</p>}
            {pieza.notas && <p className="text-body-sm text-content-2 whitespace-pre-wrap">{pieza.notas}</p>}
            {pieza.enlace_publicado && (
                <Button variant="ghost" size="sm" icon={Link2} onClick={() => abrirEnPestanaNueva(pieza.enlace_publicado)}>
                    Ver la publicación
                </Button>
            )}
        </Bloque>
    );
}
