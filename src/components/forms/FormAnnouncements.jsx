import React, { useState } from 'react';
import { CheckCircle2, AlertCircle, Eye, PartyPopper, ChevronLeft, ChevronRight, User, ChevronDown } from 'lucide-react';

// 3. Componente de Controles de Paginación (Liquidglass)
const PaginationControls = ({ currentPage, totalPages, setPage }) => {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-4 mt-5 animate-in fade-in duration-300">
      <button
        type="button"
        onClick={() => setPage(p => Math.max(1, p - 1))}
        disabled={currentPage === 1}
        className="w-8 h-8 rounded-full bg-surface-card border border-border-card flex items-center justify-center text-content-3 hover:text-brand-text hover:bg-surface-card-hover disabled:opacity-40 disabled:hover:scale-100 transition-all shadow-sm hover:shadow hover:-translate-y-0.5 active:scale-[0.97]"
      >
        <ChevronLeft size={16} strokeWidth={2.5} />
      </button>
      <div className="px-3 py-1 bg-surface-card border border-border-card rounded-full shadow-[var(--shadow-shine)]">
          <span className="text-caption font-black text-content-3 uppercase tracking-widest">
          Pág {currentPage} de {totalPages}
          </span>
      </div>
      <button
        type="button"
        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
        disabled={currentPage === totalPages}
        className="w-8 h-8 rounded-full bg-surface-card border border-border-card flex items-center justify-center text-content-3 hover:text-brand-text hover:bg-surface-card-hover disabled:opacity-40 disabled:hover:scale-100 transition-all shadow-sm hover:shadow hover:-translate-y-0.5 active:scale-[0.97]"
      >
        <ChevronRight size={16} strokeWidth={2.5} />
      </button>
    </div>
  );
};

