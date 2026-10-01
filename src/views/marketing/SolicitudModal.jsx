import React, { useCallback, useState } from 'react';
import { Send, Check, X, PackageCheck } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import LiquidSelect from '../../components/common/LiquidSelect';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import SegmentedControl from '../../components/common/SegmentedControl';
import AvisoDeBorrador from '../../components/common/AvisoDeBorrador';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import Campo from '../promociones/Campo';
import PieDeModal from '../../components/common/PieDeModal';
import useBorrador from '@nucleo/hooks/useBorrador';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { hoySV, fechaTexto } from '@nucleo/utils/fecha';
import { FORMATOS, FORMATOS_IMPRESOS, PRIORIDADES, prioridadDe, estadoSolicitudDe, formatoDe, tamanosDe } from '@nucleo/utils/marketing';
import { crearSolicitud, responderSolicitud } from '@nucleo/data/marketing';

const VACIA = { tipo: 'digital', titulo: '', descripcion: '', marca_id: '', formato: '', tamano: '', fecha_deseada: '', prioridad: 'normal' };
const TIPOS = [{ value: 'digital', label: 'Para redes' }, { value: 'impreso', label: 'Impreso' }];
const CLAVE_BORRADOR = 'marketing_solicitud_nueva';

/**
 * Pedirle una pieza al diseñador, o —para quien edita— responder una pedida.
 * Aceptar no crea la pieza sola: abre el formulario de la pieza con lo pedido
 * ya escrito, porque la fecha y el formato finales los decide quien diseña.
 */
