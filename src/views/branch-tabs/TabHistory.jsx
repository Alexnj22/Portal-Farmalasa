import React, { useState, useMemo } from 'react';
import { Filter, X, Search, Download, Clock, FileText, Users, Eye } from 'lucide-react';

const TabHistory = ({ liveBranch, history, isLoadingHistory, employees, openModal }) => {
    const [dateFilter, setDateFilter] = useState({ start: '', end: '' });
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [showAllHistory, setShowAllHistory] = useState(false);

    const openDateStr = liveBranch?.opening_date || liveBranch?.openingDate;

    const syntheticHistory = useMemo(() => {
        let combined = [...history];
        if (openDateStr) {
            const safeDateStr = openDateStr.includes('T') ? openDateStr : `${openDateStr}T08:00:00`;
            combined.push({
                isSynthetic: true,
                sortDate: new Date(safeDateStr),
                action: 'APERTURA OFICIAL',
                name: 'Inauguración de la Sucursal',
                actor_name: 'Sistema'
            });
        }
        return combined.sort((a, b) => b.sortDate - a.sortDate);
    }, [history, openDateStr]);

    const getActionLabel = (item) => {
        if (item.isSynthetic) return item.action;
        if (item.isDoc) return 'ARCHIVO HISTÓRICO';
        if (item.action === 'PAGO_REGISTRADO') return 'PAGO REGISTRADO';
        if (item.action === 'EDITAR_SUCURSAL') {
            const changes = item.metadata?.cambios_detectados || {};
            if (changes.regenteFarmacia) return 'CAMBIO DE REGENTE';
            if (changes.referenteFarmacovigilancia) return 'CAMBIO DE REFERENTE';
            if (Object.keys(changes).length > 0) return 'ACTUALIZACIÓN DE DATOS';
        }
        return item.action?.replace(/_/g, ' ') || 'REGISTRO DE SISTEMA';
    };

    const filteredHistory = useMemo(() => {
        let result = syntheticHistory;

        if (dateFilter.start || dateFilter.end) {
            result = result.filter(item => {
                const itemDate = item.sortDate;
                const start = dateFilter.start ? new Date(`${dateFilter.start}T00:00:00`) : new Date('2000-01-01');
                const end = dateFilter.end ? new Date(`${dateFilter.end}T23:59:59`) : new Date('2100-01-01');
                return itemDate >= start && itemDate <= end;
            });
        } else if (!showAllHistory && searchQuery.trim() === '') {
            const sixMonthsAgo = new Date();
            sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
            result = result.filter(item => item.sortDate >= sixMonthsAgo);
        }

        if (searchQuery.trim() !== '') {
            const query = searchQuery.toLowerCase();
            result = result.filter(item => {
                const actionLabel = getActionLabel(item).toLowerCase();
                const itemName = (item.name || 'Configuración de Sede Modificada').toLowerCase();
                const actorName = (item.user_name || item.user_email || item.actor_name || 'Sistema').toLowerCase();
                
                return actionLabel.includes(query) || itemName.includes(query) || actorName.includes(query);
            });
        }

        return result;
    }, [syntheticHistory, dateFilter, searchQuery, showAllHistory]);

    const handleExportHistory = () => {
        if (filteredHistory.length === 0) return;
        const headers = ['Fecha', 'Hora', 'Acción', 'Descripción', 'Realizado por'];
        
        const rows = filteredHistory.map(item => {
            const dateObj = new Date(item.sortDate);
            const dStr = dateObj.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const tStr = (dateObj.getHours() === 0 && dateObj.getMinutes() === 0) ? 'N/A' : dateObj.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: true });
            const action = getActionLabel(item);
            let desc = item.name || 'Actualización de Perfil';
            
            if (item.action === 'PAGO_REGISTRADO') {
                try {
                    const detailsObj = typeof item.details === 'string' ? JSON.parse(item.details) : (item.details || {});
                    const serviceMap = { rent: 'Arrendamiento', light: 'Energía Eléctrica', water: 'Agua Potable', internet: 'Internet Fijo', phone: 'Plan Celular', taxes: 'Impuestos' };
                    const srvName = serviceMap[detailsObj.servicio] || detailsObj.servicio || 'Servicio';
                    desc = `Pago de ${srvName} registrado ($${detailsObj.monto} - Mes: ${detailsObj.mes})`;
                } catch (e) { desc = 'Pago de Servicio Registrado'; }
            }
  
            let actor = 'Sistema';
            if (!item.isSynthetic && !item.isDoc) {
               actor = item.user_name || item.user_email || 'Administrador';
            }
  
            return `"${dStr}","${tStr}","${action}","${desc.replace(/"/g, '""')}","${actor.replace(/"/g, '""')}"`;
        });
  
        const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + headers.join(",") + "\n" + rows.join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `Historial_Sucursal_${liveBranch?.name || 'Sede'}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handlePreviewDocument = (url, title) => {
        if (openModal) openModal('viewDocument', { url, title });
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-6 border-b border-white/60">
                <div>
                    <h3 className="font-black text-slate-800 uppercase tracking-tight text-lg">Historia de Sucursal</h3>
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Documentos e Hitos Históricos</p>
                </div>
                
                <div className="flex items-center bg-white/60 p-1.5 rounded-[1.25rem] border border-white shadow-sm transition-all duration-300">
                    <button onClick={handleExportHistory} className="p-2 hover:bg-blue-50 hover:text-[#007AFF] rounded-[1rem] text-slate-400 transition-colors shrink-0" title="Exportar CSV">
                        <Download size={16} />
                    </button>
                    <div className="w-px h-6 bg-slate-200 mx-1 shrink-0"></div>

                    <div className="flex items-center overflow-hidden transition-all duration-300 min-w-[240px]">
                        {!isSearchOpen ? (
                            <div className="flex items-center w-full animate-in fade-in zoom-in-95 duration-300">
                                <Filter size={14} className="text-slate-400 ml-1.5 shrink-0" />
                                <input 
                                    type="date" 
                                    className="w-full bg-transparent border-none text-[11px] font-bold text-slate-600 outline-none cursor-pointer pl-2"
                                    value={dateFilter.start}
                                    onChange={(e) => setDateFilter({...dateFilter, start: e.target.value})}
                                />
                                <span className="text-slate-300 mx-1 shrink-0">-</span>
                                <input 
                                    type="date" 
                                    className="w-full bg-transparent border-none text-[11px] font-bold text-slate-600 outline-none pr-1 cursor-pointer"
                                    value={dateFilter.end}
                                    onChange={(e) => setDateFilter({...dateFilter, end: e.target.value})}
                                />
                                {(dateFilter.start || dateFilter.end) && (
                                    <button onClick={() => setDateFilter({start: '', end: ''})} className="p-1 hover:bg-slate-200 rounded-md text-slate-400 transition-colors shrink-0"><X size={14}/></button>
                                )}
                            </div>
                        ) : (
                            <div className="flex items-center w-full animate-in fade-in slide-in-from-right-4 duration-300">
                                <input 
                                    type="text" 
                                    autoFocus
                                    placeholder="Buscar hito o usuario..." 
                                    className="w-full bg-transparent border-none text-[11px] font-bold text-slate-600 outline-none placeholder-slate-400 px-3 py-1"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                                {searchQuery && (
                                    <button onClick={() => setSearchQuery('')} className="p-1 hover:bg-slate-200 rounded-md text-slate-400 mr-1 transition-colors shrink-0">
                                        <X size={12}/>
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="w-px h-6 bg-slate-200 mx-1 shrink-0"></div>
                    <button 
                        onClick={() => {
                            setIsSearchOpen(!isSearchOpen);
                            if (isSearchOpen) setSearchQuery(''); 
                        }} 
                        className={`p-2 rounded-[1rem] transition-colors shrink-0 ${isSearchOpen ? 'bg-blue-50 text-[#007AFF]' : 'hover:bg-slate-200 text-slate-500'}`} 
                        title={isSearchOpen ? "Cerrar búsqueda" : "Buscar en historial"}
                    >
                        <Search size={16}/>
                    </button>
                </div>
            </div>

            <div className="relative border-l-[2px] border-white ml-6 pb-2">
                <div className="space-y-8">
                    {filteredHistory.length > 0 ? filteredHistory.map((item, idx) => {
                        const isDoc = item.isDoc;
                        const isSynthetic = item.isSynthetic;
                        const actionLabel = getActionLabel(item);
                        
                        const dateObj = new Date(item.sortDate);
                        const dateStr = dateObj.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
                        const timeStr = (dateObj.getHours() === 0 && dateObj.getMinutes() === 0) ? '' : ` - ${dateObj.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: true })}`;
                        
                        let actorName = 'SISTEMA';
                        let actorRole = '';
                        if (!isSynthetic && !isDoc) {
                            const rawName = item.user_name || item.actor_name || item.user_email;
                            if (rawName) {
                                actorName = rawName.includes('@') ? rawName.split('@')[0].toUpperCase() : rawName.toUpperCase();
                            } else {
                                actorName = 'ADMINISTRADOR';
                            }
                            
                            const actorEmployee = employees.find(e => 
                                (e.email && item.user_email && e.email === item.user_email) || 
                                (e.name && item.user_name && e.name.toLowerCase() === item.user_name.toLowerCase())
                            );
                            
                            if(actorEmployee && actorEmployee.role) {
                                actorRole = ` - ${actorEmployee.role.toUpperCase()}`;
                            } else if (actorName.includes('ADMIN')) {
                                actorRole = ' - SISTEMA';
                            }
                        }

                        let itemTitle = 'Configuración de Sede Modificada';
                        if (isDoc || isSynthetic) {
                            itemTitle = item.name;
                        } else if (item.action === 'PAGO_REGISTRADO') {
                            try {
                                const detailsObj = typeof item.details === 'string' ? JSON.parse(item.details) : (item.details || {});
                                const serviceMap = {
                                    rent: 'Arrendamiento', light: 'Energía Eléctrica', water: 'Agua Potable',
                                    internet: 'Internet Fijo', phone: 'Plan Celular', taxes: 'Impuestos'
                                };
                                const srvName = serviceMap[detailsObj.servicio] || detailsObj.servicio || 'Servicio';
                                itemTitle = `Pago de ${srvName} registrado ($${detailsObj.monto} - Mes: ${detailsObj.mes})`;
                            } catch (e) {
                                itemTitle = 'Pago de Servicio Registrado';
                            }
                        }

                        return (
                            <div 
                                key={idx} 
                                className="relative pl-8 group animate-in slide-in-from-bottom-4 fade-in fill-mode-both"
                                style={{ animationDelay: `${idx * 40}ms`, willChange: 'transform, opacity' }}
                            >
                                <div className={`absolute -left-[9px] top-2 w-4 h-4 rounded-full border-[3px] shadow-sm bg-white transition-transform duration-300 group-hover:scale-125 ${isSynthetic ? 'border-orange-500' : isDoc ? 'border-[#007AFF]' : item.action === 'PAGO_REGISTRADO' ? 'border-emerald-500' : 'border-emerald-500'}`}></div>
                                
                                <div className="bg-white/60 hover:bg-white/90 rounded-[1.5rem] p-5 border border-white hover:border-blue-200 transition-all duration-300 shadow-sm flex flex-col sm:flex-row justify-between gap-4 items-start sm:items-center hover:shadow-md">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2 mb-2">
                                            <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${isSynthetic ? 'bg-orange-100 text-orange-700' : isDoc ? 'bg-blue-100 text-[#007AFF]' : item.action === 'PAGO_REGISTRADO' ? 'bg-emerald-100 text-emerald-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                                {actionLabel}
                                            </span>
                                            <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5"><Clock size={12}/> {dateStr}{timeStr}</span>
                                        </div>
                                        
                                        <p className="text-[15px] text-slate-800 font-bold leading-tight truncate">
                                            {itemTitle}
                                        </p>
                                        
                                        <div className="flex flex-wrap items-center gap-4 mt-2">
                                            {isDoc && item.document_type && (
                                                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                                                    <FileText size={10} className="text-[#007AFF]"/> {item.document_type.replace(/_/g, ' ')}
                                                </p>
                                            )}
                                            {!isSynthetic && !isDoc && (
                                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                                                    <Users size={10} className="text-emerald-500"/> Realizado por: <span className="text-slate-700 ml-1">{actorName}{actorRole}</span>
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    
                                    {isDoc && item.file_url && (
                                        <button onClick={() => handlePreviewDocument(item.file_url, item.name)} className="flex items-center justify-center gap-2 text-[#007AFF] bg-white border border-white/80 px-5 py-3 rounded-xl font-bold text-[10px] uppercase tracking-widest hover:border-[#007AFF]/30 hover:bg-blue-50 transition-all shadow-sm shrink-0 active:scale-95">
                                            <Eye size={16}/> Ver Archivo
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    }) : (
                        <div className="text-center py-24 opacity-40">
                            <Clock size={48} className="mx-auto mb-4 text-slate-400"/>
                            <p className="font-bold uppercase tracking-widest text-[11px] text-slate-500">No hay registros con estos criterios</p>
                        </div>
                    )}
                    
                    {isLoadingHistory && (
                        <div className="absolute -bottom-8 left-6 w-full flex items-center justify-center text-[#007AFF] animate-in fade-in duration-300">
                            <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2"></div>
                            <span className="text-[9px] font-black uppercase tracking-widest">Sincronizando...</span>
                        </div>
                    )}
                </div>
                
                {!showAllHistory && syntheticHistory.length > filteredHistory.length && !dateFilter.start && !dateFilter.end && searchQuery === '' && (
                    <div className="pt-8 text-center animate-in fade-in duration-500">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Mostrando últimos 6 meses</p>
                        <button 
                            onClick={() => setShowAllHistory(true)}
                            className="px-6 py-2.5 bg-white border border-slate-200 text-slate-600 font-bold text-[10px] uppercase tracking-widest hover:border-[#007AFF]/30 hover:text-[#007AFF] hover:shadow-sm transition-all rounded-xl active:scale-95 shadow-sm"
                        >
                            Cargar todo el historial ({syntheticHistory.length} registros)
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TabHistory;