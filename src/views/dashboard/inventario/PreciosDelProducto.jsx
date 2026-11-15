import React, { useEffect, useMemo, useState } from 'react';
import { Package, CalendarClock } from 'lucide-react';
import { LoadingState } from '../../../components/common/StateViews';
import Notice from '../../../components/common/Notice';
import Badge from '../../../components/common/Badge';
import { fetchPreciosDelProducto } from '@nucleo/data/productos';
import { COLUMNAS, NIVELES, PRINCIPAL, SECUNDARIOS, titulo, presentacionesParaMostrar } from './presentacionesDePrecio';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';

/* ── Precios de un producto, para el mostrador (2026-11-15) ──────────────────
 * Lo usa el widget «Consulta de precios». Hasta Mayoreo Plus PARA TODOS (lo
 * pidió el usuario): el tope es de esta pantalla, no del `max_price_level` del
 * cargo. El costo no viaja nunca (la consulta no lo pide).
 *
 * ── Por qué no hay selectores (tercera versión, mismo día) ─────────────────
 * Las dos primeras pedían elegir presentación y lote en dos listas. Un
 * producto tiene a lo sumo 4 presentaciones activas (medido: 4,396 productos,
 * máximo 4), así que se muestran TODAS a la vez, cada una con sus cinco
 * precios: comparar caja contra unidad es justo lo que se pregunta en el
 * mostrador, y con un selector había que ir y volver. El lote dejó de elegirse
 * y pasó a ser una lista: dice qué hay en la sala y de qué presentación, que
 * era para lo único que servía elegirlo — el precio no depende del lote
 * (`product_precios` no lo tiene).
 *
 * ── Dos presentaciones con el mismo nombre ─────────────────────────────────
 * 1,129 productos tienen dos o más presentaciones de igual tipo y factor (dos
 * «UNIDAD 1x1», ids distintos en el origen). Si los cinco precios son iguales
 * se muestran una vez; si difieren, cada una lleva su código para que no se
 * lean como la misma con dos precios.
 *
 * ── Tamaños ────────────────────────────────────────────────────────────────
 * Con `@container`: angosto, una tarjeta por presentación (Regular grande y los
 * otros cuatro en una rejilla); ancho, una tabla presentación × precio, que es
 * donde se compara de un vistazo. */
const DIAS_PRONTO = 180;

function NombreDePresentacion({ p, compacto = false }) {
  return (
    <span className="flex flex-col min-w-0">
      <span className={`${compacto ? 'text-body-sm' : 'text-body'} font-black text-content truncate`}>
        {p.nombre}
        {p.codigo != null && <span className="ml-1.5 text-micro font-bold text-content-3 tabular-nums">cód. {p.codigo}</span>}
      </span>
      <span className="text-micro text-content-3">{p.unidades > 1 ? `${p.unidades} unidades` : '1 unidad'}</span>
    </span>
  );
}

function Existencia({ p, conSala }) {
  if (!p.existencia) return <Badge variant="neutral">{conSala ? 'Sin existencia aquí' : 'Sin existencia'}</Badge>;
  return <Badge variant="success">{p.existencia} en {conSala ? 'tu sala' : 'salas'}</Badge>;
}

