import React from 'react';
import { Landmark, Zap, Droplet, Wifi, Smartphone, Receipt, DollarSign } from 'lucide-react';

// MOTOR DE ESTADOS FINANCIEROS
const getServiceStatus = (dueDay, paidThrough) => {
    if (!dueDay || !paidThrough) return { state: 'unknown', label: 'Sin Configurar', colorClass: 'border-slate-200/60 bg-slate-50/50 text-slate-500' };

    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const currentDay = today.getDate();

    const [ptYearStr, ptMonthStr] = paidThrough.split('-');
    const ptYear = parseInt(ptYearStr, 10);
    const ptMonth = parseInt(ptMonthStr, 10);

    if (ptYear > currentYear || (ptYear === currentYear && ptMonth >= currentMonth)) {
        return { state: 'paid', label: 'Al Día', colorClass: 'border-emerald-400 bg-emerald-50/50 text-emerald-700 shadow-[0_0_15px_rgba(16,185,129,0.15)] ring-1 ring-emerald-400' };
    }

    if (ptYear === currentYear && ptMonth === currentMonth - 1) {
        if (currentDay > dueDay) {
            return { state: 'expired', label: 'Vencido', colorClass: 'border-red-400 bg-red-50/50 text-red-700 shadow-[0_0_15px_rgba(239,68,68,0.2)] ring-1 ring-red-400' };
        } else {
            return { state: 'pending', label: 'Vence Pronto', colorClass: 'border-amber-400 bg-amber-50/50 text-amber-700 shadow-[0_0_15px_rgba(245,158,11,0.15)] ring-1 ring-amber-400' };
        }
    }

    return { state: 'expired', label: 'Vencido', colorClass: 'border-red-400 bg-red-50/50 text-red-700 shadow-[0_0_15px_rgba(239,68,68,0.2)] ring-1 ring-red-400' };
};

