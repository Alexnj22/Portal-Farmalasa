import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Loader2, Check, IdCard, MapPin, Phone, ShieldCheck, Receipt,
    History, AlertTriangle, Store, Building2,
} from 'lucide-react';
import Button from '../common/Button';
import Badge from '../common/Badge';
import Notice from '../common/Notice';
import LiquidSelect from '../common/LiquidSelect';
import PortalInput from '../common/PortalInput';
import PortalTextarea from '../common/PortalTextarea';
import SegmentedControl from '../common/SegmentedControl';
import { LoadingState } from '../common/StateViews';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { formatMoney } from '../../utils/formatNumber';
import { maskDui } from '../../utils/duiUtils';
import {
    fetchCustomerDetail, updateCustomerFiscal, codigoDeError, mensajeDeError,
} from '../../data/customers';
import {
    EL_SALVADOR_GEO, municipiosDe, distritosDe, normalizarGeo,
} from '../../data/elSalvadorGeo';
import {
    validarCliente, camposRequeridos, esContribuyente as esFiscal,
    ETIQUETA_CAMPO as ETIQUETAS,
} from '../../utils/clienteValidacion';

const CATEGORIAS = [
    'Consumidor', 'Contribuyente', 'Gran Contribuyente',
    'Contribuyente Exento', 'Extranjero', 'Menor de edad',
];

// Los campos que el ERP guarda y que esta ficha edita. El orden es el del
// formulario, no el de la tabla.
const CAMPOS = [
    'name', 'categoria', 'dui', 'nit', 'nrc', 'pasaporte', 'giro',
    'phone', 'telefono2', 'email', 'direccion',
    'departamento', 'municipio', 'distrito', 'retencion_pct', 'notes',
];

const ETIQUETA_CAMPO = ETIQUETAS;

