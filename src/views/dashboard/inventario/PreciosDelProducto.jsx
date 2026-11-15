import React, { useEffect, useMemo, useState } from 'react';
import { Package, ChevronRight } from 'lucide-react';
import { LoadingState } from '../../../components/common/StateViews';
import Notice from '../../../components/common/Notice';
import Button from '../../../components/common/Button';
import ListRow from '../../../components/common/ListRow';
import { fetchPreciosDelProducto } from '@nucleo/data/productos';
import { COLUMNAS, PRINCIPAL, SECUNDARIOS, presentacionesParaMostrar, agruparPorPresentacion } from './presentacionesDePrecio';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';

/* ── Precios de un producto, para el mostrador (2026-11-15) ──────────────────
 * Lo usa el widget «Consulta de precios». Hasta Mayoreo Plus PARA TODOS (lo
 * pidió el usuario); el costo no viaja nunca (la consulta no lo pide).
 *
 * Dos pasos, como lo pidió el usuario: primero PREGUNTA la presentación;
 * elegida, muestra sus precios. Si esa presentación tiene más de un precio
 * —1,129 productos tienen dos «Caja» de 30 con ids distintos y a veces
 * precios distintos—, van lado a lado, una columna por precio, ordenadas por el
 * Regular. Si hay una sola presentación no se pregunta nada.
 *
 * Los lotes son informativos: cuánto hay de esa presentación en la sala de
 * quien mira (o en todas, para quien no tiene sala). El precio no depende del
 * lote: `product_precios` no lo tiene. */

function Columna({ variante }) {
  return (
    <div className="flex flex-col rounded-xl border border-divider overflow-hidden">
      <div className="px-3 py-2.5 bg-brand/10">
        <p className="text-micro font-black uppercase tracking-widest text-brand-text">{PRINCIPAL.label}</p>
        <p className="text-title font-black tabular-nums text-content leading-tight">{formatMoney(variante.precios[PRINCIPAL.key])}</p>
      </div>
      <dl className="divide-y divide-divider">
        {SECUNDARIOS.map(n => (
          <div key={n.key} className="flex items-center justify-between gap-2 px-3 py-1.5">
            <dt className="text-label text-content-3 truncate">{n.label}</dt>
            <dd className="text-body-sm font-bold tabular-nums text-content">{formatMoney(variante.precios[n.key])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const unidadesTexto = (n) => (n > 1 ? `${n} unidades` : '1 unidad');

/**
 * @param {{ erpProductId: number|null, salas: {name: string, erp: number|null, lots: object[]}[], miErp: number|null }} props
 *   `salas` sin el área de vencidos: no se vende de ahí.
 */
export default function PreciosDelProducto({ erpProductId, salas, miErp }) {
  const [precios, setPrecios] = useState(null);
  const [error, setError] = useState(null);
  const [elegida, setElegida] = useState(null);

  useEffect(() => {
    if (erpProductId == null) return;
    let cancelado = false;
    fetchPreciosDelProducto(erpProductId, COLUMNAS).then(({ data, error: err }) => {
      if (cancelado) return;
      if (err) { setError(mensajeAmigable(err)); setPrecios([]); return; }
      setError(null);
      setPrecios(data ?? []);
    });
    return () => { cancelado = true; };
  }, [erpProductId]);

  // Sólo los lotes de la sala de quien mira; sin sala, los de todas.
  const conSala = miErp != null;
  const lotes = useMemo(() => salas
    .filter(s => !conSala || s.erp === miErp)
    .flatMap(s => (s.lots ?? []).map(l => ({ ...l, _sala: s.name }))), [salas, miErp, conSala]);

  const grupos = useMemo(() => agruparPorPresentacion(presentacionesParaMostrar(precios, lotes)), [precios, lotes]);
  const grupo = grupos.length === 1 ? grupos[0] : grupos.find(g => g.clave === elegida) ?? null;

  if (precios === null) return <LoadingState variant="inline" size="sm" label="Cargando precios…" />;
  if (error) return <Notice variant="danger">{error}</Notice>;
  if (!grupos.length) {
    return (
      <p className="flex items-center gap-2 text-label text-content-3">
        <Package size={16} className="shrink-0" /> Este producto no tiene precios registrados.
      </p>
    );
  }

  // ── Paso 1: ¿qué presentación? ──
  if (!grupo) {
    return (
      <div className="@container flex flex-col gap-1.5">
        <p className="text-label font-semibold text-content-2">¿Qué presentación?</p>
        <div className="grid gap-1.5 @xl:grid-cols-2 @3xl:grid-cols-3">
          {grupos.map(g => (
            <ListRow key={g.clave} density="sm" icon={Package}
              title={g.nombre}
              subtitle={unidadesTexto(g.unidades)}
              trailing={<span className="flex items-center gap-1.5">
                <span className="text-body-sm font-black tabular-nums text-content">
                  {g.variantes.length > 1 ? `${g.variantes.length} precios` : formatMoney(g.variantes[0].precios[PRINCIPAL.key])}
                </span>
                <ChevronRight size={14} className="text-content-3" />
              </span>}
              onClick={() => setElegida(g.clave)} />
          ))}
        </div>
      </div>
    );
  }

  // ── Paso 2: sus precios ──
  const varios = grupo.variantes.length > 1;
  return (
    <div className="@container flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate">
          <span className="text-body font-black text-content">{grupo.nombre}</span>
          <span className="text-label text-content-3"> · {unidadesTexto(grupo.unidades)}</span>
        </p>
        {grupos.length > 1 && (
          <Button size="xs" variant="secondary" onClick={() => setElegida(null)}>Cambiar</Button>
        )}
      </div>

      {/* Ancho: precios a la izquierda y lotes a la derecha, para que una fila
          no quede con la etiqueta en una punta y el monto en la otra. */}
      <div className="grid gap-4 @3xl:grid-cols-2 @3xl:items-start">
      <div className="flex flex-col gap-2 max-w-2xl">
        {varios && (
          <p className="text-caption text-content-3">Esta presentación tiene {grupo.variantes.length} precios.</p>
        )}
        <div className={`grid gap-2 ${varios ? 'grid-cols-2' : 'grid-cols-1 max-w-md'}`}>
          {grupo.variantes.map(v => <Columna key={v.id} variante={v} />)}
        </div>
      </div>

      <div className="flex flex-col gap-1 max-w-md">
        <p className="text-caption font-black uppercase tracking-widest text-content-3">{conSala ? 'En tu sala' : 'En las salas'}</p>
        {grupo.lotes.length ? (
          <ul className="divide-y divide-divider">
            {grupo.lotes.map((l, i) => (
              <li key={`${l.erp_sucursal_id}|${l.lote}|${l.fecha_vencimiento}|${i}`} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate text-label text-content-2">
                  <span className="font-mono">{l.lote || 'Sin lote'}</span>
                  {!conSala && <span className="text-content-3"> · {l._sala}</span>}
                </span>
                <span className="text-body-sm font-bold tabular-nums text-content whitespace-nowrap">{l.cantidad}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-label text-content-3">No hay existencia de esta presentación.</p>
        )}
      </div>
      </div>
    </div>
  );
}