const ServiceExpenseCard = ({ title, provider, amount, dueDay, paidThrough, icon: Icon, onAction, delay = 0, colorTheme = 'blue' }) => {
    const statusObj = getServiceStatus(dueDay, paidThrough);
    const isConfigured = dueDay && paidThrough;
    
    const colorMap = {
        blue: 'text-[#007AFF] bg-blue-50 border-blue-100',
        orange: 'text-orange-500 bg-orange-50 border-orange-100',
        cyan: 'text-cyan-500 bg-cyan-50 border-cyan-100',
        purple: 'text-purple-500 bg-purple-50 border-purple-100',
        emerald: 'text-emerald-500 bg-emerald-50 border-emerald-100',
        slate: 'text-slate-500 bg-slate-50 border-slate-200'
    };

    return (
        <div 
            className={`backdrop-blur-md rounded-[2rem] p-5 transition-all duration-300 animate-in slide-in-from-bottom-4 fade-in fill-mode-both flex flex-col ${statusObj.colorClass}`}
            style={{ animationDelay: `${delay}ms`, willChange: 'transform, opacity' }}
        >
            <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center border shadow-sm ${colorMap[colorTheme]}`}>
                        <Icon size={20} strokeWidth={2}/>
                    </div>
                    <div className="min-w-0 pr-2">
                        <p className="text-[11px] font-black text-slate-800 uppercase tracking-widest truncate">{title}</p>
                        <p className="text-[9px] font-bold text-slate-500 truncate">{provider || 'Sin proveedor'}</p>
                    </div>
                </div>
                <div className="px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest bg-white shadow-sm border border-slate-100">
                    {statusObj.label}
                </div>
            </div>

            <div className="flex-1 flex items-end justify-between mt-2">
                <div>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Monto (Aprox)</p>
                    <p className="text-lg font-black text-slate-800">${amount ? Number(amount).toFixed(2) : '0.00'}</p>
                </div>
                <div className="text-right">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Día de Pago</p>
                    <p className="text-[12px] font-bold text-slate-700">{dueDay ? `Día ${dueDay}` : '-'}</p>
                </div>
            </div>

            <button onClick={onAction} className="mt-4 w-full py-2.5 rounded-xl bg-white border border-slate-200 text-slate-600 font-bold text-[10px] uppercase tracking-widest hover:text-[#007AFF] hover:border-blue-200 transition-all active:scale-95 shadow-sm">
                {isConfigured ? 'Registrar Pago' : 'Configurar Pago'}
            </button>
        </div>
    );
};

const TabExpenses = ({ liveBranch, openModal }) => {
    const rentData = liveBranch?.settings?.rent || {}; 
    const svcData = liveBranch?.settings?.services || {};

    const handleExpenseAction = (serviceKey, isConfigured) => {
        if (!openModal) return;
        if (isConfigured) {
            openModal('registerPayment', { ...liveBranch, _currentService: serviceKey });
        } else {
            openModal('editBranch', liveBranch); 
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-6 border-b border-white/60">
                <div>
                    <h3 className="font-black text-slate-800 uppercase tracking-tight text-lg">Finanzas y Gastos Operativos</h3>
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Control de Pagos de la Sucursal</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="px-4 py-2 bg-blue-50 text-[#007AFF] rounded-xl border border-blue-100 shadow-sm flex items-center gap-2">
                        <DollarSign size={16} strokeWidth={2.5}/>
                        <span className="text-[11px] font-black uppercase tracking-widest">Total Est. Mensual</span>
                        <span className="text-[13px] font-black">${rentData.amount ? Number(rentData.amount).toFixed(2) : '0.00'}</span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <ServiceExpenseCard 
                    title="Arrendamiento" 
                    provider={rentData.landlordName} 
                    amount={rentData.amount} 
                    dueDay={rentData.dueDay} 
                    paidThrough={rentData.paidThrough} 
                    icon={Landmark}
                    colorTheme="purple"
                    delay={0}
                    onAction={() => handleExpenseAction('rent', rentData.dueDay && rentData.paidThrough)}
                />
                <ServiceExpenseCard 
                    title="Energía Eléctrica" 
                    provider={svcData.light?.provider} 
                    amount={svcData.light?.amount} 
                    dueDay={svcData.light?.dueDay} 
                    paidThrough={svcData.light?.paidThrough} 
                    icon={Zap}
                    colorTheme="orange"
                    delay={50}
                    onAction={() => handleExpenseAction('light', svcData.light?.dueDay && svcData.light?.paidThrough)}
                />
                <ServiceExpenseCard 
                    title="Agua Potable" 
                    provider={svcData.water?.provider} 
                    amount={svcData.water?.amount} 
                    dueDay={svcData.water?.dueDay} 
                    paidThrough={svcData.water?.paidThrough} 
                    icon={Droplet}
                    colorTheme="cyan"
                    delay={100}
                    onAction={() => handleExpenseAction('water', svcData.water?.dueDay && svcData.water?.paidThrough)}
                />
                <ServiceExpenseCard 
                    title="Internet Fijo" 
                    provider={svcData.internet?.provider} 
                    amount={svcData.internet?.amount} 
                    dueDay={svcData.internet?.dueDay} 
                    paidThrough={svcData.internet?.paidThrough} 
                    icon={Wifi}
                    colorTheme="blue"
                    delay={150}
                    onAction={() => handleExpenseAction('internet', svcData.internet?.dueDay && svcData.internet?.paidThrough)}
                />
                <ServiceExpenseCard 
                    title="Plan Celular" 
                    provider={svcData.phone?.provider} 
                    amount={svcData.phone?.amount} 
                    dueDay={svcData.phone?.dueDay} 
                    paidThrough={svcData.phone?.paidThrough} 
                    icon={Smartphone}
                    colorTheme="emerald"
                    delay={200}
                    onAction={() => handleExpenseAction('phone', svcData.phone?.dueDay && svcData.phone?.paidThrough)}
                />
                <ServiceExpenseCard 
                    title="Impuestos / Alcaldía" 
                    provider={svcData.taxes?.provider} 
                    amount={svcData.taxes?.amount} 
                    dueDay={svcData.taxes?.dueDay} 
                    paidThrough={svcData.taxes?.paidThrough} 
                    icon={Receipt}
                    colorTheme="slate"
                    delay={250}
                    onAction={() => handleExpenseAction('taxes', svcData.taxes?.dueDay && svcData.taxes?.paidThrough)}
                />
            </div>
        </div>
    );
};

export default TabExpenses;