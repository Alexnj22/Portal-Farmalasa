import React, { useMemo } from 'react';
import Badge from '../common/Badge';
import { Building2, MapPin, Phone, Smartphone, Map as MapIcon, Navigation } from 'lucide-react';
import LiquidSelect from '../common/LiquidSelect';
import LiquidDatePicker from '../common/LiquidDatePicker';
import { LazyInput, SeccionDeFormulario, formatPhoneMask } from './BranchHelpers';
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
                    <LazyInput
                        label="Enlace de Google Maps"
                        name="suc-maps"
                        icon={MapIcon}
                        placeholder="https://maps.google.com/…"
                        value={location.mapsUrl || ""}
                        onChange={(val) => updateNestedSetting('location', 'mapsUrl', val)}
                    />

                    {/* La ayuda de las coordenadas va DEBAJO, como prosa — no
                        apretada en la línea del rótulo en letra de 10px. */}
                    <div className="md:col-span-2 grid grid-cols-2 gap-4">
                        <LazyInput
                            label="Latitud"
                            name="suc-lat"
                            inputMode="decimal"
                            placeholder="14.0123456"
                            inputClassName="tabular-nums"
                            value={location.lat ?? ''}
                            onChange={(val) => updateNestedSetting('location', 'lat', val ? Number(val) : null)}
                        />
                        <LazyInput
                            label="Longitud"
                            name="suc-lng"
                            inputMode="decimal"
                            placeholder="-89.1234567"
                            inputClassName="tabular-nums"
                            value={location.lng ?? ''}
                            onChange={(val) => updateNestedSetting('location', 'lng', val ? Number(val) : null)}
                        />
                        <p className="col-span-2 -mt-2 text-label text-content-3">
                            En Google Maps, clic derecho sobre la farmacia: el primer renglón trae la latitud y la longitud.
                        </p>
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
