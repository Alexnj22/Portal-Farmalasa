import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Badge from '../common/Badge';
import { Building2, MapPin, Phone, Smartphone, Map as MapIcon, Navigation, Loader2 } from 'lucide-react';
import { SkeletonText } from '../common/StateViews';
import LiquidSelect from '../common/LiquidSelect';
import LiquidDatePicker from '../common/LiquidDatePicker';
import PortalInput from '../common/PortalInput';
import Notice from '../common/Notice';
import { LazyInput, SeccionDeFormulario, formatPhoneMask } from './BranchHelpers';
import { ubicarEnMapa } from '@nucleo/data/ubicar';
import { ubicacionDesdeDireccion, completarUbicacion, enlaceDelPunto } from '@nucleo/utils/ubicacionDeSucursal';

// El mapa es Google Maps o Leaflet: sólo se carga al abrir este formulario.
const SelectorDeUbicacion = React.lazy(() => import('./SelectorDeUbicacion'));

const POR_QUE_NO = {
    ENLACE_INVALIDO: 'Eso no es un enlace. Copia el botón «Compartir» de Google Maps.',
    NO_ES_DE_MAPS: 'El enlace no es de Google Maps.',
    DOMINIO_NO_PERMITIDO: 'El enlace no es de Google Maps.',
    SIN_COORDENADAS: 'El enlace no trae un punto. Marca la sucursal en el mapa.',
};

// El enlace se resuelve al PEGARLO, no al salir del campo: pegar es el gesto
// entero, y esperar al blur dejaba a la persona mirando un campo que no hacía
// nada. Escribirlo a mano se resuelve al salir.
function CampoDeEnlace({ value, onResolver, ocupado }) {
    const [texto, setTexto] = useState(value || '');
    useEffect(() => { setTexto(value || ''); }, [value]); // eslint-disable-line react-hooks/set-state-in-effect -- sigue al valor guardado
    const resolver = (t) => { const v = t.trim(); if (v && v !== (value || '')) onResolver(v); };
    return (
        <PortalInput
            label="Enlace de Google Maps"
            name="suc-maps"
            icon={MapIcon}
            placeholder="Pega el enlace de «Compartir»"
            value={texto}
            readOnly={ocupado}
            onChange={(e) => setTexto(e.target.value)}
            onPaste={(e) => {
                const pegado = e.clipboardData?.getData('text') || '';
                if (pegado.trim()) { e.preventDefault(); setTexto(pegado.trim()); resolver(pegado); }
            }}
            onBlur={() => resolver(texto)}
        />
    );
}
import { rotuloCampo } from '@nucleo/utils/rotuloDeCampo';

// «Falta info»: el dato no es obligatorio para guardar, pero el expediente de
// la sala queda incompleto sin él. Va en la ranura `labelAction` del canónico
// —no pintando la caja de naranja con `!border-warning`—, así la etiqueta, el
// alto y el foco siguen siendo los de todos los campos.
const FaltaInfo = () => <Badge size="sm" variant="warning" uppercase={false}>Falta info</Badge>;

