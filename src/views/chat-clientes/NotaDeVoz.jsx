import React, { useRef, useState } from 'react';
import { Mic, Pause, Play } from 'lucide-react';

// La nota de voz del cliente dentro del globo. No usa los controles del
// navegador: en Safari salen como una barra gris con «Error» escrito cuando el
// archivo no carga, y no siguen el color del globo. Acá: un botón, la barra de
// avance (tocarla salta a ese punto) y el tiempo. Si el archivo no se puede
// reproducir, lo dice en palabras.

const mmss = (s) => {
    const n = Number.isFinite(s) ? Math.max(0, Math.floor(s)) : 0;
    return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};

// Velocidad como en WhatsApp: 1× → 1.5× → 2×. La elegida se recuerda para las
// siguientes notas mientras la pestaña siga abierta.
const VELOCIDADES = [1, 1.5, 2];
let velocidadElegida = 1;

export default function NotaDeVoz({ src, delEquipo = false }) {
    const audioRef = useRef(null);
    const [sonando, setSonando] = useState(false);
    const [actual, setActual] = useState(0);
    const [duracion, setDuracion] = useState(null);
    const [fallo, setFallo] = useState(!src);
    const [velocidad, setVelocidad] = useState(velocidadElegida);

    if (fallo) {
        return (
            <span className="flex items-center gap-2 text-label opacity-80">
                <Mic size={14} className="shrink-0" /> Nota de voz no disponible
            </span>
        );
    }

    const alternar = () => {
        const a = audioRef.current;
        if (!a) return;
        if (a.paused) a.play().catch(() => setFallo(true));
        else a.pause();
    };
    const saltar = (e) => {
        const a = audioRef.current;
        if (!a || !duracion) return;
        const caja = e.currentTarget.getBoundingClientRect();
        a.currentTime = Math.min(duracion, Math.max(0, ((e.clientX - caja.left) / caja.width) * duracion));
    };
    const cambiarVelocidad = () => {
        const v = VELOCIDADES[(VELOCIDADES.indexOf(velocidad) + 1) % VELOCIDADES.length];
        velocidadElegida = v;
        setVelocidad(v);
        if (audioRef.current) audioRef.current.playbackRate = v;
    };
    const avance = duracion ? Math.min(100, (actual / duracion) * 100) : 0;

    return (
        <span className="flex items-center gap-2.5 min-w-[13rem]">
            <audio ref={audioRef} src={src} preload="metadata" className="hidden"
                onLoadedMetadata={(e) => setDuracion(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : null)}
                onTimeUpdate={(e) => setActual(e.currentTarget.currentTime)}
                onPlay={(e) => { e.currentTarget.playbackRate = velocidad; setSonando(true); }} onPause={() => setSonando(false)}
                onEnded={() => { setSonando(false); setActual(0); }}
                onError={() => setFallo(true)} />
            <button type="button" onClick={alternar} aria-label={sonando ? 'Pausar la nota de voz' : 'Escuchar la nota de voz'}
                className={`shrink-0 size-9 min-w-[var(--tap-min)] min-h-[var(--tap-min)] md:min-w-0 md:min-h-0 rounded-full inline-flex items-center justify-center active:scale-[0.97]
                    ${delEquipo ? 'bg-brand-dark/40' : 'bg-brand text-white'}`}>
                {sonando ? <Pause size={16} className="fill-current" /> : <Play size={16} className="fill-current translate-x-px" />}
            </button>
            <span className="flex-1 min-w-0 flex flex-col gap-1">
                <span role="progressbar" aria-label="Avance de la nota de voz" aria-valuemin={0} aria-valuemax={100}
                    aria-valuenow={Math.round(avance)} onClick={saltar}
                    className={`relative block h-1.5 rounded-full cursor-pointer ${delEquipo ? 'bg-brand-dark/40' : 'bg-content-3/30'}`}>
                    <span className={`absolute inset-y-0 left-0 rounded-full ${delEquipo ? 'bg-current' : 'bg-brand'}`} style={{ width: `${avance}%` }} />
                </span>
                <span className="text-micro tabular-nums opacity-80">
                    {sonando || actual ? mmss(actual) : <><Mic size={10} className="inline -mt-px" /> {duracion ? mmss(duracion) : 'Nota de voz'}</>}
                </span>
            </span>
            <button type="button" onClick={cambiarVelocidad} aria-label={`Velocidad ${velocidad}×, tocar para cambiar`}
                className={`shrink-0 h-6 min-w-[2.5rem] min-h-[var(--tap-min)] md:min-h-0 px-1.5 rounded-badge text-micro font-bold tabular-nums active:scale-[0.97]
                    ${delEquipo ? 'bg-brand-dark/40' : 'bg-content-3/15 text-content-2'}`}>
                {velocidad}×
            </button>
        </span>
    );
}
