import React, { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { Archive, Truck, Send, Download, PackageCheck, Package, Boxes, DollarSign } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import FilterBar from '../../components/common/FilterBar';
import { EmptyState } from '../../components/common/StateViews';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { insertMinMaxChangeRequest } from '../../data/minmaxRequests';
import { smartFilter } from '../../utils/searchUtils';
import { formatMoney } from '../../utils/formatNumber';
import { exportCsv } from '../../utils/csvExport';
import { porQueDesde } from '../../utils/productosParados';
import { ERP_NAMES, ERP_ORDER, ERP_BODEGA, MI_ERP_POR_BRANCH, SUC_VARIANTE } from './salasDeStock';

const EnviarProductoModal = lazy(() => import('../dashboard/EnviarProductoModal'));

/** Lo que admite un envío (`TOPE_RENGLONES_ENVIO`): lo que sobra va en el siguiente. */
const POR_ENVIO = 20;
/** Filas a la vista por destino; el resto detrás de «Ver los N». */
const VISIBLES = 8;

const fechaLarga = (iso) => iso
    ? new Date(`${iso}T12:00:00`).toLocaleDateString('es-SV', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;
const unidades = (n) => `${Number(n || 0).toLocaleString('es-SV')} ${Number(n) === 1 ? 'unidad' : 'unidades'}`;

const COLUMNAS = [
    { key: 'producto',   label: 'Producto' },
    { key: 'existencia', label: 'Unidades', align: 'right' },
    { key: 'costo',      label: 'Costo', align: 'right', hideBelow: 'sm' },
    { key: 'desde',      label: 'Sin venta desde', hideBelow: 'md' },
    { key: 'vendido',    label: 'Se vende en (6 meses)', hideBelow: 'md' },
    { key: 'minmax',     label: 'Min / Max', align: 'center', hideBelow: 'lg' },
];

/* Dónde se vende. La sala destino primero y resaltada —es la razón del
 * grupo—; las demás detrás, en gris, como contexto. */
function VendidoEn({ fila, destino }) {
    const otras = Array.isArray(fila.vendido_en) ? fila.vendido_en : [];
    if (otras.length === 0) return <span className="text-label text-content-3">En ninguna sala</span>;
    return (
        <div className="flex items-center gap-1.5 flex-wrap">
            {otras.slice(0, 3).map(v => (
                <Badge key={v.esid} size="sm" uppercase={false}
                    variant={Number(v.esid) === Number(destino) ? (SUC_VARIANTE[v.esid] || 'info') : 'neutral'}>
                    {ERP_NAMES[v.esid] || `Suc.${v.esid}`}
                    <span className="opacity-50 font-normal">·</span>
                    <span className="tabular-nums">{Number(v.unidades).toLocaleString('es-SV')}</span>
                </Badge>
            ))}
            {otras.length > 3 && <span className="text-caption text-content-3">+{otras.length - 3}</span>}
        </div>
    );
}

/**
 * Productos sin venta — lo que lleva seis meses sin venderse en una sala, ya
 * agrupado por ADÓNDE mandarlo.
 *
 * El agrupado es la decisión de diseño: la pregunta de quien abre esta
 * pestaña no es «qué está parado» sino «qué hago con esto», y la respuesta
 * tiene la forma de un envío por destino. Por eso cada grupo lleva su propio
 * «Armar envío», y la columna «Sugerencia» de la versión anterior desapareció:
 * era el mismo dato repetido en cada fila.
 *
 * El juez es `productos_parados_de_sala`, el mismo del aviso semanal: los dos
 * no pueden contestar distinto.
 */
export default function TabParados({ sala, onSala, searchTerm = '' }) {
    const { user, getScope } = useAuth();
    const [filas, setFilas] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(null);
    const [filtro, setFiltro] = useState('todos');   // 'todos' | 'minmax'
    const [haciaDonde, setHaciaDonde] = useState(null); // null | 'sala' | 'bodega' (las tarjetas)
    const [abiertos, setAbiertos] = useState(() => new Set());
    const [envio, setEnvio] = useState(null);        // { destino, productos }
    const [avisoEnvio, setAvisoEnvio] = useState(null);
    const pedido = useRef(0);

    /* La consulta devuelve un resultado y el estado se escribe DESPUÉS, en el
     * `.then`: el efecto que la dispara no escribe estado a mano (la primera
     * carga ya nace en «cargando»). Cambiar de sala remonta la pestaña
     * (`key={sala}` en la vista), así que no hay nada que limpiar. */
    const pedir = useCallback(() => {
        const id = ++pedido.current;
        return supabase.rpc('productos_parados_de_sala', { p_erp_sucursal_id: sala }).then(({ data, error: e }) => {
            if (id !== pedido.current) return;
            if (e) setError(e.message);
            else setFilas(Array.isArray(data) ? data : []);
            setCargando(false);
        });
    }, [sala]);
    const cargar = useCallback(() => { setError(null); setCargando(true); pedir(); }, [pedir]);

    useEffect(() => { pedir(); }, [pedir]);

    const visibles = useMemo(() => {
        let rows = filtro === 'minmax' ? filas.filter(r => r.en_minmax) : filas;
        if (haciaDonde === 'sala')   rows = rows.filter(r => Number(r.destino) !== ERP_BODEGA);
        if (haciaDonde === 'bodega') rows = rows.filter(r => Number(r.destino) === ERP_BODEGA);
        if (searchTerm) rows = smartFilter(searchTerm, rows, r => [r.producto, r.laboratorio]).results;
        return rows;
    }, [filas, filtro, haciaDonde, searchTerm]);

    /* Un grupo por destino: las salas primero, de la que más productos recibe a
     * la que menos, y Bodega al final — es el destino de «ninguna lo quiere». */
    const grupos = useMemo(() => {
        const m = new Map();
        for (const r of visibles) {
            const d = Number(r.destino);
            if (!m.has(d)) m.set(d, []);
            m.get(d).push(r);
        }
        return [...m.entries()]
            .map(([destino, rows]) => ({
                destino,
                filas: rows,   // ya vienen de la base por costo, de mayor a menor
                costo: rows.reduce((s, r) => s + Number(r.costo || 0), 0),
                unidades: rows.reduce((s, r) => s + Number(r.existencia || 0), 0),
            }))
            .sort((a, b) => (a.destino === ERP_BODEGA) - (b.destino === ERP_BODEGA) || b.filas.length - a.filas.length);
    }, [visibles]);

    const totales = useMemo(() => ({
        productos: visibles.length,
        unidades: visibles.reduce((s, r) => s + Number(r.existencia || 0), 0),
        costo: visibles.reduce((s, r) => s + Number(r.costo || 0), 0),
        conMinmax: filas.filter(r => r.en_minmax).length,
        aSala: filas.filter(r => Number(r.destino) !== ERP_BODEGA).length,
        aBodega: filas.filter(r => Number(r.destino) === ERP_BODEGA).length,
    }), [visibles, filas]);
    const veCostos = filas.some(r => r.costo != null);

    const miErp = MI_ERP_POR_BRANCH[user?.branchId ?? user?.branch_id] ?? null;
    const puedeArmar = getScope('traslados') === 'ALL' || Number(miErp) === Number(sala);

    /* Lo que salió deja de estar en el MIN·MAX de esta sala — por SOLICITUD, no
     * directo: un cambio de MIN·MAX lo aprueba otra persona (usuario, 24-sep).
     * Sólo para los que tenían MIN·MAX: pedir 0/0 donde no hay nada es ruido. */
    const alEnviar = useCallback(async ({ enviados = [], destino } = {}) => {
        const porId = new Map(filas.map(r => [Number(r.erp_product_id), r]));
        const conMinMax = enviados.map(e => porId.get(Number(e.erp_product_id))).filter(r => r?.en_minmax);
        const nombre = ERP_NAMES[destino] || 'otra sala';
        const fallidas = [];
        for (const r of conMinMax) {
            const { error: e } = await insertMinMaxChangeRequest({
                erp_product_id:       Number(r.erp_product_id),
                erp_sucursal_id:      Number(sala),
                product_name:         r.producto,
                current_min:          r.min_qty ?? null,
                current_max:          r.max_qty ?? null,
                current_sales_6m:     0,
                current_ultima_venta: r.ultima_venta ?? null,
                current_existencia:   Number(r.existencia) || 0,
                requested_min:        0,
                requested_max:        0,
                reason: `Se envió a ${nombre} por baja rotación: sin venta en esta sala desde `
                      + `${r.desde ?? 'hace más de 6 meses'} (${porQueDesde(r)}).`,
                requested_by:      user?.email ?? '',
                requested_by_id:   user?.id ?? null,
                requested_by_name: user?.name ?? null,
            });
            if (e) fallidas.push(r.producto);
        }
        setAvisoEnvio(conMinMax.length === 0 ? null : fallidas.length
            ? { variant: 'warning', texto: `El envío salió, pero no se pudo pedir el cambio de Min/Max de: ${fallidas.join(', ')}. Pídelo a mano.` }
            : { variant: 'success', texto: `Se pidió quitar el Min/Max de ${conMinMax.length} ${conMinMax.length === 1 ? 'producto' : 'productos'}; lo aprueba quien aprueba los ajustes de Min/Max.` });
        useStaff.getState().appendAuditLog('ENVIO_SUGERIDO_SIN_VENTA', null, {
            sucursal: ERP_NAMES[sala], destino: nombre,
            enviados: enviados.length, minmax_pedidos: conMinMax.length - fallidas.length,
        });
        cargar();
    }, [filas, sala, user, cargar]);

    const exportar = useCallback(() => {
        const suc = ERP_NAMES[sala] || `Suc.${sala}`;
        const dia = (f) => f ? new Date(`${f}T12:00:00`).toLocaleDateString('es-SV', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
        const headers = ['Sucursal', 'Enviar a', 'Producto', 'Laboratorio', 'Unidades', 'Costo',
                         'Cuenta desde', 'Por qué esa fecha', 'Días', 'Vendidas allá (6m)', 'Min', 'Max'];
        const rows = grupos.flatMap(g => g.filas.map(r => [
            suc, ERP_NAMES[g.destino] || '', r.producto || '', r.laboratorio || '',
            Number(r.existencia) || 0, (Number(r.costo) || 0).toFixed(2),
            dia(r.desde), porQueDesde(r), r.dias ?? '',
            r.destino_unidades != null ? Number(r.destino_unidades) : '',
            r.en_minmax && r.min_qty != null ? Number(r.min_qty) : '',
            r.en_minmax && r.max_qty != null ? Number(r.max_qty) : '',
        ]));
        const hoy = new Date().toISOString().slice(0, 10);
        exportCsv(headers, rows, `productos_parados_${suc.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${hoy}.csv`, 'inventario_sin_venta');
        useStaff.getState().appendAuditLog('EXPORT_SIN_VENTA', null, {
            vista: 'parados', sucursal: suc, filtro, busqueda: searchTerm || null, count: rows.length,
        });
    }, [grupos, sala, filtro, searchTerm]);

    const armar = (g) => {
        setAvisoEnvio(null);
        setEnvio({
            destino: g.destino,
            productos: g.filas.slice(0, POR_ENVIO).map(r => ({ erp_product_id: r.erp_product_id, descripcion: r.producto })),
        });
    };

    const alternar = (destino) => setAbiertos(prev => {
        const s = new Set(prev);
        if (s.has(destino)) s.delete(destino); else s.add(destino);
        return s;
    });

    const nombreSala = ERP_NAMES[sala] || `Sucursal ${sala}`;

    return (
        <div className="px-4 lg:px-5 py-4 flex flex-col gap-5">
            {/* §17.0 — el carril y la píldora en UNA fila. Las dos últimas
                tarjetas filtran: son las dos respuestas a «¿adónde va?». */}
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen de productos sin venta">
                    <StatCard icon={Package} iconBg="bg-warning/10" iconCls="text-warning-text"
                        label="Sin venta" value={totales.productos.toLocaleString('es-SV')}
                        sub="productos · 6 meses" loading={cargando && filas.length === 0} />
                    <StatCard icon={Boxes} label="Unidades" value={totales.unidades.toLocaleString('es-SV')}
                        sub="en existencia" loading={cargando && filas.length === 0} />
                    {veCostos && (
                        <StatCard icon={DollarSign} iconBg="bg-chart-4/10" iconCls="text-chart-4-text"
                            label="Costo detenido" value={formatMoney(totales.costo)} valueCls="text-chart-4-text"
                            sub="lo que vale lo que no se mueve" loading={cargando && filas.length === 0} />
                    )}
                    <StatCard icon={Truck} iconBg="bg-brand/10" iconCls="text-brand-text"
                        label="A otra sala" value={totales.aSala.toLocaleString('es-SV')}
                        sub="allá sí se venden" tono="brand"
                        active={haciaDonde === 'sala'} onClick={() => setHaciaDonde(v => (v === 'sala' ? null : 'sala'))}
                        loading={cargando && filas.length === 0} />
                    <StatCard icon={Archive} label="A Bodega" value={totales.aBodega.toLocaleString('es-SV')}
                        sub="no se venden en ninguna"
                        active={haciaDonde === 'bodega'} onClick={() => setHaciaDonde(v => (v === 'bodega' ? null : 'bodega'))}
                        loading={cargando && filas.length === 0} />
                </CarrilCards>

                <div className="flex justify-end min-w-0">
                    <FilterBar
                        acciones={[{
                            key: 'descargar', icon: Download, label: 'Descargar', rotulo: 'Descarga', soloIcono: true,
                            disabled: cargando || visibles.length === 0, onClick: exportar,
                        }]}
                    >
                        <FilterBar.Section label="mostrar">
                            <FilterBar.Opciones
                                label="Qué productos se ven"
                                value={filtro}
                                onChange={setFiltro}
                                options={[
                                    { value: 'todos', label: 'Todos' },
                                    { value: 'minmax', label: `Con Min/Max · ${totales.conMinmax}` },
                                ]}
                            />
                        </FilterBar.Section>
                        <FilterBar.Section label="sucursal">
                            <FilterBar.Sucursal
                                value={String(sala)}
                                onChange={v => onSala(Number(v))}
                                options={ERP_ORDER.filter(id => id !== ERP_BODEGA).map(id => ({ value: String(id), label: ERP_NAMES[id] }))}
                            />
                        </FilterBar.Section>
                    </FilterBar>
                </div>
            </div>

            {error && (
                <Notice variant="danger" action={<Button variant="ghost" onClick={cargar}>Reintentar</Button>}>
                    No se pudo cargar la lista: {error}
                </Notice>
            )}
            {avisoEnvio && <Notice variant={avisoEnvio.variant}>{avisoEnvio.texto}</Notice>}
            {!puedeArmar && !cargando && grupos.length > 0 && (
                <Notice variant="neutral" compact>
                    Estás viendo {nombreSala}. Los envíos los arma quien trabaja en esa sala.
                </Notice>
            )}

            {cargando && filas.length === 0 && (
                <DataTable columns={COLUMNAS} loading skeletonRows={6} minWidth="720px" />
            )}

            {!cargando && !error && grupos.length === 0 && (
                <EmptyState
                    icon={PackageCheck}
                    title={searchTerm || filtro !== 'todos' || haciaDonde ? 'Nada con ese filtro' : `Todo se vende en ${nombreSala}`}
                    subtitle={searchTerm || filtro !== 'todos' || haciaDonde
                        ? 'Prueba quitando la búsqueda o mostrando todos.'
                        : 'Todo lo que hay en existencia se vendió en los últimos 6 meses, o llegó hace menos.'}
                />
            )}

            {grupos.map(g => {
                const esBodega = g.destino === ERP_BODEGA;
                const abierto = abiertos.has(g.destino);
                const lista = abierto ? g.filas : g.filas.slice(0, VISIBLES);
                const nombre = ERP_NAMES[g.destino] || `Suc.${g.destino}`;
                return (
                    <section key={g.destino} aria-label={`Para ${nombre}`} className="flex flex-col gap-2.5">
                        <header className="flex items-center gap-3 flex-wrap">
                            <span aria-hidden="true"
                                className={`w-9 h-9 rounded-xl grid place-items-center flex-shrink-0
                                    ${esBodega ? 'bg-surface-card-hover text-content-2' : 'bg-brand/10 text-brand-text'}`}>
                                {esBodega ? <Archive size={16} /> : <Truck size={16} />}
                            </span>
                            <div className="min-w-0 flex-1">
                                <h3 className="text-title font-black text-content leading-tight">
                                    {esBodega ? 'A Bodega' : `A ${nombre}`}
                                </h3>
                                <p className="text-label text-content-3 leading-snug">
                                    {g.filas.length} {g.filas.length === 1 ? 'producto' : 'productos'} · {unidades(g.unidades)}
                                    {veCostos && ` · ${formatMoney(g.costo)}`}
                                    {esBodega && ' · ninguna sala vendió 3 o más en 6 meses'}
                                </p>
                            </div>
                            {puedeArmar && (
                                <Button icon={Send} variant={esBodega ? 'secondary' : 'primary'} onClick={() => armar(g)}>
                                    Armar envío{g.filas.length > POR_ENVIO ? ` · ${POR_ENVIO} de ${g.filas.length}` : ''}
                                </Button>
                            )}
                        </header>

                        <DataTable columns={COLUMNAS} minWidth="720px">
                            {lista.map(r => (
                                <DataRow key={r.erp_product_id} index={r.erp_product_id}>
                                    <DataCell>
                                        <span className="text-body font-semibold text-content block leading-snug break-words">{r.producto}</span>
                                        <span className="text-caption text-content-3">{r.laboratorio}</span>
                                    </DataCell>
                                    <DataCell align="right">
                                        <span className="text-body font-bold text-content-2 tabular-nums">{Number(r.existencia).toLocaleString('es-SV')}</span>
                                        <span className="text-caption text-content-3 ml-1">und.</span>
                                    </DataCell>
                                    <DataCell align="right" hideBelow="sm">
                                        {r.costo != null
                                            ? <span className="text-body-sm font-bold text-content-2 tabular-nums">{formatMoney(r.costo)}</span>
                                            : <span className="text-label text-content-3">—</span>}
                                    </DataCell>
                                    <DataCell hideBelow="md">
                                        {r.desde ? (
                                            <>
                                                <span className={`text-label font-semibold tabular-nums ${Number(r.dias) > 365 ? 'text-danger-text' : 'text-content-2'}`}>
                                                    {fechaLarga(r.desde)}
                                                </span>
                                                <span className="block text-micro text-content-3 whitespace-nowrap">{porQueDesde(r)} · {r.dias} días</span>
                                            </>
                                        ) : (
                                            <span className="text-caption text-content-3 italic">Sin venta ni entrada registrada</span>
                                        )}
                                    </DataCell>
                                    <DataCell hideBelow="md">
                                        <VendidoEn fila={r} destino={g.destino} />
                                    </DataCell>
                                    <DataCell align="center" hideBelow="lg">
                                        {r.en_minmax
                                            ? <span className="text-label font-mono tabular-nums text-content-2">{Number(r.min_qty ?? 0)} / {Number(r.max_qty ?? 0)}</span>
                                            : <span className="text-label text-content-3">—</span>}
                                    </DataCell>
                                </DataRow>
                            ))}
                        </DataTable>

                        {g.filas.length > VISIBLES && (
                            <Button variant="ghost" size="sm" className="self-start" onClick={() => alternar(g.destino)}>
                                {abierto ? 'Ver menos' : `Ver los ${g.filas.length}`}
                            </Button>
                        )}
                    </section>
                );
            })}

            {envio && (
                <Suspense fallback={null}>
                    <EnviarProductoModal
                        precarga={{
                            origenErp: sala,
                            destino: envio.destino,
                            motivo: 'Baja rotación',
                            // El «por qué» es obligatorio en el envío y es el mismo para
                            // todos: se deja escrito, y la sala lo puede cambiar.
                            nota: envio.destino === ERP_BODEGA
                                ? `Seis meses sin venderse en ${nombreSala}, y ninguna sala vendió 3 o más.`
                                : `Seis meses sin venderse en ${nombreSala}; en ${ERP_NAMES[envio.destino]} sí se vende.`,
                            productos: envio.productos,
                        }}
                        onClose={() => setEnvio(null)}
                        onListo={alEnviar}
                    />
                </Suspense>
            )}
        </div>
    );
}
