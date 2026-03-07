import React from 'react';
import { Landmark, Zap, Droplet, Wifi, Smartphone, Receipt, CalendarCheck, AlertTriangle, CheckCircle, Clock } from 'lucide-react';

const SERVICE_CONFIG = {
    rent: { title: 'Arrendamiento', icon: Landmark, color: 'text-purple-600 bg-purple-50 border-purple-200', ring: 'focus:border-purple-500 focus:ring-purple-500/20', providerLabel: 'Nombre del Arrendador' },
    light: { title: 'Energía Eléctrica', icon: Zap, color: 'text-orange-500 bg-orange-50 border-orange-200', ring: 'focus:border-orange-500 focus:ring-orange-500/20', providerLabel: 'Compañía Eléctrica' },
    water: { title: 'Agua Potable', icon: Droplet, color: 'text-cyan-500 bg-cyan-50 border-cyan-200', ring: 'focus:border-cyan-500 focus:ring-cyan-500/20', providerLabel: 'Servicio de Agua' },
    internet: { title: 'Internet Fijo', icon: Wifi, color: 'text-blue-500 bg-blue-50 border-blue-200', ring: 'focus:border-blue-500 focus:ring-blue-500/20', providerLabel: 'Proveedor ISP' },
    phone: { title: 'Plan Celular', icon: Smartphone, color: 'text-emerald-500 bg-emerald-50 border-emerald-200', ring: 'focus:border-emerald-500 focus:ring-emerald-500/20', providerLabel: 'Telefonía Móvil' },
    taxes: { title: 'Impuestos / Alcaldía', icon: Receipt, color: 'text-slate-600 bg-slate-100 border-slate-300', ring: 'focus:border-slate-500 focus:ring-slate-500/20', providerLabel: 'Alcaldía / Entidad' }
};

