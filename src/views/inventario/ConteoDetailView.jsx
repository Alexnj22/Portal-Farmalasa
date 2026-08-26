import React, { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react';
import HojaMovil from '../../components/common/HojaMovil';
import AsaHoja from '../../components/common/AsaHoja';
import Button from '../../components/common/Button';
import ViewTabBar from '../../components/common/ViewTabBar';
import Badge from '../../components/common/Badge';
import { SkeletonText } from '../../components/common/StateViews';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ClipboardCheck, ChevronLeft, Printer, CheckCircle2, ShieldCheck, Loader2, Plus, X, Package, FlaskConical, Radio, Pencil, PackageX, EyeOff, FileSpreadsheet, Download, PackagePlus, Trash2, Clock, AlertTriangle, ChevronUp,
} from 'lucide-react';
import LiquidAvatar from '../../components/common/LiquidAvatar';
import GlassViewLayout from '../../components/GlassViewLayout';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination from '../../components/common/TablePagination';
import LiquidSelect from '../../components/common/LiquidSelect';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import LiquidModal from '../../components/common/LiquidModal';
import ModalShell from '../../components/common/ModalShell';
import PromptModal from '../../components/common/PromptModal';
import ConfirmModal from '../../components/common/ConfirmModal';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import { useStaffStore } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import { useToastStore } from '../../store/toastStore';
import {
    printHojaConteo, printResultadosConteo, printAjustesConteo, exportAjustesConteo,
} from '../../utils/conteoInventarioPrint';
import SegmentedControl from '../../components/common/SegmentedControl';
import PortalInput from '../../components/common/PortalInput';
import Switch from '../../components/common/Switch';
import Notice from '../../components/common/Notice';
// Diferido: el lector sólo existe si alguien toca «escanear», y arrastra el
// diálogo entero además de la librería de decodificación. Estático costaba 2 kB
// del cierre de esta vista —y el techo del `bundle-gate` los vio— para una
// pantalla que se abre de pie frente a un estante, muchas veces con datos.
const LectorDeCodigo = lazy(() => import('../../components/common/LectorDeCodigo'));
// Mismo motivo que el lector: 162 líneas que sólo existen al tocar «Agregar».
const AddManualItemForm = lazy(() => import('./AddManualItemForm'));
import LiquidTooltip from '../../components/common/LiquidTooltip';
import FilterBar from '../../components/common/FilterBar';
import Contador from '../../components/common/Contador';
import useLayoutCompacto, { useFichasEnVezDeTabla, useAltoEscaso } from '../../hooks/useLayoutCompacto';
import usePaginaEnUrl from '../../hooks/usePaginaEnUrl';
import { usePestanaEnUrl } from '../../hooks/usePestanaEnUrl';
import { CajaFecha } from './camposDeConteo';
import { formatMoney, formatQty, formatPct } from '../../utils/formatNumber';
import { mensajeAmigable } from '../../utils/errorMessages';
import { shortEmployeeName, employeeInitials } from '../../utils/nameUtils';

const PAGE_SIZE_INICIAL = 25;

// Devuelve el valor recién cuando dejó de cambiar por `ms`. Es lo que separa
// "lo que se teclea" de "lo que se consulta": un buscador atado directo al
// estado sale a la base con cada letra, y como la última respuesta puede llegar
// antes que la anterior, además pinta resultados de un texto que ya no está.
// Vive acá y no en `hooks/` a propósito: mover los otros buscadores del portal
// a este patrón es un trabajo aparte, y un hook compartido a medio adoptar
// hace creer que ya está resuelto en todos.
function useValorDiferido(valor, ms) {
    const [diferido, setDiferido] = useState(valor);
    useEffect(() => {
        const t = setTimeout(() => setDiferido(valor), ms);
        return () => clearTimeout(t);
    }, [valor, ms]);
    return diferido;
}

// `variante` es lo que consume Badge. Faltaba: la cabecera pasaba
// `variant={es.variante}` contra un mapa que solo tenía bg/text/label, así que
// el badge de estado se renderizaba siempre con la variante por defecto.
// 'APROBADO' no está porque nunca existió: aprobar escribe 'CERRADO'.
const ESTADO_CFG = {
    BORRADOR:    { label: 'Borrador',    variante: 'neutral' },
    EN_PROGRESO: { label: 'En progreso', variante: 'warning' },
    FINALIZADO:  { label: 'Finalizado',  variante: 'chart-1' },
    CERRADO:     { label: 'Cerrado',     variante: 'success' },
};

// La cabecera imprimía el valor crudo de la columna ("CICLICO", "BAJO_RECETA").
// Mismos rótulos que la lista y que la hoja impresa.
const SCOPE_LABEL = {
    TOTAL: 'Todo el inventario',
    LABORATORIO: 'Por laboratorio',
    BAJO_RECETA: 'Bajo Receta',
    MANUAL: 'Selección manual',
    CICLICO: 'Cíclico del mes',
};

