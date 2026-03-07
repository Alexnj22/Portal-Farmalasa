import React, { useRef, useState, useCallback } from 'react';

const GlassViewLayout = ({
    icon: Icon,
    title,
    liveIndicator = false,
    filtersContent,
    transparentBody = false,
    fixedScrollMode = false,
    children
}) => {
    const scrollContainerRef = useRef(null);
    const [isScrolled, setIsScrolled] = useState(false);

    const handleInternalScroll = useCallback(() => {
        if (!scrollContainerRef.current) return;
        requestAnimationFrame(() => {
            const scrolled = scrollContainerRef.current.scrollTop > 15;
            if (scrolled !== isScrolled) {
                setIsScrolled(scrolled);
            }
        });
    }, [isScrolled]);

    return (
        <div className="max-w-7xl mx-auto h-full w-full font-sans animate-in fade-in duration-700 relative overflow-hidden overscroll-none">

            {/* HEADER COMPACTO Y DE UNA SOLA LÍNEA */}
            <div className="absolute top-4 md:top-6 left-0 right-0 z-40 px-2 md:px-6 pointer-events-none">
                <div className={`group/header backdrop-blur-[10px] backdrop-saturate-[300%] bg-white/20 border border-white/90 shadow-[0_24px_50px_-12px_rgba(0,0,0,0.18)] hover:shadow-[0_32px_64px_-12px_rgba(0,0,0,0.22)] hover:-translate-y-[1px] rounded-[2rem] md:rounded-[2.5rem] py-4 px-4 md:py-6 md:px-10 relative overflow-hidden pointer-events-auto transition-all duration-500 ease-out`}>

                    <div className="absolute inset-0 bg-gradient-to-b from-white/60 to-transparent pointer-events-none"></div>

                    <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">

                        <div className="flex items-center justify-between md:justify-start gap-3 shrink-0">
                            <div className="flex items-center gap-3">
                                {Icon && (
                                    <div className="bg-gradient-to-tr from-[#007AFF] to-[#5856D6] rounded-xl md:rounded-2xl shadow-[0_4px_12px_rgba(0,122,255,0.25)] p-2 md:p-2.5 relative flex items-center justify-center hover:scale-110 hover:-rotate-3 transition-transform cursor-pointer z-10">
                                        <Icon className="text-white" size={20} strokeWidth={1.5} />
                                        {liveIndicator && (
                                            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5 md:h-3 md:w-3">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 md:h-3 md:w-3 bg-red-500 border-2 border-white"></span>
                                            </span>
                                        )}
                                    </div>
                                )}
                                <h2 className="font-semibold text-[18px] md:text-[24px] text-slate-900 tracking-tight">
                                    {title}
                                </h2>
                            </div>
                        </div>

                        {filtersContent && (
                            <div className="flex justify-end w-full md:w-auto transition-all duration-700">
                                {filtersContent}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* CONTENEDOR DE SCROLL Y MÁSCARA */}
            <div
                ref={scrollContainerRef}
                className={`absolute inset-0 w-full h-full z-10 px-2 md:px-6 pb-10 [&::-webkit-scrollbar]:hidden ${fixedScrollMode ? 'overflow-hidden' : 'overflow-y-auto overscroll-contain scroll-smooth'
                    }`} style={{
                        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0px, transparent 80px, black 80px, black 100%)',
                        maskImage: 'linear-gradient(to bottom, transparent 0px, transparent 80px, black 80px, black 100%)'
                    }}
                onScroll={handleInternalScroll}
            >
                <div className="w-full shrink-0 pointer-events-none h-[140px] md:h-[190px]"></div>

                {/* ✅ LÓGICA DE FONDO: Si es transparente, no ponemos el cristal blanco, solo mostramos el children */}
                <div className={`group/table flex flex-col transition-all duration-500 ease-out transform-gpu ${transparentBody
                        ? 'bg-transparent' // Sin caja para Anuncios
                        : 'bg-white/60 backdrop-blur-[15px] backdrop-saturate-[300%] rounded-[2rem] md:rounded-[2.5rem] border border-white/80 shadow-[inset_0_2px_30px_rgba(255,255,255,0.5),0_14px_40px_rgba(0,0,0,0.04)] hover:shadow-[0_24px_50px_rgba(0,0,0,0.08)] hover:-translate-y-[2px] overflow-hidden' // Caja Liquid Glass para Tablas
                    }`}>
                    {children}
                </div>
            </div>
        </div>
    );
};

export default GlassViewLayout;