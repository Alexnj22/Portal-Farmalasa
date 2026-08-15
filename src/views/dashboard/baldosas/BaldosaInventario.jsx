import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { Loader2, PackageMinus } from 'lucide-react';
import LanzadorSolicitud from '../LanzadorSolicitud';
import { BarraTramos, FranjaVacia } from '../InstrumentoBaldosa';
import { contarPorVencer } from '../../../data/inventoryMovements';

// La BALDOSA de «Ajuste de inventario»: lo que el Inicio dibuja sin que nadie
// toque nada.
//
// Vive aparte de su formulario desde el 2026-08-15 y por el mismo motivo que
// `BaldosaMinMax` y `BaldosaFacturacion`: el formulario —los cuatro motivos de
// descarte, los lotes, las fotos de evidencia— es la mayor parte de
// `WidgetInventoryMovement.jsx`, y la baldosa lo traía de forma estática al
// paquete que se descarga al entrar al Inicio.
const FormularioAjuste = lazy(() =>
    import('../WidgetInventoryMovement').then(m => ({ default: m.FormularioAjuste })));

// Un hueco en blanco dentro de un modal recién abierto se lee como que algo se
// rompió. En una conexión normal no se llega a ver: el trozo pesa 8 kB.
const Cargando = () => (
    <div className="flex-1 min-h-[220px] grid place-items-center">
        <Loader2 size={22} className="animate-spin text-content-3" strokeWidth={2.5} />
    </div>
);

/* ─── La baldosa del tablero ──────────────────────────────────────────────── */
export default function BaldosaInventario(props) {
    const [plazo, setPlazo] = useState(null);

    useEffect(() => {
        let cancelado = false;
        contarPorVencer({ erpSucursalId: props.erpSucursalId }).then(r => {
            if (!cancelado) setPlazo(r);
        });
        return () => { cancelado = true; };
    }, [props.erpSucursalId]);

    // ── La franja: lo que todavía se puede salvar ────────────────────────────
    // La baldosa avisaba de una pérdida ya consumada —lo vencido— y de nada
    // más. Lo que vence dentro de 7 y de 30 días todavía se puede trasladar o
    // rebajar, así que es el dato que permite ACTUAR; el de vencidas sólo
    // permite descargar.
    //
    // Los tres tramos se reparten sobre el total de los tres, no sobre el
    // inventario entero: la franja compara urgencias entre sí, que es la
    // pregunta («¿cuánto de esto es ya y cuánto tiene margen?»).
    const franja = useMemo(() => {
        if (!plazo) return null;
        const total = plazo.vencidas + plazo.en7 + plazo.en30;
        if (!total) return { tramos: [], detalle: null };
        return {
            tramos: [
                { frac: plazo.vencidas / total, tinta: 'alerta' },
                { frac: plazo.en7      / total, tinta: 'fuerte' },
                { frac: plazo.en30     / total, tinta: 'medio'  },
            ],
            // El orden del texto sigue al de los tramos. Lo vencido ya lo dice
            // el contador, así que acá empieza en el segundo.
            detalle: [
                plazo.en7  ? `${plazo.en7} en 7 d`  : null,
                plazo.en30 ? `${plazo.en30} en 30 d` : null,
            ].filter(Boolean).join(' · ') || null,
        };
    }, [plazo]);

    return (
        <LanzadorSolicitud
            icon={PackageMinus}
            label="Ajuste de inventario"
            pendientes={plazo === null ? null : plazo.vencidas}
            etiquetaPendientes="línea vencida"
            etiquetaPendientesPlural="líneas vencidas"
            vacio="Sin vencidos"
            tono="danger"
            descripcion="Cargar o descargar producto de tu sala"
            instrumento={franja === null
                ? <FranjaVacia />
                : <BarraTramos tramos={franja.tramos} />}
            detalle={franja?.detalle}
        >
            {/* El encabezado lo pone `LanzadorSolicitud` con las ranuras del
                canónico (`LiquidModal.Header`), igual que en sus hermanos. */}
            {(cerrar) => (
                <Suspense fallback={<Cargando />}>
                    <FormularioAjuste {...props} onHecho={cerrar} />
                </Suspense>
            )}
        </LanzadorSolicitud>
    );
}
