import React, { useState, useEffect } from 'react';
import { Monitor, Laptop, Trash2, AlertCircle, Loader2 } from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore'; 

const FormDispositivos = ({ formData }) => {
    const [kiosks, setKiosks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState('');
    
    // ✅ ESTADO PARA CONFIRMACIÓN EN LÍNEA (INLINE)
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

    // ✅ EJECUCIÓN DE BORRADO
    const executeRevoke = async (deviceId, deviceName) => {
        setIsRevoking(true);
        try {
            const success = await revokeKioskDevice(deviceId, deviceName);
            if (success) {
                setKiosks((prev) => prev.filter((k) => k.id !== deviceId));
            } else {
                setErrorMsg('No se pudo desconectar el Kiosco.');
            }
        } catch (err) {
            setErrorMsg('Ocurrió un error en el servidor.');
        } finally {
            setIsRevoking(false);
            setConfirmingId(null);
        }
    };

    return (
        <div className="space-y-6 relative">
            <div className="rounded-[1.5rem] border border-indigo-100 bg-indigo-50/30 p-6">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                            <Monitor size={20} className="text-indigo-600" />
                        </div>
                        <div>
                            <p className="text-[12px] font-black text-indigo-900 uppercase tracking-widest">
                                Gestión de Kioscos
                            </p>
                            <p className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider">
                                {kiosks.length} / 3 DISPOSITIVOS AUTORIZADOS
                            </p>
                        </div>
                    </div>
                </div>

                {/* BANNER DE ERROR DINÁMICO */}
                <div className={`transition-all duration-300 overflow-hidden ${errorMsg ? 'max-h-20 opacity-100 mb-4' : 'max-h-0 opacity-0 mb-0'}`}>
                    <div className="bg-red-50 text-red-600 border border-red-200 px-4 py-2.5 rounded-xl text-[11px] font-bold flex items-center gap-2 shadow-sm">
                        <AlertCircle size={16} strokeWidth={2.5} />
                        <span>{errorMsg}</span>
                    </div>
                </div>

                {loading ? (
                    <div className="py-8 text-center text-slate-400 text-xs font-bold animate-pulse">
                        Cargando dispositivos vinculados...
                    </div>
                ) : (
                    <div className="space-y-3">
                        {kiosks.length > 0 ? (
                            kiosks.map(kiosk => {
                                const isConfirming = confirmingId === kiosk.id;

                                return (
                                    <div key={kiosk.id} className={`flex items-center justify-between p-4 bg-white border rounded-2xl shadow-sm transition-all duration-300 ${isConfirming ? 'border-red-300 shadow-red-500/10 bg-red-50/50' : 'border-indigo-100/50 hover:shadow-md group'}`}>
                                        <div className="flex items-center gap-4">
                                            <div className={`h-10 w-10 rounded-full border flex items-center justify-center transition-colors ${isConfirming ? 'bg-red-100 border-red-200 text-red-500' : 'bg-indigo-50 border-indigo-100 text-indigo-400'}`}>
                                                <Laptop size={18} />
                                            </div>
                                            <div>
                                                <p className={`text-sm font-bold ${isConfirming ? 'text-red-700' : 'text-slate-700'}`}>
                                                    {kiosk.device_name}
                                                </p>
                                                <p className={`text-[10px] font-mono font-medium ${isConfirming ? 'text-red-400' : 'text-slate-400'}`}>
                                                    Activo desde: {new Date(kiosk.created_at).toLocaleDateString()}
                                                </p>
                                            </div>
                                        </div>
                                        
                                        {/* ✅ LÓGICA INLINE CON type="button" PARA EVITAR CERRAR EL MODAL */}
                                        {isConfirming ? (
                                            <div className="flex items-center gap-2 animate-in fade-in zoom-in-95 duration-200">
                                                <button 
                                                    type="button" 
                                                    disabled={isRevoking}
                                                    onClick={() => executeRevoke(kiosk.id, kiosk.device_name)}
                                                    className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-sm active:scale-95 transition-all flex items-center gap-1 disabled:opacity-50"
                                                >
                                                    {isRevoking ? <Loader2 size={12} className="animate-spin"/> : 'Desconectar'}
                                                </button>
                                                <button 
                                                    type="button" 
                                                    disabled={isRevoking}
                                                    onClick={() => setConfirmingId(null)}
                                                    className="px-4 py-2 bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-sm active:scale-95 transition-all disabled:opacity-50"
                                                >
                                                    Cancelar
                                                </button>
                                            </div>
                                        ) : (
                                            <button 
                                                type="button" 
                                                onClick={() => setConfirmingId(kiosk.id)}
                                                className="p-3 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                                                title="Revocar acceso"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </div>
                                );
                            })
                        ) : (
                            <div className="text-center py-8 border-2 border-dashed border-indigo-200/50 rounded-2xl bg-white/50">
                                <p className="text-[11px] text-slate-400 font-bold uppercase tracking-wide">No hay dispositivos activos.</p>
                                <p className="text-[10px] text-indigo-400 mt-2 px-6 font-medium leading-relaxed">
                                    Para vincular uno, ingresa al Kiosco de la sucursal y usa tu PIN administrativo.
                                </p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default FormDispositivos;