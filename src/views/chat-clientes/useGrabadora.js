import { useCallback, useEffect, useRef, useState } from 'react';

// Graba una nota de voz con el micrófono de la computadora (2026-10-21).
//
// El formato es `audio/mp4` (AAC) y no el `webm` que Chrome elige solo: el
// bucket sólo acepta audio mp4/aac/mpeg, y el iPhone del cliente no abre webm.
// Chrome y Safari lo graban (medido con `MediaRecorder.isTypeSupported`); si un
// navegador no puede, `soportada` es falso y el botón ni aparece.
//
// `detener()` devuelve `{ archivo, duracion }` (segundos enteros, que es lo que
// la app del cliente pinta como 0:07); `cancelar()` descarta lo grabado.

const FORMATOS = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4'];
export const MAX_SEGUNDOS = 180;

const formatoGrabable = () => {
    if (typeof window === 'undefined' || !window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) return null;
    return FORMATOS.find((f) => window.MediaRecorder.isTypeSupported(f)) ?? null;
};

export default function useGrabadora({ onTope } = {}) {
    const [estado, setEstado] = useState('libre');   // 'libre' | 'pidiendo' | 'grabando'
    const [segundos, setSegundos] = useState(0);
    const grabadorRef = useRef(null);
    const trozosRef = useRef([]);
    const inicioRef = useRef(0);
    const relojRef = useRef(null);
    const onTopeRef = useRef(onTope);
    useEffect(() => { onTopeRef.current = onTope; }, [onTope]);

    const soportada = !!formatoGrabable();

    const soltar = useCallback(() => {
        clearInterval(relojRef.current);
        relojRef.current = null;
        const g = grabadorRef.current;
        g?.stream?.getTracks().forEach((t) => t.stop());
        grabadorRef.current = null;
        setEstado('libre');
        setSegundos(0);
    }, []);

    // Al desmontar (cambiar de conversación) el micrófono se apaga: una luz de
    // «grabando» encendida sin pantalla que la muestre es lo peor que puede pasar.
    useEffect(() => () => soltar(), [soltar]);

    const empezar = useCallback(async () => {
        const formato = formatoGrabable();
        if (!formato || grabadorRef.current) return;
        setEstado('pidiendo');
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err) {
            setEstado('libre');
            throw err;
        }
        const g = new window.MediaRecorder(stream, { mimeType: formato });
        trozosRef.current = [];
        g.ondataavailable = (e) => { if (e.data?.size) trozosRef.current.push(e.data); };
        grabadorRef.current = g;
        g.start(250);
        inicioRef.current = Date.now();
        setSegundos(0);
        setEstado('grabando');
        relojRef.current = setInterval(() => {
            const s = Math.floor((Date.now() - inicioRef.current) / 1000);
            setSegundos(s);
            if (s >= MAX_SEGUNDOS) onTopeRef.current?.();
        }, 250);
    }, []);

    const detener = useCallback(() => new Promise((resolve) => {
        const g = grabadorRef.current;
        if (!g) { resolve(null); return; }
        const duracion = Math.max(1, Math.round((Date.now() - inicioRef.current) / 1000));
        g.onstop = () => {
            const archivo = new Blob(trozosRef.current, { type: 'audio/mp4' });
            trozosRef.current = [];
            resolve(archivo.size ? { archivo, duracion } : null);
        };
        g.stop();
        soltar();
    }), [soltar]);

    const cancelar = useCallback(() => {
        const g = grabadorRef.current;
        if (g) { g.onstop = null; if (g.state !== 'inactive') g.stop(); }
        trozosRef.current = [];
        soltar();
    }, [soltar]);

    return { soportada, estado, segundos, empezar, detener, cancelar };
}
