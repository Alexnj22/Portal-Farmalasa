import React, { useState } from 'react';
import Button from '../common/Button';
import { useNavigate } from 'react-router-dom';
import { Loader2, Check, Phone, Mail, MapPin, FileText, ExternalLink, Tag, Building2, CheckCircle2 } from 'lucide-react';
import { useStaffStore } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { updateProveedorManual, setProveedorCategoria, setProveedorSupplier } from '../../data/proveedores';
import { departamentoLabel } from '../../utils/svCatalogs';
import LiquidSelect from '../common/LiquidSelect';
import PortalTextarea from '../common/PortalTextarea';
import PortalInput from '../common/PortalInput';
import { mensajeAmigable } from '../../utils/errorMessages';

function SectionHeader({ icon: Icon, children }) {
    return (
        <h4 className="text-label font-black uppercase tracking-widest text-brand-text flex items-center gap-2 pt-5 border-t border-divider">
            <Icon size={13} strokeWidth={2.5} /> {children}
        </h4>
    );
}

const SI_NO = [{ value: 'si', label: 'Sí' }, { value: 'no', label: 'No' }];

// H2 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md): "Percibe 1%" es tri-estado.
// Automático = lo determinan los propios DTE del proveedor (ivaPerci1 > 0);
// Sí/No = corrección manual que congela el campo contra futuros DTE. Antes era
// un booleano plano y CUALQUIER guardado lo fijaba, aunque el usuario hubiera
// venido a cambiar el teléfono — sin forma de volver a automático.
const PERCIBE_OPTIONS = [
    { value: 'auto', label: 'Automático (según sus DTE)' },
    { value: 'si',   label: 'Sí, percibe 1%' },
    { value: 'no',   label: 'No percibe' },
];
const percibeToOption = (override) => override === null || override === undefined ? 'auto' : (override ? 'si' : 'no');
const optionToPercibe = (v) => v === 'auto' ? null : v === 'si';

// Categoría Contable (Costo/Gasto del form del ERP viejo, PLAN-PROVEEDORES-2026-07.md
// §2): NO es un campo propio — se deriva de la `clase` de la categoría asignada.
// Sin categoría todavía, no hay clase que derivar. Antes esto vivía mal
// etiquetado como "Tipo de Proveedor" — es la clasificación del GASTO, no del
// proveedor (corregido 2026-07-22, ver regimen_fiscal abajo para el tipo real).
const CLASE_LABELS = {
    costo: 'Costo (Inventario)',
    gasto_operativo: 'Gasto Operativo',
    gasto_admin: 'Gasto Administrativo',
    otro: 'Otro',
};

// Tipo de Proveedor REAL — régimen fiscal (Código Tributario), derivado
// server-side en get_proveedores_maestro a partir de si tiene NRC (nunca se
// edita a mano, es un hecho fiscal observado en sus propios DTE):
//   - 'contribuyente': tiene NRC, emite CCF/Factura/NC/ND — da derecho a
//     crédito fiscal de IVA.
//   - 'sujeto_excluido': sin NRC (Art. 119 CT), emite Factura de Sujeto
//     Excluido — NO da crédito fiscal, y si es persona natural prestando un
//     servicio, aplica retención de Renta del 10% (Art. 156 CT).
const REGIMEN_LABELS = {
    contribuyente: 'Contribuyente de IVA',
    sujeto_excluido: 'Sujeto Excluido de IVA',
};
const REGIMEN_HINT = {
    contribuyente: 'Tiene NRC — da derecho a crédito fiscal de IVA (Art. 65 Ley IVA)',
    sujeto_excluido: 'Sin NRC — no da crédito fiscal (Art. 119 CT); si es persona natural por un servicio, aplica retención de Renta 10% (Art. 156 CT)',
};

const fmtDate = (d) => {
    if (!d) return '—';
    const s = String(d).slice(0, 10);
    const [y, m, day] = s.split('-');
    if (!y || !m || !day) return '—';
    return `${day}/${m}/${y}`;
};

function FiscalRow({ icon: Icon, label, value }) {
    if (!value) return null;
    return (
        <div className="flex items-start gap-2">
            <Icon size={13} className="text-content-3 mt-0.5 shrink-0" strokeWidth={2} />
            <div className="min-w-0">
                <p className="text-micro font-black uppercase tracking-widest text-content-3">{label}</p>
                <p className="text-body-sm font-medium text-content-2 break-words">{value}</p>
            </div>
        </div>
    );
}

