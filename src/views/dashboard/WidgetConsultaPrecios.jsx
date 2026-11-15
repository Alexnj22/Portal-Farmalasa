import React, { useEffect, useMemo, useState } from 'react';
import { Tag, ArrowLeft, ChevronRight } from 'lucide-react';
import Button from '../../components/common/Button';
import ListRow from '../../components/common/ListRow';
import SearchInput from '../../components/common/SearchInput';
import Notice from '../../components/common/Notice';
import AvisoParecidos from '../../components/common/AvisoParecidos';
import { useAuth } from '@nucleo/context/AuthContext';
import { buscarInventarioGlobalV2 } from '@nucleo/data/inventory';
import { MIN_LETRAS_BUSQUEDA } from '@nucleo/utils/consultaInventario';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { ERP_BRANCH_MAP, BRANCH_ORDER, MI_ERP_POR_BRANCH } from './inventario/salas';
import PreciosDelProducto from './inventario/PreciosDelProducto';

// ── Consulta de precios (2026-11-15) ────────────────────────────────────────
// Widget propio y no una sección de «Consulta de inventario»: el usuario lo
// pidió aparte para no cargar uno solo con todo. Se busca un producto, se
// abre, y se eligen presentación y lote para ver los precios hasta Mayoreo
// Plus (el detalle vive en `PreciosDelProducto`).
//
// La búsqueda es la misma del inventario (`buscar_inventario_global_v2`): trae
// el producto CON sus lotes por sala en un solo viaje, que es justo lo que el
// selector de lote necesita. Un producto sin existencia en ninguna sala no
// aparece — no hay de dónde venderlo.

const TOPE = 20;

/** Las filas de la búsqueda, agrupadas por producto y luego por sala. */
function agrupar(filas) {
  const productos = new Map();
  for (const r of filas ?? []) {
    if (r.is_vencidos) continue; // de ahí no se vende
    if (!ERP_BRANCH_MAP[r.erp_sucursal_id]) continue;
    const k = r.erp_product_id;
    if (!productos.has(k)) productos.set(k, { id: k, descripcion: r.descripcion, principioActivo: r.principio_activo ?? null, porSala: new Map() });
    const p = productos.get(k);
    if (!p.porSala.has(r.erp_sucursal_id)) p.porSala.set(r.erp_sucursal_id, []);
    p.porSala.get(r.erp_sucursal_id).push(r);
  }
  return [...productos.values()].map(p => ({
    ...p,
    salas: BRANCH_ORDER.filter(id => p.porSala.has(id))
      .map(id => ({ name: ERP_BRANCH_MAP[id], erp: id, lots: p.porSala.get(id) })),
  }));
}

export default function WidgetConsultaPrecios() {
  const { user } = useAuth();
  const miErp = MI_ERP_POR_BRANCH[user?.branchId ?? user?.branch_id] ?? null;
  const [q, setQ] = useState('');
  const [filas, setFilas] = useState(null);
  const [parecidos, setParecidos] = useState(false);
  const [error, setError] = useState('');
  const [abierto, setAbierto] = useState(null);

  const buscando = q.trim().length >= MIN_LETRAS_BUSQUEDA;

  useEffect(() => {
    if (!buscando) return undefined;
    let vivo = true;
    const t = setTimeout(async () => {
      const { filas: data, error: e, aproximado } = await buscarInventarioGlobalV2(q.trim(), TOPE);
      if (!vivo) return;
      if (e) { setError(mensajeAmigable(e)); setFilas([]); return; }
      setError('');
      setFilas(data);
      setParecidos(aproximado);
    }, 350);
    return () => { vivo = false; clearTimeout(t); };
  }, [q, buscando]);

  const productos = useMemo(() => (buscando ? agrupar(filas) : null), [filas, buscando]);
  const producto = abierto != null ? productos?.find(p => p.id === abierto) ?? null : null;

  if (producto) {
    return (
      <div className="flex flex-col gap-2 h-full min-h-0 p-3 pt-1">
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="secondary" size="xs" icon={ArrowLeft} iconOnly aria-label="Volver a la búsqueda" onClick={() => setAbierto(null)} />
          <div className="flex-1 min-w-0">
            <p className="text-body-sm font-black text-content leading-tight truncate">{producto.descripcion}</p>
            {producto.principioActivo && <p className="text-micro text-content-3 truncate">{producto.principioActivo}</p>}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <PreciosDelProducto key={producto.id} erpProductId={producto.id} salas={producto.salas} miErp={miErp} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 h-full min-h-0 p-3 pt-1">
      <SearchInput value={q} onChange={setQ} placeholder="Producto o principio activo"
        ariaLabel="Buscar un producto para ver sus precios" />
      {error && <Notice variant="danger" compact>{error}</Notice>}
      {parecidos && productos?.length > 0 && <AvisoParecidos texto={q} />}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-1">
        {productos?.map(p => (
          <ListRow key={p.id} density="sm" icon={Tag}
            title={p.descripcion}
            subtitle={p.principioActivo || `${p.salas.length} ${p.salas.length === 1 ? 'sala' : 'salas'} con existencia`}
            trailing={<ChevronRight size={14} className="text-content-3" />}
            onClick={() => setAbierto(p.id)} />
        ))}
        {productos?.length === 0 && !error && filas !== null && (
          <p className="text-caption text-content-3 px-1 py-2">No hay ningún producto con existencia que diga «{q.trim()}».</p>
        )}
        {!buscando && (
          <p className="text-caption text-content-3 px-1 py-2">Busca un producto para ver sus precios por presentación.</p>
        )}
      </div>
    </div>
  );
}
