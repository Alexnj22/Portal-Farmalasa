import React from 'react';
import { Smartphone, CheckCircle2, AlertCircle, Layers, Move } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';

const Card = ({ title, children, accent }) => (
    <div className={`rounded-[1.25rem] border bg-white/60 backdrop-blur-sm p-4 shadow-sm ${accent || 'border-white/60'}`}>
        <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">{title}</p>
        {children}
    </div>
);

const Row = ({ label, value, ok }) => (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-100/60 last:border-0">
        <span className="text-[13px] text-slate-600">{label}</span>
        <div className="flex items-center gap-1.5">
            {ok != null && (ok
                ? <CheckCircle2 size={13} className="text-emerald-500" />
                : <AlertCircle size={13} className="text-amber-500" />
            )}
            <span className="text-[13px] font-semibold text-slate-800">{value}</span>
        </div>
    </div>
);

const IOSTestView = () => {
    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/.test(ua);
    const isCapacitor = !!(window.Capacitor);

    const safeTop = getComputedStyle(document.documentElement)
        .getPropertyValue('--sat') || 'usar env()';

    return (
        <GlassViewLayout icon={Smartphone} title="Vista de Prueba iOS">
            <div className="p-4 lg:p-8 flex flex-col gap-4">

                {/* Encabezado */}
                <div className="flex items-center gap-3 mb-1">
                    <div className="bg-gradient-to-tr from-emerald-500 to-teal-400 rounded-2xl p-2.5 shadow-lg">
                        <Smartphone size={20} className="text-white" />
                    </div>
                    <div>
                        <h2 className="text-[17px] font-black text-slate-800 leading-tight">Prueba de Layout iOS</h2>
                        <p className="text-[12px] text-slate-500">Verificación de safe areas y scroll</p>
                    </div>
                </div>

                {/* Entorno */}
                <Card title="Entorno detectado">
                    <Row label="Plataforma" value={isIOS ? 'iOS ✓' : 'No iOS'} ok={isIOS} />
                    <Row label="Capacitor" value={isCapacitor ? 'Activo' : 'No detectado'} ok={isCapacitor} />
                    <Row label="viewport-fit" value="cover" ok={true} />
                    <Row label="status-bar" value="black-translucent" ok={true} />
                </Card>

                {/* Qué verificar */}
                <Card title="Lista de verificación visual">
                    <div className="flex flex-col gap-2 mt-1">
                        {[
                            'La barra superior (Dynamic Island / notch) tiene glass blur, NO gris sólido',
                            'La barra inferior (home indicator) tiene glass blur, NO gris sólido',
                            'Se puede hacer scroll aquí abajo',
                            'El contenido NO queda cortado por la pill superior',
                            'Al hacer scroll, el glass del header permanece fijo',
                        ].map((item, i) => (
                            <div key={i} className="flex items-start gap-2.5">
                                <div className="w-5 h-5 rounded-full border-2 border-slate-300 flex-shrink-0 mt-0.5" />
                                <p className="text-[13px] text-slate-700 leading-snug">{item}</p>
                            </div>
                        ))}
                    </div>
                </Card>

                {/* Scroll test — tarjetas de relleno */}
                <Card title="Prueba de scroll — desplázate hacia abajo">
                    <div className="flex flex-col gap-2 mt-1">
                        {Array.from({ length: 12 }, (_, i) => (
                            <div key={i} className="flex items-center justify-between rounded-xl bg-gradient-to-r from-[#0052CC]/8 to-[#6929C4]/8 px-3 py-3 border border-[#0052CC]/10">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-[#0052CC] to-[#6929C4] flex items-center justify-center flex-shrink-0">
                                        <span className="text-white text-[10px] font-black">{i + 1}</span>
                                    </div>
                                    <span className="text-[13px] font-semibold text-slate-700">Fila de prueba {i + 1}</span>
                                </div>
                                <Move size={14} className="text-slate-400" />
                            </div>
                        ))}
                    </div>
                </Card>

                {/* Info */}
                <Card title="Acerca de esta vista" accent="border-amber-200/60">
                    <p className="text-[12px] text-slate-500 leading-relaxed">
                        Esta vista es solo para verificar el comportamiento del layout en iOS. Puede eliminarse
                        una vez confirmado que las safe areas, el glass blur y el scroll funcionan correctamente.
                    </p>
                    <div className="flex items-center gap-1.5 mt-2">
                        <Layers size={12} className="text-amber-500" />
                        <span className="text-[11px] font-bold text-amber-600 uppercase tracking-wider">Solo visible para SUPERADMIN y ADMIN</span>
                    </div>
                </Card>

            </div>
        </GlassViewLayout>
    );
};

export default IOSTestView;