export default function SolicitudModal({ open, onClose, solicitud, marcas, personas, puedeEditar, yoId, onCambio, onAceptar }) {
    const showToast = useToastStore((s) => s.showToast);
    const esNueva = !solicitud?.id;
    const [form, setForm] = useState(VACIA);
    const [respuesta, setRespuesta] = useState(() => solicitud?.respuesta || '');
    const [guardando, setGuardando] = useState(false);

    const { recuperado, cuando, descartar, hayBorrador } = useBorrador(esNueva ? CLAVE_BORRADOR : null, form, { activo: open && esNueva });
    const reponer = useCallback(() => {
        if (!recuperado) return;
        setForm({ ...VACIA, ...recuperado });
        descartar();
    }, [recuperado, descartar]);

    const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }));
    const impreso = form.tipo === 'impreso';
    // Los tamaños sugeridos del formato, más el que se haya escrito a mano
    // (el selector deja crear uno libre).
    const opcionesTamano = [...new Set([...tamanosDe(form.formato), ...(form.tamano ? [form.tamano] : [])])]
        .map((t) => ({ value: t, label: t }));
    const falta = !form.titulo.trim() || (impreso && (!form.formato || !form.tamano?.trim()));

    const enviar = async () => {
        if (falta) return;
        setGuardando(true);
        try {
            await crearSolicitud(form, yoId);
            descartar();
            showToast('Solicitud enviada', 'El diseñador recibe el aviso.', 'success');
            onCambio?.();
            onClose();
        } catch (err) {
            showToast('No se pudo enviar la solicitud', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setGuardando(false);
        }
    };

    const responder = async (estado) => {
        setGuardando(true);
        try {
            const fila = await responderSolicitud(solicitud.id, estado, respuesta);
            onCambio?.();
            onClose();
            // Lo impreso no va al calendario de redes: se acepta y se entrega.
            if (estado === 'aceptada' && fila.tipo !== 'impreso') onAceptar?.(fila);
        } catch (err) {
            showToast('No se pudo responder', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setGuardando(false);
        }
    };

    if (!open) return null;

    if (esNueva) {
        return (
            <LiquidModal open={open} onClose={onClose} maxWidth="max-w-lg" ariaLabel="Nueva solicitud">
                <LiquidModal.Header>
                    <h2 className="text-body-xl font-semibold text-content">Pedir una pieza</h2>
                </LiquidModal.Header>
                <LiquidModal.Body>
                    <div className="space-y-4">
                        {hayBorrador && <AvisoDeBorrador cuando={cuando} onRecuperar={reponer} onDescartar={descartar} />}
                        <SegmentedControl value={form.tipo} label="Tipo de pieza" options={TIPOS}
                            onChange={(v) => setForm((f) => ({ ...f, tipo: v, formato: '', tamano: '' }))} />
                        <PortalInput label="Qué necesitas" name="titulo" value={form.titulo} onChange={set('titulo')}
                            placeholder={impreso ? 'Ej. Banner de la promoción de vitaminas' : 'Ej. Post de la promoción de vitaminas'} required />
                        <PortalTextarea label="Detalle" name="descripcion" value={form.descripcion} onChange={set('descripcion')}
                            rows={4} placeholder="Producto, precio, vigencia, a quién va dirigido, referencias…" />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <Campo rotulo="Marca">
                                <LiquidSelect value={form.marca_id} onChange={set('marca_id')} placeholder="Marca"
                                    options={marcas.filter((m) => m.activo).map((m) => ({ value: m.id, label: m.nombre }))} />
                            </Campo>
                            <Campo rotulo="Formato" falta={impreso}>
                                <LiquidSelect value={form.formato} placeholder={impreso ? 'Qué se imprime' : 'Cualquiera'}
                                    onChange={(v) => setForm((f) => ({ ...f, formato: v, tamano: '' }))}
                                    options={(impreso ? FORMATOS_IMPRESOS : FORMATOS).map((f) => ({ value: f.value, label: f.label }))} />
                            </Campo>
                            {impreso && (
                                <Campo rotulo="Tamaño" falta>
                                    <LiquidSelect value={form.tamano} onChange={set('tamano')} options={opcionesTamano}
                                        placeholder={form.formato ? 'Elige o escribe uno' : 'Primero el formato'}
                                        disabled={!form.formato} creatable onCreateOption={(t) => setForm((f) => ({ ...f, tamano: t }))} />
                                </Campo>
                            )}
                            <Campo rotulo="Para cuándo">
                                <LiquidDatePicker value={form.fecha_deseada} onChange={set('fecha_deseada')} min={hoySV()} />
                            </Campo>
                        </div>
                        <Campo rotulo="Prioridad">
                            <SegmentedControl value={form.prioridad} onChange={set('prioridad')} label="Prioridad"
                                options={PRIORIDADES.map((p) => ({ value: p.value, label: p.label }))} />
                        </Campo>
                    </div>
                </LiquidModal.Body>
                <LiquidModal.Footer>
                    <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                    <Button icon={Send} loading={guardando} disabled={falta} onClick={enviar}>Enviar</Button>
                </LiquidModal.Footer>
            </LiquidModal>
        );
    }

    const quien = personas?.[solicitud.solicitado_por];
    const est = estadoSolicitudDe(solicitud.estado);
    const prio = prioridadDe(solicitud.prioridad);
    const marca = marcas.find((m) => m.id === solicitud.marca_id);
    return (
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-lg" ariaLabel={`Solicitud ${solicitud.titulo}`}>
            <LiquidModal.Header>
                <div className="flex items-center gap-2 min-w-0">
                    <h2 className="text-body-xl font-semibold text-content truncate">{solicitud.titulo}</h2>
                    <Badge variant={est.variant} size="sm">{est.label}</Badge>
                </div>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-4">
                    <div className="flex items-center gap-2">
                        <AvatarConEstado emp={quien || { id: solicitud.solicitado_por }} px={28} radio="rounded-full" marco="" />
                        <span className="text-body-sm text-content-2">
                            {shortEmployeeName(quien?.name)} · {fechaTexto(solicitud.created_at, { day: 'numeric', month: 'short' })}
                        </span>
                        {solicitud.prioridad !== 'normal' && <Badge variant={prio.variant} size="sm">{prio.label}</Badge>}
                    </div>
                    {solicitud.descripcion && <p className="text-body-sm text-content whitespace-pre-wrap">{solicitud.descripcion}</p>}
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-body-sm">
                        {marca && <><dt className="text-content-3">Marca</dt><dd>{marca.nombre}</dd></>}
                        <dt className="text-content-3">Tipo</dt><dd>{solicitud.tipo === 'impreso' ? 'Impreso' : 'Para redes'}</dd>
                        {solicitud.formato && <><dt className="text-content-3">Formato</dt><dd>{formatoDe(solicitud.formato).label}</dd></>}
                        {solicitud.tamano && <><dt className="text-content-3">Tamaño</dt><dd>{solicitud.tamano}</dd></>}
                        {solicitud.fecha_deseada && <><dt className="text-content-3">Para</dt><dd>{fechaTexto(solicitud.fecha_deseada, { weekday: 'long', day: 'numeric', month: 'long' })}</dd></>}
                    </dl>
                    {puedeEditar && ['nueva', 'aceptada'].includes(solicitud.estado) ? (
                        <PortalTextarea label="Respuesta" name="respuesta" value={respuesta}
                            onChange={(e) => setRespuesta(e.target.value)} rows={2} placeholder="Opcional" />
                    ) : solicitud.respuesta && (
                        <div>
                            <p className="text-label uppercase tracking-wide font-semibold text-content-2 mb-1">Respuesta</p>
                            <p className="text-body-sm text-content-2 whitespace-pre-wrap">{solicitud.respuesta}</p>
                        </div>
                    )}
                </div>
            </LiquidModal.Body>
            <PieDeModal izquierda={<Button variant="secondary" onClick={onClose}>Cerrar</Button>}>
                {puedeEditar && solicitud.estado === 'nueva' && (
                    <>
                        <Button variant="ghost" icon={X} loading={guardando} onClick={() => responder('rechazada')}>Rechazar</Button>
                        <Button icon={Check} loading={guardando} onClick={() => responder('aceptada')}>
                            {solicitud.tipo === 'impreso' ? 'Aceptar' : 'Aceptar y planificar'}
                        </Button>
                    </>
                )}
                {puedeEditar && solicitud.estado === 'aceptada' && (
                    <Button icon={PackageCheck} loading={guardando} onClick={() => responder('entregada')}>Marcar entregada</Button>
                )}
            </PieDeModal>
        </LiquidModal>
    );
}
