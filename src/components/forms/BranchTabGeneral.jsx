import React, { useMemo } from 'react';
import Badge from '../common/Badge';
import { Building2, MapPin, Phone, Smartphone, Map, Map as MapIcon, Navigation } from 'lucide-react';
import LiquidSelect from '../common/LiquidSelect';
import LiquidDatePicker from '../common/LiquidDatePicker';
import { LazyInput, formatPhoneMask } from './BranchHelpers';

const BranchTabGeneral = ({
    formData, setFormData, name, openingDate, location, 
    departmentList = [], municipalityList = [], // 🚨 Prevención por default
    updateNestedSetting, getTabStatus
}) => {

    // 🚨 FIX DEL ERROR: Agregamos ( || [] ) para asegurar que map nunca lea undefined
    const depOptions = useMemo(() => 
        (departmentList || []).map(d => ({ value: d, label: d }))
    , [departmentList]);

    const munOptions = useMemo(() => 
        (municipalityList || []).map(m => ({ value: m, label: m }))
    , [municipalityList]);

    // 🚨 DISEÑO COMPACTO: p-4 y rounded-3xl para ahorrar espacio vertical
    const islandClass = "bg-surface-card rounded-3xl p-4 md:p-5 border border-border-card shadow-[var(--shadow-glass-3)]";
    const islandHoverClass = "transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-1 hover:shadow-[var(--shadow-glass-4)] hover:bg-surface-card";
    
    // Altura optimizada h-[40px] para encajar perfecto
    const inputHoverClass = "transition-all duration-300 hover:shadow-md hover:border-brand/40 focus-within:ring-4 focus-within:ring-brand/10 focus-within:border-brand/50";

    return (
        // 🚨 COMPRESIÓN: space-y-4 en lugar de space-y-6
        <div className="space-y-4 w-full">
            
            {/* ISLA 1: IDENTIDAD */}
            <div className={`${islandClass} ${islandHoverClass}`}>
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-brand/10 text-brand-text rounded-xl border border-brand/20 shadow-[var(--shadow-shine)]">
                        <Building2 size={16} strokeWidth={2.5} />
                    </div>
                    <h4 className="text-body-sm font-black uppercase tracking-widest text-content">Identidad de Sucursal</h4>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 flex items-center justify-between transition-colors">
                            Nombre Comercial * {getTabStatus(1) === 'red' && !name.trim() && <Badge variant="danger" uppercase={false}>Requerido</Badge>}
                        </label>
                        <LazyInput
                            required
                            icon={Building2}
                            placeholder="Ej: La Popular Centro"
                            value={name}
                            onChange={(val) => setFormData(prev => ({ ...prev, name: val, branchName: val }))}
                            className={`!bg-surface-card shadow-sm h-[40px] text-body ${inputHoverClass} ${getTabStatus(1) === 'red' && !name.trim() ? '!border-danger !bg-danger/10 hover:!border-danger' : 'border-divider'}`}
                        />
                    </div>
                    <div>
                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Fecha de Apertura</label>
                        <div className={`bg-surface-card rounded-2xl border border-divider shadow-sm flex items-center h-[40px] px-1.5 relative z-tabs ${inputHoverClass}`}>
                            <LiquidDatePicker
                                value={openingDate}
                                onChange={(val) => setFormData(prev => ({ ...prev, openingDate: val, opening_date: val }))}
                                placeholder="DD/MM/AAAA"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* ISLA 2: UBICACIÓN */}
            <div className={`${islandClass} ${islandHoverClass}`}>
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-success/10 text-success rounded-xl border border-success/30 shadow-[var(--shadow-shine)]">
                        <MapPin size={16} strokeWidth={2.5} />
                    </div>
                    <h4 className="text-body-sm font-black uppercase tracking-widest text-content">Ubicación Geográfica</h4>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="relative z-content"> 
                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Departamento</label>
                        <LiquidSelect
                            value={location.department || ""}
                            onChange={(val) => {
                                updateNestedSetting('location', 'department', val);
                                updateNestedSetting('location', 'municipality', '');
                            }}
                            options={depOptions}
                            placeholder="-- Seleccionar --"
                            icon={MapIcon}
                        />
                    </div>

                    <div className="relative z-base">
                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 flex items-center justify-between">
                            Distrito / Municipio
                            {getTabStatus(1) === 'orange' && !location.municipality && <Badge variant="warning" uppercase={false}>Falta info</Badge>}
                        </label>
                        <LiquidSelect
                            value={location.municipality || ""}
                            onChange={(val) => updateNestedSetting('location', 'municipality', val)}
                            options={munOptions}
                            placeholder={location.department ? '-- Seleccionar --' : 'Elija Depto.'}
                            icon={Navigation}
                            disabled={!location.department}
                        />
                    </div>

                    <div>
                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 flex items-center justify-between">
                            Dirección Exacta
                            {getTabStatus(1) === 'orange' && !formData.address?.trim() && <Badge variant="warning" uppercase={false}>Falta info</Badge>}
                        </label>
                        <LazyInput
                            placeholder="Barrio El Centro, 1ra Av. Norte..."
                            value={formData.address || ""}
                            onChange={(val) => setFormData(prev => ({ ...prev, address: val }))}
                            className={`!bg-surface-card shadow-sm h-[40px] text-body ${inputHoverClass} ${getTabStatus(1) === 'orange' && !formData.address?.trim() ? '!border-warning !bg-warning/10 hover:!border-warning' : 'border-divider'}`}
                        />
                    </div>
                    <div>
                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Enlace Google Maps</label>
                        <LazyInput
                            icon={Map}
                            placeholder="https://maps.google.com/..."
                            value={location.mapsUrl || ""}
                            onChange={(val) => updateNestedSetting('location', 'mapsUrl', val)}
                            className={`!bg-surface-card border-divider shadow-sm h-[40px] text-body ${inputHoverClass}`}
                        />
                    </div>

                    {/* Coordenadas GPS */}
                    <div className="md:col-span-2">
                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 flex items-center gap-2">
                            <Navigation size={10} />
                            Coordenadas GPS
                            <span className="normal-case tracking-normal font-medium text-content-3 text-micro">
                                · Google Maps → click derecho → "¿Qué hay aquí?" → copiar lat, lng
                            </span>
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-micro font-semibold text-content-2 ml-1 mb-1 block uppercase tracking-widest">Latitud</label>
                                <LazyInput
                                    placeholder="14.0123456"
                                    value={String(location.lat || '')}
                                    onChange={(val) => updateNestedSetting('location', 'lat', val ? Number(val) : null)}
                                    className={`!bg-surface-card border-divider shadow-sm h-[40px] text-body font-mono ${inputHoverClass}`}
                                />
                            </div>
                            <div>
                                <label className="text-micro font-semibold text-content-2 ml-1 mb-1 block uppercase tracking-widest">Longitud</label>
                                <LazyInput
                                    placeholder="-89.1234567"
                                    value={String(location.lng || '')}
                                    onChange={(val) => updateNestedSetting('location', 'lng', val ? Number(val) : null)}
                                    className={`!bg-surface-card border-divider shadow-sm h-[40px] text-body font-mono ${inputHoverClass}`}
                                />
                            </div>
                        </div>
                        {location.lat && location.lng && (
                            <p className="text-micro text-success-text font-semibold mt-1.5 ml-1">
                                ✓ {Number(location.lat).toFixed(6)}, {Number(location.lng).toFixed(6)}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* ISLA 3: CONTACTO */}
            <div className={`${islandClass} ${islandHoverClass}`}>
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-chart-3/10 text-chart-3-text rounded-xl border border-chart-3/30 shadow-[var(--shadow-shine)]">
                        <Phone size={16} strokeWidth={2.5} />
                    </div>
                    <h4 className="text-body-sm font-black uppercase tracking-widest text-content">Canales de Contacto</h4>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 flex items-center justify-between">
                            Teléfono Fijo
                            {getTabStatus(1) === 'orange' && !formData.phone && <Badge variant="warning" uppercase={false}>Falta info</Badge>}
                        </label>
                        <LazyInput
                            icon={Phone}
                            placeholder="2222-0001"
                            value={formData.phone || ""}
                            onChange={(val) => setFormData(prev => ({ ...prev, phone: formatPhoneMask(val) }))}
                            maxLength={9}
                            className={`!bg-surface-card shadow-sm h-[40px] text-body ${inputHoverClass} ${getTabStatus(1) === 'orange' && !formData.phone ? '!border-warning !bg-warning/10 hover:!border-warning' : 'border-divider'}`}
                        />
                    </div>
                    <div>
                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 flex items-center justify-between">
                            Celular / WhatsApp
                            {getTabStatus(1) === 'orange' && !formData.cell && <Badge variant="warning" uppercase={false}>Falta info</Badge>}
                        </label>
                        <LazyInput
                            icon={Smartphone}
                            placeholder="7000-0001"
                            value={formData.cell || ""}
                            onChange={(val) => setFormData(prev => ({ ...prev, cell: formatPhoneMask(val) }))}
                            maxLength={9}
                            className={`!bg-surface-card shadow-sm h-[40px] text-body ${inputHoverClass} ${getTabStatus(1) === 'orange' && !formData.cell ? '!border-warning !bg-warning/10 hover:!border-warning' : 'border-divider'}`}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default React.memo(BranchTabGeneral);