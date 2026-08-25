import React, { useEffect, useState, useMemo, useCallback } from 'react';
import Notice from '../components/common/Notice';
import Badge from '../components/common/Badge';
import ViewTabBar from '../components/common/ViewTabBar';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, Plus, ChevronRight, AlertTriangle, CheckCircle2, Clock, FileCheck2, Search, FileSpreadsheet, Building2, Trash2 } from 'lucide-react';
import LiquidSelect from '../components/common/LiquidSelect';
import GlassViewLayout from '../components/GlassViewLayout';
import { DataTable, DataRow, DataCell } from '../components/common/DataTable';
import NuevoConteoModal from '../components/inventario/NuevoConteoModal';
import { useStaffStore } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import { smartFilter } from '../utils/searchUtils';
import FilterBar from '../components/common/FilterBar';
import StatCard from '../components/common/StatCard';
import CarrilCards from '../components/common/CarrilCards';
import ListRow from '../components/common/ListRow';
import OjoDeTarjeta from '../components/common/OjoDeTarjeta';
import { SkeletonText } from '../components/common/StateViews';
import SegmentedControl from '../components/common/SegmentedControl';
import Button from '../components/common/Button';
import ConfirmModal from '../components/common/ConfirmModal';
import ModalShell from '../components/common/ModalShell';
import HojaMovil from '../components/common/HojaMovil';
import usePulsacionLarga from '../hooks/usePulsacionLarga';
import { useToastStore } from '../store/toastStore';
import { mensajeAmigable } from '../utils/errorMessages';
import { formatMoney, formatQty } from '../utils/formatNumber';

// 'APROBADO' no está porque nunca existió: aprobar_conteo_inventario escribe
// 'CERRADO'. Las claves bg/text/border tampoco: solo se usaba `variante`, que es
// lo que consume Badge.
const ESTADO_CFG = {
    BORRADOR:    { icon: Clock,        label: 'Borrador',    variante: 'neutral' },
    EN_PROGRESO: { icon: Clock,        label: 'En progreso', variante: 'warning' },
    FINALIZADO:  { icon: FileCheck2,   label: 'Finalizado',  variante: 'chart-1' },
    CERRADO:     { icon: CheckCircle2, label: 'Cerrado',     variante: 'success' },
};

const SCOPE_LABEL = { TOTAL: 'Total', LABORATORIO: 'Por laboratorio', BAJO_RECETA: 'Bajo Receta', MANUAL: 'Manual', CICLICO: 'Cíclico del mes' };

// El alcance y el detalle en la misma celda, y solo cuando el detalle no es el
// de siempre: "Por lote" en todas las filas sería ruido: es lo normal. La lista
// tiene que dejar distinguirlos porque un conteo sencillo y uno por lote de la
// misma sucursal se ven idénticos hasta que se abren.
//
// Mismo criterio para el tipo: "Según la hoja" es el normal y no se rotula; el
// que se anuncia es «En vivo», porque cambia qué cuenta como diferencia.
const alcanceLabel = (c) => [
    SCOPE_LABEL[c.scope_type] || c.scope_type,
    ...(c.modo === 'SIMPLE' ? ['Sencillo'] : []),
    ...(c.fuente_sistema === 'VIVO' ? ['En vivo'] : []),
].join(' · ');

const COLS = [
    { key: 'fecha', label: 'Fecha', align: 'left' },
    { key: 'sucursal', label: 'Sucursal', align: 'left' },
    // `2xl`: a 1280 las ocho columnas piden 898px contra los 868 del marco y la
    // de **acciones** queda fuera. El alcance del conteo —general o por
    // laboratorio— es contexto y está en el detalle; los botones de la fila no
    // se alcanzaban de ninguna forma.
    { key: 'alcance', label: 'Alcance', align: 'left', hideBelow: '2xl' },
    { key: 'items', label: 'Ítems', align: 'center', hideBelow: 'md' },
    { key: 'diferencias', label: 'Diferencias', align: 'center' },
    { key: 'valor', label: 'Valor neto', align: 'right', hideBelow: 'lg' },
    { key: 'estado', label: 'Estado', align: 'center' },
    { key: 'acciones', label: '', align: 'right' },
];

