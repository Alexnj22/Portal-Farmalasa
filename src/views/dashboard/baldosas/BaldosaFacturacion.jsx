import React, { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import { Receipt } from 'lucide-react';
import LanzadorSolicitud from '../LanzadorSolicitud';
import { BarraTramos, FranjaVacia } from '../InstrumentoBaldosa';
import { fetchSolicitudesFacturacionPendientes } from '@nucleo/data/requests';
import { LoadingState } from '../../../components/common/StateViews';

// La BALDOSA de «Modificar facturación»: lo que el Inicio dibuja sin que nadie
// toque nada.
//
// Vive aparte de su formulario desde el 2026-08-15 y por el mismo motivo que
// `BaldosaMinMax`: el formulario —la búsqueda de la factura, los cuatro
// trámites y sus validaciones— es la mayor parte de
// `WidgetAnnulmentRequest.jsx`, y la baldosa lo traía de forma estática al
// paquete que se descarga al entrar al Inicio, para algo que sólo aparece si
// alguien abre la baldosa. Se movió la baldosa, que son 80 líneas, y no el
// formulario, que son 900.
const FormularioFacturacion = lazy(() =>
    import('../WidgetAnnulmentRequest').then(m => ({ default: m.FormularioFacturacion })));

// Un hueco en blanco dentro de un modal recién abierto se lee como que algo se
// rompió. En una conexión normal no se llega a ver: el trozo pesa 9 kB.
// La carga canónica (2026-11-06): antes era una copia a mano del spinner.
const Cargando = () => <LoadingState className="flex-1 min-h-[220px]" />;

/* ─── La baldosa del tablero ──────────────────────────────────────────────── */
// Las cuatro clases de solicitud, en el orden en que se muestran en la franja y
// se nombran en el renglón. En palabras del portal: nadie pide un
// «PAYMENT_CHANGE_REQUEST», pide cambiar la forma de pago.
const CLASES = [
  { type: 'ANNULMENT_REQUEST',      nombre: 'anular',   tinta: 'fuerte' },
  { type: 'CLIENT_CHANGE_REQUEST',  nombre: 'cliente',  tinta: 'medio'  },
  { type: 'VENDOR_CHANGE_REQUEST',  nombre: 'vendedor', tinta: 'suave'  },
  { type: 'PAYMENT_CHANGE_REQUEST', nombre: 'pago',     tinta: 'suave'  },
];

// Se monta dentro del modal y avisa al desmontarse, o sea al cerrarlo.
function AlCerrar({ onCerrar }) {
  const ref = useRef(onCerrar);
  useEffect(() => { ref.current = onCerrar; }, [onCerrar]);
  useEffect(() => () => ref.current?.(), []);
  return null;
}

export default function BaldosaFacturacion(props) {
  const [filas, setFilas] = useState(null);
  // Un fallo de lectura no es «Sin pendientes»: la baldosa lo dice (`error`
  // de `LanzadorSolicitud`) en vez de pintar el check verde.
  const [error, setError] = useState(null);
  // El reloj se congela cuando llegan las filas: la antigüedad se mide contra
  // el momento de la lectura, no contra el de un re-render cualquiera. Y
  // `Date.now()` dentro del `useMemo` de abajo sería una llamada impura durante
  // el render, que el compilador de React rechaza.
  const [ahora, setAhora] = useState(null);
  // Sólo la última lectura escribe, y al desmontar nada en vuelo escribe.
  const secuencia = useRef(0);
  // Se envió una solicitud con el modal abierto: al cerrarlo se relee el
  // número, que si no seguiría diciendo lo de antes de enviarla.
  const huboEnvio = useRef(false);

  const cargar = useCallback(() => {
    const mia = ++secuencia.current;
    fetchSolicitudesFacturacionPendientes().then(r => {
      if (mia !== secuencia.current) return;
      setError(r.error ?? null);
      setFilas(r.filas);
      setAhora(Date.now());
    });
  }, []);

  useEffect(() => {
    cargar();
    return () => { secuencia.current += 1; };
  }, [cargar]);

  const alEnviar = useCallback(() => { huboEnvio.current = true; }, []);
  const alCerrarModal = useCallback(() => {
    if (!huboEnvio.current) return;
    huboEnvio.current = false;
    cargar();
  }, [cargar]);

  // ── La franja: de qué son las pendientes, y desde cuándo ─────────────────
  // Un solo número junta cuatro trámites que no pesan lo mismo: tres
  // anulaciones no son tres cambios de vendedor. Y la antigüedad de la más
  // vieja es lo que dice si alguien se está durmiendo, que el conteo no puede
  // decir. Las dos cosas salen de las mismas filas que ya se traen.
  const franja = useMemo(() => {
    if (filas === null || ahora === null) return null;
    if (!filas.length) return { tramos: [], detalle: null };

    const total = filas.length;
    const tramos = CLASES
      .map(c => ({ ...c, n: filas.filter(f => f.type === c.type).length }))
      .filter(c => c.n > 0);

    // Las filas vienen ordenadas por fecha ascendente: la primera es la más
    // vieja. `Math.floor` y no redondeo — «3 d» tiene que significar que ya
    // pasaron tres días completos, no que faltan horas para el tercero.
    const dias = Math.floor((ahora - new Date(filas[0].created_at).getTime()) / 86400000);

    return {
      tramos: tramos.map(c => ({ frac: c.n / total, tinta: c.tinta })),
      // La antigüedad sólo cuando el desglose es corto. El renglón se trunca
      // —la baldosa mide ~250px en una retícula de cuatro columnas— y medido
      // con seis pendientes de tres clases, agregarla cortaba el desglose en
      // «2 clien…». Lo que se pierde al truncar tiene que ser lo último, no
      // una palabra a la mitad.
      detalle: [
        tramos.map(c => `${c.n} ${c.nombre}`).join(' · '),
        tramos.length <= 2 && dias >= 1 ? `la más vieja, ${dias} d` : null,
      ].filter(Boolean).join(' · '),
    };
  }, [filas, ahora]);

  return (
    <LanzadorSolicitud
      icon={Receipt}
      label="Modificar facturación"
      pendientes={filas === null ? null : filas.length}
      error={error}
      etiquetaPendientes="solicitud pendiente"
      etiquetaPendientesPlural="solicitudes pendientes"
      vacio="Sin pendientes"
      tono="warning"
      descripcion="Anular una factura, cambiar su cliente, vendedor o forma de pago, o entregarle el documento electrónico al cliente"
      instrumento={franja === null
        ? <FranjaVacia />
        : <BarraTramos tramos={franja.tramos} />}
      detalle={franja?.detalle}
      irA={props.irA}
    >
      {() => (
        <div className="flex flex-col gap-3 flex-1 min-h-0">
          {/* El selector de sucursal vivía en la cabecera de la tarjeta del
              tablero. Al volverse baldosa esa cabecera desapareció y con ella
              el selector: quien tiene alcance sobre todas las salas se quedaba
              sin poder cambiar de sala. Se muda acá adentro. */}
          {props.selectorSucursal}
          <AlCerrar onCerrar={alCerrarModal} />
          <Suspense fallback={<Cargando />}>
            <FormularioFacturacion {...props} onEnviada={alEnviar} />
          </Suspense>
        </div>
      )}
    </LanzadorSolicitud>
  );
}
