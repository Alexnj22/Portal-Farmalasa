// Extracted from TabPedidos.jsx (Bloque 6.C) — small per-stage animations
// used by the pedido lifecycle timeline/cards.
import { CheckCircle2, PackageCheck } from 'lucide-react';

export function MotorcycleAnim() {
    return (
        <div className="shrink-0 text-chart-3-text anim-stage-ride">
            <svg width="44" height="28" viewBox="0 0 64 40" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="32" r="8" className="anim-stage-wheel" />
                <circle cx="52" cy="32" r="8" className="anim-stage-wheel" />
                <path d="M12 24 L22 12 L38 12 L46 24 L52 24" />
                <path d="M32 12 L30 4 L46 4" />
                <path d="M38 12 L43 8 L51 8" />
                <circle cx="27" cy="8" r="4" fill="currentColor" opacity="0.5" />
                <path d="M27 12 L24 20 L34 20" />
                <path d="M1 28 L7 28" strokeWidth="1.5" className="anim-stage-trail" />
                <path d="M0 33 L6 33" strokeWidth="1.5" className="anim-stage-trail" style={{ animationDelay: '.12s', opacity: .6 }} />
            </svg>
        </div>
    );
}

export function BoxStackAnim() {
    return (
        <div className="relative w-10 h-9 shrink-0">
            <div className="absolute bottom-0 left-0 w-9 h-4 rounded-md bg-chart-1/30 border border-chart-1/40 shadow-sm anim-stage-hop" style={{ '--hop': '-1px', animationDelay: '.3s' }} />
            <div className="absolute bottom-[14px] left-1 w-7 h-3.5 rounded bg-chart-1/50 border border-chart-1 anim-stage-hop" style={{ '--hop': '-2px', animationDelay: '.1s' }} />
            <div className="absolute bottom-[25px] left-2 w-5 h-3 rounded bg-chart-1 border border-chart-1 anim-stage-hop" style={{ '--hop': '-2px' }} />
            <div className="absolute bottom-[34px] left-3 w-3 h-2.5 rounded bg-chart-1 border border-brand anim-stage-hop" style={{ '--hop': '-3px', animationDelay: '-.1s' }} />
        </div>
    );
}

export function PausedAnim() {
    return (
        <div className="flex items-center gap-1 shrink-0">
            <div className="w-2 h-6 rounded-sm bg-warning anim-stage-beat" />
            <div className="w-2 h-6 rounded-sm bg-warning anim-stage-beat" style={{ animationDelay: '.15s' }} />
        </div>
    );
}

export function VioletGlow() {
    return (
        <div className="anim-stage-glow">
            <CheckCircle2 size={24} className="text-chart-3-text" />
        </div>
    );
}

export function ScanAnim() {
    return (
        <div className="relative w-8 h-8 overflow-hidden shrink-0">
            <PackageCheck size={28} className="text-chart-9-text" />
            <div className="absolute left-0 right-0 h-0.5 bg-chart-9/80 rounded-full anim-stage-scan" />
        </div>
    );
}

export function PingDot({ color = 'blue', size = 'sm' }) {
    const sz  = size === 'lg' ? 'h-3 w-3' : 'h-2.5 w-2.5';
    const dot = { blue: 'bg-chart-1', amber: 'bg-warning', violet: 'bg-chart-3', teal: 'bg-chart-9', indigo: 'bg-chart-3', emerald: 'bg-success' }[color] ?? 'bg-chart-1';
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
