import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Plus, PackageSearch, Search, AlertTriangle, ShieldCheck, Tag, Loader2, Save, Ban } from 'lucide-react';
import FilterBar from '../../components/common/FilterBar';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import Button from '../../components/common/Button';
import Interruptor from './Interruptor';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalInput from '../../components/common/PortalInput';
import TablePagination from '../../components/common/TablePagination';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { useTextoRebotado } from '../../hooks/useBusqueda';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { tokenMatch } from '../../utils/searchUtils';
import { formatMoney } from '../../utils/formatNumber';
import { usePaginaEnUrl } from '../../plataforma/usePaginaEnUrl';
import { fetchCatalogo, guardarPrecio, agregarAlCatalogo, mensajeDeDistribucion } from '../../data/distribucion';
import { buscarProductos } from '../../data/busquedaProductos';
import { leerMonto } from './comun';

// El catálogo de distribución: a qué precio se vende cada producto y si puede
// ir a una tienda.
//
// «Venta libre» es una casilla que marca una PERSONA contra el listado de
// venta sin receta de la SRS (acuerdo SI.2026.02.06-01): el portal no tiene
// ese listado cargado, así que no puede marcarla solo. Lo que sí sabe es lo que
// NUNCA puede ir a una tienda —antibiótico, con receta o regulado—, y eso la
// base lo bloquea aunque alguien marque la casilla por error. La columna
// «Controlado» lo muestra para que nadie se confunda.

const COLS = [
    { key: 'producto', label: 'Producto',   align: 'left', className: 'w-[260px]' },
    { key: 'canal',    label: 'Se vende a', align: 'left' },
    { key: 'precio',   label: 'Precio sin IVA', align: 'right' },
    { key: 'con_iva',  label: 'Con IVA',    align: 'right', hideBelow: 'md' },
];

