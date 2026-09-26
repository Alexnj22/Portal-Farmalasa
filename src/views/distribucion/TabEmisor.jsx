import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Building2, Save, Loader2, KeyRound, FlaskConical, AlertTriangle } from 'lucide-react';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalInput from '../../components/common/PortalInput';
import SegmentedControl from '../../components/common/SegmentedControl';
import Interruptor from './Interruptor';
import useBorrador from '../../hooks/useBorrador';
import { useToastStore } from '../../store/toastStore';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { formatearNit } from '../../utils/nitUtils';
import { departamentosMH, municipiosMH, distritosMH } from '../../data/geoCodigosMH';
import { guardarEmisor, mensajeDeDistribucion } from '../../data/distribucion';
import { cargarActividades } from './comun';

// Los datos de la S.A.S. que factura. Salen impresos en cada documento, y el
// NIT, el NRC y la actividad tienen que ser EXACTAMENTE los de su registro en
// Hacienda: si no coinciden, rechaza todo lo que se emita.
//
// El certificado de firma y la contraseña de Hacienda NO se escriben acá: son
// secretos del servidor y quien los tenga puede firmar a nombre de la empresa.

const TIPO_ESTABLECIMIENTO = [
    { value: '04', label: 'Bodega' },
    { value: '02', label: 'Casa matriz' },
    { value: '01', label: 'Sucursal' },
    { value: '07', label: 'Patio' },
];

const VACIO = {
    nombre: '', nombre_comercial: '', nit: '', nrc: '', cod_actividad: '', desc_actividad: '',
    departamento: '04', municipio: '', distrito: '', complemento: '', telefono: '', correo: '',
    establecimiento: 'B001', punto_venta: 'P001', tipo_establecimiento: '04',
    cod_estable_mh: '', cod_punto_venta_mh: '', ambiente: '00', gran_contribuyente: false,
};

