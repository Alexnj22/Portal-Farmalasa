import React, { useState } from 'react';
import { CheckCircle2, AlertCircle, Eye, PartyPopper, ChevronLeft, ChevronRight, User, ChevronDown } from 'lucide-react';

const FormAnnouncements = ({ data }) => {
  const readersModal = data?.announcement;
  
  if (!readersModal) return null;

  // 1. Separar los empleados en dos listas (Lo movemos arriba para evaluar los estados iniciales)
  const confirmedList = readersModal.audience?.filter((emp) => readersModal.readSet?.has(String(emp.id))) || [];
  const pendingList = readersModal.audience?.filter((emp) => !readersModal.readSet?.has(String(emp.id))) || [];

  // 🚨 ESTADOS DE PAGINACIÓN LOCAL
  const [confirmedPage, setConfirmedPage] = useState(1);
  const [pendingPage, setPendingPage] = useState(1);
  const ITEMS_PER_PAGE = 24; 

  // 🚨 ESTADOS DE COLAPSO (Inteligentes)
  // Confirmados abierto SOLO si hay lecturas. Pendientes CERRADO por defecto.
  const [isConfirmedOpen, setIsConfirmedOpen] = useState(confirmedList.length > 0);
  const [isPendingOpen, setIsPendingOpen] = useState(false);

  // 2. Calcular las porciones a mostrar según la página actual
  const paginatedConfirmed = confirmedList.slice((confirmedPage - 1) * ITEMS_PER_PAGE, confirmedPage * ITEMS_PER_PAGE);
  const totalConfirmedPages = Math.ceil(confirmedList.length / ITEMS_PER_PAGE);

  const paginatedPending = pendingList.slice((pendingPage - 1) * ITEMS_PER_PAGE, pendingPage * ITEMS_PER_PAGE);
  const totalPendingPages = Math.ceil(pendingList.length / ITEMS_PER_PAGE);

  // 3. Componente de Controles de Paginación (Liquidglass)
  const PaginationControls = ({ currentPage, totalPages, setPage }) => {
    if (totalPages <= 1) return null;
    return (
      <div className="flex items-center justify-center gap-4 mt-5 animate-in fade-in duration-300">
        <button
          type="button"
          onClick={() => setPage(p => Math.max(1, p - 1))}
          disabled={currentPage === 1}
          className="w-8 h-8 rounded-full bg-white/60 border border-white/90 flex items-center justify-center text-slate-500 hover:text-[#007AFF] hover:bg-white disabled:opacity-40 disabled:hover:scale-100 transition-all shadow-sm hover:shadow hover:-translate-y-0.5 active:scale-95"
        >
          <ChevronLeft size={16} strokeWidth={2.5} />
        </button>
        <div className="px-3 py-1 bg-white/40 border border-white/60 rounded-full shadow-[inset_0_2px_4px_rgba(255,255,255,0.5)]">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
            Pág {currentPage} de {totalPages}
            </span>
        </div>
        <button
          type="button"
          onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          disabled={currentPage === totalPages}
          className="w-8 h-8 rounded-full bg-white/60 border border-white/90 flex items-center justify-center text-slate-500 hover:text-[#007AFF] hover:bg-white disabled:opacity-40 disabled:hover:scale-100 transition-all shadow-sm hover:shadow hover:-translate-y-0.5 active:scale-95"
        >
          <ChevronRight size={16} strokeWidth={2.5} />
        </button>
      </div>
    );
  };

  // 4. Componente de Avatar (Squircle con Imagen o Inicial)
  const EmployeeAvatar = ({ photoUrl, name, fallbackColor = 'bg-emerald-500' }) => {
    return (
      <div className={`w-10 h-10 rounded-[0.8rem] flex items-center justify-center shrink-0 border border-white/20 transition-all overflow-hidden ${photoUrl ? '' : fallbackColor}`}>
        {photoUrl ? (
          <img src={photoUrl} alt={name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-white font-black text-[12px] uppercase">
            {name?.charAt(0) || '?'}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="w-full flex flex-col p-6 pt-14 md:p-10 md:pt-16 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] h-full">
      
      {/* HEADER DEL REPORTE */}
      <div className="mb-5 pr-8 flex items-center gap-4 shrink-0">
        <div className="w-12 h-12 flex items-center justify-center rounded-[1.25rem] shrink-0 border border-white/80 shadow-[0_4px_12px_rgba(0,0,0,0.05)] bg-white/70 text-[#007AFF]">
            <Eye size={22} strokeWidth={2.5} />
        </div>
        
        <div className="flex-1 min-w-0">
            <h3 className="text-xl md:text-2xl font-black text-slate-800 tracking-tight leading-none truncate mb-1 drop-shadow-sm">
                {readersModal.title || 'Sin Título'}
            </h3>
            <p className="text-[10px] md:text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em]">
                Reporte de Lecturas
            </p>
        </div>
      </div>

      {/* CONTENIDO DEL MENSAJE */}
      {(readersModal.content || readersModal.message || readersModal.body) && (
        <div className="mb-8 shrink-0 relative overflow-hidden bg-white/40 backdrop-blur-sm rounded-[1rem] border border-white/60 shadow-[inset_0_2px_10px_rgba(255,255,255,0.6)]">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#007AFF]/40"></div>
            <div className="p-4 md:px-5 md:py-4">
                {/* 🚨 SCROLL OCULTO EN EL TEXTO DEL MENSAJE */}
                <p className="text-[11px] md:text-[12px] text-slate-600 font-medium leading-relaxed max-h-[4.5rem] overflow-y-auto scrollbar-hide [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] pr-2">
                    {readersModal.content || readersModal.message || readersModal.body}
                </p>
            </div>
        </div>
      )}

      {/* 🚨 ZONA CON SCROLL INTERNO (TOTALMENTE OCULTO) PARA MANTENER LA ALTURA DEFINIDA */}
      <div className="flex-1 overflow-y-auto scrollbar-hide [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] pr-2 pb-4 space-y-8">
          
        {/* =========================================================
            SECCIÓN: YA LEYERON (Éxito / Verde)
            ========================================================= */}
        <div>
          {/* BOTÓN DE ACORDEÓN */}
          <button 
            type="button"
            onClick={() => setIsConfirmedOpen(!isConfirmedOpen)}
            className="w-full flex items-center justify-between text-[10px] md:text-[11px] font-black text-emerald-600 uppercase tracking-widest mb-4 border-b border-emerald-100 pb-2 transition-all hover:opacity-70 active:scale-[0.99] group"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} strokeWidth={2.5}/> 
              Confirmados ({confirmedList.length})
            </div>
            <div className={`p-1 rounded-md transition-all duration-300 ${isConfirmedOpen ? 'bg-emerald-50 text-emerald-600' : 'bg-transparent text-emerald-400 group-hover:bg-emerald-50'}`}>
              <ChevronDown size={14} strokeWidth={3} className={`transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] ${isConfirmedOpen ? 'rotate-180' : 'rotate-0'}`} />
            </div>
          </button>

          {/* CONTENIDO */}
          {isConfirmedOpen && (
            <div className="animate-in fade-in slide-in-from-top-2 duration-500">
              {confirmedList.length > 0 ? (
                <div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                    {paginatedConfirmed.map((emp) => (
                        <div
                          key={emp.id}
                          className="flex items-center gap-3.5 p-3 bg-white/70 rounded-[1.25rem] border border-white shadow-[0_2px_10px_rgba(0,0,0,0.03)] transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-0.5 hover:shadow-md group"
                        >
                          <EmployeeAvatar photoUrl={emp.photo_url} name={emp.name} fallbackColor="bg-emerald-500 shadow-[0_4px_12px_rgba(16,185,129,0.4)] transition-transform group-hover:scale-105" />
                          <div className="min-w-0 flex-1">
                            <p className="text-[12px] font-black text-slate-800 truncate">
                              {emp.name}
                            </p>
                            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wider truncate mt-0.5">{emp.role}</p>
                          </div>
                        </div>
                      ))}
                  </div>
                  <PaginationControls currentPage={confirmedPage} totalPages={totalConfirmedPages} setPage={setConfirmedPage} />
                </div>
              ) : (
                <div className="p-5 bg-white/60 rounded-[1.25rem] border border-white/80 text-center shadow-[inset_0_2px_10px_rgba(255,255,255,0.6)]">
                  <p className="text-[12px] text-slate-500 font-bold flex items-center justify-center gap-2">
                    Nadie ha abierto este aviso todavía <span className="text-lg">🫣</span>
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* =========================================================
            SECCIÓN: PENDIENTES (Neutro / Opaco)
            ========================================================= */}
        <div>
          {/* BOTÓN DE ACORDEÓN */}
          <button 
            type="button"
            onClick={() => setIsPendingOpen(!isPendingOpen)}
            className="w-full flex items-center justify-between text-[10px] md:text-[11px] font-black text-amber-500 uppercase tracking-widest mb-4 border-b border-amber-100 pb-2 transition-all hover:opacity-70 active:scale-[0.99] group"
          >
            <div className="flex items-center gap-2">
              <AlertCircle size={16} strokeWidth={2.5}/> 
              Pendientes ({pendingList.length})
            </div>
            <div className={`p-1 rounded-md transition-all duration-300 ${isPendingOpen ? 'bg-amber-50 text-amber-600' : 'bg-transparent text-amber-400 group-hover:bg-amber-50'}`}>
              <ChevronDown size={14} strokeWidth={3} className={`transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] ${isPendingOpen ? 'rotate-180' : 'rotate-0'}`} />
            </div>
          </button>

          {/* CONTENIDO */}
          {isPendingOpen && (
            <div className="animate-in fade-in slide-in-from-top-2 duration-500">
              {pendingList.length > 0 ? (
                <div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                    {paginatedPending.map((emp) => (
                        <div
                          key={emp.id}
                          className="flex items-center gap-3.5 p-3 bg-white/40 rounded-[1.25rem] border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.02)] transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-0.5 hover:bg-white/60 group"
                        >
                          <EmployeeAvatar photoUrl={emp.photo_url} name={emp.name} fallbackColor="bg-slate-100 text-slate-400 group-hover:text-slate-600 transition-colors" />
                          <div className="min-w-0 flex-1 opacity-80 group-hover:opacity-100 transition-opacity">
                            <p className="text-[12px] font-bold text-slate-600 truncate transition-colors group-hover:text-slate-800">
                              {emp.name}
                            </p>
                            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider truncate mt-0.5">{emp.role}</p>
                          </div>
                        </div>
                      ))}
                  </div>
                  <PaginationControls currentPage={pendingPage} totalPages={totalPendingPages} setPage={setPendingPage} />
                </div>
              ) : (
                <div className="p-5 bg-emerald-500 text-white rounded-[1.25rem] shadow-[0_8px_25px_rgba(16,185,129,0.3)] text-center flex items-center justify-center gap-3">
                   <PartyPopper size={20} className="animate-[bounce_2s_infinite]" />
                  <p className="text-[12px] font-black uppercase tracking-wider drop-shadow-md">
                    ¡Todos han leído el aviso!
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default FormAnnouncements;