const FormProveedorDetail = ({ formData, onClose }) => {
    const navigate = useNavigate();
    const [form, setForm] = useState({
        contacto_nombre: formData?.contacto_nombre || '',
        telefono2: formData?.telefono2 || '',
        nombre_cheques: formData?.nombre_cheques || '',
        alias: formData?.alias || '',
        notas: formData?.notas || '',
        activo: formData?.activo !== false,
        percibe_1_override: formData?.percibe_1_override ?? null,
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Categoría y match ERP guardan de inmediato al cambiar (mismo patrón que
    // tenían antes en la tabla de ProveedoresView — ahora viven solo acá,
    // a pedido del usuario 2026-07-18), independiente del botón Guardar de
    // los campos manuales de abajo.
    const [categoriaId, setCategoriaId] = useState(formData?.categoria_id || '');
    const [savingCategoria, setSavingCategoria] = useState(false);
    const [supplierId, setSupplierId] = useState(formData?.supplier_id || '');
    const [savingSupplier, setSavingSupplier] = useState(false);
    const [clasifError, setClasifError] = useState('');

    const categorias = formData?.categorias || [];
    const suppliers = formData?.suppliers || [];
    // H3 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md): ProveedoresView ya pasaba
    // canEdit y este form nunca lo leía — un usuario con solo can_view veía
    // todo editable y el botón Guardar, escribía, y recibía el FORBIDDEN crudo
    // que lanzan los RPCs (que sí validan auth_can_edit_any). La UI prometía
    // lo que el servidor rechaza.
    const canEdit = formData?.canEdit !== false;
    const claseActual = categorias.find(c => String(c.id) === String(categoriaId))?.clase;

    const onCategoriaChange = async (val) => {
        setSavingCategoria(true);
        setClasifError('');
        try {
            await setProveedorCategoria(formData.id, val || null);
            useStaffStore.getState().appendAuditLog('PROVEEDORES_SET_CATEGORIA', String(formData.id), {
                nombre: formData.nombre, categoria_id: val || null,
            });
            setCategoriaId(val || '');
            formData?.onSaved?.();
        } catch (e) {
            setClasifError(mensajeAmigable(e, 'No se pudo guardar la categoría'));
        } finally {
            setSavingCategoria(false);
        }
    };

    const onSupplierChange = async (val) => {
        setSavingSupplier(true);
        setClasifError('');
        try {
            await setProveedorSupplier(formData.id, val || null);
            useStaffStore.getState().appendAuditLog('PROVEEDORES_SET_MATCH_ERP', String(formData.id), {
                nombre: formData.nombre, supplier_id: val || null,
            });
            setSupplierId(val || '');
            formData?.onSaved?.();
        } catch (e) {
            setClasifError(mensajeAmigable(e, 'No se pudo guardar el match ERP'));
        } finally {
            setSavingSupplier(false);
        }
    };

    const save = async () => {
        setLoading(true);
        setError('');
        try {
            await updateProveedorManual(formData.id, form);
            useStaffStore.getState().appendAuditLog('PROVEEDORES_UPDATE_MANUAL', String(formData.id), {
                nombre: formData.nombre, ...form,
            });
            useToastStore.getState().showToast('Guardado', 'Proveedor actualizado.', 'success');
            formData?.onSaved?.();
            onClose();
        } catch (e) {
            setError(mensajeAmigable(e, 'No se pudo guardar'));
        } finally {
            setLoading(false);
        }
    };

    // H6 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md): sin rango de fechas el
    // destino abría en el mes actual y mostraba "Sin facturas en el período"
    // para todo proveedor cuya última compra no fuera de este mes — con la
    // fecha de esa última compra visible en este mismo modal. Se manda el mes
    // completo de `ultima_vez_visto`; sin ese dato, el destino usa su default.
    const verDocumentos = () => {
        const params = new URLSearchParams({
            tab: 'documentos',
            q: formData?.nit || formData?.nombre || '',
        });
        const ultima = formData?.ultima_vez_visto ? String(formData.ultima_vez_visto).slice(0, 10) : null;
        if (ultima) {
            const [y, m] = ultima.split('-');
            const finDeMes = new Date(Number(y), Number(m), 0).getDate();
            params.set('desde', `${y}-${m}-01`);
            params.set('hasta', `${y}-${m}-${String(finDeMes).padStart(2, '0')}`);
        }
        onClose();
        navigate(`/facturas-compra?${params.toString()}`);
    };

    return (
        <div className="flex flex-col gap-5 p-1">
            {/* Datos fiscales — solo lectura, vienen del DTE */}
            <div data-surface="card" className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-surface-card-hover/70">
                <FiscalRow icon={FileText} label={formData?.nit ? 'NIT' : 'DUI'} value={formData?.nit || formData?.dui} />
                {formData?.nrc && <FiscalRow icon={FileText} label="NRC" value={formData.nrc} />}
                <FiscalRow icon={FileText} label="Giro" value={formData?.desc_actividad} />
                <FiscalRow icon={MapPin} label="Ubicación" value={[departamentoLabel(formData?.departamento), formData?.municipio ? `Mun. ${formData.municipio}` : null].filter(Boolean).join(' — ')} />
                <FiscalRow icon={MapPin} label="Dirección" value={formData?.direccion} />
                <FiscalRow icon={Phone} label="Teléfono" value={formData?.telefono} />
                <FiscalRow icon={Mail} label="Correo" value={formData?.correo} />

                <div className="col-span-full flex flex-wrap items-center gap-3 pt-2 border-t border-divider text-caption text-content-3">
                    <span>{formData?.docs_count || 0} documento{formData?.docs_count === 1 ? '' : 's'}</span>
                    <span>·</span>
                    <span>Primera vez: {fmtDate(formData?.primera_vez_visto)}</span>
                    <span>·</span>
                    <span>Última: {fmtDate(formData?.ultima_vez_visto)}</span>
                    <Button variant="ghost" onClick={verDocumentos}>Ver documentos <ExternalLink size={11} /></Button>
                </div>
            </div>

            {/* Clasificación — fila superior: hechos que el sistema determina solo
                (no se editan acá). Fila inferior: las 2 decisiones que sí tomás vos.
                Separar ambos pares evita confundir "esto lo pusiste vos" con "esto
                lo dedujo el sistema". */}
            <div className="space-y-3">
                <SectionHeader icon={Tag}>Clasificación</SectionHeader>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block" title={formData?.regimen_fiscal ? REGIMEN_HINT[formData.regimen_fiscal] : 'Sin documentos suficientes para determinarlo'}>
                            Tipo de Proveedor
                        </label>
                        <div className="h-[44px] flex items-center">
                            <span className={`text-body-sm font-bold px-3 py-1.5 rounded-full border ${
                                formData?.regimen_fiscal === 'sujeto_excluido' ? 'text-warning-text bg-warning/10 border-warning/25' : 'text-success-text bg-success/10 border-success/25'
                            }`}>
                                {formData?.regimen_fiscal ? REGIMEN_LABELS[formData.regimen_fiscal] : 'Sin determinar'}
                            </span>
                        </div>
                    </div>
                    <div>
                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block" title="Derivado de la categoría (clase costo/gasto) — no se edita directo">
                            Categoría Contable
                        </label>
                        <div className="h-[44px] flex items-center">
                            <span className="text-body-sm font-bold text-content-2 bg-content-3/10 border border-content-3/20 px-3 py-1.5 rounded-full">
                                {claseActual ? CLASE_LABELS[claseActual] || claseActual : 'Sin categoría asignada'}
                            </span>
                        </div>
                    </div>
                    <div>
                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Categoría</label>
                        <LiquidSelect
                            icon={Tag}
                            value={categoriaId}
                            onChange={onCategoriaChange}
                            options={categorias.map(c => ({ value: c.id, label: c.nombre }))}
                            placeholder={savingCategoria ? 'Guardando…' : 'Sin categoría'}
                            disabled={!canEdit}
                            clearable
                        />
                    </div>
                    <div>
                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Match ERP</label>
                        <LiquidSelect
                            icon={Building2}
                            value={supplierId}
                            onChange={onSupplierChange}
                            options={suppliers.map(s => ({ value: s.id, label: s.nombre }))}
                            placeholder={savingSupplier ? 'Guardando…' : 'Buscar proveedor ERP…'}
                            disabled={!canEdit}
                            clearable
                        />
                    </div>
                    {clasifError && <div className="sm:col-span-2 text-label text-danger-text px-1">{clasifError}</div>}
                </div>
            </div>

            {/* Contacto y pago */}
            <div className="space-y-3">
                <SectionHeader icon={Phone}>Contacto y Pago</SectionHeader>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <PortalInput
                        name="contacto_nombre"
                        label="Contacto"
                        placeholder="Nombre del contacto"
                        value={form.contacto_nombre}
                        readOnly={!canEdit}
                        onChange={e => setForm(p => ({ ...p, contacto_nombre: e.target.value }))}
                    />
                    <PortalInput
                        name="telefono2"
                        label="Teléfono 2"
                        placeholder="Teléfono adicional"
                        value={form.telefono2}
                        readOnly={!canEdit}
                        onChange={e => setForm(p => ({ ...p, telefono2: e.target.value }))}
                    />
                    <PortalInput
                        name="alias"
                        label="Alias"
                        title="Nombre alterno para buscarlo (ej. como le dicen de palabra en Bodega)"
                        placeholder="Nombre alterno de búsqueda"
                        value={form.alias}
                        readOnly={!canEdit}
                        onChange={e => setForm(p => ({ ...p, alias: e.target.value }))}
                    />
                    <PortalInput
                        name="nombre_cheques"
                        label="Nombre para Cheques"
                        placeholder="Si difiere de la razón social"
                        value={form.nombre_cheques}
                        readOnly={!canEdit}
                        onChange={e => setForm(p => ({ ...p, nombre_cheques: e.target.value }))}
                    />
                </div>
            </div>

            {/* Estado y notas */}
            <div className="space-y-3">
                <SectionHeader icon={CheckCircle2}>Estado y Notas</SectionHeader>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Activo</label>
                        <LiquidSelect
                            value={form.activo ? 'si' : 'no'}
                            onChange={(v) => setForm(p => ({ ...p, activo: v === 'si' }))}
                            options={SI_NO}
                            disabled={!canEdit}
                            clearable={false}
                        />
                    </div>
                    <div>
                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block" title="Art. 163 CT — en Automático se enciende solo al observarlo en un DTE; elegir Sí/No lo fija a mano y deja de actualizarse desde los DTE">
                            Percibe 1%
                        </label>
                        <LiquidSelect
                            value={percibeToOption(form.percibe_1_override)}
                            onChange={(v) => setForm(p => ({ ...p, percibe_1_override: optionToPercibe(v) }))}
                            options={PERCIBE_OPTIONS}
                            disabled={!canEdit}
                            clearable={false}
                        />
                        {form.percibe_1_override === null && (
                            <p className="text-caption text-content-3 mt-1 ml-1">
                                Hoy: {formData?.percibe_1 ? 'sí percibe' : 'no percibe'} (observado en sus DTE)
                            </p>
                        )}
                    </div>
                    <div className="sm:col-span-2">
                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Notas</label>
                        <PortalTextarea
                            value={form.notas}
                            onChange={e => setForm(p => ({ ...p, notas: e.target.value }))}
                            rows={3}
                            readOnly={!canEdit}
                            placeholder="Notas internas"
                        />
                    </div>
                </div>
            </div>

            {/* Barra de Guardar fija al fondo del modal — este tipo de modal vive en
                HIDES_FOOTER de UnifiedModal (guardado propio, multi-parte: categoría/
                match ERP se guardan solos al cambiar, aparte de este botón), así que
                no hay footer compartido fuera del área con scroll. `sticky bottom-0`
                lo fija al fondo del viewport visible sin necesitar que el botón viva
                fuera del contenedor scrolleable (pedido del usuario: que se comporte
                como el footer fijo de Nuevo Empleado). */}
            {canEdit && (
            <div className="sticky bottom-0 -mx-1 px-1 pt-4 pb-1 mt-2 bg-surface-card backdrop-blur-sm border-t border-divider">
                {error && <div className="text-label text-danger-text px-1 mb-2">{error}</div>}
                <Button size="lg" disabled={loading} onClick={save}>{loading ? <><Loader2 size={18} className="animate-spin" /> Guardando…</> : <><Check size={16} strokeWidth={2.5} /> Guardar Cambios</>}</Button>
            </div>
            )}
        </div>
    );
};

export default FormProveedorDetail;
