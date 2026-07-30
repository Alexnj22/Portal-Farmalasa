import React, { useEffect, useState, useCallback, useRef } from 'react';
import Button from '../../components/common/Button';
import ViewTabBar from '../../components/common/ViewTabBar';
import Badge from '../../components/common/Badge';
import { SkeletonText } from '../../components/common/StateViews';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ClipboardCheck, ChevronLeft, Printer, CheckCircle2, ShieldCheck, Loader2,
    Plus, X, Package, FlaskConical, Radio, Pencil, PackageX, EyeOff,
    FileSpreadsheet, Download,
} from 'lucide-react';
import LiquidAvatar from '../../components/common/LiquidAvatar';
import GlassViewLayout from '../../components/GlassViewLayout';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination from '../../components/common/TablePagination';
import LiquidSelect from '../../components/common/LiquidSelect';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import LiquidModal from '../../components/common/LiquidModal';
import PromptModal from '../../components/common/PromptModal';
import { useStaffStore } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import { useToastStore } from '../../store/toastStore';
import {
    printHojaConteo, printResultadosConteo, printAjustesConteo, exportAjustesConteo,
} from '../../utils/conteoInventarioPrint';
import {
    searchActiveProductsForConteo, fetchProductPresentacionesForConteo, fetchErpSucursalIdsForBranch,
    fetchInventoryLotesForProduct,
} from '../../data/conteoInventario';
import SegmentedControl from '../../components/common/SegmentedControl';
import PortalInput from '../../components/common/PortalInput';
import Switch from '../../components/common/Switch';
import Notice from '../../components/common/Notice';
import { formatMoney } from '../../utils/formatNumber';

const PAGE_SIZE = 25;

// `variante` es lo que consume Badge. Faltaba: la cabecera pasaba
// `variant={es.variante}` contra un mapa que solo tenía bg/text/label, así que
// el badge de estado se renderizaba siempre con la variante por defecto.
// 'APROBADO' no está porque nunca existió: aprobar escribe 'CERRADO'.
const ESTADO_CFG = {
    BORRADOR:    { label: 'Borrador',    variante: 'neutral' },
    EN_PROGRESO: { label: 'En Progreso', variante: 'warning' },
    FINALIZADO:  { label: 'Finalizado',  variante: 'chart-1' },
    CERRADO:     { label: 'Cerrado',     variante: 'success' },
};

const FILTRO_PILLS = [
    { key: 'TODOS', label: 'Todos' },
    { key: 'PENDIENTES', label: 'Pendientes' },
    { key: 'DIFERENCIA', label: 'Con diferencia' },
    { key: 'SIN_UBICAR', label: 'No ubicados' },
];

// Las columnas del sistema no se declaran si el conteo es ciego: la RPC ya
// devuelve NULL ahí, así que una columna "Sistema" llena de ••• sería un hueco
// que además invita a preguntar por qué está tapada.
//
// `sortable` solo donde el orden significa algo: la unidad que el servidor
// pagina y ordena es el PRODUCTO, no el renglón. Lote, vencimiento y autoría son
// del renglón —ordenar por ellos tendría que romper los grupos, o sea deshacer
// justo lo que hace que un producto con 14 lotes no se parta entre dos páginas—.
// "Estado" ordena por progreso (contados/total), que es lo que esa celda muestra
// en la banda del producto.
//
// Los rótulos son cortos a propósito: el `<th>` es `whitespace-nowrap`, así que
// una palabra larga no se parte, empuja el ancho de la tabla y termina fuera del
// marco. "Diferencia" era la que se cortaba ("DIFERENC…"); "Dif." es además lo
// que ya usa el reporte impreso.
const columnas = (verSistema) => [
    { key: 'producto', label: 'Producto', sortable: true },
    { key: 'laboratorio', label: 'Laboratorio', hideBelow: 'xl', sortable: true },
    { key: 'presentacion', label: 'Present.', align: 'center', hideBelow: 'lg' },
    { key: 'lote', label: 'Lote' },
    { key: 'vence', label: 'Vence', align: 'center', hideBelow: 'xl' },
    { key: 'quien', label: 'Contó', hideBelow: 'lg' },
    ...(verSistema ? [{ key: 'sistema', label: 'Sistema', align: 'center', sortable: true }] : []),
    { key: 'fisico', label: 'Físico', align: 'center', sortable: true },
    ...(verSistema ? [{ key: 'diferencia', label: 'Dif.', align: 'center', sortable: true }] : []),
    { key: 'nota', label: 'Nota', hideBelow: 'xl' },
    { key: 'estado', label: 'Estado', align: 'center', sortable: true },
];

// La columna "Estado" ordena por otra cosa que su propia clave: el servidor no
// sabe de "estado", sabe de progreso. El mapa está acá y no en la RPC para que
// la lista blanca del servidor siga siendo la de los nombres que él entiende.
const ORDEN_SERVIDOR = { estado: 'progreso' };

