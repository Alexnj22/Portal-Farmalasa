import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';

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
    const { isCompat, isAurora } = useTheme();

    const scrollContainerRef = useRef(null);
    const [isScrolled, setIsScrolled] = useState(false);
    const [isDesktop, setIsDesktop] = useState(
        () => typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
    );

    useEffect(() => {
        const check = () => setIsDesktop(window.innerWidth >= 1024);
        window.addEventListener('resize', check);
        return () => window.removeEventListener('resize', check);
    }, []);

    const handleInternalScroll = useCallback(() => {
        if (!scrollContainerRef.current) return;
        requestAnimationFrame(() => {
            const scrolled = scrollContainerRef.current.scrollTop > 15;
            if (scrolled !== isScrolled) setIsScrolled(scrolled);
        });
    }, [isScrolled]);

    // Mask: hides content beneath the fixed header
    const desktopMask = (isAurora || isCompat) ? {
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0px, transparent 76px, black 82px, black 100%)',
        maskImage:        'linear-gradient(to bottom, transparent 0px, transparent 76px, black 82px, black 100%)',
    } : {
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0px, transparent 80px, black 80px, black 100%)',
        maskImage:        'linear-gradient(to bottom, transparent 0px, transparent 80px, black 80px, black 100%)',
    };

    // ── Body card ─────────────────────────────────────────────────────────────
    const bodyCardCls = transparentBody
        ? 'bg-transparent'
        : isCompat
        ? 'bg-white border border-[#d1dde8] shadow-[0_1px_3px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.06)] rounded-[1rem] lg:rounded-[1.5rem] overflow-hidden'
        : isAurora
        ? 'bg-white/[0.09] backdrop-blur-[15px] border border-white/[0.18] shadow-[0_8px_40px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.18)] rounded-[1.5rem] lg:rounded-[2.5rem] overflow-hidden'
        : 'bg-white/60 backdrop-blur-[15px] backdrop-saturate-[300%] border border-white/80 shadow-[inset_0_2px_30px_rgba(255,255,255,0.5),0_14px_40px_rgba(0,0,0,0.04)] hover:shadow-[0_24px_50px_rgba(0,0,0,0.08)] hover:-translate-y-[2px] rounded-[1.5rem] lg:rounded-[2.5rem] overflow-hidden transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]';

    const mobileTitleCls = isAurora ? 'text-white' : 'text-slate-800';

    return (
        <div className="max-w-[1440px] xl:max-w-[1600px] 2xl:max-w-[1800px] mx-auto h-full w-full font-sans animate-view-enter relative overflow-hidden overscroll-none">

            {/* ── AURORA: full-width cosmic banner ──────────────────────────── */}
            {isAurora && (
                <div className="hidden lg:block absolute top-0 left-0 right-0 z-40 pointer-events-none">
                    <div className="relative bg-[#040f20]/92 backdrop-blur-xl border-b border-white/[0.07] px-8 xl:px-10 py-4 xl:py-5 overflow-hidden pointer-events-auto">
                        {/* Ambient orbs */}
                        <div className="absolute -top-12 left-14 w-72 h-36 bg-blue-600/[0.13] rounded-full blur-3xl pointer-events-none" />
                        <div className="absolute -top-8 right-48 w-48 h-28 bg-violet-600/[0.09] rounded-full blur-2xl pointer-events-none" />
                        {/* Bottom scan line */}
                        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-400/[0.20] to-transparent pointer-events-none" />

                        <div className="relative z-10 flex items-center justify-between gap-4">
                            {headerLeft ? headerLeft : (
                                <div className="flex items-center gap-3.5 shrink-0">
                                    {Icon && (
                                        <div className="relative shrink-0">
                                            <div className="absolute inset-0 bg-blue-500/25 rounded-xl blur-xl" />
                                            <div className="relative bg-gradient-to-br from-blue-900/70 to-violet-900/70 border border-blue-400/[0.26] rounded-xl p-2.5 flex items-center justify-center">
                                                <Icon className="text-blue-300" size={20} strokeWidth={1.5} />
                                                {liveIndicator && (
                                                    <span className="absolute -top-1 -right-1 flex h-3 w-3">
                                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500 border-2 border-[#040f20]" />
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    <h2 className="font-black text-[26px] xl:text-[28px] tracking-tight text-white/95 drop-shadow-[0_2px_18px_rgba(147,197,253,0.32)]">
                                        {title}
                                    </h2>
                                </div>
                            )}
                            {filtersContent && (
                                <div className="flex items-center justify-end shrink-0">
                                    {filtersContent}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── COMPAT: solid corporate header bar ────────────────────────── */}
            {isCompat && (
                <div className="hidden lg:block absolute top-0 left-0 right-0 z-40 pointer-events-none">
                    <div className="bg-white border-b-2 border-[#C4D9E8] shadow-[0_1px_6px_rgba(0,0,0,0.06)] px-8 xl:px-10 py-3.5 pointer-events-auto">
                        <div className="flex items-center justify-between gap-4">
                            {headerLeft ? headerLeft : (
                                <div className="flex items-center gap-3 shrink-0">
                                    {Icon && (
                                        <div className="relative shrink-0">
                                            <div className="bg-[#1B3A6B] rounded-lg p-2 shadow-sm flex items-center justify-center">
                                                <Icon className="text-white" size={16} strokeWidth={1.5} />
                                            </div>
                                            {liveIndicator && (
                                                <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                                                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500 border border-white" />
                                                </span>
                                            )}
                                        </div>
                                    )}
                                    <div>
                                        <h2 className="font-black text-[18px] xl:text-[20px] text-[#1B3A6B] tracking-tight leading-none">{title}</h2>
                                        <p className="text-[10px] font-bold text-[#1B3A6B]/40 mt-0.5 uppercase tracking-widest">Portal Farmalasa</p>
                                    </div>
                                </div>
                            )}
                            {filtersContent && (
                                <div className="flex items-center justify-end shrink-0">
                                    {filtersContent}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── LIQUID: floating glass pill header ────────────────────────── */}
            {!isAurora && !isCompat && (
                <div className="hidden lg:block absolute top-6 xl:top-7 left-0 right-0 z-40 px-6 xl:px-8 pointer-events-none">
                    <div data-surface="page-header"
                        className="group/header border rounded-[2.5rem]
                            bg-white/20 backdrop-blur-[10px] backdrop-saturate-[300%] border-white/90
                            shadow-[0_24px_50px_-12px_rgba(0,0,0,0.18)] hover:shadow-[0_32px_64px_-12px_rgba(0,0,0,0.22)]
                            hover:-translate-y-[1px]
                            py-6 px-10 xl:py-7 xl:px-12 relative overflow-hidden pointer-events-auto
                            transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]">

                        <div className="absolute inset-0 bg-gradient-to-b from-white/60 to-transparent pointer-events-none" />

                        <div className="relative z-10 flex flex-row items-center justify-between gap-4">
                            <div className="flex items-center gap-3 min-w-0 shrink-0">
                                {headerLeft ? headerLeft : (
                                    <div className="flex items-center gap-3">
                                        {Icon && (
                                            <div className="bg-gradient-to-tr from-[#0052CC] to-[#6929C4] rounded-2xl shadow-[0_4px_12px_rgba(0,82,204,0.25)] p-2.5 relative flex items-center justify-center hover:scale-110 hover:-rotate-3 transition-transform cursor-pointer">
                                                <Icon className="text-white" size={20} strokeWidth={1.5} />
                                                {liveIndicator && (
                                                    <span className="absolute -top-1 -right-1 flex h-3 w-3">
                                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500 border-2 border-white" />
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                        <h2 className="font-semibold text-[24px] xl:text-[26px] 2xl:text-[28px] tracking-tight text-slate-900">
                                            {title}
                                        </h2>
                                    </div>
                                )}
                            </div>
                            {filtersContent && (
                                <div className="flex items-center justify-end flex-shrink-0">
                                    {filtersContent}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── SCROLL CONTAINER ──────────────────────────────────────────── */}
            <div
                ref={scrollContainerRef}
                className={`absolute inset-0 w-full h-full z-10 px-2 lg:px-6 xl:px-8 pb-10 [&::-webkit-scrollbar]:hidden ${
                    fixedScrollMode ? 'overflow-y-auto lg:overflow-hidden overscroll-contain scroll-smooth' : 'overflow-y-auto overscroll-contain scroll-smooth'
                }`}
                style={isDesktop ? desktopMask : undefined}
                onScroll={handleInternalScroll}
            >
                {/* MOBILE: title inline */}
                <div className="lg:hidden pt-5 pb-4 flex items-center justify-between gap-3 min-h-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                        {headerLeft ? (
                            <div className="min-w-0">{headerLeft}</div>
                        ) : (
                            <>
                                {Icon && (
                                    <div className={`${isCompat ? 'bg-[#1B3A6B]' : 'bg-gradient-to-tr from-[#0052CC] to-[#6929C4]'} rounded-xl shadow-[0_4px_12px_rgba(0,82,204,0.3)] p-2 flex-shrink-0 relative`}>
                                        <Icon className="text-white" size={16} strokeWidth={1.5} />
                                        {liveIndicator && (
                                            <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500 border-[1.5px] border-white" />
                                            </span>
                                        )}
                                    </div>
                                )}
                                <h2 className={`font-bold text-[16px] tracking-tight truncate ${mobileTitleCls}`}>
                                    {title}
                                </h2>
                            </>
                        )}
                    </div>
                    {filtersContent && (
                        <div className="flex-shrink-0 flex items-center">
                            {filtersContent}
                        </div>
                    )}
                </div>

                {/* Desktop spacer — matches the header height */}
                <div className={`hidden lg:block ${(isAurora || isCompat) ? 'h-[90px]' : 'h-[180px] xl:h-[200px]'}`} />

                {/* Content body */}
                <div data-surface={transparentBody ? undefined : 'card'}
                    className={`group/table flex flex-col ${bodyCardCls}`}>
                    {children}
                </div>
            </div>
        </div>
    );
};

export default GlassViewLayout;
