import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import AsaHoja from './AsaHoja';
import Button from './Button';
import ModalShell from './ModalShell';
import useCoarsePointer from '../../plataforma/useCoarsePointer';
import useCapaFlotante from '../../plataforma/capaFlotante';
import { rotuloCampo } from '@nucleo/utils/rotuloDeCampo';

/**
 * Un MES y un año, escritos o elegidos (2026-10-29). Nace del vencimiento de
 * la ampolla en Mi caja: el `<input type="month">` nativo no existe en Safari
 * —se veía un campo de texto suelto— y `LiquidDatePicker` siempre pide el día,
 * que una ampolla no imprime.
 *
 * Se escribe como se lee en el empaque: los dígitos y nada más; la «/» la pone
 * el campo. «2» ya es febrero («02/»), y el año va de dos o de cuatro cifras.
 * O se elige del cuadro de meses con el botón del calendario.
 *
 * Emite `'AAAA-MM'` cuando el mes está completo y válido; mientras no, emite el
 * texto tal cual, para que quien valida (`motivoDelLote`) diga qué falta en vez
 * de quedarse con el valor anterior.
 *
 * `desde` ('AAAA-MM'): los meses anteriores se apagan en el cuadro. No frena lo
 * escrito — eso lo dice el validador, con su motivo.
 */
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const ANCHO = 264;
const ALTO = 250;

const aTexto = (v) => {
    const m = /^(\d{4})-(\d{2})$/.exec(String(v || ''));
    return m ? `${m[2]}/${m[1]}` : String(v || '');
};

/** Del texto escrito al valor: 'AAAA-MM' si se entiende, el texto si no. */
function aValor(texto) {
    const m = /^(\d{2})\/(\d{2}|\d{4})$/.exec(texto);
    if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return texto;
    return `${m[2].length === 2 ? `20${m[2]}` : m[2]}-${m[1]}`;
}

/** La máscara: sólo dígitos, la «/» sola después del mes. `creciendo` = no se está borrando. */
function enmascarar(crudo, creciendo) {
    let d = String(crudo).replace(/\D/g, '').slice(0, 6);
    if (d.length === 1 && Number(d) > 1) d = `0${d}`;          // «2» ya es febrero
    if (d.length >= 2 && d[0] === '1' && Number(d[1]) > 2) d = `01${d.slice(1)}`; // «13» → 01/3
    if (d.length < 2) return d;
    const mes = d.slice(0, 2);
    const anio = d.slice(2);
    if (!anio) return creciendo ? `${mes}/` : mes;
    return `${mes}/${anio}`;
}

