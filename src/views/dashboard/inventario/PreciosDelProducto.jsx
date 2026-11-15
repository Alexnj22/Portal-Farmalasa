import React, { useEffect, useMemo, useState } from 'react';
import { Package, CalendarClock } from 'lucide-react';
import LiquidSelect from '../../../components/common/LiquidSelect';
import { LoadingState } from '../../../components/common/StateViews';
import Notice from '../../../components/common/Notice';
import { fetchPreciosDelProducto } from '@nucleo/data/productos';
import { nivelesVisibles } from '@nucleo/utils/preciosDeProducto';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';

/* ── Precios en la consulta de inventario (2026-11-15) ──────────────────────
 * Pedido del usuario: que el personal de sala vea cuánto cuesta un producto
 * desde el widget, eligiendo presentación y lote, con los precios hasta
 * Mayoreo Plus PARA TODOS. Por eso el tope es fijo acá y no sale del
 * `max_price_level` del cargo: es una decisión de esta pantalla, no del cargo.
 * El costo no viaja nunca (la consulta no lo pide).
 *
 * El precio es de la PRESENTACIÓN, no del lote: `product_precios` no tiene
 * lote. El lote se elige para saber de cuál se habla —sala, vencimiento,
 * existencia— y, si su presentación coincide con una con precio, la elige. */
const TOPE_DEL_WIDGET = 'mayoreo'; // «Mayoreo Plus»
const NIVELES = nivelesVisibles(TOPE_DEL_WIDGET);
const COLUMNAS = NIVELES.map(n => n.key).join(', ');

const normal = (s) => String(s ?? '').trim().toUpperCase();
const claveDeLote = (l) => `${l.erp_sucursal_id}|${l.lote ?? ''}|${l.fecha_vencimiento ?? ''}|${l.presentacion ?? ''}`;
const nombreDePresentacion = (p) => p.presentaciones?.tipo || p.descripcion || `Presentación ${p.id_presentacion}`;

/**
 * @param {{ erpProductId: number|null, salas: {name: string, erp: number|null, lots: object[]}[], miErp: number|null }} props
 *   `salas` son las del detalle, SIN el área de vencidos: no se vende de ahí.
 */
export default function PreciosDelProducto({ erpProductId, salas, miErp }) {
  const [precios, setPrecios] = useState(null);
  const [error, setError] = useState(null);
  const [idPresentacion, setIdPresentacion] = useState(null);
  const [lote, setLote] = useState(null);

  useEffect(() => {
    if (erpProductId == null) return;
    let cancelado = false;
    fetchPreciosDelProducto(erpProductId, COLUMNAS).then(({ data, error: err }) => {
      if (cancelado) return;
      if (err) { setError(mensajeAmigable(err)); setPrecios([]); return; }
      setError(null);
      setPrecios((data ?? []).filter(p => p.activo !== false));
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
        const k = claveDeLote(l);
        if (vistos.has(k)) continue;
        vistos.add(k);
        out.push({ ...l, _clave: k, _sala: s.name });
      }
    }
    return out;
  }, [salas, miErp, conSala]);

  const opcionesLote = useMemo(() => lotes.map(l => ({
    value: l._clave,
    label: conSala ? (l.lote || 'Sin lote') : `${l.lote || 'Sin lote'} · ${l._sala}`,
    sublabel: [
      l.presentacion?.trim(),
      l.fecha_vencimiento ? `vence ${fechaTexto(l.fecha_vencimiento, { month: 'short', year: 'numeric' })}` : null,
      `${l.cantidad} en existencia`,
    ].filter(Boolean).join(' · '),
  })), [lotes, conSala]);

  const opcionesPresentacion = useMemo(() => (precios ?? []).map(p => ({
    value: String(p.id_presentacion),
    label: nombreDePresentacion(p),
    sublabel: Number(p.factor) > 1 ? `${p.factor} unidades` : null,
  })), [precios]);

  // Lo elegido, o lo primero si todavía no se eligió (o ya no existe).
  const loteElegido = lotes.find(l => l._clave === lote) ?? lotes[0] ?? null;
  const presentacionDelLote = useMemo(() => {
    if (!loteElegido || !precios?.length) return null;
    const p = normal(loteElegido.presentacion);
    return precios.find(x => normal(x.presentaciones?.tipo) === p)
      ?? precios.find(x => x.presentaciones?.tipo && p.startsWith(normal(x.presentaciones.tipo)))
      ?? null;
  }, [loteElegido, precios]);
  const elegida = (precios ?? []).find(p => String(p.id_presentacion) === idPresentacion)
    ?? presentacionDelLote ?? precios?.[0] ?? null;

  const elegirLote = (v) => {
    setLote(v);
    // Cambiar de lote vuelve a proponer la presentación que le corresponde.
    setIdPresentacion(null);
  };

  const [principal, ...resto] = NIVELES;

  return (
    <section className="flex flex-col gap-3 shrink-0" aria-label="Precios">
      {error && <Notice variant="danger">{error}</Notice>}

      {precios === null ? (
        <LoadingState variant="inline" size="sm" label="Cargando precios…" />
      ) : !precios.length ? (
        !error && <p className="text-label text-content-3 italic">Este producto no tiene precios registrados.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <LiquidSelect
              ariaLabel="Presentación"
              icon={Package}
              placeholder="Presentación"
              value={elegida ? String(elegida.id_presentacion) : ''}
              onChange={v => setIdPresentacion(v || null)}
              options={opcionesPresentacion}
              clearable={false}
            />
            {lotes.length ? (
              <LiquidSelect
                ariaLabel="Lote"
                icon={CalendarClock}
                placeholder="Lote"
                value={loteElegido?._clave ?? ''}
                onChange={v => elegirLote(v || null)}
                options={opcionesLote}
                clearable={false}
              />
            ) : (
              <p className="flex items-center gap-2 px-3 min-h-[var(--tap-min)] text-label text-content-3">
                <CalendarClock size={16} className="shrink-0" />
                {conSala ? 'Sin existencia en tu sala' : 'Sin existencia'}
              </p>
            )}
          </div>

          {elegida && (
            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] rounded-2xl border border-divider overflow-hidden">
              <div className="flex flex-col justify-center gap-0.5 px-4 py-3 bg-brand/10">
                <span className="text-caption font-black uppercase tracking-widest text-brand-text">{principal.label}</span>
                <span className="text-display font-black tabular-nums text-content leading-none">{formatMoney(elegida[principal.key])}</span>
                <span className="text-micro text-content-3 mt-1">
                  {nombreDePresentacion(elegida)}{Number(elegida.factor) > 1 ? ` · ${elegida.factor} unidades` : ''}
                </span>
              </div>
              <dl className="divide-y divide-divider bg-surface-card-hover">
                {resto.map(n => (
                  <div key={n.key} className="flex items-center justify-between gap-3 px-4 py-2">
                    <dt className="text-label font-semibold text-content-2">{n.label}</dt>
                    <dd className="text-body font-black tabular-nums text-content">{formatMoney(elegida[n.key])}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </>
      )}
    </section>
  );
}
