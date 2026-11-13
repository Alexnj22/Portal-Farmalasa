import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';
import Button from './Button';
import { firmaComoImagen } from '@plataforma/firmaComoImagen';

/*
 * Firmar con el dedo (o el mouse) en la pantalla (2026-11-13). Nació para el
 * libro de inyectables: el paciente firma en el teléfono o la tablet de quien
 * aplicó. En pantalla el trazo usa el color del texto del tema; lo que se
 * guarda es tinta negra sobre transparente (`firmaComoImagen`), porque es papel.
 *
 * `onChange(dataUrl | null)` en cada trazo terminado y al borrar.
 */
export default function FirmaEnPantalla({ onChange, etiqueta = 'Firma del paciente', ayuda, disabled = false }) {
    const lienzoRef = useRef(null);
    const trazosRef = useRef([]);
    const dibujandoRef = useRef(false);
    const [hayFirma, setHayFirma] = useState(false);

    const redibujar = useCallback(() => {
        const cv = lienzoRef.current;
        if (!cv) return;
        const ratio = window.devicePixelRatio || 1;
        const { width, height } = cv.getBoundingClientRect();
        if (cv.width !== Math.round(width * ratio)) {
            cv.width = Math.round(width * ratio);
            cv.height = Math.round(height * ratio);
        }
        const ctx = cv.getContext('2d');
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, width, height);
        ctx.strokeStyle = getComputedStyle(cv).color;
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const t of trazosRef.current) {
            if (!t.length) continue;
            ctx.beginPath();
            ctx.moveTo(t[0].x, t[0].y);
            if (t.length === 1) ctx.lineTo(t[0].x + 0.1, t[0].y + 0.1);
            for (const p of t.slice(1)) ctx.lineTo(p.x, p.y);
            ctx.stroke();
        }
    }, []);

    useEffect(() => {
        redibujar();
        const ro = new ResizeObserver(redibujar);
        if (lienzoRef.current) ro.observe(lienzoRef.current);
        return () => ro.disconnect();
    }, [redibujar]);

    const punto = (e) => {
        const r = lienzoRef.current.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const empezar = (e) => {
        if (disabled) return;
        e.preventDefault();
        lienzoRef.current.setPointerCapture?.(e.pointerId);
        dibujandoRef.current = true;
        trazosRef.current.push([punto(e)]);
        redibujar();
    };
    const mover = (e) => {
        if (!dibujandoRef.current) return;
        e.preventDefault();
        trazosRef.current[trazosRef.current.length - 1].push(punto(e));
        redibujar();
    };
    const terminar = () => {
        if (!dibujandoRef.current) return;
        dibujandoRef.current = false;
        const r = lienzoRef.current.getBoundingClientRect();
        setHayFirma(true);
        onChange?.(firmaComoImagen(trazosRef.current, { ancho: r.width, alto: r.height }));
    };
    const borrar = () => {
        trazosRef.current = [];
        setHayFirma(false);
        redibujar();
        onChange?.(null);
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <p className="text-caption font-bold text-content-3">{etiqueta}</p>
                {hayFirma && !disabled && (
                    <Button variant="ghost" size="xs" icon={Eraser} onClick={borrar}>Borrar</Button>
                )}
            </div>
            <canvas
                ref={lienzoRef}
                aria-label={etiqueta}
                role="img"
                className="block w-full h-40 rounded-xl border border-dashed border-border-card bg-surface-input text-content-1 touch-none cursor-crosshair"
                onPointerDown={empezar}
                onPointerMove={mover}
                onPointerUp={terminar}
                onPointerCancel={terminar}
                onPointerLeave={terminar}
            />
            <p className="text-caption text-content-3 mt-1">{ayuda || (hayFirma ? 'Firmado.' : 'Que firme aquí con el dedo.')}</p>
        </div>
    );
}
