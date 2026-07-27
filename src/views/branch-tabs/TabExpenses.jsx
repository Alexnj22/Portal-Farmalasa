import React, { useMemo, useState, useEffect } from 'react';
import { Landmark, Zap, Droplet, Wifi, Smartphone, Receipt, DollarSign, AlertCircle, UploadCloud, TrendingUp, TrendingDown, BarChart3, Activity } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

import { fetchBranchExpensesHistory } from '../../data/branches';

// ============================================================================
// MOTOR DE ESTADOS FINANCIEROS
// ============================================================================
const getServiceStatus = (dueDay, paidThrough, isReceiptPending) => {
    if (!dueDay || !paidThrough) return { state: 'unknown', label: 'Sin Configurar', colorClass: 'border-divider bg-surface-card-hover/50 text-content-3' };

    if (isReceiptPending) {
        return {
            state: 'pending_receipt',
            label: 'Recibo Pendiente',
            colorClass: 'border-chart-6 bg-chart-6/10 text-chart-6-text shadow-[0_0_15px_rgba(217,70,239,0.15)] ring-1 ring-chart-6/30'
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
        return { state: 'paid', label: 'Al Día', colorClass: 'border-success bg-success/10 text-success-text shadow-[var(--shadow-glow-chart-2-md)] ring-1 ring-success/30' };
    }

    if (ptYear === currentYear && ptMonth === currentMonth - 1) {
        if (currentDay > dueDay) {
            return { state: 'expired', label: 'Vencido', colorClass: 'border-danger bg-danger/10 text-danger-text shadow-[var(--shadow-glow-danger-md)] ring-1 ring-danger/30' };
        } else {
            return { state: 'pending', label: 'Vence Pronto', colorClass: 'border-warning bg-warning/10 text-warning-text shadow-[var(--shadow-glow-warning-md)] ring-1 ring-warning/30' };
        }
    }

    return { state: 'expired', label: 'Vencido', colorClass: 'border-danger bg-danger/10 text-danger-text shadow-[var(--shadow-glow-danger-md)] ring-1 ring-danger/30' };
};

// ============================================================================
// TARJETA DE SERVICIO (LIQUID GLASS BENTO)
// ============================================================================
const ServiceExpenseCard = ({ title, provider, amount, dueDay, paidThrough, isReceiptPending, icon: Icon, onAction, onUploadReceipt, delay = 0, colorTheme = 'blue' }) => {
    const statusObj = getServiceStatus(dueDay, paidThrough, isReceiptPending);
    const isConfigured = dueDay && paidThrough;
    const isPendingReceipt = statusObj.state === 'pending_receipt';

    const colorMap = {
        blue: 'text-brand-text bg-chart-1/10 border-chart-1/30',
        orange: 'text-chart-4-text bg-chart-4/10 border-chart-4/30',
        cyan: 'text-chart-5-text bg-chart-5/10 border-chart-5/20',
        purple: 'text-chart-3-text bg-chart-3/10 border-chart-3/20',
        emerald: 'text-success bg-success/10 border-success/30',
        slate: 'text-content-3 bg-surface-card-hover border-border-card'
    };

    return (
        <div
            className={`group relative backdrop-blur-md rounded-modal p-5 transition-all duration-500 animate-in slide-in-from-bottom-4 fade-in fill-mode-both flex flex-col hover:-translate-y-1 hover:shadow-lg ${statusObj.colorClass} ${isPendingReceipt ? 'animate-pulse' : ''}`}
            style={{ animationDelay: `${delay}ms`, willChange: 'transform, opacity' }}
        >
            <div className="absolute inset-0 bg-surface-card rounded-modal opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-500 pointer-events-none"></div>

            <div className="flex justify-between items-start mb-4 relative z-base">
                <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center border shadow-sm transition-transform duration-300 group-hover:scale-110 ${isPendingReceipt ? 'text-chart-6 bg-surface-card border-chart-6/30' : colorMap[colorTheme]}`}>
                        {isPendingReceipt ? <AlertCircle size={20} strokeWidth={2}/> : <Icon size={20} strokeWidth={2} />}
                    </div>
                    <div className="min-w-0 pr-2">
                        <p className="text-label font-black text-content uppercase tracking-widest truncate">{title}</p>
                        <p className="text-micro font-bold text-content-3 truncate">{provider || 'Sin proveedor'}</p>
                    </div>
                </div>
                <div className={`px-2.5 py-1.5 rounded-lg text-micro font-black uppercase tracking-widest shadow-sm border transition-colors duration-300 ${isPendingReceipt ? 'bg-chart-6-solid text-white border-chart-6' : 'bg-surface-card border-border-card group-hover:bg-surface-card-hover'}`}>
                    {statusObj.label}
                </div>
            </div>

            <div className="flex-1 flex items-end justify-between mt-2 relative z-base">
                <div>
                    <p className="text-micro font-black text-content-2 uppercase tracking-widest mb-0.5">Monto (Aprox)</p>
                    <p className="text-lg font-black text-content">${amount ? Number(amount).toFixed(2) : '0.00'}</p>
                </div>
                <div className="text-right">
                    <p className="text-micro font-black text-content-2 uppercase tracking-widest mb-0.5">
                        {isPendingReceipt ? 'Mes Pagado' : 'Día de Pago'}
                    </p>
                    <p className="text-body-sm font-bold text-content-2">
                        {isPendingReceipt ? paidThrough : (dueDay ? `Día ${dueDay}` : '-')}
                    </p>
                </div>
            </div>

            {isPendingReceipt ? (
                <button
                    onClick={onUploadReceipt}
                    className="mt-4 w-full py-2.5 rounded-xl bg-chart-6-solid border border-chart-6 text-white font-black text-caption uppercase tracking-widest hover:bg-chart-6/90 transition-all active:scale-[0.97] shadow-[0_4px_15px_rgba(217,70,239,0.3)] flex items-center justify-center gap-2 relative z-base"
                >
                    <UploadCloud size={14} strokeWidth={2.5} /> Subir Comprobante
                </button>
            ) : (
                <button
                    onClick={onAction}
                    className="mt-4 w-full py-2.5 rounded-xl bg-surface-card backdrop-blur-sm border border-border-card text-content-2 font-bold text-caption uppercase tracking-widest hover:text-brand-text hover:border-chart-1/30 hover:bg-surface-card-hover transition-all active:scale-[0.97] shadow-sm relative z-base"
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
            <div className="bg-surface-card backdrop-blur-xl border border-border-card p-4 rounded-2xl shadow-[var(--shadow-elevation-lg)]">
                <p className="text-caption font-black text-content-2 uppercase tracking-widest mb-1.5">{label}</p>
                <p className="text-body-xl font-black text-content flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-brand shadow-sm"></span>
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
const EMPTY_OBJ = {};

const TabExpenses = ({ liveBranch, openModal, branchType }) => {
    const hasServices = !branchType || branchType === 'FARMACIA';
    const rentData = liveBranch?.settings?.rent || EMPTY_OBJ;
    const svcData = liveBranch?.settings?.services || EMPTY_OBJ;

    const [historicalData, setHistoricalData] = useState([]);
    const [isLoadingData, setIsLoadingData] = useState(true);

    // 🔴 FETCH DE DATOS REALES DE SUPABASE
    useEffect(() => {
        const fetchExpensesData = async () => {
            if (!liveBranch?.id) return;
            setIsLoadingData(true);
            try {
                // Traemos los gastos pagados de los últimos 6 meses
                const { data, error } = await fetchBranchExpensesHistory(liveBranch.id);

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
    }, [rentData, svcData, liveBranch, hasServices]);


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
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4 pb-4 border-b border-border-card">
                <div>
                    <h3 className="font-black text-content uppercase tracking-tight text-lg">Finanzas y Gastos Operativos</h3>
                    <p className="text-label font-bold text-content-3 uppercase tracking-widest">Control de Pagos de la Sucursal</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="px-4 py-2 bg-success/10 text-success rounded-2xl border border-success/30 shadow-sm flex items-center gap-2 backdrop-blur-md">
                        <DollarSign size={16} strokeWidth={2.5} />
                        <span className="text-label font-black uppercase tracking-widest">Total Operativo Actual</span>
                        <span className="text-body-lg font-black">${totalMonthlyEst.toFixed(2)}</span>
                    </div>
                </div>
            </div>

            {/* 📊 DASHBOARD ANALÍTICO (SKELETON VS REAL) */}
            {isLoadingData ? (
                /* SKELETON DE CARGA DASHBOARD */
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                    {/* Gráfico Skeleton */}
                    <div className="lg:col-span-2 bg-surface-card border border-border-card rounded-modal p-6 shadow-sm flex flex-col min-h-[280px]">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-12 h-12 skeleton rounded-2xl"></div>
                            <div className="flex flex-col gap-2 w-1/3">
                                <div className="h-3.5 skeleton rounded-full w-3/4"></div>
                                <div className="h-2.5 skeleton rounded-full w-1/2"></div>
                            </div>
                        </div>
                        <div className="flex-1 flex items-end justify-between gap-4 px-2 border-b border-divider pb-2">
                            <div className="w-full skeleton rounded-t-lg h-[40%]"></div>
                            <div className="w-full skeleton rounded-t-lg h-[60%]"></div>
                            <div className="w-full skeleton rounded-t-lg h-[30%]"></div>
                            <div className="w-full skeleton rounded-t-lg h-[80%]"></div>
                            <div className="w-full skeleton rounded-t-lg h-[50%]"></div>
                            <div className="w-full skeleton rounded-t-lg h-[90%]"></div>
                        </div>
                    </div>

                    {/* Métricas Rápidas Skeleton */}
                    <div className="flex flex-col gap-5">
                        <div className="bg-surface-card border border-border-card rounded-modal p-6 flex-1 flex flex-col justify-center gap-3 shadow-sm">
                            <div className="flex items-center gap-2">
                                <div className="w-4 h-4 rounded-full skeleton"></div>
                                <div className="h-2.5 skeleton rounded-full w-1/2"></div>
                            </div>
                            <div className="h-8 skeleton rounded-lg w-1/3 mt-2"></div>
                        </div>
                        <div className="bg-surface-card border border-border-card rounded-modal p-6 flex-1 flex flex-col justify-center gap-3 shadow-sm">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg skeleton"></div>
                                <div className="h-2.5 skeleton rounded-full w-1/2"></div>
                            </div>
                            <div className="h-5 skeleton rounded-lg w-2/3 mt-2"></div>
                        </div>
                    </div>
                </div>
            ) : (
                /* DASHBOARD REAL */
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8 animate-in fade-in duration-500 slide-in-from-bottom-4">
                    {/* Gráfico de Barras */}
                    <div className="group lg:col-span-2 bg-surface-card backdrop-blur-xl border border-border-card rounded-modal p-6 shadow-[var(--shadow-elevation-xs)] flex flex-col relative overflow-hidden transition-all duration-500 hover:shadow-[var(--shadow-glow-brand)]">
                        <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-brand/5 to-transparent pointer-events-none transition-opacity duration-500 group-hover:opacity-100 opacity-50"></div>
                        
                        <div className="flex justify-between items-start mb-6 relative z-base">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 bg-surface-card text-brand-text rounded-2xl flex items-center justify-center border border-border-card shadow-sm transition-transform duration-500 group-hover:scale-110">
                                    <BarChart3 size={22} strokeWidth={2.5}/>
                                </div>
                                <div>
                                    <h4 className="text-body-lg font-black text-content uppercase tracking-widest leading-none mb-1">Tendencia de Gastos</h4>
                                    <p className="text-caption font-bold text-content-3 uppercase tracking-widest">Últimos 6 meses operacionales</p>
                                </div>
                            </div>
                        </div>

                        <div className="flex-1 min-h-[180px] w-full relative z-base">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={historicalData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="var(--brand)" stopOpacity={0.9}/>
                                            <stop offset="95%" stopColor="var(--brand)" stopOpacity={0.1}/>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--divider)" opacity={0.5} />
                                    <XAxis 
                                        dataKey="name" 
                                        axisLine={false} 
                                        tickLine={false} 
                                        tick={{ fill: 'var(--chart-8)', fontSize: 10, fontWeight: 800 }} 
                                        dy={10}
                                    />
                                    <YAxis 
                                        axisLine={false} 
                                        tickLine={false} 
                                        tick={{ fill: 'var(--text-tertiary)', fontSize: 10, fontWeight: 800 }}
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
                                            <Cell key={`cell-${index}`} fill={index === historicalData.length - 1 ? 'var(--brand)' : 'url(#colorTotal)'} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Métricas Rápidas */}
                    <div className="flex flex-col gap-5">
                        
                        {/* Tarjeta de Variación Mensual */}
                        <div className="group bg-surface-card backdrop-blur-xl border border-border-card rounded-modal p-6 shadow-sm flex-1 flex flex-col justify-center transition-all duration-500 hover:shadow-md hover:-translate-y-1 relative overflow-hidden">
                            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: 'linear-gradient(to bottom right, var(--card-sheen-strong), transparent)' }}></div>
                            <div className="flex items-center gap-2 mb-3 relative z-base">
                                <Activity size={16} className="text-content-3 transition-colors duration-300 group-hover:text-content-2" strokeWidth={2.5}/>
                                <h5 className="text-caption font-black uppercase tracking-widest text-content-3">Variación vs Mes Anterior</h5>
                            </div>
                            <div className="flex items-end gap-3 relative z-base">
                                <span className="text-3xl font-black text-content tracking-tight">
                                    {Math.abs(stats.variation).toFixed(1)}%
                                </span>
                                <div className={`flex items-center gap-1 mb-1.5 px-2.5 py-1 rounded-lg text-caption font-black uppercase tracking-widest shadow-sm border ${stats.isUp ? 'bg-danger/10 text-danger border-danger/30' : 'bg-success/10 text-success border-success/30'}`}>
                                    {stats.isUp ? <TrendingUp size={12} strokeWidth={3}/> : <TrendingDown size={12} strokeWidth={3}/>}
                                    {stats.isUp ? 'Aumento' : 'Ahorro'}
                                </div>
                            </div>
                        </div>

                        {/* Tarjeta de Servicio Más Caro */}
                        <div className="group bg-gradient-to-br from-warning/10 to-warning/5 backdrop-blur-xl border border-warning/30 rounded-modal p-6 shadow-sm flex-1 flex flex-col justify-center relative overflow-hidden transition-all duration-500 hover:shadow-md hover:-translate-y-1">
                            <div className="absolute right-0 bottom-0 w-24 h-24 bg-warning/30 rounded-full blur-2xl translate-x-1/3 translate-y-1/3 transition-transform duration-700 group-hover:scale-150"></div>
                            <div className="flex items-center gap-2 mb-2 relative z-base">
                                <div className="w-8 h-8 rounded-lg bg-surface-card flex items-center justify-center shadow-sm border border-border-card">
                                    <Zap size={16} className="text-warning" strokeWidth={2.5}/>
                                </div>
                                <h5 className="text-caption font-black uppercase tracking-widest text-warning/90">Mayor Gasto Externo</h5>
                            </div>
                            <p className="text-title-sm font-black text-warning-text leading-tight relative z-base tracking-tight mt-1">
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