function PrecioModal({ item, emisorId, onClose, onGuardado }) {
    const nuevo = !item.product_id;
    const [producto, setProducto] = useState(null);
    const [texto, setTexto] = useState('');
    const [opciones, setOpciones] = useState([]);
    const [precio, setPrecio] = useState(nuevo ? '' : String(item.precio_sin_iva));
    const [libre, setLibre] = useState(nuevo ? false : item.venta_libre);
    const [activo, setActivo] = useState(nuevo ? true : item.activo);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState('');
    const buscado = useTextoRebotado(texto);

    useEffect(() => {
        if (!nuevo || buscado.trim().length < 2) { setOpciones([]); return; }
        let vivo = true;
        buscarProductos(buscado, { select: 'id, nombre, es_antibiotico, requiere_receta, regulado', limite: 30 })
            .then(({ data, error: e }) => {
                if (!vivo) return;
                if (e) { setError('No se pudo buscar el producto.'); return; }
                setOpciones(data ?? []);
            });
        return () => { vivo = false; };
    }, [buscado, nuevo]);

    const controlado = nuevo
        ? !!(producto && (producto.es_antibiotico || producto.requiere_receta || producto.regulado))
        : item.controlado;
    const precioNum = leerMonto(precio);
    const listo = (nuevo ? !!producto : true) && precioNum !== null && !guardando;

    const guardar = async () => {
        setGuardando(true);
        setError('');
        try {
            if (nuevo) await agregarAlCatalogo(emisorId, producto.id, precioNum, libre && !controlado);
            else await guardarPrecio(emisorId, item.product_id, { precio_sin_iva: precioNum, venta_libre: libre && !controlado, activo });
            useStaff.getState().appendAuditLog('DISTRIBUCION_PRECIO', String(nuevo ? producto.id : item.product_id),
                { precio_sin_iva: precioNum, venta_libre: libre && !controlado, antes: nuevo ? null : item.precio_sin_iva });
            onGuardado();
        } catch (e) {
            setError(mensajeDeDistribucion(e));
        } finally {
            setGuardando(false);
        }
    };

    return (
        <LiquidModal open onClose={guardando ? undefined : onClose} maxWidth="max-w-lg" ariaLabel="Precio de distribución">
            <LiquidModal.Header>
                <div className="flex items-center gap-2.5 min-w-0">
                    <Tag size={18} className="text-brand-text shrink-0" />
                    <h2 className="text-title font-black text-content truncate">{nuevo ? 'Agregar producto' : item.nombre}</h2>
                </div>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="flex flex-col gap-4">
                    {error && <Notice variant="danger" bloque>{error}</Notice>}
                    {nuevo && (<>
                        <PortalInput label="Buscar producto" name="buscar" value={texto} onChange={(e) => setTexto(e.target.value)}
                            placeholder="Nombre, principio activo o código de barras" />
                        <LiquidSelect value={producto ? String(producto.id) : ''} placeholder={opciones.length ? 'Elegir…' : 'Escribe al menos dos letras'}
                            options={opciones.map(p => ({ value: String(p.id), label: p.nombre }))}
                            onChange={(v) => setProducto(opciones.find(p => String(p.id) === v) ?? null)} disabled={!opciones.length} />
                    </>)}
                    <PortalInput label="Precio sin IVA ($)" name="precio" inputMode="decimal" value={precio}
                        onChange={(e) => setPrecio(e.target.value)} hasError={precio !== '' && precioNum === null}
                        errorMessage="Escribe un monto, por ejemplo 1.95"
                        helperText={precioNum !== null ? `Con IVA: ${formatMoney(precioNum * 1.13)}` : undefined} />
                    <Interruptor checked={libre && !controlado} disabled={controlado} onChange={setLibre}
                        label="Venta libre (se puede vender a tiendas y supermercados)" />
                    {controlado && (
                        <Notice variant="info" icon={Ban} compact>
                            Es antibiótico, con receta o regulado: sólo se le vende a farmacias.
                        </Notice>
                    )}
                    {!nuevo && <Interruptor checked={activo} onChange={setActivo} label="Se ofrece en los pedidos" />}
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <div className="flex items-center justify-end gap-2 w-full">
                    <Button variant="ghost" onClick={onClose} disabled={guardando}>Cancelar</Button>
                    <Button variant="primary" icon={guardando ? Loader2 : Save} disabled={!listo} onClick={guardar}>Guardar</Button>
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

export default function TabCatalogo({ emisor, puedeConfigurar, buscar }) {
    const [items, setItems] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');
    const [canal, setCanal] = useState('');
    const [abierto, setAbierto] = useState(null);
    const pedidoRef = useRef(0);

    const cargar = useCallback(async () => {
        const mio = ++pedidoRef.current;
        setCargando(true);
        setError('');
        try {
            const r = await fetchCatalogo();
            if (mio === pedidoRef.current) setItems(r);
        } catch (e) {
            if (mio !== pedidoRef.current) return;
            console.error('TabCatalogo', e);
            setError('No se pudo cargar el catálogo. Revisa la conexión e intenta de nuevo.');
        } finally {
            if (mio === pedidoRef.current) setCargando(false);
        }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const filtrados = useMemo(() => {
        const q = buscar.trim();
        return items.filter(p => (!q || tokenMatch(q, p.nombre))
            && (!canal || (canal === 'libre' ? p.venta_libre && !p.controlado : canal === 'farmacia' ? !p.venta_libre || p.controlado : !p.activo)));
    }, [items, buscar, canal]);

    const stats = useMemo(() => ({
        total: items.filter(p => p.activo).length,
        libre: items.filter(p => p.activo && p.venta_libre && !p.controlado).length,
        farmacia: items.filter(p => p.activo && (!p.venta_libre || p.controlado)).length,
    }), [items]);

    const { page, pageSize, totalPages, setPage, setPageSize } = usePaginaEnUrl({ total: filtrados.length });
    useEffect(() => { setPage(1); }, [buscar, canal]); // eslint-disable-line react-hooks/exhaustive-deps
    const pagina = filtrados.slice((page - 1) * pageSize, page * pageSize);

    const acciones = puedeConfigurar && emisor
        ? [{ key: 'agregar', icon: Plus, label: 'Agregar producto', variant: 'primary', onClick: () => setAbierto({}) }]
        : [];

    return (
        <div className="p-5 md:p-6 space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen del catálogo">
                    <StatCard icon={PackageSearch} label="En catálogo" value={stats.total} loading={cargando} sub="Se ofrecen en los pedidos" />
                    <StatCard icon={ShieldCheck} label="Venta libre" value={stats.libre} loading={cargando}
                        iconBg="bg-success/10" iconCls="text-success" sub="Tiendas y supermercados"
                        active={canal === 'libre'} tono="success" onClick={() => setCanal(v => (v === 'libre' ? '' : 'libre'))} />
                    <StatCard icon={Ban} label="Sólo farmacias" value={stats.farmacia} loading={cargando} sub="Con receta, regulado o sin marcar"
                        active={canal === 'farmacia'} tono="brand" onClick={() => setCanal(v => (v === 'farmacia' ? '' : 'farmacia'))} />
                </CarrilCards>
                <FilterBar onClear={() => setCanal('')} activeCount={canal ? 1 : 0} acciones={acciones}>
                    <FilterBar.Chip active={canal === 'inactivo'} onToggle={() => setCanal(v => (v === 'inactivo' ? '' : 'inactivo'))} tone="brand">
                        Fuera de los pedidos
                    </FilterBar.Chip>
                </FilterBar>
            </div>

            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}

            <DataTable
                columns={COLS}
                movil={puedeConfigurar ? { usarAccionDeFila: true } : undefined}
                loading={cargando}
                minWidth="320px"
                empty={buscar || canal
                    ? { icon: Search, message: 'Sin resultados', subtext: 'Ningún producto coincide con la búsqueda o el filtro.' }
                    : { icon: PackageSearch, message: 'Catálogo vacío', subtext: puedeConfigurar ? 'Agrega productos con «Agregar producto».' : undefined }}
            >
                {pagina.map((p, i) => (
                    <DataRow key={p.product_id} index={i} onClick={puedeConfigurar ? () => setAbierto(p) : undefined}>
                        <DataCell>
                            <div className="min-w-0 max-w-[240px]">
                                <p className="text-body-sm font-bold text-content-2 truncate" title={p.nombre}>{p.nombre}</p>
                                {!p.activo && <p className="text-caption text-content-3">Fuera de los pedidos</p>}
                            </div>
                        </DataCell>
                        <DataCell>
                            {p.controlado
                                ? <Badge size="sm" variant="neutral">Sólo farmacias · controlado</Badge>
                                : p.venta_libre
                                    ? <Badge size="sm" variant="success">Venta libre</Badge>
                                    : <Badge size="sm" variant="neutral">Sólo farmacias</Badge>}
                        </DataCell>
                        <DataCell align="right"><span className="tabular-nums font-bold text-content-2">{formatMoney(p.precio_sin_iva)}</span></DataCell>
                        <DataCell align="right" hideBelow="md"><span className="tabular-nums text-content-3">{formatMoney(p.precio_sin_iva * 1.13)}</span></DataCell>
                    </DataRow>
                ))}
            </DataTable>

            {!cargando && filtrados.length > 0 && (
                <TablePagination pageSize={pageSize} onPageSizeChange={setPageSize} page={page}
                    totalPages={totalPages} onPageChange={setPage} total={filtrados.length} unit="productos" />
            )}

            {abierto && (
                <PrecioModal item={abierto} emisorId={emisor?.id} onClose={() => setAbierto(null)}
                    onGuardado={() => { setAbierto(null); cargar(); }} />
            )}
        </div>
    );
}
