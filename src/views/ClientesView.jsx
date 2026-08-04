import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
    Contact, Users, IdCard, Building2, MapPin, AlertTriangle, ShieldCheck,
    FileWarning, Receipt, Store, Search,
} from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import FilterBar from '../components/common/FilterBar';
import CarrilCards from '../components/common/CarrilCards';
import StatCard from '../components/common/StatCard';
import Badge from '../components/common/Badge';
import Notice from '../components/common/Notice';
import LiquidSelect from '../components/common/LiquidSelect';
import TablePagination from '../components/common/TablePagination';
import { DataTable, DataRow, DataCell } from '../components/common/DataTable';
import { useAuth } from '../context/AuthContext';
import { useStaffStore as useStaff } from '../store/staffStore';
import { formatMoney } from '../utils/formatNumber';
import { fetchCustomersPage, fetchCustomersStats } from '../data/customers';
import { EL_SALVADOR_GEO, municipiosDe } from '../data/elSalvadorGeo';

const CATEGORIAS = [
    'Consumidor', 'Contribuyente', 'Gran Contribuyente',
    'Contribuyente Exento', 'Extranjero', 'Menor de edad',
];
const SIN_CATEGORIA = '__sin__';

// La ficha no es una casilla: lo que le falta depende de su categoría (a un
// Consumidor le falta el DUI, a un Contribuyente el NRC y el giro). El servidor
// resuelve cuál de los tres es — acá solo se pinta.
const FICHA = {
    completa: { variant: 'success', label: 'Completa' },
    parcial:  { variant: 'warning', label: 'Parcial'  },
    vacia:    { variant: 'neutral', label: 'Sin datos' },
};

// El ancho de "Cliente" está acotado a propósito: bajo `table-layout: auto` un
// nombre largo estira su columna hasta su ancho natural y empuja el resto fuera
// del marco (le pasó a Proveedores, v2.27.4). Lo que realmente lo frena es el
// `max-w` + `truncate` de la celda, y este `w-` es la pista para el <th>.
//
// El escalonado de `hideBelow` sale de medir en un iPhone 13 (390px): con
// "Facturado" visible ahí, la columna "Ficha" quedaba cortada a la mitad de su
// badge — peor que no mostrarla. A 390 se ven las dos únicas que contestan algo
// en un teléfono: quién es y qué le falta.
const COLS = [
    { key: 'nombre',   label: 'Cliente',        align: 'left',  className: 'w-[200px] sm:w-[240px]', sortable: true },
    { key: 'fiscal',   label: 'Documento',      align: 'left',  hideBelow: 'md' },
    { key: 'ficha',    label: 'Ficha',          align: 'left',  sortable: true },
    { key: 'ubicacion',label: 'Ubicación',      align: 'left',  hideBelow: 'xl' },
    { key: 'facturas', label: 'Facturas',       align: 'right', hideBelow: 'lg', sortable: true },
    { key: 'total',    label: 'Facturado',      align: 'right', hideBelow: 'sm', sortable: true },
    // `2xl` y no `xl`: a 1440 de viewport ya estamos EN xl, así que la columna
    // se prendía y la tabla se salía de su marco de ~1110px. Mismo tropiezo que
    // la columna "Contó" del conteo de inventario (ver HIDE_BELOW en DataTable).
    { key: 'ultima',   label: 'Última compra',  align: 'left',  hideBelow: '2xl', sortable: true },
];

const fmtDate = (d) => {
    if (!d) return '—';
    const [y, m, day] = String(d).slice(0, 10).split('-');
    return y && m && day ? `${day}/${m}/${y}` : '—';
};

// ── Celdas ───────────────────────────────────────────────────────────────────

