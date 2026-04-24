import React, { useMemo, useState, useEffect } from 'react';
import { Landmark, Zap, Droplet, Wifi, Smartphone, Receipt, DollarSign, AlertCircle, UploadCloud, TrendingUp, TrendingDown, BarChart3, Activity } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

// 🚨 IMPORTACIÓN CORRECTA
import { supabase } from '../../supabaseClient'; 

// ============================================================================
// MOTOR DE ESTADOS FINANCIEROS
// ============================================================================
const getServiceStatus = (dueDay, paidThrough, isReceiptPending) => {
    if (!dueDay || !paidThrough) return { state: 'unknown', label: 'Sin Configurar', colorClass: 'border-slate-200/60 bg-slate-50/50 text-slate-500' };

    if (isReceiptPending) {
        return {
            state: 'pending_receipt',
            label: 'Recibo Pendiente',
            colorClass: 'border-fuchsia-400 bg-fuchsia-50/50 text-fuchsia-700 shadow-[0_0_15px_rgba(217,70,239,0.15)] ring-1 ring-fuchsia-400'
        };
    }

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

// ============================================================================
// TARJETA DE SERVICIO (LIQUID GLASS BENTO)
// ============================================================================
const ServiceExpenseCard = ({ title, provider, amount, dueDay, paidThrough, isReceiptPending, icon: Icon, onAction, onUploadReceipt, delay = 0, colorTheme = 'blue' }) => {
    const statusObj = getServiceStatus(dueDay, paidThrough, isReceiptPending);
    const isConfigured = dueDay && paidThrough;
    const isPendingReceipt = statusObj.state === 'pending_receipt';

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
            className={`group relative backdrop-blur-md rounded-[2rem] p-5 transition-all duration-500 animate-in slide-in-from-bottom-4 fade-in fill-mode-both flex flex-col hover:-translate-y-1 hover:shadow-lg ${statusObj.colorClass} ${isPendingReceipt ? 'animate-pulse' : ''}`}
            style={{ animationDelay: `${delay}ms`, willChange: 'transform, opacity' }}
        >
            <div className="absolute inset-0 bg-white/40 rounded-[2rem] opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>

            <div className="flex justify-between items-start mb-4 relative z-10">
                <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center border shadow-sm transition-transform duration-300 group-hover:scale-110 ${isPendingReceipt ? 'text-fuchsia-600 bg-white border-fuchsia-200' : colorMap[colorTheme]}`}>
                        {isPendingReceipt ? <AlertCircle size={20} strokeWidth={2}/> : <Icon size={20} strokeWidth={2} />}
                    </div>
                    <div className="min-w-0 pr-2">
                        <p className="text-[11px] font-black text-slate-800 uppercase tracking-widest truncate">{title}</p>
                        <p className="text-[9px] font-bold text-slate-500 truncate">{provider || 'Sin proveedor'}</p>
                    </div>
                </div>
                <div className={`px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest shadow-sm border transition-colors duration-300 ${isPendingReceipt ? 'bg-fuchsia-600 text-white border-fuchsia-700' : 'bg-white border-slate-100 group-hover:bg-slate-50'}`}>
                    {statusObj.label}
                </div>
            </div>

            <div className="flex-1 flex items-end justify-between mt-2 relative z-10">
                <div>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Monto (Aprox)</p>
                    <p className="text-lg font-black text-slate-800">${amount ? Number(amount).toFixed(2) : '0.00'}</p>
                </div>
                <div className="text-right">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">
                        {isPendingReceipt ? 'Mes Pagado' : 'Día de Pago'}
                    </p>
                    <p className="text-[12px] font-bold text-slate-700">
                        {isPendingReceipt ? paidThrough : (dueDay ? `Día ${dueDay}` : '-')}
                    </p>
                </div>
            </div>

            {isPendingReceipt ? (
                <button
                    onClick={onUploadReceipt}
                    className="mt-4 w-full py-2.5 rounded-xl bg-fuchsia-600 border border-fuchsia-700 text-white font-black text-[10px] uppercase tracking-widest hover:bg-fuchsia-700 transition-all active:scale-95 shadow-[0_4px_15px_rgba(217,70,239,0.3)] flex items-center justify-center gap-2 relative z-10"
                >
                    <UploadCloud size={14} strokeWidth={2.5} /> Subir Comprobante
                </button>
            ) : (
                <button
                    onClick={onAction}
                    className="mt-4 w-full py-2.5 rounded-xl bg-white/80 backdrop-blur-sm border border-slate-200 text-slate-600 font-bold text-[10px] uppercase tracking-widest hover:text-[#007AFF] hover:border-blue-200 hover:bg-white transition-all active:scale-95 shadow-sm relative z-10"
                >
                    {isConfigured ? 'Registrar Pago' : 'Configurar Pago'}
                </button>
            )}
        </div>
    );
};

// ============================================================================
// TOOLTIP PERSONALIZADO PARA RECHARTS
// ============================================================================
const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-white/80 backdrop-blur-xl border border-white/50 p-4 rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">{label}</p>
                <p className="text-base font-black text-slate-800 flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#007AFF] shadow-sm"></span>
                    ${payload[0].value.toFixed(2)}
                </p>
            </div>
        );
    }
    return null;
};

// ============================================================================
// COMPONENTE PRINCIPAL DE LA PESTAÑA
// ============================================================================
const TabExpenses = ({ liveBranch, openModal, branchType }) => {
    const hasServices = !branchType || branchType === 'FARMACIA';
    const rentData = liveBranch?.settings?.rent || {};
    const svcData = liveBranch?.settings?.services || {};

    const [historicalData, setHistoricalData] = useState([]);
    const [isLoadingData, setIsLoadingData] = useState(true);

    // 🔴 FETCH DE DATOS REALES DE SUPABASE
    useEffect(() => {
        const fetchExpensesData = async () => {
            if (!liveBranch?.id) return;
            setIsLoadingData(true);
            try {
                // Traemos los gastos pagados de los últimos 6 meses
                const { data, error } = await supabase
                    .from('branch_expenses')
                    .select('billing_month, amount, expense_type')
                    .eq('branch_id', liveBranch.id)
                    .eq('status', 'PAGADO')
                    .order('billing_month', { ascending: true })
                    .limit(100); 

                if (error) throw error;

                // Agrupamos por mes (billing_month)
                const groupedData = data.reduce((acc, curr) => {
                    const monthKey = curr.billing_month; 
                    if (!acc[monthKey]) {
                        const [year, month] = monthKey.split('-');
                        const dateObj = new Date(year, parseInt(month) - 1, 1);
                        const label = dateObj.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }).replace('.', '').replace(' ', ' ');
                        
                        acc[monthKey] = { name: label.toUpperCase(), total: 0, rawMonth: monthKey };
                    }
                    acc[monthKey].total += Number(curr.amount);
                    return acc;
                }, {});

                // Convertimos el objeto a un arreglo y tomamos solo los últimos 6 meses
                let chartData = Object.values(groupedData).sort((a, b) => a.rawMonth.localeCompare(b.rawMonth)).slice(-6);

                // Si no hay datos suficientes, rellenamos para que el gráfico no se vea vacío
                if (chartData.length === 0) {
                     const d = new Date();
                     const label = d.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }).replace('.', '').toUpperCase();
                     chartData = [{ name: label, total: 0 }];
                }

                setHistoricalData(chartData);

            } catch (err) {
                console.error("Error cargando historial de gastos:", err);
            } finally {
                setIsLoadingData(false);
            }
        };

        fetchExpensesData();
    }, [liveBranch?.id]);


    const handleExpenseAction = (serviceKey, isConfigured) => {
        if (!openModal) return;
        if (isConfigured) {
            openModal('registerPayment', { ...liveBranch, _currentService: serviceKey });
        } else {
            openModal('editBranch', liveBranch);
        }
    };

    const handleUploadReceiptAction = (serviceKey) => {
        if (!openModal) return;
        openModal('registerPayment', { ...liveBranch, _currentService: serviceKey, _isUploadingPendingReceipt: true });
    };

    const totalMonthlyEst = useMemo(() => {
        let total = 0;
        const isRented = liveBranch?.settings?.propertyType === 'RENTED' || liveBranch?.propertyType === 'RENTED' || liveBranch?.propertyType === 'ALQUILADO';

        if (isRented && rentData.amount) total += Number(rentData.amount) || 0;
        if (hasServices && svcData.light?.amount) total += Number(svcData.light.amount) || 0;
        if (hasServices && svcData.water?.amount) total += Number(svcData.water.amount) || 0;
        if (hasServices && svcData.internet?.amount) total += Number(svcData.internet.amount) || 0;
        if (svcData.phone?.amount) total += Number(svcData.phone.amount) || 0;
        if (svcData.taxes?.amount) total += Number(svcData.taxes.amount) || 0;

        return total;
    }, [rentData, svcData, liveBranch]);


    // Cálculo de estadísticas basado en datos reales
    const stats = useMemo(() => {
        if (!historicalData || historicalData.length < 2) {
            return { variation: 0, isUp: false, highestService: 'Sin datos suficientes' };
        }
        const currentMonth = historicalData[historicalData.length - 1].total;
        const lastMonth = historicalData[historicalData.length - 2].total;
        const variation = lastMonth > 0 ? ((currentMonth - lastMonth) / lastMonth) * 100 : 0;
        
        // Determinar el servicio más caro de la configuración actual
        let maxServiceStr = 'Arrendamiento';
        let maxVal = rentData.amount ? Number(rentData.amount) : 0;

        const checkService = (key, name) => {
            const val = svcData[key]?.amount ? Number(svcData[key].amount) : 0;
            if (val > maxVal) { maxVal = val; maxServiceStr = name; }
        };

        checkService('light', 'Energía Eléctrica');
        checkService('water', 'Agua Potable');
        checkService('internet', 'Internet Fijo');
        checkService('phone', 'Plan Celular');
        checkService('taxes', 'Impuestos');

        return {
            variation,
            isUp: variation > 0,
            highestService: maxVal > 0 ? maxServiceStr : 'Sin pagos'
        };
    }, [historicalData, rentData, svcData]);


    return (
        <div className="space-y-6">
            
            {/* HEADER PRINCIPAL */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4 pb-4 border-b border-white/60">
                <div>
                    <h3 className="font-black text-slate-800 uppercase tracking-tight text-lg">Finanzas y Gastos Operativos</h3>
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Control de Pagos de la Sucursal</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="px-4 py-2 bg-emerald-50 text-emerald-600 rounded-[1.25rem] border border-emerald-100/50 shadow-sm flex items-center gap-2 backdrop-blur-md">
                        <DollarSign size={16} strokeWidth={2.5} />
                        <span className="text-[11px] font-black uppercase tracking-widest">Total Operativo Actual</span>
                        <span className="text-[14px] font-black">${totalMonthlyEst.toFixed(2)}</span>
                    </div>
                </div>
            </div>

            {/* 📊 DASHBOARD ANALÍTICO (SKELETON VS REAL) */}
            {isLoadingData ? (
                /* SKELETON DE CARGA DASHBOARD */
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8 animate-pulse">
                    {/* Gráfico Skeleton */}
                    <div className="lg:col-span-2 bg-white/40 border border-white/50 rounded-[2rem] p-6 shadow-sm flex flex-col min-h-[280px]">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-12 h-12 bg-slate-200/50 rounded-[1.25rem]"></div>
                            <div className="flex flex-col gap-2 w-1/3">
                                <div className="h-3.5 bg-slate-300/50 rounded-full w-3/4"></div>
                                <div className="h-2.5 bg-slate-300/50 rounded-full w-1/2"></div>
                            </div>
                        </div>
                        <div className="flex-1 flex items-end justify-between gap-4 px-2 border-b border-slate-200/50 pb-2">
                            <div className="w-full bg-slate-300/40 rounded-t-lg h-[40%]"></div>
                            <div className="w-full bg-slate-300/40 rounded-t-lg h-[60%]"></div>
                            <div className="w-full bg-slate-300/40 rounded-t-lg h-[30%]"></div>
                            <div className="w-full bg-slate-300/40 rounded-t-lg h-[80%]"></div>
                            <div className="w-full bg-slate-300/40 rounded-t-lg h-[50%]"></div>
                            <div className="w-full bg-[#007AFF]/30 rounded-t-lg h-[90%] relative overflow-hidden">
                                <div className="absolute inset-0 bg-gradient-to-t from-transparent to-white/20 animate-pulse"></div>
                            </div>
                        </div>
                    </div>

                    {/* Métricas Rápidas Skeleton */}
                    <div className="flex flex-col gap-5">
                        <div className="bg-white/40 border border-white/50 rounded-[2rem] p-6 flex-1 flex flex-col justify-center gap-3 shadow-sm">
                            <div className="flex items-center gap-2">
                                <div className="w-4 h-4 rounded-full bg-slate-200/60"></div>
                                <div className="h-2.5 bg-slate-300/50 rounded-full w-1/2"></div>
                            </div>
                            <div className="h-8 bg-slate-300/50 rounded-lg w-1/3 mt-2"></div>
                        </div>
                        <div className="bg-amber-50/40 border border-amber-100/50 rounded-[2rem] p-6 flex-1 flex flex-col justify-center gap-3 shadow-sm">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg bg-amber-200/50"></div>
                                <div className="h-2.5 bg-amber-200/80 rounded-full w-1/2"></div>
                            </div>
                            <div className="h-5 bg-amber-300/50 rounded-lg w-2/3 mt-2"></div>
                        </div>
                    </div>
                </div>
            ) : (
                /* DASHBOARD REAL */
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8 animate-in fade-in duration-500 slide-in-from-bottom-4">
                    {/* Gráfico de Barras */}
                    <div className="group lg:col-span-2 bg-white/40 backdrop-blur-xl border border-white/80 rounded-[2rem] p-6 shadow-[0_8px_30px_rgba(0,0,0,0.04)] flex flex-col relative overflow-hidden transition-all duration-500 hover:shadow-[0_12px_40px_rgba(0,122,255,0.08)]">
                        <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-[#007AFF]/5 to-transparent pointer-events-none transition-opacity duration-500 group-hover:opacity-100 opacity-50"></div>
                        
                        <div className="flex justify-between items-start mb-6 relative z-10">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 bg-white/80 text-[#007AFF] rounded-[1.25rem] flex items-center justify-center border border-white shadow-sm transition-transform duration-500 group-hover:scale-110">
                                    <BarChart3 size={22} strokeWidth={2.5}/>
                                </div>
                                <div>
                                    <h4 className="text-[14px] font-black text-slate-800 uppercase tracking-widest leading-none mb-1">Tendencia de Gastos</h4>
                                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Últimos 6 meses operacionales</p>
                                </div>
                            </div>
                        </div>

                        <div className="flex-1 min-h-[180px] w-full relative z-10">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={historicalData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#007AFF" stopOpacity={0.9}/>
                                            <stop offset="95%" stopColor="#007AFF" stopOpacity={0.1}/>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" opacity={0.5} />
                                    <XAxis 
                                        dataKey="name" 
                                        axisLine={false} 
                                        tickLine={false} 
                                        tick={{ fill: '#64748B', fontSize: 10, fontWeight: 800 }} 
                                        dy={10}
                                    />
                                    <YAxis 
                                        axisLine={false} 
                                        tickLine={false} 
                                        tick={{ fill: '#94A3B8', fontSize: 10, fontWeight: 800 }}
                                        tickFormatter={(value) => `$${value}`}
                                    />
                                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0, 122, 255, 0.04)', rx: 8 }} />
                                    <Bar 
                                        dataKey="total" 
                                        fill="url(#colorTotal)" 
                                        radius={[8, 8, 8, 8]} 
                                        barSize={36}
                                        className="transition-all duration-300 hover:opacity-90"
                                    >
                                        {historicalData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={index === historicalData.length - 1 ? '#007AFF' : 'url(#colorTotal)'} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Métricas Rápidas */}
                    <div className="flex flex-col gap-5">
                        
                        {/* Tarjeta de Variación Mensual */}
                        <div className="group bg-white/50 backdrop-blur-xl border border-white/80 rounded-[2rem] p-6 shadow-sm flex-1 flex flex-col justify-center transition-all duration-500 hover:shadow-md hover:-translate-y-1 relative overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
                            <div className="flex items-center gap-2 mb-3 relative z-10">
                                <Activity size={16} className="text-slate-400 transition-colors duration-300 group-hover:text-slate-600" strokeWidth={2.5}/>
                                <h5 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Variación vs Mes Anterior</h5>
                            </div>
                            <div className="flex items-end gap-3 relative z-10">
                                <span className="text-3xl font-black text-slate-800 tracking-tight">
                                    {Math.abs(stats.variation).toFixed(1)}%
                                </span>
                                <div className={`flex items-center gap-1 mb-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest shadow-sm border ${stats.isUp ? 'bg-red-50 text-red-600 border-red-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>
                                    {stats.isUp ? <TrendingUp size={12} strokeWidth={3}/> : <TrendingDown size={12} strokeWidth={3}/>}
                                    {stats.isUp ? 'Aumento' : 'Ahorro'}
                                </div>
                            </div>
                        </div>

                        {/* Tarjeta de Servicio Más Caro */}
                        <div className="group bg-gradient-to-br from-amber-50/90 to-amber-100/50 backdrop-blur-xl border border-amber-200/60 rounded-[2rem] p-6 shadow-sm flex-1 flex flex-col justify-center relative overflow-hidden transition-all duration-500 hover:shadow-md hover:-translate-y-1">
                            <div className="absolute right-0 bottom-0 w-24 h-24 bg-amber-300/30 rounded-full blur-2xl translate-x-1/3 translate-y-1/3 transition-transform duration-700 group-hover:scale-150"></div>
                            <div className="flex items-center gap-2 mb-2 relative z-10">
                                <div className="w-8 h-8 rounded-lg bg-white/60 flex items-center justify-center shadow-sm border border-white">
                                    <Zap size={16} className="text-amber-500" strokeWidth={2.5}/>
                                </div>
                                <h5 className="text-[10px] font-black uppercase tracking-widest text-amber-600/90">Mayor Gasto Externo</h5>
                            </div>
                            <p className="text-[17px] font-black text-amber-950 leading-tight relative z-10 tracking-tight mt-1">
                                {stats.highestService}
                            </p>
                        </div>

                    </div>
                </div>
            )}

            {/* TARJETAS DE SERVICIOS */}
            {/* Estas tarjetas se renderizan inmediatamente ya que no dependen del historial de Supabase */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {(liveBranch?.settings?.propertyType === 'RENTED' || liveBranch?.propertyType === 'RENTED' || liveBranch?.propertyType === 'ALQUILADO') && (
                    <ServiceExpenseCard
                        title="Arrendamiento"
                        provider={rentData.landlordName}
                        amount={rentData.amount}
                        dueDay={rentData.dueDay}
                        paidThrough={rentData.paidThrough}
                        isReceiptPending={rentData.isReceiptPending}
                        icon={Landmark}
                        colorTheme="purple"
                        delay={0}
                        onAction={() => handleExpenseAction('rent', rentData.dueDay && rentData.paidThrough)}
                        onUploadReceipt={() => handleUploadReceiptAction('rent')}
                    />
                )}
                {hasServices && <ServiceExpenseCard
                    title="Energía Eléctrica"
                    provider={svcData.light?.provider}
                    amount={svcData.light?.amount}
                    dueDay={svcData.light?.dueDay}
                    paidThrough={svcData.light?.paidThrough}
                    isReceiptPending={svcData.light?.isReceiptPending}
                    icon={Zap}
                    colorTheme="orange"
                    delay={50}
                    onAction={() => handleExpenseAction('light', svcData.light?.dueDay && svcData.light?.paidThrough)}
                    onUploadReceipt={() => handleUploadReceiptAction('light')}
                />}
                {hasServices && <ServiceExpenseCard
                    title="Agua Potable"
                    provider={svcData.water?.provider}
                    amount={svcData.water?.amount}
                    dueDay={svcData.water?.dueDay}
                    paidThrough={svcData.water?.paidThrough}
                    isReceiptPending={svcData.water?.isReceiptPending}
                    icon={Droplet}
                    colorTheme="cyan"
                    delay={100}
                    onAction={() => handleExpenseAction('water', svcData.water?.dueDay && svcData.water?.paidThrough)}
                    onUploadReceipt={() => handleUploadReceiptAction('water')}
                />}
                {hasServices && <ServiceExpenseCard
                    title="Internet Fijo"
                    provider={svcData.internet?.provider}
                    amount={svcData.internet?.amount}
                    dueDay={svcData.internet?.dueDay}
                    paidThrough={svcData.internet?.paidThrough}
                    isReceiptPending={svcData.internet?.isReceiptPending}
                    icon={Wifi}
                    colorTheme="blue"
                    delay={150}
                    onAction={() => handleExpenseAction('internet', svcData.internet?.dueDay && svcData.internet?.paidThrough)}
                    onUploadReceipt={() => handleUploadReceiptAction('internet')}
                />}
                <ServiceExpenseCard
                    title="Plan Celular"
                    provider={svcData.phone?.provider}
                    amount={svcData.phone?.amount}
                    dueDay={svcData.phone?.dueDay}
                    paidThrough={svcData.phone?.paidThrough}
                    isReceiptPending={svcData.phone?.isReceiptPending}
                    icon={Smartphone}
                    colorTheme="emerald"
                    delay={200}
                    onAction={() => handleExpenseAction('phone', svcData.phone?.dueDay && svcData.phone?.paidThrough)}
                    onUploadReceipt={() => handleUploadReceiptAction('phone')}
                />
                <ServiceExpenseCard
                    title="Impuestos / Alcaldía"
                    provider={svcData.taxes?.provider}
                    amount={svcData.taxes?.amount}
                    dueDay={svcData.taxes?.dueDay}
                    paidThrough={svcData.taxes?.paidThrough}
                    isReceiptPending={svcData.taxes?.isReceiptPending}
                    icon={Receipt}
                    colorTheme="slate"
                    delay={250}
                    onAction={() => handleExpenseAction('taxes', svcData.taxes?.dueDay && svcData.taxes?.paidThrough)}
                    onUploadReceipt={() => handleUploadReceiptAction('taxes')}
                />
            </div>
        </div>
    );
};

export default TabExpenses;