export default function CampoMesAnio({ label, value, onChange, desde = null, placeholder = 'MM/AA' }) {
    const esTactil = useCoarsePointer();
    const [texto, setTexto] = useState(() => aTexto(value));
    const [ultimo, setUltimo] = useState(value);
    // El padre puede cambiar el valor (elegir del cuadro, vaciar al cambiar de
    // venta): se adopta salvo que sea el mismo que este campo acaba de emitir.
    if (value !== ultimo) {
        setUltimo(value);
        if (aValor(texto) !== value) setTexto(aTexto(value));
    }

    const [abierto, setAbierto] = useState(false);
    const hoy = new Date();
    const [anioVista, setAnioVista] = useState(hoy.getFullYear());
    const [pos, setPos] = useState({ top: 0, left: 0 });
    const cajaRef = useRef(null);
    const popRef = useRef(null);

    const [dAnio, dMes] = (desde || '').split('-').map(Number);
    const mesApagado = (anio, i) => Boolean(desde) && (anio < dAnio || (anio === dAnio && i + 1 < dMes));
    const sel = /^(\d{4})-(\d{2})$/.exec(String(value || ''));

    const emitir = (t) => { setTexto(t); const v = aValor(t); setUltimo(v); onChange(v); };

    const abrir = () => {
        if (sel) setAnioVista(Number(sel[1]));
        else if (desde) setAnioVista(dAnio);
        const r = cajaRef.current?.getBoundingClientRect();
        if (r) {
            const abajo = window.innerHeight - r.bottom >= ALTO + 12 || r.top < ALTO + 12;
            setPos({
                top: (abajo ? r.bottom + 8 : r.top - ALTO - 8) + window.scrollY,
                left: Math.max(12, Math.min(r.right - ANCHO, window.innerWidth - ANCHO - 12)) + window.scrollX,
            });
        }
        setAbierto(true);
    };

    useCapaFlotante(abierto && !esTactil);
    useEffect(() => {
        if (!abierto || esTactil) return undefined;
        const fuera = (e) => {
            if (!popRef.current?.contains(e.target) && !cajaRef.current?.contains(e.target)) setAbierto(false);
        };
        const tecla = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setAbierto(false); } };
        const scroll = () => setAbierto(false);
        document.addEventListener('mousedown', fuera);
        document.addEventListener('keydown', tecla, true);
        window.addEventListener('scroll', scroll, true);
        return () => {
            document.removeEventListener('mousedown', fuera);
            document.removeEventListener('keydown', tecla, true);
            window.removeEventListener('scroll', scroll, true);
        };
    }, [abierto, esTactil]);

    const elegir = (i) => {
        emitir(`${String(i + 1).padStart(2, '0')}/${anioVista}`);
        setAbierto(false);
    };

    const anioMin = desde ? dAnio : null;
    const cuadro = (
        <>
            <div className="flex justify-between items-center mb-4 px-1">
                <Button variant="secondary" icon={ChevronLeft} iconOnly aria-label="Año anterior"
                    disabled={anioMin != null && anioVista <= anioMin} onClick={() => setAnioVista((a) => a - 1)} />
                <span className="text-body font-bold text-content tabular-nums">{anioVista}</span>
                <Button variant="secondary" icon={ChevronRight} iconOnly aria-label="Año siguiente"
                    onClick={() => setAnioVista((a) => a + 1)} />
            </div>
            <div className="grid grid-cols-3 gap-2">
                {MESES.map((m, i) => {
                    const apagado = mesApagado(anioVista, i);
                    const elegido = sel && Number(sel[1]) === anioVista && Number(sel[2]) === i + 1;
                    return (
                        <button key={m} type="button" disabled={apagado} onClick={() => elegir(i)}
                            className={`min-h-[var(--tap-min)] py-2.5 rounded-2xl text-body-sm font-bold uppercase tracking-wide transition-all active:scale-[0.97]
                                ${apagado ? 'text-content-3 opacity-40 cursor-not-allowed'
                                    : elegido ? 'bg-brand text-white shadow-lg'
                                        : 'text-content-2 hover:bg-surface-card-hover hover:text-brand-text'}`}>
                            {m}
                        </button>
                    );
                })}
            </div>
        </>
    );

    return (
        <div className="flex flex-col">
            {label && <span className={rotuloCampo()}>{label}</span>}
            <div ref={cajaRef} data-surface="input" className="relative flex items-center h-[max(40px,var(--tap-min))] rounded-input">
                <input
                    type="text" inputMode="numeric" autoComplete="off" aria-label={label || 'Mes y año'}
                    value={texto} placeholder={placeholder} maxLength={7}
                    onChange={(e) => emitir(enmascarar(e.target.value, e.target.value.length > texto.length))}
                    className="flex-1 min-w-0 h-full bg-transparent border-none outline-none pl-4 pr-2 text-body-xl font-bold text-content tabular-nums placeholder:text-content-3"
                />
                <button type="button" aria-label="Elegir el mes" aria-haspopup="dialog" aria-expanded={abierto}
                    onClick={() => (abierto ? setAbierto(false) : abrir())}
                    className="mr-1.5 flex items-center justify-center w-9 h-9 min-w-[var(--tap-min)] min-h-[var(--tap-min)] rounded-full text-content-3 hover:text-brand-text hover:bg-surface-card-hover active:scale-[0.9] transition-all shrink-0">
                    <CalendarIcon size={16} strokeWidth={2.5} />
                </button>
            </div>
            {abierto && (esTactil ? (
                <ModalShell open onClose={() => setAbierto(false)} align="bottom" zClass="z-confirm"
                    maxWidthClass="max-w-none" surface="sheet" ariaLabel="Elegir el mes"
                    panelClassName="rounded-t-modal rounded-b-none px-4 pt-3 font-sans pb-[max(1rem,var(--sa-bottom))]">
                    <AsaHoja className="mb-3" />
                    {cuadro}
                </ModalShell>
            ) : createPortal(
                <div ref={popRef} role="dialog" aria-label="Elegir el mes" style={{ top: pos.top, left: pos.left, width: ANCHO }}
                    className="absolute z-confirm animate-in fade-in zoom-in-95 duration-[var(--dur-slow)]">
                    <div data-surface="dropdown" className="p-4 font-sans">{cuadro}</div>
                </div>,
                document.body,
            ))}
        </div>
    );
}