function ClienteCell({ row }) {
    return (
        <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-surface-card-hover/80 border border-divider flex items-center justify-center shrink-0">
                {row.mostrador
                    ? <Store size={14} className="text-content-3" strokeWidth={2} />
                    : <Contact size={14} className="text-content-3" strokeWidth={2} />}
            </div>
            <div className="min-w-0 max-w-[132px] sm:max-w-[168px]">
                <p className="text-body-sm font-bold text-content-2 truncate" title={row.name}>{row.name}</p>
                <div className="flex items-center gap-1.5 min-w-0">
                    {row.mostrador && <Badge size="sm" variant="neutral">Mostrador</Badge>}
                    {row.erp_id && !row.mostrador && (
                        <span className="text-caption text-content-3 truncate">Código {row.erp_id}</span>
                    )}
                    {/* Dos formas de que el nombre no sirva, y el ojo no
                        distingue ninguna en una lista larga: la codificación
                        rota ("MUÃ±OZ" por "MUÑOZ", 15 fichas) y el nombre sin
                        una sola letra ("....", "1111111111111", 3 fichas —
                        cajero saltándose el campo). */}
                    {row.nombre_corrupto && <Badge size="sm" variant="danger">Nombre dañado</Badge>}
                    {/* `dup_con` solo viene cuando el filtro "Duplicado" está
                        puesto — calcularlo siempre cuesta 327ms sobre las
                        24,506. Va en el `title` y no en el cuerpo porque esta
                        columna está acotada a 132px a propósito (ver arriba).
                        El orden por nombre deja al par en la fila de al lado en
                        37 de los 43 grupos (comparten el primer token, porque lo
                        que se invirtió son los apellidos). Los otros 6 invierten
                        nombre y apellido enteros —"ALVARENGA ALVARENGA FRANCISCO
                        ANTONIO" contra "FRANCISCO ANTONIO ALVARENGA ALVARENGA"—
                        y caen en letras distintas: para ESOS el tooltip es la
                        única forma de saber con quién choca. */}
                    {row.dup_con && (
                        <Badge size="sm" variant="warning" title={`Choca con ${row.dup_con}`}>
                            Duplicado
                        </Badge>
                    )}
                </div>
            </div>
        </div>
    );
}

function DocumentoCell({ row }) {
    const doc = row.dui || row.nit || row.pasaporte;
    if (!doc) return <span className="text-content-3 text-label">—</span>;
    return (
        <div className="min-w-0">
            <p className="font-mono text-caption text-content-2 truncate">{doc}</p>
            {row.nrc && <p className="font-mono text-caption text-content-3 truncate">NRC {row.nrc}</p>}
            {row.dui_sospechoso && (
                <span className="text-caption text-danger-text font-bold">DUI inválido</span>
            )}
        </div>
    );
}

function UbicacionCell({ row }) {
    if (!row.departamento && !row.municipio) {
        return <span className="text-content-3 text-label">—</span>;
    }
    return (
        <div className="min-w-0 max-w-[160px]">
            <p className="text-caption text-content-2 truncate">{row.distrito || row.municipio}</p>
            <p className="text-caption text-content-3 truncate">{row.departamento}</p>
        </div>
    );
}

// ── Vista ────────────────────────────────────────────────────────────────────