const fmtDate = (iso) => {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
};
const fmtMoney = (n) => formatMoney(n);
const fmtDateTime = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-SV', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};
// Solo la hora: en la línea de autoría la fecha es siempre la del conteo en
// curso, así que repetirla en cada lote gasta ancho sin decir nada. La fecha
// completa sigue en el `title` y en el historial.
const fmtHora = (iso) => (iso ? new Date(iso).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' }) : '—');
const difClass = (dif) => (dif == null ? 'text-content-3' : dif === 0 ? 'text-success' : dif < 0 ? 'text-danger' : 'text-chart-1-text');
const difLabel = (dif) => (dif == null ? '—' : dif > 0 ? `+${dif}` : String(dif));

// Umbral "próximo a vencer" — mismo valor usado en get_conteo_products_page
// para que el aviso a nivel de grupo (sin expandir) y el de la línea coincidan.
const VENCE_UMBRAL_DIAS = 90;
function vencimientoStatus(fechaVencimiento) {
    if (!fechaVencimiento) return null;
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const fecha = new Date(`${fechaVencimiento}T00:00:00`);
    const diffDias = Math.round((fecha - hoy) / 86400000);
    if (diffDias < 0) return 'VENCIDO';
    if (diffDias <= VENCE_UMBRAL_DIAS) return 'PROXIMO';
    return null;
}
function VencimientoBadge({ status }) {
    if (!status) return null;
    if (status === 'VENCIDO') return <Badge variant="danger" size="sm" className="shrink-0">Vencido</Badge>;
    return <Badge variant="warning" size="sm" className="shrink-0">Por vencer</Badge>;
}

// Indicador "en vivo" — animate-pulse de Tailwind usa un único keyframe
// compartido sin animation-delay por instancia, así que todos laten en fase
// (no c/u a su ritmo) y el costo es una sola propiedad opacity por GPU.
function LiveBadge() {
    return (
        <Badge title="En vivo — se actualiza hasta que se cuente" variant="success" size="sm" icon={Radio}>Vivo</Badge>
    );
}

// Qué pasó en cada fila del historial. El discriminador lo escribe la BD
// (columna `evento`); antes las cuatro clases de evento se veían idénticas y el
// único indicio era el texto de la nota, que el usuario puede pisar.
const EVENTO_CFG = {
    CAPTURA:  { label: 'Capturó',           variante: 'success' },
    EDICION:  { label: 'Editó',             variante: 'warning' },
    BORRADO:  { label: 'Borró la cantidad', variante: 'danger'  },
    RECUENTO: { label: 'Recontó',           variante: 'chart-1' },
    LOTE:     { label: 'Corrigió el lote',  variante: 'chart-9' },
    CIERRE:   { label: 'Cerró sin ubicar',  variante: 'neutral' },
};

// Máscara del recuento: el supervisor no ve ni el sistema ni el primer conteo
// hasta registrar el suyo. El ciego del conteo normal ya no pasa por acá — el
// número no viene en la respuesta.
const TAPADO = '•••';

// Quién puso la cantidad y cuándo, en la línea misma — no escondido detrás de un
// clic. Abre el historial completo, que es donde se ve si alguien la cambió.
//
// Una sola línea a propósito: en el teléfono hay una de estas por LOTE, y
// apilarla en tres renglones (avatar, nombre, fecha) empujaba el siguiente lote
// fuera de la pantalla.
function AutorLinea({ nombre, fotoUrl, cuando, ediciones = 0, onClick }) {
    if (!nombre && !cuando) return null;
    const titulo = `Contado por ${nombre || 'desconocido'} · ${fmtDateTime(cuando)}`
        + (ediciones > 0 ? ` · editada ${ediciones} ${ediciones === 1 ? 'vez' : 'veces'}` : '')
        + ' — ver historial';
    return (
        <Button variant="ghost" size="sm" onClick={onClick} title={titulo} className="min-w-0 max-w-full">
            <span className="flex items-center gap-1.5 min-w-0">
                <LiquidAvatar src={fotoUrl} alt="" fallbackText={nombre || '?'}
                    className="w-5 h-5 rounded-full shrink-0" />
                <span className="text-label font-bold text-content-2 truncate">{nombre || 'Desconocido'}</span>
                <span className="text-micro text-content-3 tabular-nums shrink-0">{fmtHora(cuando)}</span>
                {ediciones > 0 && <Badge variant="warning" size="sm" className="shrink-0">{ediciones} ed.</Badge>}
            </span>
        </Button>
    );
}

function ItemRow({
    item, index, editable, recuento, desbloqueada,
    onUnlock, onSave, onRecount, onShowHistory, onEditLote, currentUser,
}) {
    const { showToast } = useToastStore();
    const verSistema = !!item.ver_sistema;
    // En recuento el campo arranca VACÍO: precargarlo con el primer conteo
    // sería mostrarle al supervisor justo el número que viene a verificar.
    const [fisico, setFisico] = useState(recuento ? '' : (item.fisico_cantidad ?? ''));
    // Se revela solo lo que este supervisor ya recontó en esta sesión.
    const [revelado, setRevelado] = useState(false);
    const [nota, setNota] = useState(item.nota ?? '');
    const [sistema, setSistema] = useState(item.sistema_cantidad);
    const [contadoPorNombre, setContadoPorNombre] = useState(item.contado_por_nombre ?? null);
    const [contadoPorFoto, setContadoPorFoto] = useState(item.contado_por_photo_url ?? null);
    const [contadoAt, setContadoAt] = useState(item.contado_at ?? null);
    const [ediciones, setEdiciones] = useState(item.ediciones_count ?? 0);
    const [estadoItem, setEstadoItem] = useState(item.estado_item);
    const [saving, setSaving] = useState(false);
    // Última combinación efectivamente guardada — evita que un blur sin
    // cambios (ej. Tab entre celdas) dispare un guardado/historial redundante.
    const lastSaved = useRef({ fisico: item.fisico_cantidad ?? null, nota: item.nota ?? null, estado: item.estado_item });

    useEffect(() => {
        setFisico(recuento ? '' : (item.fisico_cantidad ?? ''));
        setRevelado(false);
        setNota(item.nota ?? '');
        setSistema(item.sistema_cantidad);
        setContadoPorNombre(item.contado_por_nombre ?? null);
        setContadoPorFoto(item.contado_por_photo_url ?? null);
        setContadoAt(item.contado_at ?? null);
        setEdiciones(item.ediciones_count ?? 0);
        setEstadoItem(item.estado_item);
        lastSaved.current = { fisico: item.fisico_cantidad ?? null, nota: item.nota ?? null, estado: item.estado_item };
    }, [item.id, item.sistema_cantidad, item.fisico_cantidad, item.contado_at, item.contado_por_nombre,
        item.contado_por_photo_url, item.ediciones_count, item.estado_item, item.nota, recuento]);

    // Estimado inmediato con el "sistema" ya visible (en vivo si aún no se ha
    // contado) — el valor definitivo llega en la respuesta de guardar_conteo_item,
    // que releyó inventory en el instante exacto del guardado.
    const dif = fisico !== '' && sistema != null ? Number(fisico) - sistema : null;
    const isLive = item.fisico_cantidad == null && !item.es_agregado_manual;

    // Una línea ya confirmada NO es un campo. Una celda que sigue pareciendo un
    // input invita a teclear encima de lo ya contado; el lápiz es el único
    // camino de vuelta, y por eso deja rastro en el historial.
    const confirmada = !recuento && estadoItem !== 'PENDIENTE';
    const bloqueada = editable && confirmada && !desbloqueada;

    // El recuento se tapa al primer conteo además del sistema: si el supervisor
    // ve que decía 12, escribe 12. Se destapa recién cuando registró el suyo.
    const tapado = recuento && !revelado;
    const puedeEscribir = recuento ? !revelado : (editable && !bloqueada);

    // Devuelve la celda al último valor confirmado por el servidor. Se usa en
    // todo camino de fallo: dejar el número tecleado en pantalla haría que el
    // contador lo diera por guardado y nunca volviera a esa línea.
    const revertToLastSaved = () => {
        const prev = lastSaved.current;
        setFisico(prev.fisico ?? '');
        setNota(prev.nota ?? '');
    };

    // Recuento: se guarda por su propia RPC, que exige can_approve, rechaza que
    // lo haga quien contó la línea y preserva el primer conteo.
    const commitRecuento = async () => {
        const valor = fisico === '' ? null : Number(fisico);
        if (valor === null) return;
        if (!Number.isInteger(valor) || valor < 0) {
            showToast('Cantidad inválida', 'El recuento debe ser un número entero de 0 o más.', 'error');
            setFisico('');
            return;
        }
        setSaving(true);
        try {
            const result = await onRecount(item.id, { fisicoCantidad: valor, nota: nota.trim() || null });
            setSistema(result.sistema_cantidad);
            setEstadoItem(valor === 0 && result.sistema_cantidad > 0 ? 'SIN_UBICAR' : 'CONTADO');
            setRevelado(true);
        } catch (err) {
            setFisico('');
            showToast('No se guardó el recuento', `${item.product_nombre || 'Esta línea'}: ${err.message}`, 'error');
        } finally {
            setSaving(false);
        }
    };

    const commit = async () => {
        if (recuento) return commitRecuento();
        if (!editable) return;
        const nextFisico = fisico === '' ? null : Number(fisico);
        const nextNota = nota.trim() || null;
        const nextEstado = nextFisico !== null ? 'CONTADO' : 'PENDIENTE';
        const prev = lastSaved.current;
        if (prev.fisico === nextFisico && prev.nota === nextNota && prev.estado === nextEstado) return;

        // Un conteo físico es un entero no negativo. Sin esto, "5.5" o "-3"
        // llegaban a un parámetro integer y reventaban en el servidor.
        if (nextFisico !== null && (!Number.isInteger(nextFisico) || nextFisico < 0)) {
            showToast('Cantidad inválida', 'El conteo físico debe ser un número entero de 0 o más.', 'error');
            revertToLastSaved();
            return;
        }

        setSaving(true);
        try {
            const result = await onSave(item.id, {
                fisicoCantidad: nextFisico,
                nota: nextNota,
                estadoItem: nextEstado,
            });
            lastSaved.current = { fisico: nextFisico, nota: nextNota, estado: nextEstado };
            setSistema(result.sistema_cantidad);
            setEstadoItem(nextEstado);
            // SIN_CAMBIO: la RPC no tocó la fila (ni el sistema, ni la autoría).
            // Reflejarlo acá como si alguien hubiera contado sería mentir sobre
            // quién y cuándo — y es justo el caso de abrir el lápiz y salir.
            if (result.evento !== 'SIN_CAMBIO') {
                setContadoPorNombre(currentUser?.name ?? contadoPorNombre);
                setContadoPorFoto(currentUser?.photo ?? contadoPorFoto);
                setContadoAt(new Date().toISOString());
                if (result.evento === 'EDICION' || result.evento === 'BORRADO') setEdiciones((k) => k + 1);
            }
            // Confirmar vuelve a bloquear: el estado normal de una línea contada
            // es cerrada, y desbloquearla es siempre un acto explícito.
            if (nextFisico !== null) onUnlock(item.id, false);
        } catch (err) {
            revertToLastSaved();
            showToast('No se guardó el conteo', `${item.product_nombre || 'Esta línea'}: ${err.message}`, 'error');
        } finally {
            setSaving(false);
        }
    };

    // "No ubicado" ≠ "no lo he contado todavía". El primero es un hallazgo del
    // conteo (lo busqué, no está: su faltante es real); el segundo es trabajo
    // pendiente. SIN_UBICAR era un estado válido en la BD y un filtro en la
    // RPC, pero la UI solo sabía escribir CONTADO y PENDIENTE.
    const marcarNoUbicado = async () => {
        if (!editable || saving) return;
        setSaving(true);
        try {
            const result = await onSave(item.id, { fisicoCantidad: 0, nota: nota.trim() || null, estadoItem: 'SIN_UBICAR' });
            lastSaved.current = { fisico: 0, nota: nota.trim() || null, estado: 'SIN_UBICAR' };
            setFisico(0);
            setSistema(result.sistema_cantidad);
            setEstadoItem('SIN_UBICAR');
            if (result.evento !== 'SIN_CAMBIO') {
                setContadoPorNombre(currentUser?.name ?? contadoPorNombre);
                setContadoPorFoto(currentUser?.photo ?? contadoPorFoto);
                setContadoAt(new Date().toISOString());
            }
            onUnlock(item.id, false);
        } catch (err) {
            showToast('No se marcó el renglón', err.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    // Contar es teclear seguido sin levantar la vista del anaquel: las flechas
    // recorren los campos y Enter salta al siguiente que falta.
    //
    // `offsetParent !== null` NO es de más: la tabla y las tarjetas del teléfono
    // están las DOS en el DOM (el corte es `md:hidden`, que oculta pero no quita),
    // así que sin el filtro cada línea aporta dos campos y la flecha abajo salta
    // al gemelo invisible del otro layout.
    const handleFisicoKeyDown = (e) => {
        const campos = () => Array.from(document.querySelectorAll('input[data-fisico-input="true"]'))
            .filter((el) => el.offsetParent !== null);
        if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
            const pendiente = campos().find((el) => el !== e.currentTarget && el.value === '');
            if (pendiente) { pendiente.focus(); pendiente.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
            return;
        }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const inputs = campos();
        const idx = inputs.indexOf(e.currentTarget);
        const next = e.key === 'ArrowDown' ? inputs[idx + 1] : inputs[idx - 1];
        if (next) { next.focus(); next.select(); }
    };

    return (
        <DataRow index={index} className={bloqueada ? 'bg-success/5' : 'bg-surface-card-hover/30'}>
            <DataCell><span className="text-content-3 text-label">↳</span></DataCell>
            <DataCell hideBelow="xl" />
            <DataCell align="center" hideBelow="lg"><span className="text-label font-semibold text-content-2">{item.presentacion || '—'}</span></DataCell>
            <DataCell>
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-label text-content-2 tabular-nums">{item.lote || '—'}</span>
                    {/* El ERP separa el stock vencido en su propia área. Sin esta
                        marca, esa fila y la del stock bueno se veían idénticas
                        (mismo producto, presentación, lote y fecha) y el
                        contador no sabía cuál de las dos estaba llenando. */}
                    {item.is_vencidos && <Badge variant="danger" size="sm" className="shrink-0">Área vencidos</Badge>}
                    {item.es_agregado_manual && <Badge variant="chart-9" size="sm" className="shrink-0">Agregado</Badge>}
                    {editable && (
                        <Button variant="ghost" icon={Pencil} disabled={saving} title="Corregir lote/vencimiento" iconOnly onClick={() => onEditLote(item)} />
                    )}
                </div>
            </DataCell>
            <DataCell align="center" hideBelow="xl">
                <div className="flex items-center justify-center gap-1">
                    <span className="text-label text-content-3 tabular-nums">{fmtDate(item.fecha_vencimiento)}</span>
                    <VencimientoBadge status={vencimientoStatus(item.fecha_vencimiento)} />
                </div>
            </DataCell>
            <DataCell hideBelow="lg">
                <AutorLinea
                    nombre={contadoPorNombre} fotoUrl={contadoPorFoto} cuando={contadoAt}
                    ediciones={ediciones} onClick={() => onShowHistory(item)}
                />
            </DataCell>
            {verSistema && (
                <DataCell align="center">
                    {tapado ? (
                        <span className="text-body-sm font-bold text-content-3 tabular-nums" title="Oculto hasta que registrés tu recuento">{TAPADO}</span>
                    ) : (
                        <div className="flex items-center justify-center gap-1.5">
                            <span className="text-body-sm font-bold text-content-2 tabular-nums">{sistema ?? '—'}</span>
                            {isLive && <LiveBadge />}
                        </div>
                    )}
                </DataCell>
            )}
            <DataCell align="center">
                <div className="flex flex-col items-center gap-0.5">
                    <div className="flex items-center justify-center gap-1">
                        {bloqueada ? (
                            <>
                                {/* Ya confirmada: el número se muestra, no se ofrece. */}
                                <span className="inline-flex items-center justify-center min-w-16 h-9 px-2 rounded-xl
                                                 border border-success/40 bg-success/10 text-success
                                                 text-body-xl font-bold tabular-nums">
                                    {fisico}
                                </span>
                                <Button variant="ghost" icon={Pencil} disabled={saving}
                                    title="Corregir esta cantidad — queda registrado en el historial"
                                    aria-label={`Corregir la cantidad de ${item.product_nombre || 'esta línea'}, lote ${item.lote || 'sin lote'}`}
                                    iconOnly onClick={() => onUnlock(item.id, true)} />
                            </>
                        ) : (
                            <>
                                <PortalInput
                                    aria-label={recuento ? 'Cantidad del recuento' : 'Cantidad física contada'}
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={fisico}
                                    onChange={(e) => setFisico(e.target.value)}
                                    placeholder={recuento && !revelado ? 'Recontar' : '—'}
                                    onKeyDown={handleFisicoKeyDown}
                                    onBlur={commit}
                                    readOnly={!puedeEscribir}
                                    compact
                                    data-fisico-input="true"
                                    inputClassName="text-center text-body-xl font-bold"
                                    className="w-16"
                                />
                                {editable && !recuento && (
                                    <Button variant="ghost" icon={PackageX} disabled={saving}
                                        title="No ubicado — lo busqué y no está en el anaquel"
                                        aria-label="Marcar como no ubicado"
                                        iconOnly onClick={marcarNoUbicado} />
                                )}
                            </>
                        )}
                    </div>
                    {/* Solo después de registrar el recuento: ver si coincidió con
                        el primer conteo es la métrica de calidad de ese conteo. */}
                    {!tapado && item.fisico_primer_conteo != null && (
                        <span className={`text-micro font-bold tabular-nums ${item.fisico_primer_conteo === Number(fisico) ? 'text-success' : 'text-warning-text'}`}>
                            1er conteo: {item.fisico_primer_conteo}
                        </span>
                    )}
                </div>
            </DataCell>
            {verSistema && (
                <DataCell align="center">
                    {tapado ? (
                        <span className="text-body-sm font-black text-content-3 tabular-nums">{TAPADO}</span>
                    ) : (
                        <span className={`text-body-sm font-black tabular-nums ${difClass(dif)}`}>{difLabel(dif)}</span>
                    )}
                </DataCell>
            )}
            <DataCell hideBelow="xl">
                <PortalInput
                    aria-label="Nota del conteo"
                    type="text"
                    value={nota}
                    onChange={(e) => setNota(e.target.value)}
                    placeholder="Nota..."
                    onBlur={commit}
                    readOnly={!editable}
                    compact
                    inputClassName="text-body-xl"
                />
            </DataCell>
            <DataCell align="center">
                <div className="flex flex-col items-center gap-0.5">
                    {estadoItem === 'SIN_UBICAR'
                        ? <Badge variant="danger" size="sm" icon={PackageX}>No ubicado</Badge>
                        : estadoItem === 'CONTADO'
                            ? <CheckCircle2 size={14} className="text-success" />
                            : <span className="text-content-3 text-micro">Pendiente</span>}
                    {(item.recontado_at || revelado) && (
                        <Badge variant="chart-1" size="sm" icon={ShieldCheck}
                            title={item.recontado_por_nombre ? `Recontado por ${item.recontado_por_nombre}` : 'Recontado'}>
                            Recontada
                        </Badge>
                    )}
                </div>
            </DataCell>
        </DataRow>
    );
}

function ProductGroupRow({ product, index, verSistema }) {
    const dif = product.diferencia_total;
    // Todos sus lotes confirmados: la banda deja de llamar. Es la señal que se
    // busca al recorrer un anaquel — qué falta, no qué ya está.
    const completo = product.item_count > 0 && product.contados_count >= product.item_count;
    return (
        <DataRow index={index} className={completo ? 'bg-success/10' : ''}>
            <DataCell className="w-[280px]">
                <div className="flex items-center gap-1.5 min-w-0">
                    <p className={`font-bold text-body-sm truncate ${completo ? 'text-success' : 'text-content'}`}>
                        {product.product_nombre || `Producto ${product.erp_product_id}`}
                    </p>
                    {product.es_antibiotico && <Badge variant="danger" size="sm" className="shrink-0">Bajo Receta</Badge>}
                </div>
            </DataCell>
            <DataCell hideBelow="xl"><span className="text-label text-content-3 truncate">{product.laboratorio_nombre || '—'}</span></DataCell>
            <DataCell align="center" hideBelow="lg">
                <Badge uppercase={false} variant={completo ? 'success' : 'neutral'}>
                    {product.item_count} lote{product.item_count === 1 ? '' : 's'}
                </Badge>
            </DataCell>
            <DataCell />
            <DataCell align="center" hideBelow="xl">
                <div className="flex items-center justify-center gap-1">
                    {product.con_vencidos_count > 0 && <VencimientoBadge status="VENCIDO" />}
                    {product.con_proximos_count > 0 && <VencimientoBadge status="PROXIMO" />}
                </div>
            </DataCell>
            <DataCell hideBelow="lg" />
            {verSistema && (
                <DataCell align="center">
                    <span className="text-body-sm font-black text-content-2 tabular-nums">{product.sistema_total ?? '—'}</span>
                </DataCell>
            )}
            <DataCell align="center"><span className="text-body-sm font-black text-content-2 tabular-nums">{product.fisico_total ?? '—'}</span></DataCell>
            {verSistema && (
                <DataCell align="center">
                    <span className={`text-body-sm font-black tabular-nums ${difClass(dif)}`}>{difLabel(dif)}</span>
                </DataCell>
            )}
            <DataCell hideBelow="xl" />
            <DataCell align="center">
                <span className={`text-caption font-bold tabular-nums ${completo ? 'text-success' : 'text-content-3'}`}>
                    {product.contados_count}/{product.item_count}
                </span>
            </DataCell>
        </DataRow>
    );
}

// ── Teléfono ────────────────────────────────────────────────────────────────
// DESIGN.md §32 anota como hueco que `DataTable` no se convierte en tarjetas.
// Acá se cierra para esta vista, porque es la única que se usa de pie en un
// pasillo: una tarjeta por PRODUCTO con sus lotes adentro (el producto repetido
// por lote se leía como dos productos distintos), campo de 56px y todo objetivo
// táctil en 44px o más.
function LoteMovil({ item, editable, recuento, desbloqueada, onUnlock, onSave, onRecount, onShowHistory, currentUser }) {
    const { showToast } = useToastStore();
    const [fisico, setFisico] = useState(recuento ? '' : (item.fisico_cantidad ?? ''));
    const [estadoItem, setEstadoItem] = useState(item.estado_item);
    const [autor, setAutor] = useState({
        nombre: item.contado_por_nombre ?? null,
        foto: item.contado_por_photo_url ?? null,
        cuando: item.contado_at ?? null,
        ediciones: item.ediciones_count ?? 0,
    });
    const [saving, setSaving] = useState(false);
    const guardado = useRef(item.fisico_cantidad ?? null);

    useEffect(() => {
        setFisico(recuento ? '' : (item.fisico_cantidad ?? ''));
        setEstadoItem(item.estado_item);
        setAutor({
            nombre: item.contado_por_nombre ?? null,
            foto: item.contado_por_photo_url ?? null,
            cuando: item.contado_at ?? null,
            ediciones: item.ediciones_count ?? 0,
        });
        guardado.current = item.fisico_cantidad ?? null;
    }, [item.id, item.fisico_cantidad, item.estado_item, item.contado_at, item.contado_por_nombre,
        item.contado_por_photo_url, item.ediciones_count, recuento]);

    const confirmada = !recuento && estadoItem !== 'PENDIENTE';
    const bloqueada = editable && confirmada && !desbloqueada;

    const commit = async (valor, estado) => {
        if (saving) return;
        if (valor !== null && (!Number.isInteger(valor) || valor < 0)) {
            showToast('Cantidad inválida', 'El conteo físico debe ser un número entero de 0 o más.', 'error');
            setFisico(guardado.current ?? '');
            return;
        }
        if (!recuento && guardado.current === valor && estado === estadoItem) return;
        setSaving(true);
        try {
            const res = recuento
                ? await onRecount(item.id, { fisicoCantidad: valor, nota: null })
                : await onSave(item.id, { fisicoCantidad: valor, nota: item.nota ?? null, estadoItem: estado });
            guardado.current = valor;
            setEstadoItem(recuento ? (valor === 0 && res.sistema_cantidad > 0 ? 'SIN_UBICAR' : 'CONTADO') : estado);
            if (res.evento !== 'SIN_CAMBIO') {
                setAutor((a) => ({
                    nombre: currentUser?.name ?? a.nombre,
                    foto: currentUser?.photo ?? a.foto,
                    cuando: new Date().toISOString(),
                    ediciones: res.evento === 'EDICION' || res.evento === 'BORRADO' ? a.ediciones + 1 : a.ediciones,
                }));
            }
            if (valor !== null) onUnlock(item.id, false);
        } catch (err) {
            setFisico(guardado.current ?? '');
            showToast('No se guardó el conteo', `${item.product_nombre || 'Esta línea'}: ${err.message}`, 'error');
        } finally {
            setSaving(false);
        }
    };

    const onBlur = () => {
        const v = fisico === '' ? null : Number(fisico);
        if (v === null && !recuento) { onUnlock(item.id, false); return; }
        if (v === null) return;
        commit(v, 'CONTADO');
    };

    return (
        <div className="pt-2.5 mt-2.5 border-t border-dashed border-border-card first:border-t-0 first:mt-1 first:pt-0">
            <div className="flex items-baseline justify-between gap-2 flex-wrap mb-1.5">
                <span className={`text-label font-bold tabular-nums ${bloqueada ? 'text-success' : 'text-content-2'}`}>
                    Lote {item.lote || '—'}
                </span>
                <span className="text-caption text-content-3 tabular-nums">
                    {item.presentacion || '—'} · vence {fmtDate(item.fecha_vencimiento)}
                </span>
            </div>
            <div className="flex items-center gap-2 min-w-0">
                {bloqueada ? (
                    <>
                        {/* Confirmada: el número se muestra, no se ofrece. min-w-0 es
                            obligatorio — sin él el ancho intrínseco del contenido
                            empuja al lápiz fuera del marco en un teléfono angosto. */}
                        <span className="flex-1 min-w-0 h-14 grid place-items-center rounded-xl border
                                         border-success/50 bg-success/10 text-success
                                         text-display-sm font-bold tabular-nums">
                            {fisico}
                        </span>
                        <Button variant="secondary" icon={Pencil} iconOnly disabled={saving}
                            className="h-14 w-14 shrink-0"
                            aria-label={`Corregir la cantidad de ${item.product_nombre || 'esta línea'}, lote ${item.lote || 'sin lote'}`}
                            onClick={() => onUnlock(item.id, true)} />
                    </>
                ) : (
                    <>
                        <PortalInput
                            aria-label={`Cantidad de ${item.product_nombre || 'el producto'}, lote ${item.lote || 'sin lote'}`}
                            type="number" min="0" step="1" inputMode="numeric"
                            value={fisico}
                            onChange={(e) => setFisico(e.target.value)}
                            onBlur={onBlur}
                            placeholder={recuento ? 'Recontar' : '—'}
                            readOnly={!editable && !recuento}
                            data-fisico-input="true"
                            alto
                            className="flex-1 min-w-0"
                            inputClassName="text-center"
                        />
                        {editable && !recuento && (
                            <Button variant="secondary" icon={PackageX} iconOnly disabled={saving}
                                className="h-14 w-14 shrink-0"
                                aria-label="Marcar como no ubicado"
                                title="No ubicado — lo busqué y no está"
                                onClick={() => { setFisico(0); commit(0, 'SIN_UBICAR'); }} />
                        )}
                    </>
                )}
            </div>
            {(autor.nombre || estadoItem === 'SIN_UBICAR' || item.is_vencidos || item.es_agregado_manual) && (
                <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                    {item.is_vencidos && <Badge variant="danger" size="sm">Área vencidos</Badge>}
                    {item.es_agregado_manual && <Badge variant="chart-9" size="sm">Agregado</Badge>}
                    {estadoItem === 'SIN_UBICAR' && <Badge variant="danger" size="sm" icon={PackageX}>No ubicado</Badge>}
                    <AutorLinea
                        nombre={autor.nombre} fotoUrl={autor.foto} cuando={autor.cuando}
                        ediciones={autor.ediciones} onClick={() => onShowHistory(item)}
                    />
                </div>
            )}
        </div>
    );
}

function ProductCardMovil({ product, lines, desbloqueadas, ...rest }) {
    const completo = product.item_count > 0 && product.contados_count >= product.item_count;
    return (
        <div data-surface="card" className={`p-3 ${completo ? 'bg-success/10' : ''}`}>
            <div className="flex items-start justify-between gap-2">
                <p className={`font-bold text-body-sm leading-tight text-balance min-w-0 ${completo ? 'text-success' : 'text-content'}`}>
                    {product.product_nombre || `Producto ${product.erp_product_id}`}
                </p>
                <span className={`text-caption font-bold tabular-nums shrink-0 ${completo ? 'text-success' : 'text-content-3'}`}>
                    {product.contados_count}/{product.item_count}
                </span>
            </div>
            {product.es_antibiotico && <Badge variant="danger" size="sm" className="mt-1">Bajo Receta</Badge>}
            {lines
                ? lines.map((it) => (
                    <LoteMovil key={it.id} item={it} desbloqueada={!!desbloqueadas[it.id]} {...rest} />
                ))
                : <div className="mt-2"><SkeletonText lines={2} /></div>}
        </div>
    );
}

function ItemHistoryModal({ item, onClose }) {
    const fetchConteoItemHistory = useStaffStore((s) => s.fetchConteoItemHistory);
    const [history, setHistory] = useState(null);

    useEffect(() => {
        if (!item) return;
        setHistory(null); // eslint-disable-line react-hooks/set-state-in-effect -- reset antes de re-fetch al cambiar de item
        fetchConteoItemHistory(item.id).then(setHistory);
    }, [item, fetchConteoItemHistory]);

    return (
        <LiquidModal open={!!item} onClose={onClose} maxWidth="max-w-lg" ariaLabel={`Historial de conteo — ${item?.product_nombre || ''}`}>
            <div className="flex-none bg-transparent px-6 py-5 border-b border-border-card flex items-center justify-between relative z-base">
                <div>
                    <h3 className="font-black text-content text-subtitle">{item?.product_nombre}</h3>
                    <p className="text-caption text-content-3 uppercase tracking-widest font-bold">Historial de conteo · {item?.lote || 'sin lote'}</p>
                </div>
                <Button variant="destructive" size="sm" icon={X} iconOnly onClick={onClose} />
            </div>
            <div className="px-6 py-5 max-h-[60vh] overflow-y-auto relative z-base">
                {history === null ? (
                    <div className="flex items-center justify-center py-8"><SkeletonText lines={4} className="w-full max-w-md" /></div>
                ) : history.length === 0 ? (
                    <p className="text-body-sm text-content-3 text-center py-8">Sin registros todavía.</p>
                ) : (
                    <div className="space-y-2">
                        {history.map((h) => {
                            const ev = EVENTO_CFG[h.evento] || EVENTO_CFG.EDICION;
                            return (
                                <div key={h.id} className="bg-surface-card-hover rounded-xl p-3 flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <LiquidAvatar src={h.contado_por_photo_url} alt=""
                                            fallbackText={h.contado_por_nombre || '?'}
                                            className="w-9 h-9 rounded-full shrink-0" />
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <p className="text-label font-bold text-content-2 truncate">{h.contado_por_nombre || 'Desconocido'}</p>
                                                <Badge variant={ev.variante} size="sm" uppercase={false}>{ev.label}</Badge>
                                            </div>
                                            <p className="text-micro text-content-3 tabular-nums">{fmtDateTime(h.contado_at)}</p>
                                            {h.nota && <p className="text-caption text-content-3 italic mt-0.5 break-words">&ldquo;{h.nota}&rdquo;</p>}
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="text-label font-bold text-content-2 tabular-nums">
                                            {h.sistema_cantidad != null && <>Sist. {h.sistema_cantidad} · </>}Fís. {h.fisico_cantidad ?? '—'}
                                        </p>
                                        {h.diferencia != null && (
                                            <p className={`text-caption font-black tabular-nums ${difClass(h.diferencia)}`}>{difLabel(h.diferencia)}</p>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </LiquidModal>
    );
}

function EditLoteModal({ item, onClose, onSave }) {
    const { showToast } = useToastStore();
    const [lote, setLote] = useState('');
    const [fecha, setFecha] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!item) return;
        setLote(item.lote || '');
        setFecha(item.fecha_vencimiento || '');
    }, [item]);

    const handleSave = async () => {
        setSaving(true);
        try {
            await onSave(item.id, { lote: lote.trim() || null, fechaVencimiento: fecha || null });
            onClose();
        } catch (err) {
            showToast('No se corrigió el lote', err.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <LiquidModal open={!!item} onClose={onClose} maxWidth="max-w-sm" ariaLabel={`Corregir lote — ${item?.product_nombre || ''}`}>
            <div className="flex-none bg-transparent px-6 py-5 border-b border-border-card flex items-center justify-between relative z-base">
                <div>
                    <h3 className="font-black text-content text-subtitle">Corregir lote</h3>
                    <p className="text-caption text-content-3 uppercase tracking-widest font-bold truncate max-w-[220px]">{item?.product_nombre}</p>
                </div>
                <Button variant="destructive" size="sm" icon={X} iconOnly onClick={onClose} />
            </div>
            <div className="px-6 py-5 flex flex-col gap-3 relative z-base">
                <p className="text-label text-content-3">Usa esto cuando el lote físico encontrado no corresponde al de este renglón (ej. el ERP aún no sincronizó el lote nuevo). Solo corrige la etiqueta de este conteo — no modifica el inventario real.</p>
                <div>
                    <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1 block">Lote</label>
                    <PortalInput
                        aria-label="Lote"
                        type="text"
                        value={lote}
                        onChange={(e) => setLote(e.target.value)}
                        inputClassName="text-body-xl"
                    />
                </div>
                <div>
                    <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1 block">Fecha de vencimiento</label>
                    <LiquidDatePicker value={fecha} onChange={setFecha} />
                </div>
                <Button tone="chart-9" disabled={saving} onClick={handleSave}>{saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Guardar corrección</Button>
            </div>
        </LiquidModal>
    );
}

// Finalizar dejó de ser un sí/no. Antes, los renglones nunca tocados quedaban
// con diferencia NULL: fuera de total_diferencias y fuera de la valuación. Un
// conteo donde se contó el 5% se finalizaba y salía "sin diferencias". Qué son
// esos pendientes es una decisión contable, y tiene que tomarla una persona.
const TRATO_PENDIENTES = [
    { value: 'EXCLUIR', label: 'Dejarlos fuera del cálculo' },
    { value: 'CERO', label: 'Darlos por no ubicados (físico 0)' },
];

function FinalizarConteoModal({ open, pendientes, busy, onClose, onConfirm }) {
    const [trato, setTrato] = useState('EXCLUIR');

    // El default se restablece al salir, no con un efecto sobre `open`:
    // "excluir" es la opción conservadora y tiene que ser deliberado elegir la
    // otra cada vez, incluso si el modal se abre dos veces seguidas.
    const salir = (fn) => () => { setTrato('EXCLUIR'); fn(); };
    const handleClose = salir(onClose);
    const handleConfirm = () => { const comoCero = trato === 'CERO'; setTrato('EXCLUIR'); onConfirm(comoCero); };

    const hayPendientes = pendientes > 0;

    return (
        <LiquidModal open={open} onClose={handleClose} maxWidth="max-w-md" ariaLabel="Finalizar conteo">
            <div className="flex-none bg-transparent px-6 py-5 border-b border-border-card flex items-center justify-between relative z-base">
                <div>
                    <h3 className="font-black text-content text-subtitle">Finalizar Conteo</h3>
                    <p className="text-caption text-content-3 uppercase tracking-widest font-bold">Se calculan los resultados</p>
                </div>
                <Button variant="destructive" size="sm" icon={X} iconOnly onClick={handleClose} />
            </div>

            <div className="px-6 py-5 flex flex-col gap-3 relative z-base">
                <p className="text-label text-content-2">
                    Después de finalizar ya no se pueden editar cantidades. El conteo queda a la espera de que otra persona lo apruebe.
                </p>

                {hayPendientes ? (
                    <>
                        <Notice variant="warning">
                            Quedan <strong className="tabular-nums">{pendientes}</strong> renglón(es) sin cantidad física. Decidí qué son antes de cerrar:
                        </Notice>
                        <SegmentedControl
                            layout="block"
                            tone="chart-9"
                            label="Qué hacer con los renglones pendientes"
                            options={TRATO_PENDIENTES}
                            value={trato}
                            onChange={setTrato}
                        />
                        <p className="text-caption text-content-3 leading-snug">
                            {trato === 'CERO'
                                ? 'El conteo cubrió toda el área: lo que no apareció en el anaquel se registra con físico 0 y su faltante es real. Quedan marcados como "no ubicado", no como contados.'
                                : 'El conteo fue parcial: esos renglones no se valúan ni cuentan como diferencia. El número queda guardado en el reporte para que nadie lea el resultado como un cuadre completo.'}
                        </p>
                    </>
                ) : (
                    <Notice variant="success">Todos los renglones tienen cantidad física.</Notice>
                )}
            </div>

            <div className="flex-none px-6 py-4 border-t border-border-card flex justify-between items-center relative z-base">
                <Button variant="secondary" disabled={busy} onClick={handleClose}>Cancelar</Button>
                <Button icon={CheckCircle2} disabled={busy} loading={busy} onClick={handleConfirm}>
                    Finalizar
                </Button>
            </div>
        </LiquidModal>
    );
}

export default function ConteoDetailView() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user, hasPermission } = useAuth();
    const { showToast } = useToastStore();
    const canEdit = hasPermission('conteo_inventario', 'can_edit');
    const canApprove = hasPermission('conteo_inventario', 'can_approve');

    const fetchConteoDetalle = useStaffStore((s) => s.fetchConteoDetalle);
    const fetchConteoProductsPage = useStaffStore((s) => s.fetchConteoProductsPage);
    const fetchConteoItemsForProducts = useStaffStore((s) => s.fetchConteoItemsForProducts);
    const guardarConteoItem = useStaffStore((s) => s.guardarConteoItem);
    const editarLoteConteoItem = useStaffStore((s) => s.editarLoteConteoItem);
    const agregarProductoManualConteo = useStaffStore((s) => s.agregarProductoManualConteo);
    const finalizarConteoInventario = useStaffStore((s) => s.finalizarConteoInventario);
    const aprobarConteoInventario = useStaffStore((s) => s.aprobarConteoInventario);
    const fetchTodosLosItemsConteo = useStaffStore((s) => s.fetchTodosLosItemsConteo);
    const fetchConteoPendientesCount = useStaffStore((s) => s.fetchConteoPendientesCount);
    const marcarAjusteErp = useStaffStore((s) => s.marcarAjusteErp);
    const recontarConteoItem = useStaffStore((s) => s.recontarConteoItem);

    const [conteo, setConteo] = useState(null);
    const [products, setProducts] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');

    // Contrato estándar de todo buscador toggleable (DESIGN.md §24): Escape
    // cierra Y limpia; click afuera cierra SOLO si está vacío.
    const [filtro, setFiltro] = useState('TODOS');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [showAddForm, setShowAddForm] = useState(false);
    const [printing, setPrinting] = useState(false);
    const [historyItem, setHistoryItem] = useState(null);
    const [editLoteItem, setEditLoteItem] = useState(null);
    const [itemsByProduct, setItemsByProduct] = useState({});
    const [confirmFinalizarOpen, setConfirmFinalizarOpen] = useState(false);
    const [pendientesAlFinalizar, setPendientesAlFinalizar] = useState(0);
    const [promptAprobarOpen, setPromptAprobarOpen] = useState(false);
    const [promptAjusteOpen, setPromptAjusteOpen] = useState(false);
    // Qué líneas se desbloquearon con el lápiz. Es por LÍNEA y no un modo de la
    // vista: se corrige una cantidad puntual, no se "entra a editar todo".
    const [desbloqueadas, setDesbloqueadas] = useState({});
    // Recuento de supervisor: vive entre finalizar y aprobar. Antes es el
    // conteo normal; después ya está firmado y el ajuste salió al ERP.
    const [recuento, setRecuento] = useState(false);

    // El ciego ya NO es un estado de la vista. La RPC devuelve NULL en sistema y
    // diferencia si el llamador no tiene `conteo_ver_sistema` y el conteo sigue
    // abierto, y manda el flag para que la UI ni declare esas columnas. Antes era
    // un <Switch> con default encendido: cualquiera lo apagaba, y el número
    // viajaba igual en la respuesta.
    const verSistema = products.length > 0 ? !!products[0].ver_sistema : true;

    const setDesbloqueada = useCallback((itemId, abierta) => {
        setDesbloqueadas((prev) => {
            if (!!prev[itemId] === abierta) return prev;
            const next = { ...prev };
            if (abierta) next[itemId] = true; else delete next[itemId];
            return next;
        });
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [detalle, productsPage] = await Promise.all([
                fetchConteoDetalle(id),
                fetchConteoProductsPage(id, { page, pageSize: PAGE_SIZE, search, filtro }),
            ]);
            setConteo(detalle);
            setProducts(productsPage.rows);
            setTotal(productsPage.total);
            setDesbloqueadas({});

            // Nada se contrae: las líneas de los productos de la página vienen
            // de una sola llamada. Antes era una por producto, al expandirlo.
            const ids = productsPage.rows.map((r) => r.erp_product_id);
            const lines = await fetchConteoItemsForProducts(id, ids, { search, filtro });
            const porProducto = {};
            for (const it of lines) (porProducto[it.erp_product_id] ||= []).push(it);
            setItemsByProduct(porProducto);
        } catch (err) {
            showToast('Error', err.message, 'error');
        } finally {
            setLoading(false);
        }
    }, [id, page, search, filtro, fetchConteoDetalle, fetchConteoProductsPage, fetchConteoItemsForProducts, showToast]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { setPage(1); }, [search, filtro]);

    const editable = conteo && ['BORRADOR', 'EN_PROGRESO'].includes(conteo.status);
    const canFinalize = editable && canEdit;
    const canApproveNow = conteo?.status === 'FINALIZADO' && canApprove;
    const puedeRecontar = conteo?.status === 'FINALIZADO' && canApprove;
    const hasResults = conteo && ['FINALIZADO', 'CERRADO'].includes(conteo.status);

    // Recalcula los totales agregados del producto a partir de sus líneas ya
    // en memoria — evita un refetch de la página de productos por cada guardado.
    const recomputeProductTotals = (erpProductId, lines) => {
        const item_count = lines.length;
        const contados_count = lines.filter((l) => l.estado_item !== 'PENDIENTE').length;
        const con_diferencia_count = lines.filter((l) => l.diferencia != null && l.diferencia !== 0).length;
        const sistema_total = lines.reduce((sum, l) => sum + (l.sistema_cantidad ?? 0), 0);
        const contadas = lines.filter((l) => l.fisico_cantidad != null);
        const fisico_total = contadas.length ? contadas.reduce((sum, l) => sum + l.fisico_cantidad, 0) : null;
        const diferencia_total = contadas.length ? contadas.reduce((sum, l) => sum + (l.diferencia ?? 0), 0) : null;
        setProducts((prev) => prev.map((p) => (p.erp_product_id === erpProductId ? {
            ...p, item_count, contados_count, con_diferencia_count, sistema_total, fisico_total, diferencia_total,
        } : p)));
    };

    const handleSaveItem = async (itemId, payload, erpProductId) => {
        const result = await guardarConteoItem(itemId, payload);
        setItemsByProduct((prev) => {
            const lines = (prev[erpProductId] || []).map((it) => (it.id === itemId ? {
                ...it,
                fisico_cantidad: payload.fisicoCantidad,
                nota: payload.nota,
                estado_item: payload.estadoItem,
                sistema_cantidad: result.sistema_cantidad,
                diferencia: result.diferencia,
                contado_por_nombre: user?.name || it.contado_por_nombre,
                contado_at: new Date().toISOString(),
            } : it));
            recomputeProductTotals(erpProductId, lines);
            return { ...prev, [erpProductId]: lines };
        });
        return result;
    };

    const handleRecountItem = async (itemId, payload, erpProductId) => {
        const result = await recontarConteoItem(itemId, payload);
        setItemsByProduct((prev) => {
            const lines = (prev[erpProductId] || []).map((it) => (it.id === itemId ? {
                ...it,
                fisico_primer_conteo: result.fisico_primer_conteo,
                fisico_cantidad: payload.fisicoCantidad,
                sistema_cantidad: result.sistema_cantidad,
                diferencia: result.diferencia,
                recontado_at: new Date().toISOString(),
                recontado_por_nombre: user?.name || it.recontado_por_nombre,
            } : it));
            recomputeProductTotals(erpProductId, lines);
            return { ...prev, [erpProductId]: lines };
        });
        return result;
    };

    const handleEditLote = async (itemId, payload, erpProductId) => {
        const result = await editarLoteConteoItem(itemId, payload);
        setItemsByProduct((prev) => ({
            ...prev,
            [erpProductId]: (prev[erpProductId] || []).map((it) => (it.id === itemId ? { ...it, lote: result.lote, fecha_vencimiento: result.fecha_vencimiento } : it)),
        }));
        showToast('Lote corregido', 'Se actualizó la etiqueta del renglón', 'success');
    };

    const handleFinalizar = async () => {
        try {
            setPendientesAlFinalizar(await fetchConteoPendientesCount(id));
        } catch {
            setPendientesAlFinalizar(0);
        }
        setConfirmFinalizarOpen(true);
    };

    const confirmFinalizar = async (pendientesComoCero) => {
        setBusy(true);
        try {
            const res = await finalizarConteoInventario(id, pendientesComoCero);
            // El ciego se levanta solo: `conteo_puede_ver_sistema` deja de dar
            // false en cuanto el status sale de BORRADOR/EN_PROGRESO, y el
            // `load()` de abajo trae ya los números. No hay flag que apagar.
            showToast(
                'Conteo finalizado',
                `${res.total_diferencias} diferencia(s)${res.total_pendientes > 0 ? ` · ${res.total_pendientes} pendiente(s)` : ''}`,
                'success',
            );
            await load();
        } catch (err) {
            showToast('Error', err.message, 'error');
        } finally {
            setBusy(false);
            setConfirmFinalizarOpen(false);
        }
    };

    const handleAprobar = () => setPromptAprobarOpen(true);

    const confirmAprobar = async (nota) => {
        setBusy(true);
        try {
            await aprobarConteoInventario(id, nota);
            showToast('Conteo aprobado', 'Queda cerrado y con firma auditable', 'success');
            await load();
        } catch (err) {
            showToast('Error', err.message, 'error');
        } finally {
            setBusy(false);
            setPromptAprobarOpen(false);
        }
    };

    const handlePrint = async (kind) => {
        setPrinting(true);
        try {
            const allItems = await fetchTodosLosItemsConteo(id);
            // La hoja sale ciega porque el dato NO VIENE: get_conteo_items_jsonb
            // aplica el mismo predicado que la tabla. El flag se deriva de lo que
            // llegó, no de un switch — antes la vista pasaba { ciego: false } fijo
            // y el papel revelaba justo lo que la pantalla tapaba.
            if (kind === 'hoja') printHojaConteo(conteo, allItems, { ciego: !allItems[0]?.ver_sistema });
            else if (kind === 'ajuste') printAjustesConteo(conteo, allItems);
            else if (kind === 'ajuste-csv') exportAjustesConteo(conteo, allItems);
            else printResultadosConteo(conteo, allItems, { soloDiferencias: false });
        } catch (err) {
            showToast('Error al generar el documento', err.message, 'error');
        } finally {
            setPrinting(false);
        }
    };

    const confirmMarcarAjuste = async (nota) => {
        setBusy(true);
        try {
            await marcarAjusteErp(id, nota);
            showToast('Ajuste registrado', 'Queda constancia de que se aplicó en el ERP', 'success');
            await load();
        } catch (err) {
            showToast('Error', err.message, 'error');
        } finally {
            setBusy(false);
            setPromptAjusteOpen(false);
        }
    };

    const totalPages = Math.ceil(total / PAGE_SIZE) || 1;
    const es = conteo ? (ESTADO_CFG[conteo.status] || ESTADO_CFG.BORRADOR) : null;

    // D3.9 (2026-07-27): barra reescrita a mano → canónico. Aquí era buscador
    // puro: 26 líneas para lo que el componente ya hace.
    const filtersContent = (
        <ViewTabBar
            searchValue={search}
            onSearchChange={setSearch}
            placeholder="Buscar producto, laboratorio o lote..."
        />
    );

    return (
        <GlassViewLayout icon={ClipboardCheck} title="Conteo de Inventario" filtersContent={filtersContent}>
            <div className="p-4 md:p-6 lg:p-8 space-y-6">
                {conteo && (
                    <div data-surface="card" className="p-4 md:p-5">
                        {/* Volver vive acá y no en una fila propia arriba: era un botón
                            solo en 40px de alto, y el lugar donde uno busca "de dónde
                            vengo" es junto a de qué sucursal es lo que está mirando.
                            El rótulo es "Volver" y no "Volver a Conteos" porque el
                            destino ya lo dice el título de la vista. */}
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="flex items-start gap-2 min-w-0">
                                <Button variant="ghost" icon={ChevronLeft} onClick={() => navigate('/conteo-inventario')}>Volver</Button>
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <h2 className="text-body-xl font-black text-content">{conteo.branches?.name}</h2>
                                        <Badge variant={es.variante} size="sm" uppercase={false}>{es.label}</Badge>
                                    </div>
                                    <p className="text-caption text-content-2 uppercase tracking-wide">Iniciado {fmtDate(conteo.created_at?.split('T')[0])} · Alcance: {conteo.scope_type}</p>
                                </div>
                            </div>
                            {/* Un botón por documento eran hasta CUATRO ("Imprimir Hoja",
                                "Imprimir Resultados", "Ajuste para el ERP", "CSV") y
                                empujaban a Finalizar —la única acción que cambia el estado
                                del conteo— al final de una fila de secundarios. Ahora:
                                "Imprimir" y "Finalizar". Con un solo documento disponible
                                imprime directo; con varios abre el selector, porque elegir
                                entre cuatro papeles sí merece leerlos. */}
                            <div className="flex flex-wrap items-center gap-2">
                                <Button
                                    variant="secondary" icon={Printer} disabled={printing} loading={printing}
                                    onClick={() => (documentos.length === 1 ? handlePrint(documentos[0].kind) : setPrintChooserOpen(true))}
                                >
                                    Imprimir
                                </Button>
                                {canFinalize && (
                                    <Button icon={CheckCircle2} disabled={busy} loading={busy} onClick={handleFinalizar}>Finalizar</Button>
                                )}
                                {canApproveNow && (
                                    <Button tone="success" icon={ShieldCheck} disabled={busy} loading={busy} onClick={handleAprobar}>Aprobar</Button>
                                )}
                            </div>
                        </div>

                        {/* El conteo mide y firma la diferencia, pero el stock lo
                            corrige el ERP: hasta que alguien registre que lo aplicó,
                            el ERP sigue mintiendo y esto tiene que estar a la vista. */}
                        {conteo.status === 'CERRADO' && (
                            <div className="mt-4">
                                {conteo.ajuste_erp_aplicado ? (
                                    <Notice variant="success" icon={ClipboardCheck}>
                                        Ajuste aplicado en el ERP el {fmtDateTime(conteo.ajuste_erp_at)}.
                                        {conteo.ajuste_erp_nota ? ` — "${conteo.ajuste_erp_nota}"` : ''}
                                    </Notice>
                                ) : conteo.total_diferencias > 0 ? (
                                    <Notice
                                        variant="warning"
                                        icon={FileSpreadsheet}
                                        action={canEdit && (
                                            <Button size="sm" disabled={busy} onClick={() => setPromptAjusteOpen(true)}>
                                                Ya lo apliqué
                                            </Button>
                                        )}
                                    >
                                        Ajuste pendiente de aplicar en el ERP: {conteo.total_diferencias} línea(s).
                                        Descargá la hoja o el CSV, aplicalo, y registralo acá.
                                    </Notice>
                                ) : (
                                    <Notice variant="success">Sin diferencias: no hay ajuste que aplicar en el ERP.</Notice>
                                )}
                            </div>
                        )}

                        {hasResults && conteo.total_pendientes > 0 && (
                            <div className="mt-4">
                                <Notice variant={conteo.pendientes_como_cero ? 'warning' : 'danger'}>
                                    {conteo.pendientes_como_cero
                                        ? <>Al cerrar, <strong className="tabular-nums">{conteo.total_pendientes}</strong> renglón(es) sin contar se dieron por no ubicados (físico 0). Su faltante está incluido en los montos.</>
                                        : <>Conteo parcial: <strong className="tabular-nums">{conteo.total_pendientes}</strong> renglón(es) quedaron sin contar y NO están valuados. Estos montos no son un cuadre completo.</>}
                                </Notice>
                            </div>
                        )}

                        {/* Las tarjetas existían SOLO con el conteo ya finalizado, y
                            salían de `conteos_inventario.total_*`, que las escribe
                            recalcular_totales_conteo al cerrar. O sea que durante los
                            días en que alguien está contando —los únicos en que sirve
                            saber cuánto falta— la vista no decía nada: había que
                            paginar 59 páginas para saber si iba por la mitad. Ahora
                            salen de get_conteo_resumen, que agrega TODO el conteo en
                            vivo y usa la misma fórmula del dinero, así que al
                            finalizar el número no cambia de golpe. */}
                        {resumen && <ResumenCards resumen={resumen} abierto={!hasResults} />}
                    </div>
                )}

                {/* §17: los filtros de la vista van en UNA píldora, en el cuerpo y a
                    la derecha. Estaban sueltos —un SegmentedControl a la intemperie—,
                    que es justo lo que la regla prohíbe: sin contenedor no hay orden de
                    ranuras, no hay limpiar-todo, y en móvil las opciones se parten en
                    tres filas y empujan la tabla fuera de la pantalla.
                    El orden es el del estándar: entidad (laboratorio) antes que estado
                    (los chips). No hay ranura de sucursal porque un conteo ES de una
                    sucursal: cambiarla sería abrir otro conteo. */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                    {puedeRecontar && (
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                            {/* Entrar al recuento deja la vista en "Con diferencia": es lo
                                que se recuenta. Queda como filtro y no como candado para no
                                perder el sondeo de control — verificar unas líneas que
                                cuadraron es lo que detecta al que copió el número. */}
                            <Switch
                                checked={recuento}
                                onChange={(v) => { setRecuento(v); if (v) setFiltro('DIFERENCIA'); }}
                                size="sm" variant="chart-1" label="Modo recuento" />
                            <span className="text-label font-bold text-content-2 flex items-center gap-1">
                                <ShieldCheck size={12} strokeWidth={2.5} /> Modo recuento
                            </span>
                        </label>
                    )}
                    {editable && canEdit && (
                        <Button tone="chart-9" icon={Plus} onClick={() => setShowAddForm((v) => !v)}>Agregar Producto/Lote</Button>
                    )}
                    </div>

                    <FilterBar activeCount={filtrosActivos} onClear={limpiarFiltros}>
                        {/* 2 · entidad — un conteo no tiene ranura de ámbito: ES de una
                            sucursal, y cambiarla sería abrir otro conteo. */}
                        <FilterBar.Section
                            active={laboratorioId != null}
                            onClear={() => setLaboratorioId(null)}
                            label="laboratorio"
                        >
                            <div className="w-[190px]">
                                <LiquidSelect
                                    value={laboratorioId == null ? null : String(laboratorioId)}
                                    onChange={(v) => setLaboratorioId(v == null ? null : Number(v))}
                                    options={labOpciones}
                                    placeholder="Laboratorio"
                                    ariaLabel="Filtrar por laboratorio"
                                    icon={FlaskConical}
                                    compact bare
                                />
                            </div>
                        </FilterBar.Section>
                        {/* 4 · estado */}
                        <FilterBar.Section active={filtro !== 'TODOS'} onClear={() => setFiltro('TODOS')} label="estado">
                            <SegmentedControl
                                label="Filtrar los renglones"
                                size="sm"
                                tone="chart-9"
                                value={filtro}
                                onChange={setFiltro}
                                // "Con diferencia" no se ofrece si el conteo es ciego: la
                                // RPC lo trata como TODOS (filtrar por diferencia señala
                                // exactamente las líneas que descuadran), así que sería un
                                // control que no controla — y ofrecerlo ya insinúa que hay
                                // algo ahí que mirar.
                                options={FILTRO_PILLS
                                    .filter((f) => verSistema || f.key !== 'DIFERENCIA')
                                    .map((f) => ({ value: f.key, label: f.label }))}
                            />
                        </FilterBar.Section>
                    </FilterBar>
                </div>

                {!verSistema && (
                    <Notice variant="info" icon={EyeOff}>
                        <strong>Conteo ciego.</strong> Anotá lo que ves en el anaquel, no lo que el sistema espera:
                        la existencia del sistema y la diferencia no se muestran porque no salen de la base para tu rol.
                        Se ven cuando el conteo se finaliza, o con el permiso «Ver Existencia del Sistema».
                    </Notice>
                )}

                {recuento && (
                    <Notice variant="info" icon={ShieldCheck}>
                        Recuento a ciegas sobre los renglones <strong>con diferencia</strong>, en orden de anaquel (por laboratorio).
                        El campo arranca vacío y no ves el primer conteo ni el sistema hasta registrar el tuyo.
                        No podés recontar una línea que vos mismo contaste.
                    </Notice>
                )}

                {showAddForm && editable && conteo && (
                    <AddManualItemForm
                        branchId={conteo.branch_id}
                        onAdd={async (payload) => {
                            await agregarProductoManualConteo(id, payload);
                            setShowAddForm(false);
                            await load();
                        }}
                        onCancel={() => setShowAddForm(false)}
                    />
                )}

                {/* Teléfono: tarjetas. La tabla de 11 columnas no se opera de pie
                    en un pasillo, y `DataTable` no reflowa a tarjetas (DESIGN.md §32). */}
                <div className="md:hidden space-y-2">
                    {loading ? (
                        <div data-surface="card" className="p-4"><SkeletonText lines={6} /></div>
                    ) : products.length === 0 ? (
                        <div data-surface="card" className="p-8 text-center">
                            <Package size={28} className="mx-auto text-content-3 mb-2" />
                            <p className="text-body-sm text-content-3">Sin productos para este filtro</p>
                        </div>
                    ) : products.map((product) => (
                        <ProductCardMovil
                            key={product.erp_product_id}
                            product={product}
                            lines={itemsByProduct[product.erp_product_id]}
                            desbloqueadas={desbloqueadas}
                            editable={editable}
                            recuento={recuento}
                            onUnlock={setDesbloqueada}
                            onSave={(itemId, payload) => handleSaveItem(itemId, payload, product.erp_product_id)}
                            onRecount={(itemId, payload) => handleRecountItem(itemId, payload, product.erp_product_id)}
                            onShowHistory={setHistoryItem}
                            currentUser={user}
                        />
                    ))}
                </div>

                <div className="hidden md:block">
                    <DataTable columns={columnas(verSistema)} loading={loading} empty={{ icon: Package, message: 'Sin productos para este filtro' }}>
                        {products.map((product, i) => {
                            const key = product.erp_product_id;
                            const lines = itemsByProduct[key];
                            return (
                                <React.Fragment key={key}>
                                    <ProductGroupRow product={product} index={i} verSistema={verSistema} />
                                    {!lines && (
                                        <tr><td colSpan={columnas(verSistema).length} className="py-4 px-6"><SkeletonText lines={2} /></td></tr>
                                    )}
                                    {lines && lines.map((item, j) => (
                                        <ItemRow
                                            key={item.id}
                                            item={item}
                                            index={j}
                                            editable={editable}
                                            recuento={recuento}
                                            desbloqueada={!!desbloqueadas[item.id]}
                                            onUnlock={setDesbloqueada}
                                            onSave={(itemId, payload) => handleSaveItem(itemId, payload, key)}
                                            onRecount={(itemId, payload) => handleRecountItem(itemId, payload, key)}
                                            onShowHistory={setHistoryItem}
                                            onEditLote={setEditLoteItem}
                                            currentUser={user}
                                        />
                                    ))}
                                </React.Fragment>
                            );
                        })}
                    </DataTable>
                </div>

                {total > 0 && (
                    <TablePagination pageSize={PAGE_SIZE} onPageSizeChange={() => {}} page={page} totalPages={totalPages} onPageChange={setPage} total={total} unit="productos" />
                )}
            </div>

            <ItemHistoryModal item={historyItem} onClose={() => setHistoryItem(null)} />
            <EditLoteModal
                item={editLoteItem}
                onClose={() => setEditLoteItem(null)}
                onSave={(itemId, payload) => handleEditLote(itemId, payload, editLoteItem?.erp_product_id)}
            />

            <FinalizarConteoModal
                open={confirmFinalizarOpen}
                pendientes={pendientesAlFinalizar}
                busy={busy}
                onClose={() => setConfirmFinalizarOpen(false)}
                onConfirm={confirmFinalizar}
            />

            <PromptModal
                isOpen={promptAprobarOpen}
                onClose={() => setPromptAprobarOpen(false)}
                onConfirm={confirmAprobar}
                title="Aprobar Conteo"
                message="Queda cerrado y con firma auditable. No podés aprobar un conteo que vos mismo finalizaste."
                placeholder="Nota de aprobación (opcional)"
                confirmText="Aprobar"
                cancelText="Cancelar"
                isProcessing={busy}
            />

            <PromptModal
                isOpen={promptAjusteOpen}
                onClose={() => setPromptAjusteOpen(false)}
                onConfirm={confirmMarcarAjuste}
                title="Registrar ajuste aplicado"
                message="Esto no modifica existencias — el portal no escribe stock. Solo deja constancia de que el ajuste ya se tecleó en el ERP, para que este conteo no quede como pendiente."
                placeholder="Referencia del ajuste en el ERP (opcional)"
                confirmText="Registrar"
                cancelText="Cancelar"
                isProcessing={busy}
            />
        </GlassViewLayout>
    );
}

function AddManualItemForm({ branchId, onAdd, onCancel }) {
    const { showToast } = useToastStore();
    const [results, setResults] = useState([]);
    const [selected, setSelected] = useState(null);
    const [presentacionOpts, setPresentacionOpts] = useState([]);
    const [presentacion, setPresentacion] = useState('');
    const [loteOpts, setLoteOpts] = useState([]);
    const [lote, setLote] = useState('');
    const [loteOtro, setLoteOtro] = useState('');
    const [fechaVencimiento, setFechaVencimiento] = useState('');
    const [saving, setSaving] = useState(false);

    // Antes se filtraban los productos ya presentes en el conteo, lo que hacía
    // imposible el caso más común de una farmacia: el snapshot trae el lote A y
    // en el anaquel aparece también el B. El duplicado real es
    // (producto, presentación, lote), y ahora lo rechaza agregar_item_conteo.
    const handleSearch = async (q) => {
        if (!q || q.trim().length < 2) { setResults([]); return; }
        const { data, error } = await searchActiveProductsForConteo(q.trim());
        if (error) console.error('handleSearch: product search failed:', error.message);
        setResults(data || []);
    };

    const handleSelectProduct = async (val) => {
        const found = results.find((p) => String(p.id) === val) || null;
        setSelected(found);
        setPresentacion('');
        setLote('');
        setLoteOtro('');
        setFechaVencimiento('');
        setPresentacionOpts([]);
        setLoteOpts([]);
        if (!found) return;

        const [{ data: precios, error: preciosErr }, { data: erpMap, error: erpMapErr }] = await Promise.all([
            fetchProductPresentacionesForConteo(found.id),
            fetchErpSucursalIdsForBranch(branchId),
        ]);
        if (preciosErr) console.error('handleSelectProduct: fetch product_precios failed:', preciosErr.message);
        if (erpMapErr) console.error('handleSelectProduct: fetch erp_sucursal_map failed:', erpMapErr.message);
        const tipos = [...new Set((precios || []).map((p) => p.presentaciones?.tipo).filter(Boolean))];
        setPresentacionOpts(tipos.map((t) => ({ value: t, label: t })));

        const erpIds = (erpMap || []).map((m) => m.erp_sucursal_id);
        if (erpIds.length) {
            const { data: lotes, error: lotesErr } = await fetchInventoryLotesForProduct(found.id, erpIds);
            if (lotesErr) console.error('handleSelectProduct: fetch lotes failed:', lotesErr.message);
            const seen = new Map();
            (lotes || []).forEach((l) => { if (!seen.has(l.lote)) seen.set(l.lote, l.fecha_vencimiento); });
            setLoteOpts(Array.from(seen.entries()).map(([value, fecha]) => ({ value, fecha })));
        }
    };

    const handleSelectLote = (val) => {
        setLote(val);
        if (val === '__OTRO__') { setFechaVencimiento(''); return; }
        const match = loteOpts.find((l) => l.value === val);
        setFechaVencimiento(match?.fecha || '');
    };

    const finalLote = lote === '__OTRO__' ? loteOtro.trim() : lote;
    const canSubmit = selected && presentacion && finalLote;

    // El costo ya no lo manda el cliente: lo pone agregar_item_conteo con el
    // mismo criterio que el snapshot (costo de la presentación de la línea).
    const handleSubmit = async () => {
        if (!canSubmit) return;
        setSaving(true);
        try {
            await onAdd({
                erpProductId: selected.id,
                presentacion,
                lote: finalLote,
                fechaVencimiento: fechaVencimiento || null,
            });
            showToast('Producto agregado', selected.nombre, 'success');
        } catch (err) {
            showToast('No se agregó el producto', err.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-chart-9/10 border border-chart-9/30 rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <p className="text-label font-black uppercase tracking-widest text-chart-9-text flex items-center gap-1.5"><FlaskConical size={12} /> Producto no listado en el snapshot</p>
                <Button variant="ghost" icon={X} iconOnly onClick={onCancel} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="md:col-span-3">
                    <LiquidSelect value={selected ? String(selected.id) : null} onChange={handleSelectProduct} options={results.map((p) => ({ value: String(p.id), label: `${p.nombre}${p.laboratorios?.nombre ? ` · ${p.laboratorios.nombre}` : ''}` }))} placeholder="Buscar producto..." serverSearch onSearchChange={handleSearch} />
                </div>
                <LiquidSelect value={presentacion || null} onChange={setPresentacion} options={presentacionOpts} placeholder={selected ? 'Presentación...' : 'Elige un producto primero'} disabled={!selected} clearable={false} />
                <LiquidSelect
                    value={lote || null}
                    onChange={handleSelectLote}
                    options={[...loteOpts.map((l) => ({ value: l.value, label: l.value })), { value: '__OTRO__', label: '+ Otro lote (nuevo)' }]}
                    placeholder={selected ? 'Lote...' : 'Elige un producto primero'}
                    disabled={!selected}
                    clearable={false}
                />
                {lote === '__OTRO__' && (
                    <PortalInput
                        aria-label="Número de lote nuevo"
                        value={loteOtro}
                        onChange={(e) => setLoteOtro(e.target.value)}
                        placeholder="Número de lote nuevo"
                        inputClassName="text-body-xl"
                    />
                )}
            </div>
            <div className="flex items-center gap-2">
                <div>
                    <label className="text-micro font-black uppercase tracking-widest text-content-3 ml-1 mb-1 block">Vencimiento</label>
                    <div className={lote !== '__OTRO__' ? 'opacity-50 pointer-events-none' : ''}>
                        <LiquidDatePicker value={fechaVencimiento} onChange={setFechaVencimiento} />
                    </div>
                </div>
                <Button tone="chart-9" disabled={!canSubmit || saving} onClick={handleSubmit}>{saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Agregar al conteo</Button>
            </div>
        </div>
    );
}
