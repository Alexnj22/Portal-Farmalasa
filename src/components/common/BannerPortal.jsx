import React, { useLayoutEffect, useRef } from 'react';
import { Construction, AlertTriangle, XCircle, Info, CheckCircle2 } from 'lucide-react';
import { useBannerPortal } from '../../hooks/useBannerPortal';

/**
 * La franja de aviso del tope del portal.
 *
 * Nació en v2.57.1 como aviso PERMANENTE de la migración de tema, con el texto
 * escrito acá adentro. El problema no era el texto: era que para quitarlo o
 * cambiarlo había que editar, commitear y desplegar. Un aviso que se pone
 * «cuando hace falta» no puede depender de un despliegue.
 *
 * Hoy el estado —encendido, texto y apariencia— vive en `banner_portal` y se
 * maneja desde Sistema › Mantenimiento. Este archivo sólo lo pinta.
 *
 * Sigue siendo `fixed`: es inmune al modelo de alto de 100dvh que ya causó
 * regresiones en móvil (ver v2.30.0/v2.30.1), así que no puede empujar
 * contenido por sí misma. El espacio en el flujo normal lo reserva el spacer
 * que este mismo componente renderiza a continuación, con el alto MEDIDO de la
 * franja — antes era una constante de 2.25rem, que sólo servía mientras el
 * texto fuera uno fijo que entraba en una línea.
 */

// La apariencia por variante. `obra` es bespoke a propósito —rayado de obra,
// texto oscuro, sin reaccionar al tema— y es la que reproduce exactamente la
// franja que el portal venía mostrando; las otras cuatro salen de los tokens y
// por eso sí se leen bien en los cuatro temas.
const APARIENCIA = {
    obra: {
        icono: Construction,
        clase: 'text-[#2b1c02]',
        estilo: {
            backgroundImage: 'repeating-linear-gradient(135deg, #f2a93b 0 14px, #f7c876 14px 28px)',
            boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
        },
    },
    aviso:    { icono: AlertTriangle, clase: 'bg-warning/25 text-warning-text border-b border-warning/40' },
    problema: { icono: XCircle,       clase: 'bg-danger/25 text-danger-text border-b border-danger/40'    },
    info:     { icono: Info,          clase: 'bg-brand/25 text-brand-text border-b border-brand/40'       },
    bien:     { icono: CheckCircle2,  clase: 'bg-success/25 text-success-text border-b border-success/40' },
};

/**
 * La franja en sí, sin posicionar. La usa el banner de verdad y también la
 * vista previa de Mantenimiento: una sola implementación para que lo que se ve
 * al elegir la apariencia sea lo mismo que va a ver todo el mundo.
 */
export function FranjaBanner({ variante = 'obra', texto = '', textoCorto = '', className = '' }) {
    const a = APARIENCIA[variante] || APARIENCIA.obra;
    const Icono = a.icono;
    const corto = (textoCorto || '').trim() || texto;

    return (
        <div
            className={`w-full flex items-center justify-center gap-2 px-3 py-2
                text-body-sm font-bold leading-tight text-center text-balance
                ${a.clase} ${className}`}
            style={a.estilo}
        >
            <Icono size={15} strokeWidth={2.5} className="flex-shrink-0" />
            {/* Dos textos, no `truncate` sobre uno largo. En 390px la frase
                completa se cortaba en «algunas pantallas se ven v…»: un aviso
                que se interrumpe a media palabra erosiona más confianza que el
                defecto que anuncia, y esta franja está en el tope de TODAS las
                vistas. Si no se escribió una versión corta, se usa la larga —
                que ahora puede ocupar dos líneas sin romper nada, porque el
                spacer mide el alto real. */}
            <span className="sm:hidden">{corto}</span>
            <span className="hidden sm:inline">{texto}</span>
        </div>
    );
}

// El alto medido va a una VARIABLE de CSS y no a un `useState`, y son dos cosas
// distintas resueltas de una:
//
//  · **Lo lee el encabezado.** El spacer resuelve el flujo —empuja el contenido
//    al tope del scroll— pero no al encabezado móvil, que es `sticky top-0`: al
//    desplazar se pega en el 0 del viewport, que es donde vive esta franja
//    `fixed`, y como ella lleva `z-ribbon` (45) contra los `z-tabs` (30) del
//    encabezado, **el encabezado desaparece detrás**. Reportado probando en el
//    teléfono: «al hacer scroll se oculta bajo el banner si está activo». No se
//    ve nunca en escritorio, donde el encabezado móvil no existe.
//  · **Y le sirve al área segura.** La franja ya se comió su parte del notch,
//    así que el encabezado sólo tiene que rellenar lo que sobre — si no, el
//    inset se aplica dos veces.
//
// Con la variable, además, medir de nuevo NO re-renderiza: el spacer la lee
// desde el estilo. El `useState` era un re-render por cada cambio de tamaño.
const poner = (h) => {
    try { document.documentElement.style.setProperty('--banner-h', `${h}px`); }
    catch { /* sin DOM (SSR/prueba): la variable cae al 0px de su fallback */ }
};

export default function BannerPortal() {
    const { banner } = useBannerPortal();
    const ref = useRef(null);

    const visible = !!banner?.activo && !!(banner.texto || '').trim();

    // El spacer copia el alto MEDIDO, no uno calculado: el texto lo escribe una
    // persona y puede ocupar una línea o tres según el ancho. Un alto fijo
    // dejaría la primera fila de la pantalla debajo de la franja, y en móvil eso
    // es el título de la vista.
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) { poner(0); return undefined; }
        const medir = () => {
            const h = el.getBoundingClientRect().height;
            poner(h);
            // ── Y se PUBLICA, porque el spacer no alcanza ────────────────────
            // El spacer resuelve el flujo: empuja el contenido hacia abajo al
            // tope del scroll. No resuelve al encabezado móvil, que es
            // `sticky top-0`: al desplazar, se pega en el 0 del viewport, que es
            // exactamente donde vive esta franja `fixed`. Y como ella lleva
            // `z-ribbon` (45) contra los `z-tabs` (30) del encabezado, gana la
            // franja y el encabezado **desaparece debajo**.
            //
            // Reportado probando en el teléfono: «al hacer scroll se oculta bajo
            // el banner si está activo». No se ve nunca en escritorio, donde el
            // encabezado móvil no existe.
            //
            // Con el alto en una variable, el encabezado puede pegarse DEBAJO en
            // vez de detrás, y descontar de su propio relleno la parte del área
            // segura que esta franja ya se comió — que si no, se aplica dos
            // veces.
        };
        medir();
        if (typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(medir);
        ro.observe(el);
        return () => { ro.disconnect(); poner(0); };
    }, [visible, banner?.texto, banner?.textoCorto, banner?.variante]);

    if (!visible) return null;

    return (
        <>
            <div
                ref={ref}
                role="status"
                className="fixed top-0 inset-x-0 z-ribbon"
                style={{ paddingTop: 'var(--sa-top)' }}
            >
                <FranjaBanner
                    variante={banner.variante}
                    texto={banner.texto}
                    textoCorto={banner.texto_corto}
                />
            </div>
            {/* Reserva en el flujo normal el espacio que la franja fixed ocupa
                visualmente — ella misma no puede empujar nada por estar fuera
                del flujo. */}
            <div className="w-full shrink-0" style={{ height: 'var(--banner-h, 0px)' }} aria-hidden="true" />
        </>
    );
}