export default function ClientesView({ openModal }) {
    const { hasPermission } = useAuth();
    // Canon 2026-08-03: la ficha fiscal se completa igual sin ver cuánto
    // factura cada cliente — el monto acá es una columna más.
    const canVerMontos = hasPermission('clientes_ver_montos');
    // Encabezado y celda con la MISMA condición — si no, "Facturado" queda
    // encima de "Última compra".
    const cols = useMemo(
        () => (canVerMontos ? COLS : COLS.filter(c => c.key !== 'total')),
        [canVerMontos]);
    const canEdit = hasPermission('clientes', 'can_edit');

    const [search, setSearch] = useState('');
    const [categoria, setCategoria] = useState('');
    const [departamento, setDepartamento] = useState('');
    const [municipio, setMunicipio] = useState('');
    const [ficha, setFicha] = useState('');
    const [erp, setErp] = useState('');
    // Cuatro modos, no un sí/no. Era un booleano que mandaba siempre 'dui', así
    // que los otros dos modos que el RPC ya soportaba no tenían forma de
    // pedirse: la tarjeta "A revisar" contaba 17 y el chip mostraba 2.
    const [revisar, setRevisar] = useState('');
    const [sinMostrador, setSinMostrador] = useState(false);
    // "Con actividad" no es una ranura del filtro: lo enciende la tarjeta
    // "Por completar", que es el modo en que este módulo se usa de verdad.
    const [soloPorCompletar, setSoloPorCompletar] = useState(false);

    const [sortCol, setSortCol] = useState('nombre');
    const [sortDir, setSortDir] = useState('asc');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);

    const [rows, setRows] = useState([]);
    const [total, setTotal] = useState(0);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // El buscador escribe por tecla y cada consulta cruza 24,502 fichas: sin
    // rebote se dispara una por letra y la última en volver no es la última que
    // se pidió — la lista termina mostrando el resultado de un query anterior.
    const [searchAplicado, setSearchAplicado] = useState('');
    useEffect(() => {
        const t = setTimeout(() => setSearchAplicado(search.trim()), 300);
        return () => clearTimeout(t);
    }, [search]);

    // Descarta la respuesta de un pedido que ya quedó viejo (el usuario cambió
    // de filtro mientras viajaba). Sin esto, dos cargas que se cruzan dejan en
    // pantalla la que tardó más, no la que se pidió última.
    const pedidoRef = useRef(0);

    const cargar = useCallback(async () => {
        const mio = ++pedidoRef.current;
        setLoading(true);
        setError('');
        try {
            const { total: n, rows: r } = await fetchCustomersPage({
                search: searchAplicado,
                categoria, departamento, municipio, ficha, erp,
                actividad: soloPorCompletar ? 'con' : null,
                revisar: revisar || null,
                mostrador: sinMostrador || soloPorCompletar ? 'sin' : null,
                sort: sortCol, dir: sortDir, page, pageSize,
            });
            if (mio !== pedidoRef.current) return;
            setRows(r);
            setTotal(n);
        } catch (e) {
            if (mio !== pedidoRef.current) return;
            console.error('ClientesView.jsx: ', e);
            setError('No se pudieron cargar los clientes. Revisa la conexión e intenta de nuevo.');
            setRows([]);
            setTotal(0);
        } finally {
            if (mio === pedidoRef.current) setLoading(false);
        }
    }, [searchAplicado, categoria, departamento, municipio, ficha, erp,
        revisar, sinMostrador, soloPorCompletar, sortCol, sortDir, page, pageSize]);

    useEffect(() => { cargar(); }, [cargar]);

    const cargarStats = useCallback(() => {
        fetchCustomersStats()
            .then(setStats)
            .catch(e => console.error('ClientesView.jsx: stats', e));
    }, []);
    useEffect(() => { cargarStats(); }, [cargarStats]);

    // Cualquier cambio de filtro vuelve a la página 1: quedarse en la 40 de un
    // filtro que ahora tiene 3 páginas muestra una lista vacía que parece un error.
    useEffect(() => { setPage(1); },
        [searchAplicado, categoria, departamento, municipio, ficha, erp, revisar, sinMostrador, soloPorCompletar]);

    // El municipio cuelga del departamento: si cambia el padre, el hijo que
    // quedó ya no pertenece a ningún sitio.
    const onDepartamentoChange = useCallback((val) => {
        setDepartamento(val || '');
        setMunicipio('');
    }, []);

    const handleSort = useCallback((col) => {
        setSortCol(prev => {
            if (prev === col) { setSortDir(d => (d === 'asc' ? 'desc' : 'asc')); return prev; }
            // Plata y fechas se miran de mayor a menor; los nombres, de la A a la Z.
            setSortDir(col === 'nombre' || col === 'ficha' ? 'asc' : 'desc');
            return col;
        });
        setPage(1);
    }, []);

    const abrirFicha = useCallback((row) => {
        openModal?.('editCliente', {
            id: row.id,
            nombre: row.name,
            canEdit: canEdit && !row.mostrador,
            onSaved: () => { cargar(); cargarStats(); },
        });
        useStaff.getState().appendAuditLog('CLIENTES_VER_FICHA', String(row.id), { nombre: row.name });
    }, [openModal, canEdit, cargar, cargarStats]);

    const limpiar = useCallback(() => {
        setCategoria(''); setDepartamento(''); setMunicipio('');
        setFicha(''); setErp(''); setRevisar(''); setSinMostrador(false);
        setSoloPorCompletar(false);
    }, []);

    const activeCount = [categoria, departamento, municipio, ficha, erp, revisar, sinMostrador]
        .filter(Boolean).length;

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const filtersContent = (
        <ViewTabBar
            tabs={[]}
            activeTab=""
            onTabChange={() => {}}
            searchValue={search}
            onSearchChange={setSearch}
            placeholder="Buscar por nombre, DUI, NIT, NRC, teléfono…"
            showSearch
        />
    );

    const barraFiltros = (
        <FilterBar onClear={limpiar} activeCount={activeCount}>
            <FilterBar.Section active={!!departamento} onClear={() => onDepartamentoChange('')} label="departamento">
                <div style={{ width: '170px' }}>
                    <LiquidSelect value={departamento} onChange={onDepartamentoChange}
                        options={Object.keys(EL_SALVADOR_GEO).map(d => ({ value: d, label: d }))}
                        placeholder="Departamento" icon={MapPin} compact bare />
                </div>
            </FilterBar.Section>

            {/* Aparece solo con departamento elegido: un select de 44 municipios
                sin su departamento es una lista que nadie puede recorrer. */}
            {departamento && (
                <FilterBar.Section active={!!municipio} onClear={() => setMunicipio('')} label="municipio">
                    <div style={{ width: '175px' }}>
                        <LiquidSelect value={municipio} onChange={val => setMunicipio(val || '')}
                            options={municipiosDe(departamento).map(m => ({ value: m, label: m }))}
                            placeholder="Municipio" icon={Building2} compact bare />
                    </div>
                </FilterBar.Section>
            )}

            <FilterBar.Section active={!!categoria} onClear={() => setCategoria('')} label="categoría">
                <div style={{ width: '185px' }}>
                    <LiquidSelect value={categoria} onChange={val => setCategoria(val || '')}
                        options={[
                            { value: SIN_CATEGORIA, label: '(sin categoría)' },
                            ...CATEGORIAS.map(c => ({ value: c, label: c })),
                        ]}
                        placeholder="Categoría" icon={ShieldCheck} compact bare />
                </div>
            </FilterBar.Section>

            {/* `umbral={0}` fuerza el select en vez del segmentado. Con tres
                opciones el segmentado es lo natural, pero acá medía ~250px y
                empujaba el carril de tarjetas de 3 visibles a 2 en 1440px —
                el mismo caso que §17.0 documenta en MIN·MAX y en Facturación.
                Es una ranura que decide qué recorte mirar, no cinco métricas. */}
            <FilterBar.Section active={!!ficha} onClear={() => setFicha('')} label="ficha">
                <FilterBar.Opciones
                    options={[
                        { value: 'completa', label: 'Completa' },
                        { value: 'parcial',  label: 'Parcial'  },
                        { value: 'vacia',    label: 'Sin datos' },
                    ]}
                    value={ficha}
                    /* La tarjeta "Por completar" enciende `ficha = 'vacia'` +
                       actividad. Si desde acá se elige otra cosa, la tarjeta
                       dejaría de describir lo que la lista muestra y seguiría
                       pintada como activa: se apaga junto con el filtro. */
                    onChange={val => {
                        setFicha(val || '');
                        if (val !== 'vacia') setSoloPorCompletar(false);
                    }}
                    label="Ficha"
                    icon={IdCard}
                    umbral={0}
                    ancho="150px"
                    /* Se nombra a sí misma en vez del "Todos" del default: al
                       sumarse la ranura "Revisar" quedaban DOS que decían
                       "Todos" pegadas, distinguibles solo por el ícono. */
                    placeholder="Ficha"
                />
            </FilterBar.Section>

            {/* "A revisar" es una de CUATRO, no un sí/no, así que es ranura y no
                chip. Con 4 opciones `FilterBar.Opciones` cae solo en LiquidSelect
                (el umbral del canónico es 3, y subirlo acá sería justo el caso
                que el doc desaconseja).
                Las etiquetas van CORTAS y el ancho en 150px —no los 170 del
                default— por una medición: con "DUI inválido / Teléfono inválido /
                Nombre dañado / Posible duplicado" la ranura pedía 185px y la
                píldora mandaba TRES controles al desborde "Más filtros", entre
                ellos esta misma ranura. El rótulo "Revisar" ya da el contexto,
                así que repetirlo en cada opción costaba la visibilidad del
                control entero. */}
            <FilterBar.Section active={!!revisar} onClear={() => setRevisar('')} label="revisar">
                <FilterBar.Opciones
                    options={[
                        { value: 'dui',       label: 'DUI'       },
                        { value: 'telefono',  label: 'Teléfono'  },
                        { value: 'nombre',    label: 'Nombre'    },
                        { value: 'duplicado', label: 'Duplicado' },
                    ]}
                    value={revisar}
                    onChange={val => setRevisar(val || '')}
                    label="Revisar"
                    icon={FileWarning}
                    ancho="150px"
                    placeholder="Revisar"
                />
            </FilterBar.Section>

            {/* Los dos que quedan van como chip y no como ranura: son estados de
                sí/no, y una ranura de ~155px por cada uno dejaba el carril de
                tarjetas en CERO visibles a 1440px (medido). El chip además
                colapsa solo al control de desborde cuando falta ancho — la
                ranura no.
                "Portado del ERP" solo tiene sentido en un sentido: al revés son
                24,323 de 24,502 fichas, o sea la lista entera. */}
            <FilterBar.Chip active={erp === 'con'} onToggle={() => setErp(v => (v === 'con' ? '' : 'con'))} tone="brand">
                Con código
            </FilterBar.Chip>
            <FilterBar.Chip active={sinMostrador} onToggle={() => setSinMostrador(v => !v)} tone="brand">
                Sin mostrador
            </FilterBar.Chip>
        </FilterBar>
    );

    return (
        <GlassViewLayout
            icon={Contact}
            title="Clientes"
            filtersContent={filtersContent}
            transparentBody
        >
            <div className="p-5 md:p-6 space-y-5">
                {/* El carril y la píldora van en FILAS SEPARADAS, y no
                    compartiendo una como en Libros IVA.
                    Medido a 1440px: el área de contenido son ~1110px, la píldora
                    de esta vista mide 975 (tres ranuras y tres chips) y cinco
                    tarjetas necesitan 772 como mínimo. Juntas no entran, y el
                    que cedía era el carril: quedaba en CERO tarjetas visibles,
                    que es justo el "una sola cortada parece un error de
                    maquetación" que §17.0 quiere evitar. En dos filas entran las
                    dos enteras.
                    La píldora queda pegada a la tabla, que es lo que filtra. */}

                {/* CINCO tarjetas fijas (§17.0): el cupo es de la vista, no del
                    dato. "Por completar" es la única que además filtra — es la
                    cola de trabajo del módulo, no una métrica más. */}
                <div className="flex flex-col gap-3">
                    <CarrilCards ariaLabel="Resumen del catálogo de clientes">
                        <StatCard icon={Users} label="Clientes"
                            value={stats ? stats.total.toLocaleString() : '—'}
                            sub="En el catálogo" loading={!stats} />
                        <StatCard icon={IdCard} label="Completas"
                            value={stats ? stats.completas.toLocaleString() : '—'}
                            iconBg="bg-success/10" iconCls="text-success"
                            sub="Según su categoría" loading={!stats} />
                        <StatCard icon={Receipt} label="Por completar"
                            value={stats ? stats.por_completar.toLocaleString() : '—'}
                            iconBg="bg-warning/10" iconCls="text-warning"
                            valueCls="text-warning-text"
                            sub="Compran y no tienen datos"
                            loading={!stats}
                            active={soloPorCompletar}
                            tono="warning"
                            onClick={() => {
                                setSoloPorCompletar(v => {
                                    const siguiente = !v;
                                    setFicha(siguiente ? 'vacia' : '');
                                    return siguiente;
                                });
                            }} />
                        <StatCard icon={ShieldCheck} label="Contribuyentes"
                            value={stats ? stats.contribuyentes.toLocaleString() : '—'}
                            sub="Se declaran a Hacienda" loading={!stats} />
                        <StatCard icon={FileWarning} label="A revisar"
                            value={stats ? stats.a_revisar.toLocaleString() : '—'}
                            iconBg="bg-danger/10" iconCls="text-danger"
                            valueCls={stats?.a_revisar ? 'text-danger-text' : undefined}
                            sub="DUI, teléfono o nombre" loading={!stats} />
                    </CarrilCards>
                    <div className="flex justify-end min-w-0">{barraFiltros}</div>
                </div>


                {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}

                <DataTable
                    columns={cols}
                    sortKey={sortCol}
                    sortDir={sortDir}
                    onSort={handleSort}
                    loading={loading}
                    /* El default del canónico son 600px, pensado para tablas que
                       bajo ese ancho aplastan sus columnas. Acá a 390px quedan
                       DOS columnas visibles, así que esos 600 eran 268px de
                       vacío al que se podía scrollear (el marco a 390px mide 332). En escritorio
                       no cambia nada: manda el `w-full` de la tabla. */
                    minWidth="320px"
                    /* Buscar sin resultados NO es un vacío (§26.2): uno se
                       arregla borrando el filtro y el otro no tiene arreglo.
                       Confundirlos manda a alguien a buscar el botón de crear
                       un cliente, que en este módulo no existe — las fichas las
                       da de alta el punto de venta. */
                    empty={searchAplicado || activeCount
                        ? {
                            icon: Search,
                            message: 'Sin resultados',
                            subtext: searchAplicado
                                ? `Ningún cliente coincide con "${searchAplicado}".`
                                : 'Ningún cliente coincide con los filtros aplicados.',
                        }
                        : { icon: Contact, message: 'Sin clientes' }}
                >
                    {rows.map((row, i) => {
                        const f = FICHA[row.ficha] || FICHA.vacia;
                        return (
                            <DataRow key={row.id} index={i} onClick={() => abrirFicha(row)}>
                                <DataCell><ClienteCell row={row} /></DataCell>
                                <DataCell hideBelow="md"><DocumentoCell row={row} /></DataCell>
                                <DataCell>
                                    <div className="flex flex-col items-start gap-1">
                                        <Badge size="sm" variant={f.variant}>{f.label}</Badge>
                                        {row.categoria && (
                                            <span className="text-caption text-content-3 truncate max-w-[130px]"
                                                title={row.categoria}>{row.categoria}</span>
                                        )}
                                    </div>
                                </DataCell>
                                <DataCell hideBelow="xl"><UbicacionCell row={row} /></DataCell>
                                <DataCell align="right" hideBelow="lg">
                                    <span className="tabular-nums font-bold text-content-2">
                                        {row.facturas.toLocaleString()}
                                    </span>
                                    {row.facturas_ccf > 0 && (
                                        <p className="text-caption text-content-3 tabular-nums">
                                            {row.facturas_ccf} CCF
                                        </p>
                                    )}
                                </DataCell>
                                {canVerMontos && (
                                    <DataCell align="right" hideBelow="sm">
                                        <span className="tabular-nums font-bold text-content-2">
                                            {formatMoney(row.total)}
                                        </span>
                                    </DataCell>
                                )}
                                <DataCell hideBelow="2xl">
                                    <span className="text-content-2 text-label tabular-nums">
                                        {fmtDate(row.ultima_fecha)}
                                    </span>
                                </DataCell>
                            </DataRow>
                        );
                    })}
                </DataTable>

                {!loading && total > 0 && (
                    <TablePagination
                        pageSize={pageSize}
                        onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
                        page={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                        total={total}
                        unit="clientes"
                    />
                )}
            </div>
        </GlassViewLayout>
    );
}