const fmtDate = (d) => {
    if (!d) return '—';
    const [y, m, day] = String(d).slice(0, 10).split('-');
    return y && m && day ? `${day}/${m}/${y}` : '—';
};
const fmtDateTime = (d) => {
    if (!d) return '—';
    const dt = new Date(d);
    return `${fmtDate(d)} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
};

function SectionHeader({ icon: Icon, children }) {
    return (
        <h4 className="text-label font-black uppercase tracking-widest text-brand-text flex items-center gap-2 pt-5 border-t border-divider">
            <Icon size={13} strokeWidth={2.5} /> {children}
        </h4>
    );
}

function Dato({ label, value, valueCls = 'text-content-2' }) {
    return (
        <div className="min-w-0">
            <p className="text-micro font-black uppercase tracking-widest text-content-3">{label}</p>
            <p className={`text-body-sm font-bold tabular-nums ${valueCls}`}>{value}</p>
        </div>
    );
}

// ── Actividad ────────────────────────────────────────────────────────────────

function PanelActividad({ actividad, facturas, bitacora }) {
    return (
        <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Dato label="Facturas" value={(actividad?.facturas ?? 0).toLocaleString()} />
                <Dato label="Facturado" value={formatMoney(actividad?.total ?? 0)} />
                <Dato label="CCF" value={(actividad?.facturas_ccf ?? 0).toLocaleString()} />
                <Dato label="Anuladas"
                    value={(actividad?.facturas_anuladas ?? 0).toLocaleString()}
                    valueCls={actividad?.facturas_anuladas ? 'text-danger-text' : 'text-content-2'} />
            </div>
            <div className="grid grid-cols-2 gap-3">
                <Dato label="Primera compra" value={fmtDate(actividad?.primera_fecha)} />
                <Dato label="Última compra" value={fmtDate(actividad?.ultima_fecha)} />
            </div>

            <SectionHeader icon={Receipt}>Últimas facturas</SectionHeader>
            {facturas.length === 0 ? (
                <p className="text-body-sm text-content-3">Sin facturas registradas.</p>
            ) : (
                <div className="space-y-1.5">
                    {facturas.map(f => (
                        <div key={f.id}
                            className="flex items-center gap-3 px-3 py-2 rounded-btn bg-surface-card-hover/60 border border-divider">
                            <span className="text-caption tabular-nums text-content-3 w-[74px] shrink-0">{fmtDate(f.fecha)}</span>
                            <Badge size="sm" variant={f.tipo_documento === 'CCF' ? 'info' : 'neutral'}>
                                {f.tipo_documento}
                            </Badge>
                            <span className="text-caption text-content-3 truncate min-w-0 flex-1" title={f.sucursal}>
                                {f.sucursal || '—'}
                            </span>
                            {f.estado !== 'FINALIZADA' && (
                                <Badge size="sm" variant="danger">Anulada</Badge>
                            )}
                            <span className="text-body-sm font-bold tabular-nums text-content-2 shrink-0">
                                {formatMoney(f.total)}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            <SectionHeader icon={History}>Cambios de la ficha</SectionHeader>
            {bitacora.length === 0 ? (
                <p className="text-body-sm text-content-3">La ficha no se ha editado desde el portal.</p>
            ) : (
                <div className="space-y-1.5">
                    {bitacora.map((h, i) => (
                        <div key={i} className="px-3 py-2 rounded-btn bg-surface-card-hover/60 border border-divider">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-caption font-black uppercase tracking-widest text-content-2">
                                    {ETIQUETA_CAMPO[h.campo] || h.campo}
                                </span>
                                <span className="text-caption text-content-3">{fmtDateTime(h.changed_at)}</span>
                                {h.changed_by_nombre && (
                                    <span className="text-caption text-content-3">· {h.changed_by_nombre}</span>
                                )}
                                {/* La bitácora es también la cola de la Fase 2:
                                    lo que todavía no viajó al ERP se ve acá. */}
                                {!h.erp_synced_at && <Badge size="sm" variant="warning">Sin enviar al ERP</Badge>}
                            </div>
                            <p className="text-caption text-content-3 mt-0.5 break-words">
                                <span className="line-through">{h.valor_anterior || '(vacío)'}</span>
                                {' → '}
                                <span className="text-content-2 font-bold">{h.valor_nuevo || '(vacío)'}</span>
                            </p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Formulario ───────────────────────────────────────────────────────────────

const FormClienteDetail = ({ formData }) => {
    const id = formData?.id;
    const canEdit = formData?.canEdit !== false;

    const [cargando, setCargando] = useState(true);
    const [cliente, setCliente] = useState(null);
    const [actividad, setActividad] = useState(null);
    const [facturas, setFacturas] = useState([]);
    const [bitacora, setBitacora] = useState([]);
    const [panel, setPanel] = useState('ficha');

    const [form, setForm] = useState(null);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState('');
    // El servidor exige un sí explícito para tocar los datos fiscales de un
    // contribuyente. Cuando lo pide, se muestra el aviso y el siguiente clic
    // reenvía confirmando — el candado real vive en el RPC, no acá.
    const [pideConfirmacion, setPideConfirmacion] = useState(false);

    const cargar = useCallback(async () => {
        setCargando(true);
        try {
            const d = await fetchCustomerDetail(id);
            setCliente(d.cliente || null);
            setActividad(d.actividad || null);
            setFacturas(d.facturas || []);
            setBitacora(d.bitacora || []);
            setForm(Object.fromEntries(CAMPOS.map(c => [c, d.cliente?.[c] ?? ''])));
        } catch (e) {
            console.error('FormClienteDetail.jsx: ', e);
            setError(mensajeDeError(e));
        } finally {
            setCargando(false);
        }
    }, [id]);

    useEffect(() => { cargar(); }, [cargar]);

    // La cascada se normaliza en un solo lugar (`normalizarGeo`), el mismo que
    // usa el servidor como regla: cambiar el departamento no puede dejar vivo un
    // municipio de otro, ni un distrito que ya no pertenece a nadie.
    const setGeo = useCallback((parcial) => {
        setForm(p => ({ ...p, ...normalizarGeo({ ...p, ...parcial }) }));
    }, []);

    const esContribuyente = esFiscal(form?.categoria);

    // Un solo veredicto para toda la ficha, calculado en `clienteValidacion`:
    // el formulario pinta, no decide. `errores` es "está mal escrito" y `faltan`
    // es "todavía no lo llenaste" — se muestran distinto porque se leen distinto.
    const v = useMemo(() => validarCliente(form, cliente), [form, cliente]);
    const requeridos = useMemo(
        () => new Set(camposRequeridos(form?.categoria)), [form?.categoria]);

    // Un cliente de mostrador no es una persona: no lleva ficha fiscal y el
    // servidor rechaza el guardado con ES_MOSTRADOR. Sin esto el botón queda
    // habilitado para que el viaje termine en un error que ya sabíamos.
    const editable = canEdit && !cliente?.mostrador;

    // `faltan` NO se marca en rojo hasta que la persona intenta guardar: abrir
    // una ficha vieja e incompleta y encontrarla en rojo entera es hostil, y
    // además no es un error suyo. Lo mal escrito sí se marca al instante,
    // porque eso sí lo acaba de teclear.
    const [intentoGuardar, setIntentoGuardar] = useState(false);
    const marcarFalta = (campo) => intentoGuardar && v.faltan.includes(campo);
    const errorDe = (campo) =>
        v.errores[campo] || (marcarFalta(campo) ? 'Requerido para facturar' : undefined);

    // Solo viaja lo que cambió. Es lo contrario del POST del ERP —que borra lo
    // que no se le manda— y hace que la bitácora registre ediciones reales en
    // vez de una fila por campo cada vez que alguien abre y guarda.
    const cambios = useMemo(() => {
        if (!form || !cliente) return {};
        const out = {};
        for (const c of CAMPOS) {
            const antes = cliente[c] ?? '';
            const ahora = form[c] ?? '';
            if (String(antes) !== String(ahora)) out[c] = ahora === '' ? null : ahora;
        }
        return out;
    }, [form, cliente]);

    const hayCambios = Object.keys(cambios).length > 0;

    const guardar = useCallback(async (confirmando = false) => {
        setIntentoGuardar(true);
        // Cinturón además del botón deshabilitado: `guardar(true)` se llama
        // también desde el botón "Confirmar" del aviso fiscal, que es otro
        // camino y no pasa por el `disabled` del principal.
        if (!validarCliente(form, cliente).ok) return;
        setGuardando(true);
        setError('');
        try {
            await updateCustomerFiscal(id, cambios, { confirmarFiscal: confirmando });
            useStaff.getState().appendAuditLog('CLIENTES_EDITAR_FICHA', String(id), {
                nombre: cliente?.name, campos: Object.keys(cambios),
            });
            useToastStore.getState().showToast(
                'Ficha actualizada',
                `${Object.keys(cambios).length} campo${Object.keys(cambios).length !== 1 ? 's' : ''} guardado${Object.keys(cambios).length !== 1 ? 's' : ''}.`,
                'success');
            setPideConfirmacion(false);
            formData?.onSaved?.();
            await cargar();
        } catch (e) {
            if (codigoDeError(e) === 'REQUIERE_CONFIRMACION_FISCAL') {
                setPideConfirmacion(true);
                setError('');
            } else {
                console.error('FormClienteDetail.jsx: guardar', e);
                setError(mensajeDeError(e));
            }
        } finally {
            setGuardando(false);
        }
    }, [id, cambios, cliente, formData, cargar, form]);

    if (cargando) return <LoadingState label="Cargando la ficha…" />;

    if (!cliente) {
        return (
            <Notice variant="danger" icon={AlertTriangle}>
                {error || 'No se pudo cargar la ficha.'}
            </Notice>
        );
    }

    const municipioOpts = municipiosDe(form.departamento).map(m => ({ value: m, label: m }));
    const distritoOpts = distritosDe(form.municipio).map(d => ({ value: d, label: d }));

    return (
        <div className="space-y-5">
            <SegmentedControl
                options={[
                    { value: 'ficha', label: 'Ficha fiscal' },
                    { value: 'actividad', label: 'Actividad' },
                ]}
                value={panel}
                onChange={setPanel}
                label="Sección de la ficha del cliente"
            />

            {cliente.mostrador && (
                <Notice variant="warning" icon={Store}>
                    Es un cliente genérico del mostrador, no una persona. El punto de venta
                    le carga las ventas sin identificar, así que no lleva ficha fiscal y no
                    se puede editar.
                </Notice>
            )}

            {cliente.nombre_corrupto && (
                <Notice variant="danger" icon={AlertTriangle}>
                    El nombre tiene la codificación dañada (se importó leyendo mal las
                    tildes). Corrígelo a mano para que la ficha coincida con la del ERP.
                </Notice>
            )}

            {panel === 'actividad' ? (
                <PanelActividad actividad={actividad} facturas={facturas} bitacora={bitacora} />
            ) : (
                <div className="space-y-5">
                    {/* Identidad */}
                    <div className="space-y-3">
                        <SectionHeader icon={IdCard}>Identidad</SectionHeader>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="sm:col-span-2">
                                <PortalInput
                                    name="name" label="Nombre" required
                                    value={form.name} readOnly={!editable}
                                    hasError={!!errorDe('name')} errorMessage={errorDe('name')}
                                    helperText="Se guarda en mayúscula"
                                    onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                                />
                            </div>
                            <div>
                                <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">
                                    Categoría
                                </label>
                                <LiquidSelect
                                    value={form.categoria}
                                    onChange={v => setForm(p => ({ ...p, categoria: v || '' }))}
                                    options={CATEGORIAS.map(c => ({ value: c, label: c }))}
                                    placeholder="Sin categoría"
                                    clearLabel="Ninguna"
                                    disabled={!editable}
                                    ariaLabel="Categoría fiscal del cliente"
                                />
                            </div>
                            <PortalInput
                                name="dui" label="DUI"
                                value={form.dui} readOnly={!editable}
                                hasError={!!errorDe('dui')} errorMessage={errorDe('dui')}
                                onChange={e => setForm(p => ({ ...p, dui: maskDui(e.target.value) }))}
                            />
                            <PortalInput
                                name="nit" label="NIT" required={requeridos.has('nit')}
                                value={form.nit} readOnly={!editable}
                                hasError={!!errorDe('nit')} errorMessage={errorDe('nit')}
                                onChange={e => setForm(p => ({ ...p, nit: e.target.value }))}
                            />
                            <PortalInput
                                name="nrc" label="NRC" required={requeridos.has('nrc')}
                                value={form.nrc} readOnly={!editable}
                                hasError={!!errorDe('nrc')} errorMessage={errorDe('nrc')}
                                helperText={esContribuyente ? 'Requerido para facturarle con CCF' : undefined}
                                onChange={e => setForm(p => ({ ...p, nrc: e.target.value }))}
                            />
                            <PortalInput
                                name="pasaporte" label="Pasaporte"
                                value={form.pasaporte} readOnly={!editable}
                                onChange={e => setForm(p => ({ ...p, pasaporte: e.target.value }))}
                            />
                            <PortalInput
                                name="giro" label="Giro" required={requeridos.has('giro')}
                                placeholder="Actividad económica"
                                value={form.giro} readOnly={!editable}
                                hasError={!!errorDe('giro')} errorMessage={errorDe('giro')}
                                onChange={e => setForm(p => ({ ...p, giro: e.target.value }))}
                            />
                        </div>
                    </div>

                    {/* Contacto */}
                    <div className="space-y-3">
                        <SectionHeader icon={Phone}>Contacto</SectionHeader>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <PortalInput
                                name="phone" label="Teléfono" type="tel" required
                                value={form.phone} readOnly={!editable}
                                hasError={!!errorDe('phone')} errorMessage={errorDe('phone')}
                                helperText="El DTE lo pide en el receptor"
                                onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                            />
                            <PortalInput
                                name="telefono2" label="Teléfono 2" type="tel"
                                value={form.telefono2} readOnly={!editable}
                                hasError={!!errorDe('telefono2')} errorMessage={errorDe('telefono2')}
                                onChange={e => setForm(p => ({ ...p, telefono2: e.target.value }))}
                            />
                            <div className="sm:col-span-2">
                                <PortalInput
                                    name="email" label="Correo" type="email"
                                    required={requeridos.has('email')}
                                    value={form.email} readOnly={!editable}
                                    hasError={!!errorDe('email')} errorMessage={errorDe('email')}
                                    onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Ubicación */}
                    <div className="space-y-3">
                        <SectionHeader icon={MapPin}>Ubicación</SectionHeader>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="sm:col-span-2">
                                <PortalInput
                                    name="direccion" label="Dirección"
                                    required={requeridos.has('direccion')}
                                    value={form.direccion} readOnly={!editable}
                                    hasError={!!errorDe('direccion')} errorMessage={errorDe('direccion')}
                                    onChange={e => setForm(p => ({ ...p, direccion: e.target.value }))}
                                />
                            </div>
                            <div>
                                <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">
                                    Departamento
                                </label>
                                <LiquidSelect
                                    value={form.departamento}
                                    onChange={v => setGeo({ departamento: v || null, municipio: null, distrito: null })}
                                    options={Object.keys(EL_SALVADOR_GEO).map(d => ({ value: d, label: d }))}
                                    placeholder="Sin departamento"
                                    clearLabel="Ninguno"
                                    disabled={!editable}
                                    ariaLabel="Departamento"
                                />
                            </div>
                            <div>
                                <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">
                                    Municipio
                                </label>
                                <LiquidSelect
                                    value={form.municipio}
                                    onChange={v => setGeo({ municipio: v || null, distrito: null })}
                                    options={municipioOpts}
                                    placeholder={form.departamento ? 'Sin municipio' : 'Selecciona el departamento'}
                                    clearLabel="Ninguno"
                                    disabled={!editable || !form.departamento}
                                    ariaLabel="Municipio"
                                />
                            </div>
                            <div className="sm:col-span-2">
                                <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">
                                    Distrito
                                </label>
                                <LiquidSelect
                                    value={form.distrito}
                                    onChange={v => setGeo({ distrito: v || null })}
                                    options={distritoOpts}
                                    placeholder={form.municipio ? 'Sin distrito' : 'Selecciona el municipio'}
                                    clearLabel="Ninguno"
                                    disabled={!editable || !form.municipio}
                                    ariaLabel="Distrito"
                                />
                                {/* El distrito es obligatorio en el receptor de un
                                    DTE 2.0 — decirlo acá evita que se descubra al
                                    momento de facturar. */}
                                {esContribuyente && !form.distrito && (
                                    <p className="text-caption text-warning-text mt-1 ml-1 font-bold">
                                        El DTE de un contribuyente lo pide junto con departamento y municipio.
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Fiscal y notas */}
                    <div className="space-y-3">
                        <SectionHeader icon={ShieldCheck}>Retención y notas</SectionHeader>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <PortalInput
                                name="retencion_pct" label="Retención %" type="number"
                                value={form.retencion_pct} readOnly={!editable}
                                hasError={!!errorDe('retencion_pct')}
                                errorMessage={errorDe('retencion_pct')}
                                helperText="0 a 100"
                                onChange={e => setForm(p => ({ ...p, retencion_pct: e.target.value }))}
                            />
                            <div>
                                <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5">
                                    Origen
                                </p>
                                <div className="flex items-center gap-2 h-10">
                                    {cliente.erp_id
                                        ? <Badge variant="success" icon={Building2}>ERP {cliente.erp_id}</Badge>
                                        : <Badge variant="neutral">Sin portar del ERP</Badge>}
                                </div>
                            </div>
                            <div className="sm:col-span-2">
                                <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">
                                    Notas
                                </label>
                                <PortalTextarea
                                    value={form.notes}
                                    onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                                    rows={3}
                                    readOnly={!editable}
                                    placeholder="Notas internas del portal (no viajan al ERP)"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Barra de guardar fija al fondo — este modal vive en HIDES_FOOTER de
                UnifiedModal, igual que el detalle de proveedor. */}
            {editable && panel === 'ficha' && (
                <div className="sticky bottom-0 -mx-1 px-1 pt-4 pb-1 mt-2 bg-surface-card backdrop-blur-sm border-t border-divider space-y-2">
                    {error && (
                        <Notice variant="danger" icon={AlertTriangle} compact>{error}</Notice>
                    )}
                    {/* Un botón deshabilitado sin explicación es una pared. Se
                        dice qué falta y cómo se llama en el formulario, para
                        que la persona lo encuentre sin adivinar. */}
                    {intentoGuardar && v.faltan.length > 0 && (
                        <Notice variant="warning" icon={AlertTriangle} compact>
                            Falta {v.faltan.length === 1 ? 'un dato' : `${v.faltan.length} datos`} que
                            el DTE exige{esContribuyente ? ' para un contribuyente' : ''}:{' '}
                            <span className="font-black">
                                {v.faltan.map(c => ETIQUETA_CAMPO[c] || c).join(', ')}
                            </span>.
                        </Notice>
                    )}
                    {Object.keys(v.errores).length > 0 && (
                        <Notice variant="danger" icon={AlertTriangle} compact>
                            Revisa{' '}
                            <span className="font-black">
                                {Object.keys(v.errores).map(c => ETIQUETA_CAMPO[c] || c).join(', ')}
                            </span>.
                        </Notice>
                    )}
                    {pideConfirmacion && (
                        <Notice variant="warning" icon={ShieldCheck}
                            action={
                                <Button size="sm" variant="secondary" disabled={guardando}
                                    onClick={() => guardar(true)}>
                                    Confirmar
                                </Button>
                            }>
                            Estás cambiando datos fiscales de un contribuyente: son los que se
                            declaran a Hacienda. Confirma para guardar.
                        </Notice>
                    )}
                    <Button size="lg" disabled={guardando || !hayCambios || !v.ok}
                        title={!hayCambios ? 'No hay cambios que guardar'
                            : !v.ok ? 'Hay datos incompletos o mal escritos' : undefined}
                        onClick={() => guardar(false)}>
                        {guardando
                            ? <><Loader2 size={18} className="animate-spin" /> Guardando…</>
                            : <><Check size={16} strokeWidth={2.5} /> Guardar cambios{hayCambios ? ` (${Object.keys(cambios).length})` : ''}</>}
                    </Button>
                </div>
            )}
        </div>
    );
};

export default FormClienteDetail;
