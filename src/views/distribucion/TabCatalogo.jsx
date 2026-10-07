import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Plus, PackageSearch, Search, AlertTriangle, ShieldCheck, Tag, Loader2, Save, Ban, Percent } from 'lucide-react';
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
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { usePaginaEnUrl } from '../../plataforma/usePaginaEnUrl';
import { fetchCatalogo, guardarPrecio, agregarAlCatalogo, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { buscarProductos } from '@nucleo/data/busquedaProductos';
import { filtrarCatalogo, leerFormularioDePrecio, resumenDeCatalogo } from '@nucleo/utils/distribucionComercial';
import { descuentoDelCatalogo } from './precios';
import Campo from './Campo';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import useBorrador from '@nucleo/hooks/useBorrador';
import { hoySV, fechaNumerica } from '@nucleo/utils/fecha';

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
    { key: 'precio',   label: 'Precio con IVA', align: 'right' },
    { key: 'sin_iva',  label: 'Sin IVA',    align: 'right', hideBelow: 'md' },
    { key: 'descuento', label: 'Descuento', align: 'right', hideBelow: 'sm' },
];

function PrecioModal({ item, emisorId, emisorTope, onClose, onGuardado }) {
    const nuevo = !item.product_id;
    const [producto, setProducto] = useState(null);
    const [texto, setTexto] = useState('');
    const [opciones, setOpciones] = useState([]);
    const [precio, setPrecio] = useState(nuevo ? '' : String(item.precio_con_iva));
    const [libre, setLibre] = useState(nuevo ? false : item.venta_libre);
    const [activo, setActivo] = useState(nuevo ? true : item.activo);
    // Descuento del catálogo (borrador 0029): se precarga al vender y lo da
    // cualquiera sin aprobación mientras esté vigente.
    const [descPct, setDescPct] = useState(nuevo || !Number(item.descuento_pct) ? '' : String(Number(item.descuento_pct)));
    const [descDesde, setDescDesde] = useState(nuevo ? '' : item.descuento_desde ?? '');
    const [descHasta, setDescHasta] = useState(nuevo ? '' : item.descuento_hasta ?? '');
    const [tope, setTope] = useState(nuevo || item.descuento_max_pct == null ? '' : String(Number(item.descuento_max_pct)));
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
    // ¿Con el descuento queda bajo el costo? El costo es sin IVA y por unidad
    // (0015). Las cuentas viven en el núcleo, las mismas de la app.
    const costo = nuevo ? null : Number(item.costo_promedio ?? 0) || null;
    const { precioNum, pctNum, pctMalo, topeMalo, fechasMal, finalSinIva, bajoCosto, valido, descuento } =
        leerFormularioDePrecio({ precio, descPct, tope, descDesde, descHasta, costo });
    const listo = (nuevo ? !!producto : true) && valido && !guardando;

    // Lo escrito sobrevive a que la sesión se cierre sola (gate:borradores).
    const { recuperado, descartar } = useBorrador(!nuevo ? `distribucion-precio-${emisorId}-${item.product_id}` : null,
        { precio, libre, activo, descPct, descDesde, descHasta, tope });
    const repuesto = useRef(false);
    useEffect(() => {
        if (repuesto.current || !recuperado) return;
        repuesto.current = true;
        if (recuperado.precio != null) setPrecio(recuperado.precio);
        if (recuperado.libre != null) setLibre(recuperado.libre);
        if (recuperado.activo != null) setActivo(recuperado.activo);
        setDescPct(recuperado.descPct ?? ''); setDescDesde(recuperado.descDesde ?? '');
        setDescHasta(recuperado.descHasta ?? ''); setTope(recuperado.tope ?? '');
    }, [recuperado]);

    const guardar = async () => {
        setGuardando(true);
        setError('');
        try {
            if (nuevo) {
                await agregarAlCatalogo(emisorId, producto.id, precioNum, libre && !controlado);
                if (descuento.descuento_pct || descuento.descuento_max_pct != null) await guardarPrecio(emisorId, producto.id, descuento);
            } else {
                await guardarPrecio(emisorId, item.product_id, { precio_con_iva: precioNum, venta_libre: libre && !controlado, activo, ...descuento });
            }
            useStaff.getState().appendAuditLog('DISTRIBUCION_PRECIO', String(nuevo ? producto.id : item.product_id),
                { precio_con_iva: precioNum, venta_libre: libre && !controlado, ...descuento,
                  antes: nuevo ? null : { precio_con_iva: item.precio_con_iva, descuento_pct: item.descuento_pct, descuento_max_pct: item.descuento_max_pct } });
            descartar();
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
                    <PortalInput label="Precio con IVA ($)" name="precio" inputMode="decimal" value={precio}
                        onChange={(e) => setPrecio(e.target.value)} hasError={precio !== '' && precioNum === null}
                        errorMessage="Escribe un monto, por ejemplo 1.95"
                        helperText={precioNum !== null ? `Lo que paga el cliente con Factura. En Crédito Fiscal: ${formatMoney(precioNum / 1.13)} + IVA.` : undefined} />
                    <Interruptor checked={libre && !controlado} disabled={controlado} onChange={setLibre}
                        label="Venta libre (se puede vender a tiendas y supermercados)" />
                    {controlado && (
                        <Notice variant="info" icon={Ban} compact>
                            Es antibiótico, con receta o regulado: sólo se le vende a farmacias.
                        </Notice>
                    )}
                    {!nuevo && <Interruptor checked={activo} onChange={setActivo} label="Se ofrece en los pedidos" />}
                    <fieldset className="flex flex-col gap-3 border-t border-divider pt-3" aria-label="Descuento">
                        <legend className="text-body-sm font-bold text-content pb-1">Descuento</legend>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <PortalInput label="Descuento del catálogo (%)" name="descuento_pct" inputMode="decimal" value={descPct} placeholder="0"
                                onChange={(e) => setDescPct(e.target.value)} hasError={pctMalo} errorMessage="Entre 0 y 100"
                                helperText="Entra solo al vender y no pide aprobación." />
                            <PortalInput label="Tope para dar más (%)" name="descuento_max_pct" inputMode="decimal" value={tope}
                                placeholder={`Empresa: ${Number(emisorTope ?? 0)}`} onChange={(e) => setTope(e.target.value)}
                                hasError={topeMalo} errorMessage="Entre 0 y 100"
                                helperText="Hasta ahí lo da quien tiene permiso; más, pide aprobación." />
                            {pctNum > 0 && (<>
                                <Campo label="Desde (opcional)">
                                    <LiquidDatePicker value={descDesde} onChange={(v) => setDescDesde(v || '')} />
                                </Campo>
                                <Campo label="Hasta (opcional)">
                                    <LiquidDatePicker value={descHasta} onChange={(v) => setDescHasta(v || '')} />
                                </Campo>
                            </>)}
                        </div>
                        {fechasMal && <Notice variant="danger" compact>«Desde» va antes de «Hasta».</Notice>}
                        {pctNum > 0 && finalSinIva !== null && (
                            <p className="text-caption text-content-3">
                                Con el descuento: {formatMoney(precioNum * (1 - pctNum / 100))} con IVA
                                {costo !== null ? ` · costo ${formatMoney(costo * 1.13)} con IVA` : ''}.
                            </p>
                        )}
                        {bajoCosto && (
                            <Notice variant="warning" icon={AlertTriangle} compact data-bajo-costo>
                                Con este descuento se vende bajo el costo. Se puede guardar igual (por ejemplo, para sacar un vencimiento).
                            </Notice>
                        )}
                    </fieldset>
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

    const hoy = hoySV();
    const filtrados = useMemo(() => filtrarCatalogo(items, { buscar, canal, hoy }), [items, buscar, canal, hoy]);

    const stats = useMemo(() => resumenDeCatalogo(items, hoy), [items, hoy]);

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
                    <StatCard icon={Percent} label="Con descuento" value={stats.descuento} loading={cargando} sub="Vigente hoy en el catálogo"
                        iconBg="bg-warning/10" iconCls="text-warning" active={canal === 'descuento'} tono="warning"
                        onClick={() => setCanal(v => (v === 'descuento' ? '' : 'descuento'))} />
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
                        <DataCell align="right"><span className="tabular-nums font-bold text-content-2">{formatMoney(p.precio_con_iva)}</span></DataCell>
                        <DataCell align="right" hideBelow="md"><span className="tabular-nums text-content-3">{formatMoney(p.precio_con_iva / 1.13)}</span></DataCell>
                        <DataCell align="right" hideBelow="sm">
                            {Number(p.descuento_pct) > 0 ? (
                                <span className="inline-flex flex-col items-end">
                                    <Badge size="sm" variant={descuentoDelCatalogo(p, hoy) > 0 ? 'success' : 'neutral'}>{Number(p.descuento_pct)} %</Badge>
                                    {(p.descuento_desde || p.descuento_hasta) && (
                                        <span className="text-micro text-content-3 tabular-nums">
                                            {p.descuento_desde ? fechaNumerica(p.descuento_desde) : '…'} – {p.descuento_hasta ? fechaNumerica(p.descuento_hasta) : '…'}
                                        </span>
                                    )}
                                </span>
                            ) : <span className="text-content-3">—</span>}
                        </DataCell>
                    </DataRow>
                ))}
            </DataTable>

            {!cargando && filtrados.length > 0 && (
                <TablePagination pageSize={pageSize} onPageSizeChange={setPageSize} page={page}
                    totalPages={totalPages} onPageChange={setPage} total={filtrados.length} unit="productos" />
            )}

            {abierto && (
                <PrecioModal item={abierto} emisorId={emisor?.id} emisorTope={emisor?.descuento_max_pct} onClose={() => setAbierto(null)}
                    onGuardado={() => { setAbierto(null); cargar(); }} />
            )}
        </div>
    );
}
