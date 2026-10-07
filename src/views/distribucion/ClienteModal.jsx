import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Store, Loader2, Save } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import LiquidSelect from '../../components/common/LiquidSelect';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import Interruptor from './Interruptor';
import useBorrador from '@nucleo/hooks/useBorrador';
import { CLIENTE_VACIO, clienteAFormulario, clienteParaGuardar, erroresDeCliente } from '@nucleo/utils/distribucionComercial';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { departamentosMH, municipiosMH, distritosMH } from '@nucleo/data/geoCodigosMH';
import { guardarCliente, mensajeDeDistribucion, fetchRutas } from '@nucleo/data/distribucion';
import { Route } from 'lucide-react';
import { rotuloCampo } from '@nucleo/utils/rotuloDeCampo';
import { DOC_IDENTIDAD, TIPO_CLIENTE, cargarActividades, soloVentaLibre } from './comun';

// La ficha de un cliente de ruta.
//
// Lo que un Crédito Fiscal exige (NIT, NRC, actividad, dirección completa) lo
// vuelve a exigir la base con un CHECK: acá se avisa antes, allá se garantiza.
// La dirección va con los CÓDIGOS de Hacienda y no con texto libre, porque es
// lo que viaja en el documento y un código inventado es un rechazo.
//
// La actividad económica es el catálogo de Hacienda (774 códigos): se carga
// con `import()` al abrir el formulario, no con la vista.

