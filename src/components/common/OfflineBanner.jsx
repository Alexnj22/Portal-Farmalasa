import React, { useEffect, useState } from 'react';
import { WifiOff, Wifi } from 'lucide-react';

export default function OfflineBanner() {
    const [isOnline, setIsOnline] = useState(() => navigator.onLine);
    const [wasOffline, setWasOffline] = useState(false);
    const [showRestored, setShowRestored] = useState(false);

    useEffect(() => {
        const goOnline = () => {
            setIsOnline(true);
            if (wasOffline) {
                setShowRestored(true);
                const t = setTimeout(() => { setShowRestored(false); setWasOffline(false); }, 3000);
                return () => clearTimeout(t);
            }
        };
        const goOffline = () => {
            setIsOnline(false);
            setWasOffline(true);
            setShowRestored(false);
        };
        window.addEventListener('online',  goOnline);
        window.addEventListener('offline', goOffline);
        return () => {
            window.removeEventListener('online',  goOnline);
            window.removeEventListener('offline', goOffline);
        };
    }, [wasOffline]);

    if (isOnline && !showRestored) return null;

    const isWarning = !isOnline;

    return (
        <div
            role="status"
            aria-live="polite"
            className={`fixed top-4 left-1/2 -translate-x-1/2 z-[500]
                flex items-center gap-2.5 px-5 py-2.5
                rounded-[1.5rem] border
                backdrop-blur-2xl backdrop-saturate-[180%]
                shadow-[0_8px_32px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.80)]
                transition-all duration-300 animate-in fade-in slide-in-from-top-2
                ${isWarning
                    ? 'bg-amber-50/90 border-amber-200/80 text-amber-700'
                    : 'bg-emerald-50/90 border-emerald-200/80 text-emerald-700'}`}
        >
            {isWarning
                ? <WifiOff size={14} strokeWidth={2.5} className="shrink-0" />
                : <Wifi    size={14} strokeWidth={2.5} className="shrink-0" />}
            <span className="text-[11px] font-black uppercase tracking-widest whitespace-nowrap">
                {isWarning ? 'Sin conexión' : 'Conexión restaurada'}
            </span>
        </div>
    );
}
