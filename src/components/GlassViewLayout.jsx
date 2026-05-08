import React, { useRef, useState, useCallback } from 'react';

const GlassViewLayout = ({
    icon: Icon,
    title,
    liveIndicator = false,
    filtersContent,
    headerLeft,
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
        <div className="max-w-[1440px] xl:max-w-[1600px] 2xl:max-w-[1800px] mx-auto h-full w-full font-sans animate-in fade-in duration-700 relative overflow-hidden overscroll-none transition-all duration-500">

            {/* HEADER FLOTANTE */}
            <div className="absolute top-2 lg:top-6 xl:top-7 left-0 right-0 z-40 px-2 lg:px-6 xl:px-8 pointer-events-none">
                <div className="group/header backdrop-blur-[10px] backdrop-saturate-[300%] bg-white/20 border border-white/90 shadow-[0_24px_50px_-12px_rgba(0,0,0,0.18)] hover:shadow-[0_32px_64px_-12px_rgba(0,0,0,0.22)] hover:-translate-y-[1px] rounded-[1.25rem] lg:rounded-[2.5rem] py-2.5 px-3 lg:py-6 lg:px-10 xl:py-7 xl:px-12 relative overflow-hidden pointer-events-auto transition-all duration-500 ease-out">

                    <div className="absolute inset-0 bg-gradient-to-b from-white/60 to-transparent pointer-events-none"></div>

                    {/* Siempre flex-row — sin stacking en mobile */}
                    <div className="relative z-10 flex flex-row items-center justify-between gap-3 min-h-0">

                        <div className="flex items-center gap-2 lg:gap-3 min-w-0 shrink-0">
                            {headerLeft ? headerLeft : (
                                <div className="flex items-center gap-2 lg:gap-3 min-w-0">
                                    {Icon && (
                                        <div className="bg-gradient-to-tr from-[#007AFF] to-[#5856D6] rounded-lg lg:rounded-2xl shadow-[0_4px_12px_rgba(0,122,255,0.25)] p-1.5 lg:p-2.5 relative flex items-center justify-center flex-shrink-0 hover:scale-110 hover:-rotate-3 transition-transform cursor-pointer z-10">
                                            <Icon className="text-white" size={16} strokeWidth={1.5} />
                                            {liveIndicator && (
                                                <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5 lg:h-3 lg:w-3">
                                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 lg:h-3 lg:w-3 bg-red-500 border-2 border-white"></span>
                                                </span>
                                            )}
                                        </div>
                                    )}
                                    <h2 className="font-semibold text-[14px] lg:text-[24px] xl:text-[26px] 2xl:text-[28px] text-slate-900 tracking-tight truncate">
                                        {title}
                                    </h2>
                                </div>
                            )}
                        </div>

                        {filtersContent && (
                            <div className="flex items-center justify-end flex-shrink-0 transition-all duration-700">
                                {filtersContent}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* CONTENEDOR DE SCROLL */}
            <div
                ref={scrollContainerRef}
                className={`absolute inset-0 w-full h-full z-10 px-2 lg:px-6 xl:px-8 pb-10 [&::-webkit-scrollbar]:hidden ${fixedScrollMode ? 'overflow-hidden' : 'overflow-y-auto overscroll-contain scroll-smooth'
                    }`} style={{
                        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0px, transparent 60px, black 60px, black 100%)',
                        maskImage: 'linear-gradient(to bottom, transparent 0px, transparent 60px, black 60px, black 100%)'
                    }}
                onScroll={handleInternalScroll}
            >
                {/* Espaciador: pequeño en mobile/tablet, grande en desktop */}
                <div className="w-full shrink-0 pointer-events-none h-[62px] lg:h-[180px] xl:h-[200px]"></div>

                <div className={`group/table flex flex-col transition-all duration-500 ease-out transform-gpu ${transparentBody
                        ? 'bg-transparent'
                        : 'bg-white/60 backdrop-blur-[15px] backdrop-saturate-[300%] rounded-[1.5rem] lg:rounded-[2.5rem] border border-white/80 shadow-[inset_0_2px_30px_rgba(255,255,255,0.5),0_14px_40px_rgba(0,0,0,0.04)] hover:shadow-[0_24px_50px_rgba(0,0,0,0.08)] hover:-translate-y-[2px] overflow-hidden'
                    }`}>
                    {children}
                </div>
            </div>
        </div>
    );
};

export default GlassViewLayout;