export default function ClienteModal({ cliente, emisorId, puedeEditar, onClose, onGuardado }) {
    const nuevo = !cliente?.id;
    const [f, setF] = useState(() => (nuevo ? { ...CLIENTE_VACIO } : clienteAFormulario(cliente)));
    const [actividades, setActividades] = useState([]);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState('');
    const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

    useEffect(() => {
        cargarActividades().then(setActividades).catch(e => console.error('ClienteModal: actividades', e));
    }, []);
    // La ruta sale de la tabla de rutas (0027), no de un texto a mano: así dos
    // clientes de la misma ruta no pueden quedar en «dos» rutas por una tilde.
    const [rutas, setRutas] = useState([]);
    useEffect(() => { fetchRutas().then(setRutas).catch(e => console.error('ClienteModal: rutas', e)); }, []);

    const { recuperado, descartar } = useBorrador(
        nuevo && emisorId ? `distribucion-cliente-${emisorId}` : null, f,
        { activo: nuevo, vale: (v) => !!v?.nombre?.trim() },
    );
    const repuesto = useRef(false);
    useEffect(() => {
        if (repuesto.current || !recuperado) return;
        repuesto.current = true;
        setF({ ...CLIENTE_VACIO, ...recuperado });
    }, [recuperado]);

    const contribuyente = !!f.nrc.trim();
    const errores = useMemo(() => erroresDeCliente(f), [f]);
    const hayErrores = Object.keys(errores).length > 0;

    const guardar = async () => {
        setGuardando(true);
        setError('');
        try {
            const id = await guardarCliente(clienteParaGuardar(f, { id: cliente?.id, emisorId }));
            descartar();
            // El id va de vuelta: la venta lo usa para dejar elegido al cliente recién creado.
            onGuardado?.(id);
        } catch (e) {
            setError(mensajeDeDistribucion(e));
        } finally {
            setGuardando(false);
        }
    };

    const ro = !puedeEditar;

    return (
        <LiquidModal open onClose={guardando ? undefined : onClose} maxWidth="max-w-3xl" ariaLabel={nuevo ? 'Nuevo cliente' : f.nombre}>
            <LiquidModal.Header>
                <div className="flex items-center gap-2.5 min-w-0">
                    <Store size={18} className="text-brand-text shrink-0" />
                    <h2 className="text-title font-black text-content truncate">{nuevo ? 'Nuevo cliente' : f.nombre}</h2>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body>
                <div className="flex flex-col gap-5">
                    {error && <Notice variant="danger" bloque>{error}</Notice>}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <span className={rotuloCampo()}>Tipo de cliente</span>
                            <LiquidSelect value={f.tipo} onChange={(v) => set('tipo', v || 'tienda')} options={TIPO_CLIENTE}
                                clearable={false} disabled={ro} />
                            {soloVentaLibre(f.tipo) && (
                                <p className="text-caption text-content-3 mt-1">Sólo se le pueden vender productos de venta libre.</p>
                            )}
                        </div>
                        <PortalInput label="Nombre o razón social" name="nombre" value={f.nombre} readOnly={ro}
                            hasError={!!errores.nombre} errorMessage={errores.nombre} onChange={(e) => set('nombre', e.target.value)} />
                        <PortalInput label="Nombre comercial" name="nombre_comercial" value={f.nombre_comercial} readOnly={ro}
                            onChange={(e) => set('nombre_comercial', e.target.value)} helperText="Opcional." />
                        <div>
                            <span className={rotuloCampo()}>Ruta</span>
                            <LiquidSelect value={f.ruta_id ? String(f.ruta_id) : ''} onChange={(v) => set('ruta_id', v ?? '')} disabled={ro}
                                options={rutas.filter(r => r.activo || String(r.id) === String(f.ruta_id)).map(r => ({ value: String(r.id), label: r.nombre }))}
                                placeholder="Sin ruta" clearLabel="Sin ruta" icon={Route} ariaLabel="Ruta" />
                        </div>
                    </div>

                    <div>
                        <p className="text-body-sm font-bold text-content mb-2">Datos fiscales</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <span className={rotuloCampo()}>Documento</span>
                                <LiquidSelect value={f.tipo_documento} onChange={(v) => set('tipo_documento', v || '13')}
                                    options={DOC_IDENTIDAD} clearable={false} disabled={ro} />
                            </div>
                            <PortalInput label="Número" name="num_documento" value={f.num_documento} readOnly={ro}
                                maskType={f.tipo_documento === '13' ? 'DUI' : undefined}
                                hasError={!!errores.num_documento} errorMessage={errores.num_documento}
                                onChange={(e) => set('num_documento', e.target.value)} />
                            <PortalInput label="NRC" name="nrc" value={f.nrc} readOnly={ro}
                                hasError={!!errores.nrc} errorMessage={errores.nrc}
                                helperText={contribuyente ? 'Contribuyente: se le emite Crédito Fiscal.' : 'Sin NRC se le emite Factura.'}
                                onChange={(e) => set('nrc', e.target.value)} />
                            <div className="flex items-end">
                                <Interruptor checked={f.gran_contribuyente} disabled={ro || !contribuyente}
                                    onChange={(v) => set('gran_contribuyente', v)}
                                    label="Gran contribuyente (nos retiene el 1%)" />
                            </div>
                            <div className="sm:col-span-2">
                                <span className={rotuloCampo()}>Actividad económica</span>
                                <LiquidSelect value={f.cod_actividad}
                                    onChange={(v) => { const a = actividades.find(x => x.value === v); setF(p => ({ ...p, cod_actividad: v || '', desc_actividad: a?.desc ?? '' })); }}
                                    options={actividades} placeholder={actividades.length ? 'Buscar actividad…' : 'Cargando catálogo…'}
                                    disabled={ro || !actividades.length} />
                                {errores.cod_actividad && <p className="text-caption text-danger-text mt-1">{errores.cod_actividad}</p>}
                            </div>
                        </div>
                    </div>

                    <div>
                        <p className="text-body-sm font-bold text-content mb-2">Dirección</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <LiquidSelect value={f.departamento} placeholder="Departamento" options={departamentosMH()} disabled={ro}
                                onChange={(v) => setF(p => ({ ...p, departamento: v || '', municipio: '', distrito: '' }))} />
                            <LiquidSelect value={f.municipio} placeholder="Municipio" options={municipiosMH(f.departamento)}
                                disabled={ro || !f.departamento} onChange={(v) => setF(p => ({ ...p, municipio: v || '', distrito: '' }))} />
                            <LiquidSelect value={f.distrito} placeholder="Distrito" options={distritosMH(f.departamento, f.municipio)}
                                disabled={ro || !f.municipio} onChange={(v) => set('distrito', v || '')} />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                            <PortalInput label="Complemento" name="complemento" colSpan={2} value={f.complemento} readOnly={ro}
                                placeholder="Barrio, calle, número, referencia"
                                hasError={!!errores.direccion} errorMessage={errores.direccion}
                                onChange={(e) => set('complemento', e.target.value)} />
                            <PortalInput label="Teléfono" name="telefono" maskType="PHONE" value={f.telefono} readOnly={ro}
                                hasError={!!errores.telefono} errorMessage={errores.telefono} onChange={(e) => set('telefono', e.target.value)} />
                            <PortalInput label="Correo" name="correo" type="email" value={f.correo} readOnly={ro}
                                helperText="Ahí le llega el documento electrónico." onChange={(e) => set('correo', e.target.value)} />
                        </div>
                    </div>

                    <div>
                        <p className="text-body-sm font-bold text-content mb-2">Licencia y crédito</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <PortalInput label="Autorización de la SRS" name="licencia_srs" value={f.licencia_srs} readOnly={ro}
                                helperText="Sin licencia vigente no se le vende." onChange={(e) => set('licencia_srs', e.target.value)} />
                            <div>
                                <span className={rotuloCampo()}>Vence</span>
                                {ro
                                    ? <p className="text-body-sm text-content-2">{f.licencia_srs_vence ? fechaNumerica(f.licencia_srs_vence) : '—'}</p>
                                    : <LiquidDatePicker value={f.licencia_srs_vence} onChange={(v) => set('licencia_srs_vence', v || '')} />}
                            </div>
                            <PortalInput label="Crédito aprobado ($)" name="limite_credito" inputMode="decimal" value={f.limite_credito} readOnly={ro}
                                hasError={!!errores.limite_credito} errorMessage={errores.limite_credito}
                                onChange={(e) => set('limite_credito', e.target.value)} helperText="0 = sólo contado." />
                            <PortalInput label="Plazo (días)" name="plazo_dias" inputMode="numeric" value={f.plazo_dias} readOnly={ro}
                                hasError={!!errores.plazo_dias} errorMessage={errores.plazo_dias}
                                onChange={(e) => set('plazo_dias', e.target.value)} />
                        </div>
                    </div>

                    <PortalTextarea label="Notas" name="notas" value={f.notas} rows={2} readOnly={ro}
                        onChange={(e) => set('notas', e.target.value)} />
                    {!nuevo && (
                        <Interruptor checked={f.activo} disabled={ro} onChange={(v) => set('activo', v)} label="Cliente activo" />
                    )}
                </div>
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <div className="flex flex-wrap items-center justify-between gap-3 w-full">
                    <p className="text-caption text-content-3 min-w-0 flex-1">
                        {hayErrores ? Object.values(errores)[0] : 'Listo para guardar.'}
                    </p>
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" onClick={onClose} disabled={guardando}>{ro ? 'Cerrar' : 'Cancelar'}</Button>
                        {!ro && (
                            <Button variant="primary" icon={guardando ? Loader2 : Save} disabled={guardando || hayErrores} onClick={guardar}>
                                Guardar
                            </Button>
                        )}
                    </div>
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
