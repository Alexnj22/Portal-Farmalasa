import React from 'react';
import { LogOut, Building2 } from 'lucide-react';

const UserHeader = ({ user, handleLogout }) => {
  return (
    // 🚨 MAGIA PARA IOS: El padding-top se ajusta dinámicamente al notch/isla
    <header className="sticky top-0 z-50 w-full animate-in slide-in-from-top-4 fade-in duration-700 
        pt-[max(env(safe-area-inset-top,16px),16px)] 
        pb-4 
        pl-[max(env(safe-area-inset-left,24px),24px)] 
        pr-[max(env(safe-area-inset-right,24px),24px)]">
        
        {/* Contenedor Glass Flotante */}
        <div className="flex items-center justify-between bg-white/70 backdrop-blur-2xl border border-white/40 shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-2xl px-5 py-3 transition-all hover:bg-white/80 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)]">
            
            {/* --- LOGO + TÍTULO --- */}
            <div className="flex items-center gap-3.5">
                 <div className="relative group">
                     {/* Efecto de brillo detrás del logo */}
                     <div className="absolute inset-0 bg-blue-500 rounded-xl blur opacity-20 group-hover:opacity-40 transition-opacity duration-500"></div>
                     <div className="relative p-2.5 bg-gradient-to-br from-[#007AFF] to-[#0055FF] rounded-xl text-white shadow-lg border border-white/20 group-hover:scale-105 transition-transform duration-300">
                         <Building2 size={20} className="drop-shadow-sm" />
                     </div>
                 </div>
                 
                 <div className="flex flex-col">
                     <h1 className="text-sm font-black text-slate-800 uppercase tracking-tight leading-none bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-600">
                         Portal Farmacias
                     </h1>
                     <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="h-0.5 w-3 bg-[#007AFF] rounded-full"></span>
                        <p className="text-[10px] font-bold text-[#007AFF] uppercase tracking-[0.2em]">
                            La Popular y La Salud
                        </p>
                     </div>
                 </div>
            </div>

            {/* --- USUARIO + ACCIONES --- */}
            <div className="flex items-center gap-5">
                
                {/* Info Usuario */}
                <div className="hidden md:flex items-center gap-3 pl-5 border-l border-slate-200/60">
                    <div className="text-right">
                        <p className="text-xs font-bold text-slate-700 leading-tight">{user?.name}</p>
                        <div className="flex items-center justify-end gap-1.5 mt-0.5">
                            <span className="relative flex h-1.5 w-1.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                            </span>
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{user?.role || 'Staff'}</p>
                        </div>
                    </div>
                    
                    {/* Avatar con anillo glass */}
                    <div className="relative h-11 w-11 rounded-full p-1 bg-white border border-slate-100 shadow-sm">
                        <div className="h-full w-full rounded-full overflow-hidden bg-slate-100 relative">
                            {user?.photo ? (
                                <img src={user?.photo} className="w-full h-full object-cover" alt="Avatar" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center bg-slate-100 text-slate-400 font-black text-sm">
                                    {user?.name?.charAt(0)}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Botón Logout Estilizado */}
                <button 
                    onClick={handleLogout}
                    className="group relative p-2.5 rounded-xl bg-slate-50 hover:bg-red-50 border border-slate-100 hover:border-red-100 text-slate-400 hover:text-red-500 transition-all duration-300 active:scale-95"
                    title="Cerrar Sesión"
                >
                    <LogOut size={18} className="transition-transform group-hover:-translate-x-0.5" />
                </button>
            </div>
        </div>
    </header>
  );
};

export default UserHeader;