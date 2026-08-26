import React, { useState, useEffect, useMemo, lazy } from 'react';
import { Package } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { fetchFaltantesConStockEnOtraSala } from '../../data/inventory';
import LanzadorSolicitud from './LanzadorSolicitud';
import { Carril, FranjaVacia } from './InstrumentoBaldosa';
import { ERP_BRANCH_MAP, BRANCH_ORDER, MI_ERP_POR_BRANCH } from './inventario/salas';

/* El cuerpo del buscador —el panel de resultados, los lotes, el pedido a otra
 * sala— se baja al ABRIR la baldosa, no al entrar al Inicio.
 *
 * Eran 1,180 de las 1,414 líneas de este archivo y viajaban en el cierre
 * estático del Inicio: las descargaba todo el que abre el portal, para un modal
 * que la mayoría de las visitas no abre nunca. El baseline del gate de peso ya
 * lo tenía anotado como el próximo corte, y el Inicio estaba en 100 kB contra un
 * techo de 99.
 *
 * `LanzadorSolicitud` recibe el cuerpo como render-prop, así que sólo lo invoca
 * cuando el modal se abre — el `lazy` no necesita más envoltura que el `Suspense`
 * que la puerta ya pone. */
const FormularioPedirASala = lazy(() =>
  import('./inventario/PanelDeInventario').then(m => ({ default: m.FormularioPedirASala })));

//
// Es el mismo argumento que movió a los otros tres: metida en la tarjeta del
// tablero, la pantalla es una franja. Acá se notaba más que en ninguna — el
// resultado de una búsqueda son siete secciones de sucursal con sus lotes, y
// entraban dos.
//
// El buscador se va ADENTRO con ella. Vivía en la cabecera de la tarjeta, que
// al volverse baldosa deja de existir.
export default function WidgetInventorySearch() {
  const { user } = useAuth();
  const [faltan, setFaltan] = useState(null);
  const [q, setQ] = useState('');

  const miErp = MI_ERP_POR_BRANCH[user?.branchId ?? user?.branch_id] ?? null;

  // El número de la baldosa: cuántos productos le faltan a la sala y otra sí
  // tiene. Es el motivo real por el que alguien abre esto.
  // Sin `setFaltan(null)` en la guarda: era una escritura SINCRÓNICA dentro del
  // efecto (render en cascada, lo marca `react-hooks/set-state-in-effect`). Lo
  // que hacía —olvidar los faltantes de la sala anterior— se resuelve leyendo
  // `faltantesDeMiSala` en vez del estado crudo, que es una derivación y no
  // necesita un render extra para llegar.
  useEffect(() => {
    if (!miErp) return;
    let cancelado = false;
    fetchFaltantesConStockEnOtraSala(miErp, 40).then(r => {
      if (!cancelado && !r.error) setFaltan(r.filas);
    });
    return () => { cancelado = true; };
  }, [miErp]);

  // ── La franja: a quién le pido ──────────────────────────────────────────
  // Es la única de las seis baldosas cuya respuesta es un LUGAR y no un
  // número. Cada columna es una sala y su alto es cuántos de mis faltantes
  // puede cubrir; el renglón nombra a la más alta, que es con lo que se actúa.
  // Las demás columnas dicen si hay una sola opción o varias, que es lo otro
  // que cambia la decisión.
  //
  // Sale del `donde` que el RPC ya devuelve en cada fila —un arreglo con las
  // salas que tienen ese producto— así que no hay consulta nueva. El orden de
  // las columnas es el MISMO de la lista de resultados (`BRANCH_ORDER`, con
  // Bodega primero) y es FIJO: si se reordenara por altura, la misma sala
  // saltaría de lugar entre una carga y otra y las columnas dejarían de
  // significar nada. Reusar ese orden y no el de despacho es a propósito —
  // esta pantalla contesta «dónde hay», y ya tomó esa decisión una vez.
  const faltantesDeMiSala = miErp && Array.isArray(faltan) ? faltan : null;

  const franja = useMemo(() => {
    if (!faltantesDeMiSala) return null;
    const salas = BRANCH_ORDER.filter(id => id !== miErp);
    if (!faltantesDeMiSala.length) return { valores: salas.map(() => 0), detalle: null };

    const cubre = new Map(salas.map(id => [id, 0]));
    for (const f of faltantesDeMiSala) {
      for (const d of (f.donde ?? [])) {
        const id = Number(d.erp_sucursal_id);
        if (cubre.has(id)) cubre.set(id, cubre.get(id) + 1);
      }
    }
    const mejor = [...cubre.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      valores: salas.map(id => cubre.get(id) ?? 0),
      detalle: mejor?.[1] ? `${mejor[1]} en ${ERP_BRANCH_MAP[mejor[0]] ?? 'otra sala'}` : null,
    };
  }, [faltantesDeMiSala, miErp]);

  return (
    <LanzadorSolicitud
      icon={Package}
      label="Consulta de inventario"
      pendientes={faltantesDeMiSala ? faltantesDeMiSala.length : null}
      etiquetaPendientes="sin existencia aquí"
      etiquetaPendientesPlural="sin existencia aquí"
      // Sin sala propia no hay faltantes que repartir, así que tampoco hay
      // figura: un riel vacío ahí se leería como «todavía está cargando», y
      // ese número no va a llegar nunca. Es el mismo motivo de `sinDato`.
      instrumento={!miErp ? null : (franja === null
        ? <FranjaVacia />
        : <Carril valores={franja.valores} />)}
      detalle={franja?.detalle}
      // Sin sala con inventario —Administración, por ejemplo— el conteo nunca
      // llega, y la baldosa mostraba un guión que se lee como «cargando». Se
      // dice lo que pasa. La búsqueda sigue sirviendo: se puede consultar en
      // qué sala hay un producto aunque uno no tenga inventario propio.
      sinDato={miErp ? null : 'Buscar en las salas'}
      vacio="Buscar producto"
      tono="warning"
      maxWidth="max-w-3xl"
      descripcion="En qué sala hay un producto, y cómo solicitarlo"
    >
      {() => <FormularioPedirASala query={q} onQueryChange={setQ} />}
    </LanzadorSolicitud>
  );
}
