import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Warehouse, Search, Loader2, PackageX } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import PortalInput from '../../components/common/PortalInput';
import Badge from '../../components/common/Badge';
import { buscarInventarioGlobalV2 } from '@nucleo/data/inventory';
import { ERP_NAMES, ERP_ORDEN } from '@nucleo/constants/erp';
import { formatQty } from '@nucleo/utils/formatNumber';

// «¿Hay en alguna sala?» — la existencia de un producto en TODAS las
// sucursales (las siete, Bodega incluida), sin salir de la venta. Pedido del
// usuario: una tecla para buscar en todas las sucursales, como en la caja. Es
// F7 en la venta.
//
// Sale de `buscar_inventario_global_v2`, la misma búsqueda del Panel de
// inventario del portal: una fila por sala, lote y presentación, que acá se
// suma por producto y sala. Sólo lectura.

export default function ExistenciasSucursales({ terminoInicial = '', onClose }) {
    const [termino, setTermino] = useState(terminoInicial);
    const [filas, setFilas] = useState(null);
    const [total, setTotal] = useState(0);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState('');
    const pedido = useRef(0);

    useEffect(() => {
        const q = termino.trim();
        if (q.length < 2) return undefined;
        const mio = ++pedido.current;
        const t = setTimeout(async () => {
            setCargando(true);
            setError('');
            const r = await buscarInventarioGlobalV2(q, 30);
            if (mio !== pedido.current) return;
            setCargando(false);
            if (r.error) { setError('No se pudo buscar. Revisa la conexión e intenta de nuevo.'); return; }
            setFilas(r.filas);
            setTotal(r.total);
        }, 300);
        return () => clearTimeout(t);
    }, [termino]);

    // producto → sala → unidades (una fila por lote y presentación: se suma).
    const productos = useMemo(() => {
        const m = new Map();
        for (const f of filas ?? []) {
            if (f.is_vencidos) continue;
            const k = f.erp_product_id;
            if (!m.has(k)) m.set(k, { id: k, nombre: f.descripcion, salas: new Map() });
            const salas = m.get(k).salas;
            const unidades = Number(f.cantidad || 0) * Number(f.factor || 1);
            salas.set(f.erp_sucursal_id, (salas.get(f.erp_sucursal_id) ?? 0) + unidades);
        }
        return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
    }, [filas]);

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-2xl" ariaLabel="Existencias en todas las sucursales">
            <LiquidModal.Header>
                <div className="flex items-center gap-2.5 min-w-0">
                    <Warehouse size={18} className="text-brand-text shrink-0" />
                    <h2 className="text-title font-black text-content">Existencias en todas las sucursales</h2>
                </div>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="flex flex-col gap-3">
                    <PortalInput icon={cargando ? Loader2 : Search} name="buscar-existencias" value={termino} autoFocus
                        placeholder="Producto (nombre o código)…" aria-label="Buscar en todas las sucursales"
                        onChange={(e) => setTermino(e.target.value)} />
                    {error && <p className="text-caption text-danger-text">{error}</p>}
                    {termino.trim().length < 2 && <p className="text-caption text-content-3">Escribe al menos dos letras.</p>}
                    {filas && termino.trim().length >= 2 && productos.length === 0 && !cargando && (
                        <p className="text-caption text-content-3 flex items-center gap-2"><PackageX size={14} /> Ninguna sucursal tiene ese producto.</p>
                    )}
                    <div className="flex flex-col gap-2">
                        {productos.map(p => (
                            <div key={p.id} className="rounded-xl border border-divider p-3">
                                <p className="text-body-sm font-bold text-content-2 mb-2">{p.nombre}</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {ERP_ORDEN.map(s => {
                                        const n = p.salas.get(s) ?? 0;
                                        return (
                                            <Badge key={s} size="sm" variant={n > 0 ? 'success' : 'neutral'} uppercase={false}>
                                                {ERP_NAMES[s]}: {formatQty(n)}
                                            </Badge>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                    {total > productos.length && productos.length > 0 && (
                        <p className="text-caption text-content-3">Se muestran {productos.length} de {total}: escribe más para acotar.</p>
                    )}
                </div>
            </LiquidModal.Body>
        </LiquidModal>
    );
}