// `soloConSistema`: el filtro no se ofrece si el conteo es ciego para este rol.
// No es solo "con diferencia": **"no ubicados" también**. Un renglón marcado así
// es físico 0 contra una línea que el ERP dice que tiene stock, o sea un
// faltante confirmado — filtrar por él es pedir la lista de faltantes sin la
// cifra, que es exactamente lo que el ciego evita. Lo impone la RPC además de la
// UI (`20260730024814_conteo_v7…`): un filtro que solo se esconde en el cliente
// es decorativo, y este módulo ya cometió ese error una vez con el `<Switch>`.
const FILTRO_PILLS = [
    { key: 'TODOS', label: 'Todos' },
    { key: 'PENDIENTES', label: 'Pendientes' },
    { key: 'DIFERENCIA', label: 'Con diferencia', soloConSistema: true },
    { key: 'SIN_UBICAR', label: 'No ubicados', soloConSistema: true },
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
// Siete columnas, no once. Medido a 1440 con el menú abierto: la tabla pedía
// 1520px en un marco de 1028, o sea 492px de scroll horizontal, y ninguna
// columna tenía holgura salvo el padding. Lo que salió no se perdió, se movió a
// donde se lee mejor:
//
//   Laboratorio  → subtítulo del producto en su banda (como ya era en móvil)
//   Presentación → segunda línea de la celda de Lote, que es su contexto real
//   Vence        → idem, pegado a la presentación y con su badge
//   Nota         → fuera (decisión del usuario, 2026-07-30)
//
// Que el laboratorio deje de ser columna no lo vuelve inalcanzable: ahora hay
// filtro por laboratorio en la píldora, que es como se lo usa de verdad.
// En un conteo sencillo el renglón no tiene lote: la columna que lo identificaba
// pasa a llamarse por lo que de verdad lo distingue, la presentación. Cambia el
// rótulo y no la posición porque la celda sigue cumpliendo el mismo papel —cuál
// de los N renglones de este producto es éste— y moverla partiría la tabla.
const columnas = (verSistema, simple = false) => [
    { key: 'producto', label: 'Producto', sortable: true },
    { key: 'lote', label: simple ? 'Presentación' : 'Lote' },
    // Corte medido en 1440, no `lg` ni `xl`: es la columna más ancha después de
    // Producto (242px) y la tabla entra recién cuando el marco llega a 1028px.
    // Con `xl` (1280) se prendía antes de que hubiera lugar. La autoría no se
    // pierde debajo de eso: sigue en el historial de la línea y, en teléfono, en
    // la tarjeta del lote.
    { key: 'quien', label: 'Contó', hideBelow: '1440' },
    ...(verSistema ? [{ key: 'sistema', label: 'Sistema', align: 'center', sortable: true }] : []),
    { key: 'fisico', label: 'Físico', align: 'center', sortable: true },
    ...(verSistema ? [{ key: 'diferencia', label: 'Dif.', align: 'center', sortable: true }] : []),
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

// Un producto puede venir en dos presentaciones del MISMO estante —«PAQUETE X
// 10» y «UNIDAD»—, y el sistema las guarda en dos casilleros separados. Si en
// la repisa hay un paquete sin abrir que el sistema tiene como diez sueltas, el
// renglón de UNIDAD dice «-10» y el de PAQUETE «+1» aunque no falte una sola
// venda. La suma que importa está en unidades y la hace el servidor
// (`diferencia_grupo`); acá solo se decide cómo se PINTA el número del renglón:
// apagado cuando su grupo cuadra, porque en rojo se lee como diez unidades
// perdidas y eso fue exactamente el reporte del 2026-08-21.
const esReacomodo = (item) => !!item?.grupo_mixto && (item?.diferencia_grupo ?? 0) === 0;
const REACOMODO_AVISO = 'El sistema cuenta los paquetes y las unidades por separado. En unidades este producto cuadra: el total del producto lo dice.';

// Vuelve a netear las pilas de un producto con lo que hay en memoria. Es la
// copia cliente de `conteo_lineas_netas`, y existe porque `diferencia_grupo`
// llega calculado sobre lo GUARDADO: al teclear el segundo renglón de una pila,
// el primero seguiría mostrando el neto viejo hasta refrescar.
//
// La pila es (área de vencidos, lote, vencimiento) dentro del producto —el
// `erp_product_id` ya está fijo acá— y un renglón sin factor conocido se queda
// SOLO, igual que en la base: sin factor no hay conversión posible y agrupar
// por ignorancia haría que dos renglones reclamaran la misma existencia.
function conNetoDelGrupo(lines) {
    const clave = (l) => (l.factor == null
        ? `L:${l.id}`
        : `G:${l.is_vencidos ? '1' : '0'}|${l.lote ?? ''}|${l.fecha_vencimiento ?? ''}`);
    const pilas = new Map();
    lines.forEach((l) => {
        const k = clave(l);
        if (!pilas.has(k)) pilas.set(k, []);
        pilas.get(k).push(l);
    });
    const resumen = new Map();
    pilas.forEach((grupo, k) => {
        const factores = new Set(grupo.map((l) => l.factor).filter((f) => f != null));
        const mixto = factores.size > 1;
        const neto = grupo.reduce((sum, l) => (l.diferencia == null
            ? sum
            : sum + l.diferencia * (mixto ? (l.factor ?? 1) : 1)), 0);
        resumen.set(k, { mixto, neto });
    });
    return lines.map((l) => {
        const { mixto, neto } = resumen.get(clave(l));
        return { ...l, grupo_mixto: mixto, diferencia_grupo: neto };
    });
}

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
// Cómo se nombra un renglón cuando hay que decirlo en palabras (aria-label,
// encabezado del historial): en un conteo sencillo lo que lo distingue es la
// presentación, no el lote — decir "lote sin lote" no orienta a nadie.
const renglonEtiqueta = (item, simple) => (simple
    ? (item.presentacion ? `presentación ${item.presentacion}` : 'sin presentación')
    : `lote ${item.lote || 'sin lote'}`);

// Contar es teclear seguido sin levantar la vista del estante: Enter salta al
// siguiente renglón que falta y las flechas recorren.
//
// Vive acá arriba y no dentro de la fila porque **las dos maquetas lo
// necesitan**. Estaba escrito dentro de `ItemRow`, o sea sólo en la tabla: en el
// teléfono había que tocar el campo, escribir, cerrar el teclado, scrollear y
// volver a tocar — treinta veces por página.
//
// `offsetParent !== null` se queda aunque ya no haya dos maquetas montadas a la
// vez: cuesta nada y es lo único que separa un campo visible de uno que quedó
// escondido dentro de algo colapsado.
const camposDeCaptura = () => Array.from(document.querySelectorAll('input[data-fisico-input="true"]'))
    .filter((el) => el.offsetParent !== null);

function alTeclearEnCaptura(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        const pendiente = camposDeCaptura().find((el) => el !== e.currentTarget && el.value === '');
        // Se enfoca el siguiente DIRECTAMENTE, sin `blur()` previo: enfocar ya
        // dispara el blur del actual —o sea el guardado— y en un teléfono el
        // blur explícito cierra el teclado para volver a abrirlo un cuadro
        // después. Sin campo siguiente sí hace falta el blur: es lo único que
        // guarda lo que se acaba de escribir.
        if (pendiente) {
            pendiente.focus();
            pendiente.scrollIntoView({ block: 'center', behavior: 'smooth' });
        } else {
            e.currentTarget.blur();
        }
        return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const inputs = camposDeCaptura();
    const idx = inputs.indexOf(e.currentTarget);
    const next = e.key === 'ArrowDown' ? inputs[idx + 1] : inputs[idx - 1];
    if (next) { next.focus(); next.select(); }
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
    // Primer nombre + primer apellido, que es el estándar del portal entero
    // (`nameUtils`). Se normaliza ACÁ y no sólo en quien pasa la prop porque
    // este componente recibe de dos sitios —la fila de la tabla y la ficha del
    // teléfono— y basta que uno de los dos se olvide para que el nombre largo
    // vuelva. Sobre un nombre que ya viene corto no hace nada.
    const corto = nombre ? shortEmployeeName(nombre) : null;
    const titulo = `Contado por ${corto || 'desconocido'} · ${fmtDateTime(cuando)}`
        + (ediciones > 0 ? ` · editada ${ediciones} ${ediciones === 1 ? 'vez' : 'veces'}` : '')
        + ' — ver historial';
    return (
        // `xs` y no `sm`: son 8px menos de padding, que es exactamente lo que le
        // faltaba a la tabla para entrar sin scroll a 1440 con el menú abierto. Es
        // un control anidado dentro de una celda densa, no una acción principal, y
        // el alto sigue pasando por `max(…, var(--tap-min))` así que en un dedo
        // sigue midiendo 44px.
        <Button variant="ghost" size="xs" onClick={onClick} title={titulo} className="min-w-0 max-w-full">
            <span className="flex items-center gap-1.5 min-w-0">
                <LiquidAvatar src={fotoUrl} alt="" fallbackText={corto || '?'}
                    className="w-5 h-5 rounded-full shrink-0" />
                <span className="text-label font-bold text-content-2 truncate">{corto || 'Desconocido'}</span>
                <span className="text-micro text-content-3 tabular-nums shrink-0">{fmtHora(cuando)}</span>
                {/* `Contador`, no `Badge`. Su propia documentación lo dice: un chip
                    crece con su texto, un contador es circular con un dígito y
                    ovalado con dos. Esto era un `Badge` con el texto "2 ed.", o sea
                    exactamente la forma escrita a mano que el canónico vino a
                    reemplazar — y la décima vez que pasa. El "ed." además no hacía
                    falta: el `title` ya dice "editada 2 veces". */}
                <Contador valor={ediciones} tono="warning" size="sm" max={9}
                    aria-label={`editada ${ediciones} ${ediciones === 1 ? 'vez' : 'veces'}`} />
            </span>
        </Button>
    );
}

function ItemRow({
    item, index, editable, recuento, desbloqueada,
    onUnlock, onSave, onRecount, onShowHistory, onEditLote, currentUser, simple = false,
    // Lo decide la cabecera del conteo, no el renglón. Va con default `false`
    // porque el badge que gobierna promete algo concreto —«este número se
    // sigue moviendo»— y prometerlo de más es peor que no decirlo.
    enVivo = false,
    // El producto, SOLO cuando este renglón es el único que tiene. Entonces no
    // hay banda de grupo encima y esta fila carga también la identidad: un
    // producto con una sola presentación ocupaba dos filas que decían lo mismo
    // —«1 presentación · 13» arriba y «LATA 1X1 · 13» abajo—, y con 2,953
    // productos para 3,665 renglones eso era casi duplicar la tabla.
    producto = null,
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

    // Estimado inmediato con el "sistema" ya visible — el valor definitivo llega
    // en la respuesta de guardar_conteo_item, que en un conteo en vivo releyó la
    // existencia en el instante exacto del guardado y en uno «según la hoja»
    // devuelve la impresa, que es la que ya está en pantalla.
    const dif = fisico !== '' && sistema != null ? Number(fisico) - sistema : null;
    // El badge «Vivo» promete que ese número se sigue moviendo hasta que se
    // cuente. En un conteo «según la hoja» NO se mueve: es el impreso, y
    // anunciarlo como vivo contradice al encabezado y al papel.
    const isLive = enVivo && item.fisico_cantidad == null && !item.es_agregado_manual;
    // El neto del grupo lo calcula el servidor sobre lo GUARDADO, así que
    // mientras se teclea el renglón sin confirmar se pinta normal: la señal de
    // «esto cuadra en unidades» aparece cuando el número ya está registrado.
    const reacomodo = esReacomodo(item) && item.fisico_cantidad != null;

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
            showToast('No se guardó el recuento', `${item.product_nombre || 'Esta línea'}: ${mensajeAmigable(err)}`, 'error');
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
                setContadoPorNombre(currentUser ? shortEmployeeName(currentUser) : contadoPorNombre);
                setContadoPorFoto(currentUser?.photo ?? contadoPorFoto);
                setContadoAt(new Date().toISOString());
                if (result.evento === 'EDICION' || result.evento === 'BORRADO') setEdiciones((k) => k + 1);
            }
            // Confirmar vuelve a bloquear: el estado normal de una línea contada
            // es cerrada, y desbloquearla es siempre un acto explícito.
            if (nextFisico !== null) onUnlock(item.id, false);
        } catch (err) {
            revertToLastSaved();
            showToast('No se guardó el conteo', `${item.product_nombre || 'Esta línea'}: ${mensajeAmigable(err)}`, 'error');
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
                setContadoPorNombre(currentUser ? shortEmployeeName(currentUser) : contadoPorNombre);
                setContadoPorFoto(currentUser?.photo ?? contadoPorFoto);
                setContadoAt(new Date().toISOString());
            }
            onUnlock(item.id, false);
        } catch (err) {
            showToast('No se marcó el renglón', mensajeAmigable(err), 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <DataRow index={index} className={bloqueada ? 'bg-success/5' : (producto ? '' : 'bg-surface-card-hover/30')}>
            {/* Con banda de grupo encima, esta celda solo marca la sangría. Sin
                ella —un producto de un renglón— la fila ES el producto y lleva su
                identidad, la misma que dibujaba `ProductGroupRow`. */}
            <DataCell className={producto ? 'min-w-[180px] max-w-[340px]' : undefined}>
                {producto ? (
                    <div className="flex flex-col gap-0.5 py-0.5 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                            <p className="font-bold text-body-sm truncate text-content">
                                {producto.product_nombre || `Producto ${producto.erp_product_id}`}
                            </p>
                            {producto.es_antibiotico && <Badge variant="danger" size="sm" className="shrink-0">Bajo Receta</Badge>}
                        </div>
                        <span className="text-micro text-content-3 truncate">{producto.laboratorio_nombre || 'Sin laboratorio'}</span>
                    </div>
                ) : (
                    <span className="text-content-3 text-label">↳</span>
                )}
            </DataCell>
            <DataCell>
                {/* Toda la identidad del renglón en una celda: lote arriba,
                    presentación y vencimiento abajo. Eran tres columnas y las tres
                    describen LO MISMO —cuál de los N renglones de este producto es
                    éste—, así que separarlas costaba 260px de ancho para leer un
                    dato que se lee junto. */}
                <div className="flex flex-col gap-0.5 py-0.5">
                    {/* El lápiz va PEGADO al lote, en un grupo que no se parte. Antes
                        compartía el `flex-wrap` con los badges, así que en cuanto
                        aparecía "Área vencidos" el botón caía al segundo renglón y la
                        fila medía el doble — un lápiz solo, debajo, sin nada que
                        indicara a qué lote pertenecía. */}
                    <span className="flex items-center gap-1 min-w-0">
                        <span className="text-label font-bold text-content-2 tabular-nums truncate">
                            {simple ? (item.presentacion || '—') : (item.lote || '—')}
                        </span>
                        {/* Sin lote no hay etiqueta que corregir: el lápiz sale. Lo
                            rechaza también `editar_lote_conteo_item`, porque una
                            restricción que solo vive en el cliente es decorativa. */}
                        {editable && !simple && (
                            <Button variant="ghost" icon={Pencil} disabled={saving} title="Corregir lote/vencimiento" iconOnly onClick={() => onEditLote(item)} />
                        )}
                        {/* El ERP separa el stock vencido en su propia área. Sin esta
                            marca, esa fila y la del stock bueno se veían idénticas
                            (mismo producto, presentación, lote y fecha) y el
                            contador no sabía cuál de las dos estaba llenando. */}
                        {item.is_vencidos && <Badge variant="danger" size="sm" className="shrink-0">Vencidos</Badge>}
                        {item.es_agregado_manual && <Badge variant="chart-9" size="sm" className="shrink-0">Agregado</Badge>}
                    </span>
                    {/* En sencillo la presentación YA es el renglón de arriba, así que
                        esta segunda línea solo repetiría el mismo texto seguido de un
                        vencimiento que no existe. Queda el detalle (ej. "1x12") si lo
                        hay, que es lo único que agrega. */}
                    {simple ? (
                        item.detalle && (
                            <span className="text-micro text-content-3 tabular-nums truncate">{item.detalle}</span>
                        )
                    ) : (
                        <span className="flex items-center gap-1 min-w-0 text-micro text-content-3 tabular-nums">
                            <span className="truncate">{item.presentacion || '—'} · {fmtDate(item.fecha_vencimiento)}</span>
                            <VencimientoBadge status={vencimientoStatus(item.fecha_vencimiento)} />
                        </span>
                    )}
                </div>
            </DataCell>
            <DataCell hideBelow="1440">
                <AutorLinea
                    nombre={contadoPorNombre} fotoUrl={contadoPorFoto} cuando={contadoAt}
                    ediciones={ediciones} onClick={() => onShowHistory(item)}
                />
            </DataCell>
            {verSistema && (
                <DataCell align="center">
                    {tapado ? (
                        <LiquidTooltip content="Oculto hasta que registres tu recuento"><span className="text-body-sm font-bold text-content-3 tabular-nums">{TAPADO}</span></LiquidTooltip>
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
                                    aria-label={`Corregir la cantidad de ${item.product_nombre || 'esta línea'}, ${renglonEtiqueta(item, simple)}`}
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
                                    onKeyDown={alTeclearEnCaptura}
                                    enterKeyHint="next"
                                    onBlur={commit}
                                    readOnly={!puedeEscribir}
                                    compact
                                    data-fisico-input="true"
                                    inputClassName="text-center text-body-xl font-bold"
                                    // 56px y no 64: los últimos 8px que le faltaban a la
                                    // tabla para entrar sin scroll a 1440 con el menú
                                    // abierto. Cuatro dígitos siguen entrando centrados.
                                    className="w-14"
                                />
                                {editable && !recuento && (
                                    <Button variant="ghost" icon={PackageX} disabled={saving}
                                        title="No ubicado — lo busqué y no está en el estante"
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
                    ) : reacomodo ? (
                        <LiquidTooltip content={REACOMODO_AVISO}>
                            <span className="text-body-sm font-black tabular-nums text-content-3">{difLabel(dif)}</span>
                        </LiquidTooltip>
                    ) : (
                        <span className={`text-body-sm font-black tabular-nums ${difClass(dif)}`}>{difLabel(dif)}</span>
                    )}
                </DataCell>
            )}
            <DataCell align="center">
                <div className="flex flex-col items-center gap-0.5">
                    {estadoItem === 'SIN_UBICAR'
                        ? <Badge variant="danger" size="sm" icon={PackageX}>No ubicado</Badge>
                        : estadoItem === 'CONTADO'
                            ? <CheckCircle2 size={14} className="text-success" />
                            : <span className="text-content-3 text-micro">Pendiente</span>}
                    {(item.recontado_at || revelado) && (
                        <Badge variant="chart-1" size="sm" icon={ShieldCheck}
                            title={item.recontado_por_nombre ? `Recontado por ${shortEmployeeName(item.recontado_por_nombre)}` : 'Recontado'}>
                            Recontada
                        </Badge>
                    )}
                </div>
            </DataCell>
        </DataRow>
    );
}

// El total de una banda cuando sus renglones son presentaciones distintas del
// mismo estante: la suma cruda no significa nada —1 paquete + 4 unidades no son
// «5»—, así que el servidor la devuelve convertida a unidades y acá se dice de
// qué unidad habla. El sufijo es del ancho de dos caracteres a propósito: la
// tabla ya entra justa a 1440.
function TotalDelProducto({ valor, enUnidades, clase = 'text-content-2', etiqueta = null }) {
    const texto = etiqueta ?? (valor ?? '—');
    const numero = <span className={`text-body-sm font-black tabular-nums ${clase}`}>{texto}</span>;
    if (!enUnidades || valor == null) return numero;
    return (
        <LiquidTooltip content="Este producto se cuenta en dos presentaciones (paquetes y unidades). El total está en unidades.">
            <span className="inline-flex items-baseline gap-0.5">
                {numero}
                <span className="text-micro text-content-3">u</span>
            </span>
        </LiquidTooltip>
    );
}

function ProductGroupRow({ product, index, verSistema, simple = false }) {
    const dif = product.diferencia_total;
    const enUnidades = !!product.total_en_unidades;
    // Todos sus lotes confirmados: la banda deja de llamar. Es la señal que se
    // busca al recorrer un estante — qué falta, no qué ya está.
    const completo = product.item_count > 0 && product.contados_count >= product.item_count;
    return (
        <DataRow index={index} className={completo ? 'bg-success/10' : ''}>
            {/* Sin ancho fijo. Los 280px que tenía eran un mínimo de facto que la
                tabla no podía ceder: con 11 columnas de `whitespace-nowrap` sumaban
                más que el marco y la última ("Diferencia") terminaba cortada.
                El laboratorio pasó a ser el subtítulo del producto — dejó de ser
                columna propia porque para filtrar ya está la píldora, y acá se lee
                mejor pegado al nombre que a 180px de distancia. */}
            <DataCell className="min-w-[180px] max-w-[340px]">
                <div className="flex flex-col gap-0.5 py-0.5 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <p className="font-bold text-body-sm truncate text-content">
                            {product.product_nombre || `Producto ${product.erp_product_id}`}
                        </p>
                        {product.es_antibiotico && <Badge variant="danger" size="sm" className="shrink-0">Bajo Receta</Badge>}
                    </div>
                    <span className="text-micro text-content-3 truncate">{product.laboratorio_nombre || 'Sin laboratorio'}</span>
                </div>
            </DataCell>
            <DataCell>
                <div className="flex items-center gap-1.5 flex-wrap">
                    {/* Lo que cuenta el badge son los renglones del producto, y en
                        sencillo esos renglones son presentaciones, no lotes. */}
                    <Badge uppercase={false} variant={completo ? 'success' : 'neutral'}>
                        {simple
                            ? `${product.item_count} presentaci${product.item_count === 1 ? 'ón' : 'ones'}`
                            : `${product.item_count} lote${product.item_count === 1 ? '' : 's'}`}
                    </Badge>
                    {product.con_vencidos_count > 0 && <VencimientoBadge status="VENCIDO" />}
                    {product.con_proximos_count > 0 && <VencimientoBadge status="PROXIMO" />}
                </div>
            </DataCell>
            <DataCell hideBelow="1440" />
            {verSistema && (
                <DataCell align="center">
                    <TotalDelProducto valor={product.sistema_total} enUnidades={enUnidades} />
                </DataCell>
            )}
            <DataCell align="center"><TotalDelProducto valor={product.fisico_total} enUnidades={enUnidades} /></DataCell>
            {verSistema && (
                <DataCell align="center">
                    <TotalDelProducto valor={dif} enUnidades={enUnidades} clase={difClass(dif)} etiqueta={difLabel(dif)} />
                </DataCell>
            )}
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
function LoteMovil({ item, editable, recuento, desbloqueada, onUnlock, onSave, onRecount, onShowHistory, onEditLote, currentUser, simple = false, enVivo = false }) {
    const { showToast } = useToastStore();
    // La existencia del sistema la decide la RPC renglón por renglón, igual que
    // en la tabla: viene NULL y con el flag apagado cuando el conteo es ciego.
    const verSistema = !!item.ver_sistema;
    const [fisico, setFisico] = useState(recuento ? '' : (item.fisico_cantidad ?? ''));
    const [sistema, setSistema] = useState(item.sistema_cantidad);
    // Se revela solo lo que este supervisor ya recontó en esta sesión.
    const [revelado, setRevelado] = useState(false);
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
        setSistema(item.sistema_cantidad);
        setRevelado(false);
        setEstadoItem(item.estado_item);
        setAutor({
            nombre: item.contado_por_nombre ?? null,
            foto: item.contado_por_photo_url ?? null,
            cuando: item.contado_at ?? null,
            ediciones: item.ediciones_count ?? 0,
        });
        guardado.current = item.fisico_cantidad ?? null;
    }, [item.id, item.fisico_cantidad, item.sistema_cantidad, item.estado_item, item.contado_at, item.contado_por_nombre,
        item.contado_por_photo_url, item.ediciones_count, recuento]);

    const confirmada = !recuento && estadoItem !== 'PENDIENTE';
    const bloqueada = editable && confirmada && !desbloqueada;

    // Estimado inmediato con el "sistema" ya visible — el definitivo llega en la
    // respuesta de guardar_conteo_item, que en un conteo en vivo releyó la
    // existencia en el instante del guardado.
    const dif = fisico !== '' && sistema != null ? Number(fisico) - sistema : null;
    const isLive = enVivo && item.fisico_cantidad == null && !item.es_agregado_manual;
    const reacomodo = esReacomodo(item) && item.fisico_cantidad != null;
    // El recuento tapa el sistema y el primer conteo hasta que el supervisor
    // registra el suyo: si ve que decía 12, escribe 12.
    const tapado = recuento && !revelado;

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
            // La RPC devuelve la existencia leída en el instante del guardado —
            // sin esto la diferencia de la tarjeta se queda con la del snapshot.
            setSistema(res.sistema_cantidad);
            setEstadoItem(recuento ? (valor === 0 && res.sistema_cantidad > 0 ? 'SIN_UBICAR' : 'CONTADO') : estado);
            if (recuento) setRevelado(true);
            if (res.evento !== 'SIN_CAMBIO') {
                setAutor((a) => ({
                    // El OBJETO y no `.name`: con la cadena ya concatenada hay
                    // que adivinar dónde termina el nombre y empieza el
                    // apellido, y con tres palabras es ambiguo. Con
                    // `first_names`/`last_names` no se adivina nada.
                    nombre: currentUser ? shortEmployeeName(currentUser) : a.nombre,
                    foto: currentUser?.photo ?? a.foto,
                    cuando: new Date().toISOString(),
                    ediciones: res.evento === 'EDICION' || res.evento === 'BORRADO' ? a.ediciones + 1 : a.ediciones,
                }));
            }
            if (valor !== null) onUnlock(item.id, false);
        } catch (err) {
            setFisico(guardado.current ?? '');
            showToast('No se guardó el conteo', `${item.product_nombre || 'Esta línea'}: ${mensajeAmigable(err)}`, 'error');
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
            <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
                <span className="flex items-center gap-1 min-w-0">
                    <span className={`text-label font-bold tabular-nums ${bloqueada ? 'text-success' : 'text-content-2'}`}>
                        {simple ? (item.presentacion || '—') : `Lote ${item.lote || '—'}`}
                    </span>
                    {/* Corregir el lote solo existía en la tabla, o sea solo en
                        escritorio (`hidden md:block`). Y el caso que lo necesita
                        —el lote del estante no es el que copió el snapshot— se
                        descubre justamente de pie frente al estante, con el
                        teléfono en la mano. 44px de lado: es un objetivo táctil,
                        no el adorno de otro control. */}
                    {/* Sin `w-11 h-11` a mano: `iconOnly` ya resuelve el lado con
                        `max(…, var(--tap-min))`, que en un dedo son 44px. Escribirlo
                        acá era pelearle al canónico con una clase que puede perder o
                        ganar según el orden del CSS generado. */}
                    {editable && onEditLote && !simple && (
                        <Button variant="ghost" icon={Pencil} iconOnly disabled={saving}
                            className="shrink-0"
                            title="Corregir lote/vencimiento"
                            aria-label={`Corregir el lote ${item.lote || 'sin lote'} de ${item.product_nombre || 'este producto'}`}
                            onClick={() => onEditLote(item)} />
                    )}
                </span>
                <span className="text-caption text-content-3 tabular-nums">
                    {simple ? (item.detalle || '') : `${item.presentacion || '—'} · vence ${fmtDate(item.fecha_vencimiento)}`}
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
                            aria-label={`Corregir la cantidad de ${item.product_nombre || 'esta línea'}, ${renglonEtiqueta(item, simple)}`}
                            onClick={() => onUnlock(item.id, true)} />
                    </>
                ) : (
                    <>
                        <PortalInput
                            aria-label={`Cantidad de ${item.product_nombre || 'el producto'}, ${renglonEtiqueta(item, simple)}`}
                            type="number" min="0" step="1" inputMode="numeric"
                            value={fisico}
                            onChange={(e) => setFisico(e.target.value)}
                            onBlur={onBlur}
                            onKeyDown={alTeclearEnCaptura}
                            // La tecla del teclado del teléfono dice «siguiente»
                            // y hace lo que dice: salta al próximo renglón sin
                            // contar sin cerrar el teclado.
                            enterKeyHint="next"
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
            {/* La existencia del sistema y la diferencia — el hueco que tenía la
                tarjeta: la tabla las declara como dos columnas gobernadas por
                `verSistema`, y en teléfono no las dibujaba nadie. Con el permiso
                `conteo_ver_sistema` el número venía en la respuesta y no se veía
                en ningún lado, así que el aviso de «conteo ciego» tampoco salía
                para explicar la ausencia. Va DEBAJO del campo y no al lado: en un
                teléfono angosto el campo es de 56px de alto y comparte fila con
                el botón de «no ubicado», y meterle un tercer bloque lo estrangula.
                El primer conteo se muestra con la misma condición que en la tabla
                —solo destapado—, que es la métrica de calidad del recuento. */}
            {(verSistema || item.fisico_primer_conteo != null) && (
                <div className="flex items-center justify-center gap-x-3 gap-y-1 flex-wrap mt-1.5">
                    {verSistema && (
                        <span className="flex items-center gap-1.5">
                            <span className="text-caption text-content-3">Sistema</span>
                            {/* Sin `title` ni tooltip: acá no hay puntero que lo
                                dispare, y el aviso del modo recuento —que sale en
                                esta misma pantalla— ya dice que el sistema y el
                                primer conteo se tapan hasta registrar el tuyo. */}
                            {tapado ? (
                                <span className="text-body-sm font-bold text-content-3 tabular-nums">{TAPADO}</span>
                            ) : (
                                <span className="text-body-sm font-bold text-content-2 tabular-nums">{sistema ?? '—'}</span>
                            )}
                            {isLive && <LiveBadge />}
                        </span>
                    )}
                    {verSistema && (
                        <span className="flex items-center gap-1.5">
                            <span className="text-caption text-content-3">Dif.</span>
                            {tapado ? (
                                <span className="text-body-sm font-black text-content-3 tabular-nums">{TAPADO}</span>
                            ) : (
                                <span className={`text-body-sm font-black tabular-nums ${reacomodo ? 'text-content-3' : difClass(dif)}`}>{difLabel(dif)}</span>
                            )}
                        </span>
                    )}
                    {/* El teléfono no tiene puntero: lo que en la tabla es un
                        tooltip acá tiene que estar escrito. Sale una sola vez
                        por renglón y solo cuando hay algo que explicar. */}
                    {reacomodo && !tapado && (
                        <span className="text-micro text-content-3 basis-full text-center">Cuadra en unidades</span>
                    )}
                    {!tapado && item.fisico_primer_conteo != null && (
                        <span className={`text-micro font-bold tabular-nums ${item.fisico_primer_conteo === Number(fisico) ? 'text-success' : 'text-warning-text'}`}>
                            1er conteo: {item.fisico_primer_conteo}
                        </span>
                    )}
                </div>
            )}
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

// Una lista de conteo: fichas en el teléfono, tabla en escritorio. Sale a su
// propio componente porque ahora hay DOS —la bodega y el área de vencidos— y
// dibujarlas con dos copias del mismo bloque es cómo se desincronizan.
function ListaDeConteo({
    enFichas, loading, products, itemsByProduct, verSistema, simple, columnas: cols,
    orden, onSort, vacio, ...fila
}) {
    if (enFichas) {
        return (
            <div className="space-y-2">
                {loading ? (
                    <div data-surface="card" className="p-4"><SkeletonText lines={6} /></div>
                ) : products.length === 0 ? (
                    <div data-surface="card" className="p-8 text-center">
                        <Package size={28} className="mx-auto text-content-3 mb-2" />
                        <p className="text-body-sm text-content-3">{vacio}</p>
                    </div>
                ) : products.map((product) => (
                    <ProductCardMovil
                        key={product.erp_product_id}
                        product={product}
                        lines={itemsByProduct[product.erp_product_id]}
                        verSistema={verSistema}
                        simple={simple}
                        {...fila}
                        onSave={(itemId, payload) => fila.onSave(itemId, payload, product.erp_product_id)}
                        onRecount={(itemId, payload) => fila.onRecount(itemId, payload, product.erp_product_id)}
                    />
                ))}
            </div>
        );
    }
    return (
        <div>
            <DataTable
                columns={cols}
                sortKey={orden?.key} sortDir={orden?.dir} onSort={onSort}
                // `dense`: 7 columnas de captura densa. Con el padding normal
                // (48px por columna) la tabla pedía 1203px en un marco de 1028
                // y arrastraba scroll horizontal.
                dense
                loading={loading} empty={{ icon: Package, message: vacio }}
            >
                {products.map((product, i) => {
                    const key = product.erp_product_id;
                    const lines = itemsByProduct[key];
                    // `item_count` viene con la página de productos, así que
                    // se sabe ANTES de que lleguen los renglones: decidirlo
                    // con `lines.length` haría aparecer y desaparecer la
                    // banda de grupo cuando termina de cargar.
                    const soloUno = product.item_count === 1;
                    return (
                        <React.Fragment key={key}>
                            {!soloUno && <ProductGroupRow product={product} index={i} verSistema={verSistema} simple={simple} />}
                            {!lines && (
                                <tr><td colSpan={cols.length} className="py-4 px-6"><SkeletonText lines={2} /></td></tr>
                            )}
                            {lines && lines.map((item, j) => (
                                <ItemRow
                                    key={item.id}
                                    item={item}
                                    index={soloUno ? i : j}
                                    producto={soloUno ? product : null}
                                    verSistema={verSistema}
                                    simple={simple}
                                    {...fila}
                                    desbloqueada={!!fila.desbloqueadas[item.id]}
                                    onSave={(itemId, payload) => fila.onSave(itemId, payload, key)}
                                    onRecount={(itemId, payload) => fila.onRecount(itemId, payload, key)}
                                />
                            ))}
                        </React.Fragment>
                    );
                })}
            </DataTable>
        </div>
    );
}

function ProductCardMovil({ product, lines, desbloqueadas, verSistema, ...rest }) {
    const completo = product.item_count > 0 && product.contados_count >= product.item_count;
    return (
        <div data-surface="card" className={`p-3 ${completo ? 'bg-success/10' : ''}`}>
            <div className="flex items-start justify-between gap-2">
                <p className="font-bold text-body-sm leading-tight text-balance min-w-0 text-content">
                    {product.product_nombre || `Producto ${product.erp_product_id}`}
                </p>
                <span className={`text-caption font-bold tabular-nums shrink-0 ${completo ? 'text-success' : 'text-content-3'}`}>
                    {product.contados_count}/{product.item_count}
                </span>
            </div>
            {product.es_antibiotico && <Badge variant="danger" size="sm" className="mt-1">Bajo Receta</Badge>}
            {/* El total del producto, con la misma condición que la banda de grupo
                de la tabla: solo cuando hay más de un renglón. Con uno solo, la
                línea de abajo ya dice exactamente estos mismos tres números. */}
            {product.item_count > 1 && (
                <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-1">
                    {verSistema && (
                        <span className="flex items-center gap-1.5">
                            <span className="text-caption text-content-3">Sistema</span>
                            <span className="text-body-sm font-black text-content-2 tabular-nums">{product.sistema_total ?? '—'}</span>
                        </span>
                    )}
                    <span className="flex items-center gap-1.5">
                        <span className="text-caption text-content-3">Físico</span>
                        <span className="text-body-sm font-black text-content-2 tabular-nums">{product.fisico_total ?? '—'}</span>
                    </span>
                    {verSistema && (
                        <span className="flex items-center gap-1.5">
                            <span className="text-caption text-content-3">Dif.</span>
                            <span className={`text-body-sm font-black tabular-nums ${difClass(product.diferencia_total)}`}>{difLabel(product.diferencia_total)}</span>
                        </span>
                    )}
                    {/* En la tabla esto es un tooltip sobre el número; en el
                        teléfono no hay puntero, así que se escribe. Sin ella los
                        tres números de arriba no dicen de qué unidad hablan. */}
                    {product.total_en_unidades && (
                        <span className="text-micro text-content-3 basis-full">Totales en unidades (hay paquetes y unidades)</span>
                    )}
                </div>
            )}
            {lines
                ? lines.map((it) => (
                    <LoteMovil key={it.id} item={it} desbloqueada={!!desbloqueadas[it.id]} {...rest} />
                ))
                : <div className="mt-2"><SkeletonText lines={2} /></div>}
        </div>
    );
}

// ── Tarjetas del encabezado ──────────────────────────────────────────────────
// Un dato por tarjeta, y el rótulo dice de qué conteo habla. Las que tienen
// dinero solo salen si el sistema es visible: son la suma de todas las
// diferencias, o sea el resumen exacto de lo que un conteo ciego está tapando
// renglón por renglón.
//
// Canónico desde v2.508.0. Antes eran una rejilla `grid-cols-2/3/6` de cajas
// escritas a mano con su propio mapa de tonos —caja, número y rótulo en clases
// sueltas—, o sea exactamente la forma que `StatCard` vino a reemplazar y que
// la LISTA de conteos ya usaba tres clicks antes. Dos pantallas del mismo
// módulo dibujando la misma anatomía de dos maneras distintas.
//
// `CarrilCards` además decide solo cuándo pasar a carril deslizable y cuándo
// compactar la línea de detalle según el ancho REAL; la rejilla a mano las
// apretaba a seis columnas en cualquier pantalla ancha.
const TONO_STAT = {
    neutral: {},
    warning: { iconBg: 'bg-warning/10', iconCls: 'text-warning-text', valueCls: 'text-warning-text' },
    danger:  { iconBg: 'bg-danger/10',  iconCls: 'text-danger',       valueCls: 'text-danger' },
    success: { iconBg: 'bg-success/10', iconCls: 'text-success-text', valueCls: 'text-success' },
};

// Devuelve un ARRAY de tarjetas, no el carril ya armado, y por dos motivos que
// apuntan al mismo lado. Uno: `CarrilCards` mide con
// `Children.toArray`, que aplana arrays pero cuenta un fragmento como UNA
// tarjeta — devolver un fragmento le rompería la medición del carril. Dos: el
// contenedor con el `lg:flex-row` de §17.0 vive en la vista, y `design-gate`
// deja escrito que su detector no cruza el límite de un subcomponente. Con el
// carril en la vista, lo que el gate lee es el layout de verdad y no hace falta
// una excepción para algo que sí está bien.
//
// `canVerMontos` entra por parámetro en vez de leerse con `useAuth`: esto ya no
// es un componente y no puede usar hooks. La vista ya lo tiene resuelto.
function tarjetasResumen(resumen, abierto, canVerMontos) {
    const {
        total_items: items = 0, total_productos: productos = 0, contados = 0, pendientes = 0,
        sin_ubicar: sinUbicar = 0, recontados = 0, contadores = 0, agregados = 0,
        con_diferencia: conDif, valor_faltante: falt, valor_sobrante: sobra, ver_sistema: ver,
    } = resumen;
    const pct = items > 0 ? (contados / items) * 100 : 0;

    // `.filter(Boolean)` y no un fragmento condicional: las dos últimas
    // dependen de permisos, y `Children.toArray` de `CarrilCards` descarta los
    // `false` pero contaría un fragmento como una tarjeta.
    return [
        <StatCard
            key="avance"
            icon={CheckCircle2}
            label="Avance"
            value={formatPct(pct, { decimales: 0 })}
            sub={`${formatQty(contados)} de ${formatQty(items)} renglones`}
            {...TONO_STAT[pendientes === 0 ? 'success' : 'neutral']}
        />,
        <StatCard
            key="sin-contar"
            icon={Clock}
            label="Sin contar"
            value={formatQty(pendientes)}
            // Cuántas personas contaron: si un conteo de 2,500 renglones lo
            // hizo una sola, eso ya es un hallazgo de control interno.
            sub={contadores > 0 ? `${formatQty(contadores)} contador(es)` : 'nada pendiente'}
            {...TONO_STAT[pendientes > 0 ? 'warning' : 'success']}
        />,
        <StatCard
            key="productos"
            icon={Package}
            label="Productos"
            value={formatQty(productos)}
            sub={agregados > 0 ? `${formatQty(agregados)} agregado(s) a mano` : 'en este conteo'}
        />,
        <StatCard
            key="no-ubicados"
            icon={PackageX}
            label="No ubicados"
            value={formatQty(sinUbicar)}
            sub="buscados y no están"
            {...TONO_STAT[sinUbicar > 0 ? 'danger' : 'neutral']}
        />,
        ver && (
            <StatCard
                key="diferencias"
                icon={AlertTriangle}
                label="Diferencias"
                value={formatQty(conDif)}
                sub={recontados > 0 ? `${formatQty(recontados)} recontada(s)` : 'contra la existencia'}
                {...TONO_STAT[conDif > 0 ? 'warning' : 'neutral']}
            />
        ),
        // Faltante y sobrante en UNA tarjeta: son las dos mitades del mismo
        // ajuste y se aplican como dos movimientos del mismo conteo. Mientras
        // está abierto van rotulados como PARCIAL — valuar un conteo a medias
        // como si fuera el resultado es el error que este módulo ya cometió una
        // vez (hallazgo #3).
        ver && canVerMontos && (
            <StatCard
                key="faltante"
                icon={FileSpreadsheet}
                label={abierto ? 'Faltante parcial' : 'Faltante'}
                value={formatMoney(falt)}
                sub={`sobrante ${formatMoney(sobra)}`}
                {...TONO_STAT[falt > 0 ? 'danger' : 'neutral']}
            />
        ),
    ].filter(Boolean);
}

// ── Selector de documento ────────────────────────────────────────────────────
// No es un menú desplegable: no existe uno canónico en el portal, y inventarlo
// para cuatro opciones sería agregar un primitivo al sistema de diseño de paso.
// Con un renglón por documento y su línea de qué es, además se elige leyendo —
// "Ajuste para el ERP" y "Resultados" no son lo mismo y antes eran dos botones
// idénticos uno al lado del otro.
function PrintChooserModal({ open, documentos, busy, onClose, onPick }) {
    return (
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-md" ariaLabel="Elegir documento para imprimir">
            <div className="flex-none bg-transparent px-6 py-5 border-b border-border-card flex items-center justify-between relative z-base">
                <div>
                    <h3 className="font-black text-content text-subtitle">Imprimir</h3>
                    <p className="text-caption text-content-3 uppercase tracking-widest font-bold">Elige el documento</p>
                </div>
                <Button variant="ghost" size="sm" icon={X} iconOnly onClick={onClose} />
            </div>
            <div className="px-6 py-5 flex flex-col gap-2 relative z-base">
                {documentos.map((d) => (
                    <Button key={d.kind} variant="secondary" disabled={busy}
                        className="w-full justify-start text-left h-auto py-3"
                        onClick={() => onPick(d.kind)}>
                        <d.icon size={15} className="shrink-0" />
                        <span className="min-w-0">
                            <span className="block font-bold">{d.label}</span>
                            <span className="block text-caption text-content-3 font-normal normal-case tracking-normal text-pretty">{d.detalle}</span>
                        </span>
                    </Button>
                ))}
            </div>
        </LiquidModal>
    );
}

// `open` e `item` van SEPARADOS a propósito. Antes eran uno solo (`open={!!item}`)
// y cerrar significaba poner el item en null — pero el panel sigue en pantalla
// los ~180ms de la animación de salida, así que en esos milisegundos el modal se
// quedaba sin título y sin contenido: un cuadro vacío desvaneciéndose. Es la
// otra mitad de lo que se reportaba como "se abre y cierra dos veces" (la
// primera era el rebote de opacidad de ModalShell). Cuál es el renglón y si el
// diálogo está visible son dos cosas distintas; tratarlas como una era el bug.
function ItemHistoryModal({ open, item, onClose, simple = false }) {
    const fetchConteoItemHistory = useStaffStore((s) => s.fetchConteoItemHistory);
    const [history, setHistory] = useState(null);

    // Depende de `open` además de `item`: al reabrir el MISMO renglón la
    // referencia no cambió, y sin esto se vería el historial cacheado de antes
    // de la última corrección.
    useEffect(() => {
        if (!open || !item) return;
        setHistory(null); // eslint-disable-line react-hooks/set-state-in-effect -- reset antes de re-fetch al abrir o cambiar de item
        fetchConteoItemHistory(item.id).then(setHistory);
    }, [open, item, fetchConteoItemHistory]);

    return (
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-lg" ariaLabel={`Historial de conteo — ${item?.product_nombre || ''}`}>
            <div className="flex-none bg-transparent px-6 py-5 border-b border-border-card flex items-center justify-between relative z-base">
                <div>
                    <h3 className="font-black text-content text-subtitle">{item?.product_nombre}</h3>
                    <p className="text-caption text-content-3 uppercase tracking-widest font-bold">
                        Historial de conteo · {simple ? (item?.presentacion || 'sin presentación') : (item?.lote || 'sin lote')}
                    </p>
                </div>
                <Button variant="ghost" size="sm" icon={X} iconOnly onClick={onClose} />
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
                                            fallbackText={employeeInitials(h.contado_por_nombre)}
                                            className="w-9 h-9 rounded-full shrink-0" />
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <p className="text-label font-bold text-content-2 truncate" title={h.contado_por_nombre}>{h.contado_por_nombre ? shortEmployeeName(h.contado_por_nombre) : 'Desconocido'}</p>
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

function EditLoteModal({ open, item, onClose, onSave }) {
    const { showToast } = useToastStore();
    const [lote, setLote] = useState('');
    const [fecha, setFecha] = useState('');
    const [saving, setSaving] = useState(false);

    // Igual que en el historial: `open` en las dependencias para que reabrir el
    // mismo renglón vuelva a partir del valor guardado y no del que quedó
    // tecleado en el intento anterior.
    useEffect(() => {
        if (!open || !item) return;
        setLote(item.lote || '');
        setFecha(item.fecha_vencimiento || '');
    }, [open, item]);

    const handleSave = async () => {
        setSaving(true);
        try {
            await onSave(item.id, { lote: lote.trim() || null, fechaVencimiento: fecha || null });
            onClose();
        } catch (err) {
            showToast('No se corrigió el lote', mensajeAmigable(err), 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-sm" ariaLabel={`Corregir lote — ${item?.product_nombre || ''}`}>
            <div className="flex-none bg-transparent px-6 py-5 border-b border-border-card flex items-center justify-between relative z-base">
                <div>
                    <h3 className="font-black text-content text-subtitle">Corregir lote</h3>
                    <p className="text-caption text-content-3 uppercase tracking-widest font-bold truncate max-w-[220px]">{item?.product_nombre}</p>
                </div>
                <Button variant="ghost" size="sm" icon={X} iconOnly onClick={onClose} />
            </div>
            <div className="px-6 py-5 flex flex-col gap-3 relative z-base">
                <p className="text-label text-content-3">Usa esto cuando el lote físico encontrado no corresponde al de este renglón (por ejemplo, un lote nuevo que todavía no figura). Solo corrige la etiqueta de este conteo — no modifica el inventario real.</p>
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
                {/* Mismo caso que el alta: sin envoltorio el campo se veía como
                    texto suelto debajo del de Lote, que sí tiene caja. */}
                <div>
                    <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1 block">Fecha de vencimiento</label>
                    <CajaFecha>
                        <LiquidDatePicker value={fecha} onChange={setFecha} />
                    </CajaFecha>
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
                <Button variant="ghost" size="sm" icon={X} iconOnly onClick={handleClose} />
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
                                ? 'El conteo cubrió toda el área: lo que no apareció en vitrinas ni estantes se registra con físico 0 y su faltante es real. Quedan marcados como "no ubicado", no como contados.'
                                : 'El conteo fue parcial: esos renglones no se valúan ni cuentan como diferencia. El número queda guardado en el reporte para que nadie lea el resultado como un cuadre completo.'}
                        </p>
                    </>
                ) : (
                    <Notice variant="success">Todos los renglones tienen cantidad física.</Notice>
                )}
            </div>

            <LiquidModal.Footer>
                <Button variant="secondary" disabled={busy} onClick={handleClose}>Cancelar</Button>
                <Button icon={CheckCircle2} disabled={busy} loading={busy} onClick={handleConfirm}>
                    Finalizar
                </Button>
            </LiquidModal.Footer>
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
    // Canon 2026-08-03. La hoja y los CSV se llevan el conteo al papel — y la
    // hoja incluye la existencia del sistema, o sea que el ciego se podía
    // romper por la impresora aunque `conteo_ver_sistema` estuviera apagado.
    const canDownload = hasPermission('conteo_inventario_descargar');
    // Borrar un conteo YA EMPEZADO o finalizado. Sin esta capacidad,
    // «Gestionar» solo se lleva el conteo que todavía no cuenta nada.
    const canEliminar = hasPermission('conteo_inventario_eliminar');
    // `conteo_inventario_ver_montos` (canon 2026-08-03): el conteo se hace y se
    // audita con unidades. La valuación en dinero es la lectura contable y va
    // aparte — quien cuenta no necesita saber cuánto vale el faltante.
    const canVerMontos = hasPermission('conteo_inventario_ver_montos');

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
    const eliminarConteoInventario = useStaffStore((s) => s.eliminarConteoInventario);
    const recontarConteoItem = useStaffStore((s) => s.recontarConteoItem);
    const fetchConteoResumen = useStaffStore((s) => s.fetchConteoResumen);
    const fetchConteoLaboratorios = useStaffStore((s) => s.fetchConteoLaboratorios);

    // El MISMO corte que usa FilterBar para colapsar a hoja inferior: si
    // divergen, el segmentado se dibujaría en riel dentro de la hoja. Por eso
    // sale del hook y no de un literal repetido — con la copia a mano, el
    // arreglo del teléfono acostado dejaba a este lado en `false` y a la hoja
    // en `true`, que es exactamente el caso que este comentario advertía.
    const compacto = useLayoutCompacto();
    // Fichas o tabla — y por un booleano, no por `md:hidden`. Dos motivos, los
    // dos medidos y los dos escritos en el hook: girar el teléfono sacaba la
    // tabla densa (844px de ancho pasan el corte `md` de 768), y esconder con
    // CSS dejaba las DOS maquetas montadas, o sea cada renglón dibujado dos
    // veces con su campo de captura.
    const enFichas = useFichasEnVezDeTabla();
    // Con el teléfono acostado el alto es lo que falta: medido el 2026-08-23 en
    // un iPhone 13 (844 × 390), encima de la lista había 474px — el 121% de la
    // pantalla, o sea que no se veía UN producto sin scrollear. Contar es mirar
    // el estante y teclear; el encabezado es contexto, no herramienta.
    const altoEscaso = useAltoEscaso();
    // Plegado por defecto SÓLO donde el alto escasea. Es estado de pantalla y
    // no de la dirección a propósito: no describe qué se está mirando, y un
    // enlace compartido no debería llegar con el encabezado cerrado.
    const [encabezadoAbierto, setEncabezadoAbierto] = useState(false);

    const [conteo, setConteo] = useState(null);
    const [products, setProducts] = useState([]);
    const [total, setTotal] = useState(0);
    // El área de vencidos: su propia lista, sin paginación. Son decenas de
    // productos (83 en el conteo abierto contra 2,759 de bodega), así que
    // paginarla sería un control para pasar de página que nunca se usa.
    const [vencidos, setVencidos] = useState([]);
    const [vencidosItems, setVencidosItems] = useState({});
    const [vencidosLoading, setVencidosLoading] = useState(true);
    // Cuántos productos hay en el área de vencidos SIN filtrar. Es lo que
    // decide si la pestaña existe, y por eso NO puede ser `vencidos.length`:
    // esa lista sí está filtrada, así que buscar "acetaminofen" haría
    // DESAPARECER la pestaña que se está mirando —y con ella el conteo del
    // área—, sin decir por qué. Sale del resumen (`productos_vencidos`), que
    // es una cifra del conteo entero y no de lo que hay en pantalla.
    // La página y el tamaño viven en la DIRECCIÓN, no en `useState`. Contar es
    // recorrer un estante de 1,400 productos de a 25: perder la posición no
    // cuesta un clic, cuesta volver a buscar dónde se iba. Y perderla no es
    // hipotético — la sesión de sala se cierra sola a los 5 minutos y la
    // aplicación se recarga cuando se publica una versión.
    //
    // El tamaño de página estaba en `useState` con un `onPageSizeChange` vacío:
    // se podía elegir 100, el control se pintaba en 100 y la tabla seguía
    // trayendo 25 — sin error y sin fila de menos visible, que es por qué
    // sobrevivió. Ahora lo valida el hook contra la lista blanca, que además es
    // lo que impide que un `?ver=` escrito a mano pida una página que PostgREST
    // recorta en silencio.
    const { page, pageSize: tamPagina, totalPages, setPage, setPageSize, resetPage } = usePaginaEnUrl({
        total,
        tamPorDefecto: PAGE_SIZE_INICIAL,
    });
    // `search` es lo que se ve en la caja y `searchDiferido` lo que sale a
    // consultar. Sin ese rezago cada TECLA disparaba una vuelta entera de
    // consultas contra un conteo de 3,473 renglones: escribir "acetaminofen"
    // eran doce vueltas, y las once primeras se descartaban al llegar. La caja
    // tiene que responder a la tecla; la base, a la pausa.
    const [search, setSearch] = useState('');
    const searchDiferido = useValorDiferido(search, 350);
    const [resumen, setResumen] = useState(null);
    const [labs, setLabs] = useState([]);
    const [laboratorioId, setLaboratorioId] = useState(null);
    const [printChooserOpen, setPrintChooserOpen] = useState(false);
    // Escanear es la otra forma de escribir en el buscador, no otra búsqueda:
    // el código cae en el mismo campo, y desde v2.710.0 el servidor lo mira
    // junto al nombre, el laboratorio, el lote y la presentación.
    const [lectorAbierto, setLectorAbierto] = useState(false);
    // Orden por columna. `null` = el orden del estante (laboratorio, producto),
    // que es el que sirve para recorrerlo contando; lo resuelve el servidor.
    const [orden, setOrden] = useState({ key: null, dir: 'asc' });

    // Contrato estándar de todo buscador toggleable (DESIGN.md §24): Escape
    // cierra Y limpia; click afuera cierra SOLO si está vacío.
    const [filtro, setFiltro] = useState('TODOS');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [showAddForm, setShowAddForm] = useState(false);
    const [printing, setPrinting] = useState(false);
    // Cuál renglón y si el diálogo está abierto son dos estados, no uno: al
    // cerrar, el panel sobrevive los ~180ms de la salida y necesita seguir
    // teniendo qué mostrar (ver el comentario de ItemHistoryModal).
    const [historyItem, setHistoryItem] = useState(null);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [editLoteItem, setEditLoteItem] = useState(null);
    const [editLoteOpen, setEditLoteOpen] = useState(false);
    const [itemsByProduct, setItemsByProduct] = useState({});
    const [confirmFinalizarOpen, setConfirmFinalizarOpen] = useState(false);
    const [pendientesAlFinalizar, setPendientesAlFinalizar] = useState(0);
    const [promptAprobarOpen, setPromptAprobarOpen] = useState(false);
    const [promptAjusteOpen, setPromptAjusteOpen] = useState(false);
    const [confirmEliminarOpen, setConfirmEliminarOpen] = useState(false);
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

    const abrirHistorial = useCallback((item) => { setHistoryItem(item); setHistoryOpen(true); }, []);
    const abrirEditLote  = useCallback((item) => { setEditLoteItem(item); setEditLoteOpen(true); }, []);

    const setDesbloqueada = useCallback((itemId, abierta) => {
        setDesbloqueadas((prev) => {
            if (!!prev[itemId] === abierta) return prev;
            const next = { ...prev };
            if (abierta) next[itemId] = true; else delete next[itemId];
            return next;
        });
    }, []);

    // La cabecera —de qué sucursal es, en qué estado está, cuánto falta en TODO
    // el conteo— no depende del filtro ni de la página ni de lo que se teclee.
    // Estaba dentro del `load`, así que cambiar de página o escribir una letra
    // volvía a pedir dos consultas cuya respuesta ya se tenía y no podía haber
    // cambiado. Se piden por conteo, y se rehacen a mano cuando algo del conteo
    // entero cambió (finalizar, aprobar, agregar un producto).
    const cargarCabecera = useCallback(async () => {
        const [detalle, res] = await Promise.all([
            fetchConteoDetalle(id),
            fetchConteoResumen(id),
        ]);
        setConteo(detalle);
        setResumen(res);
    }, [id, fetchConteoDetalle, fetchConteoResumen]);

    const cargarPagina = useCallback(async () => {
        setLoading(true);
        try {
            const productsPage = await fetchConteoProductsPage(id, {
                page, pageSize: tamPagina, search: searchDiferido, filtro,
                laboratorioId, area: 'NORMAL',
                orderBy: orden.key ? (ORDEN_SERVIDOR[orden.key] ?? orden.key) : null,
                orderDir: orden.dir,
            });
            setProducts(productsPage.rows);
            setTotal(productsPage.total);
            setDesbloqueadas({});

            // Nada se contrae: las líneas de los productos de la página vienen
            // de una sola llamada. Antes era una por producto, al expandirlo.
            const ids = productsPage.rows.map((r) => r.erp_product_id);
            const lines = await fetchConteoItemsForProducts(id, ids, { search: searchDiferido, filtro, area: 'NORMAL' });
            const porProducto = {};
            for (const it of lines) (porProducto[it.erp_product_id] ||= []).push(it);
            setItemsByProduct(porProducto);
        } catch (err) {
            showToast('Error', mensajeAmigable(err), 'error');
        } finally {
            setLoading(false);
        }
    }, [id, page, tamPagina, searchDiferido, filtro, laboratorioId, orden, fetchConteoProductsPage,
        fetchConteoItemsForProducts, showToast]);

    // El área de vencidos. Va en su propia vuelta y no dentro de `cargarPagina`
    // porque no comparte paginación con la bodega: si compartiera la vuelta,
    // pasar de página volvería a pedir los mismos 83 productos.
    //
    // El tope de 500 es deliberado y no es el cap de PostgREST: si algún día el
    // área de vencidos pasara de 500 productos, lo que hace falta es paginarla,
    // no subir el número. Está por debajo de las 1000 a propósito, para que el
    // día que corte se note acá y no en un truncado silencioso.
    const cargarVencidos = useCallback(async () => {
        setVencidosLoading(true);
        try {
            const pagina = await fetchConteoProductsPage(id, {
                page: 1, pageSize: 500, search: searchDiferido, filtro,
                laboratorioId, area: 'VENCIDOS',
            });
            setVencidos(pagina.rows);
            const ids = pagina.rows.map((r) => r.erp_product_id);
            const lines = await fetchConteoItemsForProducts(id, ids, {
                search: searchDiferido, filtro, area: 'VENCIDOS',
            });
            const porProducto = {};
            for (const it of lines) (porProducto[it.erp_product_id] ||= []).push(it);
            setVencidosItems(porProducto);
        } catch (err) {
            showToast('Error', mensajeAmigable(err), 'error');
        } finally {
            setVencidosLoading(false);
        }
    }, [id, searchDiferido, filtro, laboratorioId, fetchConteoProductsPage,
        fetchConteoItemsForProducts, showToast]);

    // ── El avance se vuelve a preguntar, no se lleva de cabeza ───────────
    // `resumen` sólo se cargaba al entrar, así que el «84% · faltan 2,141» del
    // encabezado se quedaba clavado toda la jornada: se contaban doscientos
    // renglones y el número no se movía. Con el número de las pestañas colgando
    // de la misma cifra, eso pasó de ser un dato viejo a ser un dato que
    // contradice lo que se ve abajo.
    //
    // Se vuelve a PREGUNTAR en vez de restarle uno acá, y no por comodidad: un
    // conteo lo llenan varias personas a la vez (`resumen.contadores` existe
    // por eso), así que una cuenta llevada en este navegador ignoraría lo que
    // acaban de contar los demás y se iría separando de la verdad sin avisar.
    //
    // Con espera, porque contar es teclear seguido: sin ella, una ráfaga de
    // diez renglones son diez vueltas de una consulta que agrega el conteo
    // entero. 1,2s es más que el ritmo de tecleo y menos que el de mirar.
    const relojResumen = useRef(null);
    useEffect(() => () => clearTimeout(relojResumen.current), []);
    const refrescarResumen = useCallback(() => {
        clearTimeout(relojResumen.current);
        relojResumen.current = setTimeout(() => {
            fetchConteoResumen(id).then(setResumen).catch(() => { /* el número viejo molesta menos que un aviso */ });
        }, 1200);
    }, [id, fetchConteoResumen]);

    // Lo que corre cuando cambió el conteo entero y no sólo qué se está mirando.
    const load = useCallback(async () => {
        try {
            await cargarCabecera();
        } catch (err) {
            showToast('Error', mensajeAmigable(err), 'error');
        }
        await cargarPagina();
    }, [cargarCabecera, cargarPagina, showToast]);

    useEffect(() => {
        cargarCabecera().catch((err) => showToast('Error', mensajeAmigable(err), 'error'));
    }, [cargarCabecera, showToast]);
    useEffect(() => { cargarPagina(); }, [cargarPagina]);
    useEffect(() => { cargarVencidos(); }, [cargarVencidos]);

    // Cambiar de filtro vuelve a la primera página, y tiene que pasar en el
    // MISMO evento que el cambio. Como efecto aparte llegaba tarde: la vuelta
    // ya había salido a pedir la página 3 de una lista que todavía no existía,
    // y recién la siguiente pedía la 1. Dos consultas para una sola decisión.
    const cambiarFiltro = useCallback((v) => { resetPage(); setFiltro(v); }, [resetPage]);
    const cambiarLaboratorio = useCallback((v) => { resetPage(); setLaboratorioId(v); }, [resetPage]);
    const cambiarBusqueda = useCallback((v) => { resetPage(); setSearch(v); }, [resetPage]);
    // `setPageSize` ya vuelve a la página 1 —en 2,800 productos, pasar de 25 a
    // 100 deja a la página 40 fuera de rango y la tabla saldría vacía sin decir
    // por qué— y lo hace en la misma escritura, no en dos.
    const cambiarTamPagina = useCallback((v) => { setPageSize(Number(v)); }, [setPageSize]);

    // Los laboratorios del conteo no cambian mientras se cuenta (el alcance se
    // fijó al crearlo), así que se piden una vez por conteo y no en cada `load`.
    useEffect(() => {
        let vivo = true;
        fetchConteoLaboratorios(id).then((r) => { if (vivo) setLabs(r); }).catch(() => {});
        return () => { vivo = false; };
    }, [id, fetchConteoLaboratorios]);

    // El conteo va en `badge` y no dentro del rótulo: en la hoja táctil se
    // alinea a la derecha en su propia columna, y el rótulo queda limpio para
    // que el índice A–Z agrupe por el nombre y no por un paréntesis.
    const labOpciones = labs.map((l) => ({
        value: String(l.laboratorio_id),
        label: l.laboratorio_nombre,
        badge: l.item_count,
    }));

    const filtrosActivos = (laboratorioId != null ? 1 : 0) + (filtro !== 'TODOS' ? 1 : 0);
    const limpiarFiltros = () => { resetPage(); setLaboratorioId(null); setFiltro('TODOS'); };

    // Si el conteo resulta ciego para este rol y el filtro activo era uno de los
    // dos que se retiran, vuelve a TODOS. Sin esto quedaría un filtro aplicado
    // que ya no tiene botón para apagarse — y que el servidor ignora, así que la
    // píldora diría "1 filtro" sobre una lista sin filtrar.
    useEffect(() => {
        if (verSistema) return;
        if (FILTRO_PILLS.some((f) => f.soloConSistema && f.key === filtro)) cambiarFiltro('TODOS');
    }, [verSistema, filtro, cambiarFiltro]);

    // Un segundo clic invierte; el tercero NO vuelve a "sin orden". Con el orden
    // del estante como default, poder volver a él es útil, pero hacerlo el tercer
    // paso de un ciclo lo vuelve un accidente: se limpia desde la píldora.
    const handleSort = (key) => { resetPage(); setOrden((prev) => (
        prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    )); };

    const editable = conteo && ['BORRADOR', 'EN_PROGRESO'].includes(conteo.status);
    // Conteo sencillo: un renglón por producto y presentación, sin lote ni
    // vencimiento. Lo decide la cabecera al crearse y ya no cambia, así que toda
    // la vista lee este único booleano en vez de adivinarlo por `item.lote`
    // —que también es NULL en un renglón por lote al que le falta la etiqueta—.
    const simple = conteo?.modo === 'SIMPLE';
    const canFinalize = editable && canEdit;
    const canApproveNow = conteo?.status === 'FINALIZADO' && canApprove;
    const puedeRecontar = conteo?.status === 'FINALIZADO' && canApprove;
    const hasResults = conteo && ['FINALIZADO', 'CERRADO'].includes(conteo.status);

    // Borrar tiene dos niveles y la RPC los aplica igual: acá solo se decide si
    // el botón se ofrece. «Gestionar» alcanza para el conteo que se armó mal
    // —abierto y sin un solo renglón contado—; a partir del primer renglón, y
    // para cualquiera ya finalizado, hace falta la capacidad. Se ESCONDE en vez
    // de mostrarse deshabilitado: un botón apagado sin explicación se lee como
    // un error de la pantalla.
    const conteoEmpezado = (resumen?.contados ?? 0) > 0;
    const puedeEliminar = canEdit && (canEliminar || (editable && !conteoEmpezado));

    // Recalcula los totales agregados del producto a partir de sus líneas ya
    // en memoria — evita un refetch de la página de productos por cada guardado.
    //
    // Y tiene que aplicar EXACTAMENTE el mismo criterio que `conteo_lineas_netas`
    // en la base: si el recálculo optimista y el del servidor no coinciden, el
    // número cambia solo al refrescar la página y nadie sabe cuál era el bueno.
    const recomputeProductTotals = (erpProductId, lines, setLista) => {
        const item_count = lines.length;
        const contados_count = lines.filter((l) => l.estado_item !== 'PENDIENTE').length;
        const con_diferencia_count = lines.filter((l) => l.diferencia != null && l.diferencia !== 0
            && (l.diferencia_grupo ?? 0) !== 0).length;
        const mult = (l) => (l.grupo_mixto ? (l.factor ?? 1) : 1);
        const sistema_total = lines.reduce((sum, l) => sum + (l.sistema_cantidad ?? 0) * mult(l), 0);
        const contadas = lines.filter((l) => l.fisico_cantidad != null);
        const fisico_total = contadas.length ? contadas.reduce((sum, l) => sum + l.fisico_cantidad * mult(l), 0) : null;
        const diferencia_total = contadas.length ? contadas.reduce((sum, l) => sum + (l.diferencia ?? 0) * mult(l), 0) : null;
        const total_en_unidades = lines.some((l) => l.grupo_mixto);
        setLista((prev) => prev.map((p) => (p.erp_product_id === erpProductId ? {
            ...p, item_count, contados_count, con_diferencia_count, sistema_total, fisico_total,
            diferencia_total, total_en_unidades,
        } : p)));
    };

    // Las dos secciones —bodega y área de vencidos— guardan igual; lo único que
    // cambia es en qué lista viven sus renglones. Se arma con una fábrica y no
    // con dos copias: un guardado que actualiza la lista equivocada no falla,
    // sólo deja el número viejo en pantalla hasta refrescar.
    const hacerHandlers = (setItems, setLista) => ({
        guardar: async (itemId, payload, erpProductId) => {
            const result = await guardarConteoItem(itemId, payload);
            setItems((prev) => {
                const lines = conNetoDelGrupo((prev[erpProductId] || []).map((it) => (it.id === itemId ? {
                    ...it,
                    fisico_cantidad: payload.fisicoCantidad,
                    nota: payload.nota,
                    estado_item: payload.estadoItem,
                    sistema_cantidad: result.sistema_cantidad,
                    diferencia: result.diferencia,
                    contado_por_nombre: (user ? shortEmployeeName(user) : null) || it.contado_por_nombre,
                    contado_at: new Date().toISOString(),
                } : it)));
                recomputeProductTotals(erpProductId, lines, setLista);
                return { ...prev, [erpProductId]: lines };
            });
            refrescarResumen();
            return result;
        },
        recontar: async (itemId, payload, erpProductId) => {
            const result = await recontarConteoItem(itemId, payload);
            setItems((prev) => {
                const lines = conNetoDelGrupo((prev[erpProductId] || []).map((it) => (it.id === itemId ? {
                    ...it,
                    fisico_primer_conteo: result.fisico_primer_conteo,
                    fisico_cantidad: payload.fisicoCantidad,
                    sistema_cantidad: result.sistema_cantidad,
                    diferencia: result.diferencia,
                    recontado_at: new Date().toISOString(),
                    recontado_por_nombre: (user ? shortEmployeeName(user) : null) || it.recontado_por_nombre,
                } : it)));
                recomputeProductTotals(erpProductId, lines, setLista);
                return { ...prev, [erpProductId]: lines };
            });
            refrescarResumen();
            return result;
        },
    });

    const bodega   = hacerHandlers(setItemsByProduct, setProducts);
    const vencidas = hacerHandlers(setVencidosItems, setVencidos);
    const handleSaveItem       = bodega.guardar;
    const handleRecountItem    = bodega.recontar;
    const handleSaveVencido    = vencidas.guardar;
    const handleRecountVencido = vencidas.recontar;

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
            showToast('Error', mensajeAmigable(err), 'error');
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
            showToast('Error', mensajeAmigable(err), 'error');
        } finally {
            setBusy(false);
            setPromptAprobarOpen(false);
        }
    };

    const handlePrint = async (kind) => {
        setPrintChooserOpen(false);
        setPrinting(true);
        // Un conteo de Bodega son ~3,700 renglones y armar el PDF tarda varios
        // segundos: sin aviso, el click se siente como que no pasó nada y se
        // vuelve a apretar. El toast se muestra ANTES de empezar, no después.
        showToast('Preparando el documento', 'Puede tardar unos segundos con un conteo grande…', 'info');
        try {
            const allItems = await fetchTodosLosItemsConteo(id);
            // Los `await` no son decorativos: sin ellos `finally` apagaba el
            // spinner en cuanto LLEGABAN los datos, o sea justo antes de la parte
            // lenta —armar el PDF y cargar las fuentes—. El botón se veía listo
            // durante los segundos en que de verdad estaba trabajando.
            //
            // La hoja sale ciega porque el dato NO VIENE: get_conteo_items_jsonb
            // aplica el mismo predicado que la tabla. El flag se deriva de lo que
            // llegó, no de un switch — antes la vista pasaba { ciego: false } fijo
            // y el papel revelaba justo lo que la pantalla tapaba.
            const ciego = !allItems[0]?.ver_sistema;
            if (kind === 'hoja') await printHojaConteo(conteo, allItems, { ciego });
            else if (kind === 'hoja-compacta') await printHojaConteo(conteo, allItems, { ciego, compacta: true });
            else if (kind === 'ajuste') await printAjustesConteo(conteo, allItems);
            else if (kind === 'ajuste-csv') exportAjustesConteo(conteo, allItems);
            else await printResultadosConteo(conteo, allItems, { soloDiferencias: false });
            showToast('Documento listo', 'Se descargó el archivo', 'success');
        } catch (err) {
            showToast('Error al generar el documento', mensajeAmigable(err), 'error');
        } finally {
            setPrinting(false);
        }
    };

    const confirmEliminar = async () => {
        setBusy(true);
        try {
            const res = await eliminarConteoInventario(id);
            showToast('Conteo eliminado', `Se borraron ${res?.total_items ?? 0} renglón(es)`, 'success');
            // Navegar ANTES de soltar el `busy`: la vista ya no tiene conteo que
            // recargar, y quedarse acá pintaría el estado de "no se encontró".
            navigate('/conteo-inventario');
        } catch (err) {
            showToast('Error', mensajeAmigable(err), 'error');
            setBusy(false);
            setConfirmEliminarOpen(false);
        }
    };

    const confirmMarcarAjuste = async (nota) => {
        setBusy(true);
        try {
            await marcarAjusteErp(id, nota);
            showToast('Ajuste registrado', 'Queda constancia de que el ajuste ya se aplicó', 'success');
            await load();
        } catch (err) {
            showToast('Error', mensajeAmigable(err), 'error');
        } finally {
            setBusy(false);
            setPromptAjusteOpen(false);
        }
    };

    const es = conteo ? (ESTADO_CFG[conteo.status] || ESTADO_CFG.BORRADOR) : null;

    // Qué documentos existen para este conteo AHORA. Mientras se cuenta hay uno
    // solo (la hoja), así que "Imprimir" imprime y no abre un selector de una
    // opción; con el conteo cerrado hay cuatro y ahí sí hay algo que elegir.
    const documentos = !canDownload ? [] : [
        { kind: 'hoja', icon: Printer, label: 'Hoja de conteo', detalle: 'Para llenar a mano en el estante, con columna de notas y firma de quien contó.' },
        { kind: 'hoja-compacta', icon: Printer, label: 'Hoja compacta', detalle: 'La mitad de páginas: dos productos por renglón, apaisada y sin columna de notas.' },
        ...(hasResults ? [
            { kind: 'resultados', icon: FileSpreadsheet, label: 'Resultados', detalle: 'Sistema, físico, diferencia y valuación de cada renglón.' },
            { kind: 'ajuste', icon: FileSpreadsheet, label: 'Ajuste para aplicar', detalle: 'Partido en faltantes (salida) y sobrantes (entrada), listo para teclear.' },
            { kind: 'ajuste-csv', icon: Download, label: 'Ajuste en CSV', detalle: 'Lo mismo en planilla, para filtrar o cargar en lote.' },
        ] : []),
    ];

    // ── Bodega y área de vencidos son DOS PESTAÑAS ───────────────────────
    // Son dos estantes distintos: se recorren por separado, se cuentan por
    // separado y un mismo producto puede estar en los dos. Vivían como una
    // sección al final de la misma página, o sea que para llegar al área de
    // vencidos había que pasar por las 2,759 filas de bodega —con su paginación
    // en el medio— y el número de arriba mezclaba las dos listas.
    //
    // La pestaña sólo existe si el conteo TIENE área de vencidos: en una sala no
    // la hay, y una pestaña vacía sugiere que falta contar algo. Con una sola,
    // `ViewTabBar` no dibuja pestaña ninguna — la vista se ve como antes.
    //
    // ── El número de la píldora es CUÁNTO FALTA POR CONTAR ────────────────
    // Decidido con el usuario el 2026-08-25, sobre la pregunta «¿esos números
    // qué son?». Antes era «cuántos productos hay», que en una pantalla de
    // contar no se puede accionar: el estante entero y el estante entero menos
    // uno se ven casi igual. Con los que faltan, la fila contesta de un vistazo
    // dónde queda trabajo — y `Contador` no dibuja el cero, así que un estante
    // terminado se anuncia quedándose sin número.
    //
    // Sale del RESUMEN y no de la lista de abajo: la lista está filtrada y
    // paginada, así que su largo cambiaría al buscar. Lo que falta por contar
    // no depende de lo que se esté mirando.
    const pestanas = (resumen?.productos_vencidos ?? 0) > 0 ? [
        { key: 'bodega',   label: 'Inventario',       icon: Package,       cuenta: resumen?.pendientes_bodega ?? 0 },
        { key: 'vencidos', label: 'Área de vencidos', icon: AlertTriangle, cuenta: resumen?.pendientes_vencidos ?? 0, tono: 'danger' },
    ] : [];
    // En la DIRECCIÓN y no en `useState`: la sesión de sala se cierra sola a los
    // 5 minutos y la aplicación se recarga al publicar una versión — con la
    // pestaña en memoria, quien estaba contando el área de vencidos vuelve a
    // bodega sin que nada falle (ver `usePestanaEnUrl`).
    // El parámetro se llama `area` y no `tab` porque es el mismo nombre con el
    // que las dos RPC de lectura piden la lista ('NORMAL' / 'VENCIDOS'): una
    // dirección compartida dice qué estante se está mirando, no un ordinal.
    const [pestana, setPestana] = usePestanaEnUrl(pestanas, 'bodega', 'area');
    const enVencidos = pestana === 'vencidos' && (resumen?.productos_vencidos ?? 0) > 0;

    // Una sola definición de los filtros para los dos sitios donde viven: en el
    // cuerpo con mouse, dentro de la barra flotante con el pulgar.
    const barraFiltros = (
        <FilterBar
            activeCount={filtrosActivos}
            onClear={limpiarFiltros}
            title="Filtros del conteo"
            // En táctil `FilterBar` ES la barra flotante, así que el buscador y la
            // acción principal se le pasan acá y no se cablean a mano: el canónico
            // decide dónde van en cada tamaño.
            buscador={{ value: search, onChange: cambiarBusqueda, placeholder: simple ? 'Producto o código' : 'Producto, lote o código', alEscanear: () => setLectorAbierto(true) }}
            // «Agregar» vive DENTRO de la píldora, que es donde §17 pone las
            // acciones de la vista desde el 2026-07-30. Estaba escrito como
            // `accionPrincipal`, que **`FilterBar` no acepta**: la prop caía en
            // `...rest` y se perdía sin error, así que en el teléfono —donde el
            // botón suelto de escritorio no se dibuja— NO HABÍA forma de agregar
            // un producto al conteo. El canónico es `acciones`, un descriptor y
            // no JSX, porque el mismo botón se dibuja de dos maneras: pieza de la
            // píldora con mouse y botón grande del clúster con el pulgar.
            // `rotulo` es la palabra que entra en los 60px del clúster.
            // Y NO en el área de vencidos: `agregar_item_conteo` inserta con
            // `is_vencidos = false` clavado, así que el renglón nacería en la
            // bodega y la pestaña donde se apretó el botón no lo mostraría
            // nunca. Sin las pestañas eso pasaba igual, pero se veía —la fila
            // aparecía en la lista de arriba—; con dos estantes separados
            // sería un alta que no deja rastro visible. Dar de alta EN el área
            // de vencidos pide un parámetro nuevo en esa función.
            acciones={editable && canEdit && !enVencidos ? [{
                key: 'agregar',
                icon: Plus,
                label: simple ? 'Agregar producto' : 'Agregar producto/lote',
                rotulo: 'Agregar',
                variant: 'primary',
                // No se queda en «+» a secas. El carril de tarjetas de al lado
                // se lleva el ancho, así que la píldora cedía el texto —que es
                // su regla para la acción secundaria— y dejaba un botón relleno
                // de color sin decir qué agrega. Acá la píldora prefiere mandar
                // una ranura al desborde.
                rotuloFijo: true,
                onClick: () => setShowAddForm(true),
            }] : []}
        >
            {/* 2 · entidad — un conteo no tiene ranura de ámbito: ES de una
                sucursal, y cambiarla sería abrir otro conteo. */}
            <FilterBar.Section
                active={laboratorioId != null}
                onClear={() => cambiarLaboratorio(null)}
                label="laboratorio"
            >
                <div className="w-[190px]">
                    <LiquidSelect
                        value={laboratorioId == null ? null : String(laboratorioId)}
                        onChange={(v) => cambiarLaboratorio(v == null ? null : Number(v))}
                        options={labOpciones}
                        placeholder="Laboratorio"
                        ariaLabel="Filtrar por laboratorio"
                        icon={FlaskConical}
                        compact bare
                    />
                </div>
            </FilterBar.Section>
            {/* 4 · estado */}
            <FilterBar.Section active={filtro !== 'TODOS'} onClear={() => cambiarFiltro('TODOS')} label="estado">
                {/* `FilterBar.Opciones` elige el control por la cantidad: con las
                    cuatro es un select, y en el conteo ciego —donde quedan menos—
                    vuelve solo al segmentado. Antes había que forzar
                    `layout=block/columns=2` porque el riel de cuatro se salía de la
                    hoja del teléfono arrastrando scroll horizontal.
                    Ni "con diferencia" ni "no ubicados" se ofrecen si el conteo es
                    ciego: la RPC los trata como TODOS, así que serían controles que
                    no controlan — y ofrecerlos ya insinúa que hay algo que mirar. */}
                <FilterBar.Opciones
                    label="Filtrar los renglones"
                    value={filtro}
                    onChange={cambiarFiltro}
                    options={FILTRO_PILLS
                        .filter((f) => verSistema || !f.soloConSistema)
                        .map((f) => ({ value: f.key, label: f.label }))}
                />
            </FilterBar.Section>
        </FilterBar>
    );

    // D3.9 (2026-07-27): barra reescrita a mano → canónico. Aquí era buscador
    // puro: 26 líneas para lo que el componente ya hace.
    const filtersContent = (
        <ViewTabBar
            tabs={pestanas}
            activeTab={pestana}
            onTabChange={setPestana}
            searchValue={search}
            onSearchChange={cambiarBusqueda}
            placeholder={simple ? 'Buscar producto, laboratorio o código...' : 'Buscar producto, laboratorio, lote o código...'}
            onEscanear={() => setLectorAbierto(true)}
            // En teléfono el buscador vive en la barra flotante, junto a los
            // filtros: dos accesos al mismo buscador —uno de ellos arriba, que se
            // va con el scroll— es peor que uno solo bien puesto.
            showSearch={!compacto}
        />
    );

    return (
        <GlassViewLayout icon={ClipboardCheck} title="Conteo de inventario" filtersContent={filtersContent}>
            <div className="px-2 py-4 pb-28 md:p-6 md:pb-6 lg:p-8 space-y-6">
                {/* ── Con el teléfono acostado, el encabezado se pliega ──────
                    474px encima de la lista sobre una pantalla de 390 es no ver
                    ningún producto hasta scrollear. Plegado quedan ~40px y la
                    primera fila entra. No se ESCONDE: la barra dice lo mismo en
                    una línea —sala, avance y cuánto falta— y se abre de un
                    toque, porque «Finalizar», «Imprimir» y «Volver» viven ahí
                    adentro y son acciones reales, no adorno. */}
                {conteo && altoEscaso && !encabezadoAbierto && (
                    <button type="button"
                        onClick={() => setEncabezadoAbierto(true)}
                        // Nombre propio: sin él, un lector de pantalla anuncia
                        // «Bodega En progreso 84%», que describe el contenido y
                        // no lo que el botón HACE.
                        aria-label="Desplegar el encabezado del conteo"
                        aria-expanded={false}
                        data-surface="card"
                        className="w-full min-h-[var(--tap-min)] px-3 py-2 flex items-center gap-2
                                   text-left active:scale-[0.99] transition-transform duration-[var(--dur-fast)]">
                        <span className="text-label font-black text-content truncate">{conteo.branches?.name}</span>
                        {es && <Badge variant={es.variante} size="sm">{es.label}</Badge>}
                        {resumen && (
                            <span className="text-caption text-content-3 tabular-nums whitespace-nowrap ml-auto">
                                {formatPct((resumen.total_items > 0 ? resumen.contados / resumen.total_items : 0) * 100, { decimales: 0 })}
                                {resumen.pendientes > 0 ? ` · faltan ${formatQty(resumen.pendientes)}` : ' · completo'}
                            </span>
                        )}
                        <ChevronLeft size={14} className="shrink-0 -rotate-90 text-content-3" />
                    </button>
                )}

                {conteo && !(altoEscaso && !encabezadoAbierto) && (
                    <div data-surface="card" className="p-4 md:p-5">
                        {/* Volver vive acá y no en una fila propia arriba: era un botón
                            solo en 40px de alto, y el lugar donde uno busca "de dónde
                            vengo" es junto a de qué sucursal es lo que está mirando.
                            El rótulo es "Volver" y no "Volver a Conteos" porque el
                            destino ya lo dice el título de la vista. */}
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="flex items-start gap-2 min-w-0">
                                <Button variant="ghost" icon={ChevronLeft} onClick={() => navigate('/conteo-inventario')}>Volver</Button>
                                {/* Volver a plegar. Sólo donde se pudo plegar:
                                    en cualquier otra pantalla sería un botón
                                    que esconde algo que no molestaba. */}
                                {altoEscaso && (
                                    <Button variant="ghost" icon={ChevronUp} iconOnly
                                        aria-label="Plegar el encabezado"
                                        aria-expanded
                                        onClick={() => setEncabezadoAbierto(false)} />
                                )}
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2 mb-1">
                                        <h2 className="text-body-xl font-black text-content">{conteo.branches?.name}</h2>
                                        <Badge variant={es.variante} size="sm" uppercase={false}>{es.label}</Badge>
                                        {/* Contra qué se compara lo que se teclea. Es lo que
                                            decide si una venta hecha mientras se cuenta sale
                                            como diferencia, así que no puede vivir solo en el
                                            modal de creación. */}
                                        <Badge
                                            variant={conteo.fuente_sistema === 'VIVO' ? 'warning' : 'neutral'}
                                            size="sm" uppercase={false}
                                            icon={conteo.fuente_sistema === 'VIVO' ? Radio : Printer}
                                        >
                                            {conteo.fuente_sistema === 'VIVO' ? 'En vivo' : 'Según la hoja'}
                                        </Badge>
                                    </div>
                                    <p className="text-caption text-content-2 uppercase tracking-wide">Iniciado {fmtDate(conteo.created_at?.split('T')[0])} · Alcance: {SCOPE_LABEL[conteo.scope_type] || conteo.scope_type}</p>
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
                                {/* Eliminar va acá y no en la lista: es destructivo y sin
                                    vuelta atrás, así que la única puerta es la pantalla
                                    donde se ve QUÉ conteo se está borrando. */}
                                {puedeEliminar && (
                                    <Button variant="ghost" tone="danger" icon={Trash2}
                                        disabled={busy} onClick={() => setConfirmEliminarOpen(true)}>
                                        Eliminar
                                    </Button>
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
                                        Ajuste aplicado el {fmtDateTime(conteo.ajuste_erp_at)}.
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
                                        Ajuste pendiente de aplicar: {conteo.total_diferencias} línea(s).
                                        Descarga la hoja o el CSV, aplícalo, y regístralo aquí.
                                    </Notice>
                                ) : (
                                    <Notice variant="success">Sin diferencias: no hay ajuste que aplicar.</Notice>
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
                {/* §17.0: el carril de tarjetas y la píldora de filtros van en UNA
                    fila, no en dos renglones. No es estética: `useMedidaFila` mira
                    al abuelo de la píldora y busca el carril con `[role="group"]`;
                    en renglones separados lo encuentra igual —es hermano dentro del
                    `space-y-*`— y le descuenta 314px por un carril que no tiene al
                    lado. Las tarjetas venían de adentro de la tarjeta de cabecera,
                    o sea justamente en otro renglón.

                    Existen desde antes de finalizar el conteo a propósito: salen de
                    get_conteo_resumen, que agrega TODO el conteo en vivo con la
                    misma fórmula del dinero, así que al finalizar el número no
                    cambia de golpe. Con `conteos_inventario.total_*` —que escribe
                    recalcular_totales_conteo al cerrar— valían 0 justo durante los
                    días en que sirve saber cuánto falta. */}
                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                    {/* El carril de resumen es contexto y se pliega con el
                        encabezado. La píldora de filtros NO: es herramienta —
                        buscar y filtrar es parte de contar, no de mirar. */}
                    {resumen && !(altoEscaso && !encabezadoAbierto) && (
                        <CarrilCards className="flex-1" ariaLabel="Resumen del conteo">
                            {tarjetasResumen(resumen, !hasResults, canVerMontos)}
                        </CarrilCards>
                    )}
                    <div className="flex flex-wrap items-center justify-end gap-3 min-w-0">
                    {puedeRecontar && (
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                            {/* Entrar al recuento deja la vista en "Con diferencia": es lo
                                que se recuenta. Queda como filtro y no como candado para no
                                perder el sondeo de control — verificar unas líneas que
                                cuadraron es lo que detecta al que copió el número. */}
                            <Switch
                                checked={recuento}
                                onChange={(v) => { setRecuento(v); if (v) cambiarFiltro('DIFERENCIA'); }}
                                size="sm" variant="chart-1" label="Modo recuento" />
                            <span className="text-label font-bold text-content-2 flex items-center gap-1">
                                <ShieldCheck size={12} strokeWidth={2.5} /> Modo recuento
                            </span>
                        </label>
                    )}
                    {/* «Agregar» ya no es un botón suelto al lado de la píldora:
                        vive DENTRO, como acción de la vista (§17). Suelto había
                        que mantenerlo dos veces —uno acá para el mouse y otro en
                        la barra flotante para el pulgar— y la mitad táctil nunca
                        se llegó a cablear. */}
                    {barraFiltros}
                    </div>
                </div>

                {!verSistema && (
                    <Notice variant="info" icon={EyeOff}>
                        <strong>Conteo ciego.</strong> Anota lo que ves en el estante, no lo que el sistema espera:
                        la existencia del sistema y la diferencia no se muestran porque no salen de la base para tu rol.
                        Se ven cuando el conteo se finaliza, o con el permiso «Ver Existencia del Sistema».
                    </Notice>
                )}

                {recuento && (
                    <Notice variant="info" icon={ShieldCheck}>
                        Recuento a ciegas sobre los renglones <strong>con diferencia</strong>, en orden de estante (por laboratorio).
                        El campo arranca vacío y no ves el primer conteo ni el sistema hasta registrar el tuyo.
                        No puedes recontar una línea que contaste tú mismo.
                    </Notice>
                )}

                {showAddForm && editable && conteo && !compacto && !enVencidos && (
                    <Suspense fallback={null}><AddManualItemForm
                        branchId={conteo.branch_id}
                        simple={simple}
                        onAdd={async (payload) => {
                            await agregarProductoManualConteo(id, payload);
                            setShowAddForm(false);
                            await load();
                        }}
                        onCancel={() => setShowAddForm(false)}
                    /></Suspense>
                )}

                {/* ── El estante que se está contando ──────────────────────
                    Bodega y área de vencidos son DOS estantes, y desde acá se
                    ve UNO. Antes la segunda era una sección al final de la misma
                    página: para llegar al área de vencidos había que pasar por
                    las 2,759 filas de bodega y por su paginación, y el resumen de
                    arriba mezclaba las dos listas.

                    Que sean excluyentes no es sólo orden. Un mismo producto puede
                    estar en los dos estantes con cantidades distintas, así que
                    verlos juntos invita a teclear el número de uno en la fila del
                    otro — que es el error que no deja rastro, porque las dos
                    filas existen y las dos aceptan un número. */}
                {!enVencidos && (
                    <>
                        <ListaDeConteo
                            enFichas={enFichas}
                            loading={loading}
                            products={products}
                            itemsByProduct={itemsByProduct}
                            verSistema={verSistema}
                            simple={simple}
                            columnas={columnas(verSistema, simple)}
                            orden={orden}
                            onSort={handleSort}
                            vacio="Sin productos para este filtro"
                            desbloqueadas={desbloqueadas}
                            editable={editable}
                            recuento={recuento}
                            onUnlock={setDesbloqueada}
                            onSave={handleSaveItem}
                            onRecount={handleRecountItem}
                            onShowHistory={abrirHistorial}
                            onEditLote={abrirEditLote}
                            currentUser={user}
                            enVivo={conteo?.fuente_sistema === 'VIVO'}
                        />

                        {total > 0 && (
                            <TablePagination pageSize={tamPagina} onPageSizeChange={cambiarTamPagina} page={page} totalPages={totalPages} onPageChange={setPage} total={total} unit="productos" />
                        )}
                    </>
                )}

                {/* ── Área de vencidos ──────────────────────────────────────
                    El sistema aparta lo vencido en su propia área. El aviso se
                    queda aunque ahora haya pestaña: la pestaña dice DÓNDE estoy,
                    no que lo de acá se cuenta aparte de la bodega.

                    Sin paginación propia: son decenas de productos, no miles (83
                    contra 2,759 en el conteo abierto). Si algún día crece, acá va
                    su `TablePagination`. */}
                {enVencidos && (
                    <div className="space-y-3">
                        <Notice variant="warning" icon={AlertTriangle}>
                            <strong>Otro estante.</strong> Lo apartado por vencer se recorre y se cuenta
                            aparte de la bodega. Un producto puede estar en los dos: el número que anotes
                            aquí es sólo el de esta área.
                        </Notice>
                        <ListaDeConteo
                            enFichas={enFichas}
                            loading={vencidosLoading}
                            products={vencidos}
                            itemsByProduct={vencidosItems}
                            verSistema={verSistema}
                            simple={simple}
                            columnas={columnas(verSistema, simple)}
                            vacio="Sin productos en el área de vencidos para este filtro"
                            desbloqueadas={desbloqueadas}
                            editable={editable}
                            recuento={recuento}
                            onUnlock={setDesbloqueada}
                            onSave={handleSaveVencido}
                            onRecount={handleRecountVencido}
                            onShowHistory={abrirHistorial}
                            onEditLote={abrirEditLote}
                            currentUser={user}
                            enVivo={conteo?.fuente_sistema === 'VIVO'}
                        />
                    </div>
                )}
            </div>

            {/* Escanear escribe en el buscador y no salta al producto: así el
                resultado se ve con el mismo filtro que el resto, se puede
                corregir a mano, y si el código no está en ESTE conteo la
                pantalla lo dice en vez de no hacer nada. */}
            {/* Sólo se monta al abrirlo: si se montara siempre, `lazy` bajaría
                el trozo igual al entrar a la vista y no habría diferido nada.
                Sin `fallback` visible — el propio diálogo ya muestra su
                «preparando» mientras la cámara arranca. */}
            {lectorAbierto && (
                <Suspense fallback={null}>
                    <LectorDeCodigo
                        abierto={lectorAbierto}
                        onCerrar={() => setLectorAbierto(false)}
                        onLeer={(codigo) => cambiarBusqueda(codigo)}
                        titulo="Escanear producto"
                    />
                </Suspense>
            )}

            {/* El alta en hoja inferior, el mismo material que la de filtros: en
                teléfono el formulario inline empujaba la lista tres pantallas hacia
                abajo y había que volver a subir para seguir contando. */}
            {compacto && editable && conteo && !enVencidos && (
                <ModalShell
                    open={showAddForm}
                    onClose={() => setShowAddForm(false)}
                    align="bottom"
                    maxWidthClass="max-w-none"
                    surface={null}
                    ariaLabel={simple ? 'Agregar producto al conteo' : 'Agregar producto o lote al conteo'}
                >
                    {/* `HojaMovil` en vez del envoltorio a mano: traía su propio
                        `max-h`, su propio `rounded-t-modal`, su propia área segura
                        y su asa suelta — todo lo que el canónico ya hace, y sin el
                        arrastre. El formulario lleva sus propios botones, así que
                        va sin `pie`. */}
                    <HojaMovil titulo="Agregar producto" subtitulo="Al conteo en curso" icono={PackagePlus}>
                        <Suspense fallback={null}>
                            <AddManualItemForm
                                branchId={conteo.branch_id}
                                simple={simple}
                                onAdd={async (payload) => {
                                    await agregarProductoManualConteo(id, payload);
                                    setShowAddForm(false);
                                    await load();
                                }}
                                onCancel={() => setShowAddForm(false)}
                            />
                        </Suspense>
                    </HojaMovil>
                </ModalShell>
            )}

            <PrintChooserModal
                open={printChooserOpen}
                documentos={documentos}
                busy={printing}
                onClose={() => setPrintChooserOpen(false)}
                onPick={handlePrint}
            />

            <ItemHistoryModal open={historyOpen} item={historyItem} onClose={() => setHistoryOpen(false)} simple={simple} />
            <EditLoteModal
                open={editLoteOpen}
                item={editLoteItem}
                onClose={() => setEditLoteOpen(false)}
                onSave={(itemId, payload) => handleEditLote(itemId, payload, editLoteItem?.erp_product_id)}
            />

            <FinalizarConteoModal
                open={confirmFinalizarOpen}
                pendientes={pendientesAlFinalizar}
                busy={busy}
                onClose={() => setConfirmFinalizarOpen(false)}
                onConfirm={confirmFinalizar}
            />

            {/* El mensaje dice el tamaño de lo que se va: "se eliminará el
                conteo" no distingue entre uno vacío y uno con 4,000 renglones ya
                contados y firmados. */}
            <ConfirmModal
                isOpen={confirmEliminarOpen}
                onClose={() => setConfirmEliminarOpen(false)}
                onConfirm={confirmEliminar}
                title="¿Eliminar este conteo?"
                // `resumen.total_items` son los RENGLONES; `total` es la
                // paginación por producto y diría un número mucho más chico.
                // Y el mensaje cambia según haya trabajo adentro: tirar un
                // conteo recién armado y tirar uno con 800 renglones contados
                // no son la misma decisión, aunque el botón sea el mismo.
                message={conteoEmpezado || hasResults
                    ? `Se borra el conteo de ${conteo?.branches?.name || 'la sucursal'}: ${formatQty(resumen?.total_items ?? 0)} renglón(es), de los cuales ${formatQty(resumen?.contados ?? 0)} ya están contados, y el historial de quién contó cada uno. No se puede deshacer.`
                    : `Se borra el conteo de ${conteo?.branches?.name || 'la sucursal'} con sus ${formatQty(resumen?.total_items ?? 0)} renglón(es). Todavía no se ha contado ninguno. No se puede deshacer.`}
                confirmText="Eliminar conteo"
                isProcessing={busy}
            />

            <PromptModal
                isOpen={promptAprobarOpen}
                onClose={() => setPromptAprobarOpen(false)}
                onConfirm={confirmAprobar}
                title="Aprobar conteo"
                message="Queda cerrado y con firma auditable. No puedes aprobar un conteo que finalizaste tú mismo."
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
                message="Esto no modifica existencias — el portal no escribe stock. Solo deja constancia de que el ajuste ya se aplicó, para que este conteo no quede como pendiente."
                placeholder="Referencia del ajuste (opcional)"
                confirmText="Registrar"
                cancelText="Cancelar"
                isProcessing={busy}
            />
        </GlassViewLayout>
    );
}

// Rótulo + campo. Los cuatro campos del alta van en una fila, y sin rótulo
// propio cada uno dependía de su placeholder — que desaparece en cuanto tiene
// valor, así que a los dos segundos la fila era cuatro cajas sin decir qué es
// cada una. Además alinea las bases: un campo con rótulo al lado de otro sin
// rótulo quedaba corrido hacia abajo, que es lo que se veía con el vencimiento.
// `div` + `span`, no `<label>`: un `<label>` se asocia a UN control, y acá dos de
// los cuatro campos no son un `<input>` (los `role="combobox"` de LiquidSelect) y
// el de fecha son TRES inputs adentro (día/mes/año). El nombre accesible lo lleva
// cada control por su cuenta — `ariaLabel` en los selects, `aria-label` en el
// input, y los suyos propios el date picker.

// El envoltorio que `LiquidDatePicker` EXIGE. DESIGN.md §14 lo dice con estas
// palabras: «`LiquidDatePicker` es el caso contrario y su envoltorio SÍ va. Su
// contenedor usa `h-full` — toma la altura del padre, no tiene mínimo propio.
// Quitárselo lo colapsa». Acá no tenía ninguno, y por eso el campo se veía como
// texto suelto al lado de dos selects con caja.
//
// El alto es `max(40px, var(--tap-min))`, el mismo que el trigger de
// `LiquidSelect`, para que los campos de la fila queden parejos y en táctil no
// bajen de 44px. Las clases salen de `inputHoverClass`, que existe justamente
// para «cualquier wrapper de LiquidSelect/LiquidDatePicker que necesite el mismo
// look».
//
// Pendiente anotado, no resuelto acá: hay SIETE anatomías distintas de este
// mismo envoltorio en el portal (h-[36px] rounded-xl, h-[42px] rounded-2xl,
// h-10 overflow-hidden, …). Es un canónico que hace que cada llamador se
// invente su cromo, y merece una pasada propia.