export default function TabEmisor({ emisor, puedeConfigurar, onGuardado }) {
    const showToast = useToastStore(s => s.showToast);
    const [f, setF] = useState(VACIO);
    const [actividades, setActividades] = useState([]);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState('');
    const set = (k, v) => setF(p => ({ ...p, [k]: v }));

    useEffect(() => {
        setF(emisor
            ? { ...VACIO, ...Object.fromEntries(Object.entries(emisor).map(([k, v]) => [k, v ?? VACIO[k] ?? ''])), nit: formatearNit(emisor.nit) }
            : VACIO);
    }, [emisor]);
    useEffect(() => {
        cargarActividades().then(setActividades).catch(e => console.error('TabEmisor: actividades', e));
    }, []);

    // Sólo el alta guarda borrador: al editar, los datos ya están en la base.
    const { recuperado, descartar } = useBorrador(!emisor && puedeConfigurar ? 'distribucion-emisor' : null, f,
        { activo: !emisor, vale: (v) => !!v?.nombre?.trim() });
    const repuesto = useRef(false);
    useEffect(() => {
        if (repuesto.current || !recuperado || emisor) return;
        repuesto.current = true;
        setF({ ...VACIO, ...recuperado });
    }, [recuperado, emisor]);

    const nit = f.nit.replace(/\D/g, '');
    const errores = useMemo(() => {
        const e = {};
        if (!f.nombre.trim()) e.nombre = 'Falta la razón social.';
        if (![9, 14].includes(nit.length)) e.nit = 'El NIT tiene 9 o 14 dígitos.';
        if (!/^\d{2,8}$/.test(f.nrc.replace(/\D/g, ''))) e.nrc = 'El NRC son de 2 a 8 dígitos.';
        if (!f.cod_actividad) e.cod_actividad = 'Falta la actividad económica.';
        if (!f.municipio || !f.distrito || !f.complemento.trim()) e.direccion = 'Falta la dirección completa.';
        if (f.telefono.replace(/\D/g, '').length !== 8) e.telefono = 'Un teléfono son ocho dígitos.';
        if (!/^\S+@\S+\.\S+$/.test(f.correo.trim())) e.correo = 'Revisa el correo.';
        if (!/^[MBSP]\d{3}$/.test(f.establecimiento)) e.establecimiento = 'Una letra (M, B, S o P) y tres dígitos. Ej.: B001';
        if (!/^P\d{3}$/.test(f.punto_venta)) e.punto_venta = 'P y tres dígitos. Ej.: P001';
        if (f.cod_estable_mh && f.cod_estable_mh.length !== 4) e.cod_estable_mh = 'Son 4 caracteres.';
        if (f.cod_punto_venta_mh && f.cod_punto_venta_mh.length !== 4) e.cod_punto_venta_mh = 'Son 4 caracteres.';
        return e;
    }, [f, nit]);
    const hayErrores = Object.keys(errores).length > 0;
    const pasaAProduccion = emisor && emisor.ambiente === '00' && f.ambiente === '01';

    const guardar = async () => {
        setGuardando(true);
        setError('');
        try {
            const cambios = {
                nombre: f.nombre.trim(), nombre_comercial: f.nombre_comercial.trim() || null, nit,
                nrc: f.nrc.replace(/\D/g, ''), cod_actividad: f.cod_actividad, desc_actividad: f.desc_actividad,
                departamento: f.departamento, municipio: f.municipio, distrito: f.distrito, complemento: f.complemento.trim(),
                telefono: f.telefono.replace(/\D/g, ''), correo: f.correo.trim(),
                establecimiento: f.establecimiento, punto_venta: f.punto_venta, tipo_establecimiento: f.tipo_establecimiento,
                cod_estable_mh: f.cod_estable_mh || null, cod_punto_venta_mh: f.cod_punto_venta_mh || null,
                ambiente: f.ambiente, gran_contribuyente: f.gran_contribuyente,
            };
            await guardarEmisor(emisor?.id, cambios);
            useStaff.getState().appendAuditLog('DISTRIBUCION_EMISOR', emisor ? String(emisor.id) : 'nuevo',
                { ambiente: f.ambiente, antes: emisor ? { ambiente: emisor.ambiente, nit: emisor.nit } : null });
            descartar();
            showToast('Datos de la empresa guardados', '');
            onGuardado?.();
        } catch (e) {
            setError(mensajeDeDistribucion(e));
        } finally {
            setGuardando(false);
        }
    };

    const ro = !puedeConfigurar;

    return (
        <div className="p-5 md:p-6 space-y-5 max-w-4xl">
            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
            <Notice variant="info" icon={KeyRound}>
                El certificado de firma y la contraseña de Hacienda no se escriben aquí: los carga quien administra el servidor.
                Sin ellos, los documentos se guardan pero no salen hacia Hacienda.
            </Notice>
            {f.ambiente === '00' && (
                <Notice variant="warning" icon={FlaskConical}>
                    Ambiente de PRUEBAS: lo que se emita no tiene validez fiscal. Sirve para la certificación ante Hacienda.
                </Notice>
            )}
            {pasaAProduccion && (
                <Notice variant="danger" icon={AlertTriangle}>
                    Vas a pasar a PRODUCCIÓN: desde que guardes, cada documento es fiscal y cuenta ante Hacienda.
                    Hazlo sólo con la autorización de Hacienda ya recibida.
                </Notice>
            )}

            <section className="flex flex-col gap-3">
                <p className="text-body-sm font-bold text-content flex items-center gap-2"><Building2 size={16} /> Empresa</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <PortalInput label="Razón social" name="nombre" colSpan={2} value={f.nombre} readOnly={ro}
                        hasError={!!errores.nombre} errorMessage={errores.nombre} onChange={(e) => set('nombre', e.target.value)} />
                    <PortalInput label="Nombre comercial" name="nombre_comercial" value={f.nombre_comercial} readOnly={ro}
                        onChange={(e) => set('nombre_comercial', e.target.value)} />
                    <PortalInput label="NIT" name="nit" value={f.nit} readOnly={ro} hasError={!!errores.nit} errorMessage={errores.nit}
                        onChange={(e) => set('nit', e.target.value)} />
                    <PortalInput label="NRC" name="nrc" value={f.nrc} readOnly={ro} hasError={!!errores.nrc} errorMessage={errores.nrc}
                        onChange={(e) => set('nrc', e.target.value)} />
                    <div className="flex items-end">
                        <Interruptor checked={f.gran_contribuyente} disabled={ro} onChange={(v) => set('gran_contribuyente', v)}
                            label="Gran contribuyente (percibe el 1%)" />
                    </div>
                    <div className="sm:col-span-2">
                        <span className="text-caption font-bold text-content-2 block mb-1.5">Actividad económica</span>
                        <LiquidSelect value={f.cod_actividad} options={actividades} disabled={ro || !actividades.length}
                            placeholder={actividades.length ? 'Buscar actividad…' : 'Cargando catálogo…'}
                            onChange={(v) => { const a = actividades.find(x => x.value === v); setF(p => ({ ...p, cod_actividad: v || '', desc_actividad: a?.desc ?? '' })); }} />
                        {errores.cod_actividad && <p className="text-caption text-danger-text mt-1">{errores.cod_actividad}</p>}
                    </div>
                </div>
            </section>

            <section className="flex flex-col gap-3">
                <p className="text-body-sm font-bold text-content">Dirección y contacto</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <LiquidSelect value={f.departamento} placeholder="Departamento" options={departamentosMH()} disabled={ro}
                        onChange={(v) => setF(p => ({ ...p, departamento: v || '', municipio: '', distrito: '' }))} />
                    <LiquidSelect value={f.municipio} placeholder="Municipio" options={municipiosMH(f.departamento)} disabled={ro || !f.departamento}
                        onChange={(v) => setF(p => ({ ...p, municipio: v || '', distrito: '' }))} />
                    <LiquidSelect value={f.distrito} placeholder="Distrito" options={distritosMH(f.departamento, f.municipio)} disabled={ro || !f.municipio}
                        onChange={(v) => set('distrito', v || '')} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <PortalInput label="Complemento" name="complemento" colSpan={2} value={f.complemento} readOnly={ro}
                        hasError={!!errores.direccion} errorMessage={errores.direccion} onChange={(e) => set('complemento', e.target.value)} />
                    <PortalInput label="Teléfono" name="telefono" maskType="PHONE" value={f.telefono} readOnly={ro}
                        hasError={!!errores.telefono} errorMessage={errores.telefono} onChange={(e) => set('telefono', e.target.value)} />
                    <PortalInput label="Correo" name="correo" type="email" value={f.correo} readOnly={ro}
                        hasError={!!errores.correo} errorMessage={errores.correo} onChange={(e) => set('correo', e.target.value)} />
                </div>
            </section>

            <section className="flex flex-col gap-3">
                <p className="text-body-sm font-bold text-content">Punto de emisión</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <PortalInput label="Establecimiento (número de control)" name="establecimiento" value={f.establecimiento} readOnly={ro}
                        hasError={!!errores.establecimiento} errorMessage={errores.establecimiento}
                        onChange={(e) => set('establecimiento', e.target.value.toUpperCase())} />
                    <PortalInput label="Punto de venta (número de control)" name="punto_venta" value={f.punto_venta} readOnly={ro}
                        hasError={!!errores.punto_venta} errorMessage={errores.punto_venta}
                        onChange={(e) => set('punto_venta', e.target.value.toUpperCase())} />
                    <div>
                        <span className="text-caption font-bold text-content-2 block mb-1.5">Tipo de establecimiento</span>
                        <LiquidSelect value={f.tipo_establecimiento} options={TIPO_ESTABLECIMIENTO} clearable={false} disabled={ro}
                            onChange={(v) => set('tipo_establecimiento', v || '04')} />
                    </div>
                    <div />
                    <PortalInput label="Código de establecimiento en Hacienda" name="cod_estable_mh" value={f.cod_estable_mh} readOnly={ro}
                        hasError={!!errores.cod_estable_mh} errorMessage={errores.cod_estable_mh}
                        helperText="Lo asigna Hacienda al registrar la bodega." onChange={(e) => set('cod_estable_mh', e.target.value.toUpperCase())} />
                    <PortalInput label="Código de punto de venta en Hacienda" name="cod_punto_venta_mh" value={f.cod_punto_venta_mh} readOnly={ro}
                        hasError={!!errores.cod_punto_venta_mh} errorMessage={errores.cod_punto_venta_mh}
                        onChange={(e) => set('cod_punto_venta_mh', e.target.value.toUpperCase())} />
                </div>
                <div>
                    <span className="text-caption font-bold text-content-2 block mb-1.5">Ambiente</span>
                    <SegmentedControl value={f.ambiente} onChange={(v) => set('ambiente', v)} disabled={ro}
                        options={[{ value: '00', label: 'Pruebas' }, { value: '01', label: 'Producción' }]} />
                </div>
            </section>

            {!ro && (
                <div className="flex items-center justify-end gap-3">
                    <p className="text-caption text-content-3">{hayErrores ? Object.values(errores)[0] : ''}</p>
                    <Button variant="primary" icon={guardando ? Loader2 : Save} disabled={guardando || hayErrores} onClick={guardar}>
                        Guardar
                    </Button>
                </div>
            )}
        </div>
    );
}