const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });
};

// La fila del teléfono. Es un componente y no un `map` inline porque cada fila
// necesita su propio `usePulsacionLarga` — un hook no se puede llamar dentro de
// un bucle, y el estado del gesto (temporizador, punto de origen) es por fila.
function FilaConteoMovil({ conteo: c, estado: es, subtitulo, tono, trailing, conOpciones, onAbrir, onOpciones }) {
    const gestos = usePulsacionLarga({
        activo: conOpciones,
        alMantener: () => onOpciones(c),
        alTocar: onAbrir,
    });
    return (
        <ListRow
            icon={es.icon}
            // `surface="card"` y no el default: `ListRow` nace como fila DENTRO de
            // un contenedor —un menú, un flyout—, así que en reposo no pinta fondo
            // ni borde y toma el radio del botón. Acá cada conteo está suelto sobre
            // la página, sin contenedor que le ponga la superficie, y el resultado
            // era texto flotando: «no parece card, sólo es texto».
            //
            // El canónico ya tenía la variante. Y va por la prop, no por
            // `bg-surface-card` a mano: esas clases copian el RELLENO y dejan
            // afuera lo que hace a una tarjeta —el `backdrop-filter`, las seis
            // capas de sombra, el lente del filo, el gel al tocarla—. Con `card`,
            // `ListRow` pone `data-surface="card"` y eso lo trae todo.
            surface="card"
            // Una tarjeta suelta respira más que una fila de menú. Es la densidad
            // que usa la tarjeta de producto del detalle del conteo.
            density="lg"
            tone={tono}
            title={c.branches?.name || '—'}
            subtitle={subtitulo}
            // `select-none` + el callout apagado: sin esto, mantener el dedo sobre
            // la fila levanta la lupa y el menú «Copiar / Buscar» de iOS ENCIMA de
            // la hoja que se acaba de abrir.
            className={conOpciones ? 'select-none [-webkit-touch-callout:none]' : ''}
            {...gestos}
            trailing={trailing}
        />
    );
}

