import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import { EmptyState } from '../../components/common/StateViews';
import { Loader2, X, Package, ArrowLeft, ZoomIn, ChevronRight, FlaskConical, PackageMinus, CheckCircle2, AlertTriangle } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../context/AuthContext';
import {
  fetchProductPhotoMap,
  fetchProductsByPrincipioActivo,
  buscarInventarioGlobal,
  fetchInventoryByProductIds,
  fetchFaltantesConStockEnOtraSala,
} from '../../data/inventory';
import { insertVentaPerdida } from '../../data/ventasPerdidas';
import PortalInput from '../../components/common/PortalInput';
import { clickable } from '../../utils/clickable';
import PhotoLightbox from '../../components/common/PhotoLightbox';
import LiquidSelect from '../../components/common/LiquidSelect';
import SearchInput from '../../components/common/SearchInput';
import LanzadorSolicitud, { HerramientasModal } from './LanzadorSolicitud';
import PedirTrasladoModal from './PedirTrasladoModal';

const ERP_BRANCH_MAP = {
  1: 'Salud 1',
  2: 'Salud 2',
  3: 'Salud 3',
  4: 'Salud 4',
  5: 'La Popular',
  6: 'Bodega',
  7: 'Salud 5',
};
const BRANCH_ORDER = [5, 1, 2, 3, 4, 7, 6];
// branch del portal → sucursal del sistema de origen. Son numeraciones
// distintas; el mismo mapa que usa el tablero.
const MI_ERP_POR_BRANCH = { 2: 5, 4: 1, 25: 2, 27: 3, 28: 4, 29: 7, 30: 6 };

const NEUTRAL_THEME = { dot: 'var(--chart-8)', pill: 'bg-surface-card-hover border-divider', label: 'text-content-2' };
const VENCIDOS_THEME = { dot: 'var(--danger)', pill: 'bg-danger/10 border-danger/30', label: 'text-danger-text' };
const DEFAULT_THEME = NEUTRAL_THEME;

/* ─── SRS helpers ──────────────────────────────────────────────────────────── */
async function srsFetch(q) {
  const { data: { session } } = await supabase.auth.getSession();
  const base = import.meta.env.VITE_SUPABASE_URL;
  const url  = `${base}/functions/v1/srs-proxy?q=${encodeURIComponent(q)}&page=1&page-max=5`;
  const res  = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${session?.access_token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
  });
  if (!res.ok) throw new Error(`SRS ${res.status}`);
  return res.json();
}

function sanitizeSrs(v) {
  if (v == null) return '';
  const s = typeof v === 'object' ? String(v.nombre ?? v.name ?? v.value ?? '') : String(v);
  return s
    // Limpia control chars y caracteres invisibles (Private Use Area, Specials)
    // que vienen pegados en los datos del SRS gubernamental \u2014 intencional.
    // eslint-disable-next-line no-control-regex
    .replace(new RegExp('[\x00-\x08\x0B\x0C\x0E-\x1F\uE000-\uF8FF\uFFF0-\uFFFF]', 'g'), '')
    .replace(/\u00A0/g, ' ')
    .trim();
}

// Extracts the base molecule name, stripping concentration (e.g. "IBUPROFENO 400MG" → "IBUPROFENO")
function extractMolecule(principio) {
  if (!principio) return null;
  const m = principio.trim().match(/^([A-ZÁÉÍÓÚÑÜ\s+\-/]+)/i);
  return m ? m[1].trim() : principio.trim();
}

/* ─── Utilities ────────────────────────────────────────────────────────────── */
function daysUntil(d) {
  if (!d) return null;
  return Math.ceil((new Date(d + 'T12:00:00') - new Date()) / 86400000);
}

// ── `Map` y no un objeto: la clave es un NÚMERO disfrazado (2026-08-07) ─────
// `key` es `String(erp_product_id)`, o sea "2221", "3005"… y `Object.values()`
// sobre claves que parecen enteros las devuelve **ordenadas numéricamente**, no
// por orden de inserción. Está en la especificación del lenguaje y no avisa.
//
// Consecuencia medida: la lista salía ordenada por id de producto — ni
// alfabética, ni la que mandaba el servidor. Se notó al pedir que los que
// coinciden por NOMBRE fueran antes que los que sólo coinciden por principio
// activo: la base ya los devolvía así y la pantalla los volvía a mezclar.
// Un `Map` conserva el orden de inserción para cualquier tipo de clave, así que
// lo que decide el orden vuelve a ser el `ORDER BY` de `buscar_inventario_global`.
function groupInventory(rows, paMap, photoMap) {
  const porSucursal = new Map();
  for (const row of rows || []) {
    if (row.is_vencidos) continue; // vencidos handled separately
    const bName = ERP_BRANCH_MAP[row.erp_sucursal_id];
    if (!bName) continue;
    // La clave es el PRODUCTO. Antes incluía la presentación, así que un
    // acetaminofén salía tres veces —UNIDAD, BLISTER y CAJA— como si fueran
    // tres productos. La presentación pasa a ser un dato de cada lote.
    const key = String(row.erp_product_id ?? row.descripcion);
    if (!porSucursal.has(bName)) porSucursal.set(bName, new Map());
    const productos = porSucursal.get(bName);
    if (!productos.has(key)) productos.set(key, {
      descripcion:     row.descripcion,
      presentacion:    row.presentacion,
      principioActivo: paMap?.get(row.erp_product_id) ?? null,
      fotoUrl:         photoMap[row.descripcion.toUpperCase().trim()] ?? null,
      lots:            [],
    });
    productos.get(key).lots.push(row);
  }
  return BRANCH_ORDER
    .map(id => ({
      name: ERP_BRANCH_MAP[id],
      products: [...(porSucursal.get(ERP_BRANCH_MAP[id])?.values() ?? [])],
    }))
    .filter(b => b.products.length > 0);
}

