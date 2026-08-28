/**
 * El QR que se escanea, con su cuenta regresiva.
 *
 * ── Sin librería nueva ──────────────────────────────────────────────────────
 *
 * `@zxing/library` ya está en el portal —lo usa el lector de códigos del
 * login— y sabe ESCRIBIR QR además de leerlos. Agregar `qrcode` habría sido una
 * dependencia más para algo que ya se puede.
 *
 * Va por `await import()`: es una librería pesada y esta pantalla casi siempre
 * se abre sin llegar a pedir un QR.
 *
 * ── La cuenta regresiva no es adorno ────────────────────────────────────────
 *
 * El código vive cinco minutos. Sin verlo correr, quien deja el teléfono un
 * momento vuelve, escanea, y le sale «venció» sin entender por qué. Con el
 * número a la vista, el vencimiento deja de ser una sorpresa.
 */
import React, { useState, useEffect, useRef } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import Button from './Button';

/**
 * @param {string} enlace
 * @param {string} [venceEl]  si no hay, el código no caduca y no se cuenta nada
 * @param {string} [leyenda]  el pie. Por defecto habla del traspaso de la foto,
 *                            pero este mismo dibujante pinta también el carné de
 *                            dependiente, donde «escanéalo con el teléfono» sería
 *                            una instrucción para el trabajo equivocado.
 */
export default function QrDeCaptura({ enlace, venceEl, alVencer, alRenovar, leyenda = 'Escanéalo con el teléfono' }) {
    const caja = useRef(null);
    const [restan, setRestan] = useState(null);
    const [fallo, setFallo] = useState(false);

    useEffect(() => {
        let vivo = true;
        (async () => {
            try {
                const { BrowserQRCodeSvgWriter } = await import('@zxing/library');
                if (!vivo || !caja.current) return;
                caja.current.innerHTML = '';
                new BrowserQRCodeSvgWriter().writeToDom(caja.current, enlace, 200, 200);
                // El SVG sale con el color del texto heredado; se fuerza para que
                // el QR no quede claro sobre claro en el tema oscuro — un QR con
                // poco contraste no lo lee ningún teléfono.
                const svg = caja.current.querySelector('svg');
                if (svg) {
                    svg.setAttribute('style', 'width:200px;height:200px;background:#fff;padding:8px;border-radius:12px');
                    svg.querySelectorAll('rect,path').forEach(el => {
                        if (el.getAttribute('fill') !== '#FFFFFF') el.setAttribute('fill', '#000000');
                    });
                }
            } catch {
                if (vivo) setFallo(true);
            }
        })();
        return () => { vivo = false; };
    }, [enlace]);

    useEffect(() => {
        if (!venceEl) return undefined;
        const fin = new Date(venceEl).getTime();
        const tic = () => {
            const s = Math.max(0, Math.round((fin - Date.now()) / 1000));
            setRestan(s);
            if (s === 0 && alVencer) alVencer();
        };
        tic();
        const id = setInterval(tic, 1000);
        return () => clearInterval(id);
    }, [venceEl, alVencer]);

    const vencido = restan === 0;

    return (
        <div className="flex flex-col items-center gap-3">
            {fallo ? (
                <p className="text-caption text-danger-text font-bold text-center max-w-[200px] leading-snug">
                    No se pudo dibujar el código. Abre esta dirección en el teléfono:<br />
                    <span className="font-mono text-micro break-all">{enlace}</span>
                </p>
            ) : (
                <div ref={caja} className={vencido ? 'opacity-30' : ''}>
                    <Loader2 size={20} className="animate-spin text-content-3" />
                </div>
            )}

            {vencido ? (
                <Button variant="secondary" size="sm" icon={RefreshCw} onClick={alRenovar}>
                    El código venció — pedir otro
                </Button>
            ) : (
                <p className="text-caption font-bold text-content-3">
                    {restan == null ? leyenda
                        : `Vence en ${Math.floor(restan / 60)}:${String(restan % 60).padStart(2, '0')}`}
                </p>
            )}
        </div>
    );
}