export default function ConteoInventarioView() {
    const navigate = useNavigate();
    const { user, hasPermission, getScope } = useAuth();
    const { showToast } = useToastStore();
    const canEdit = hasPermission('conteo_inventario', 'can_edit');
    // El conteo se audita con unidades; la valuación en dinero va aparte.
    const canVerMontos = hasPermission('conteo_inventario_ver_montos');
    // Borrar uno ya empezado o finalizado. Sin esto, «Gestionar» solo se lleva
    // el conteo que todavía no cuenta nada.
    const canEliminar = hasPermission('conteo_inventario_eliminar');
    // Encabezado y celda con la MISMA condición (trampa de las columnas corridas).
    const cols = useMemo(
        () => (canVerMontos ? COLS : COLS.filter(c => c.key !== 'valor')),
        [canVerMontos]);
    const conteos = useStaffStore((s) => s.conteosInventario);
    const loading = useStaffStore((s) => s.conteosInventarioLoading);
    const fetchConteosInventario = useStaffStore((s) => s.fetchConteosInventario);
    const eliminarConteoInventario = useStaffStore((s) => s.eliminarConteoInventario);
    const branches = useStaffStore((s) => s.branches);

    // El scope del permiso ya lo aplica RLS: con BRANCH, la consulta solo trae
    // los conteos de su sucursal. Acá el selector es para el que ve TODAS y
    // necesita mirar una sola — con BRANCH queda fijado y deshabilitado, para
    // que se vea de qué sucursal son los datos y no parezca "todo el portal".
    const isBranchScoped = getScope('conteo_inventario') !== 'ALL';

    const [search, setSearch] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [branchFilter, setBranchFilter] = useState(isBranchScoped ? String(user?.branchId || '') : '');
    // Qué necesita atención. Es un filtro y no solo un rótulo: la pregunta real de
    // esta pantalla no es "cuántos conteos hay" sino "cuál me está esperando".
    const [foco, setFoco] = useState('TODOS');
    // El conteo que se está por borrar. Se guarda la FILA entera, no el id: la
    // confirmación tiene que poder nombrar de qué sucursal y de qué día es lo
    // que se va, y para cuando el modal se abre esa fila ya está en memoria.
    const [aBorrar, setABorrar] = useState(null);
    const [borrando, setBorrando] = useState(false);
    // El conteo cuya hoja de opciones está abierta, en el teléfono. Misma razón
    // que `aBorrar` para guardar la fila entera y no el id: la hoja tiene que
    // poder decir de qué conteo habla.
    //
    // **SON DOS ESTADOS, y esa es toda la corrección.** Con uno solo —`open={!!opciones}`
    // y el cuerpo bajo `{opciones && …}`— cerrar acoplaba «qué conteo» con «está
    // abierta»: al poner el conteo en null, el CUERPO se desmontaba en el acto
    // mientras `ModalShell` seguía montado animando su salida. O sea que la hoja
    // no se cerraba, desaparecía. Al arrastrarla no se notaba, porque el asa ya
    // había movido el panel bajo el dedo antes de soltar; tocando afuera no hay
    // nada previo y el salto queda a la vista. Es literalmente la lección que ya
    // estaba escrita en `ModalShell` (v2.238.0): son dos props. El conteo se
    // conserva mientras dura la salida y lo pisa la próxima apertura.
    const [opciones, setOpciones] = useState(null);
    const [opcionesAbierto, setOpcionesAbierto] = useState(false);
    const abrirOpciones = useCallback((c) => { setOpciones(c); setOpcionesAbierto(true); }, []);

    useEffect(() => { fetchConteosInventario(); }, [fetchConteosInventario]);

    // La lista sabe el ESTADO de cada conteo pero no si el abierto ya tiene
    // renglones contados: `total_contados` lo escribe recalcular_totales_conteo
    // y solo corre al finalizar, así que en un conteo abierto viene NULL. Por
    // eso el botón se ofrece por estado y el resto lo decide el servidor, que
    // rechaza con el motivo escrito. Se prefiere así antes que pedir el dato de
    // los N conteos para decidir un botón.
    const puedeBorrar = (c) => canEdit && (canEliminar || ['BORRADOR', 'EN_PROGRESO'].includes(c.status));

    const confirmarBorrado = async () => {
        if (!aBorrar) return;
        setBorrando(true);
        try {
            const res = await eliminarConteoInventario(aBorrar.id);
            showToast('Conteo eliminado', `Se borraron ${formatQty(res?.total_items ?? 0)} renglón(es)`, 'success');
            setABorrar(null);
        } catch (err) {
            showToast('No se pudo eliminar', mensajeAmigable(err), 'error');
        } finally {
            setBorrando(false);
        }
    };

    const branchOpts = useMemo(() => {
        const conIdsUsados = new Set((conteos || []).map((c) => String(c.branch_id)));
        return (branches || [])
            .filter((b) => conIdsUsados.has(String(b.id)) || !isBranchScoped)
            .map((b) => ({ value: String(b.id), label: b.name }));
    }, [branches, conteos, isBranchScoped]);

    // Un conteo CERRADO con diferencias y sin ajuste registrado es trabajo a
    // medias: la diferencia está medida y firmada, pero el stock del ERP sigue
    // mintiendo. Antes solo se veía fila por fila.
    const faltaAjuste = (c) => c.status === 'CERRADO' && c.total_diferencias > 0 && !c.ajuste_erp_aplicado;

    const resumen = useMemo(() => {
        const base = branchFilter
            ? (conteos || []).filter((c) => String(c.branch_id) === branchFilter)
            : (conteos || []);
        return {
            total: base.length,
            abiertos: base.filter((c) => ['BORRADOR', 'EN_PROGRESO'].includes(c.status)).length,
            porAprobar: base.filter((c) => c.status === 'FINALIZADO').length,
            sinAjuste: base.filter(faltaAjuste).length,
        };
    }, [conteos, branchFilter]);

    const FOCOS = {
        ABIERTOS: (c) => ['BORRADOR', 'EN_PROGRESO'].includes(c.status),
        POR_APROBAR: (c) => c.status === 'FINALIZADO',
        SIN_AJUSTE: faltaAjuste,
    };

    const { results: filtered, isFuzzy: isSearchFuzzy } = useMemo(() => {
        let base = branchFilter
            ? (conteos || []).filter((c) => String(c.branch_id) === branchFilter)
            : (conteos || []);
        if (FOCOS[foco]) base = base.filter(FOCOS[foco]);
        if (!search.trim()) return { results: base, isFuzzy: false };
        return smartFilter(search, base, (c) => [c.branches?.name]);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- FOCOS es un literal estable por render y no cambia el resultado
    }, [conteos, search, branchFilter, foco]);

    // D3.9 (2026-07-27): barra reescrita a mano → canónico.
    const filtersContent = (
        <ViewTabBar
            searchValue={search}
            onSearchChange={setSearch}
            placeholder="Buscar por sucursal..."
            // Ni el filtro de sucursal ni la acción van acá: §17 es explícito en
            // que los dos viven en el CUERPO de la vista, y el header es
            // navegación y buscador.
        />
    );

    return (
        <GlassViewLayout icon={ClipboardCheck} title="Conteo de inventario" filtersContent={filtersContent}>
            {/* El padding del cuerpo lo pone la VISTA, no `GlassViewLayout` — el
                canónico es `StaffManagementView`. Sin este envoltorio el contenido
                nacía sobre el filo de la tarjeta: medido a 1600px, 0px de aire
                contra los 32 de Personal. Y `space-y-6` reemplaza los `mb-*` sueltos
                que traía cada bloque — el ritmo entre bloques es del contenedor, y
                repartido en cada hijo se desincroniza en cuanto uno se esconde. */}
            <div className="p-4 md:p-6 lg:p-8 space-y-6 animate-in fade-in duration-[var(--dur-lento)]">

            {/* Resumen arriba, y cada tarjeta es un FILTRO. La pregunta de esta
                pantalla no es "cuántos conteos hay" sino "cuál me está esperando":
                un finalizado sin aprobar bloquea a alguien, y un cerrado sin ajuste
                registrado es trabajo a medias que antes solo se veía fila por fila. */}
            {/* §17.0: el carril y la píldora en UNA fila, no en dos renglones. No es
                estética: `useMedidaFila` mira al abuelo de la píldora y busca el
                carril con `[role="group"]`. En renglones separados lo encuentra
                igual —es hermano dentro del `space-y-*` de la vista— y le descuenta
                RESERVA_CARRIL (314px) por un carril que no tiene al lado. O sea que
                el layout equivocado no falla: le roba 314px a la píldora en
                silencio. El canónico es `StaffManagementView`. */}
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <CarrilCards className="flex-1" ariaLabel="Resumen de conteos">
                {/* Ésta NO es un filtro: es el total, y por eso no lleva `active` ni
                    `onClick`. Con `active` StatCard dibuja una × de "quitar este
                    filtro", y quitar "todos" no significa nada. */}
                <StatCard
                    icon={ClipboardCheck} label="Conteos" value={formatQty(resumen.total)}
                    sub={branchFilter ? 'en esta sucursal' : 'en total'}
                />
                <StatCard
                    icon={Clock} label="Abiertos" value={formatQty(resumen.abiertos)}
                    iconBg="bg-warning/10" iconCls="text-warning-text"
                    valueCls={resumen.abiertos ? 'text-warning-text' : 'text-content'}
                    sub="contándose ahora"
                    active={foco === 'ABIERTOS'} onClick={() => setFoco((f) => (f === 'ABIERTOS' ? 'TODOS' : 'ABIERTOS'))}
                />
                <StatCard
                    icon={FileCheck2} label="Por aprobar" value={formatQty(resumen.porAprobar)}
                    iconBg="bg-chart-1/10" iconCls="text-chart-1-text"
                    valueCls={resumen.porAprobar ? 'text-chart-1-text' : 'text-content'}
                    sub="esperan otra firma"
                    active={foco === 'POR_APROBAR'} onClick={() => setFoco((f) => (f === 'POR_APROBAR' ? 'TODOS' : 'POR_APROBAR'))}
                />
                <StatCard
                    icon={FileSpreadsheet} label="Sin ajustar" value={formatQty(resumen.sinAjuste)}
                    iconBg="bg-danger/10" iconCls="text-danger"
                    valueCls={resumen.sinAjuste ? 'text-danger' : 'text-content'}
                    sub="el stock aún sin corregir"
                    active={foco === 'SIN_AJUSTE'} onClick={() => setFoco((f) => (f === 'SIN_AJUSTE' ? 'TODOS' : 'SIN_AJUSTE'))}
                />
            </CarrilCards>

            {/* §17: los filtros de la vista, en UNA píldora, en el cuerpo y a la
                derecha. El segmentado pasa a bloque de 2 columnas en teléfono — en
                riel sus cuatro opciones no caben en la hoja inferior. */}
            <div className="flex justify-end min-w-0">
                <FilterBar activeCount={(branchFilter && !isBranchScoped ? 1 : 0) + (foco !== 'TODOS' ? 1 : 0)}
                    onClear={() => { if (!isBranchScoped) setBranchFilter(''); setFoco('TODOS'); }}
                    acciones={canEdit ? [{
                        key: 'nuevo', icon: Plus, label: 'Nuevo conteo', variant: 'primary',
                        onClick: () => setShowModal(true),
                    }] : []}>
                    <FilterBar.Section
                        active={!!branchFilter && !isBranchScoped}
                        onClear={() => setBranchFilter('')}
                        label="sucursal"
                    >
                        <FilterBar.Sucursal
                            value={branchFilter || null}
                            onChange={(v) => setBranchFilter(v || '')}
                            options={branchOpts}
                            disabled={isBranchScoped}
                        />
                    </FilterBar.Section>
                    <FilterBar.Section active={foco !== 'TODOS'} onClear={() => setFoco('TODOS')} label="estado">
                        {/* Cuatro opciones: `FilterBar.Opciones` las da como select.
                            Con eso se va el `layout=block/columns=2`, que existía solo
                            porque en el teléfono el riel de cuatro no entraba. */}
                        <FilterBar.Opciones
                            label="Filtrar por lo que necesita atención"
                            value={foco}
                            onChange={setFoco}
                            options={[
                                { value: 'TODOS', label: 'Todos' },
                                { value: 'ABIERTOS', label: 'Abiertos' },
                                { value: 'POR_APROBAR', label: 'Por aprobar' },
                                { value: 'SIN_AJUSTE', label: 'Sin ajustar' },
                            ]}
                        />
                    </FilterBar.Section>
                </FilterBar>
            </div>
            </div>

            {isSearchFuzzy && search && (
                <Notice variant="warning" icon={Search}>
                    Resultados similares para &ldquo;{search}&rdquo; — no se encontraron coincidencias exactas
                </Notice>
            )}
            {/* Teléfono: una fila por conteo. La tabla son 8 columnas y aun con 4
                visibles desbordaba 298px a 320 (medido) — `DataTable` no reflowa a
                tarjetas (§32), así que se cierra acá igual que en el detalle. Se usa
                `ListRow`, que es el canónico de esta anatomía exacta: caja al
                principio, contenido, algo al final. */}
            <div className="md:hidden space-y-2">
                {loading ? (
                    <div data-surface="card" className="p-4"><SkeletonText lines={5} /></div>
                ) : filtered.length === 0 ? (
                    <div data-surface="card" className="p-8 text-center">
                        <ClipboardCheck size={28} className="mx-auto text-content-3 mb-2" />
                        <p className="text-body-sm font-bold text-content-3">
                            {foco === 'TODOS' ? 'Sin conteos de inventario' : 'Nada pendiente acá'}
                        </p>
                    </div>
                ) : filtered.map((c) => {
                    const es = ESTADO_CFG[c.status] || ESTADO_CFG.BORRADOR;
                    const valorNeto = (c.valor_sobrante || 0) - (c.valor_faltante || 0);
                    return (
                        <FilaConteoMovil
                            key={c.id}
                            conteo={c}
                            estado={es}
                            // El tono de la fila dice el estado sin gastar una línea:
                            // lo que falta ajustar es lo urgente de esta pantalla.
                            // `danger` y no `peligro`: las claves de `ListRow` son las
                            // de la paleta y están en inglés. `peligro` no existía en
                            // el mapa, así que caía al default y la fila NUNCA se tiñó
                            // — un tono inválido no avisa, se ignora. Era el único uso
                            // del repo; salió al mover la fila a su componente.
                            tono={faltaAjuste(c) ? 'danger' : null}
                            subtitulo={`${fmtDate(c.created_at)} · ${alcanceLabel(c)}`}
                            // Mantener presionado solo se ofrece a quien puede hacer
                            // algo con la fila. Sin `canEdit` la hoja tendría una sola
                            // opción —«Abrir»— que es lo que el toque ya hace: un
                            // gesto que abre un menú de una opción es peor que no
                            // tenerlo.
                            conOpciones={canEdit}
                            onAbrir={() => navigate(`/conteo-inventario/${c.id}`)}
                            onOpciones={abrirOpciones}
                            /* Las insignias dicen el ESTADO; el ojo dice que la
                               tarjeta se abre (§5.3). Hacían falta las dos: el
                               toque lleva al conteo y nada lo anunciaba —el
                               chevron de la tabla de al lado se esconde por
                               debajo de `lg` justo para no leerse como un
                               segundo botón al lado de la papelera—. */
                            trailing={(
                                <span className="flex items-center gap-2">
                                    <span className="flex flex-col items-end gap-1">
                                        <Badge variant={es.variante} size="sm">{es.label}</Badge>
                                        {c.total_diferencias > 0 && (
                                            <span className="text-caption font-bold text-warning-text tabular-nums">
                                                {c.total_diferencias} dif{canVerMontos ? ` · ${formatMoney(valorNeto)}` : ''}
                                            </span>
                                        )}
                                        {faltaAjuste(c) && (
                                            <Badge variant="warning" size="sm" icon={FileSpreadsheet} uppercase={false}>Falta ajuste</Badge>
                                        )}
                                        {c.total_pendientes > 0 && !c.pendientes_como_cero && (
                                            <Badge variant="danger" size="sm" uppercase={false}>Parcial</Badge>
                                        )}
                                    </span>
                                    <OjoDeTarjeta size={13} />
                                </span>
                            )}
                        />
                    );
                })}
                {/* La única debilidad real de un gesto mantenido es que no se ve.
                    Una línea lo dice de una vez y no vuelve a estorbar — y solo
                    aparece si hay filas y el gesto está de verdad disponible. */}
                {!loading && filtered.length > 0 && canEdit && (
                    <p className="text-caption text-content-3 text-center pt-1">
                        Mantené presionada una fila para ver sus opciones
                    </p>
                )}
            </div>

            <div className="hidden md:block">
            <DataTable columns={cols} loading={loading}
                // Entre 768 y 1024px esta tabla se pinta como fichas. Sin
                // `acciones` la papelera no se dibujaría justo ahí, y sin
                // `usarAccionDeFila` el toque abriría una hoja de detalle en vez
                // de ir al conteo, que es a donde lleva la fila.
                movil={{ acciones: true, usarAccionDeFila: true }}
                empty={{
                icon: ClipboardCheck,
                message: foco === 'TODOS' ? 'Sin conteos de inventario' : 'Nada pendiente acá',
                subtext: foco === 'TODOS'
                    ? 'Un conteo toma una foto del inventario del sistema y la compara con lo que hay en vitrinas y estantes.'
                    : 'Ningún conteo cae en este filtro. Prueba con "Todos".',
                action: foco !== 'TODOS'
                    ? { label: 'Ver todos', onClick: () => setFoco('TODOS') }
                    : (canEdit ? { label: 'Nuevo conteo', onClick: () => setShowModal(true) } : undefined),
            }}>
                {filtered.map((c, i) => {
                    const es = ESTADO_CFG[c.status] || ESTADO_CFG.BORRADOR;
                    const valorNeto = (c.valor_sobrante || 0) - (c.valor_faltante || 0);
                    return (
                        <DataRow key={c.id} index={i} onClick={() => navigate(`/conteo-inventario/${c.id}`)}>
                            <DataCell><span className="text-body-sm font-semibold text-content-2">{fmtDate(c.created_at)}</span></DataCell>
                            <DataCell><span className="text-body-sm font-bold text-content">{c.branches?.name || '—'}</span></DataCell>
                            <DataCell hideBelow="2xl"><span className="text-label text-content-3">{alcanceLabel(c)}</span></DataCell>
                            <DataCell align="center" hideBelow="md">
                                <div className="flex flex-col items-center gap-0.5">
                                    <span className="text-label tabular-nums text-content-2">{c.total_contados ?? '—'}/{c.total_items ?? '—'}</span>
                                    {/* Un conteo cerrado con renglones sin contar y sin
                                        valuar NO es un cuadre: tiene que verse desde la lista,
                                        no solo al abrirlo. */}
                                    {c.total_pendientes > 0 && !c.pendientes_como_cero && (
                                        <Badge variant="danger" size="sm" uppercase={false}>Parcial</Badge>
                                    )}
                                </div>
                            </DataCell>
                            <DataCell align="center">
                                {c.total_diferencias > 0 ? (
                                    <Badge variant="warning" icon={AlertTriangle} uppercase={false}>{c.total_diferencias}</Badge>
                                ) : c.total_diferencias === 0 ? (
                                    <span className="text-caption font-bold text-success">Sin diferencias</span>
                                ) : <span className="text-content-3">—</span>}
                            </DataCell>
                            {canVerMontos && (
                                <DataCell align="right" hideBelow="lg">
                                    <span className={`text-label font-bold tabular-nums ${valorNeto < 0 ? 'text-danger' : valorNeto > 0 ? 'text-chart-1-text' : 'text-content-3'}`}>{formatMoney(valorNeto)}</span>
                                </DataCell>
                            )}
                            <DataCell align="center">
                                <div className="flex flex-col items-center gap-1">
                                    <Badge variant={es.variante} size="sm" icon={es.icon}>{es.label}</Badge>
                                    {/* Aprobado no es el final: el stock lo corrige el ERP.
                                        Un conteo firmado y sin ajustar es trabajo a medias. */}
                                    {c.status === 'CERRADO' && c.total_diferencias > 0 && !c.ajuste_erp_aplicado && (
                                        <Badge variant="warning" size="sm" icon={FileSpreadsheet} uppercase={false}>Falta ajuste</Badge>
                                    )}
                                </div>
                            </DataCell>
                            <DataCell align="right">
                                {/* `stopPropagation`: la fila entera navega al conteo, y
                                    sin esto el click en la papelera abriría el detalle
                                    además de la confirmación. */}
                                <span className="inline-flex items-center gap-1 justify-end">
                                    {puedeBorrar(c) && (
                                        <Button variant="ghost" tone="danger" size="sm" icon={Trash2} iconOnly
                                            aria-label={`Eliminar el conteo de ${c.branches?.name || 'la sucursal'}`}
                                            onClick={(e) => { e.stopPropagation(); setABorrar(c); }} />
                                    )}
                                    {/* Solo en la tabla de verdad: por debajo de 1024px
                                        `DataTable` pinta fichas, y ahí esta celda va a la
                                        tira de acciones — donde un chevron decorativo al
                                        lado de la papelera se lee como un segundo botón.
                                        `lg` es exactamente el corte que usa el canónico. */}
                                    <ChevronRight size={16} className="hidden lg:inline text-content-3" />
                                </span>
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>
            </div>
            </div>

            <NuevoConteoModal
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                onCreated={(id) => navigate(`/conteo-inventario/${id}`)}
            />

            {/* Las opciones de una fila del teléfono. `HojaMovil` es el cuerpo
                canónico y nace en gota del punto que se mantuvo presionado — el
                rectángulo lo toma solo de `leerUltimoToque()`, que escucha el
                `pointerdown` en captura, o sea el mismo con el que arrancó el
                gesto (500ms, muy dentro de sus 1200ms de vigencia). */}
            <ModalShell
                open={opcionesAbierto}
                onClose={() => setOpcionesAbierto(false)}
                align="bottom"
                maxWidthClass="max-w-none"
                surface={null}
                ariaLabel="Opciones del conteo"
            >
                {opciones && (
                    <HojaMovil
                        titulo={opciones.branches?.name || 'Conteo'}
                        subtitulo={`${fmtDate(opciones.created_at)} · ${(ESTADO_CFG[opciones.status] || ESTADO_CFG.BORRADOR).label}`}
                        icono={ClipboardCheck}
                    >
                        <div className="space-y-2">
                            <ListRow
                                icon={ChevronRight}
                                title="Abrir conteo"
                                subtitle="Ver y capturar los renglones"
                                // Se cierra apagando el ABIERTO, nunca vaciando el
                                // conteo: el cuerpo tiene que seguir dibujado
                                // mientras la hoja hace su salida.
                                onClick={() => { const id = opciones.id; setOpcionesAbierto(false); navigate(`/conteo-inventario/${id}`); }}
                            />
                            {puedeBorrar(opciones) ? (
                                <ListRow
                                    icon={Trash2}
                                    tone="danger"
                                    title="Eliminar conteo"
                                    subtitle="Se borran los renglones y el historial"
                                    // Encadena a la confirmación de siempre, no borra
                                    // acá: el gesto acerca la acción, no la abarata.
                                    onClick={() => { setOpcionesAbierto(false); setABorrar(opciones); }}
                                />
                            ) : (
                                // Decir por qué no está es mejor que una hoja con una
                                // sola opción y ningún motivo. Es justo lo que un
                                // deslizamiento no puede hacer: fallar en silencio.
                                <p className="text-caption text-content-3 px-1">
                                    Este conteo ya está {(ESTADO_CFG[opciones.status] || ESTADO_CFG.BORRADOR).label.toLowerCase()};
                                    para borrarlo hace falta el permiso de eliminar conteos.
                                </p>
                            )}
                        </div>
                    </HojaMovil>
                )}
            </ModalShell>

            {/* Desde la lista no se ve cuánto se contó —esa cifra vive adentro—,
                así que el mensaje se apoya en lo que la fila SÍ dice: de qué
                sucursal es, de qué día y en qué estado está. */}
            <ConfirmModal
                isOpen={!!aBorrar}
                onClose={() => setABorrar(null)}
                onConfirm={confirmarBorrado}
                title="¿Eliminar este conteo?"
                message={aBorrar
                    ? `Se borra el conteo de ${aBorrar.branches?.name || 'la sucursal'} del ${fmtDate(aBorrar.created_at)} (${(ESTADO_CFG[aBorrar.status] || ESTADO_CFG.BORRADOR).label}) con todos sus renglones y el historial de quién contó cada uno. No se puede deshacer.`
                    : ''}
                confirmText="Eliminar conteo"
                isProcessing={borrando}
            />
        </GlassViewLayout>
    );
}
