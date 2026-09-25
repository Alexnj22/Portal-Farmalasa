import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { PackageX, PackageSearch, RotateCcw, Ban } from 'lucide-react';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard    from '../../components/common/StatCard';
import FilterBar   from '../../components/common/FilterBar';
import Badge       from '../../components/common/Badge';
import TablePagination from '../../components/common/TablePagination';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { SkeletonText } from '../../components/common/StateViews';
import { fetchQuiebresSala } from '../../data/stockParams';
import { ERP_NAMES, ERP_ORDER } from './tabminmax/constants';
import { tokenMatch } from '../../utils/searchUtils';
import { formatQty } from '../../utils/formatNumber';
import { fechaTexto } from '../../utils/fecha';

/**
 * Agotados — lo que la sala no tiene y sí vende.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 * El inventario muestra lo que HAY. Un producto agotado no aparece en ninguna
 * pantalla: no tiene fila. Medido el 2026-09-22 sobre los 21 días de foto
 * diaria, de 10,589 pares producto·sala con Min/Max, **2,114 tuvieron algún día
 * sin existencia** y **331 estuvieron los 21 días en cero habiendo vendido en
 * los últimos 90** — demanda real, sin nada que vender, y nadie lo veía.
 *
 * Y no es sólo venta perdida: el cálculo de Min/Max divide lo vendido entre los
 * días de la ventana, así que los días sin producto cuentan como días sin
 * demanda. Al agotarse, el número BAJA, se pide menos y se vuelve a agotar. Esta
 * lista es la mitad «mostrar» de cortar ese círculo; la otra mitad es la guarda
 * del cálculo, que ya no baja solo un producto que estuvo en quiebre.
 *
 * ── Qué NO es ─────────────────────────────────────────────────────────────
 * No es una lista de pedido: no dice cuánto traer. Dice qué está faltando y
 * hace cuánto, que es lo que la revisión de Min/Max no tenía enfrente.
 */

const PAGINA = 40;

