import React, { useState, useEffect, useMemo } from 'react';
import { Laptop, AlertCircle, Loader2, Unplug, PowerOff, Activity } from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';

const FormDispositivos = ({ formData }) => {
    const [kiosks, setKiosks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState('');

    // ESTADO PARA CONFIRMACIÓN EN LÍNEA
    const [confirmingId, setConfirmingId] = useState(null);
    const [isRevoking, setIsRevoking] = useState(false);

    const getBranchKiosks = useStaff(state => state.getBranchKiosks);
    const revokeKioskDevice = useStaff(state => state.revokeKioskDevice);

    useEffect(() => {
        if (errorMsg) {
            const timer = setTimeout(() => setErrorMsg(''), 5000);
            return () => clearTimeout(timer);
        }
    }, [errorMsg]);

    useEffect(() => {
        if (formData.id) {
            getBranchKiosks(formData.id).then((data) => {
                setKiosks(data || []);
                setLoading(false);
            }).catch(() => {
                setErrorMsg('Error al cargar la lista de dispositivos.');
                setLoading(false);
            });
        }
    }, [formData.id, getBranchKiosks]);

    // SOLO ACTIVOS
    const activeKiosks = useMemo(() => kiosks.filter(k => k.status === 'ACTIVE'), [kiosks]);

    const executeRevoke = async (deviceId, deviceName) => {
        setIsRevoking(true);
        try {
            const success = await revokeKioskDevice(deviceId, deviceName);
            if (success) {
                setKiosks(prev => prev.filter(k => k.id !== deviceId));
            } else {
                setErrorMsg('No se pudo revocar el Kiosco.');
            }
        } catch (err) {
            setErrorMsg('Ocurrió un error en el servidor.');
        } finally {
            setIsRevoking(false);
            setConfirmingId(null);
        }
    };

    return (
        <div className="w-full flex flex-col space-y-5 animate-in fade-in duration-300">

            {/* BANNER DE ERROR DINÁMICO */}
            <div className={`transition-all duration-300 overflow-hidden ${errorMsg ? 'max-h-20 opacity-100' : 'max-h-0 opacity-0'}`}>
                <div className="bg-red-50 border border-red-200 px-4 py-3 rounded-[1rem] text-[11px] font-bold flex items-center gap-2 shadow-sm text-red-600">
                    <AlertCircle size={16} strokeWidth={2.5} />
                    <span>{errorMsg}</span>
                </div>
            </div>

            {/* 🎛️ ENCABEZADO MINIMALISTA */}
            <div className="flex items-center justify-between px-1">
                <h4 className="text-[12px] font-black uppercase tracking-widest text-slate-800 flex items-center gap-2">
                    <Activity size={16} className="text-[#007AFF]"/> Dispositivos aprobados
                </h4>
                <div className="bg-emerald-50 text-emerald-600 px-3 py-1.5 rounded-full border border-emerald-100 flex items-center gap-1.5 shadow-sm">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                    <span className="text-[9px] font-black tracking-widest uppercase">
                        {activeKiosks.length} / 3
                    </span>
                </div>
            </div>

            {/* CONTENEDOR DE LISTA ÚNICA */}
            <div className="relative min-h-[150px]">
                {loading ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
                        <Loader2 size={28} className="animate-spin mb-3 opacity-50 text-[#007AFF]" />
                        <p className="text-[10px] font-black uppercase tracking-widest">Sincronizando...</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {activeKiosks.length > 0 ? (
                            activeKiosks.map(kiosk => {
                                const isConfirming = confirmingId === kiosk.id;

                                return (
                                    <div key={kiosk.id} className={`flex flex-col p-4 rounded-[1.5rem] transition-all duration-300 ${isConfirming ? 'bg-white/40 border-2 border-red-200 shadow-md' : 'bg-white/60 border border-slate-100 shadow-[0_2px_10px_rgba(0,0,0,0.02)] hover:shadow-md hover:-translate-y-0.5'}`}>
                                        
                                        {/* FILA 1: INFORMACIÓN PRINCIPAL (Nunca se desborda gracias al min-w-0 y truncate) */}
                                        <div className="flex items-center justify-between gap-4">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className={`w-11 h-11 rounded-[1rem] flex items-center justify-center shrink-0 transition-colors ${isConfirming ? 'bg-red-50 text-red-500' : 'bg-slate-50 border border-slate-100 text-slate-500'}`}>
                                                    <Laptop size={20} strokeWidth={isConfirming ? 2.5 : 2} />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className={`text-[13px] font-black leading-tight truncate ${isConfirming ? 'text-red-600' : 'text-slate-800'}`}>
                                                        {kiosk.device_name}
                                                    </p>
                                                    <p className="text-[9px] font-bold tracking-widest uppercase text-slate-400 mt-0.5 truncate">
                                                        {isConfirming ? 'Confirmar desconexión' : `Vinculado: ${new Date(kiosk.created_at).toLocaleDateString()}`}
                                                    </p>
                                                </div>
                                            </div>
                                            
                                            {/* BOTÓN DE APAGAR (Se oculta al confirmar) */}
                                            {!isConfirming && (
                                                <button type="button" onClick={() => setConfirmingId(kiosk.id)} className="w-9 h-9 flex items-center justify-center bg-slate-50 border border-slate-100 text-slate-400 hover:text-red-500 hover:bg-red-50 hover:border-red-200 rounded-xl transition-all shrink-0 active:scale-95" title="Desconectar Kiosco">
                                                    <PowerOff size={14} strokeWidth={2.5} />
                                                </button>
                                            )}
                                        </div>

                                        {/* 🚨 FILA 2: BOTONES DE CONFIRMACIÓN (Usamos grid-cols-2 para que se adapten perfecto al 50% de la tarjeta) */}
                                        {isConfirming && (
                                            <div className="grid grid-cols-2 gap-3 pt-3 mt-3 border-t border-red-100 animate-in fade-in slide-in-from-top-2 duration-200">
                                                <button 
                                                    type="button" 
                                                    disabled={isRevoking} 
                                                    onClick={() => setConfirmingId(null)} 
                                                    className="w-full py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-500 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50"
                                                >
                                                    Cancelar
                                                </button>
                                                <button 
                                                    type="button" 
                                                    disabled={isRevoking} 
                                                    onClick={() => executeRevoke(kiosk.id, kiosk.device_name)} 
                                                    className="w-full py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-sm transition-all active:scale-95 flex items-center justify-center gap-1.5 disabled:opacity-50"
                                                >
                                                    {isRevoking ? <Loader2 size={14} className="animate-spin" /> : <><Unplug size={14} strokeWidth={2.5} /> Revocar</>}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        ) : (
                            <div className="text-center py-10 rounded-[1.5rem] bg-white border border-slate-100 shadow-sm">
                                <div className="w-12 h-12 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-center mx-auto mb-3 text-slate-300">
                                    <Laptop size={20} strokeWidth={2} />
                                </div>
                                <p className="text-[11px] text-slate-500 font-black uppercase tracking-widest">Ningún equipo conectado</p>
                                <p className="text-[10px] text-slate-400 mt-1 font-bold px-4">Inicia sesión en la tablet de la sucursal para vincularla.</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default FormDispositivos;