// 4. Componente de Avatar (Squircle con Imagen o Inicial)
const EmployeeAvatar = ({ photoUrl, name, fallbackColor = 'bg-success' }) => {
  return (
    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-border-card transition-all overflow-hidden ${photoUrl ? '' : fallbackColor}`}>
      {photoUrl ? (
        <img src={photoUrl} alt={name} className="w-full h-full object-cover" />
      ) : (
        <span className="text-white font-black text-body-sm uppercase">
          {name?.charAt(0) || '?'}
        </span>
      )}
    </div>
  );
};

const FormAnnouncements = ({ data }) => {
  const readersModal = data?.announcement;

  // 1. Separar los empleados en dos listas
  const confirmedList = readersModal?.audience?.filter((emp) => readersModal.readSet?.has(String(emp.id))) || [];
  const pendingList = readersModal?.audience?.filter((emp) => !readersModal.readSet?.has(String(emp.id))) || [];

  // ESTADOS DE PAGINACIÓN LOCAL — deben estar antes del early return
  const [confirmedPage, setConfirmedPage] = useState(1);
  const [pendingPage, setPendingPage] = useState(1);
  const ITEMS_PER_PAGE = 24;

  // ESTADOS DE COLAPSO — lazy initializers para leer confirmedList de forma segura
  // Confirmados abierto SOLO si hay lecturas. Pendientes CERRADO por defecto.
  const [isConfirmedOpen, setIsConfirmedOpen] = useState(() => confirmedList.length > 0);
  const [isPendingOpen, setIsPendingOpen] = useState(false);

  if (!readersModal) return null;

  // 2. Calcular las porciones a mostrar según la página actual
  const paginatedConfirmed = confirmedList.slice((confirmedPage - 1) * ITEMS_PER_PAGE, confirmedPage * ITEMS_PER_PAGE);
  const totalConfirmedPages = Math.ceil(confirmedList.length / ITEMS_PER_PAGE);

  const paginatedPending = pendingList.slice((pendingPage - 1) * ITEMS_PER_PAGE, pendingPage * ITEMS_PER_PAGE);
  const totalPendingPages = Math.ceil(pendingList.length / ITEMS_PER_PAGE);

  return (
    <div className="w-full flex flex-col p-6 pt-14 md:p-10 md:pt-16 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] h-full">
      
      {/* HEADER DEL REPORTE */}
      <div className="mb-5 pr-8 flex items-center gap-4 shrink-0">
        <div className="w-12 h-12 flex items-center justify-center rounded-2xl shrink-0 border border-border-card shadow-[var(--shadow-elevation-sm)] bg-surface-card text-brand-text">
            <Eye size={22} strokeWidth={2.5} />
        </div>
        
        <div className="flex-1 min-w-0">
            <h3 className="text-xl md:text-2xl font-black text-content tracking-tight leading-none truncate mb-1 drop-shadow-sm">
                {readersModal.title || 'Sin Título'}
            </h3>
            <p className="text-caption md:text-label font-bold text-content-3 uppercase tracking-[0.2em]">
                Reporte de Lecturas
            </p>
        </div>
      </div>

      {/* CONTENIDO DEL MENSAJE */}
      {(readersModal.content || readersModal.message || readersModal.body) && (
        <div className="mb-8 shrink-0 relative overflow-hidden bg-surface-card backdrop-blur-sm rounded-2xl border border-border-card shadow-[var(--shadow-shine-lg)]">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-brand/40"></div>
            <div className="p-4 md:px-5 md:py-4">
                {/* 🚨 SCROLL OCULTO EN EL TEXTO DEL MENSAJE */}
                <p className="text-label md:text-body-sm text-content-2 font-medium leading-relaxed max-h-[4.5rem] overflow-y-auto scrollbar-hide [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] pr-2">
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
            className="w-full flex items-center justify-between text-caption md:text-label font-black text-success uppercase tracking-widest mb-4 border-b border-success/30 pb-2 transition-all hover:opacity-70 active:scale-[0.99] group"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} strokeWidth={2.5}/> 
              Confirmados ({confirmedList.length})
            </div>
            <div className={`p-1 rounded-md transition-all duration-300 ${isConfirmedOpen ? 'bg-success/10 text-success' : 'bg-transparent text-success group-hover:bg-success/10'}`}>
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
                          className="flex items-center gap-3.5 p-3 bg-surface-card rounded-2xl border border-white shadow-[var(--shadow-elevation-xs)] transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-0.5 hover:shadow-md group"
                        >
                          <EmployeeAvatar photoUrl={emp.photo || emp.photo_url} name={emp.name} fallbackColor="bg-success shadow-[var(--shadow-glow-success)] transition-transform group-hover:scale-105" />
                          <div className="min-w-0 flex-1">
                            <p className="text-body-sm font-black text-content truncate">
                              {emp.name}
                            </p>
                            <p className="text-micro text-content-3 font-bold uppercase tracking-wider truncate mt-0.5">{emp.role}</p>
                          </div>
                        </div>
                      ))}
                  </div>
                  <PaginationControls currentPage={confirmedPage} totalPages={totalConfirmedPages} setPage={setConfirmedPage} />
                </div>
              ) : (
                <div className="p-5 bg-surface-card rounded-2xl border border-border-card text-center shadow-[var(--shadow-shine-lg)]">
                  <p className="text-body-sm text-content-3 font-bold flex items-center justify-center gap-2">
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
            className="w-full flex items-center justify-between text-caption md:text-label font-black text-warning uppercase tracking-widest mb-4 border-b border-warning/30 pb-2 transition-all hover:opacity-70 active:scale-[0.99] group"
          >
            <div className="flex items-center gap-2">
              <AlertCircle size={16} strokeWidth={2.5}/> 
              Pendientes ({pendingList.length})
            </div>
            <div className={`p-1 rounded-md transition-all duration-300 ${isPendingOpen ? 'bg-warning/10 text-warning' : 'bg-transparent text-warning group-hover:bg-warning/10'}`}>
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
                          className="flex items-center gap-3.5 p-3 bg-surface-card rounded-2xl border border-border-card shadow-[var(--shadow-elevation-xs)] transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-0.5 hover:bg-surface-card group"
                        >
                          <EmployeeAvatar photoUrl={emp.photo || emp.photo_url} name={emp.name} fallbackColor="bg-surface-card-hover text-content-3 group-hover:text-content-2 transition-colors" />
                          <div className="min-w-0 flex-1 opacity-80 group-hover:opacity-100 transition-opacity">
                            <p className="text-body-sm font-bold text-content-2 truncate transition-colors group-hover:text-content">
                              {emp.name}
                            </p>
                            <p className="text-micro text-content-2 font-bold uppercase tracking-wider truncate mt-0.5">{emp.role}</p>
                          </div>
                        </div>
                      ))}
                  </div>
                  <PaginationControls currentPage={pendingPage} totalPages={totalPendingPages} setPage={setPendingPage} />
                </div>
              ) : (
                <div className="p-5 bg-success-solid text-white rounded-2xl shadow-[var(--shadow-glow-success)] text-center flex items-center justify-center gap-3">
                   <PartyPopper size={20} className="animate-[bounce_2s_infinite]" />
                  <p className="text-body-sm font-black uppercase tracking-wider drop-shadow-md">
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