import React from 'react';
import { LogOut } from 'lucide-react';

const UserHeader = ({ user, handleLogout }) => {
    return (
        <div className="flex items-center justify-between p-4 bg-white border-b border-slate-200 sticky top-0 z-20 shadow-sm">
            <div>
                <h1 className="text-xl font-bold text-slate-700 tracking-tight">Portal Corporativo</h1>
            </div>
            <div className="flex items-center gap-3">
                <div className="text-right hidden sm:block">
                    <p className="text-sm font-bold text-slate-800">{user?.name || 'Usuario'}</p>
                    <p className="text-xs text-slate-500">{user?.role || (user?.userType === 'admin' ? 'Administrador' : 'Empleado')}</p>
                </div>
                <div className="h-10 w-10 rounded-full bg-slate-200 overflow-hidden border border-slate-300 flex-shrink-0">
                    {user?.photo ? (
                        <img src={user.photo} alt={user?.name || 'User'} className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center font-bold text-slate-500">
                            {user?.name?.charAt(0) || 'U'}
                        </div>
                    )}
                </div>
                <button 
                    onClick={handleLogout} 
                    className="ml-2 p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" 
                    title="Cerrar Sesión"
                >
                    <LogOut size={18} />
                </button>
            </div>
        </div>
    );
};

export default UserHeader;