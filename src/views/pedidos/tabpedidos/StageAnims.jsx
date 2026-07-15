// Extracted from TabPedidos.jsx (Bloque 6.C) — small per-stage animations
// used by the pedido lifecycle timeline/cards.
import { motion } from 'framer-motion';
import { CheckCircle2, PackageCheck } from 'lucide-react';

export function MotorcycleAnim() {
    return (
        <motion.div className="shrink-0 text-indigo-500" animate={{ x: [0, 8, 0] }} transition={{ duration: 1.3, repeat: Infinity, ease: 'easeInOut' }}>
            <svg width="44" height="28" viewBox="0 0 64 40" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <motion.circle cx="12" cy="32" r="8" animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} style={{ transformOrigin: '12px 32px' }} />
                <motion.circle cx="52" cy="32" r="8" animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} style={{ transformOrigin: '52px 32px' }} />
                <path d="M12 24 L22 12 L38 12 L46 24 L52 24" />
                <path d="M32 12 L30 4 L46 4" />
                <path d="M38 12 L43 8 L51 8" />
                <circle cx="27" cy="8" r="4" fill="currentColor" opacity="0.5" />
                <path d="M27 12 L24 20 L34 20" />
                <motion.path d="M1 28 L7 28" strokeWidth="1.5" animate={{ x: [-3, 0, -3], opacity: [0.2, 0.8, 0.2] }} transition={{ duration: 0.8, repeat: Infinity }} />
                <motion.path d="M0 33 L6 33" strokeWidth="1.5" animate={{ x: [-3, 0, -3], opacity: [0.1, 0.5, 0.1] }} transition={{ duration: 0.8, repeat: Infinity, delay: 0.12 }} />
            </svg>
        </motion.div>
    );
}

export function BoxStackAnim() {
    return (
        <div className="relative w-10 h-9 shrink-0">
            <motion.div className="absolute bottom-0 left-0 w-9 h-4 rounded-md bg-blue-200 border border-blue-300 shadow-sm" animate={{ y: [0, -1, 0] }} transition={{ duration: 0.85, repeat: Infinity, delay: 0.3, ease: 'easeInOut' }} />
            <motion.div className="absolute bottom-[14px] left-1 w-7 h-3.5 rounded bg-blue-300 border border-blue-400" animate={{ y: [0, -2, 0] }} transition={{ duration: 0.85, repeat: Infinity, delay: 0.1, ease: 'easeInOut' }} />
            <motion.div className="absolute bottom-[25px] left-2 w-5 h-3 rounded bg-blue-400 border border-blue-500" animate={{ y: [0, -2, 0] }} transition={{ duration: 0.85, repeat: Infinity, delay: 0.0, ease: 'easeInOut' }} />
            <motion.div className="absolute bottom-[34px] left-3 w-3 h-2.5 rounded bg-blue-500 border border-blue-600" animate={{ y: [0, -3, 0] }} transition={{ duration: 0.85, repeat: Infinity, delay: -0.1, ease: 'easeInOut' }} />
        </div>
    );
}

export function PausedAnim() {
    return (
        <div className="flex items-center gap-1 shrink-0">
            <motion.div className="w-2 h-6 rounded-sm bg-amber-400" animate={{ scaleY: [1, 0.6, 1], opacity: [1, 0.6, 1] }} transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut' }} />
            <motion.div className="w-2 h-6 rounded-sm bg-amber-400" animate={{ scaleY: [1, 0.6, 1], opacity: [1, 0.6, 1] }} transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut', delay: 0.15 }} />
        </div>
    );
}

export function VioletGlow() {
    return (
        <motion.div animate={{ opacity: [0.4, 1, 0.4], scale: [0.92, 1.08, 0.92] }} transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}>
            <CheckCircle2 size={24} className="text-violet-500" />
        </motion.div>
    );
}

export function ScanAnim() {
    return (
        <div className="relative w-8 h-8 overflow-hidden shrink-0">
            <PackageCheck size={28} className="text-teal-500" />
            <motion.div className="absolute left-0 right-0 h-0.5 bg-teal-400/80 rounded-full" animate={{ top: ['8%', '88%', '8%'] }} transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }} />
        </div>
    );
}

export function PingDot({ color = 'blue', size = 'sm' }) {
    const sz  = size === 'lg' ? 'h-3 w-3' : 'h-2.5 w-2.5';
    const dot = { blue: 'bg-blue-500', amber: 'bg-amber-400', violet: 'bg-violet-500', teal: 'bg-teal-500', indigo: 'bg-indigo-500', emerald: 'bg-emerald-500' }[color] ?? 'bg-blue-500';
    return (
        <span className={`relative flex shrink-0 ${sz}`}>
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${dot} opacity-60`} />
            <span className={`relative inline-flex rounded-full ${sz} ${dot}`} />
        </span>
    );
}

export function StageAnim({ stage }) {
    if (stage === 'transito')   return <MotorcycleAnim />;
    if (stage === 'preparando') return <BoxStackAnim />;
    if (stage === 'pausado')    return <PausedAnim />;
    if (stage === 'preparado')  return <VioletGlow />;
    if (stage === 'contando')   return <ScanAnim />;
    if (stage === 'erp')        return <PingDot color="emerald" size="lg" />;
    return null;
}
