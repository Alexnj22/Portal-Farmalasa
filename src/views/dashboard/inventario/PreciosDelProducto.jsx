import React, { useEffect, useMemo, useState } from 'react';
import { Package } from 'lucide-react';
import { LoadingState } from '../../../components/common/StateViews';
import Notice from '../../../components/common/Notice';
import SegmentedControl from '../../../components/common/SegmentedControl';
import { fetchPreciosDelProducto } from '@nucleo/data/productos';
import { COLUMNAS, PRINCIPAL, SECUNDARIOS, presentacionesParaMostrar, agruparPorPresentacion } from './presentacionesDePrecio';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';

/* ── Precios de un producto, para el mostrador (2026-11-15) ──────────────────
 * Lo usa el widget «Consulta de precios». Hasta Mayoreo Plus PARA TODOS (lo
 * pidió el usuario); el costo no viaja nunca (la consulta no lo pide).
 *
 * La presentación se elige ARRIBA, con un toque y sin volver atrás (la versión
 * de dos pasos obligaba a regresar para ver otra; el usuario la descartó).
 * Arranca en la que hay en la sala. Si esa presentación tiene más de un precio
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
  // Sin elegir todavía: la primera que hay en la sala (es la que se vende),
  // y si ninguna tiene, la más chica.
  const grupo = grupos.find(g => g.clave === elegida) ?? grupos.find(g => g.existencia > 0) ?? grupos[0] ?? null;

  if (precios === null) return <LoadingState variant="inline" size="sm" label="Cargando precios…" />;
  if (error) return <Notice variant="danger">{error}</Notice>;
  if (!grupo) {
    return (
      <p className="flex items-center gap-2 text-label text-content-3">
        <Package size={16} className="shrink-0" /> Este producto no tiene precios registrados.
      </p>
    );
  }

  const varios = grupo.variantes.length > 1;
  const precioCorto = (g) => (g.variantes.length > 1
    ? `${g.variantes.length} precios`
    : formatMoney(g.variantes[0].precios[PRINCIPAL.key]));
  const total = grupo.lotes.reduce((s, l) => s + (Number(l.cantidad) || 0), 0);

  return (
    <div className="@container flex flex-col gap-3">
      {/* La presentación se cambia con un toque, sin volver atrás: cada opción
          ya dice cuántas unidades trae y su precio Regular. */}
      {grupos.length > 1 ? (
        <SegmentedControl
          layout="block"
          columns={Math.min(grupos.length, 4)}
          label="Presentación"
          value={grupo.clave}
          onChange={setElegida}
          options={grupos.map(g => ({
            value: g.clave,
            label: g.nombre,
            description: `${unidadesTexto(g.unidades)} · ${precioCorto(g)}`,
          }))}
        />
      ) : (
        <p className="text-label text-content-3">
          <span className="font-black text-content">{grupo.nombre}</span> · {unidadesTexto(grupo.unidades)}
        </p>
      )}

      <div className="grid gap-3 @3xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @3xl:items-start">
        <div className="flex flex-col gap-1.5">
          {varios && (
            <p className="text-caption text-content-3">{grupo.nombre} tiene {grupo.variantes.length} precios:</p>
          )}
          <div className={`grid gap-2 ${varios ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {grupo.variantes.map(v => <Columna key={v.id} variante={v} />)}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="flex items-baseline justify-between gap-2">
            <span className="text-caption font-black uppercase tracking-widest text-content-3">{conSala ? 'En tu sala' : 'En las salas'}</span>
            {total > 0 && <span className="text-label font-black tabular-nums text-content">{total}</span>}
          </p>
          {grupo.lotes.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {grupo.lotes.map((l, i) => (
                <li key={`${l.erp_sucursal_id}|${l.lote}|${l.fecha_vencimiento}|${i}`}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-divider bg-surface-card-hover text-micro">
                  <span className="font-mono text-content-2">{l.lote || 'Sin lote'}</span>
                  {!conSala && <span className="text-content-3">{l._sala}</span>}
                  <span className="font-black tabular-nums text-content">{l.cantidad}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-label text-content-3">Sin existencia de esta presentación.</p>
          )}
        </div>
      </div>
    </div>
  );
}
