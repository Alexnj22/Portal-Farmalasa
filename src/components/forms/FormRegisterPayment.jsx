import React, { useState, useEffect } from 'react';
import { Receipt, DollarSign, Calendar, UploadCloud, CheckCircle, AlertCircle } from 'lucide-react';

const SERVICE_LABELS = {
    rent: 'Arrendamiento',
    light: 'Energía Eléctrica',
    water: 'Agua Potable',
    internet: 'Internet Fijo',
    phone: 'Plan Celular',
    taxes: 'Impuestos / Alcaldía'
};

// Función para calcular automáticamente el MES SIGUIENTE al último pagado
const getNextMonth = (yyyymm) => {
    if (!yyyymm) return new Date().toISOString().slice(0, 7);
    const [y, m] = yyyymm.split('-').map(Number);
    let nextM = m + 1;
    let nextY = y;
    if (nextM > 12) {
        nextM = 1;
        nextY++;
    }
    return `${nextY}-${String(nextM).padStart(2, '0')}`;
};

const FormRegisterPayment = ({ formData, setFormData }) => {
    const serviceId = formData._currentService || 'light';
    const serviceName = SERVICE_LABELS[serviceId];
    
    // Buscar datos actuales del servicio
    const settings = formData.settings || {};
    const defaultData = serviceId === 'rent' ? (settings.rent || {}) : ((settings.services || {})[serviceId] || {});
    const currentPaidThrough = defaultData.paidThrough; // El último mes que se pagó
    
    const [paymentData, setPaymentData] = useState({
        amount: defaultData.amount || '',
        billing_month: getNextMonth(currentPaidThrough), // Por defecto te sugiere el próximo mes a pagar
        notes: '',
        receiptFile: null
    });

    // Validar si el mes seleccionado ya fue pagado
    const isAlreadyPaid = () => {
        if (!currentPaidThrough || !paymentData.billing_month) return false;
        const [currY, currM] = currentPaidThrough.split('-').map(Number);
        const [selY, selM] = paymentData.billing_month.split('-').map(Number);
        
        // Si el año seleccionado es menor, o es el mismo año pero el mes es menor o igual, ya está pagado
        if (selY < currY || (selY === currY && selM <= currM)) return true;
        return false;
    };

    const isConflict = isAlreadyPaid();

    // Actualizar estado local y enviarlo a UnifiedModal
    const handleUpdate = (field, value) => {
        const updated = { ...paymentData, [field]: value };
        setPaymentData(updated);
        setFormData({ ...formData, _paymentData: updated });
    };

    // Para que apenas abra el modal, ya mande la data por defecto a UnifiedModal
    useEffect(() => {
        setFormData(prev => ({ ...prev, _paymentData: paymentData }));
        // eslint-disable-next-line
    }, []);

    return (
        <div className="space-y-5">
            <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-2xl flex items-center gap-4 shadow-sm">
                <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-emerald-600 shadow-sm shrink-0">
                    <Receipt size={24} strokeWidth={1.5} />
                </div>
                <div>
                    <h3 className="text-[15px] font-black text-emerald-900 tracking-tight">Pago de {serviceName}</h3>
                    <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Sede: {formData.name}</p>
                </div>
            </div>

            <div className="bg-slate-50/50 border border-slate-200 rounded-[1.5rem] p-5 space-y-4">
                
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center gap-1.5"><DollarSign size={12}/> Monto Pagado Exacto</label>
                        <input 
                            required
                            type="number" min="0.01" step="0.01" 
                            className="w-full px-4 py-3 rounded-xl bg-white border border-slate-200 outline-none focus:border-[#007AFF] font-black text-slate-800 text-lg shadow-sm" 
                            placeholder="0.00"
                            value={paymentData.amount} 
                            onChange={(e) => handleUpdate('amount', e.target.value)} 
                        />
                    </div>
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center gap-1.5"><Calendar size={12}/> Mes que Cubre</label>
                        <input 
                            required
                            type="month" 
                            className={`w-full px-4 py-3 rounded-xl bg-white border outline-none font-bold text-slate-700 shadow-sm transition-colors ${isConflict ? 'border-red-400 focus:border-red-500 bg-red-50' : 'border-slate-200 focus:border-[#007AFF]'}`} 
                            value={paymentData.billing_month} 
                            onChange={(e) => handleUpdate('billing_month', e.target.value)} 
                        />
                    </div>
                </div>

                {isConflict && (
                    <div className="flex items-center gap-2 text-red-600 bg-red-50 px-3 py-2 rounded-xl border border-red-200 animate-in fade-in slide-in-from-top-2">
                        <AlertCircle size={14} className="shrink-0"/>
                        <span className="text-[10px] font-black uppercase tracking-widest">Ya existe un pago para {currentPaidThrough} o posterior.</span>
                    </div>
                )}

                <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5">Notas / Observaciones (Opcional)</label>
                    <input 
                        type="text" 
                        className="w-full px-4 py-3 rounded-xl bg-white border border-slate-200 outline-none focus:border-[#007AFF] text-sm shadow-sm" 
                        placeholder="Ej: Incluye recargo por mora"
                        value={paymentData.notes} 
                        onChange={(e) => handleUpdate('notes', e.target.value)} 
                    />
                </div>

                <div className="pt-3 border-t border-slate-100">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Comprobante / Recibo (Foto o PDF)</label>
                    <div className="flex items-center gap-3 cursor-pointer group relative rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-[#007AFF]/30 transition-colors shadow-sm">
                        <div className="p-2 bg-blue-50 rounded-lg group-hover:bg-blue-100 transition-colors shrink-0">
                            <UploadCloud size={16} className="text-[#007AFF]" />
                        </div>
                        <div className="flex-1 min-w-0">
                            {paymentData.receiptFile ? (
                                <p className="text-[12px] text-emerald-600 font-bold truncate flex items-center gap-1.5"><CheckCircle size={14}/> {paymentData.receiptFile.name}</p>
                            ) : (
                                <p className="text-[11px] text-slate-400 font-bold">Subir foto del recibo pagado...</p>
                            )}
                        </div>
                        <input 
                            type="file" accept="application/pdf,image/*" 
                            className="absolute inset-0 opacity-0 cursor-pointer" 
                            onChange={(e) => handleUpdate('receiptFile', e.target.files?.[0] || null)} 
                        />
                    </div>
                </div>
                
            </div>
        </div>
    );
};

export default FormRegisterPayment;