export default function TabQuiebres({ searchTerm = '', lockedErpId = null }) {
    const [erpElegida, setErpElegida] = useState(ERP_ORDER[0]);
    // Con alcance de una sala, la suya manda y el selector no se dibuja.
    const erp = lockedErpId ?? erpElegida;
    const [resp,     setResp]     = useState(null);   // null = cargando
    const [soloConMinMax, setSoloConMinMax] = useState(true);
    const [soloSinNada,   setSoloSinNada]   = useState(false);
    const [pagina,   setPagina]   = useState(1);

    const cargar = useCallback(async (id) => {
        setResp(null);
        const { data, error } = await fetchQuiebresSala(id, 30);
        if (error) { console.error('TabQuiebres: get_quiebres_sala falló:', error.message); setResp({ dias_foto: 0, filas: [] }); return; }
        setResp(data);
    }, []);

    useEffect(() => { cargar(erp); }, [erp, cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos

    const diasFoto = resp?.dias_foto ?? 0;
    const todas    = useMemo(() => resp?.filas ?? [], [resp]);

    const filtradas = useMemo(() => {
        const t = searchTerm.trim();
        return todas.filter(f => {
            if (soloConMinMax && !(f.max_units > 0)) return false;
            if (soloSinNada   && f.dias_sin !== diasFoto) return false;
            if (t && !tokenMatch(t, f.descripcion)) return false;
            return true;
        });
    }, [todas, soloConMinMax, soloSinNada, searchTerm, diasFoto]);

    // La página se acota en el render y no en un efecto: al buscar, la lista se
    // achica y la página en curso puede quedar fuera de rango. Los filtros y el
    // cambio de sala sí vuelven a la primera, desde su propio control.
    const totalPaginas = Math.max(1, Math.ceil(filtradas.length / PAGINA));
    const paginaActual = Math.min(pagina, totalPaginas);

    const enPantalla = useMemo(
        () => filtradas.slice((paginaActual - 1) * PAGINA, paginaActual * PAGINA),
        [filtradas, paginaActual]);

    const resumen = useMemo(() => ({
        total:      todas.length,
        sinNada:    todas.filter(f => f.dias_sin === diasFoto).length,
        reingreso:  todas.filter(f => f.hay_ahora).length,
    }), [todas, diasFoto]);

    const activos = [soloConMinMax, soloSinNada].filter(Boolean).length;

    const erpOptions = useMemo(
        () => ERP_ORDER.filter(id => id !== 6).map(id => ({ value: String(id), label: ERP_NAMES[id] })),
        []);

    const COLUMNS = [
        { key: 'descripcion', label: 'Producto' },
        { key: 'dias_sin',    label: 'Sin existencia', align: 'right' },
        { key: 'ultima_venta',label: 'Última venta',   align: 'right', hideBelow: 'md' },
        { key: 'minmax',      label: 'Min / Max',      align: 'right', hideBelow: 'lg' },
        { key: 'estado',      label: 'Estado',         align: 'right' },
    ];

    if (resp === null) return <div className="py-24 px-4"><SkeletonText lines={6} /></div>;

    const fecha = (d) => d ? fechaTexto(d, { day: '2-digit', month: 'short', year: '2-digit' }) : '—';

    return (
        <div className="p-4 md:p-5 space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1 min-w-0">
                    <StatCard icon={PackageX} label="Agotados que venden" value={formatQty(resumen.total)}
                        sub={`en ${diasFoto} día${diasFoto === 1 ? '' : 's'} mirados`} />
                    <StatCard icon={Ban} label="Nunca hubo" value={formatQty(resumen.sinNada)}
                        sub="ni un día con existencia" />
                    <StatCard icon={RotateCcw} label="Ya reingresó" value={formatQty(resumen.reingreso)}
                        sub="hay existencia ahora" />
                </CarrilCards>

                <FilterBar
                    className="lg:ml-auto"
                    activeCount={activos}
                    onClear={() => { setSoloConMinMax(false); setSoloSinNada(false); setPagina(1); }}
                >
                    {!lockedErpId && (
                        <FilterBar.Section label="sucursal">
                            <FilterBar.Sucursal
                                value={String(erp)}
                                onChange={v => { if (v) { setErpElegida(Number(v)); setPagina(1); } }}
                                options={erpOptions}
                            />
                        </FilterBar.Section>
                    )}
                    <FilterBar.Section active={activos > 0} label="estado"
                        onClear={() => { setSoloConMinMax(false); setSoloSinNada(false); setPagina(1); }}>
                        {/* «Con Min/Max» viene puesto: es la lista accionable —lo que
                            la sala YA decidió tener y no tiene—. Apagarlo agrega los
                            que vendieron sin estar asignados a la sala, que es otra
                            conversación (¿debería tenerlos?). */}
                        <FilterBar.Chip tone="brand" active={soloConMinMax}
                            onToggle={() => { setSoloConMinMax(v => !v); setPagina(1); }}>Con Min/Max</FilterBar.Chip>
                        <FilterBar.Chip tone="danger" active={soloSinNada}
                            onToggle={() => { setSoloSinNada(v => !v); setPagina(1); }}>Nunca hubo</FilterBar.Chip>
                    </FilterBar.Section>
                </FilterBar>
            </div>

            <DataTable
                columns={COLUMNS}
                minWidth="720px"
                empty={{ icon: PackageSearch, message: activos || searchTerm
                    ? 'Nada coincide con el filtro.'
                    : `Sin agotados con venta reciente en ${ERP_NAMES[erp]}.` }}
                /* Sin `usarAccionDeFila`: la fila no lleva a ningún lado — es una
                   lista para mirar, no un expediente. En el teléfono `DataTable`
                   pinta fichas con estas mismas celdas. */
            >
                {enPantalla.map((f, i) => (
                    <DataRow key={`${f.erp_product_id}`} index={i}>
                        <DataCell>
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="font-black text-content truncate">{f.descripcion}</span>
                                {f.abc_class && (
                                    <Badge variant="info" size="sm" uppercase={false}>{f.abc_class}</Badge>
                                )}
                            </div>
                        </DataCell>
                        <DataCell align="right">
                            <span className="font-black tabular-nums text-content">{f.dias_sin}</span>
                            <span className="text-content-3 text-caption"> / {diasFoto}</span>
                        </DataCell>
                        <DataCell align="right" hideBelow="md">
                            <span className="tabular-nums text-content-2">{fecha(f.ultima_venta)}</span>
                        </DataCell>
                        <DataCell align="right" hideBelow="lg">
                            {f.max_units > 0
                                ? <span className="tabular-nums text-content-2">{formatQty(f.min_units)} / {formatQty(f.max_units)}</span>
                                : <span className="text-content-3">sin asignar</span>}
                        </DataCell>
                        <DataCell align="right">
                            {f.hay_ahora
                                ? <Badge variant="success" size="sm" uppercase={false}>Ya reingresó</Badge>
                                : <Badge variant="danger"  size="sm" uppercase={false}>Sigue en cero</Badge>}
                        </DataCell>
                    </DataRow>
                ))}
            </DataTable>

            <TablePagination
                page={paginaActual}
                pageSize={PAGINA}
                totalPages={totalPaginas}
                total={todas.length}
                filteredTotal={filtradas.length}
                unit="agotados"
                onPageChange={setPagina}
            />
        </div>
    );
}
