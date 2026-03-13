import React, { useState, useEffect } from 'react';
import { Receipt, DollarSign, Calendar, UploadCloud, CheckCircle, AlertCircle, FileText } from 'lucide-react';
import LiquidDatePicker from '../common/LiquidDatePicker';

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
    if (!yyyymm) {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
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
    const serviceName = SERVICE_LABELS[serviceId] || 'Servicio';

    // Buscar datos actuales del servicio
    const settings = formData.settings || {};
    const defaultData = serviceId === 'rent' ? (settings.rent || {}) : ((settings.services || {})[serviceId] || {});
    const currentPaidThrough = defaultData.paidThrough; // El último mes que se pagó

// 🔴 Detectamos si abrió el modal solo para subir el recibo
    const isPendingMode = formData._isUploadingPendingReceipt;

    const [paymentData, setPaymentData] = useState({
        amount: defaultData.amount || '',
        // Si está subiendo recibo, lo anclamos al mes que debe. Si es nuevo, pasa al siguiente.
        billing_month: isPendingMode ? currentPaidThrough : getNextMonth(currentPaidThrough), 
        notes: '',
        receiptFile: null
    });

    // Validar si el mes seleccionado ya fue pagado
    const isAlreadyPaid = () => {
        if (!currentPaidThrough || !paymentData.billing_month) return false;
        const [currY, currM] = currentPaidThrough.split('-').map(Number);
        const [selY, selM] = paymentData.billing_month.split('-').map(Number);
        if (selY < currY || (selY === currY && selM <= currM)) return true;
        return false;
    };

    // Apagamos la alerta roja si solo está subiendo el recibo pendiente
    const isConflict = !isPendingMode && isAlreadyPaid();

    // Actualizar estado local y enviarlo a UnifiedModal
    const handleUpdate = (field, value) => {
        const updated = { ...paymentData, [field]: value };
        setPaymentData(updated);

        const hasFile = !!updated.receiptFile;
        const fileStatusMsg = hasFile ? 'Comprobante adjunto' : '⚠️ COMPROBANTE PENDIENTE';

        // 🛡️ Preparamos el payload de auditoría y marcamos si el comprobante queda pendiente
        setFormData({
            ...formData,
            _paymentData: {
                ...updated,
                isReceiptPending: !hasFile // El orquestador o la vista usarán esto para exigir la subida después
            },
            _auditPayload: {
                action_type: 'REGISTRO_PAGO_SERVICIO',
                timeline_title: `Pago de ${serviceName}`,
                dimension: 'FINANZAS',
                old_value: currentPaidThrough || 'Sin pagos previos',
                new_value: `Mes: ${updated.billing_month} | Monto: $${updated.amount} | ${fileStatusMsg}`,
                notas: updated.notes || ''
            }
        });
    };

    // Para que apenas abra el modal, ya mande la data por defecto a UnifiedModal (incluyendo auditoría inicial)
    useEffect(() => {
        setFormData(prev => ({ 
            ...prev, 
            _paymentData: {
                ...paymentData,
                isReceiptPending: true // Inicialmente no hay archivo
            },
            _auditPayload: {
                action_type: 'REGISTRO_PAGO_SERVICIO',
                timeline_title: `Pago de ${serviceName}`,
                dimension: 'FINANZAS',
                old_value: currentPaidThrough || 'Sin pagos previos',
                new_value: `Mes: ${paymentData.billing_month} | Monto: $${paymentData.amount} | ⚠️ COMPROBANTE PENDIENTE`,
                notas: paymentData.notes || ''
            }
        }));
        // eslint-disable-next-line
    }, []);

    // Manejador para el archivo
    const handleFileChange = (e) => {
        const file = e.target.files?.[0] || null;
        handleUpdate('receiptFile', file);
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-2">

            {/* 🎨 HEADER LIQUID GLASS */}
            <div className="relative overflow-hidden rounded-[2rem] p-5 border border-emerald-200/60 bg-gradient-to-br from-emerald-50/80 to-emerald-100/40 backdrop-blur-xl shadow-[0_8px_30px_rgba(16,185,129,0.06)]">
                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-300/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4"></div>
                <div className="relative z-10 flex items-center gap-4">
                    <div className="w-14 h-14 bg-white/80 backdrop-blur-md rounded-2xl flex items-center justify-center text-emerald-600 shadow-sm border border-emerald-100 shrink-0">
                        <Receipt size={26} strokeWidth={2} />
                    </div>
                    <div>
                        <h3 className="text-xl font-black text-emerald-950 tracking-tight leading-none mb-1.5">Pago de {serviceName}</h3>
                        <div className="flex items-center gap-2">
                            <span className="px-2.5 py-1 bg-white/60 rounded-md text-[9px] font-black text-emerald-700 uppercase tracking-widest border border-emerald-200/50">
                                Sede: {formData.name}
                            </span>
                            {currentPaidThrough && (
                                <span className="text-[10px] font-bold text-emerald-600/80 uppercase tracking-widest">
                                    Último: {currentPaidThrough}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* 📝 CONTENEDOR DE CAMPOS (GLASSMORPHISM) */}
            <div className="bg-white/40 backdrop-blur-xl border border-white/80 rounded-[2rem] p-6 space-y-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    {/* MONTO EXACTO */}
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 flex items-center gap-1.5">
                            <DollarSign size={12} className="text-[#007AFF]" /> Monto Pagado Exacto
                        </label>
                        <div className="relative group">
                            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                <span className="text-slate-400 font-black text-lg">$</span>
                            </div>
                            <input
                                required
                                type="number"
                                min="0.01"
                                step="0.01"
                                className="w-full pl-9 pr-4 py-3.5 rounded-2xl bg-white/60 border border-slate-200/80 outline-none focus:border-[#007AFF] focus:bg-white font-black text-slate-800 text-lg shadow-sm transition-all group-hover:border-[#007AFF]/50 placeholder:text-slate-300"
                                placeholder="0.00"
                                value={paymentData.amount}
                                onChange={(e) => handleUpdate('amount', e.target.value)}
                            />
                        </div>
                    </div>

                    {/* MES QUE CUBRE (LIQUID DATE PICKER) */}
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 flex items-center gap-1.5">
                            <Calendar size={12} className={isConflict ? "text-red-500" : "text-[#007AFF]"} /> Mes que Cubre
                        </label>
                        <div className={isConflict ? "ring-2 ring-red-400/50 rounded-2xl transition-all" : ""}>
                            <LiquidDatePicker
                                type="month"
                                value={paymentData.billing_month}
                                onChange={(val) => handleUpdate('billing_month', val)}
                                placeholder="Selecciona el mes"
                                required
                            />
                        </div>
                    </div>
                </div>

                {/* ALERTA DE CONFLICTO */}
                {isConflict && (
                    <div className="flex items-center gap-3 text-red-700 bg-red-50/80 backdrop-blur-sm px-4 py-3 rounded-2xl border border-red-200 shadow-[0_4px_15px_rgba(239,68,68,0.1)] animate-in fade-in slide-in-from-top-2">
                        <AlertCircle size={18} className="shrink-0 text-red-500" strokeWidth={2.5} />
                        <span className="text-[11px] font-black uppercase tracking-widest leading-tight">
                            Ya existe un pago registrado para {currentPaidThrough} o posterior.
                        </span>
                    </div>
                )}

                {/* NOTAS / OBSERVACIONES */}
                <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 flex items-center gap-1.5">
                        <FileText size={12} className="text-slate-400" /> Notas / Observaciones (Opcional)
                    </label>
                    <input
                        type="text"
                        className="w-full px-5 py-3.5 rounded-2xl bg-white/60 border border-slate-200/80 outline-none focus:border-[#007AFF] focus:bg-white font-bold text-slate-700 text-sm shadow-sm transition-all hover:border-[#007AFF]/50 placeholder:text-slate-400 placeholder:font-medium"
                        placeholder="Ej: Incluye recargo por mora, ajuste tarifario..."
                        value={paymentData.notes}
                        onChange={(e) => handleUpdate('notes', e.target.value)}
                    />
                </div>

                {/* UPLOAD FILE (ÁREA DE ARRASTRE MEJORADA) */}
                <div className="pt-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 flex items-center gap-1.5">
                        <UploadCloud size={12} className="text-[#007AFF]" /> Comprobante / Recibo (Foto o PDF)
                    </label>

                    <div className={`relative group border-2 border-dashed rounded-[1.5rem] p-6 transition-all duration-300 flex flex-col items-center justify-center text-center cursor-pointer overflow-hidden ${paymentData.receiptFile
                            ? 'bg-emerald-50/50 border-emerald-300 hover:bg-emerald-50'
                            : 'bg-slate-50/50 border-slate-300 hover:bg-[#007AFF]/5 hover:border-[#007AFF]/50'
                        }`}>
                        <input
                            type="file"
                            accept="application/pdf,image/*"
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                            onChange={handleFileChange}
                        />

                        {paymentData.receiptFile ? (
                            <div className="flex flex-col items-center gap-2 animate-in zoom-in-95 duration-300">
                                <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm text-emerald-500 mb-1 border border-emerald-100">
                                    <CheckCircle size={24} strokeWidth={2} />
                                </div>
                                <p className="text-[13px] font-black text-emerald-800 tracking-tight max-w-[200px] truncate">
                                    {paymentData.receiptFile.name}
                                </p>
                                <p className="text-[10px] font-bold text-emerald-600/70 uppercase tracking-widest">
                                    Archivo adjuntado correctamente
                                </p>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center gap-2 transition-transform duration-300 group-hover:-translate-y-1">
                                <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm text-[#007AFF] mb-1 group-hover:shadow-md transition-all">
                                    <UploadCloud size={24} strokeWidth={1.5} />
                                </div>
                                <p className="text-[13px] font-black text-slate-700 tracking-tight">
                                    Toca para subir o arrastra aquí
                                </p>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                    Si no lo subes hoy, quedará como PENDIENTE
                                </p>
                            </div>
                        )}

                        {/* Efecto hover background */}
                        {!paymentData.receiptFile && (
                            <div className="absolute inset-0 bg-gradient-to-t from-[#007AFF]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
};

export default FormRegisterPayment;