/** Angosto: una tarjeta por presentación. */
function Tarjeta({ p, conSala }) {
  return (
    <article className="rounded-2xl border border-divider overflow-hidden bg-surface-card-hover">
      <header className="flex items-start justify-between gap-3 px-3 pt-3">
        <NombreDePresentacion p={p} />
        <Existencia p={p} conSala={conSala} />
      </header>
      <div className="px-3 pt-2 pb-3">
        <p className="text-micro font-black uppercase tracking-widest text-brand-text">{PRINCIPAL.label}</p>
        <p className="text-display-lg font-black tabular-nums text-content leading-none mt-0.5">{formatMoney(p.precios[PRINCIPAL.key])}</p>
      </div>
      <dl className="grid grid-cols-2 @md:grid-cols-4 gap-px bg-divider border-t border-divider">
        {SECUNDARIOS.map(n => (
          <div key={n.key} className="flex flex-col gap-0.5 px-3 py-2 bg-surface-card">
            <dt className="text-micro font-semibold text-content-3 truncate">{n.label}</dt>
            <dd className="text-body-sm font-black tabular-nums text-content">{formatMoney(p.precios[n.key])}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

/** Ancho: presentación × precio, para comparar de un vistazo. */
function Tabla({ lista, conSala }) {
  return (
    <div className="rounded-2xl border border-divider overflow-hidden">
      <table className="w-full text-left">
        <thead className="bg-surface-card-hover">
          <tr>
            <th scope="col" className="px-3 py-2 text-micro font-black uppercase tracking-widest text-content-3">Presentación</th>
            {NIVELES.map((n, i) => (
              <th key={n.key} scope="col"
                className={`px-3 py-2 text-right text-micro font-black uppercase tracking-widest ${i === 0 ? 'text-brand-text bg-brand/10' : 'text-content-3'}`}>
                {n.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-divider">
          {lista.map(p => (
            <tr key={p.id}>
              <th scope="row" className="px-3 py-2.5 font-normal">
                <span className="flex items-center justify-between gap-2">
                  <NombreDePresentacion p={p} compacto />
                  <Existencia p={p} conSala={conSala} />
                </span>
              </th>
              {NIVELES.map((n, i) => (
                <td key={n.key}
                  className={`px-3 py-2.5 text-right tabular-nums ${i === 0 ? 'text-title-sm font-black text-content bg-brand/10' : 'text-body-sm font-bold text-content-2'}`}>
                  {formatMoney(p.precios[n.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function diasHasta(fecha) {
  if (!fecha) return null;
  return Math.round((new Date(`${String(fecha).slice(0, 10)}T12:00:00Z`) - Date.now()) / 86400000);
}

function Lotes({ lotes, conSala }) {
  if (!lotes.length) return null;
  return (
    <section aria-label="Lotes" className="flex flex-col gap-1.5">
      <p className="flex items-center gap-1.5 text-caption font-black uppercase tracking-widest text-content-3">
        <CalendarClock size={13} className="shrink-0" />
        {conSala ? 'Lotes en tu sala' : 'Lotes'}
      </p>
      <ul className="rounded-2xl border border-divider divide-y divide-divider overflow-hidden">
        {lotes.map(l => {
          const dias = diasHasta(l.fecha_vencimiento);
          const pronto = dias != null && dias <= DIAS_PRONTO;
          return (
            <li key={l._clave} className="flex items-center gap-3 px-3 py-2 bg-surface-card-hover">
              <span className="flex-1 min-w-0">
                <span className="block text-body-sm font-bold text-content font-mono truncate">{l.lote || 'Sin lote'}</span>
                <span className="block text-micro text-content-3 truncate">
                  {[titulo(l.presentacion), conSala ? null : l._sala].filter(Boolean).join(' · ')}
                </span>
              </span>
              {l.fecha_vencimiento && (
                <span className={`text-micro font-semibold tabular-nums whitespace-nowrap ${pronto ? 'text-warning-text' : 'text-content-3'}`}>
                  vence {fechaTexto(l.fecha_vencimiento, { month: 'short', year: 'numeric' })}
                </span>
              )}
              <span className="text-body-sm font-black tabular-nums text-content whitespace-nowrap">{l.cantidad}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * @param {{ erpProductId: number|null, salas: {name: string, erp: number|null, lots: object[]}[], miErp: number|null }} props
 *   `salas` sin el área de vencidos: no se vende de ahí.
 */
export default function PreciosDelProducto({ erpProductId, salas, miErp }) {
  const [precios, setPrecios] = useState(null);
  const [error, setError] = useState(null);

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

  // Sólo los lotes de la sala de quien mira (pedido del usuario, 2026-11-15):
  // en el mostrador se vende lo que hay en el estante propio. Quien no tiene
  // sala —administración— ve los de todas, con el nombre de cada una.
  const conSala = miErp != null;
  const lotes = useMemo(() => {
    const vistos = new Set();
    const out = [];
    for (const s of salas.filter(x => !conSala || x.erp === miErp)) {
      for (const l of s.lots ?? []) {
        const k = `${l.erp_sucursal_id}|${l.lote ?? ''}|${l.fecha_vencimiento ?? ''}|${l.presentacion ?? ''}`;
        if (vistos.has(k)) continue;
        vistos.add(k);
        out.push({ ...l, _clave: k, _sala: s.name });
      }
    }
    // Lo que vence primero, arriba: es lo que se despacha primero.
    return out.sort((a, b) => String(a.fecha_vencimiento ?? '9999').localeCompare(String(b.fecha_vencimiento ?? '9999')));
  }, [salas, miErp, conSala]);

  const lista = useMemo(() => presentacionesParaMostrar(precios, lotes), [precios, lotes]);

  if (precios === null) return <LoadingState variant="inline" size="sm" label="Cargando precios…" />;

  return (
    <div className="@container flex flex-col gap-3">
      {error && <Notice variant="danger">{error}</Notice>}
      {!lista.length ? (
        !error && (
          <p className="flex items-center gap-2 text-label text-content-3">
            <Package size={16} className="shrink-0" /> Este producto no tiene precios registrados.
          </p>
        )
      ) : (
        <>
          <div className="hidden @2xl:block"><Tabla lista={lista} conSala={conSala} /></div>
          <div className="grid gap-2 @lg:grid-cols-2 @2xl:hidden">
            {lista.map(p => <Tarjeta key={p.id} p={p} conSala={conSala} />)}
          </div>
        </>
      )}
      <Lotes lotes={lotes} conSala={conSala} />
    </div>
  );
}
