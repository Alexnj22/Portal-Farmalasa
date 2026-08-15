import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { Loader2, TrendingUp } from 'lucide-react';
import LanzadorSolicitud from '../LanzadorSolicitud';
import { BarraTramos, FranjaVacia } from '../InstrumentoBaldosa';
import { fetchMinMaxEstados } from '../../../data/minmaxRequests';

// La BALDOSA de «Ajuste de Min/Max»: lo que el Inicio dibuja sin que nadie
// toque nada.
//
// ── Por qué vive aparte de su formulario (2026-08-15) ─────────────────────
// El formulario —buscador de catálogo, contexto de venta, validaciones— es la
// mayor parte de `WidgetMinMaxRequest.jsx`, y la baldosa lo importaba de forma
// estática. Eso metía el archivo entero en lo que el Inicio descarga al entrar,
// para algo que sólo aparece si alguien abre la baldosa.
//
// Se movió la baldosa —60 líneas— en vez del formulario —450—: el mismo
// resultado con un movimiento de código mucho más chico, y el archivo grande no
// se toca. Su `FormularioMinMax` sigue donde estaba y `ModalNuevaOperativa` lo
// sigue abriendo por el mismo camino.
//
// Es la regla de CLAUDE.md sobre `await import()` aplicada a un formulario:
// lo que sólo hace falta al apretar algo no viaja con la vista.
const FormularioMinMax = lazy(() =>
    import('../WidgetMinMaxRequest').then(m => ({ default: m.FormularioMinMax })));

// El giro mientras baja el formulario. Nunca se ve en una conexión normal —el
// trozo pesa 4 kB— pero un hueco en blanco dentro de un modal recién abierto se
// lee como que algo se rompió.
const Cargando = () => (
    <div className="flex-1 min-h-[220px] grid place-items-center">
        <Loader2 size={22} className="animate-spin text-content-3" strokeWidth={2.5} />
    </div>
);

export default function BaldosaMinMax(props) {
  const [estados, setEstados] = useState(null);

  useEffect(() => {
    let cancelado = false;
    fetchMinMaxEstados(props.selectedErp).then(r => {
      if (!cancelado) setEstados(r);
    });
    return () => { cancelado = true; };
  }, [props.selectedErp]);

  // ── La franja: en qué terminan las propuestas ────────────────────────────
  // Iba a ser una línea de propuestas por semana, hasta mirar la tabla: está
  // vacía, así que la línea habría sido una recta en cero para siempre. Lo que
  // sí dice algo desde la primera propuesta es si se aplican o se rechazan —
  // eso decide si vale la pena proponer— y sale de la misma consulta.
  //
  // Mientras no haya ninguna, la franja es el riel vacío. Es correcto: no hay
  // nada que mostrar, y dibujar una figura llena sobre cero sería inventarlo.
  const franja = useMemo(() => {
    if (!estados) return null;
    const total = estados.pendientes + estados.aplicadas + estados.rechazadas;
    if (!total) return { tramos: [], detalle: null };
    return {
      tramos: [
        { frac: estados.pendientes / total, tinta: 'fuerte' },
        { frac: estados.aplicadas  / total, tinta: 'medio'  },
        { frac: estados.rechazadas / total, tinta: 'suave'  },
      ],
      detalle: [
        estados.aplicadas  ? `${estados.aplicadas} aplicadas`   : null,
        estados.rechazadas ? `${estados.rechazadas} rechazadas` : null,
      ].filter(Boolean).join(' · ') || null,
    };
  }, [estados]);

  return (
    <LanzadorSolicitud
      icon={TrendingUp}
      label="Ajuste de Min/Max"
      pendientes={estados === null ? null : estados.pendientes}
      etiquetaPendientes="propuesta pendiente"
      etiquetaPendientesPlural="propuestas pendientes"
      vacio="Sin propuestas"
      tono="brand"
      descripcion="Proponer un mínimo o un máximo distinto para un producto"
      instrumento={franja === null
        ? <FranjaVacia />
        : <BarraTramos tramos={franja.tramos} />}
      detalle={franja?.detalle}
    >
      {/* El encabezado ya no se dibuja acá: lo pone `LanzadorSolicitud` con las
          ranuras del canónico (`LiquidModal.Header`), y de paso trae el botón
          de cerrar que este modal no tenía. */}
      {() => (
        <>
          {/* El selector de sucursal vivía en la cabecera de la tarjeta del
              tablero. Al volverse baldosa esa cabecera desapareció y con ella
              el selector: quien tiene alcance sobre todas las salas se quedaba
              sin poder cambiar de sala. Se muda acá adentro.
              Va FUERA del `Suspense`: es de la baldosa, no del formulario, y
              adentro parpadearía al abrir. */}
          {props.selectorSucursal}
          <Suspense fallback={<Cargando />}>
            <FormularioMinMax {...props} />
          </Suspense>
        </>
      )}
    </LanzadorSolicitud>
  );
}