const FormServicePayment = ({ formData, setFormData }) => {
    const serviceId = formData._currentService || 'light';
    const config = SERVICE_CONFIG[serviceId];
    const Icon = config.icon;

    // Extraer datos actuales de forma segura
    const settings = formData.settings || {};
    let currentData = {};
    
    if (serviceId === 'rent') {
        currentData = settings.rent || {};
    } else {
        currentData = (settings.services || {})[serviceId] || {};
    }

    // Función para actualizar clonando profundamente para forzar el re-render de React
    const handleChange = (field, value) => {
        const newSettings = JSON.parse(JSON.stringify(settings)); // Clon profundo seguro
        
        if (serviceId === 'rent') {
            if (!newSettings.rent) newSettings.rent = {};
            // Mapeo especial para rent porque su campo se llama landlordName
            const targetField = field === 'provider' ? 'landlordName' : field;
            newSettings.rent[targetField] = value;
        } else {
            if (!newSettings.services) newSettings.services = {};
            if (!newSettings.services[serviceId]) newSettings.services[serviceId] = {};
            newSettings.services[serviceId][field] = value;
        }

        setFormData({ ...formData, settings: newSettings });
    };

    // Mapeo inverso para leer el proveedor
    const providerValue = serviceId === 'rent' ? currentData.landlordName : currentData.provider;

    // Lógica en tiempo real para previsualizar el estado
    const calculatePreviewStatus = () => {
        const { dueDay, paidThrough } = currentData;
        if (!dueDay || !paidThrough) return { state: 'Sin Configurar', color: 'text-slate-500 bg-slate-100 border-slate-200', icon: AlertTriangle };
        
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth() + 1;
        const currentDay = today.getDate();
        
        const [ptYear, ptMonth] = paidThrough.split('-').map(Number);
        
        if (ptYear > currentYear || (ptYear === currentYear && ptMonth >= currentMonth)) {
            return { state: 'Estará Al Día', color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: CheckCircle };
        }
        if (ptYear === currentYear && ptMonth === currentMonth - 1) {
            if (currentDay > parseInt(dueDay, 10)) return { state: 'Estará Vencido', color: 'text-red-700 bg-red-50 border-red-200', icon: AlertTriangle };
            return { state: 'Vence Pronto', color: 'text-amber-700 bg-amber-50 border-amber-200', icon: Clock };
        }
        return { state: 'Estará Vencido', color: 'text-red-700 bg-red-50 border-red-200', icon: AlertTriangle };
    };

    const statusPreview = calculatePreviewStatus();
    const PreviewIcon = statusPreview.icon;

    return (
        <div className="space-y-6">
            <div className={`p-6 rounded-[2rem] border flex items-center justify-between shadow-sm ${config.color}`}>
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center shadow-sm">
                        <Icon size={24} />
                    </div>
                    <div>
                        <h3 className="text-xl font-black tracking-tight">{config.title}</h3>
                        <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">Gestión de Pago y Proveedor</p>
                    </div>
                </div>
                <div className={`px-4 py-2 flex items-center gap-2 rounded-xl border shadow-sm ${statusPreview.color}`}>
                    <PreviewIcon size={16}/>
                    <span className="text-[10px] font-black uppercase tracking-widest">{statusPreview.state}</span>
                </div>
            </div>

            <div className="bg-slate-50/50 border border-slate-200 rounded-[2rem] p-6 shadow-sm space-y-5">
                <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 block">{config.providerLabel}</label>
                    <input 
                        required
                        type="text" 
                        className={`w-full px-4 py-3.5 rounded-[1.25rem] bg-white border border-slate-200 outline-none transition-all font-bold text-slate-800 shadow-sm focus:ring-4 ${config.ring}`} 
                        placeholder={`Ej: Proveedor de ${config.title}`}
                        value={providerValue || ""} 
                        onChange={(e) => handleChange('provider', e.target.value)} 
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 block">Monto Mensual Aprox. ($)</label>
                        <input 
                            required
                            type="number" min="0" step="0.01" 
                            className={`w-full px-4 py-3.5 rounded-[1.25rem] bg-white border border-slate-200 outline-none transition-all font-bold text-slate-800 shadow-sm focus:ring-4 ${config.ring}`} 
                            placeholder="0.00"
                            value={currentData.amount || ""} 
                            onChange={(e) => handleChange('amount', e.target.value === "" ? null : Number(e.target.value))} 
                        />
                    </div>
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 block">Día de Vencimiento (1-31)</label>
                        <input 
                            required
                            type="number" min="1" max="31" 
                            className={`w-full px-4 py-3.5 rounded-[1.25rem] bg-white border border-slate-200 outline-none transition-all font-bold text-slate-800 shadow-sm focus:ring-4 ${config.ring}`} 
                            placeholder="Ej: 15"
                            value={currentData.dueDay || ""} 
                            onChange={(e) => handleChange('dueDay', parseInt(e.target.value, 10))} 
                        />
                    </div>
                </div>

                <div className="pt-4 border-t border-slate-200">
                    <label className="text-[10px] font-black uppercase tracking-widest text-[#007AFF] ml-1 mb-2 flex items-center gap-2">
                        <CalendarCheck size={14}/> Último Mes Pagado
                    </label>
                    <input 
                        required
                        type="month" 
                        className={`w-full px-4 py-3.5 rounded-[1.25rem] bg-white border border-slate-200 outline-none transition-all font-bold text-slate-800 shadow-sm focus:ring-4 ${config.ring}`} 
                        value={currentData.paidThrough || ""} 
                        onChange={(e) => handleChange('paidThrough', e.target.value)} 
                    />
                    <p className="mt-2 text-[10px] font-semibold text-slate-400 ml-2">Selecciona el último mes que fue cubierto en su totalidad. El sistema calculará automáticamente las alertas en base a esto y al día de pago.</p>
                </div>
            </div>
        </div>
    );
};

export default FormServicePayment;