function groupVencidos(rows, paMap, photoMap) {
  const map = new Map();
  for (const row of rows || []) {
    if (!row.is_vencidos) continue;
    const key = String(row.erp_product_id ?? row.descripcion);
    if (!map.has(key)) map.set(key, {
      descripcion:     row.descripcion,
      presentacion:    row.presentacion,
      principioActivo: paMap?.get(row.erp_product_id) ?? null,
      fotoUrl:         photoMap[row.descripcion.toUpperCase().trim()] ?? null,
      lots:            [],
    });
    map.get(key).lots.push(row);
  }
  return [...map.values()];
}

/* ─── Sub-components ───────────────────────────────────────────────────────── */
function ExpiryBadge({ date }) {
  if (!date) return null;
  const days      = daysUntil(date);
  const isExpired = days <= 0;
  const isNear    = days > 0 && days <= 60;
  return (
    <Badge variant={isExpired ? 'danger' : isNear ? 'warning' : 'neutral'}
      size="sm" uppercase={false} className="shrink-0 whitespace-nowrap">
      {isExpired
        ? '⚠ Vencido'
        : new Date(date + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: '2-digit' })}
    </Badge>
  );
}

function SkeletonSection({ rows }) {
  return (
    <div className="mb-4 animate-pulse">
      <div className="flex items-center gap-2 mb-2">
        <div className="h-px flex-1 bg-divider rounded" />
        <div className="h-5 w-24 bg-surface-card-hover rounded-full" />
        <div className="h-px flex-1 bg-divider rounded" />
      </div>
      <div className="space-y-1">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-2.5 px-2.5 py-2">
            <div className="flex-1 space-y-1.5">
              <div className="h-2.5 bg-surface-card-hover rounded-md" style={{ width: `${48 + (i * 19) % 36}%` }} />
              <div className="h-1.5 bg-surface-card-hover rounded-md w-1/3" />
            </div>
            <div className="h-2 w-8 bg-surface-card-hover rounded shrink-0" />
            <div className="h-4 w-20 bg-surface-card-hover rounded-md shrink-0" />
            <div className="h-2.5 w-12 bg-surface-card-hover rounded shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

function PhotoThumb({ url, onZoom }) {
  if (!url) return null;
  return (
    <Button icon={ZoomIn} iconOnly size="sm" variant="secondary" onClick={e => { e.stopPropagation(); onZoom(url); }} />
  );
}



/* ─── Compact SRS card with inline report button ───────────────────────────── */
function SrsCompactCard({ product: p, searchQuery, user }) {
  const [formOpen, setFormOpen] = useState(false);
  const [qty,      setQty]      = useState('1');
  const [rState,   setRState]   = useState('idle'); // idle | saving | done

  const nombre    = sanitizeSrs(p.nombre_comercial ?? p.nombreComercial ?? '');
  const principio = sanitizeSrs(p.principio_activo ?? p.formula ?? '');
  const conc      = sanitizeSrs(p.concentracion ?? '');
  const lab       = sanitizeSrs(p.laboratorio ?? '');
  const estatus   = sanitizeSrs(p.estatus ?? p.Activo ?? '');
  const activo    = estatus === 'A';

  const submit = async () => {
    const cantidad = parseInt(qty, 10);
    if (!cantidad || cantidad < 1) return;
    setRState('saving');
    await insertVentaPerdida({
      producto_buscado: searchQuery,
      descripcion:      nombre   || null,
      principio_activo: principio ? `${principio}${conc ? ` ${conc}` : ''}` : null,
      laboratorio:      lab      || null,
      cantidad,
      branch_id:     user?.branchId ?? null,
      reportado_por: user?.id       ?? null,
      status:        'pendiente',
    });
    setRState('done');
    setTimeout(() => { setFormOpen(false); setRState('idle'); setQty('1'); }, 2500);
  };

  return (
    <div data-surface="card" className="px-3 py-2.5 flex flex-col gap-1.5">
      {/* Header row: nombre + estatus + reportar */}
      <div className="flex items-start gap-1.5">
        <p className="text-label font-black text-content leading-tight flex-1">{nombre || '—'}</p>
        <Badge variant={activo ? 'success' : 'neutral'} size="sm" className="shrink-0">{activo ? 'ACTIVO' : 'INACTIVO'}</Badge>
        {rState === 'done' ? (
          <Badge variant="success" size="sm" icon={CheckCircle2} uppercase={false}>OK</Badge>
        ) : formOpen ? (
          <div className="shrink-0 flex items-center gap-1">
            <PortalInput
                aria-label="Cantidad a solicitar" compact className="w-12"
                type="number" min="1" value={qty} onChange={e => setQty(e.target.value)}
                inputClassName="text-center font-black"
            />
            <Button variant="destructive" disabled={rState === 'saving'} onClick={submit}>{rState === 'saving' ? '…' : 'OK'}</Button>
            <Button variant="ghost" icon={X} iconOnly onClick={() => setFormOpen(false)} />
          </div>
        ) : (
          <Button variant="destructive" icon={PackageMinus} onClick={() => setFormOpen(true)}>Reportar</Button>
        )}
      </div>
      {principio && (
        <div className="flex items-center gap-1.5 bg-chart-3/10 rounded-lg px-2 py-1">
          <FlaskConical size={9} className="text-chart-3-text shrink-0" />
          <p className="text-caption text-chart-3-text font-semibold leading-tight">
            {principio}{conc ? ` ${conc}` : ''}
          </p>
        </div>
      )}
      {lab && <p className="text-micro text-content-3 font-medium truncate">{lab}</p>}
    </div>
  );
}

/* ─── Branch sections (shared between results and alternatives) ────────────── */
/**
 * El botón de pedir, en la fila de una sala que SÍ tiene.
 *
 * Existe porque la búsqueda es el momento en que uno se entera: un cliente
 * pregunta, se busca, y ahí se ve que otra sala lo tiene. Hasta acá no había
 * forma de pedirlo desde ahí —había que cerrar, abrir otro widget y esperar que
 * el producto apareciera en la lista de faltantes—. Lo reportó el usuario
 * probándolo el 2026-08-06.
 *
 * No se ofrece sobre la propia sala: pedirse a uno mismo no es un traslado.
 */
function PedirEnFila({ prod, branchName, onPedir }) {
  if (!onPedir || onPedir.miSala === branchName) return null;
  const id  = prod?.lots?.[0]?.erp_product_id;
  const suc = prod?.lots?.[0]?.erp_sucursal_id;
  if (!id) return null;
  return (
    // `primary` y `sm`: es LA acción de la fila y estaba compitiendo de igual a
    // igual con el número de unidades. A pedido del usuario tras verlo.
    <Button
      size="sm"
      variant="primary"
      className="shrink-0"
      aria-label={`Pedir ${prod.descripcion} a ${branchName}`}
      onClick={(e) => {
        e.stopPropagation();
        // La sala VIAJA con el pedido. La fila ya está bajo el encabezado de su
        // sucursal, así que preguntarla de nuevo en el formulario es pedir dos
        // veces el mismo dato — el usuario lo marcó apretando «Pedir» sobre una
        // fila de La Popular y encontrándose un selector de sucursales.
        onPedir.abrir({
          erp_product_id: id,
          descripcion: prod.descripcion,
          origen_sugerido: suc ?? null,
        });
      }}
    >
      Pedir
    </Button>
  );
}

function BranchSections({ branches, onDrill, onZoom, onPedir, animOffset = 0 }) {
  return branches.map((branch, bi) => {
    const theme       = NEUTRAL_THEME;
    const branchTotal = branch.products.reduce((s, p) => s + p.lots.reduce((ss, r) => ss + r.cantidad, 0), 0);

    return (
      <div
        key={branch.name}
        className="mb-4"
        style={{ animation: `inv-fade-up 0.28s ease both`, animationDelay: `${(animOffset + bi) * 55}ms` }}
      >
        <div className="flex items-center gap-2 mb-1.5 sticky top-0 z-base py-0.5">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent to-divider" />
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${theme.pill} shadow-sm`}>
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: theme.dot }} />
            <span className={`text-caption font-black uppercase tracking-wider ${theme.label}`}>{branch.name}</span>
            <span className="w-px h-3 bg-divider mx-1" />
            <span className={`text-body-sm font-black tabular-nums ${theme.label}`}>{branchTotal}</span>
            <span className="text-micro font-semibold text-content-3 ml-0.5">uds</span>
          </div>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent to-divider" />
        </div>

        <div className="space-y-2">
          {branch.products.map((prod, pi) => {
            const lotTotal = prod.lots.reduce((s, r) => s + r.cantidad, 0);
            const multiLot = prod.lots.length > 1;

            return (
              <div
                key={prod.descripcion}
                className="rounded-xl overflow-hidden"
                style={{ animation: `inv-fade-up 0.22s ease both`, animationDelay: `${(animOffset + bi) * 55 + pi * 25}ms` }}
              >
                {multiLot ? (
                  <div
                    className="rounded-xl overflow-hidden cursor-pointer group"
                    style={{ background: 'var(--surface-card)', border: '1px solid var(--border-card)', boxShadow: 'var(--shadow-glass-1)' }}
                    {...clickable(() => onDrill({ descripcion: prod.descripcion, presentacion: prod.presentacion, fotoUrl: prod.fotoUrl, principioActivo: prod.principioActivo }))}
                  >
                    <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5 group-hover:bg-surface-card transition-colors">
                      {prod.fotoUrl && <PhotoThumb url={prod.fotoUrl} onZoom={onZoom} />}
                      <div className="flex-1 min-w-0">
                        <p className="text-label font-black text-content leading-tight">{prod.descripcion}</p>
                        {prod.principioActivo && (
                          <p className="text-micro text-chart-3-text font-semibold mt-0.5 truncate">{prod.principioActivo}</p>
                        )}
                        {/* Ya no se nombra UNA presentación acá: el producto
                            agrupa varias y cada una se lista con su lote. */}
                      </div>
                      <span className="text-caption font-black text-content-3 shrink-0 tabular-nums">{lotTotal} uds</span>
                      <PedirEnFila prod={prod} branchName={branch.name} onPedir={onPedir} />
                      <ChevronRight size={11} className="text-content-3 group-hover:text-brand-text transition-colors shrink-0" strokeWidth={2.5} />
                    </div>
                    <div className="divide-y divide-divider" style={{ background: 'var(--surface-card)' }}>
                      {prod.lots.map((row, li) => (
                        <div key={li} className="flex items-center gap-2 px-3 py-1.5">
                          <span className="text-micro font-mono text-content-3 flex-1 truncate min-w-0">{row.lote || '—'}</span>
                          <ExpiryBadge date={row.fecha_vencimiento} />
                          {/* La presentación va ANTES de la cantidad y en un
                              tono que se lea: es lo que le da sentido al
                              número —24 no quiere decir nada sin saber si son
                              cajas o unidades—. Antes vivía como una línea
                              gris bajo el nombre del producto. */}
                          {row.presentacion && (
                            <span className="text-micro font-black text-content-2 uppercase tracking-wider shrink-0">
                              {row.presentacion}
                            </span>
                          )}
                          <span className="text-caption font-black text-content-2 shrink-0 tabular-nums w-14 text-right">{row.cantidad}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  // Un div con DOS botones adentro y no un botón entero: la
                  // fila tiene dos acciones —abrir el producto y pedirlo— y un
                  // botón dentro de otro no es HTML válido.
                  <div
                    className="w-full flex items-center gap-2 px-2.5 py-2.5 rounded-xl hover:bg-surface-card transition-colors group"
                    style={{ background: 'var(--surface-card-hover)', border: '1px solid var(--border-card)', boxShadow: 'var(--shadow-glass-1)' }}
                  >
                    {prod.fotoUrl && <PhotoThumb url={prod.fotoUrl} onZoom={onZoom} />}
                    <button
                      type="button"
                      className="flex-1 min-w-0 flex items-center gap-2 text-left"
                      onClick={() => onDrill({ descripcion: prod.descripcion, presentacion: prod.presentacion, fotoUrl: prod.fotoUrl, principioActivo: prod.principioActivo })}
                    >
                      <span className="flex-1 min-w-0 block">
                        <span className="block text-label font-bold text-content truncate leading-tight">{prod.descripcion}</span>
                        {prod.principioActivo && (
                          <span className="block text-micro text-chart-3-text font-semibold truncate">{prod.principioActivo}</span>
                        )}
                        {prod.presentacion && (
                          <span className="block text-micro text-content-3">{prod.presentacion}</span>
                        )}
                      </span>
                      <span className="text-micro font-mono text-content-3 shrink-0 max-w-[60px] truncate">
                        {prod.lots[0].lote || '—'}
                      </span>
                      <ExpiryBadge date={prod.lots[0].fecha_vencimiento} />
                      <span className="text-caption font-black text-content-2 shrink-0 tabular-nums w-14 text-right">
                        {prod.lots[0].cantidad} uds
                      </span>
                    </button>
                    <PedirEnFila prod={prod} branchName={branch.name} onPedir={onPedir} />
                    <ChevronRight size={11} className="text-content-3 group-hover:text-brand-text transition-colors shrink-0" strokeWidth={2.5} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  });
}

/* ─── Section label ────────────────────────────────────────────────────────── */
function SectionLabel({ icon: Icon, label, color = 'text-content-3', bg = 'bg-surface-card-hover' }) {
  return (
    <div className="flex items-center gap-2 mb-2 mt-1">
      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${bg}`}>
        <Icon size={10} className={color} strokeWidth={2.5} />
        <span className={`text-micro font-black uppercase tracking-wider ${color}`}>{label}</span>
      </div>
      <div className="h-px flex-1 bg-divider" />
    </div>
  );
}

/* ─── Main component ────────────────────────────────────────────────────────── */
function PanelInventario({ query = '', onQueryChange }) {
  const { user }       = useAuth();
  const [results,      setResults]      = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);
  const [drillProduct,   setDrillProduct]   = useState(null);
  const [lightboxUrl,    setLightboxUrl]    = useState(null);
  const [vencidosProds,  setVencidosProds]  = useState([]);
  const [faltantes,      setFaltantes]      = useState([]);
  const [pedido,         setPedido]         = useState(null);   // el faltante que se está pidiendo
  const [srsResults,     setSrsResults]     = useState(null);
  const [srsLoading,   setSrsLoading]   = useState(false);
  const [alternatives, setAlternatives] = useState([]);
  const debounceRef                     = useRef(null);

  // La sucursal de quien mira. El widget consulta TODAS las salas, pero
  // "lo que falta" solo tiene sentido desde una sala concreta.
  //
  // Quien no está EN una sala —Administración son 7 personas, Supervisión
  // incluida— no tenía ninguna: la lista de faltantes no se le dibujaba nunca y
  // el widget se le abría en blanco, que es justo lo que la lista existe para
  // evitar. Con alcance de todas las sucursales ahora puede elegir cuál mirar,
  // igual que hacen Ajuste de Inventario y Meta del mes.
  // Quien no está EN una sala —Administración son 7 personas, Supervisión
  // incluida— no tiene «lo que me falta»: no hay sala desde la cual falte nada.
  // Así que esa lista simplemente no se le muestra, y tampoco un selector para
  // fabricarle una. Decisión del usuario, 2026-08-06: «si tiene alcance todos no
  // muestres ver lo que falta, no es necesario».
  //
  // Lo que sí puede es PEDIR, y para eso hace falta un destino. Esa pregunta se
  // hace en el formulario del pedido, que es donde se está decidiendo —no en la
  // pantalla de consulta, que solo mira.
  const miErp = MI_ERP_POR_BRANCH[user?.branchId ?? user?.branch_id] ?? null;

  // Lo que las filas de resultado necesitan para ofrecer «Pedir»: de qué sala es
  // quien mira (para no ofrecerle pedirse a sí mismo) y cómo abrir el
  // formulario. Va como un objeto y no como dos props sueltas para que agregar
  // una tercera no obligue a tocar la firma de todos los componentes del medio.
  //
  // Solo para quien TIENE sala: un traslado necesita un destino, y quien no
  // está asignado a ninguna no puede recibirlo. Ofrecerle el botón lo lleva a un
  // formulario que no puede completar, que es peor que no ofrecerlo.
  const accionPedir = useMemo(
    () => (miErp ? { miSala: ERP_BRANCH_MAP[miErp], abrir: setPedido } : null),
    [miErp],
  );

  const cargarFaltantes = useCallback(() => {
    if (!miErp) return;
    fetchFaltantesConStockEnOtraSala(miErp, 20).then(r => {
      if (!r.error) setFaltantes(r.filas);
    });
  }, [miErp]);

  useEffect(() => { cargarFaltantes(); }, [cargarFaltantes]);

  const doSearch = useCallback(async (q) => {
    if (!q.trim()) { setResults(null); return; }
    setLoading(true);
    setError(null);
    setDrillProduct(null);
    setSrsResults(null);
    setAlternatives([]);
    setVencidosProds([]);

    try {
      // ── UN viaje, no cuatro (2026-08-07) ────────────────────────────────
      // Esto eran cuatro peticiones ENCADENADAS —productos por principio
      // activo, RPC de ids por descripción, inventory por esos ids, y las
      // fotos— cada una esperando a la anterior. Medido: 2.667 ms de mediana
      // con ningún tramo pasando de 400 ms, o sea que la espera era la cadena
      // y no la base.
      //
      // `buscarInventarioGlobal` las hace juntas del lado del servidor y trae
      // el principio activo y la foto DENTRO de cada fila, así que acá ya no
      // queda nada que cruzar: los dos mapas se arman leyendo lo que llegó.
      const { filas: data } = await buscarInventarioGlobal(q);

      const paMap = new Map();
      const photoMap = {};
      for (const r of data) {
        if (r.principio_activo) paMap.set(r.erp_product_id, r.principio_activo);
        if (r.foto_url) photoMap[r.descripcion.toUpperCase().trim()] = r.foto_url;
      }

      const grouped  = groupInventory(data, paMap, photoMap);
      const vencidos = groupVencidos(data, paMap, photoMap);
      setResults(grouped);
      setVencidosProds(vencidos);

      // 3. No inventory results → auto-search SRS + find alternatives
      if (grouped.length === 0) {
        setSrsLoading(true);
        try {
          const srsJson = await srsFetch(q);
          const srsData = srsJson.data || [];
          setSrsResults(srsData);

          // Extract unique base molecules from SRS results
          const molecules = [...new Set(
            srsData
              .map(p => extractMolecule(sanitizeSrs(p.principio_activo ?? p.formula ?? '')))
              .filter(Boolean)
          )];

          if (molecules.length > 0) {
            // Find our products matching any of these molecules
            const altProds  = await fetchProductsByPrincipioActivo(molecules);
            const altIds    = altProds.map(p => p.id);
            const altPaMap  = new Map(altProds.map(p => [p.id, p.principio_activo]));

            if (altIds.length > 0) {
              const altInv = await fetchInventoryByProductIds(altIds);
              // Las fotos se piden ACÁ y no se heredan del `photoMap` de
              // arriba: en esta rama la búsqueda no encontró nada, así que ese
              // mapa está vacío por definición. Antes venía de una consulta
              // aparte que sí cubría a las alternativas; al fusionarla dentro
              // de la búsqueda, esta rama se quedaba sin fotos.
              const altFotos = await fetchProductPhotoMap(
                [...new Set(altInv.map(r => r.descripcion).filter(Boolean))],
              );
              setAlternatives(groupInventory(altInv, altPaMap, altFotos));
            }
          }
        } catch {
          // SRS failure is non-fatal
        } finally {
          setSrsLoading(false);
        }
      }
    } catch {
      setError('Error al consultar inventario');
    } finally {
      setLoading(false);
    }
  }, []);

  // El texto llega por prop; acá solo se reacciona a que cambie. `handleInput`
  // se conserva porque la lista de faltantes lo usa para buscar al tocar un
  // producto — escribe en el buscador de arriba, que es lo que se espera.
  const handleInput = (val) => onQueryChange?.(val);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults(null); setDrillProduct(null); setSrsResults(null);
      setAlternatives([]); setVencidosProds([]);
      return;
    }
    debounceRef.current = setTimeout(() => doSearch(query), 380);
    return () => clearTimeout(debounceRef.current);
  }, [query, doSearch]);

  /* ── DRILL-DOWN VIEW ────────────────────────────────────────────────────── */
  if (drillProduct) {
    const drillBranches = (results || []).concat(alternatives).reduce((acc, branch) => {
      const matching = branch.products.filter(p =>
        p.descripcion === drillProduct.descripcion &&
        (p.presentacion || '') === (drillProduct.presentacion || '')
      );
      if (!matching.length) return acc;
      const existing = acc.find(b => b.name === branch.name);
      if (existing) existing.products = matching;
      else acc.push({ ...branch, products: matching });
      return acc;
    }, []);

    // Add bodega vencidos if this product has any
    const drillVencidos = vencidosProds.filter(p =>
      p.descripcion === drillProduct.descripcion &&
      (p.presentacion || '') === (drillProduct.presentacion || '')
    );
    if (drillVencidos.length > 0) {
      drillBranches.push({ name: 'Bodega · Vencidos', products: drillVencidos, isVencidos: true });
    }

    const grandTotal = drillBranches.reduce(
      (s, b) => s + b.products[0].lots.reduce((ss, r) => ss + r.cantidad, 0), 0
    );

    return (
      <div className="flex flex-col gap-2.5 flex-1 min-h-0">
        <div className="flex items-center gap-2.5 shrink-0">
          <Button variant="secondary" size="xs" icon={ArrowLeft} iconOnly onClick={() => setDrillProduct(null)} />

          {drillProduct.fotoUrl ? (
            <Button
                icon={ZoomIn}
                iconOnly
                size="lg"
                variant="secondary"
                onClick={() => setLightboxUrl(drillProduct.fotoUrl)}
            />
          ) : (
            <div className="w-11 h-11 rounded-xl bg-surface-card-hover border border-divider flex items-center justify-center shrink-0">
              <Package size={18} strokeWidth={1.5} className="text-content-3" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <p className="text-body-sm font-black text-content leading-tight truncate">{drillProduct.descripcion}</p>
            {drillProduct.principioActivo && (
              <p className="text-micro text-chart-3-text font-semibold truncate">{drillProduct.principioActivo}</p>
            )}
            {drillProduct.presentacion && (
              <p className="text-caption text-content-3 font-medium">{drillProduct.presentacion}</p>
            )}
            <p className="text-micro text-content-3 font-bold mt-0.5">{grandTotal} uds · {drillBranches.length} sucursal{drillBranches.length !== 1 ? 'es' : ''}</p>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {drillBranches.length === 0 ? (
            <EmptyState compact icon={Package} title="Sin stock en ninguna sucursal" />
          ) : (
            drillBranches.map((branch, bi) => {
              const theme = branch.isVencidos ? VENCIDOS_THEME : NEUTRAL_THEME;
              const prod  = branch.products[0];
              const total = prod.lots.reduce((s, r) => s + r.cantidad, 0);
              return (
                <div
                  key={branch.name}
                  className="mb-3"
                  style={{ animation: `inv-fade-up 0.22s ease both`, animationDelay: `${bi * 45}ms` }}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className={`h-px flex-1 bg-gradient-to-r from-transparent ${branch.isVencidos ? 'to-danger/20' : 'to-divider'}`} />
                    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${theme.pill} shadow-sm`}>
                      {branch.isVencidos
                        ? <AlertTriangle size={9} className="text-danger-text shrink-0" strokeWidth={2.5} />
                        : <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: theme.dot }} />}
                      <span className={`text-caption font-black uppercase tracking-wider ${theme.label}`}>{branch.name}</span>
                      <span className="w-px h-3 bg-divider mx-1" />
                      <span className={`text-body-sm font-black tabular-nums ${theme.label}`}>{total}</span>
                      <span className="text-micro font-semibold text-content-3 ml-0.5">uds</span>
                    </div>
                    <div className={`h-px flex-1 bg-gradient-to-l from-transparent ${branch.isVencidos ? 'to-danger/20' : 'to-divider'}`} />
                  </div>
                  <div
                    className="rounded-xl overflow-hidden shadow-sm"
                    style={{
                      background: branch.isVencidos ? 'color-mix(in srgb, var(--danger) 8%, transparent)' : 'var(--surface-card-hover)',
                      border: branch.isVencidos ? '1px solid var(--danger)' : '1px solid var(--border-card)',
                    }}
                  >
                    {prod.lots.length === 1 ? (
                      <div className="flex items-center gap-2 px-3 py-2">
                        <span className="text-micro font-mono text-content-3 flex-1 truncate">{prod.lots[0].lote || '—'}</span>
                        <ExpiryBadge date={prod.lots[0].fecha_vencimiento} />
                        <span className={`text-caption font-black shrink-0 tabular-nums w-14 text-right ${branch.isVencidos ? 'text-danger-text' : 'text-content-2'}`}>{prod.lots[0].cantidad} uds</span>
                      </div>
                    ) : (
                      <div className="divide-y divide-divider">
                        {prod.lots.map((row, li) => (
                          <div key={li} className="flex items-center gap-2 px-3 py-1.5">
                            <span className="text-micro font-mono text-content-3 flex-1 truncate min-w-0">{row.lote || '—'}</span>
                            <ExpiryBadge date={row.fecha_vencimiento} />
                            <span className={`text-caption font-black shrink-0 tabular-nums w-14 text-right ${branch.isVencidos ? 'text-danger-text' : 'text-content-2'}`}>{row.cantidad} uds</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <PhotoLightbox src={lightboxUrl} alt="Foto del producto" onClose={() => setLightboxUrl(null)} zClass="z-toast" />
        <style>{`@keyframes inv-fade-up{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}`}</style>
      </div>
    );
  }

  /* ── SEARCH VIEW ─────────────────────────────────────────────────────────── */
  const hasResults   = results !== null && results.length > 0;
  const emptyResults = results !== null && results.length === 0;

  return (
    <div className="flex flex-col gap-2.5 flex-1 min-h-0">

      {error && <p className="shrink-0 px-1 text-label text-danger-text font-medium">{error}</p>}

      {/* Results area */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">

        {/* Skeleton */}
        {loading && <><SkeletonSection rows={3} /><SkeletonSection rows={2} /></>}

        {/* Sin búsqueda: lo que falta acá y otra sala sí tiene.
            La razón real por la que se abre este widget es que alguien
            preguntó por algo que no está — así que la pantalla en blanco lo
            adelanta en vez de esperar a que se escriba. */}
        {!loading && results === null && faltantes.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1">
              Sin existencia, puedes solicitar en estas sucursales
            </p>
            {/* La fila es un div y no un botón: tiene DOS acciones —mirar el
                producto y pedirlo— y un botón adentro de otro no es HTML
                válido. El área grande sigue siendo la de buscar. */}
            {faltantes.map(f => (
              <div
                key={f.erp_product_id}
                data-surface="card"
                className="w-full flex items-center gap-2 px-3 py-2 transition-all"
              >
                <button
                  type="button"
                  onClick={() => handleInput(f.descripcion)}
                  className="flex-1 min-w-0 flex items-center gap-2 text-left"
                >
                  <PackageMinus size={13} className="text-warning-text shrink-0" strokeWidth={2.5} />
                  <span className="flex-1 min-w-0 block">
                    <span className="block text-label font-black text-content truncate leading-tight">{f.descripcion}</span>
                    <span className="block text-micro text-content-3 truncate mt-0.5">
                      {(f.donde ?? []).slice(0, 3).map(d => `${d.sala} ${d.unidades}`).join(' · ')}
                    </span>
                  </span>
                  <span className="text-micro font-black text-content-3 shrink-0 tabular-nums">min {f.min_units}</span>
                </button>
                {/* `shrink-0` y sin envolver: en la columna angosta de la
                    baldosa el botón se partía en dos líneas —ícono arriba,
                    palabra abajo— y quedaba el doble de alto que la fila. */}
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => setPedido(f)}
                  aria-label={`Pedir ${f.descripcion} a otra sala`}
                  className="shrink-0"
                >
                  Pedir
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Initial state */}
        {!loading && results === null && faltantes.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <Package size={28} strokeWidth={1.5} className="text-content-3" />
            <p className="text-label font-semibold text-content-3 text-center leading-snug">
              Busca un producto para ver<br />su stock por sucursal
            </p>
          </div>
        )}

        {/* Normal results */}
        {!loading && hasResults && (
          <BranchSections
            branches={results}
            onDrill={setDrillProduct}
            onZoom={setLightboxUrl}
            onPedir={accionPedir}
          />
        )}

        {/* Vencidos in bodega */}
        {!loading && results !== null && vencidosProds.length > 0 && (
          <div className="mt-1">
            <div className="flex items-center gap-2 mb-2 mt-1">
              <div className="h-px flex-1 bg-danger/20" />
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-danger/10 border border-danger/30 shadow-sm">
                <AlertTriangle size={9} className="text-danger-text shrink-0" strokeWidth={2.5} />
                <span className="text-caption font-black uppercase tracking-wider text-danger-text">Bodega · Área de Vencidos</span>
                <span className="w-px h-3 bg-danger/20 mx-1" />
                <span className="text-body-sm font-black tabular-nums text-danger-text">
                  {vencidosProds.reduce((s, p) => s + p.lots.reduce((ss, r) => ss + r.cantidad, 0), 0)}
                </span>
                <span className="text-micro font-semibold text-danger-text ml-0.5">uds</span>
              </div>
              <div className="h-px flex-1 bg-danger/20" />
            </div>
            <div className="space-y-2">
              {vencidosProds.map((prod, pi) => {
                const lotTotal = prod.lots.reduce((s, r) => s + r.cantidad, 0);
                return (
                  <div
                    key={prod.descripcion}
                    className="flex items-center gap-2 px-2.5 py-2.5 rounded-xl text-left"
                    style={{ background: 'color-mix(in srgb, var(--danger) 8%, transparent)', border: '1px solid var(--danger)', boxShadow: 'var(--shadow-elevation-xs)', animationDelay: `${pi * 25}ms` }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-label font-bold text-content-2 truncate leading-tight">{prod.descripcion}</p>
                      {prod.presentacion && <p className="text-micro text-content-3">{prod.presentacion}</p>}
                      {prod.lots.length > 1 && (
                        <div className="mt-1 space-y-0.5">
                          {prod.lots.map((r, li) => (
                            <div key={li} className="flex items-center gap-1.5">
                              <span className="text-micro font-mono text-content-3 truncate">{r.lote || '—'}</span>
                              <ExpiryBadge date={r.fecha_vencimiento} />
                              <span className="text-micro font-black text-danger-text tabular-nums ml-auto">{r.cantidad}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {prod.lots.length === 1 && (
                      <>
                        <span className="text-micro font-mono text-content-3 shrink-0 max-w-[55px] truncate">{prod.lots[0].lote || '—'}</span>
                        <ExpiryBadge date={prod.lots[0].fecha_vencimiento} />
                      </>
                    )}
                    <span className="text-caption font-black text-danger-text shrink-0 tabular-nums w-14 text-right">{lotTotal} uds</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* No inventory results → SRS + alternatives */}
        {!loading && emptyResults && (
          <div className="flex flex-col gap-3">

            {/* No stock banner */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-warning/10 border border-warning/30">
              <Package size={13} className="text-warning shrink-0" strokeWidth={2} />
              <p className="text-label text-warning-text font-semibold flex-1">
                Sin stock para <span className="font-black">"{query}"</span>
              </p>
            </div>

            {/* SRS loading */}
            {srsLoading && (
              <div className="flex items-center gap-2 px-1">
                <Loader2 size={11} className="text-chart-3-text animate-spin shrink-0" />
                <p className="text-caption text-content-3 font-medium">Consultando Registro SRS...</p>
              </div>
            )}

            {/* SRS results — each card has its own report button */}
            {!srsLoading && srsResults !== null && srsResults.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <SectionLabel icon={FlaskConical} label="Registro SRS" color="text-chart-3-text" bg="bg-chart-3/10" />
                {srsResults.map((p, i) => (
                  <SrsCompactCard key={p.id ?? i} product={p} searchQuery={query} user={user} />
                ))}
              </div>
            )}

            {/* Alternatives in inventory */}
            {!srsLoading && alternatives.length > 0 && (
              <div className="flex flex-col gap-1">
                <SectionLabel icon={Package} label="Alternativas en inventario" color="text-success-text" bg="bg-success/10" />
                <BranchSections
                  branches={alternatives}
                  onDrill={setDrillProduct}
                  onZoom={setLightboxUrl}
                  onPedir={accionPedir}
                  animOffset={4}
                />
              </div>
            )}

            {/* Nothing anywhere */}
            {!srsLoading && srsResults !== null && srsResults.length === 0 && alternatives.length === 0 && (
              <p className="text-center text-label text-content-3 font-medium py-4">
                Sin resultados en SRS ni alternativas en inventario
              </p>
            )}
          </div>
        )}
      </div>

      <PhotoLightbox src={lightboxUrl} alt="Foto del producto" onClose={() => setLightboxUrl(null)} zClass="z-toast" />

      {/* Se monta SOLO al pedir: si no, cada faltante de la lista traería sus
          presentaciones al abrir el widget. */}
      {pedido && (
        <PedirTrasladoModal
          producto={pedido}
          onClose={() => setPedido(null)}
          onListo={cargarFaltantes}
        />
      )}

      <style>{`@keyframes inv-fade-up{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  );
}

/* ─── La baldosa del tablero ──────────────────────────────────────────────── */
// A pedido del usuario (2026-08-06): «pasemos el buscador de productos como
// modal también como los demás, así tenemos más espacio».
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
  useEffect(() => {
    if (!miErp) { setFaltan(null); return; }
    let cancelado = false;
    fetchFaltantesConStockEnOtraSala(miErp, 40).then(r => {
      if (!cancelado && !r.error) setFaltan(r.filas.length);
    });
    return () => { cancelado = true; };
  }, [miErp]);

  return (
    <LanzadorSolicitud
      icon={Package}
      label="Consulta de Inventario"
      pendientes={faltan}
      etiquetaPendientes="sin existencia acá"
      etiquetaPendientesPlural="sin existencia acá"
      vacio="Buscar producto"
      tono="warning"
      maxWidth="max-w-3xl"
      descripcion="En qué sala hay un producto, y cómo pedirlo"
    >
      {() => (
        <>
          {/* El buscador va en el encabezado del modal —la ranura canónica—
              junto al título. El encabezado a mano que estaba acá lo pone ahora
              `LanzadorSolicitud`, con su botón de cerrar. */}
          <HerramientasModal>
            {/* `autoFocus` explícito aunque `ModalShell` ya enfoque el primer
                campo: acá el buscador vive en una RANURA por portal, así que
                monta un tick después que el panel y la regla general —que mide
                a los 60ms— podría no verlo todavía. Pedido así: «que el focus
                lo tenga el input para escribir de un solo». */}
            <SearchInput
              autoFocus
              accentColor="var(--warning)"
              value={q}
              onChange={setQ}
              placeholder="Buscar por nombre o principio activo..."
            />
          </HerramientasModal>

          {/* `min-h-0` y NO `overflow-hidden`.
              Medido el 2026-08-06: con `overflow-hidden` esta caja quedaba en
              708px con 1134 de contenido —lo recortaba y no dejaba scrollear— y
              el scroller propio del panel nunca se activaba, porque su `h-full`
              no resuelve contra un padre de alto automático y crecía hasta el
              contenido entero. Es la trampa de siempre: un hijo flex no baja de
              su contenido sin `min-h-0`, así que el scroll se va hacia arriba en
              la cadena y no lo agarra nadie. */}
          <div className="flex-1 min-h-0 flex flex-col">
            <PanelInventario query={q} onQueryChange={setQ} />
          </div>
        </>
      )}
    </LanzadorSolicitud>
  );
}
