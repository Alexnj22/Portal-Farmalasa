import React, { useState, useEffect, Fragment } from 'react';
import { Package } from 'lucide-react';
import SearchInput from './SearchInput';
import ListRow from './ListRow';
import { SkeletonText } from './StateViews';
import { buscarInventarioGlobalV2 } from '../../data/inventory';
import { sumaUnidades } from '../../utils/unidadesInventario';

// Elegir un producto viendo QUÉ SALAS LO TIENEN, como en la consulta de
// inventario.
//
// ── Por qué existe ────────────────────────────────────────────────────────
// El modal de pedir a otra sala buscaba en el CATÁLOGO: cada resultado traía el
// principio activo y el laboratorio, y para saber dónde había producto había que
// elegirlo primero. Reportado el 2026-08-20: *«me gustaría que al darle en
// agregar y seguir, abriera el de consulta de inventario, no esa nueva forma»*.
//
// Y tiene razón más allá del gusto: quien compone una solicitud está decidiendo
// A QUIÉN pedirle. Un buscador que no dice dónde hay obliga a elegir a ciegas y
// descubrir en el paso siguiente que esa sala no lo tiene.
//
// ── Lo que este componente NO hace ────────────────────────────────────────
// **No arma el `donde` del formulario.** Las salas que muestra son para ELEGIR;
// la lista con la que después se pide —con su mínimo y su vencimiento por sala—
// la sigue contestando `fetchDondeHay`, que es del servidor. Si esto la armara,
// habría dos versiones de la misma respuesta y la de acá no tendría el mínimo:
// el aviso de «quedaría bajo su mínimo» dejaría de aparecer sin que nada falle.
//
// Tampoco reimplementa el agrupador de la consulta: aquél agrupa por SALA y
// dentro por producto, que es la forma de esa pantalla. Acá la pregunta es al
// revés —un producto, en qué salas está— y las unidades salen de `sumaUnidades`,
// que es el mismo cálculo que ya usan el modal y la consulta.
//
// El contrato de salida es el de `BuscadorDeProducto` a propósito: `{ id,
// nombre }`. Así los dos son intercambiables y quien los use no cambia.

/** El área de vencidos de Bodega no se ofrece acá: se pide desde su propia fila. */
const esEstanteNormal = (r) => !r?.is_vencidos;

/**
 * @param onElegir   Recibe `{ id, nombre }` — el mismo contrato que
 *                   `BuscadorDeProducto`, para que uno se pueda cambiar por el
 *                   otro sin tocar quien lo usa.
 * @param nombreSala De número de sucursal a nombre. Lo pone quien lo usa: el
 *                   mapa vive en la pantalla, no acá.
 */
export default function BuscadorDeInventario({
    onElegir, placeholder, invitacion, nombreSala,
    accentColor = 'var(--brand)', EnvoltorioBusqueda = Fragment,
}) {
    const [search,  setSearch]  = useState('');
    const [productos, setProductos] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const q = search.trim();
        if (q.length < 2) { setProductos([]); setLoading(false); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- limpia resultados cuando la búsqueda es muy corta
        let cancelado = false;
        setLoading(true);
        /* 380 ms, los mismos de la consulta de inventario y no los 150 del
         * buscador de catálogo: acá cada tecla trae la existencia de siete
         * salas con sus lotes, no veinte filas de texto. */
        const t = setTimeout(async () => {
            const { filas } = await buscarInventarioGlobalV2(q);
            if (cancelado) return;

            // Un producto, y en qué salas está. La clave es el PRODUCTO: la
            // misma caja llega partida en UNIDAD, BLISTER y CAJA, y las tres son
            // el mismo producto en el mismo lugar.
            const porProducto = new Map();
            for (const r of filas ?? []) {
                if (!esEstanteNormal(r)) continue;
                const id = Number(r.erp_product_id);
                if (!id) continue;
                if (!porProducto.has(id)) {
                    porProducto.set(id, { id, nombre: r.descripcion, salas: new Map() });
                }
                const p = porProducto.get(id);
                if (!p.salas.has(r.erp_sucursal_id)) p.salas.set(r.erp_sucursal_id, []);
                p.salas.get(r.erp_sucursal_id).push(r);
            }

            setProductos([...porProducto.values()].map(p => ({
                id: p.id,
                nombre: p.nombre,
                donde: [...p.salas.entries()]
                    .map(([suc, filasDeSala]) => ({
                        suc,
                        sala: nombreSala?.(suc) ?? `Sucursal ${suc}`,
                        unidades: sumaUnidades(filasDeSala),
                    }))
                    .filter(d => d.unidades > 0)
                    // De más a menos: la primera es a la que conviene pedirle.
                    .sort((a, b) => b.unidades - a.unidades),
            })));
            setLoading(false);
        }, 380);
        return () => { cancelado = true; clearTimeout(t); };
    }, [search, nombreSala]);

    const corto = search.trim().length < 2;
    const IconoInvitacion = invitacion?.icono ?? Package;

    return (
        <div className="flex flex-col gap-3 flex-1 min-h-0">
            <EnvoltorioBusqueda>
                <SearchInput accentColor={accentColor} value={search} onChange={setSearch}
                    placeholder={placeholder} />
            </EnvoltorioBusqueda>

            <div className="flex-1 overflow-y-auto overscroll-contain space-y-1.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {loading && <div className="flex justify-center py-8"><SkeletonText lines={4} className="w-full max-w-md" /></div>}

                {!loading && !corto && productos.length === 0 && (
                    <div className="py-8 text-center text-body-sm text-content-3 font-medium">
                        Ninguna sala tiene &quot;{search}&quot;
                    </div>
                )}

                {!loading && corto && (
                    <div className="flex flex-col items-center justify-center h-full gap-2 text-content-3">
                        <IconoInvitacion size={28} strokeWidth={1.5} />
                        <p className="text-body-sm font-semibold text-content-3 text-center px-4">
                            {invitacion?.texto ?? 'Busca un producto'}
                        </p>
                    </div>
                )}

                {!loading && productos.map(p => (
                    <ListRow
                        key={p.id}
                        onClick={() => onElegir({ id: p.id, nombre: p.nombre })}
                        leading={<Package size={14} className="text-content-3" strokeWidth={2} />}
                        iconBoxClass="bg-surface-card-hover border-border-card overflow-hidden"
                        className="border-divider bg-surface-card hover:border-brand/40"
                        title={p.nombre}
                    >
                        {/* Dónde hay, que es lo que se viene a mirar. Sin esto el
                            resultado obliga a elegir a ciegas y descubrir en el
                            paso siguiente que esa sala no lo tiene. */}
                        <span className="block text-micro text-content-2 font-semibold truncate">
                            {p.donde.length === 0
                                ? 'Sin existencia en ninguna sala'
                                : p.donde.map(d => `${d.sala} (${d.unidades})`).join(' · ')}
                        </span>
                    </ListRow>
                ))}
            </div>
        </div>
    );
}