const BranchTabGeneral = ({
    formData, setFormData, name, openingDate, location,
    departmentList = [], municipalityList = [],
    updateNestedSetting, getTabStatus
}) => {
    const depOptions = useMemo(() => (departmentList || []).map(d => ({ value: d, label: d })), [departmentList]);
    const munOptions = useMemo(() => (municipalityList || []).map(m => ({ value: m, label: m })), [municipalityList]);

    const incompleto = getTabStatus(1) === 'orange';

    // `null` y `''` no son un punto (Number(null) daría 0, o sea el golfo de Guinea).
    const punto = useMemo(() => {
        if (location.lat == null || location.lng == null || location.lat === '' || location.lng === '') return null;
        const la = Number(location.lat), lo = Number(location.lng);
        return Number.isFinite(la) && Number.isFinite(lo) ? { lat: la, lng: lo } : null;
    }, [location.lat, location.lng]);

    // ── Ubicar: del enlace o del pin a la ficha ─────────────────────────────
    // Las coordenadas se escriben siempre (son lo que se eligió). Departamento,
    // municipio y dirección SÓLO si están vacíos —decisión del usuario—; si ya
    // tienen algo distinto, se avisa y no se pisa.
    const [ubicando, setUbicando] = useState(false);
    const [aviso, setAviso] = useState(null);
    const ubicar = useCallback(async ({ enlace, lat, lng }) => {
        setUbicando(true); setAviso(null);
        if (!enlace) {
            // El punto se eligió en el mapa: se guarda ya, y el enlace pasa a
            // ser el de ese punto (el viejo apuntaría a otro lado).
            updateNestedSetting('location', 'lat', lat);
            updateNestedSetting('location', 'lng', lng);
            updateNestedSetting('location', 'mapsUrl', enlaceDelPunto(lat, lng));
        }
        try {
            const r = await ubicarEnMapa(enlace ? { enlace } : { lat, lng });
            if (enlace) {
                updateNestedSetting('location', 'mapsUrl', enlace);
                updateNestedSetting('location', 'lat', r.lat);
                updateNestedSetting('location', 'lng', r.lng);
            }
            const hallado = ubicacionDesdeDireccion(r.address);
            const { cambios, distintos } = completarUbicacion(
                { department: location.department, municipality: location.municipality, address: formData.address },
                hallado);
            if (cambios.department) updateNestedSetting('location', 'department', cambios.department);
            if (cambios.municipality) updateNestedSetting('location', 'municipality', cambios.municipality);
            if (cambios.address) setFormData(prev => ({ ...prev, address: cambios.address }));

            const llenados = [cambios.department && 'departamento', cambios.municipality && 'municipio',
                cambios.address && 'dirección'].filter(Boolean);
            const partes = [];
            if (r.precision === 'vista') partes.push('El enlace no marca un lugar sino una vista del mapa: revisa que el pin quede sobre la sucursal.');
            if (llenados.length) partes.push(`Se completó: ${llenados.join(', ')}.`);
            if (distintos.length) partes.push(`El mapa dice ${distintos.map(d => `${d.campo.toLowerCase()} «${d.mapa}»`).join(' y ')}; se dejó lo que ya tenía la sucursal.`);
            if (!hallado.municipio && !distintos.length) partes.push('No se reconoció el municipio del punto: elígelo de la lista.');
            setAviso(partes.length
                ? { tono: distintos.length || r.precision === 'vista' ? 'warning' : 'success', texto: partes.join(' ') }
                : { tono: 'success', texto: 'Punto guardado.' });
        } catch (e) {
            setAviso({ tono: 'danger', texto: POR_QUE_NO[e?.codigo]
                || (enlace ? 'No se pudo abrir el enlace. Prueba de nuevo o marca la sucursal en el mapa.'
                           : 'El punto quedó guardado, pero no se pudo buscar su dirección.') });
        } finally {
            setUbicando(false);
        }
    }, [location.department, location.municipality, formData.address, updateNestedSetting, setFormData]);
    const sinNombre = getTabStatus(1) === 'red' && !name.trim();

    return (
        <div className="space-y-4 w-full">

            <SeccionDeFormulario icon={Building2} titulo="Identidad">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <LazyInput
                        label="Nombre comercial"
                        name="suc-nombre"
                        required
                        icon={Building2}
                        placeholder="Ej: La Popular Centro"
                        value={name}
                        hasError={sinNombre}
                        onChange={(val) => setFormData(prev => ({ ...prev, name: val, branchName: val }))}
                    />
                    <div>
                        <span className={rotuloCampo('text-content-3')}>Fecha de apertura</span>
                        <LiquidDatePicker
                            value={openingDate}
                            onChange={(val) => setFormData(prev => ({ ...prev, openingDate: val, opening_date: val }))}
                        />
                    </div>
                </div>
            </SeccionDeFormulario>

            <SeccionDeFormulario icon={MapPin} titulo="Ubicación" tono="success">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <span id="suc-depto-rotulo" className={rotuloCampo('text-content-3')}>Departamento</span>
                        <LiquidSelect
                            ariaLabelledBy="suc-depto-rotulo"
                            value={location.department || ""}
                            onChange={(val) => {
                                updateNestedSetting('location', 'department', val);
                                updateNestedSetting('location', 'municipality', '');
                            }}
                            options={depOptions}
                            placeholder="Elegir departamento"
                            clearLabel="Ninguno"
                            icon={MapIcon}
                        />
                    </div>
                    <div>
                        <span id="suc-municipio-rotulo" className={rotuloCampo('text-content-3')}>
                            Distrito / municipio
                            {incompleto && !location.municipality && <FaltaInfo />}
                        </span>
                        <LiquidSelect
                            ariaLabelledBy="suc-municipio-rotulo"
                            value={location.municipality || ""}
                            onChange={(val) => updateNestedSetting('location', 'municipality', val)}
                            options={munOptions}
                            placeholder={location.department ? 'Elegir municipio' : 'Primero el departamento'}
                            clearLabel="Ninguno"
                            icon={Navigation}
                            disabled={!location.department}
                        />
                    </div>

                    <LazyInput
                        label="Dirección exacta"
                        name="suc-direccion"
                        labelAction={incompleto && !formData.address?.trim() ? <FaltaInfo /> : null}
                        icon={MapPin}
                        placeholder="Barrio El Centro, 1ra Av. Norte…"
                        value={formData.address || ""}
                        onChange={(val) => setFormData(prev => ({ ...prev, address: val }))}
                    />
                    <CampoDeEnlace value={location.mapsUrl} ocupado={ubicando}
                        onResolver={(enlace) => ubicar({ enlace })} />

                    {/* El punto se marca en el mapa o sale del enlace. Las
                        coordenadas ya no se escriben a mano: se leen acá. */}
                    <div className="md:col-span-2 flex flex-col gap-2">
                        <React.Suspense fallback={<SkeletonText lines={4} />}>
                            <SelectorDeUbicacion lat={punto?.lat} lng={punto?.lng}
                                onElegir={(lat, lng) => ubicar({ lat, lng })} />
                        </React.Suspense>
                        <p className="text-label text-content-3 tabular-nums">
                            {punto
                                ? `Punto: ${punto.lat.toFixed(6)}, ${punto.lng.toFixed(6)} · toca el mapa o arrastra el pin para corregirlo.`
                                : 'Toca el mapa donde está la sucursal, o pega su enlace de Google Maps.'}
                        </p>
                        {ubicando && <Notice variant="info" icon={Loader2}>Buscando la dirección del punto…</Notice>}
                        {aviso && <Notice variant={aviso.tono} bloque>{aviso.texto}</Notice>}
                    </div>
                </div>
            </SeccionDeFormulario>

            <SeccionDeFormulario icon={Phone} titulo="Contacto" tono="chart-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <LazyInput
                        label="Teléfono fijo"
                        name="suc-telefono"
                        labelAction={incompleto && !formData.phone ? <FaltaInfo /> : null}
                        icon={Phone}
                        inputMode="tel"
                        placeholder="2222-0001"
                        value={formData.phone || ""}
                        onChange={(val) => setFormData(prev => ({ ...prev, phone: formatPhoneMask(val) }))}
                        maxLength={9}
                    />
                    <LazyInput
                        label="Celular / WhatsApp"
                        name="suc-celular"
                        labelAction={incompleto && !formData.cell ? <FaltaInfo /> : null}
                        icon={Smartphone}
                        inputMode="tel"
                        placeholder="7000-0001"
                        value={formData.cell || ""}
                        onChange={(val) => setFormData(prev => ({ ...prev, cell: formatPhoneMask(val) }))}
                        maxLength={9}
                    />
                </div>
            </SeccionDeFormulario>
        </div>
    );
};

export default React.memo(BranchTabGeneral);
