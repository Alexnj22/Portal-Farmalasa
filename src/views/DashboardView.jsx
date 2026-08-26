import React, { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from 'react';
import Button from '../components/common/Button';
import PeriodStepper from '../components/common/PeriodStepper';
import Switch from '../components/common/Switch';
import Badge from '../components/common/Badge';
import Notice from '../components/common/Notice';
import { EmptyState } from '../components/common/StateViews';
import { useNavigate, Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
// ── `recharts` NO viaja en el chunk del Inicio ───────────────────────────────
// Pesa 95 kB gzip: era el 46% de los 204 kB que se bajaban al entrar acá, para
// dibujar el ÚNICO gráfico de la pantalla — dentro de un widget que encima es
// opcional (permiso `dash_trend`, y el usuario puede sacarlo de su tablero).
// Con el `lazy`, el Inicio baja a ~109 kB y vuelve debajo de su techo del
// `bundle-gate`. La descarga no se nota: el gráfico no se monta hasta que
// `attendanceLoaded`, y hasta entonces el widget ya pintaba su esqueleto.
// El componente vive en `dashboard/GraficaTendencia.jsx`; leer su encabezado
// antes de tocarlo (hay un bucle de WebKit detrás).
const GraficaTendencia = lazy(() => import('./dashboard/GraficaTendencia'));
// El editor de acomodo vive detrás de «Personalizar»: no viaja en el chunk de
// quien entra al Inicio y nunca lo abre.
const AcomodarModal = lazy(() => import('./dashboard/AcomodarModal'));
import {
  Users, UserCheck, ClipboardList, Building2, TrendingUp,
  CalendarDays, Megaphone, ChevronRight, ChevronLeft,
  Settings2, Activity, Flame,
  AlertTriangle, LayoutDashboard, CheckCircle2,
  BarChart2, UserX, Gift, Loader2, Clock, GripVertical, RotateCcw, Maximize2,
  FileText, Package, Receipt, ShoppingCart, Zap, Target, PackageMinus, ArrowLeftRight,
  ReceiptText, Upload, Eye, Lock, Thermometer, Pill,
  Wallet, Mail
} from 'lucide-react';
import { DAY_NAMES, formatHourAMPM } from '../utils/scheduleHelpers';
// Los mapas del sistema de origen se mudaron a `constants/erp` el 2026-08-11:
// «Solicitudes de Sucursal» abre los mismos formularios y necesita los mismos
// mapas, y dos copias a mano se desincronizan. `MM_ERP_NAMES` era además una
// segunda escritura de `ERP_NAMES`, carácter por carácter.
import {
    ERP_NAMES as MM_ERP_NAMES,
    ERP_ORDEN as MM_ERP_ORDER,
    BRANCH_A_ERP as MM_BRANCH_TO_ERP,
    ERP_UBICACION_POR_SUCURSAL,
} from '../constants/erp';
import { useAuth } from '../context/AuthContext';
import { useStaffStore as useStaff } from '../store/staffStore';
import { REQUEST_TYPES } from '../store/slices/requestsSlice';
import { supabase } from '../supabaseClient';
import GlassViewLayout from '../components/GlassViewLayout';
import WidgetInventorySearch from './dashboard/WidgetInventorySearch';
import SearchInput from '../components/common/SearchInput';
import WidgetAnnulmentRequest from './dashboard/baldosas/BaldosaFacturacion';
import WidgetMinMaxRequest from './dashboard/baldosas/BaldosaMinMax';
import WidgetInventoryMovement from './dashboard/baldosas/BaldosaInventario';
import WidgetFacturasSala from './dashboard/WidgetFacturasSala';
import WidgetDatoPedido from './dashboard/WidgetDatoPedido';
import WidgetBitacoras from './dashboard/WidgetBitacoras';
import WidgetRecetasPendientes from './dashboard/WidgetRecetasPendientes';
import WidgetTransferRequests from './dashboard/WidgetTransferRequests';
import WidgetMetaSala from './dashboard/WidgetMetaSala';
/* Las dos baldosas del dinero se bajan al PINTARSE, no al entrar al Inicio.
 *
 * Arrastran el diagnóstico de cortes y la capa de datos de bolsas —los dos
 * módulos más pesados de este circuito— y sólo se dibujan para quien tiene el
 * permiso y con la baldosa acomodada en su tablero. Se difieren al pasar la
 * campana a `lazy` (2026-08-24): esos módulos salieron del cierre del entry y
 * caían enteros acá, dejando el Inicio en 102 kB contra un techo de 99.
 *
 * Sin `Suspense` propio: `WidgetCard` ya vive dentro del que envuelve al
 * tablero, y una baldosa que aparece un instante después no corre nada — cada
 * una tiene su lugar reservado por la rejilla. */
const WidgetCortesSala = lazy(() => import('./dashboard/WidgetCortesSala'));
const WidgetBolsasSala = lazy(() => import('./dashboard/WidgetBolsasSala'));
// Estaba USADO y sin importar: el componente existe, su rama de render está
// completa y su permiso registrado, pero faltaba esta línea. No se veía porque
// `vendedores` tampoco estaba en ninguna pestaña — un bug tapando al otro.
import WidgetVendedores from './dashboard/WidgetVendedores';
import { SALAS_VENTA } from './metas/metasUtils';
import { MODULE_MAP } from '../constants/moduleMap';
import LiquidSelect from '../components/common/LiquidSelect';
import ViewTabBar from '../components/common/ViewTabBar';
import { usePestanaEnUrl } from '../hooks/usePestanaEnUrl';
import { getTodayAttendanceStatus } from '../utils/helpers';
import SegmentedControl from '../components/common/SegmentedControl';
import ListRow from '../components/common/ListRow';
import {
    fetchUserDashboardPrefs, upsertUserDashboardPrefs, fetchSalesBranchIdsSince,
    fetchPendingApprovalRequests, fetchActiveLeaveRequests, fetchTodayHourlySales,
    fetchBranchHourlySalesRange, fetchRecentCotizaciones, fetchTodayInvoicesSummary,
    fetchDashboardCanon, upsertDashboardCanon,
} from '../data/dashboard';
import { fetchRolesForPermissions, fetchRolePermissions } from '../data/permissions';
import { clickable } from '../utils/clickable';
import { reacomodar } from '../utils/acomodoWidgets';
import { permitirEscapeDelScroll } from '../utils/scrollEncadenado';
import { formatMoney } from '../utils/formatNumber';
import useCapaFlotante from '../utils/capaFlotante';
import { shortEmployeeName, employeeInitials } from '../utils/nameUtils';
import {
    catalogoDePestana, pestanasVisibles, ordenDeLaPestana, widgetsSinUbicar,
    hospedaBaldosasDeSucursal,
} from '../constants/dashboardTabs';

// ─── Grid constants ────────────────────────────────────────────────────────────
const EMPTY_OBJ  = {};
const ROW_H      = 120; // px per row unit
// ── El teléfono necesita más alto que el escritorio (2026-08-08) ───────────
// La fila valía 120 en los dos, y en el teléfono no alcanzaba: con dos columnas
// la baldosa mide 171px y un título como «Consulta de Inventario» **envuelve a
// dos líneas** —30px donde en escritorio ocupa 15—. O sea que el presupuesto
// vertical era el mismo pero el título gastaba el doble, y la franja al pie de
// las baldosas de Operación quedaba 12px afuera de la tarjeta (medido en WebKit
// iPhone 13, v2.519.0: contenido 131 contra caja 118).
//
// 150 y no 132 —lo justo— para que quepa también un título de tres líneas: un
// nombre más largo o una pantalla más angosta no tienen que volver a romperlo.
// Sale de la medida real: 111px de contenido con la franja, más 28 de padding,
// más los 15 de esa tercera línea.
//
// Aplica a TODO el tablero en móvil, no sólo a Operación: es el alto de la
// retícula. Los demás widgets ganan aire — ninguno puede desbordar porque la
// fila sólo crece— a cambio de un tablero más largo.
const ROW_H_MOVIL = 150;
const GAP_PX     = 16;  // gap-4
const GRID_COLS  = 4;   // desktop columns
const MOBILE_COLS = 2;  // mobile columns

// Auto-place widgets using CSS Grid auto-placement algorithm.
// Returns { [id]: { col, row } } (1-indexed).
function autoPlaceOrder(order, sizes, gridCols = GRID_COLS, anchoDe = null) {
  const occ = new Set();
  const result = {};
  const fits = (col, row, cols, rows) => {
    if (col + cols - 1 > gridCols) return false;
    for (let c = col; c < col + cols; c++)
      for (let r = row; r < row + rows; r++)
        if (occ.has(`${c},${r}`)) return false;
    return true;
  };
  const stamp = (col, row, cols, rows, id) => {
    for (let c = col; c < col + cols; c++)
      for (let r = row; r < row + rows; r++)
        occ.add(`${c},${r}`);
    result[id] = { col, row };
  };
  for (const id of order) {
    const def = WIDGET_SIZES[id] || { minCols: 1, minRows: 1 };
    const cols = anchoDe ? anchoDe(id) : Math.min(Math.max(sizes[id]?.cols ?? def.minCols, 1), gridCols);
    const rows = Math.max(sizes[id]?.rows ?? def.minRows, 1);
    let placed = false;
    outer: for (let r = 1; r <= 100; r++) {
      for (let c = 1; c <= gridCols; c++) {
        if (fits(c, r, cols, rows)) { stamp(c, r, cols, rows, id); placed = true; break outer; }
      }
    }
    if (!placed) result[id] = { col: 1, row: Object.keys(result).length * 4 + 1 };
  }
  return result;
}

// Widget minimum sizes and labels
// minCols: minimum allowed column span
// minRows: minimum allowed row span
const WIDGET_SIZES = {
  trend:         { minCols: 2, minRows: 2, label: 'Tendencia'    },
  shifts:        { minCols: 1, minRows: 2, label: 'Turnos'       },
  sales:         { minCols: 3, minRows: 2, label: 'Ventas'       },
  absences:      { minCols: 1, minRows: 2, label: 'Ausencias'    },
  requests:      { minCols: 1, minRows: 2, label: 'Solicitudes'  },
  branches:      { minCols: 1, minRows: 1, label: 'Sucursales'   },
  calendar:      { minCols: 2, minRows: 3, label: 'Calendario'   },
  announcements: { minCols: 1, minRows: 2, label: 'Avisos'       },
  birthdays:     { minCols: 2, minRows: 2, label: 'Cumpleaños'   },
  cotizaciones:  { minCols: 1, minRows: 2, label: 'Cotizaciones' },
  facturacion:   { minCols: 2, minRows: 2, label: 'Facturación'  },
  top_productos: { minCols: 2, minRows: 3, label: 'Top productos'},
  // 1×1 como sus tres hermanas: `WidgetInventorySearch` ya no trae el buscador
  // adentro —es un `LanzadorSolicitud`, o sea una baldosa que abre un modal—,
  // pero el registro conservaba el 2×3 del widget viejo. Resultado en el
  // teléfono: una tarjeta de 380px con el ícono arriba, el rótulo abajo y el
  // resto vacío.
  inv_search:    { minCols: 1, minRows: 1, label: 'Inventario'   },
  annulment_req: { minCols: 1, minRows: 1, label: 'Anulaciones'  },
  minmax_req:    { minCols: 1, minRows: 1, label: 'Ajuste Min/Max' },
  inv_movement:  { minCols: 1, minRows: 1, label: 'Ajuste inventario' },
  facturas_sala: { minCols: 1, minRows: 1, label: 'Facturas Sala' },
  // Dos renglones: arriba los avisos del día (hasta tres franjas) y abajo los
  // botones. Con uno solo, el aviso de lo vencido tapaba el de lo que toca ahora.
  bitacoras:     { minCols: 1, minRows: 2, label: 'Bitácoras'      },
  // Lista con botones: sin alto no entra ni un renglón (mismo motivo que
  // `cortes_sala` y `traslados`). Dos columnas porque el nombre de un
  // medicamento con su presentación no entra en una.
  recetas_pend:  { minCols: 2, minRows: 3, label: 'Recetas pendientes' },
  meta_sala:     { minCols: 2, minRows: 2, label: 'Meta del mes'  },
  // Lista con botones: sin alto no entra ni un corte (mismo motivo que
  // `vendedores` y `traslados`, abajo). Tres renglones desde el 2026-08-14:
  // arriba va la franja del mes (~62px) y abajo las tarjetas de lo que falta
  // confirmar; con dos renglones quedaba media tarjeta a la vista.
  cortes_sala:   { minCols: 2, minRows: 3, label: 'Cortes de caja' },
  // `vendedores` y `traslados` no tenían entrada, así que caían al mínimo de
  // 1×1 — una baldosa de 312×120 donde entran el título y una línea, y ni una
  // sola fila de la lista. Quien no las agrandara a mano veía dos widgets que
  // no dicen nada. Los dos son listas: necesitan alto (2026-08-10).
  //
  // Barrido de los 21 del catálogo: eran los dos únicos sin tamaño. `kpi` no
  // cuenta — es la franja de indicadores, que no es una baldosa de la grilla y
  // se filtra por id antes de acomodar.
  vendedores:    { minCols: 2, minRows: 3, label: 'Venta por vendedor' },
  traslados:     { minCols: 2, minRows: 2, label: 'Traslados'          },
  // Un pedido lleva un párrafo, un campo de correo y un botón: con una sola
  // columna el campo queda tan angosto que no se ve lo que se escribió, y
  // esto es un dato que va a un documento fiscal a nombre de otra persona.
  dato_pedido:   { minCols: 2, minRows: 2, label: 'Datos que faltan'  },
};

// La acción de un widget manda a OTRO módulo, así que el permiso que decide si
// se ofrece es el del DESTINO, no el del widget. Hasta el 2026-08-10 los 16
// puntos de navegación del Inicio miraban `can_edit` del propio `dash_*` —o
// nada, en tres de ellos—, así que a alguien con el widget y sin el módulo el
// atajo lo mandaba a una página que no puede abrir. El mapa es el mismo que
// arma el menú, para que no haya dos listas de rutas.
const MODULO_DE_RUTA = Object.fromEntries(
  Object.entries(MODULE_MAP).map(([clave, m]) => [m.path, clave])
);

const getWidgetSize = (id) => {
  if (id.startsWith('sales_branch_')) return { minCols: 1, minRows: 1, label: 'Hoy · Sucursal' };
  return WIDGET_SIZES[id] || { minCols: 1, minRows: 1, label: id };
};

/**
 * Acomoda una pestaña en RENGLONES COMPLETOS: cada fila suma exactamente
 * `gridCols` columnas y todas sus baldosas miden lo mismo de alto. O sea que el
 * tablero es un rectángulo lleno, sin una sola celda en blanco. Sólo se usa en
 * los acomodos que calcula la app —el automático de General y el adaptado por
 * cargo—, nunca sobre uno que alguien arrastró a mano.
 *
 * Reemplaza al par `autoPlaceOrder` + `rellenarFilas`, que trabajaba en dos
 * tiempos y por eso no podía cumplir la promesa: primero colocaba en el orden
 * del catálogo y **después** intentaba estirar cada banda para taparle los
 * huecos. Estirar sólo funciona si la banda salió pareja, así que cada vez que
 * el primer paso mezclaba un widget de una fila con uno de tres —`branches`
 * (1×1) al lado de `calendar` (2×3), por dar el caso real— la banda se
 * descartaba entera y el hueco quedaba puesto.
 *
 * Medido en 4 columnas contra el acomodo viejo, sobre el catálogo completo: 4
 * celdas vacías. Sobre un cargo acotado —los 10 widgets de un dependiente de
 * farmacia—: 6. Y barriendo 2,000 recortes al azar del catálogo, que es lo que
 * hace un permiso, **el 56% dejaba al menos un hueco**. O sea que el tablero
 * agujereado no era el caso raro. Con este acomodo: 0 huecos en los 7,640
 * recortes que prueba `probar-empacado.mjs` (todos los de 1, 2 y 3 widgets, más
 * 400 al azar), 0 encimados y 0 widgets sin colocar.
 *
 * Lo que se paga es alto: el tablero completo pasa de 16 renglones de rejilla a
 * 18. Es el precio de que ningún renglón mezcle alturas, y se paga a
 * conciencia — un hueco se lee como una pantalla a medio cargar, dos filas más
 * de scroll no.
 *
 * La diferencia es que acá el ORDEN y las MEDIDAS se deciden juntos. Cada
 * renglón lo abre el primer widget pendiente y lo acompañan los que tienen SU
 * MISMO ALTO y entran en lo que queda de ancho, aunque estén más adelante en el
 * catálogo. El sobrante de ancho se reparte entre los de la banda desde el
 * final —tres baldosas en cuatro columnas dejan a la última doble, dos quedan
 * mitad y mitad—, que es la regla que ya tenía `rellenarFilas`.
 *
 * **El ancho se estira sin límite; el alto, una fila como mucho.** Ensanchar
 * una baldosa la deja más cómoda, pero estirarla para emparejarla con un
 * calendario de tres filas la convierte en una tarjeta de 360px con un ícono
 * arriba y nada más. Esa fila de tolerancia no es un detalle: sin ella,
 * Operación —cuatro lanzadores de 1×1, `traslados` de 2×2 y uno más— terminaba
 * con `facturas_sala` solo, a todo lo ancho, en un renglón propio.
 *
 * Es también la respuesta al pedido del 2026-08-07 —«nunca cambiar el tamaño a
 * más pequeño, pero sí a más grande para intentar hacer rectángulos siempre»—
 * y al del 2026-08-13, «que se vea cuadrado y sin espacios en blanco».
 *
 * Devuelve layout Y medidas: el ancho repartido es el que después lee
 * `getEffectiveCols`, así que si sólo devolviera posiciones la rejilla diría
 * una cosa y el widget mediría otra.
 */
function empacarFilas(orden, medidas, gridCols) {
  const alto  = id => Math.max(medidas[id]?.rows ?? getWidgetSize(id).minRows, 1);
  const ancho = id => Math.min(Math.max(medidas[id]?.cols ?? getWidgetSize(id).minCols, 1), gridCols);

  const pendientes = orden.slice();
  const bandas = [];

  while (pendientes.length) {
    const primero = pendientes.shift();
    const h = alto(primero);
    const ids = [primero];
    let libre = gridCols - ancho(primero);

    while (libre > 0) {
      // Primero el que YA mide lo mismo de alto; recién si no hay ninguno se
      // acepta uno de una fila menos y se lo estira. El tope de una fila no es
      // decorativo: es la diferencia entre una lista que gana aire y una
      // baldosa de 360px con un ícono arriba y nada más.
      const cabe = id => ancho(id) <= libre;
      let i = pendientes.findIndex(id => alto(id) === h && cabe(id));
      if (i === -1) i = pendientes.findIndex(id => alto(id) === h - 1 && cabe(id));
      if (i === -1) break;
      const [id] = pendientes.splice(i, 1);
      ids.push(id);
      libre -= ancho(id);
    }

    bandas.push({ h, ids });
  }

  // ── El reparto entre DOS renglones vecinos ─────────────────────────────────
  // Lo que sobra de ancho se lo reparten los widgets del renglón, así que un
  // renglón con uno solo se lo lleva todo. Con cinco lanzadores de 1×1 en
  // cuatro columnas eso daba una fila de cuatro y otra con «Ajuste de
  // inventario» SOLO, a todo lo ancho: sin hueco, pero leyéndose como un cartel
  // — visto en la captura del tablero de pruebas.
  //
  // El renglón de arriba MÁS CERCANO que mida lo mismo de alto —no
  // necesariamente el inmediato: entre los cinco lanzadores del catálogo se
  // meten el calendario y los widgets de dos filas— le presta uno, y quedan
  // 3 + 2. Se hace sólo cuando BAJA el ensanche máximo que carga una baldosa:
  // con `facturacion`+`traslados` arriba y `meta_sala` sola abajo, el préstamo
  // dejaría a `facturacion` sola —el mismo problema, corrido un renglón— y por
  // eso ahí no se hace.
  const sobrante = ids => gridCols - ids.reduce((s, id) => s + ancho(id), 0);
  const tension  = ids => Math.ceil(Math.max(sobrante(ids), 0) / ids.length);
  for (let i = bandas.length - 1; i > 0; i--) {
    const abajo = bandas[i];
    if (abajo.ids.length !== 1) continue;
    const j = bandas.findLastIndex((b, k) => k < i && b.h === abajo.h && b.ids.length >= 2);
    if (j === -1) continue;
    const arriba = bandas[j];
    const prestado = arriba.ids[arriba.ids.length - 1];
    if (ancho(prestado) > sobrante(abajo.ids)) continue;
    const nuevoArriba = arriba.ids.slice(0, -1);
    const nuevoAbajo  = [prestado, ...abajo.ids];
    if (Math.max(tension(nuevoArriba), tension(nuevoAbajo)) >= Math.max(tension(arriba.ids), tension(abajo.ids))) continue;
    arriba.ids = nuevoArriba;
    abajo.ids  = nuevoAbajo;
  }

  const layout = {};
  const nuevasMedidas = { ...medidas };
  let fila = 1;

  for (const { h, ids } of bandas) {
    // Lo que no se pudo llenar con otro widget se reparte como ancho extra,
    // desde el final: tres baldosas en cuatro columnas dejan a la última doble,
    // dos quedan mitad y mitad. Así nunca queda una celda muerta al final.
    const extra = Object.fromEntries(ids.map(id => [id, 0]));
    let libre = sobrante(ids);
    let i = ids.length - 1;
    while (libre > 0) {
      extra[ids[i]] += 1;
      libre -= 1;
      i = i === 0 ? ids.length - 1 : i - 1;
    }

    let col = 1;
    ids.forEach(id => {
      const w = ancho(id) + extra[id];
      layout[id]        = { col, row: fila };
      nuevasMedidas[id] = { cols: w, rows: h };
      col += w;
    });
    fila += h;
  }

  return { layout, medidas: nuevasMedidas };
}

// Coloca widgets nuevos en el primer hueco REAL del acomodo guardado.
//
// Antes esto lo resolvía `autoPlaceOrder` sobre "los que ya están + los que
// faltan", quedándose sólo con la posición de los nuevos. El problema es que
// `autoPlaceOrder` COMPACTA: reacomoda todo contra la esquina superior
// izquierda. O sea que el hueco que encontraba para el widget nuevo era un
// hueco del tablero **compactado**, no del que el usuario tiene guardado.
//
// En un tablero recién armado los dos coinciden y no se nota. En cuanto alguien
// mueve una baldosa hacia abajo o deja un espacio, dejan de coincidir: el lugar
// que el recálculo veía libre está ocupado en el acomodo de verdad, y las dos
// baldosas quedan encimadas. Reportado con una captura el 2026-08-07.
//
// Acá se sella la huella real —cada widget con su tamaño real y su posición
// guardada— y recién sobre eso se busca. `sizes` son los tamaños que el usuario
// eligió; el mínimo del registro es sólo el arranque.
function colocarEnHuecos(base, faltan, sizes, gridCols) {
  const ocupado = new Set();
  const medida = (id) => {
    const def = getWidgetSize(id);
    return {
      cols: Math.min(Math.max(sizes[id]?.cols ?? def.minCols, 1), gridCols),
      rows: Math.max(sizes[id]?.rows ?? def.minRows, 1),
    };
  };
  const marcar = (col, row, cols, rows) => {
    for (let c = col; c < col + cols; c++)
      for (let r = row; r < row + rows; r++) ocupado.add(`${c},${r}`);
  };
  const entra = (col, row, cols, rows) => {
    if (col + cols - 1 > gridCols) return false;
    for (let c = col; c < col + cols; c++)
      for (let r = row; r < row + rows; r++)
        if (ocupado.has(`${c},${r}`)) return false;
    return true;
  };

  let ultimaFila = 0;
  for (const [id, pos] of Object.entries(base)) {
    const { cols, rows } = medida(id);
    marcar(pos.col, pos.row, cols, rows);
    ultimaFila = Math.max(ultimaFila, pos.row + rows - 1);
  }

  const salida = {};
  for (const id of faltan) {
    const { cols, rows } = medida(id);
    // El techo del barrido sale del propio tablero: la fila más baja ocupada
    // más el alto del nuevo. Con eso siempre queda al menos una franja vacía
    // debajo de todo, así que el bucle no puede terminar sin colocarlo. Un tope
    // fijo (el `r <= 100` de `autoPlaceOrder`) se queda corto justo en el
    // tablero largo, que es donde de verdad hay que buscar.
    const techo = ultimaFila + rows + 1;
    let puesto = false;
    for (let r = 1; r <= techo && !puesto; r++) {
      for (let c = 1; c <= gridCols && !puesto; c++) {
        if (entra(c, r, cols, rows)) {
          marcar(c, r, cols, rows);
          salida[id] = { col: c, row: r };
          ultimaFila = Math.max(ultimaFila, r + rows - 1);
          puesto = true;
        }
      }
    }
  }
  return salida;
}

const DEFAULT_WIDGET_ORDER = ['trend', 'shifts', 'sales', 'absences', 'requests', 'branches', 'calendar', 'announcements', 'birthdays', 'cotizaciones', 'facturacion', 'top_productos'];

// ─── Tabs ─────────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'general',   label: 'General',   icon: LayoutDashboard },
  { id: 'comercial', label: 'Comercial', icon: ShoppingCart    },
  { id: 'rrhh',      label: 'RRHH',      icon: Users           },
  { id: 'operacion', label: 'Operación', icon: Zap             },
];

// Min/Max usa sucursal ERP (1-7); el portal usa branch_id. Los mapas están en
// `constants/erp` y se importan arriba con sus nombres de acá.
// Las siete salas de `MM_BRANCH_TO_ERP` son las que cargan compras; el resto
// (Administración) no. Ésta es la que abre el widget de Facturas de mi Sala
// cuando la propia no está entre ellas — La Popular, la primera del orden de
// despacho, igual que en el resto del tablero.
const SALA_COMPRAS_POR_DEFECTO = 2;

// Las salas que venden (Bodega no tiene meta) — la lista vive en el módulo de
// Metas, que es su dueño; acá solo se consume.
const META_SALA_IDS = SALAS_VENTA;

// ── Qué sucursales entran en el selector de cada baldosa (2026-08-07) ───────
// Reportado: «en los selectores de sucursal, no debe aparecer administración
// [...] ya que no vende, no tiene inventario».
//
// Y era literal: `branches` trae las 8 filas del maestro, incluida
// Administración, que no está mapeada al sistema de origen. Elegirla abría la
// baldosa contra una sucursal sin nada — lista vacía, sin decir por qué.
//
// El criterio no es el mismo para las dos familias de baldosa, y por eso son
// dos listas:
//   · Facturación mira facturas → `SALAS_VENTA`. Verificado contra
//     `sales_invoices` de julio 2026: emiten esas 6 y nadie más (Bodega, 0).
//   · Inventario y Min/Max miran existencias → las 7 del mapa ERP, Bodega
//     incluida, que sí tiene inventario. Eso ya lo daba `MM_ERP_ORDER`, que
//     nace de ese mapa y por eso nunca tuvo el problema.
const SALAS_QUE_FACTURAN = SALAS_VENTA;
const salaQueFacturaPorDefecto = (branchId) =>
    String(SALAS_QUE_FACTURAN.includes(Number(branchId)) ? Number(branchId) : SALAS_QUE_FACTURAN[0]);

// ⚠️ `general` NO se escribe a mano — se deriva de `WIDGET_DEFS` (más abajo).
//
// Era una lista paralela y se desincronizó dos veces sin que nada avisara: un
// widget registrado, con su permiso y su render, que no estaba acá **no aparece
// en ninguna pestaña ni en el panel de Personalizar**. No hay error, no hay
// hueco visible: simplemente no existe. Así se perdieron «Traslados entre
// Salas» y «Quién está vendiendo», y los dos se descubrieron abriendo el
// tablero, no leyendo el código.
//
// Las otras tres pestañas SÍ son listas a mano, porque son una curaduría: qué
// mirar cuando uno entra a Comercial. Ahí la lista corta es el punto.
// El reparto vive en `src/constants/dashboardTabs.js`, porque **Permisos** lo
// necesita igual para agrupar los widgets por pestaña. Acá sólo se le pasa el
// catálogo completo, que es lo único que esta pantalla sabe y aquél no.
const TAB_WIDGETS = {
  get general()   { return catalogoDePestana('general', WIDGET_DEFS.map(w => w.id)); },
  get comercial() { return catalogoDePestana('comercial'); },
  get rrhh()      { return catalogoDePestana('rrhh'); },
  get operacion() { return catalogoDePestana('operacion'); },
};

// La medida efectiva de un widget en una retícula de `gridCols` columnas: lo
// que la persona eligió, recortado al ancho disponible, o el mínimo del
// catálogo si nunca lo tocó.
const medidaEfectiva = (sizes, gridCols) => (id) => ({
  cols: Math.min(sizes[id]?.cols ?? getWidgetSize(id).minCols, gridCols),
  rows: sizes[id]?.rows ?? getWidgetSize(id).minRows,
});

// Dónde queda cada widget después de soltar uno encima de otro.
//
// La regla vive en `utils/acomodoWidgets` y no acá porque el modal de Acomodar
// resuelve exactamente lo mismo: con dos copias, arrastrar en el tablero y
// arrastrar en el modal terminarían acomodando distinto, que es la clase de
// desacuerdo que nadie reporta como bug — se reporta como «el tablero hace
// cosas raras».
//
// Esta envoltura existe para que los llamadores sigan pasando `sizes` crudo.
function resolveCollisions(dragId, targetCol, targetRow, layout, sizes, gridCols = GRID_COLS) {
  return reacomodar(dragId, targetCol, targetRow, layout, medidaEfectiva(sizes, gridCols), gridCols);
}

// ─── Other constants ───────────────────────────────────────────────────────────
/* Cómo se llama un tipo de solicitud, en castellano.
 *
 * Acá vivía `REQUEST_TYPE_LABELS`, una lista escrita a mano con **7 de los 15**
 * tipos: tenía los de la persona —vacaciones, permiso, incapacidad, anticipo,
 * constancia, cambio de turno, horas extra— y ninguno de los que hablan de la
 * sala. Nació cuando esos eran todos los que había, y las dos veces que el
 * portal sumó una familia entera —facturación en su momento, inventario,
 * traslado y Min/Max después— nadie volvió a tocarla, porque no falla: el
 * `|| r.type` de al lado imprimía la clave cruda y seguía de largo.
 *
 * Resultado, reportado por el usuario: el widget de solicitudes rotulaba una
 * fila `INVENTORY_DISCARD_REQUEST` debajo del nombre de quien la mandó.
 *
 * `REQUEST_TYPES` del store es el registro único —el mismo que usan la bandeja,
 * la tarjeta, el modal y la campana— y tiene los 15. Se lee de ahí en vez de
 * mantener una segunda copia, que es exactamente lo que se acaba de romper.
 * El `?? tipo` final no es un rótulo: es la señal de que falta uno en el
 * registro, y ahí sí hay que agregarlo (en el registro, no acá).
 */
const nombreDeTipo = (tipo) => REQUEST_TYPES[tipo]?.label ?? tipo;

/* La versión corta, para el chip que va al lado del nombre completo. Se queda
 * con la primera palabra —«Permiso / licencia» → «Permiso»— y sólo se usa en
 * Ausencias, donde conviven tres tipos que la primera palabra ya distingue. */
const nombreCorto = (tipo) => nombreDeTipo(tipo).split(' ')[0];

// Tokenizado T7 — mismo criterio de PERMIT=cat-2 que RequestsView/
// EmployeeProfileView (mismo enum de tipo de ausencia en toda la app).
// El `bg`/`border` se queda porque pinta también el cuadro del ícono, que es
// una SUPERFICIE y no un chip. `variante` es para el chip. PERMIT pasa de
// success a success — mismo verde desde v2.139.0.
const ABSENCE_COLORS = {
  VACATION:   { bg: 'bg-warning/10', text: 'text-warning-text', border: 'border-warning/30', variante: 'warning' },
  DISABILITY: { bg: 'bg-danger/10',  text: 'text-danger-text',  border: 'border-danger/30',  variante: 'danger'  },
  PERMIT:     { bg: 'bg-success/10', text: 'text-success-text', border: 'border-success/30', variante: 'success' },
};

// Actividad en tiempo real — categórico puro salvo ABSENT (falta de marca,
// sí necesita leerse como "requiere seguimiento" → warning).
// `variante` reemplaza al trío bg/text/border, que era la paleta SOFT de
// `Badge` a mano. `dot` se queda: se usa aparte para el punto de estado.
// WORKING pasa de success a success — es el mismo verde desde v2.139.0.
const STATUS_CONFIG = {
  WORKING:   { label: 'En labores',    dot: 'bg-success',   variante: 'success' },
  LUNCH:     { label: 'Almuerzo',      dot: 'bg-chart-4',   variante: 'chart-4' },
  LACTATION: { label: 'Lactancia',     dot: 'bg-chart-6',   variante: 'chart-6' },
  BUSINESS:  { label: 'Gest. externa', dot: 'bg-chart-1',   variante: 'chart-1' },
  OUT:       { label: 'Salida',        dot: 'bg-content-3', variante: 'neutral' },
  ABSENT:    { label: 'Sin marcar',    dot: 'bg-warning',   variante: 'warning' },
};

// El tinte de un acento: mismo color, bajado a un porcentaje. Reemplaza a los
// `rgba(0,82,204,0.10)` escritos a mano, que clavaban el valor del token y se
// quedaban con el color viejo el día que la paleta cambiara.
const tinte = (color, pct) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

// F6 (PLAN-IDENTIDAD): estos cuatro eran `#0052CC`, `#12B76A`, `#F79009` y
// `#6929C4` — o sea EXACTAMENTE `--brand`, `--success`, `--warning` y
// `--brand-purple`, clavados. No estaban fuera de la paleta: estaban desatados
// de ella, que es peor de detectar. Se veían bien y cualquier cambio del token
// los habría dejado atrás en silencio.
const CATEGORY_META = {
  personal:  { label: 'Personal',   color: 'var(--brand)'        },
  ventas:    { label: 'Ventas',     color: 'var(--success)'      },
  productos: { label: 'Productos',  color: 'var(--warning)'      },
  general:   { label: 'General',    color: 'var(--brand-purple)' },
};

const WIDGET_DEFS = [
  { id: 'kpi',           label: 'Estadísticas clave',     permission: 'dash_kpi',           icon: TrendingUp,   category: 'personal'  },
  { id: 'trend',         label: 'Tendencia de asistencia', permission: 'dash_trend',         icon: Activity,     category: 'personal'  },
  { id: 'requests',      label: 'Solicitudes pendientes',  permission: 'dash_requests',      icon: ClipboardList,category: 'personal'  },
  { id: 'shifts',        label: 'Estado de turnos',        permission: 'dash_shifts',        icon: Users,        category: 'personal'  },
  { id: 'absences',      label: 'Ausencias activas',       permission: 'dash_absences',      icon: UserX,        category: 'personal'  },
  { id: 'sales',         label: 'Ventas por día/hora',     permission: 'dash_sales',         icon: BarChart2,    category: 'ventas'    },
  { id: 'branches',      label: 'Alertas de sucursales',    permission: 'dash_branches',      icon: Building2,    category: 'general'   },
  { id: 'calendar',      label: 'Calendario',              permission: 'dash_calendar',      icon: CalendarDays, category: 'general'   },
  { id: 'announcements', label: 'Avisos recientes',        permission: 'dash_announcements', icon: Megaphone,    category: 'general'   },
  { id: 'birthdays',     label: 'Cumpleaños del mes',      permission: 'dash_birthdays',     icon: Gift,         category: 'personal'  },
  { id: 'cotizaciones',  label: 'Cotizaciones activas',    permission: 'dash_cotizaciones',  icon: Receipt,      category: 'ventas'    },
  { id: 'facturacion',   label: 'Facturación hoy',         permission: 'dash_facturacion',   icon: FileText,     category: 'ventas'    },
  { id: 'top_productos', label: 'Top productos del mes',   permission: 'dash_top_productos', icon: Package,      category: 'productos' },
  { id: 'inv_search',   label: 'Consulta de inventario',  permission: 'dash_inv_search',    icon: Package,      category: 'productos' },
  { id: 'annulment_req',label: 'Solicitud de anulación',  permission: 'dash_annulment_req', icon: Receipt,      category: 'ventas'    },
  { id: 'minmax_req',   label: 'Ajuste de Min/Max',       permission: 'dash_minmax_req',   icon: BarChart2,    category: 'productos' },
  { id: 'inv_movement', label: 'Ajuste de inventario',    permission: 'dash_inv_movement', icon: PackageMinus, category: 'productos' },
  { id: 'traslados',    label: 'Traslados entre salas',   permission: 'dash_traslados',    icon: ArrowLeftRight, category: 'productos' },
  { id: 'facturas_sala',label: 'Facturas de mi sala',     permission: 'dash_facturas_sala',icon: ReceiptText,  category: 'productos' },
  { id: 'bitacoras',    label: 'Bitácoras de mi sala',     permission: 'dash_bitacoras',    icon: Thermometer,  category: 'productos' },
  { id: 'recetas_pend', label: 'Recetas pendientes de mi sala', permission: 'dash_recetas_pendientes', icon: Pill, category: 'productos' },
  { id: 'meta_sala',    label: 'Meta del mes',            permission: 'dash_meta_sala',    icon: Target,       category: 'ventas'    },
  { id: 'vendedores',   label: 'Venta por vendedor',       permission: 'dash_vendedores',   icon: Users,        category: 'ventas'    },
  { id: 'cortes_sala',  label: 'Cortes de caja de mi sala', permission: 'dash_cortes_sala', icon: Wallet,       category: 'ventas'    },
  { id: 'bolsas_sala',  label: 'Bolsas de efectivo de mi sala', permission: 'dash_bolsas_sala', icon: Package,  category: 'ventas'    },
  { id: 'dato_pedido',  label: 'Datos que faltan',        permission: 'dash_dato_pedido',  icon: Mail,         category: 'ventas'    },
];

// El permiso de cada widget, indexado. Lo necesitan la barra de pestañas, el
// orden del canon y el previsualizador por cargo: tres lugares que antes lo
// rearmaban por su cuenta a partir de `WIDGET_DEFS`.
const PERMISO_DE = Object.fromEntries(WIDGET_DEFS.map(w => [w.id, w.permission]));

const MONTH_NAMES_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
// Los nombres completos son SOLO para el nombre accesible de la rejilla: la
// celda muestra "Ene" pero un lector de pantalla debe oír "Enero de 2026".
const MONTH_NAMES_LONG = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// ─── Sub-components ───────────────────────────────────────────────────────────

// ─── Skeleton primitives ──────────────────────────────────────────────────────
const Skel = ({ className = '', style }) => (
  <div className={`skeleton rounded-lg ${className}`} style={style} />
);

// El esqueleto del widget de tendencia. Está en su propio componente porque lo
// usan DOS esperas que el usuario ve como una sola: la consulta de asistencia y
// la descarga del chunk de `recharts`. Escrito dos veces, una de las dos se
// habría quedado atrás — y entonces el gráfico aparecería después de un segundo
// hueco con otra forma, que es exactamente lo que un esqueleto existe para
// evitar (ver la nota de `DataTable` sobre esto mismo).
const EsqueletoTendencia = () => (
  <div className="flex flex-col justify-end h-full gap-2">
    <div className="flex items-end gap-2 flex-1">
      {[45,72,58,88,62,95,42].map((h,i) => (
        <div key={i} className="flex-1 flex flex-col justify-end h-full">
          <Skel className="w-full rounded-t-md" style={{ height:`${h}%` }} />
        </div>
      ))}
    </div>
    <div className="flex gap-2 shrink-0">
      {[0,1,2,3,4,5,6].map(i => <Skel key={i} className="flex-1 h-2" />)}
    </div>
  </div>
);

const KpiCardSkeleton = () => (
  <div data-surface="card" className="relative p-4 flex flex-col gap-3">
    <div className="absolute inset-0 pointer-events-none rounded-3xl" style={{ background: 'linear-gradient(to bottom right, var(--card-sheen-strong), transparent)' }} />
    <div className="flex items-center gap-2">
      <Skel className="w-7 h-7 rounded-xl flex-shrink-0" />
      <Skel className="h-2.5 flex-1 max-w-[110px]" />
    </div>
    <div className="flex items-end justify-between gap-1">
      <Skel className="h-8 w-12" />
      <Skel className="h-2.5 w-20" />
    </div>
  </div>
);

const SalesBranchSkeleton = () => (
  <div data-surface="card" className="p-3.5 flex flex-col gap-2">
    <div className="flex items-start justify-between gap-2">
      <Skel className="h-3 w-24" />
      <Skel className="h-3 w-14 shrink-0" />
    </div>
    <div className="flex items-end gap-[2px] flex-1 min-h-[60px]">
      {[55,72,40,88,62,95,48,70,83,58,65,90].map((h,i) => (
        <div key={i} className="flex-1 flex flex-col justify-end h-full">
          <Skel className="w-full rounded-t-[2px]" style={{ height: `${h}%`, animationDelay: `${i * 60}ms` }} />
        </div>
      ))}
    </div>
    <div className="flex gap-[2px]">
      {[0,1,2,3,4,5,6,7,8,9,10,11].map(i => (
        <Skel key={i} className="flex-1 h-1.5" style={{ animationDelay: `${i * 40}ms` }} />
      ))}
    </div>
  </div>
);

// ── `pide`: cuál de las cuatro fichas hay que mirar ──────────────────────────
//
// Las cuatro se dibujaban idénticas: mismo tamaño, mismo peso, misma
// composición. Con tres en cero, había que leer las cuatro para descubrir que
// ninguna pedía nada — que es exactamente lo contrario de para qué existe una
// fila de indicadores.
//
// `pide` lo declara el llamador porque sólo él sabe qué es «pendiente» en su
// dominio: solicitudes sin resolver, sucursales con alerta. Cuando algo pide
// acción, su número toma el color de la ficha y un aro del mismo tinte; cuando
// no, los cuatro números son del color de lectura y la fila entera se lee como
// contexto en calma. La jerarquía no es de tamaño: es de **estado**, así que no
// salta el layout cuando el número cambia.
const KpiCard = ({ icon: Icon, label, value, sub, color, onClick, pide = false }) => (
  <div data-surface="card" {...clickable(onClick)}
    style={pide ? { boxShadow: `0 0 0 1.5px ${tinte(color, 45)}, var(--shadow-glass-3)` } : undefined}
    className={`group animate-kpi-enter relative rounded-3xl border border-border-card p-4 flex flex-col gap-3 ${pide ? '' : 'shadow-[var(--shadow-glass-3)]'} ${onClick ? 'cursor-pointer hover:shadow-[var(--shadow-glass-4)] active:scale-[0.97] transition-[transform,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-spring)]' : ''}`}>
    <div className="absolute inset-0 pointer-events-none rounded-3xl" style={{ background: 'linear-gradient(to bottom right, var(--card-sheen-strong), transparent)' }} />
    {/* Icon + label in the same row — breaks the "icon alone in corner" hero-metric pattern */}
    <div className="relative flex items-center gap-2">
      <div className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0 transition-[transform] duration-[var(--dur-base)] ease-[var(--ease-spring)] group-hover:scale-[1.08]" style={{ background: tinte(color, pide ? 14 : 9.4), border: `1px solid ${tinte(color, pide ? 20 : 12.5)}` }}>
        <Icon size={14} strokeWidth={2} style={{ color }} />
      </div>
      <p className="text-label font-semibold text-content-3 leading-snug">{label}</p>
    </div>
    {/* Value + sub as context pair */}
    <div className="relative flex items-end justify-between gap-1">
      {/* `text-content` sigue siendo el default; el `style` sólo lo pisa cuando
          la ficha pide acción. Sin la clase, el número heredaba el color del
          contenedor y en un tema quedaba distinto que en otro. */}
      <p className="text-display font-black text-content leading-none" style={pide ? { color } : undefined}>{value}</p>
      {sub && <span className="text-label font-bold text-content-3 pb-0.5">{sub}</span>}
    </div>
  </div>
);

// Liquid-glass widget card — fills grid cell height, content scrolls internally
const WidgetCard = ({ title, icon: Icon, action, children, noClip = false, category = 'general' }) => {
  const cat = CATEGORY_META[category] || CATEGORY_META.general;
  return (
    <div data-surface="card" className={`h-full relative rounded-card border border-border-card shadow-[var(--shadow-glass-3)] hover:shadow-[var(--shadow-glass-4)] transition-[transform,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-spring)] flex flex-col ${noClip ? '' : 'overflow-hidden'}`}>
      {/* §20 · La capa de vidrio a mano se RETIRÓ (2026-08-06). El contenedor ya
          es `data-surface="card"`, así que pintaba `--surface-card` y un blur por
          SEGUNDA vez: las tarjetas del tablero salían con el doble de relleno que
          cualquier otra del portal (0.16 + 0.16 ≈ 0.30 en Liquid claro).
          El comentario que la justificaba citaba un bug de Chrome —«overflow-hidden
          + backdrop-filter en el mismo elemento rompe el blur»— que hoy no se
          sostiene: 21 tarjetas canónicas del portal combinan las dos cosas,
          `DataTable` incluida, y su vidrio funciona. */}
      {/* Glass shine */}
      <div className="absolute inset-0 pointer-events-none rounded-card" style={{ background: 'linear-gradient(to bottom, var(--card-sheen), transparent)' }} />
      {/* Header — 56px de alto y tres piezas antes del 2026-08-10: la baldosa
          del icono (28px), el título y la acción, con 14px de aire arriba y
          abajo. En una baldosa de 120px por renglón eso es casi la mitad del
          widget más chico gastada en decir cómo se llama.
          Ahora el icono va suelto —sin su recuadro, que era un marco dentro de
          otro— y el aire baja a 10px: 42px, un 25% menos, en los 21 widgets a
          la vez. El color de categoría sigue estando; lo lleva el glifo. */}
      <div className="relative flex items-center justify-between px-4 py-2.5 border-b border-border-card shrink-0 gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Icon size={15} style={{ color: cat.color }} strokeWidth={2.5} className="shrink-0" />
          <h3 className="text-body-sm font-black text-content tracking-tight truncate">{title}</h3>
        </div>
        {/* `whitespace-nowrap`: el corte de línea cae en el espacio que hay
            entre «Ver todas» y su flecha, así que en el teléfono el chevron se
            iba solo a un segundo renglón, debajo del texto. Son seis widgets. */}
        {action && <div className="shrink-0 whitespace-nowrap">{action}</div>}
      </div>
      <div className={`relative flex-1 min-h-0 ${noClip ? 'overflow-visible' : 'overflow-hidden'}`}>{children}</div>
    </div>
  );
};

const MonthYearPicker = ({ value, onChange, isMobile = false }) => {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(value.getFullYear());
  const btnRef = useRef(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const openPicker = () => {
    if (btnRef.current) { const r = btnRef.current.getBoundingClientRect(); setCoords({ top: r.bottom + 8, left: r.left + r.width / 2 }); }
    setViewYear(value.getFullYear()); setOpen(true);
  };
  // Con el selector de mes abierto, los widgets de atrás se quedan quietos —
  // ver `src/utils/capaFlotante.js`. Es justo el tablero donde se midió el
  // salto: 51 de 70 posiciones del puntero tenían una tarjeta moviéndose.
  useCapaFlotante(open);
  useEffect(() => {
    if (!open) return;
    const close = e => { if (!btnRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <>
      {/* py-2.5 en mobile: sube la altura del touch target de ~24px a ~40px
          (el ancho ya es generoso, min-w-[120px], v2.47.4) */}
      <Button
        ref={btnRef}
        variant="ghost"
        size={isMobile ? 'md' : 'sm'}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="capitalize min-w-[120px]"
        onClick={openPicker}>
        {value.toLocaleDateString('es-SV', { month: 'long', year: 'numeric' })}
      </Button>
      {open && createPortal(
        <div style={{ position: 'fixed', top: coords.top, left: coords.left, transform: 'translateX(-50%)', zIndex: 99999 }} className="animate-in fade-in zoom-in-95 duration-[var(--dur-base)] origin-top" onMouseDown={e => e.stopPropagation()}>
          <div data-surface="card" className="p-4 w-[196px]">
            <div className="flex items-center justify-center mb-3 px-1">
              <PeriodStepper
                  size="sm"
                  unit="año"
                  label={String(viewYear)}
                  onPrev={() => setViewYear(y => y - 1)}
                  onNext={() => setViewYear(y => y + 1)}
              />
            </div>
            {/* Rejilla de meses de un selector de fecha. NO pasa por
                `SegmentedControl` porque tiene TRES estados, no dos: elegido,
                "el mes de hoy" (el aro) y el resto — y el canónico solo
                distingue activo/inactivo, así que perdería el aro, que es la
                referencia para saber dónde estás parado.
                Lo que sí le faltaba: cada celda decía solo "ene", sin el año,
                y nada indicaba cuál es hoy. */}
            <div role="group" aria-label="Elegir el mes" className="grid grid-cols-3 gap-1">
              {MONTH_NAMES_SHORT.map((m, i) => {
                const isSel = value.getMonth() === i && value.getFullYear() === viewYear;
                const isCur = new Date().getMonth() === i && new Date().getFullYear() === viewYear;
                return (
                  <button key={i} onClick={() => { onChange(new Date(viewYear, i, 1)); setOpen(false); }}
                    aria-current={isSel ? 'date' : isCur ? 'true' : undefined}
                    aria-label={`${MONTH_NAMES_LONG[i]} de ${viewYear}${isCur ? ' (mes actual)' : ''}`}
                    className={`text-label font-bold py-1.5 rounded-xl transition-[background-color,color,box-shadow] active:scale-[0.97] ${isSel ? 'bg-brand text-white shadow-[var(--shadow-glow-brand)]' : isCur ? 'text-brand-text font-black ring-1 ring-brand/30 hover:bg-brand/10' : 'text-content-2 hover:bg-surface-card-hover hover:text-content'}`}>
                    {m}
                  </button>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const parseMeta = (raw) => typeof raw === 'object' && raw !== null ? raw : (() => { try { return JSON.parse(raw); } catch { return {}; } })();
const localDateStr = (d = new Date()) => { const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; };
const getBranchIssue = (b) => {
  if (!b.address) return 'Sin dirección registrada';
  if (!b.phone && !b.cell) return 'Sin teléfono de contacto';
  if (b.propertyType === 'RENTED' && b.rent?.contract?.endDate) { const d = Math.ceil((new Date(b.rent.contract.endDate)-new Date())/86400000); if (d<=60) return `Contrato vence en ${d} días`; }
  return null;
};

// ─── Per-tab layout init helpers ──────────────────────────────────────────────
const initTabLayouts = (userId) => {
  const result = {};
  TABS.forEach(tab => {
    try {
      const saved = localStorage.getItem(`portal_dash_layout_${userId||'guest'}_${tab.id}`);
      // Se filtra contra los widgets que existen HOY. Un tablero guardado
      // conserva el id de un widget retirado —le pasó a `srs_inv` al quitarlo—
      // y sin esto queda reservando su hueco en la grilla para siempre, porque
      // nada lo borra: la posición vive en localStorage, no en el código.
      if (saved) {
        const p = JSON.parse(saved);
        const vigentes = Object.fromEntries(
          Object.entries(p).filter(([id]) => TAB_WIDGETS.general.includes(id))
        );
        if (Object.keys(vigentes).length) { result[tab.id] = vigentes; return; }
      }
    } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
    const order = (TAB_WIDGETS[tab.id] || []).filter(id => id !== 'kpi');
    result[tab.id] = autoPlaceOrder(order, {});
  });
  return result;
};
// La marca de «esta pestaña la acomodó la PERSONA». Deliberadamente separada
// del layout guardado: ese lo escribe la app sola en dos sitios, así que su
// existencia no prueba que nadie haya movido nada. Ver `tabsAcomodadas`.
const claveAcomodada = (userId, tabId) => `portal_dash_acomodada_${userId || 'guest'}_${tabId}`;

// ─── El reinicio de General ───────────────────────────────────────────────────
//
// Devuelve el tablero de General al acomodo automático para TODO el mundo, una
// vez. Se pidió el 2026-08-13, junto con el acomodo por renglones completos:
// los tableros acomodados a mano se armaron contra el catálogo de otro momento
// y con el acomodo viejo, así que quedarse con ellos es quedarse justo con los
// huecos que este cambio viene a cerrar.
//
// **Sube la fecha para volver a reiniciar a todos.** Cada navegador lo aplica
// una sola vez por valor —queda anotado en `localStorage`— así que no le pisa
// el tablero a nadie que acomode el suyo después.
//
// Lo local es la mitad del trabajo: la marca de «acomodada» y el acomodo viven
// también en `user_dashboard_prefs`, y esa copia la limpió una migración de
// datos el mismo día (`20260813..._reinicio_dashboard_general`). Hacían falta
// las dos: la base no puede tocar el `localStorage` de siete navegadores, y el
// navegador no puede tocar la fila de otro (RLS por `user_id`).
const REINICIO_GENERAL = '2026-08-13';
const claveReinicio = (userId) => `portal_dash_reinicio_general_${userId || 'guest'}`;
// El único que conserva su acomodo, por pedido expreso. Va por id y no por
// cargo: «menos a edwin» es una persona, no un permiso — y el otro superusuario
// (la cuenta de sistema) sí entra en el reinicio.
const EXENTO_DEL_REINICIO = new Set(['bbc796d7-7435-495b-9306-a2115f44a18f']); // EDWIN NUÑEZ
const tocaReiniciarGeneral = (userId) => {
  if (!userId || EXENTO_DEL_REINICIO.has(userId)) return false;
  try { return localStorage.getItem(claveReinicio(userId)) !== REINICIO_GENERAL; }
  catch { return false; }   // sin localStorage no hay dónde anotarlo: se reiniciaría en cada carga
};
const sinGeneral = (obj) => (obj && typeof obj === 'object'
  ? Object.fromEntries(Object.entries(obj).filter(([tabId]) => tabId !== 'general'))
  : obj);

const initTabSizes = (userId) => {
  const result = {};
  TABS.forEach(tab => {
    try {
      const saved = localStorage.getItem(`portal_dash_sizes_${userId||'guest'}_${tab.id}`);
      if (saved) { result[tab.id] = JSON.parse(saved); return; }
    } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
    result[tab.id] = {};
  });
  return result;
};

// ─── Main component ────────────────────────────────────────────────────────────
const DashboardView = ({ openModal }) => {
  const { user, hasPermission, getScope, isSU } = useAuth();
  const userBranchStr = String(user?.branchId ?? user?.branch_id ?? '');
  const navigate = useNavigate();

  const employees        = useStaff(s => s.employees);
  const branches         = useStaff(s => s.branches);
  const holidays         = useStaff(s => s.holidays);
  const announcements    = useStaff(s => s.announcements);
  const attendanceLoaded = useStaff(s => s.attendanceLoaded);
  const loadAttendance   = useStaff(s => s.loadAttendanceLastDays);

  // ── Config & order ─────────────────────────────────────────────────────────
  // ── Entrar al tablero es entrar a General (2026-08-13) ─────────────────────
  // La pestaña abierta se recordaba en `portal_dash_tab_*`, así que quien miró
  // Operación una vez volvía a encontrarse ahí semanas después, sin haberlo
  // pedido y sin recordar por qué. General es el resumen —es la única que
  // muestra TODO lo que la persona ve y la única que puede acomodar—, así que
  // es la que corresponde al abrir. Las temáticas se eligen cuando se quiere
  // mirar una cosa puntual, que es una decisión del momento, no una
  // preferencia. La clave vieja queda huérfana a propósito: borrarla obligaría
  // a leerla, y no vale un `try` en el arranque de la vista.
  const [activeTab, setActiveTab] = usePestanaEnUrl(TABS, 'general');
  // `configTab` ya no existe: el panel configura SIEMPRE la pestaña abierta.
  // Tenía su propia barra de pestañas adentro —una segunda, debajo de la de la
  // vista— y cambiarla no cambiaba el tablero de atrás, así que se podía estar
  // en Operación editando RRHH sin verlo. Reportado el 2026-08-07: «¿por qué
  // aparecen todas las pestañas ahí, si estoy en operación?». Dos controles
  // para la misma idea, y el de adentro no movía nada.
  const [tabDir, setTabDir] = useState('right');
  const prevTabIndexRef = useRef(TABS.findIndex(t => t.id === 'general'));
  const activeTabRef = useRef(activeTab);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  const [widgetConfig, setWidgetConfig] = useState(() => {
    try {
      const s = localStorage.getItem(`portal_dashboard_${user?.id||'guest'}`);
      if (s) {
        const stored = JSON.parse(s);
        const storedIds = new Set(stored.map(w => w.id));
        // Merge: add any new widgets not yet in stored config
        return [...stored, ...WIDGET_DEFS.filter(w => !storedIds.has(w.id)).map(w => ({ id: w.id, enabled: true }))];
      }
    } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
    return WIDGET_DEFS.map(w => ({ id: w.id, enabled: true }));
  });
  const [showConfig, setShowConfig] = useState(false);

  // ¿El usuario acomodó ESTA pestaña alguna vez? Es la línea que separa «el
  // tablero se arma solo» de «acá manda lo que esta persona dejó puesto».
  // Mientras no haya acomodo propio conviene recalcular en cada carga, porque
  // el catálogo visible cambia con los permisos; desde el primer arrastre, no
  // se toca más nada.
  //
  // Lo que decide es una marca EXPLÍCITA, no que exista un layout guardado.
  // Mirar el layout era la causa de los huecos: la app escribe
  // `portal_dash_layout_*` sola —al colocar las baldosas de sucursal cuando
  // cargan las ventas, y al mezclar lo que baja de la base—, así que el tablero
  // se daba por acomodado en la PRIMERA carga y este acomodo automático, que es
  // el único que filtra por los widgets que esta persona ve, no volvía a correr
  // nunca. Y como las posiciones guardadas se calcularon sobre el catálogo
  // COMPLETO, cada widget que su cargo no ve dejaba su hueco: medido, el layout
  // guardado tenía 26 posiciones y casi todo el mundo veía 22. El único tablero
  // sin huecos era el del superusuario, que los ve todos.
  const [tabsAcomodadas, setTabsAcomodadas] = useState(() => {
    const s = new Set();
    try {
      TABS.forEach(t => {
        if (localStorage.getItem(claveAcomodada(user?.id, t.id)) === '1') s.add(t.id);
      });
    } catch { /* localStorage no disponible */ }
    return s;
  });
  const marcarAcomodada = useCallback((tabId) => {
    try { localStorage.setItem(claveAcomodada(user?.id, tabId), '1'); } catch { /* localStorage no disponible */ }
    setTabsAcomodadas(prev => (prev.has(tabId) ? prev : new Set(prev).add(tabId)));
  }, [user?.id]);
  // Devolver la pestaña al acomodo automático. Es la mitad que le faltaba a
  // «Restablecer»: sin quitar la marca, la pestaña seguía siendo «acomodada por
  // la persona» y el tablero se volvía a pintar con las posiciones guardadas,
  // que es justo de lo que uno quiere salir al restablecer.
  const desmarcarAcomodada = useCallback((tabId) => {
    try { localStorage.removeItem(claveAcomodada(user?.id, tabId)); } catch { /* localStorage no disponible */ }
    setTabsAcomodadas(prev => {
      if (!prev.has(tabId)) return prev;
      const n = new Set(prev); n.delete(tabId); return n;
    });
  }, [user?.id]);

  // ── Widget layout: per-tab { [tabId]: { [widgetId]: { col, row } } } ────────
  const [widgetLayout, setWidgetLayout] = useState(() => initTabLayouts(user?.id));
  // Per-widget size overrides: per-tab { [tabId]: { [widgetId]: { cols, rows } } }
  const [widgetSizes,  setWidgetSizes]  = useState(() => initTabSizes(user?.id));

  // ── El canon: el acomodo publicado de las pestañas temáticas ───────────────
  //
  // Comercial, RRHH y Operación las acomoda el SU una vez y las ve así todo el
  // mundo; General sigue siendo de cada quien. Acá se guarda `{ [tabId]:
  // { orden, medidas } }`, y **el orden es el dato**: las coordenadas se
  // calculan al pintar, contra los widgets que este cargo puede ver. Ver
  // `ordenDeLaPestana`, que es donde vive el porqué.
  //
  // `null` mientras se carga, para no pintar un tablero con el orden por
  // defecto y reacomodarlo un segundo después.
  const [canon, setCanon] = useState(null);
  useEffect(() => {
    let vivo = true;
    fetchDashboardCanon().then(({ data, error }) => {
      if (!vivo) return;
      // Un fallo de red deja `{}`, no `null`: sin canon el tablero cae al orden
      // declarado en `PESTANAS_TEMATICAS`, que es un tablero correcto. Quedarse
      // en `null` lo dejaría en el esqueleto para siempre.
      if (error) { console.error('[dash canon]', error); setCanon({}); return; }
      setCanon(Object.fromEntries((data || []).map(f => [f.tab_id, { orden: f.orden || [], medidas: f.medidas || {} }])));
    });
    return () => { vivo = false; };
  }, []);

  // ── Previsualizar por cargo (solo SU) ──────────────────────────────────────
  // Publicar un acomodo es publicárselo a los demás, y el SU los ve todos: su
  // propio tablero nunca muestra el hueco que deja un widget que a otro cargo le
  // falta. Con esto se mira la pestaña con los permisos de otro ANTES de
  // publicar. `null` = mi vista.
  const [verComoRol, setVerComoRol] = useState(null);
  const [cargos, setCargos] = useState(null);          // [{ id, name }]
  const [permisosPorCargo, setPermisosPorCargo] = useState(null); // { [roleId]: Set(module_key) }

  // ── Quién puede acomodar QUÉ ───────────────────────────────────────────────
  // General es de cada quien. Las temáticas las acomoda el SU y las demás las
  // reciben publicadas: sin arrastrar, sin redimensionar y sin apagar widgets.
  const puedeAcomodar = (tabId) => tabId === 'general' || isSU;
  // Con el previsualizador puesto, el SU deja de tener el acomodo libre: la
  // pestaña se recalcula igual que para el cargo que está mirando.
  //
  // Reportado con captura el 2026-08-07 — al elegir un cargo quedaban celdas en
  // blanco. El defecto era éste: se seguía usando el acomodo FIJO del SU y
  // simplemente no se pintaban los widgets que el otro no ve, así que cada
  // ausencia dejaba su hueco. Un previsualizador que no reproduce el mismo
  // cálculo no está previsualizando nada.
  const acomodoLibre  = puedeAcomodar(activeTab) && verComoRol == null;

  // Los tres van en `useCallback` porque `activeLayout` los usa para armar el
  // catálogo visible: rearmados en cada render, el memo se recalculaba siempre
  // y el acomodo se rehacía en cada pintada.
  const isWidgetOn = useCallback(id => widgetConfig.find(w=>w.id===id)?.enabled !== false, [widgetConfig]);
  const canSee     = useCallback(p  => {
    if (!p) return true;
    // Con el previsualizador puesto manda el cargo elegido, no el mío.
    if (verComoRol != null) return !!permisosPorCargo?.[verComoRol]?.has(p);
    return hasPermission(p, 'can_view');
  }, [verComoRol, permisosPorCargo, hasPermission]);
  const canManage  = p  => !p || hasPermission(p,'can_edit');
  // ¿Puede ABRIR esa página? (ver `MODULO_DE_RUTA`)
  const puedeAbrir = useCallback((ruta) => canSee(MODULO_DE_RUTA[ruta]), [canSee]);
  // El interruptor de «Personalizar» sólo gobierna General, que es la única
  // pestaña propia. En las temáticas decide el permiso del cargo y nada más:
  // si el interruptor también contara ahí, apagar un widget en General lo
  // borraría de su categoría, donde ya no hay forma de volver a encenderlo.
  const showWidget = useCallback((id,perm) => canSee(perm) && (activeTab === 'general' ? isWidgetOn(id) : true), [canSee, activeTab, isWidgetOn]);

  // ── Mobile detection ────────────────────────────────────────────────────────
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1024);
  // El TELÉFONO es otra cosa que «no es escritorio». Con `isMobile` a secas, una
  // tableta de 900px y un iPhone de 390 compartían la rejilla de 2 columnas: en
  // la tableta cada widget mide 440px y está bien, en el teléfono mide 180 y el
  // título se corta —«Solicitudes Pe…», «Ausencias Act…», «Alertas - Sucu…»—.
  const [esTelefono, setEsTelefono] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640);
  const isMobileRef = useRef(isMobile);
  useEffect(() => { isMobileRef.current = isMobile; }, [isMobile]);
  useEffect(() => {
    const check = () => { setIsMobile(window.innerWidth < 1024); setEsTelefono(window.innerWidth < 640); };
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // En el teléfono sólo se queda a media pantalla lo que ES una baldosa: un
  // número con su rótulo (1×1). Todo lo que tenga lista, gráfico o calendario
  // adentro ocupa el ancho completo. No es una lista a mano —se lee del mismo
  // registro `WIDGET_SIZES` que ya declara la forma de cada widget—, así que un
  // widget nuevo hereda la regla sin que nadie se acuerde.
  const anchoEnTelefono = useCallback((id) => {
    const def = getWidgetSize(id);
    const esBaldosa = def.minCols === 1 && def.minRows === 1;
    return esBaldosa ? 1 : MOBILE_COLS;
  }, []);
  const activeCols = isMobile ? MOBILE_COLS : GRID_COLS;
  const activeColsRef = useRef(activeCols);
  useEffect(() => { activeColsRef.current = activeCols; }, [activeCols]);

  // ── Mobile layout/sizes (separate from desktop, per-tab) ───────────────────
  const [mobileLayout, setMobileLayout] = useState(() => {
    const result = {};
    TABS.forEach(tab => {
      try { const s = localStorage.getItem(`portal_dash_mobile_layout_${user?.id||'guest'}_${tab.id}`); if (s) result[tab.id] = JSON.parse(s); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
      if (!result[tab.id]) result[tab.id] = {};
    });
    return result;
  });
  const [mobileSizes, setMobileSizes] = useState(() => {
    const result = {};
    TABS.forEach(tab => {
      try { const s = localStorage.getItem(`portal_dash_mobile_sizes_${user?.id||'guest'}_${tab.id}`); if (s) result[tab.id] = JSON.parse(s); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
      if (!result[tab.id]) result[tab.id] = {};
    });
    return result;
  });
  const mobileLayoutRef = useRef(mobileLayout[activeTab] || {});
  const mobileSizesRef  = useRef(mobileSizes[activeTab]  || {});
  useEffect(() => { mobileLayoutRef.current = mobileLayout[activeTab] || {}; }, [mobileLayout, activeTab]);
  useEffect(() => { mobileSizesRef.current  = mobileSizes[activeTab]  || {}; }, [mobileSizes,  activeTab]);

  // Active layout: per-tab. Mobile falls back to auto-placed from desktop order.
  //
  // ⚠️ QUÉ SE PINTA SALE DEL CATÁLOGO DE LA PESTAÑA, NO DEL ACOMODO GUARDADO.
  // `buildWidgetList` recorre las claves de este objeto, así que un widget que
  // no esté acá **no existe**. Y el acomodo se guarda —en localStorage y en
  // `user_dashboard_prefs`— la primera vez que alguien mueve o redimensiona
  // algo: desde ese momento el conjunto queda congelado y todo widget agregado
  // después no aparece nunca.
  //
  // Reportado el 2026-08-07 en Operación: «sólo me sale Consulta de inventario
  // y Modificar facturación». Su acomodo guardado, leído de la base:
  //     escritorio: annulment_req, inv_movement, inv_search, minmax_req,
  //                 srs_inv, traslados
  //     móvil:      annulment_req, inv_search, srs_inv
  // y `srs_inv` es un widget RETIRADO. De las tres claves móviles sólo dos
  // existen hoy — exactamente las dos que veía. En escritorio salían las seis,
  // que es por lo que el defecto parecía «del móvil»: no lo era, era que ese
  // acomodo se guardó antes y por separado.
  //
  // Dos reglas, y las dos hacen falta:
  //  1. **El catálogo completa.** Lo que falta se agrega al final. Ya había un
  //     parche para esto, pero puntual: sólo para los `sales_branch_*`, sólo en
  //     General y sólo en escritorio (ver el efecto de `salesBranches`).
  //  2. **El catálogo depura.** Un id que ya no existe se descarta. Eso ya se
  //     hacía al leer el acomodo de escritorio (`initTabLayouts`, por `srs_inv`
  //     justamente) y **no** en el camino móvil, que es donde sobrevivió.
  //
  // ── Las baldosas por sucursal ──────────────────────────────────────────────
  //
  // Suben acá arriba —estaban con el resto del estado de datos, 500 líneas más
  // abajo— porque desde el 2026-08-16 el ACOMODO las necesita: dejaron de vivir
  // sólo en General y ahora también las hospeda Comercial, que se arma con
  // `ordenDeLaPestana` y no con un acomodo guardado. En JS un `const` declarado
  // después no existe antes: leerlo desde el memo de arriba tira por TDZ, no
  // devuelve `undefined`.
  const [salesBranchIds, setSalesBranchIds] = useState(new Set());
  const [salesBranchIdsLoading, setSalesBranchIdsLoading] = useState(true);
  const salesBranches = useMemo(
    () => branches.filter(b => salesBranchIds.has(String(b.id))), [branches, salesBranchIds]);

  // Los ids dinámicos de la pestaña abierta. Salen de `salesBranches` y ya NO
  // del acomodo guardado, que es de donde se leían: el acomodo sólo las tenía
  // porque un efecto las escribía en el de General, así que Comercial nunca
  // podía verlas. Y de paso se limpia solo — una sucursal que deja de vender
  // sale de la lista en vez de quedarse reservando su celda para un widget que
  // `renderWidget` ya devolvía `null`.
  const baldosasDeSucursal = useMemo(
    () => (hospedaBaldosasDeSucursal(activeTab) ? salesBranches.map(b => `sales_branch_${b.id}`) : []),
    [activeTab, salesBranches]);

  // La ÚNICA regla de «¿se ve este widget?», para las dos rutas que arman un
  // tablero: la del acomodo adaptado (pestaña temática) y la del catálogo
  // (General). Estaban escritas dos veces y sólo una sabía de las baldosas por
  // sucursal — la otra las dejaba pasar por `PERMISO_DE[id] === undefined`, o
  // sea SIN permiso, que es lo contrario de lo que se quiere.
  //
  // Una baldosa por sucursal no tiene permiso propio: usa el del widget del que
  // depende, «Ventas por día/hora» (`dash_sales`). Verificado contra los cargos
  // reales el 2026-08-16 — lo tienen con `can_view` Gerente General,
  // Administrador, Jefe/a de Talento Humano y Supervisor/a de Ventas, y nadie
  // más salvo la cuenta de QA. Que es exactamente a quiénes se les debe mostrar.
  const esVisibleEnTablero = useCallback((id) => (id.startsWith('sales_branch_')
    ? showWidget('sales', 'dash_sales')
    : showWidget(id, PERMISO_DE[id])), [showWidget]);

  // ── El acomodo adaptado: la pestaña temática vista por quien no la acomoda ─
  //
  // Nada de esto sale de un acomodo guardado por usuario, y ahí está el punto:
  // se recalcula del canon cada vez, contra los widgets que este cargo ve en
  // este momento. Por eso «se adapta» solo, y por eso la clase de bug del
  // encimado —cinco correcciones entre v2.483.2 y v2.508.1, todas por mezclar
  // una foto vieja con el catálogo nuevo— acá no tiene dónde ocurrir.
  //
  // Devuelve layout Y medidas porque `empacarFilas` decide las dos: para que el
  // renglón quede lleno tiene que ensanchar widgets, y ese ancho es el que
  // después lee `getEffectiveCols`. Si sólo devolviera posiciones, la rejilla
  // diría una cosa y el widget mediría otra.
  const acomodoAdaptado = useMemo(() => {
    if (acomodoLibre) return null;
    const orden   = ordenDeLaPestana(activeTab, canon?.[activeTab]?.orden, esVisibleEnTablero, baldosasDeSucursal);
    const medidas = canon?.[activeTab]?.medidas || EMPTY_OBJ;
    // En el teléfono NO se empaca: el ancho de cada baldosa lo decide
    // `anchoEnTelefono` y `getEffectiveCols` lo impone por encima de las
    // medidas, así que ensanchar acá dejaría la rejilla y el widget diciendo
    // cosas distintas. Con 2 columnas y la regla de baldosa tampoco hay mucho
    // hueco que rellenar.
    if (esTelefono) return { layout: autoPlaceOrder(orden, medidas, MOBILE_COLS, anchoEnTelefono), medidas };
    return empacarFilas(orden, medidas, activeCols);
  }, [acomodoLibre, activeTab, canon, esTelefono, anchoEnTelefono, activeCols, verComoRol, permisosPorCargo, hasPermission, widgetConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lo que esta persona PUEDE ver en la pestaña abierta, en el orden del
  // catálogo. Vive fuera de `activeLayout` porque lo necesitan los dos: el
  // acomodo automático para armarlo y el guardado para depurarlo.
  const catalogoVisible = useMemo(() => [
    ...(TAB_WIDGETS[activeTab] || []).filter(id => id !== 'kpi' && esVisibleEnTablero(id)),
    ...baldosasDeSucursal.filter(esVisibleEnTablero),
  ], [activeTab, esVisibleEnTablero, baldosasDeSucursal]);

  // El tablero que se arma solo, para quien todavía no movió nada.
  //
  // Sale de `catalogoVisible`, o sea de los widgets que esta persona tiene
  // ENCENDIDOS y su cargo le deja ver: el acomodo se recalcula al prender o
  // apagar uno, no se hereda de un catálogo que ya no es el suyo.
  //
  // Devuelve layout Y medidas por el mismo motivo que `acomodoAdaptado`:
  // `empacarFilas` ensancha widgets para dejar el renglón lleno —«que se vea
  // cuadrado y sin espacios en blanco», pedido del usuario— y ese ancho es el
  // que después lee `getEffectiveCols`. Si sólo devolviera posiciones, la
  // rejilla diría una cosa y el widget mediría otra.
  const acomodoAutomatico = useMemo(() => {
    if (!acomodoLibre || isMobile || tabsAcomodadas.has(activeTab)) return null;
    const medidas = widgetSizes[activeTab] || EMPTY_OBJ;
    return empacarFilas(catalogoVisible, medidas, GRID_COLS);
  }, [acomodoLibre, isMobile, tabsAcomodadas, activeTab, widgetSizes, catalogoVisible]);

  // Los `sales_branch_*` entran al catálogo tomándolos del acomodo de
  // escritorio, que es donde su efecto los da de alta.
  const activeLayout = useMemo(() => {
    if (!acomodoLibre) return acomodoAdaptado.layout;

    const tabLayout = widgetLayout[activeTab] || {};
    // Los `sales_branch_*` son ids dinámicos —uno por sucursal— y su alta la
    // maneja el efecto de `salesBranches`, que sólo escribe el acomodo de
    // ESCRITORIO. Así que para el teléfono cuentan como parte del catálogo: sin
    // esto, un usuario con acomodo móvil propio no vería nunca la baldosa de una
    // sucursal nueva. Es la misma forma del defecto que se acaba de arreglar, y
    // era el único caso que quedaba abierto.
    // El catálogo son los widgets que esta persona PUEDE VER, no todos los que
    // existen (`catalogoVisible`). Sin ese filtro, los que su cargo no ve
    // entraban igual al acomodo, se les reservaba su celda y después
    // `renderWidget` devolvía `null`: el hueco quedaba puesto. Por eso a un rol
    // acotado el tablero le salía agujereado y empezando a media pantalla en
    // vez de arriba — reportado el 2026-08-10; era la causa, no el síntoma.
    const catalogo = catalogoVisible;
    const vigente = (id) => catalogo.includes(id);
    const porPosicion = (base) => (a, b) => {
      const pa = base[a], pb = base[b];
      return pa.row !== pb.row ? pa.row - pb.row : pa.col - pb.col;
    };
    // Depura y completa SIN mover lo que ya estaba: los que faltan van al primer
    // hueco REAL del acomodo guardado (ver `colocarEnHuecos`, que es donde vive
    // el porqué de no recalcular el tablero entero para averiguarlo).
    const alDia = (guardado, sizes, cols) => {
      const base = Object.fromEntries(Object.entries(guardado).filter(([id]) => vigente(id)));
      const faltan = catalogo.filter(id => !(id in base));
      if (!faltan.length) return base;
      return { ...base, ...colocarEnHuecos(base, faltan, sizes, cols) };
    };

    // Mientras el usuario no haya movido NADA en esta pestaña, el tablero se
    // arma solo (ver `acomodoAutomatico`): compacto, arriba a la izquierda,
    // sobre el catálogo ya filtrado y con los renglones rellenos. `alDia`
    // respeta las posiciones guardadas —que es lo correcto cuando alguien
    // acomodó— pero las que hay antes de tocar nada las calculó el arranque
    // sobre TODOS los widgets, así que conservan los huecos de los que este
    // cargo no ve. En cuanto arrastra uno, manda lo suyo (`marcarAcomodada`).
    if (!isMobile) {
      if (acomodoAutomatico) return acomodoAutomatico.layout;
      return alDia(tabLayout, widgetSizes[activeTab] || EMPTY_OBJ, GRID_COLS);
    }

    // Sin acomodo móvil propio se hereda el ORDEN del de escritorio, que es el
    // que el usuario acomodó. Por eso se mira el guardado CRUDO: `alDia` sobre
    // uno vacío devuelve el catálogo entero y haría creer que hay acomodo móvil
    // donde no lo hay.
    const hayMovil = Object.keys(mobileLayout[activeTab] || {}).length > 0;
    // En el teléfono el acomodo se RECALCULA, no se usa tal cual: un widget que
    // ahora ocupa las dos columnas y está guardado en la columna 2 se saldría de
    // la rejilla y CSS le fabricaría una tercera columna. Del acomodo guardado
    // sobrevive lo único que sigue siendo cierto, el orden.
    const base = hayMovil
      ? alDia(mobileLayout[activeTab], mobileSizes[activeTab] || EMPTY_OBJ, MOBILE_COLS)
      : alDia(tabLayout, widgetSizes[activeTab] || EMPTY_OBJ, GRID_COLS);
    const order = Object.keys(base).sort(porPosicion(base));
    if (esTelefono) return autoPlaceOrder(order, mobileSizes[activeTab] || {}, MOBILE_COLS, anchoEnTelefono);
    if (hayMovil) return base;
    return autoPlaceOrder(order, mobileSizes[activeTab] || {}, MOBILE_COLS);
  }, [isMobile, esTelefono, anchoEnTelefono, widgetLayout, widgetSizes, mobileLayout, activeTab, mobileSizes, acomodoLibre, acomodoAdaptado, acomodoAutomatico, catalogoVisible]);

  // Las medidas salen del acomodo adaptado —no del canon crudo— cuando la
  // pestaña no es de quien la mira: son las del canon YA ensanchadas por
  // `empacarFilas`. Leer las del usuario acá pisaría el ancho publicado con el
  // que esa persona hubiera dejado guardado antes de que la pestaña dejara de
  // ser personal.
  const activeSizes = !acomodoLibre
    ? acomodoAdaptado.medidas
    // Con acomodo automático mandan SUS medidas: `empacarFilas` ensanchó
    // widgets para dejar el renglón lleno y `getEffectiveCols` tiene que leer
    // ese ancho, no el que el usuario nunca eligió.
    : (acomodoAutomatico ? acomodoAutomatico.medidas
    : (isMobile ? (mobileSizes[activeTab] || EMPTY_OBJ) : (widgetSizes[activeTab] || EMPTY_OBJ)));

  // Active cols clamped for effective size
  const getEffectiveCols = (id) => (esTelefono
    ? anchoEnTelefono(id)
    : Math.min(activeSizes[id]?.cols ?? getWidgetSize(id).minCols, activeCols));
  const getEffectiveRows = (id) => activeSizes[id]?.rows ?? getWidgetSize(id).minRows;

  // ── Bounce animation tracking ──────────────────────────────────────────────
  const [bouncingIds, setBouncingIds] = useState(new Set());

  const updateWidgetSize = useCallback((id, dim, val) => {
    const isM   = isMobileRef.current;
    const cols  = activeColsRef.current;
    const tabId = activeTabRef.current;
    const sizesRef  = isM ? mobileSizesRef  : widgetSizesRef;
    const setSizes  = isM ? setMobileSizes  : setWidgetSizes;
    const setLayout = isM ? setMobileLayout : setWidgetLayout;

    // Cambiar el tamaño ES acomodar, así que a partir de acá manda lo que la
    // persona dejó. Sin esta marca, el tablero se rearmaba solo en la siguiente
    // carga y el ancho elegido se perdía. En el teléfono no se marca: el
    // acomodo móvil es otro (`hayMovil`) y marcar acá daría por acomodado el
    // tablero de escritorio, que esta persona no tocó.
    if (!isM) marcarAcomodada(tabId);

    const newTabSizes = { ...sizesRef.current, [id]: { ...(sizesRef.current[id]||{}), [dim]: val } };
    setSizes(prev => ({ ...prev, [tabId]: newTabSizes }));
    try { localStorage.setItem(`portal_dash_${isM?'mobile_':''}sizes_${user?.id||'guest'}_${tabId}`, JSON.stringify(newTabSizes)); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }

    // El layout MOSTRADO, no el guardado. Con el tablero en automático los dos
    // difieren —el guardado conserva las posiciones del catálogo completo— y
    // resolver contra el guardado volvía a escribir sus huecos en cuanto
    // alguien tocaba un ancho. Es la misma base que usa el arrastre
    // (`activeLayoutRef`); tenerlas distintas era la incoherencia de fondo.
    const currentLayout = activeLayoutRef.current;
    let pos = currentLayout[id];
    if (pos) {
      let layoutForResolve = currentLayout;
      // Fix: if wider cols would overflow grid, shift widget left first
      if (dim === 'cols') {
        const clampedCol = Math.min(pos.col, cols - val + 1);
        if (clampedCol < pos.col) {
          layoutForResolve = { ...currentLayout, [id]: { ...pos, col: clampedCol } };
          pos = layoutForResolve[id];
        }
      }
      const newTabLayout = resolveCollisions(id, pos.col, pos.row, layoutForResolve, newTabSizes, cols);
      const movedIds = Object.keys(newTabLayout).filter(wid =>
        newTabLayout[wid].col !== currentLayout[wid]?.col || newTabLayout[wid].row !== currentLayout[wid]?.row
      );
      setLayout(prev => ({ ...prev, [tabId]: newTabLayout }));
      try { localStorage.setItem(`portal_dash_${isM?'mobile_':''}layout_${user?.id||'guest'}_${tabId}`, JSON.stringify(newTabLayout)); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
      if (movedIds.length) {
        setBouncingIds(new Set(movedIds));
        setTimeout(() => setBouncingIds(new Set()), 700);
      }
    }
  }, [user, marcarAcomodada]);

  // ── Supabase prefs persistence ─────────────────────────────────────────────
  const [prefsReady, setPrefsReady] = useState(false);
  const saveTimerRef = useRef(null);

  // On mount (and when user changes): pull prefs from DB, override local cache.
  // We do NOT setPrefsReady when user is null — we wait for a valid UUID so the
  // save effect always has a real user_id when it first fires.
  useEffect(() => {
    if (!user?.id) return;
    setPrefsReady(false); // reset while loading so save effect won't fire mid-fetch

    // ── El reinicio de General (ver `REINICIO_GENERAL`) ──────────────────────
    // Borra lo local ANTES de pedir la fila y descarta lo que venga de General
    // en ESTA carga. Las dos mitades hacen falta: borrando sólo lo local,
    // `arranged.general` de la base volvería a marcar la pestaña como acomodada
    // un instante después y el reinicio no se vería nunca. De la próxima carga
    // en adelante la fila ya viene limpia —la limpió la migración de datos— y
    // esta rama no se vuelve a ejecutar en este navegador.
    const reinicia = tocaReiniciarGeneral(user.id);
    if (reinicia) {
      desmarcarAcomodada('general');
      setWidgetLayout(prev => ({ ...prev, general: {} }));
      setWidgetSizes(prev  => ({ ...prev, general: {} }));
      setMobileLayout(prev => ({ ...prev, general: {} }));
      setMobileSizes(prev  => ({ ...prev, general: {} }));
      ['layout', 'sizes', 'mobile_layout', 'mobile_sizes'].forEach(clave => {
        try { localStorage.removeItem(`portal_dash_${clave}_${user.id}_general`); } catch { /* localStorage no disponible */ }
      });
      try { localStorage.setItem(claveReinicio(user.id), REINICIO_GENERAL); } catch { /* localStorage no disponible */ }
    }

    fetchUserDashboardPrefs(user.id)
      .then(({ data: fila, error }) => {
        if (error) console.error('[dash prefs load]', error);
        const data = reinicia && fila ? {
          ...fila,
          layout:        sinGeneral(fila.layout),
          sizes:         sinGeneral(fila.sizes),
          mobile_layout: sinGeneral(fila.mobile_layout),
          mobile_sizes:  sinGeneral(fila.mobile_sizes),
          arranged:      sinGeneral(fila.arranged),
        } : fila;
        if (data) {
          if (data.layout && typeof data.layout === 'object') {
            const isNewFormat = TABS.some(t => t.id in data.layout);
            if (isNewFormat) {
              // Merge: keep locally-generated tabs not in DB (new tabs), and inject
              // any new widget IDs missing from existing DB tabs.
              setWidgetLayout(prev => {
                const next = { ...prev }; // preserves new tabs (e.g. 'operacion')
                TABS.forEach(t => {
                  const dbTab = data.layout[t.id];
                  if (!dbTab || typeof dbTab !== 'object') return; // tab not in DB → keep local
                  const tabLayout = { ...dbTab };
                  // Add any widget IDs that are new (not yet in the saved layout)
                  const expected = (TAB_WIDGETS[t.id] || []).filter(id => id !== 'kpi');
                  const missing  = expected.filter(id => !(id in tabLayout));
                  if (missing.length) {
                    // ── EL ESCRITOR que hacía reincidir el encimado ───────────
                    // v2.489.1 corrigió `alDia`, que es la mezcla de PINTADO.
                    // Ésta es la de ESCRITURA y tenía el mismo defecto:
                    // `autoPlaceOrder` COMPACTA el tablero entero, así que el
                    // hueco que devolvía era de un acomodo que no es el guardado.
                    //
                    // Y al persistirse, el arreglo de `alDia` no podía salvarlo:
                    // con la posición ya escrita el id deja de estar «faltante»
                    // y esa rama no se vuelve a mirar. Por eso el usuario lo vio
                    // otra vez al habilitarle un widget a un rol.
                    //
                    // El `{}` de medidas era la otra mitad: colocaba usando los
                    // mínimos del registro e ignorando todo lo que el usuario
                    // hubiera redimensionado, así que compactaba todavía peor.
                    Object.assign(tabLayout, colocarEnHuecos(
                      tabLayout, missing, data.sizes?.[t.id] ?? EMPTY_OBJ, GRID_COLS,
                    ));
                  }
                  next[t.id] = tabLayout;
                  // Guarda el layout pero NO marca la pestaña como acomodada:
                  // esto es la app mezclando lo que bajó de la base, no alguien
                  // moviendo un widget. Marcarlo acá apagaba el acomodo
                  // automático en la primera carga de todo el mundo.
                  try { localStorage.setItem(`portal_dash_layout_${user.id}_${t.id}`, JSON.stringify(tabLayout)); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
                });
                return next;
              });
            }
          }
          if (data.sizes && typeof data.sizes === 'object') {
            const isNewFormat = TABS.some(t => t.id in data.sizes);
            if (isNewFormat) {
              setWidgetSizes(prev => {
                const next = { ...prev };
                TABS.forEach(t => {
                  if (t.id in data.sizes) {
                    next[t.id] = data.sizes[t.id];
                    try { localStorage.setItem(`portal_dash_sizes_${user.id}_${t.id}`, JSON.stringify(data.sizes[t.id])); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
                  }
                });
                return next;
              });
            }
          }
          if (data.widgets && Array.isArray(data.widgets) && data.widgets.length) {
            // Merge: add any new widget defs not present in the stored list
            const storedIds = new Set(data.widgets.map(w => w.id));
            const merged = [...data.widgets, ...WIDGET_DEFS.filter(w => !storedIds.has(w.id)).map(w => ({ id: w.id, enabled: true }))];
            setWidgetConfig(merged);
            try { localStorage.setItem(`portal_dashboard_${user.id}`, JSON.stringify(merged)); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
          }
          if (data.mobile_layout && TABS.some(t => t.id in data.mobile_layout)) {
            setMobileLayout(prev => ({ ...prev, ...data.mobile_layout }));
          }
          if (data.mobile_sizes && TABS.some(t => t.id in data.mobile_sizes)) {
            setMobileSizes(prev => ({ ...prev, ...data.mobile_sizes }));
          }
          // Quién acomodó qué, según la base. Va acá y no en el arranque porque
          // `localStorage` es de ESTE navegador: sin esto, abrir el tablero en
          // otro equipo descartaba el acomodo propio y lo rearmaba solo.
          if (data.arranged && typeof data.arranged === 'object') {
            const marcadas = TABS.filter(t => data.arranged[t.id]).map(t => t.id);
            if (marcadas.length) {
              setTabsAcomodadas(prev => {
                const n = new Set(prev);
                marcadas.forEach(id => n.add(id));
                return n;
              });
              try { marcadas.forEach(id => localStorage.setItem(claveAcomodada(user.id, id), '1')); } catch { /* localStorage no disponible */ }
            }
          }
        }
        setPrefsReady(true); // flip → habilita el effect de guardado (que toma la foto, no escribe)
      });
  }, [user?.id, marcarAcomodada, desmarcarAcomodada]);

  // Debounced save: fires 1.5 s after any prefs change.
  //
  // La primera corrida tras `prefsReady` NO guarda: sólo toma la foto de lo que
  // quedó armado al cargar. Antes sí guardaba —el comentario del flip decía
  // "triggers save effect below"— así que **cada apertura del tablero escribía
  // una fila idéntica**, con un `updated_at` puesto por el cliente que la hacía
  // "cambiar" siempre (§7.5 de AUDITORIA-COMPLETA-2026-07-30). Ese estado
  // inicial se recalcula igual en cada carga a partir de lo guardado más
  // WIDGET_DEFS, así que no persistirlo no pierde nada.
  const prefsBaselineRef = useRef(null);
  useEffect(() => {
    if (!prefsReady || !user?.id) return;
    const payload = { user_id: user.id, layout: widgetLayout, sizes: widgetSizes,
      widgets: widgetConfig, mobile_layout: mobileLayout, mobile_sizes: mobileSizes,
      // Qué pestañas acomodó a mano. Sin esto el acomodo propio no cruzaría de
      // dispositivo: la marca vive en `localStorage`, que es de un navegador.
      arranged: Object.fromEntries([...tabsAcomodadas].map(id => [id, true])) };
    const foto = JSON.stringify(payload);
    if (prefsBaselineRef.current === null) { prefsBaselineRef.current = foto; return; }
    if (prefsBaselineRef.current === foto) return;   // nada cambió de verdad
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      upsertUserDashboardPrefs({ ...payload, updated_at: new Date().toISOString() })
        .then(({ error }) => {
          if (error) { console.error('[dash prefs save]', error); return; }
          prefsBaselineRef.current = foto;
        });
    }, 1500);
    return () => clearTimeout(saveTimerRef.current);
  }, [prefsReady, widgetLayout, widgetSizes, widgetConfig, mobileLayout, mobileSizes, tabsAcomodadas, user?.id]);

  // ── Resize popover ─────────────────────────────────────────────────────────
  const [resizeOpenId, setResizeOpenId] = useState(null);
  useEffect(() => {
    if (!resizeOpenId) return;
    const close = (e) => { if (!e.target.closest('[data-resize-panel]')) setResizeOpenId(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [resizeOpenId]);

  // ── Position-based DnD with snap-to-grid ───────────────────────────────────
  // Stores active drag state. snap = { col, row, valid } at current mouse position.
  const dndRef      = useRef({ active: null, snap: null, started: false, startX: 0, startY: 0 });
  const dndListeners = useRef({ move: null, up: null });
  const gridRef      = useRef(null);

  // ── El escape del scroll de una baldosa (2026-08-20) ───────────────────────
  // Las baldosas cubren el Inicio entero y todas llevan `overscroll-contain`
  // (v2.604.2, para que revisar una lista no mueva el tablero de atrás). El
  // efecto secundario: con la rueda encima de una baldosa la página no se podía
  // mover NUNCA, así que había que buscar un hueco entre baldosas. El detalle
  // —y por qué esto no revierte el arreglo del 14-ago— vive en el módulo.
  useEffect(() => permitirEscapeDelScroll(gridRef.current), [activeLayout, activeTab]);
  const widgetLayoutRef = useRef(widgetLayout[activeTab] || {});
  const widgetSizesRef  = useRef(widgetSizes[activeTab]  || {});
  // Mismo patrón de espejo ref↔state que mobileLayoutRef/mobileSizesRef y
  // activeLayoutRef/activeSizesRef (más abajo) — usado para que
  // updateWidgetSize (useCallback estable) lea el layout más reciente sin
  // stale closures.
  //
  // Llevaban un `eslint-disable react-hooks/immutability` con la nota de que
  // «el compiler lo marca solo en este par, inconsistente con sus pares
  // idénticos». Ya no lo marca —eslint los reporta como directivas inútiles—,
  // así que se van: una supresión que no suprime nada es una pista falsa para
  // el que lea esto después.
  useEffect(() => { widgetLayoutRef.current = widgetLayout[activeTab] || {}; }, [widgetLayout, activeTab]);
  useEffect(() => { widgetSizesRef.current  = widgetSizes[activeTab]  || {}; }, [widgetSizes,  activeTab]);
  // Active refs always point to the right layout/sizes for current breakpoint
  const activeLayoutRef = useRef(activeLayout);
  const activeSizesRef  = useRef(activeSizes);
  useEffect(() => { activeLayoutRef.current = activeLayout; }, [activeLayout]);
  useEffect(() => { activeSizesRef.current  = activeSizes;  }, [activeSizes]);

  const [dndActive, setDndActive] = useState(null);
  const [dndSnap,   setDndSnap]   = useState(null); // { col, row, valid }
  const [dndPos,    setDndPos]    = useState({ x: 0, y: 0 });

  // ── Mobile long-press drag ─────────────────────────────────────────────────
  const longPressTimerRef = useRef(null);
  const longPressOriginRef = useRef({ x: 0, y: 0 });

  useEffect(() => () => {
    if (dndListeners.current.move) window.removeEventListener('pointermove', dndListeners.current.move);
    if (dndListeners.current.up)   window.removeEventListener('pointerup',   dndListeners.current.up);
  }, []);

  const startDrag = useCallback((e, id) => {
    e.preventDefault();
    const ref = dndRef.current;
    Object.assign(ref, { active: id, snap: null, started: false, startX: e.clientX, startY: e.clientY });

    const computeSnap = (mouseX, mouseY) => {
      if (!gridRef.current) return null;
      const gc    = activeColsRef.current;
      const rect  = gridRef.current.getBoundingClientRect();
      const cellW = (rect.width + GAP_PX) / gc;
      // `isMobileRef` y no `isMobile`: esto corre dentro de un handler de
      // puntero registrado una vez, así que la variable capturada se quedaría
      // con el valor del primer render y el arrastre calcularía la fila contra
      // un alto que ya no es el de la retícula.
      const cellH = (isMobileRef.current ? ROW_H_MOVIL : ROW_H) + GAP_PX;
      const relX  = mouseX - rect.left;
      const relY  = mouseY - rect.top;
      const eCols = Math.min(activeSizesRef.current[id]?.cols ?? getWidgetSize(id).minCols, gc);
      const eRows = activeSizesRef.current[id]?.rows ?? getWidgetSize(id).minRows;
      const col   = Math.max(1, Math.min(gc - eCols + 1, Math.floor(relX / cellW) + 1));
      const row   = Math.max(1, Math.floor(relY / cellH) + 1);
      // Collision check — skip self
      const layout = activeLayoutRef.current;
      const sizes  = activeSizesRef.current;
      let valid = true;
      for (const [wid, pos] of Object.entries(layout)) {
        if (wid === id) continue;
        const wc = Math.min(sizes[wid]?.cols ?? getWidgetSize(wid).minCols, gc);
        const wr = sizes[wid]?.rows ?? getWidgetSize(wid).minRows;
        if (col < pos.col + wc && col + eCols > pos.col && row < pos.row + wr && row + eRows > pos.row) {
          valid = false; break;
        }
      }
      return { col, row, valid };
    };

    const onMove = (me) => {
      const dx = me.clientX - ref.startX, dy = me.clientY - ref.startY;
      if (!ref.started) {
        if (Math.sqrt(dx*dx + dy*dy) < 8) return;
        ref.started = true;
        setDndActive(id);
      }
      setDndPos({ x: me.clientX, y: me.clientY });
      const snap = computeSnap(me.clientX, me.clientY);
      ref.snap = snap;
      setDndSnap(snap);
    };

    const onUp = () => {
      const { active, snap, started } = dndRef.current;
      if (started && active && snap) {
        // Always resolve — red zones push displaced widgets out of the way
        const gc = activeColsRef.current;
        const isM = isMobileRef.current;
        const newLayout = resolveCollisions(active, snap.col, snap.row, activeLayoutRef.current, activeSizesRef.current, gc);
        const prev = activeLayoutRef.current;
        const movedIds = Object.keys(newLayout).filter(id =>
          newLayout[id].col !== prev[id]?.col || newLayout[id].row !== prev[id]?.row
        );
        const tabId = activeTabRef.current;
        if (isM) {
          setMobileLayout(prev => ({ ...prev, [tabId]: newLayout }));
          try { localStorage.setItem(`portal_dash_mobile_layout_${user?.id||'guest'}_${tabId}`, JSON.stringify(newLayout)); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
        } else {
          setWidgetLayout(prev => ({ ...prev, [tabId]: newLayout }));
          try { localStorage.setItem(`portal_dash_layout_${user?.id||'guest'}_${tabId}`, JSON.stringify(newLayout)); marcarAcomodada(tabId); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
        }
        // Spring-bounce the widgets that moved
        if (movedIds.length) {
          setBouncingIds(new Set(movedIds));
          setTimeout(() => setBouncingIds(new Set()), 700);
        }
      }
      Object.assign(dndRef.current, { active: null, snap: null, started: false });
      setDndActive(null); setDndSnap(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    dndListeners.current = { move: onMove, up: onUp };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
  }, [user, marcarAcomodada]);

  const handleLongPressStart = useCallback((e, id) => {
    const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const y = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    longPressOriginRef.current = { x, y };
    longPressTimerRef.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(40);
      startDrag({ clientX: x, clientY: y, preventDefault: () => {} }, id);
    }, 450);
  }, [startDrag]);

  const handleLongPressMoveCancel = useCallback((e) => {
    if (!longPressTimerRef.current) return;
    const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const y = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    const { x: ox, y: oy } = longPressOriginRef.current;
    if (Math.sqrt((x-ox)**2 + (y-oy)**2) > 8) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleLongPressEnd = useCallback(() => {
    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }, []);

  // ── Local data state ───────────────────────────────────────────────────────
  const [pendingReqs,    setPendingReqs]    = useState([]);
  const [reqLoading,     setReqLoading]     = useState(true);
  const [calMonth,       setCalMonth]       = useState(new Date());
  const [bdMonth,        setBdMonth]        = useState(new Date());
  const [calTooltip,     setCalTooltip]     = useState(null);
  const [salesBarTip,    setSalesBarTip]    = useState(null); // {x,y,label,amount,txCount}
  const [trendOffset,    setTrendOffset]    = useState(0);
  const [salesBranch,    setSalesBranch]    = useState('');
  const [salesStats,     setSalesStats]     = useState({ days: [], generalHours: [], specificHours: {} });
  const [salesLoading,   setSalesLoading]   = useState(false);
  const [salesView,      setSalesView]      = useState('DAYS');
  const [shiftBranch,    setShiftBranch]    = useState('');
  // Arranca en la sala propia, y si esa sala no factura —Administración,
  // Bodega— en la primera que sí. Antes arrancaba en la propia a secas, así que
  // a las 7 personas de Administración la baldosa les abría contra una sucursal
  // que no está ni en la lista: el desplegable en blanco y cero facturas.
  const [annulmentBranch, setAnnulmentBranch] = useState(
      () => salaQueFacturaPorDefecto(user?.branchId ?? user?.branch_id));
  const [minmaxErp, setMinmaxErp] = useState(() => String(MM_BRANCH_TO_ERP[user?.branchId ?? user?.branch_id] ?? 5));
  const [movimientoErp, setMovimientoErp] = useState(() => String(MM_BRANCH_TO_ERP[user?.branchId ?? user?.branch_id] ?? 5));
  // Facturas de mi Sala trabaja con `branch_id` del portal (no con el número de
  // sucursal del sistema de compras): la baldosa se lo pasa tal cual al RPC, y
  // con alcance BRANCH la base lo compara contra la sala del propio empleado.
  //
  // Arranca en la sala propia SOLO si esa sala carga compras. Administración no
  // es una de las siete, y quien trabaja ahí abriría el widget contra una sala
  // que no está ni en el desplegable: el selector en blanco y cero facturas. Es
  // exactamente el defecto que ya se había corregido en la baldosa de
  // Facturación (ver `salaQueFacturaPorDefecto` arriba), en otro widget.
  const [facturasBranch, setFacturasBranch] = useState(() => {
      const propia = Number(user?.branchId ?? user?.branch_id);
      return String(MM_BRANCH_TO_ERP[propia] ? propia : SALA_COMPRAS_POR_DEFECTO);
  });
  // Arranca en la sala propia; si el usuario no está en una sala de venta
  // (gerencia, bodega), en la primera de la lista.
  const [metaBranch, setMetaBranch] = useState(() => {
    const propia = Number(user?.branchId ?? user?.branch_id);
    return String(META_SALA_IDS.includes(propia) ? propia : META_SALA_IDS[0]);
  });
  // Vacío = todas las salas que la sesión alcance a ver. A diferencia de
  // `metaBranch`, acá NO se preselecciona la sala propia: quien tiene alcance
  // ALL suele estar en Administración, y arrancar filtrado por una sala sin
  // caja dejaba la baldosa en blanco.
  const [cortesBranch,   setCortesBranch]   = useState('');
  const [bolsasBranch,   setBolsasBranch]   = useState('');
  const [absences,       setAbsences]       = useState([]);
  const [absLoading,     setAbsLoading]     = useState(true);
  const [todaySales,     setTodaySales]     = useState({});
  const [todayLoading,   setTodayLoading]   = useState(false);

  // ── Comercial tab data ─────────────────────────────────────────────────────
  const [cotizStats,     setCotizStats]     = useState({ activas: 0, total: 0, recent: [] });
  const [factStats,      setFactStats]      = useState({ count: 0, total: 0, ccf: 0, fcf: 0 });
  const [cotizLoading,   setCotizLoading]   = useState(true);
  const [factLoading,    setFactLoading]    = useState(true);
  const [topProductos,   setTopProductos]   = useState([]);
  const [topProdLoading, setTopProdLoading] = useState(false);

  // ── Effects ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const since = new Date(); since.setDate(since.getDate()-7);
    fetchSalesBranchIdsSince(localDateStr(since))
      .then(({ data }) => {
        setSalesBranchIds(new Set((data||[]).map(r => String(r.branch_id))));
        setSalesBranchIdsLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!salesBranches.length) return;
    const ids = salesBranches.map(b => `sales_branch_${b.id}`);
    setWidgetLayout(prev => {
      const tabLayout = prev['general'] || {};
      const missing = ids.filter(id => !(id in tabLayout));
      if (!missing.length) return prev;
      // Mismo caso que el escritor de arriba: `autoPlaceOrder` compacta y acá
      // el resultado se persiste. Y las medidas tienen que ser las de
      // «general», que es el tablero donde se está colocando —
      // `widgetSizesRef` guarda las de la pestaña ACTIVA, así que colocaba las
      // baldosas de sucursal con las medidas de otra pestaña.
      const nextTabLayout = {
        ...tabLayout,
        ...colocarEnHuecos(tabLayout, missing, widgetSizes.general ?? EMPTY_OBJ, GRID_COLS),
      };
      // Tampoco marca acomodada: colocar las baldosas de sucursal que acaban de
      // aparecer es trabajo de la app. Ésta era la marca que se disparaba en la
      // primera carga de CUALQUIERA —basta con que la sucursal tenga ventas— y
      // dejaba el tablero congelado con los huecos del catálogo completo.
      try { localStorage.setItem(`portal_dash_layout_${user?.id||'guest'}_general`, JSON.stringify(nextTabLayout)); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
      return { ...prev, general: nextTabLayout };
    });
  }, [salesBranches, user, widgetSizes]);

  useEffect(() => { if (!attendanceLoaded) loadAttendance(14); }, [attendanceLoaded, loadAttendance]);

  useEffect(() => {
    fetchPendingApprovalRequests()
      .then(({ data }) => { setPendingReqs(data||[]); setReqLoading(false); });
  }, []);

  useEffect(() => {
    const today = localDateStr();
    // Devuelve el ARRAY (o `null` si falló la primera página), no `{ data }`:
    // desestructurar `{ data }` de un array da `undefined` y el widget habría
    // quedado en cero sin decir nada. Mismo contrato que
    // `fetchTodayInvoicesSummary` más abajo.
    fetchActiveLeaveRequests()
      .then((rows) => {
        const active = (rows||[]).filter(r => {
          const meta = parseMeta(r.metadata);
          const start = meta.startDate || (meta.permissionDates||[])[0];
          const end   = meta.endDate   || (meta.permissionDates||[])[(meta.permissionDates||[]).length-1];
          return start && start <= today && (!end || end >= today);
        });
        setAbsences(active); setAbsLoading(false);
      })
      .catch((e) => { console.error('DashboardView: ausencias vigentes falló:', e?.message ?? e); setAbsLoading(false); });
  }, []);

  useEffect(() => {
    if (salesBranch || !salesBranches.length) return;
    if (getScope('dash_sales') !== 'ALL' && userBranchStr) {
      setSalesBranch(userBranchStr);
    } else {
      const pop = salesBranches.find(b => /popular/i.test(b.name)) || salesBranches[0];
      setSalesBranch(String(pop.id));
    }
  }, [salesBranches, salesBranch, getScope, userBranchStr]);

  useEffect(() => {
    if (!branches.length) return;
    setTodayLoading(true);
    fetchTodayHourlySales(localDateStr())
      .then(({ data }) => {
        const map = {};
        (data||[]).forEach(r => {
          const bid = String(r.branch_id);
          if (!map[bid]) map[bid] = { hours:{}, totalSales:0 };
          map[bid].hours[Number(r.sale_hour)] = (map[bid].hours[Number(r.sale_hour)]||0) + Number(r.transaction_count||0);
          if (!map[bid].hourSales) map[bid].hourSales = {};
          map[bid].hourSales[Number(r.sale_hour)] = (map[bid].hourSales[Number(r.sale_hour)]||0) + Number(r.total_sales||0);
          map[bid].totalSales += Number(r.total_sales||0);
        });
        setTodaySales(map); setTodayLoading(false);
      });
  // `branches.length` y no `branches` (2026-08-20). El efecto sólo mira si YA
  // hay sucursales —no lee ni una de ellas: el mapa se arma con los
  // `branch_id` que devuelve la consulta—, pero dependía del array, y el store
  // lo reescribe dos veces al arrancar. Resultado medido en producción: DOS
  // peticiones idénticas (`sale_date=eq.<hoy>`) en cada carga del Inicio. Con
  // la longitud se dispara una sola vez y el dato es el mismo.
  }, [branches.length]);

  useEffect(() => {
    if (!salesBranch) { setSalesStats({ days:[], generalHours:[], specificHours:{} }); return; }
    setSalesLoading(true); setSalesView('DAYS');
    const since = new Date(); since.setDate(since.getDate()-90);
    // Staffing-based color thresholds (10 min/tx → 6 tx/hr per employee)
    // scale=1 for hourly views, scale=numOpenHours for daily totals
    const applyColors = (arr, scale = 1) => {
      const max = Math.max(...arr.map(o => o.avg), 1);
      return arr.map(item => {
        const txPerHr = item.avg / scale;
        let color = 'var(--txvol-muerta)';                     // ≤4  muerta   — 1 persona ociosa
        if      (txPerHr > 18) color = 'var(--txvol-critica)';  // >18 crítica  — 3+ personas
        else if (txPerHr > 12) color = 'var(--txvol-pico)';  // >12 pico     — 2-3 personas
        else if (txPerHr >  4) color = 'var(--txvol-normal)';  // >4  normal   — 1-2 personas
        const hi = item.avg / max;
        return { ...item, color, height: hi > 0 ? `${Math.max(hi * 100, 15)}%` : '0%' };
      });
    };
    fetchBranchHourlySalesRange(salesBranch, localDateStr(since))
      .then(({ data }) => {
        let openH=7, closeH=18;
        const cb = branches.find(b=>String(b.id)===String(salesBranch));
        if (cb) {
          let sch = cb.weekly_hours||cb.settings?.schedule;
          if (typeof sch==='string') { try { sch=JSON.parse(sch); } catch { sch=null; } }
          if (sch&&typeof sch==='object') {
            let minO=1440,maxC=0;
            Object.values(sch).forEach(d => { if (d&&d.isOpen!==false) { const o=d.start?d.start.split(':').reduce((a,b,i)=>a+(i===0?+b*60:+b),0):0; let c=d.end?d.end.split(':').reduce((a,b,i)=>a+(i===0?+b*60:+b),0):0; if(c<o)c+=1440; if(o&&o<minO)minO=o; if(c&&c>maxC)maxC=c; } });
            if (minO<1440) openH=Math.floor(minO/60); if (maxC>0) closeH=Math.ceil(maxC/60)-1;
          }
        }
        if (closeH<=openH) closeH=openH+11;
        const dM={1:0,2:0,3:0,4:0,5:0,6:0,0:0}, hM={}, shM={1:{},2:{},3:{},4:{},5:{},6:{},0:{}};
        const udD={1:new Set(),2:new Set(),3:new Set(),4:new Set(),5:new Set(),6:new Set(),0:new Set()}, ud=new Set();
        (data||[]).filter(r=>{const h=Number(r.sale_hour);return h>=openH&&h<=closeH;}).forEach(r=>{
          const h=Number(r.sale_hour),d=new Date(r.sale_date+'T00:00:00').getDay(),c=Number(r.transaction_count||0);
          dM[d]+=c; hM[h]=(hM[h]||0)+c; shM[d][h]=(shM[d][h]||0)+c; ud.add(r.sale_date); udD[d].add(r.sale_date);
        });
        const tot=ud.size||1;
        // Days: color/height = P75 of hourly avgs for that DOW (robust to single-hour outliers)
        // dailyAvg = simple daily average shown in tooltip
        const fD=[1,2,3,4,5,6,0].map(d=>{
          const dc=udD[d].size||1;
          const hrs=[]; for(let h=openH;h<=closeH;h++) hrs.push(Math.round((shM[d][h]||0)/dc));
          hrs.sort((a,b)=>a-b);
          const p75=hrs[Math.floor(hrs.length*0.75)]||0;
          const dailyAvg=Math.round((dM[d]||0)/dc/(closeH-openH+1));
          return {day:d,avg:p75,dailyAvg,label:DAY_NAMES[d]};
        });
        const fH=[]; for(let h=openH;h<=closeH;h++) fH.push({hour:h,avg:Math.round((hM[h]||0)/tot),label:formatHourAMPM(h)});
        const fS={}; [1,2,3,4,5,6,0].forEach(d=>{fS[d]=[]; const dc=udD[d].size||1; for(let h=openH;h<=closeH;h++) fS[d].push({hour:h,avg:Math.round((shM[d][h]||0)/dc),label:formatHourAMPM(h)});});
        setSalesStats({ days:applyColors(fD), generalHours:applyColors(fH), specificHours:Object.fromEntries([1,2,3,4,5,6,0].map(d=>[d,applyColors(fS[d])])) });
        setSalesLoading(false);
      });
  }, [salesBranch, branches]);

  // ── Comercial data effects ─────────────────────────────────────────────────
  useEffect(() => {
    const since = new Date(); since.setDate(since.getDate() - 30);
    fetchRecentCotizaciones(localDateStr(since))
      .then(({ data }) => {
        const rows    = data || [];
        const activas = rows.filter(c => c.status === 'ACTIVA');
        setCotizStats({
          activas: activas.length,
          total:   activas.reduce((s, c) => s + (parseFloat(c.total) || 0), 0),
          recent:  activas.slice(0, 6),
        });
        setCotizLoading(false);
      });
  }, []);

  useEffect(() => {
    // `fetchAllRows` devuelve el array directo (o null si fallo la primera
    // pagina) — no `{ data }`. Antes se desestructuraba `{ data }` de un
    // array, que da `undefined`, y el widget habria quedado en cero sin decir
    // nada. El `.catch` tampoco estaba.
    fetchTodayInvoicesSummary(localDateStr())
      .then((rows) => {
        const filas = rows || [];
        setFactStats({
          count: filas.length,
          total: filas.reduce((s, r) => s + (parseFloat(r.total) || 0), 0),
          ccf:   filas.filter(r => r.tipo_documento === 'CCF').length,
          fcf:   filas.filter(r => r.tipo_documento !== 'CCF').length,
        });
        setFactLoading(false);
      })
      .catch((e) => { console.error('[dashboard] facturación de hoy', e); setFactLoading(false); });
  }, []);

  // El widget pinta diez filas con dos campos, y hasta hoy se los pedía a
  // `get_product_sales_agg` —las 14 columnas de la pantalla de Ventas— con el
  // recorte AFUERA, vía `.limit(10)` de PostgREST. O sea que Postgres armaba
  // el mes entero de las 7 salas, con presentaciones, costos y última venta
  // por sucursal, para tirar todo menos diez filas: 11.4 s de promedio, 74 s
  // la peor, el 33% del tiempo total de la base. `get_top_productos_mes` hace
  // la misma cuenta con el LIMIT adentro, en 55 ms.
  //
  // Y el pedido salía al montar SIN mirar si este cargo ve el widget, así que
  // el que lo tenía apagado pagaba la consulta igual. Ahora cuelga de
  // `showWidget`, que además depende de la pestaña activa: sale recién cuando
  // el widget se va a pintar. El `ref` —y no `topProductos.length`— es lo que
  // garantiza una sola vuelta: un mes sin ventas devuelve `[]`, y con la
  // guarda por longitud volvería a pedirlo en cada cambio de pestaña.
  const topProdPedido = useRef(false);
  useEffect(() => {
    if (topProdPedido.current) return;
    if (!showWidget('top_productos', 'dash_top_productos')) return;
    topProdPedido.current = true;
    const now  = new Date();
    const fini = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const ffin = localDateStr();
    setTopProdLoading(true);
    supabase.rpc('get_top_productos_mes', { p_fini: fini, p_ffin: ffin, p_limite: 10 })
      .then(({ data, error }) => {
        if (error) console.error('[top_productos]', error);
        setTopProductos(data || []);
        setTopProdLoading(false);
      });
  }, [showWidget]);

  // Los helpers de visibilidad (`isWidgetOn`, `canSee`, `canManage`,
  // `showWidget`) viven arriba, junto al canon: `activeLayout` los necesita
  // para armar el orden de una pestaña temática y se calcula antes que esto.

  // ── Las pestañas que este cargo ve ────────────────────────────────────────
  // «Si un rol no tiene widgets activados de una categoría, la pestaña no debe
  // salir» (reportado el 2026-08-07). La regla —incluida la de General, que
  // muestra todo y por eso necesita una propia— vive en `dashboardTabs.js`.
  const TABS_VISIBLES = useMemo(() => {
    // Decide el PERMISO y nada más — ni el interruptor de «Personalizar», que
    // desde el canon sólo gobierna General, ni el previsualizador por cargo.
    // Esto último no es un detalle: si el previsualizador contara acá, mirar la
    // pestaña con los ojos de un cargo que no la tiene la haría desaparecer, y
    // el efecto de abajo sacaría al SU de la pestaña que está editando.
    const ids = pestanasVisibles(
      WIDGET_DEFS.map(w => w.id),
      id => !PERMISO_DE[id] || hasPermission(PERMISO_DE[id], 'can_view'),
    );
    // Nunca se devuelve vacío: un cargo sin ningún widget igual entra a Inicio
    // —el permiso `overview` es el que decide eso— y quedarse sin barra de
    // pestañas se ve como una pantalla rota, no como una pantalla vacía.
    return TABS.filter(t => ids.includes(t.id)) || [];
  }, [widgetConfig, hasPermission]); // eslint-disable-line react-hooks/exhaustive-deps

  // Si la pestaña recordada dejó de estar disponible —le quitaron el permiso,
  // o apagó su último widget— se cae a la primera visible en vez de mostrar una
  // pestaña que ya no existe.
  useEffect(() => {
    if (!TABS_VISIBLES.length) return;
    if (TABS_VISIBLES.some(t => t.id === activeTab)) return;
    setActiveTab(TABS_VISIBLES[0].id, { reemplazar: true });
  }, [TABS_VISIBLES, activeTab, setActiveTab]);

  const toggleWidget = id => {
    const next = widgetConfig.map(w=>w.id===id?{...w,enabled:!w.enabled}:w);
    setWidgetConfig(next);
    try { localStorage.setItem(`portal_dashboard_${user?.id||'guest'}`, JSON.stringify(next)); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
  };

  // ── Computed ───────────────────────────────────────────────────────────────
  const today           = localDateStr();
  const activeEmployees = useMemo(()=>employees.filter(e=>e.status!=='INACTIVO'&&e.status!=='LIQUIDADO'),[employees]);
  const presentToday    = useMemo(()=>{ const ids=new Set(); employees.forEach(e=>(e.attendance||[]).forEach(a=>{if((a.date||a.timestamp?.split('T')[0])===today) ids.add(e.id);})); return ids.size; },[employees,today]);
  const branchAlerts    = useMemo(()=>branches.filter(b=>getBranchIssue(b)!==null),[branches]);

  const trendScopeIsBranch = getScope('dash_trend') !== 'ALL';
  const trendEmployees = trendScopeIsBranch && userBranchStr
    ? employees.filter(e => String(e.branchId ?? e.branch_id ?? '') === userBranchStr)
    : employees;

  const trendData = useMemo(()=>{
    const base=new Date(); base.setDate(base.getDate()+trendOffset*7);
    return Array.from({length:7},(_,i)=>{ const d=new Date(base); d.setDate(d.getDate()-(6-i)); const ds=localDateStr(d); const ids=new Set(); trendEmployees.forEach(e=>(e.attendance||[]).forEach(a=>{if((a.date||a.timestamp?.split('T')[0])===ds) ids.add(e.id);})); return {day:d.toLocaleDateString('es-SV',{weekday:'short'}).replace('.',''),date:ds,total:ids.size}; });
  },[trendEmployees,trendOffset]);

  // ── Una semana sin marcaciones NO es una semana de cero asistencia ────────
  //
  // `trendData` siempre devuelve siete días; cuando no hay marcaciones, los
  // siete traen `total: 0` y el área los dibuja: una línea plana pegada al eje,
  // con los días rotulados debajo. Eso no se lee como «sin datos» — se lee como
  // «no vino nadie en toda la semana», y es lo primero que ve quien abre el
  // portal a primera hora, en el widget más grande de la pantalla.
  //
  // Con 49 empleados activos, una semana entera en cero es un dato que no
  // existe, no un dato malo. Se distingue y se dice.
  const tendenciaVacia = useMemo(
    () => trendData.every(d => d.total === 0),
    [trendData],
  );

  const trendRangeLabel = useMemo(()=>{
    const base=new Date(); base.setDate(base.getDate()+trendOffset*7);
    const start=new Date(base); start.setDate(start.getDate()-6);
    const fmt=d=>d.toLocaleDateString('es-SV',{day:'numeric',month:'short'});
    return `${fmt(start)} – ${fmt(base)}`;
  },[trendOffset]);

  const activeBranches     = useMemo(()=>branches.filter(b=>b.id),[branches]);
  const currentShiftBranch = getScope('dash_shifts') !== 'ALL' && userBranchStr
    ? userBranchStr
    : (shiftBranch || String(activeBranches[0]?.id||''));
  const shiftStatusData    = useMemo(()=>activeEmployees.filter(e=>String(e.branchId)===currentShiftBranch).map(e=>({...e,currentStatus:getTodayAttendanceStatus(e)})),[activeEmployees,currentShiftBranch]);
  const shiftGroups        = useMemo(()=>{ const g={}; shiftStatusData.forEach(e=>{const s=e.currentStatus?.status||'ABSENT'; if(!g[s])g[s]=[]; g[s].push(e);}); return g; },[shiftStatusData]);

  const calendarEvents = useMemo(()=>{
    const map={},y=calMonth.getFullYear();
    holidays.forEach(h=>{if(!h.holiday_date)return; const k=h.is_recurring?`${y}-${h.holiday_date.slice(5)}`:h.holiday_date.slice(0,10); if(!map[k])map[k]={holidays:[]}; map[k].holidays.push(h.name);});
    return map;
  },[holidays,calMonth]);

  const calendarDays = useMemo(()=>{
    const y=calMonth.getFullYear(),m=calMonth.getMonth();
    const first=new Date(y,m,1).getDay(), dim=new Date(y,m+1,0).getDate();
    const cells=[]; for(let i=0;i<first;i++) cells.push(null); for(let d=1;d<=dim;d++) cells.push(d);
    return {cells,year:y,month:m};
  },[calMonth]);

  const recentAnnouncements = useMemo(()=>announcements.filter(a=>!a.isArchived&&(!a.scheduledFor||new Date(a.scheduledFor)<=new Date())).slice(0,5),[announcements]);

  const birthdaysOfMonth = useMemo(()=>{
    const y=bdMonth.getFullYear(), m=bdMonth.getMonth(), todayStr=localDateStr();
    const today=new Date(todayStr+'T12:00:00');
    const tomorrow=new Date(today); tomorrow.setDate(today.getDate()+1);
    const tomorrowStr=`${tomorrow.getFullYear()}-${String(tomorrow.getMonth()+1).padStart(2,'0')}-${String(tomorrow.getDate()).padStart(2,'0')}`;
    return activeEmployees
      .filter(e=>{if(!e.birthDate)return false; const bd=new Date(e.birthDate+'T12:00:00'); return bd.getMonth()===m;})
      .map(e=>{
        const bd=new Date(e.birthDate+'T12:00:00');
        const age=y-bd.getFullYear();
        const ds=`${y}-${String(m+1).padStart(2,'0')}-${String(bd.getDate()).padStart(2,'0')}`;
        const branch=branches.find(b=>String(b.id)===String(e.branchId||e.branch_id));
        const isToday=ds===todayStr, isTomorrow=ds===tomorrowStr, isPast=new Date(ds+'T12:00:00')<today&&!isToday;
        return {...e, age, day:bd.getDate(), dateStr:ds, isToday, isTomorrow, isPast, branchName:branch?.name||'Sin sucursal'};
      })
      .sort((a,b)=>a.day-b.day);
  },[activeEmployees,bdMonth,branches]);
  const getEmpName = id => employees.find(e=>String(e.id)===String(id))?.name||'Empleado';

  const switchTab = (tabId) => {
    const nextIdx = TABS.findIndex(t => t.id === tabId);
    setTabDir(nextIdx > prevTabIndexRef.current ? 'right' : 'left');
    prevTabIndexRef.current = nextIdx;
    setActiveTab(tabId);
  };

  // Restablece UNA pestaña, la que se está configurando — antes barría las
  // cuatro. Con el canon, «todo» dejó de ser una sola cosa: en las temáticas lo
  // personal es apenas el borrador del SU, y a los demás no les pertenece nada
  // que restablecer. Un botón que dice «todo» y sólo puede tocar una parte
  // miente sobre lo que hace.
  //
  // Restablecer = volver EXACTAMENTE al tablero que ve quien nunca movió nada
  // (pedido del usuario, 2026-08-13). Por eso lo primero que borra es la marca
  // de «acomodada»: hasta el 2026-08-13 no lo hacía, así que el botón dejaba el
  // acomodo guardado —recalculado sobre el catálogo COMPLETO, con el hueco de
  // cada widget que este cargo no ve— y el tablero salía agujereado. El botón
  // decía restablecer y devolvía otra cosa.
  //
  // El acomodo que se guarda sale del catálogo VISIBLE y empacado, no del
  // catálogo entero: es el mismo que va a pintar `acomodoAutomatico`, y así el
  // teléfono —que hereda el ORDEN del acomodo de escritorio— también arranca
  // limpio. `catalogoVisible` es el de la pestaña abierta, que es la única que
  // este botón puede restablecer (el panel configura siempre la abierta).
  const resetTab = (tabId) => {
    desmarcarAcomodada(tabId);
    const { layout } = empacarFilas(catalogoVisible, EMPTY_OBJ, GRID_COLS);
    setWidgetLayout(prev => ({ ...prev, [tabId]: layout }));
    setWidgetSizes(prev  => ({ ...prev, [tabId]: {} }));
    setMobileLayout(prev => ({ ...prev, [tabId]: {} }));
    setMobileSizes(prev  => ({ ...prev, [tabId]: {} }));
    ['layout', 'sizes', 'mobile_layout', 'mobile_sizes'].forEach(clave => {
      try { localStorage.removeItem(`portal_dash_${clave}_${user?.id||'guest'}_${tabId}`); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
    });
  };

  // ── Acomodar: el tablero entero, en chico, en un modal ─────────────────────
  //
  // Reportado: «el movimiento de widget se siente torpe, al pasar de un lado a
  // otro, desordena todo lo que había ordenado». Ver `AcomodarModal` para el
  // diagnóstico completo — acá sólo vive el cableado.
  //
  // NO reemplaza al arrastre sobre el tablero: para correr una tarjeta un lugar,
  // arrastrarla donde está sigue siendo lo más directo. Reemplaza a la sesión
  // larga de acomodo, que es donde el tablero que scrollea se vuelve el problema.
  const [acomodarAbierto, setAcomodarAbierto] = useState(false);
  // Dónde se personaliza: el editor en chico, o el panel de siempre.
  const editorEnModal = activeTab === 'general' && acomodoLibre && !esTelefono;

  // El catálogo de ESTA pestaña con su estado, encendidos y apagados juntos:
  // el modal necesita los dos —lo que está puesto y lo que se puede agregar— y
  // `catalogoVisible` sólo trae los primeros.
  //
  // ⚠️ Y las baldosas de sucursal (`sales_branch_*`) NO están en `WIDGET_DEFS`:
  // son ids dinámicos, uno por sucursal con ventas, que un efecto coloca en el
  // acomodo. Armar esta lista sólo desde el catálogo estático las dejaba fuera
  // del editor —reportado por el usuario, «porque los de ventas por sucursal no
  // salen»— y eso no era sólo que no se vieran: al no estar en la lista,
  // `AcomodarModal` las filtraba también al guardar, así que «Listo» devolvía
  // un acomodo sin ellas y el efecto de alta las volvía a colocar donde
  // encontraba hueco. Medido: las 6 estaban en las filas 1 y 2 y terminaban en
  // las 13, 14 y 19. O sea que acomodar el tablero **desacomodaba** justo las
  // baldosas que no se podían acomodar.
  //
  // Es la misma familia que `catalogoVisible`, que ya las pesca del acomodo por
  // ese motivo — y por eso se leen de ahí y no de `salesBranches`: la fuente de
  // verdad de qué baldosas hay puestas en ESTA pestaña es el acomodo.
  const catalogoDelModal = useMemo(() => {
    const estaticos = WIDGET_DEFS
      .filter(w => w.id !== 'kpi' && (TAB_WIDGETS[activeTab] || []).includes(w.id) && canSee(w.permission))
      .map(w => ({ id: w.id, label: w.label, icon: w.icon,
                   encendido: isWidgetOn(w.id), permitido: true }));
    // `fijo`: se mueven y se redimensionan, pero no se quitan de a una. Su
    // encendido es el del widget «Ventas por día/hora» (`showWidget('sales',
    // 'dash_sales')` en `catalogoVisible`), no uno propio — ofrecer un «Quitar»
    // que no apaga nada sería un control que no controla.
    const porSucursal = baldosasDeSucursal.filter(esVisibleEnTablero).map(id => {
      const sucursal = salesBranches.find(b => String(b.id) === id.replace('sales_branch_', ''));
      return { id, icon: BarChart2, encendido: true, permitido: true, fijo: true,
               label: sucursal ? `Hoy · ${sucursal.name}` : getWidgetSize(id).label };
    });
    return [...estaticos, ...porSucursal];
  }, [activeTab, canSee, isWidgetOn, baldosasDeSucursal, esVisibleEnTablero, salesBranches]);

  const aplicarAcomodo = useCallback(({ acomodo, medidas, apagados }) => {
    const tabId = activeTabRef.current;
    const isM   = isMobileRef.current;
    const fuera = new Set(apagados);
    const dentro = new Set(Object.keys(acomodo));

    // El registro de encendidos es UNO para todo el tablero, no por pestaña:
    // sólo se tocan los ids que este modal manejó, o apagar algo en General se
    // llevaría puesto lo que la persona eligió en otra pestaña.
    const config = widgetConfig.map(w =>
      fuera.has(w.id)  ? { ...w, enabled: false }
      : dentro.has(w.id) ? { ...w, enabled: true }
      : w);
    setWidgetConfig(config);
    try { localStorage.setItem(`portal_dashboard_${user?.id||'guest'}`, JSON.stringify(config)); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }

    const prefijo = isM ? 'mobile_' : '';
    (isM ? setMobileLayout : setWidgetLayout)(prev => ({ ...prev, [tabId]: acomodo }));
    (isM ? setMobileSizes  : setWidgetSizes )(prev => ({ ...prev, [tabId]: medidas }));
    try {
      localStorage.setItem(`portal_dash_${prefijo}layout_${user?.id||'guest'}_${tabId}`, JSON.stringify(acomodo));
      localStorage.setItem(`portal_dash_${prefijo}sizes_${user?.id||'guest'}_${tabId}`,  JSON.stringify(medidas));
    } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
    // Igual que al arrastrar: a partir de acá manda lo que la persona dejó, o
    // el tablero se rearma solo en la siguiente carga. En el teléfono no se
    // marca — el acomodo móvil es otro y esta persona no tocó el de escritorio.
    if (!isM) marcarAcomodada(tabId);
  }, [widgetConfig, user, marcarAcomodada]);

  // ── Publicar el acomodo de una pestaña temática (solo SU) ──────────────────
  //
  // Sale del acomodo de ESCRITORIO, nunca de `activeLayout`: si el SU estuviera
  // publicando desde el teléfono, `activeLayout` es la rejilla de 2 columnas y
  // el canon quedaría con el orden de esa vista, no con el que compuso.
  //
  // No se publica en vivo mientras se arrastra, y es a propósito: un arrastre
  // sin querer le llegaría a las siete salas al instante, y el SU no tendría
  // dónde probar. El botón es el momento en que la maqueta pasa a ser el
  // tablero de los demás — y por eso también es lo que queda en la bitácora.
  const [publicando, setPublicando] = useState(false);
  const [publicado,  setPublicado]  = useState(null);   // tabId recién publicado
  const publicarAcomodo = async (tabId) => {
    const base    = widgetLayout[tabId] || {};
    const medidas = widgetSizes[tabId]  || {};
    const orden = Object.keys(base)
      .filter(id => id !== 'kpi' && (TAB_WIDGETS[tabId] || []).includes(id))
      .sort((a, b) => (base[a].row !== base[b].row ? base[a].row - base[b].row : base[a].col - base[b].col));
    // Sólo las medidas de lo que se publica: arrastrar una medida de un widget
    // que no está en la categoría deja basura en la fila y confunde al leerla.
    const medidasPublicadas = Object.fromEntries(orden.filter(id => medidas[id]).map(id => [id, medidas[id]]));

    setPublicando(true);
    const { error } = await upsertDashboardCanon({ tabId, orden, medidas: medidasPublicadas });
    setPublicando(false);
    if (error) { console.error('[dash canon publicar]', error); return; }

    setCanon(prev => ({ ...(prev || {}), [tabId]: { orden, medidas: medidasPublicadas } }));
    setPublicado(tabId);
    setTimeout(() => setPublicado(null), 2600);
    useStaff.getState().appendAuditLog('TABLERO_ACOMODO_PUBLICADO', tabId, {
      pestana: TABS.find(t => t.id === tabId)?.label ?? tabId,
      widgets: orden.length,
      orden,
    });
  };

  // Los cargos y sus permisos, para el previsualizador. Se piden una sola vez y
  // recién cuando el SU abre «Personalizar» en una pestaña temática: no hacen
  // falta para pintar el tablero, y son dos consultas que nadie más usa.
  useEffect(() => {
    if (!isSU || !showConfig || activeTab === 'general' || cargos) return;
    Promise.all([fetchRolesForPermissions(), fetchRolePermissions()]).then(([r, p]) => {
      if (r.error) { console.error('[dash canon cargos]', r.error); return; }
      if (p.error) { console.error('[dash canon permisos]', p.error); return; }
      const porCargo = {};
      (p.data || []).forEach(fila => {
        if (!fila.can_view) return;
        (porCargo[fila.role_id] ??= new Set()).add(fila.module_key);
      });
      // Un cargo SU ve todo, igual que `hasPermission`, que corta con
      // `if (isSU) return true` antes de mirar `role_permissions`. Sin esto el
      // previsualizador lo mostraría vacío y sería mentira.
      (r.data || []).forEach(c => { if (c.is_su) porCargo[c.id] = new Set(Object.values(PERMISO_DE).filter(Boolean)); });
      setPermisosPorCargo(porCargo);
      setCargos((r.data || []).map(c => ({ id: c.id, name: c.name })));
    });
  }, [isSU, showConfig, activeTab, cargos]);

  // El previsualizador se apaga al salir del panel o al cambiar de pestaña: es
  // una lente para revisar, no un estado en el que quedarse — y quedarse dentro
  // mirando el tablero de otro cargo sin la señal del panel abierto se lee como
  // que el portal perdió permisos.
  useEffect(() => { setVerComoRol(null); }, [activeTab, showConfig]);

  // ── wrapWidget: explicit grid position, resize button, drag handle ──────────
  // ── `vacio`: un widget sin datos no paga pantalla en el teléfono ──────────
  //
  // En 390px el tablero mide 5,874px, o sea unas siete pantallas, y la segunda
  // era **entera** el gráfico de asistencia vacío. Un widget que no tiene nada
  // que decir ocupaba exactamente el mismo alto que uno lleno, porque el alto
  // sale de la rejilla y la rejilla no sabe qué hay adentro.
  //
  // Quien lo declara es el widget, que es el único que sabe si su lista vino
  // vacía. En escritorio no cambia nada: ahí el hueco es barato y mover la
  // altura rompería el acomodo que el usuario guardó con «Personalizar».
  //
  // Baja a UNA fila (150px). Para que quepa, el vacío se dice en una línea:
  // `EmptyState linea`, la tercera medida del canónico, que existe justamente
  // por esto. Con `compact` (200px de mínimo) el recorte no servía de nada — se
  // midió: el alto del tablero en 390px no bajó ni un píxel.
  const wrapWidget = (id, content, staggerIdx = 0, vacio = false) => {
    const { label } = getWidgetSize(id);
    const eCols = getEffectiveCols(id);
    const eRowsBase = getEffectiveRows(id);
    const eRows = esTelefono && vacio ? 1 : eRowsBase;
    const pos   = activeLayout[id] || { col: 1, row: 1 };
    const isActive     = dndActive === id;
    const isBouncing   = bouncingIds.has(id);
    const isResizeOpen = resizeOpenId === id;

    return (
      <div
        key={id}
        data-widget-id={id}
        className={`relative group/drag animate-stagger-child ${isBouncing ? 'animate-widget-settle' : ''}`}
        style={{
          // En el teléfono NO se fija la celda: sólo cuánto ocupa, y la rejilla
          // acomoda en el orden del DOM.
          //
          // Con la celda fija, un widget apagado por permiso —o por
          // «Personalizar»— dejaba su hueco: el acomodo le reserva la celda y
          // `renderWidget` devuelve `null`. Se veían tres columnas vacías
          // seguidas en el tablero de prueba, con `inv_movement` y `vendedores`
          // ocultos. Y la salida obvia —filtrar el acomodo por los que se ven—
          // obliga a copiar la lógica de visibilidad en un segundo lugar, que
          // es justo la clase de lista que se desincroniza en cuanto alguien
          // agrega otro `return null`. La rejilla ya sabe empaquetar; el orden
          // del DOM ya sale del acomodo guardado.
          ...(esTelefono ? {} : { gridColumnStart: pos.col, gridRowStart: pos.row }),
          gridColumnEnd:   `span ${eCols}`,
          gridRowEnd:      `span ${eRows}`,
          opacity:    isActive ? 0.2 : 1,
          transition: isActive ? 'opacity 0.12s' : 'opacity 0.2s',
          '--stagger-delay': `${staggerIdx * 45}ms`,
        }}
        onPointerDown={acomodoLibre && isMobile && showConfig ? (e) => handleLongPressStart(e, id) : undefined}
        onPointerMove={acomodoLibre && isMobile && showConfig ? handleLongPressMoveCancel : undefined}
        onPointerUp={acomodoLibre && isMobile && showConfig ? handleLongPressEnd : undefined}
        onPointerCancel={acomodoLibre && isMobile && showConfig ? handleLongPressEnd : undefined}
      >
        {/* Grip handle — en mobile solo visible/activo con "Personalizar" abierto
            (showConfig): antes se armaba un long-press en CUALQUIER pointerdown
            del widget sin importar el modo, así que un scroll con una pausa breve
            podía disparar el drag y reordenar widgets por accidente. Hover-only
            en desktop, sin cambios. before:-inset-2.5 en mobile amplía la zona de
            toque a ~44px sin agrandar la píldora visible (v2.47.4).

            No se renderiza —en vez de esconderse— cuando la pestaña no es de
            quien la mira: un asidero invisible pero presente es justo el
            «fantasma» que costó dos correcciones en el botón de tamaño de acá
            abajo (v2.448.0 y A17). Lo que no existe no lo alcanza ni el teclado
            ni el lector de pantalla. */}
        {acomodoLibre && <div
          onPointerDown={e => startDrag(e, id)}
          className={`absolute -top-4 left-1/2 -translate-x-1/2 z-tabs scale-100 lg:opacity-0 lg:scale-[0.95] lg:group-hover/drag:opacity-100 focus-within:opacity-100 lg:group-hover/drag:scale-100 transition-[opacity,transform] duration-[var(--dur-base)] ease-[var(--ease-spring)] cursor-grab active:cursor-grabbing touch-none select-none ${isMobile ? (showConfig ? "opacity-100 relative before:absolute before:content-[''] before:-inset-2.5" : "opacity-0 pointer-events-none") : ''}`}
        >
          <div className="bg-surface-card border border-divider rounded-full px-3 py-1 flex items-center gap-1.5 shadow-lg hover:shadow-xl hover:scale-105 hover:bg-brand hover:border-brand hover:text-white transition-[transform,box-shadow,background-color,border-color,color] duration-[var(--dur-fast)] group/grip">
            <GripVertical size={12} className="text-content-3 group-hover/grip:text-white transition-colors" />
            <span className="text-micro font-black text-content-2 uppercase tracking-widest group-hover/grip:text-white transition-colors">{label}</span>
          </div>
        </div>}

        {content}

        {/* Resize button — hover to reveal, click opens W×H popover.
            En el teléfono sigue la MISMA regla que la píldora de arrastrar de
            arriba: sólo existe con "Personalizar" abierto (2026-08-06,
            decisión del usuario). Los dos son la edición del tablero, y en un
            teléfono editar y navegar se pisan — ese es el motivo por el que el
            arrastre ya vivía detrás del modo, y no había ninguno para que el
            tamaño no.

            Su estado anterior en móvil no era una decisión, era un residuo:
            `opacity-0` SIN `pointer-events-none`, o sea invisible y tocable —
            un botón fantasma en la esquina de cada widget— hasta que la regla
            de hover táctil de v2.448.0 lo volvió visible siempre y lo dejó
            apoyado sobre la última columna del gráfico de tráfico.
            Redimensionar en el teléfono NO se pierde: el panel W×H está hecho
            para el dedo (SegmentedControl con los 44px canónicos) y con 2
            columnas hay algo real que elegir.

            `pointer-events-none` no es decorativo: es lo que impide que vuelva
            el fantasma. Y al no quedar `group-hover` en el atributo `class` de
            esta rama, la regla de index.css tampoco lo revela.

            Y va con `inert` (A17): `pointer-events-none` sólo tapa el mouse —
            el teclado y el lector de pantalla siguen entrando al botón dentro
            de lo invisible (WCAG 2.4.3). O sea que el "fantasma" tenía una
            segunda mitad que el `opacity-0` de siempre tampoco cubría. */}
        {acomodoLibre && !dndActive && (
          <div
            data-resize-panel
            inert={isMobile && !showConfig && !isResizeOpen ? true : undefined}
            className={`absolute bottom-3 right-3 z-tabs transition-[opacity,transform] duration-[var(--dur-base)] ease-[var(--ease-spring)] ${
              isResizeOpen
                ? 'opacity-100 scale-100'
                : isMobile
                  ? (showConfig ? 'opacity-100 scale-100' : 'opacity-0 pointer-events-none')
                  : 'opacity-0 scale-[0.95] group-hover/drag:opacity-100 focus-within:opacity-100 group-hover/drag:scale-100'
            }`}
          >
            <Button
                icon={Maximize2}
                iconOnly
                size="xs"
                variant="primary"
                onClick={e => { e.stopPropagation(); setResizeOpenId(isResizeOpen ? null : id); }}
                title="Cambiar tamaño"
            />

            {/* `w-max` NO es cosmético: sin ancho declarado, una caja
                `absolute` con `right-0` y sin `left` se dimensiona por
                shrink-to-fit, y el ancho disponible que usa para eso es el de su
                BLOQUE CONTENEDOR — que acá es el envoltorio del botón, de unos
                28px. O sea que el panel se encogía a su min-content, y como
                `SegmentedControl` lleva `flex-wrap`, los números se partían en
                dos renglones y el grupo de Alto se desbordaba. Reportado con
                captura el 2026-08-07 sobre un widget de 4 columnas de ancho.

                Los demás popovers del portal ya declaran el suyo (`w-max`,
                `w-[210px]`, `min-w-[170px]`…). Éste era el único sin ancho, y
                por eso era el único que se deformaba. */}
            {isResizeOpen && (
              <div className="absolute bottom-full right-0 mb-2 w-max animate-in fade-in zoom-in-95 origin-bottom-right duration-[var(--dur-fast)]">
                {/* gap ampliado + before:-inset-1 en mobile: mejora el touch target
                    de 24px a ~32px sin que las zonas de toque de números
                    vecinos se solapen (gap-1.5=6px era insuficiente, v2.47.4) */}
                <div data-surface="dropdown" className={`px-3 py-2.5 flex items-center whitespace-nowrap ${isMobile ? 'gap-2.5' : 'gap-1.5'}`}>
                  {/* Ancho y alto: dos uno-de-N de números. Con
                      `SegmentedControl` cada grupo se anuncia como "3 de 4" en
                      vez de ocho botones sueltos sin relación, y el toque de
                      44px lo pone el canónico (antes lo parchaba un
                      `before:-inset-1` solo en móvil). */}
                  <span className="text-micro font-black text-content-2 uppercase tracking-widest mr-0.5">W</span>
                  <SegmentedControl size="sm" label="Ancho del widget"
                    value={eCols} onChange={n => updateWidgetSize(id, 'cols', n)}
                    options={Array.from({length: activeCols}, (_, i) => ({ value: i + 1, label: String(i + 1) }))} />
                  <div className="w-px h-3 bg-divider mx-0.5" />
                  <span className="text-micro font-black text-content-2 uppercase tracking-widest mr-0.5">H</span>
                  <SegmentedControl size="sm" label="Alto del widget"
                    value={eRows} onChange={n => updateWidgetSize(id, 'rows', n)}
                    options={[1,2,3,4].map(n => ({ value: n, label: String(n) }))} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // Render a widget by id, wrapped with DnD
  const renderWidget = (wid, staggerIdx = 0) => {
    /* ── KPI is rendered separately above the grid, skip in grid ── */
    if (wid === 'kpi') return null;

    /* ── TREND ── */
    if (wid === 'trend') {
      if (!showWidget('trend','dash_trend')) return null;
      return wrapWidget('trend',
        <WidgetCard title="Tendencia de asistencia" icon={Activity} category="personal"
          action={
            <PeriodStepper
              size="sm"
              unit="semana"
              label={trendOffset === 0 ? 'Esta semana' : trendRangeLabel}
              isCurrent={trendOffset === 0}
              resetLabel="Esta semana"
              onPrev={() => setTrendOffset(o => o - 1)}
              onNext={() => setTrendOffset(o => Math.min(0, o + 1))}
              onReset={() => setTrendOffset(0)}
              nextDisabled={trendOffset === 0}
            />
          }>
          <div className="px-4 pb-4 pt-2 h-full flex flex-col">
            {!attendanceLoaded ? (
              <EsqueletoTendencia />
            ) : tendenciaVacia ? (
              /* Sin marcaciones: no se dibuja la serie. Ver `tendenciaVacia`.
                 El texto dice de dónde viene el dato, porque el vacío casi
                 siempre es «todavía no», no «nunca». */
              /* Sin subtítulo y en medida `linea`, igual que los otros nueve
                 vacíos del tablero. Era el último que quedaba en medida de
                 PANEL —icono gigante en su caja, título grande y subtítulo—, y
                 al lado de «Sin solicitudes pendientes» se leían como dos
                 componentes distintos. El usuario lo señaló con captura el
                 2026-08-10: «¿por qué los vacíos no se ven iguales?». */
              <EmptyState
                linea
                icon={Activity}
                title={trendOffset === 0 ? 'Sin marcaciones esta semana' : 'Sin marcaciones en esa semana'}
              />
            ) : (
              /* El mismo esqueleto como espera del chunk de `recharts`: las dos
                 esperas se leen como una y el gráfico entra una sola vez. */
              <Suspense fallback={<EsqueletoTendencia />}>
                <GraficaTendencia data={trendData} />
              </Suspense>
            )}
          </div>
        </WidgetCard>
      , staggerIdx, attendanceLoaded && tendenciaVacia);
    }

    /* ── SHIFTS ── */
    if (wid === 'shifts') {
      if (!showWidget('shifts','dash_shifts')) return null;
      return wrapWidget('shifts',
        <WidgetCard title="Estado de turnos" icon={Clock} category="personal"
          action={getScope('dash_shifts') === 'ALL' && activeBranches.length>1&&(<LiquidSelect value={currentShiftBranch} onChange={setShiftBranch} options={activeBranches.map(b=>({value:String(b.id),label:b.name}))} placeholder="Sucursal..." icon={Building2} clearable={false} compact bare/>)}>
          <div className="overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] h-full divide-y divide-divider">
            {employees.length === 0 ? (
              <div className="px-4 py-3 space-y-5">
                {[0,1,2].map(i => (
                  <div key={i} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Skel className="w-2 h-2 rounded-full" />
                      <Skel className="h-2.5 w-20" />
                      <Skel className="h-4 w-6 rounded-full" />
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {[0,1,2].map(j => <Skel key={j} className="h-5 w-16 rounded-full" />)}
                    </div>
                  </div>
                ))}
              </div>
            ) : shiftStatusData.length===0?(
              <EmptyState linea icon={Users} title="Sin empleados" />
            // Había un cuarto caso sin dibujo: con empleados y con datos, pero
            // ningún grupo con gente, los `return null` de adentro dejaban la
            // tarjeta EN BLANCO — ni dato, ni vacío, ni carga. Un widget que no
            // dice nada se lee como roto (auditoría del 2026-08-10).
            ):Object.values(STATUS_CONFIG).every((_,i)=>!(shiftGroups[Object.keys(STATUS_CONFIG)[i]]||[]).length)?(
              <EmptyState linea icon={Clock} title="Sin turnos hoy" />
            ):(
              Object.entries(STATUS_CONFIG).map(([status,cfg])=>{
                const group=shiftGroups[status]||[]; if(!group.length) return null;
                return (
                  <div key={status} className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-2"><span className={`w-2 h-2 rounded-full ${cfg.dot}`}/><span className="text-caption font-black uppercase tracking-wide text-content-2">{cfg.label}</span><Badge variant={cfg.variante} size="sm">{group.length}</Badge></div>
                    <div className="flex flex-wrap gap-1">{group.map(e=><Badge key={e.id} variant={cfg.variante} size="sm" uppercase={false}>{e.name?.split(' ')[0]}</Badge>)}</div>
                  </div>
                );
              })
            )}
          </div>
        </WidgetCard>
      , staggerIdx);
    }

    /* ── SALES ── */
    if (wid === 'sales') {
      if (!showWidget('sales','dash_sales')) return null;
      const isSalesLocked = getScope('dash_sales') !== 'ALL';
      const effectiveSalesBranch = isSalesLocked && userBranchStr ? userBranchStr : salesBranch;
      return wrapWidget('sales',
        <WidgetCard noClip icon={BarChart2} category="ventas"
          title={typeof salesView==='number'?`Horas · ${DAY_NAMES[salesView]}`:salesView==='HOURS'?'Promedio por hora':'Ventas por día'}
          action={
            <div className="flex items-center gap-2">
              {/* `shrink-0`: en la cabecera del widget compite con un select
                  y un segmentado, y en un teléfono el flex se lo comía hasta
                  20px de ancho (medido en iPhone 13) aunque su alto fuera 44. */}
              {openModal&&<Button
                              className="shrink-0"
                              icon={Maximize2}
                              iconOnly
                              size="xs"
                              variant="primary"
                              onClick={()=>openModal('viewWfmAnalytics')}
                          />}
              {!isSalesLocked && <LiquidSelect value={effectiveSalesBranch} onChange={setSalesBranch} options={salesBranches.map(b=>({value:String(b.id),label:b.name}))} placeholder="Sucursal..." icon={Building2} clearable={false} compact bare/>}
              <div className="flex items-center gap-1">
                {typeof salesView==='number'&&<Button variant="secondary" size="xs" icon={ChevronLeft} onClick={()=>setSalesView('DAYS')}>Días</Button>}
                {/* Horas · Días es un uno-de-N, no dos botones sueltos. */}
                <SegmentedControl size="sm" label="Escala del gráfico"
                  value={salesView==='HOURS'?'HOURS':'DAYS'}
                  onChange={v=>setSalesView(v)}
                  options={[{ value:'HOURS', label:'Horas' },{ value:'DAYS', label:'Días' }]} />
              </div>
            </div>
          }>
          <div className="px-5 pb-5 pt-3 overflow-visible h-full flex flex-col">
            {/* La leyenda va ARRIBA de las barras. Estaba debajo, y el color es
                lo que codifica el estado del día: se llegaba a los datos sin
                saber qué significaba el naranja, y había que volver a subir. */}
            <div className="flex flex-wrap gap-3 mb-3 shrink-0">
              {[['var(--txvol-muerta)','Muerta'],['var(--txvol-normal)','Normal'],['var(--txvol-pico)','Pico'],['var(--txvol-critica)','Crítica']].map(([c,l])=>(
                <div key={l} className="flex items-center gap-1 text-micro font-bold text-content-2 uppercase tracking-widest"><div className="w-2 h-2 rounded-full" style={{backgroundColor:c}}/>{l}</div>
              ))}
            </div>
            <div className="relative flex-1 min-h-0">
              <div className="flex flex-col justify-between pointer-events-none absolute inset-x-0 top-0 h-full opacity-10"><div className="border-t border-dashed border-divider w-full"/><div className="border-t border-dashed border-divider w-full"/></div>
              {/* A sangre y con menos hueco EN EL TELÉFONO. Siete días en los
                  316px que deja el relleno de la tarjeta dan 40px por barra, y
                  el blanco de dedo mínimo son 44 (§32): la barra se toca para
                  abrir el día, así que 4px de menos es un día que a veces no
                  abre. Recuperando el relleno lateral y bajando el hueco a 4px
                  quedan ~45. De `sm` para arriba, lo de siempre. */}
              <div className="flex items-end gap-1 sm:gap-1.5 -mx-3 sm:mx-0 w-[calc(100%+1.5rem)] sm:w-full h-full relative overflow-visible">
                {!effectiveSalesBranch?(
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2"><BarChart2 size={24} strokeWidth={1.5} className="text-content-2"/><p className="text-micro font-black text-content-2/60 uppercase tracking-widest">Selecciona una sucursal</p></div>
                ):salesLoading?(
                  <div className="absolute inset-0 flex items-end gap-1.5 px-1 pb-1">
                    {[55,80,42,95,68,72,50,38,85,60,45,78].map((h,i) => (
                      <div key={i} className="flex-1 flex flex-col justify-end h-full">
                        <Skel className="w-full rounded-t-[4px]" style={{ height:`${h}%` }} />
                      </div>
                    ))}
                  </div>
                ):(() => {
                  const chartData = typeof salesView==='number'?salesStats.specificHours[salesView]||[]:salesView==='HOURS'?salesStats.generalHours:salesStats.days;
                  if (!chartData?.length) return <EmptyState linea icon={BarChart2} title="Sin historial de ventas" />;
                  return chartData.map((item,i)=>(
                    <div key={i} {...clickable(()=>{if(salesView==='DAYS')setSalesView(item.day);})}
                      // El acuse SÓLO cuando la columna navega — misma regla que
                      // `ListRow` y que la del gráfico de horarios. Las siete no
                      // pueden dar 44pt (son `imposibles` para el medidor:
                      // aritmética, no deuda), pero se tocan, y en el teléfono
                      // `hover:` no existe.
                      className={`flex-1 flex flex-col justify-end items-center group relative h-full overflow-visible transition-transform duration-[var(--dur-fast)] ${salesView==='DAYS'?'cursor-pointer active:scale-[0.97]':''}`}>
                      <div data-surface="tooltip" className="absolute mb-1 bottom-full left-1/2 -translate-x-1/2 px-2.5 py-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-[opacity,transform] duration-[var(--dur-base)] pointer-events-none w-max z-modal translate-y-2 group-hover:-translate-y-1 flex flex-col items-center">
                        <p className="font-black text-micro uppercase tracking-widest text-content-tooltip-2 mb-1 border-b border-border-tooltip pb-0.5 px-2">{typeof salesView==='number'?'Hora':'Día'}: {item.label}</p>
                        {salesView==='DAYS'?(
                          <>
                            <p className="text-label font-bold flex items-center gap-1.5 mt-0.5"><span className="w-2 h-2 rounded-full" style={{backgroundColor:item.color}}/>{item.avg} Tx / hora punta (P75)</p>
                            <p className="text-caption text-content-tooltip-2 mt-0.5">{item.dailyAvg} Tx / promedio del día</p>
                          </>
                        ):(
                          <p className="text-label font-bold flex items-center gap-1.5 mt-0.5"><span className="w-2 h-2 rounded-full" style={{backgroundColor:item.color}}/>{item.avg} Tx / promedio</p>
                        )}
                        {salesView==='DAYS'&&<p className="text-micro text-brand-text font-black uppercase tracking-widest mt-1 bg-chart-1/10 px-1.5 py-0.5 rounded-full">Clic para ver horas</p>}
                      </div>
                      {/* El número, sobre la barra. Sin eje ni valores, la altura
                          sólo daba forma: comparar el jueves con el domingo era
                          estimar píxeles, y la cifra vivía escondida en el
                          tooltip, que en un teléfono no existe. Sólo en la vista
                          de DÍAS: son siete barras y entran; en horas son 24 y
                          se pisarían. `item.height` es un porcentaje, así que el
                          `calc` deja la etiqueta pegada al tope de su barra. */}
                      {salesView==='DAYS' && (
                        <span className="absolute inset-x-0 text-center text-micro font-black text-content-2 tabular-nums pointer-events-none z-base"
                          style={{ bottom: `calc(${item.height} + 3px)` }}>{item.avg}</span>
                      )}
                      <div className={`w-full transition-[opacity,transform] duration-[var(--dur-slow)] ease-[var(--ease-spring)] group-hover:opacity-80 origin-bottom shadow-sm z-base ${salesView==='DAYS'?'rounded-t-[6px] group-hover:scale-y-[1.05]':'rounded-t-[4px] group-hover:-translate-y-[2px]'}`} style={{height:item.height,backgroundColor:item.color}}/>
                      <span className="text-micro font-bold text-content-3 mt-1 absolute -bottom-4 opacity-80 group-hover:opacity-100 group-hover:text-chart-9-text transition-[opacity,color] whitespace-nowrap z-base">{item.label}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>
        </WidgetCard>
      , staggerIdx);
    }

    /* ── SALES BRANCH MINI ── */
    if (wid.startsWith('sales_branch_')) {
      if (!showWidget('sales','dash_sales')) return null;
      const branchId = wid.replace('sales_branch_','');
      const b = salesBranches.find(br=>String(br.id)===branchId);
      if (!b) return null;
      const bd=todaySales[branchId], hourMap=bd?.hours||{}, totalS=bd?.totalSales||0;
      const dH=Object.keys(hourMap).map(Number).sort((a,z)=>a-z);
      const todayDow=new Date().getDay();
      let sch=b.weekly_hours; if(typeof sch==='string'){try{sch=JSON.parse(sch);}catch{sch=null;}}
      const dc=sch?.[String(todayDow===0?7:todayDow)]||sch?.[String(todayDow)];
      const openH=dc?.start?parseInt(dc.start):(dH[0]??8), closeH=dc?.end?parseInt(dc.end):(dH[dH.length-1]??18);
      const allH=Array.from(new Set([...Array.from({length:Math.max(closeH-openH+1,1)},(_,i)=>openH+i),...dH])).sort((a,z)=>a-z);
      const aV=dH.map(h=>hourMap[h]).filter(v=>v>0).sort((a,b)=>a-b);
      const maxV=aV[aV.length-1]??1;
      const bC=v=>{if(!v)return'var(--txvol-muerta)'; if(v>18)return'var(--txvol-critica)'; if(v>12)return'var(--txvol-pico)'; if(v>4)return'var(--txvol-normal)'; return'var(--txvol-muerta)';};
      const fS=v=>v>0?formatMoney(v):null;
      const hourSalesMap=bd?.hourSales||{};
      const nowH=new Date().getHours();
      const fHr=h=>h<12?`${h}a`:h===12?'12p':`${h-12}p`;
      return wrapWidget(wid,
        <div data-surface="card" className="h-full relative rounded-card border border-border-card shadow-[var(--shadow-glass-3)] hover:shadow-[var(--shadow-glass-4)] transition-[transform,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-spring)] overflow-hidden">
          {/* El brillo, igual que en `WidgetCard`. La capa de vidrio que iba acá se
              retiró: `data-surface="card"` ya la pone (ver la nota en WidgetCard). */}
          <div className="absolute inset-0 pointer-events-none rounded-card" style={{ background: 'linear-gradient(to bottom, var(--card-sheen), transparent)' }} />
          <div className="relative h-full p-3.5 flex flex-col gap-1.5">
            <div className="flex items-start justify-between gap-1">
              <p className="text-body-sm font-black text-content-2 leading-tight truncate">{b.name}</p>
              <span className={`text-label font-black shrink-0 ${dH.length?'text-success-text':'text-content-3'}`}>{fS(totalS)??'—'}</span>
            </div>
            {todayLoading?(
              <div className="skeleton rounded-lg flex-1"/>
            ):(
              <div className="flex flex-col flex-1 min-h-0">
                <div className="flex items-end gap-[1px] w-full flex-1">
                  {allH.map(h=>{
                    const v=hourMap[h]||0, bH=v>0?Math.max(Math.round((v/maxV)*100),4):2;
                    const isNow=h===nowH&&h>=openH&&h<=closeH;
                    return (
                      <div key={h} className="flex-1 flex flex-col justify-end relative h-full"
                        onMouseEnter={e=>{const r=e.currentTarget.getBoundingClientRect();setSalesBarTip({x:r.left+r.width/2,y:r.top,label:formatHourAMPM(h),amount:fS(hourSalesMap[h]||0),txCount:v});}}
                        onMouseLeave={()=>setSalesBarTip(null)}>
                        {isNow&&<div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full w-1.5 h-1.5 rounded-full bg-success shadow-[var(--shadow-glow-chart-9-sm)] animate-pulse z-base"/>}
                        <div className="w-full rounded-t-[2px] transition-[height,opacity]" style={{height:`${bH}%`,backgroundColor:bC(v),opacity:v>0?1:0.35}}/>
                      </div>
                    );
                  })}
                </div>
                {/* Una etiqueta cada N horas, no las dieciséis. En la baldosa de
                    media pantalla cada celda mide 11px y `overflow-hidden`
                    cortaba cada rótulo por la mitad: el eje se leía
                    «7:8:9:1(11121|2|3|4…». Se muestran unas cinco —y siempre la
                    hora actual, que va en verde— y se las deja sobresalir de su
                    celda, que ahora está vacía a los lados. La hora actual gana
                    el desempate para que no se pisen dos rótulos vecinos. */}
                {(() => {
                  const pasoHora = Math.max(1, Math.ceil(allH.length / 5));
                  const hayAhora = allH.includes(nowH);
                  return (
                    <div className="flex gap-[1px] w-full mt-0.5">
                      {allH.map((h, i)=>{
                        const mostrar = h === nowH
                          || (i % pasoHora === 0 && !(hayAhora && Math.abs(h - nowH) <= 1));
                        return (
                          <div key={h} className="flex-1 text-center overflow-visible whitespace-nowrap">
                            {mostrar && <span className={`text-micro font-bold leading-none ${h===nowH?'text-success-text':'text-content-3'}`}>{fHr(h)}</span>}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      , staggerIdx);
    }

    /* ── ABSENCES ── */
    if (wid === 'absences') {
      if (!showWidget('absences','dash_absences')) return null;
      const absScope = getScope('dash_absences');
      const displayAbsences = absScope === 'BRANCH' && userBranchStr
        ? absences.filter(r => {
            const emp = employees.find(e => String(e.id) === String(r.employee_id));
            return emp && String(emp.branchId ?? emp.branch_id ?? '') === userBranchStr;
          })
        : absences;
      return wrapWidget('absences',
        <WidgetCard title="Ausencias activas" icon={UserX} category="personal"
          action={puedeAbrir('/requests')&&<Button variant="ghost" size="xs" onClick={()=>navigate('/requests')}>Ver <ChevronRight size={11}/></Button>}>
          <div className="divide-y divide-divider overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] h-full">
            {absLoading?[0,1,2].map(i=>(
              <div key={i} className="flex items-center gap-3 px-5 py-3">
                <Skel className="w-7 h-7 rounded-lg flex-shrink-0" />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <Skel className="h-3 w-3/4" />
                  <Skel className="h-2.5 w-1/2" />
                </div>
                <Skel className="h-5 w-16 rounded-full flex-shrink-0" />
              </div>
            ))
              :displayAbsences.length===0?<EmptyState linea icon={UserCheck} title="Sin ausencias activas" />
              :displayAbsences.map(r=>{
                const meta=parseMeta(r.metadata), cfg=ABSENCE_COLORS[r.type]||ABSENCE_COLORS.PERMIT;
                const end=meta.endDate||(meta.permissionDates||[])[(meta.permissionDates||[]).length-1];
                return (
                  <div key={r.id} className="flex items-center gap-3 px-5 py-3">
                    <div className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${cfg.bg} ${cfg.border}`}><UserX size={13} className={cfg.text}/></div>
                    <div className="flex-1 min-w-0"><p className="text-body-sm font-semibold text-content truncate">{getEmpName(r.employee_id)}</p><p className="text-caption font-medium text-content-3">{nombreDeTipo(r.type)}{end&&` · hasta ${new Date(end+'T12:00:00').toLocaleDateString('es-SV',{day:'2-digit',month:'short'})}`}</p></div>
                    <Badge variant={cfg.variante} size="sm">{nombreCorto(r.type)}</Badge>
                  </div>
                );
              })}
          </div>
        </WidgetCard>
      , staggerIdx, !absLoading && displayAbsences.length === 0);
    }

    /* ── REQUESTS ── */
    if (wid === 'requests') {
      if (!showWidget('requests','dash_requests')) return null;
      const reqsScope = getScope('dash_requests');
      const displayReqs = reqsScope === 'BRANCH' && userBranchStr
        ? pendingReqs.filter(r => {
            const emp = employees.find(e => String(e.id) === String(r.employee_id));
            return emp && String(emp.branchId ?? emp.branch_id ?? '') === userBranchStr;
          })
        : pendingReqs;
      return wrapWidget('requests',
        <WidgetCard title="Solicitudes pendientes" icon={ClipboardList} category="personal"
          action={puedeAbrir('/requests')&&<Button variant="ghost" size="xs" onClick={()=>navigate('/requests')}>Ver todas <ChevronRight size={11}/></Button>}>
          <div className="divide-y divide-divider overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] h-full">
            {reqLoading?[0,1,2,3].map(i=>(
              <div key={i} className="flex items-center gap-3 px-5 py-3">
                <Skel className="w-7 h-7 rounded-lg flex-shrink-0" />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <Skel className="h-3 w-3/4" />
                  <Skel className="h-2.5 w-1/2" />
                </div>
                <Skel className="h-2.5 w-10 flex-shrink-0" />
              </div>
            ))
              :displayReqs.length===0?<EmptyState linea icon={ClipboardList} title="Sin solicitudes pendientes" />
              // §15.7 — caja de ícono + título + subtítulo + algo al final: la
              // anatomía exacta de `ListRow`. Y sin `onClick` renderiza un
              // `<div>`, así que la fila deja de ser tabulable cuando el usuario
              // no tiene permiso para abrirla — antes era un `<button>` sin
              // acción, una parada de foco que no hacía nada.
              :displayReqs.map(r=>(
                <ListRow key={r.id} density="sm"
                  icon={ClipboardList} iconClass="text-warning-text"
                  iconBoxClass="bg-warning/10 border-warning/30"
                  title={getEmpName(r.employee_id)}
                  subtitle={nombreDeTipo(r.type)}
                  onClick={puedeAbrir('/requests')?()=>navigate('/requests'):undefined}
                  className="rounded-none border-x-0 border-t-0 px-5"
                  trailing={<span className="text-caption text-content-3">{new Date(r.created_at).toLocaleDateString('es-SV',{day:'2-digit',month:'short'})}</span>} />
              ))}
          </div>
        </WidgetCard>
      , staggerIdx, !reqLoading && displayReqs.length === 0);
    }

    /* ── BRANCHES ── */
    if (wid === 'branches') {
      if (!showWidget('branches','dash_branches')) return null;
      const branchesWidgetScope = getScope('dash_branches');
      const displayBranchAlerts = branchesWidgetScope === 'BRANCH' && userBranchStr
        ? branchAlerts.filter(b => String(b.id) === userBranchStr)
        : branchAlerts;
      const displayBranches = branchesWidgetScope === 'BRANCH' && userBranchStr
        ? branches.filter(b => String(b.id) === userBranchStr)
        : branches;
      return wrapWidget('branches',
        <WidgetCard title="Alertas · Sucursales" icon={Building2} category="general"
          action={puedeAbrir('/branches')&&<Button variant="ghost" size="xs" onClick={()=>navigate('/branches')}>Ver <ChevronRight size={11}/></Button>}>
          <div className="p-3 flex flex-col gap-2 h-full overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {displayBranches.length === 0 ? (
              [0,1,2].map(i => (
                <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-xl border border-divider bg-surface-card-hover/50">
                  <Skel className="w-5 h-5 rounded-full flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skel className="h-2.5 w-2/3" />
                    <Skel className="h-2 w-1/2" />
                  </div>
                </div>
              ))
            ) : displayBranchAlerts.length===0?(
              /* Estaba escrito a mano —círculo verde de 40px, título y un
                 conteo— y era la ÚNICA forma de vacío del tablero que no salía
                 del canónico. Se veía distinta de las otras nueve porque lo
                 era. El número de sucursales activas ya lo dice la baldosa de
                 arriba, así que no se pierde nada al pasar a la línea. */
              <EmptyState linea icon={CheckCircle2} title="Todo en orden" />
            ):(
              displayBranchAlerts.map(b=>{
                const issue=getBranchIssue(b);
                return (
                  // Sin permiso NO es un control: era un `<button>` con `onClick`
                  // indefinido, o sea una parada de tabulación que no hacía nada.
                  // Con permiso es un ENLACE, que es lo que de verdad es.
                  (() => {
                    const puede = canManage('dash_branches');
                    const Caja = puede ? Link : 'div';
                    return (
                      <Caja key={b.id} {...(puede ? { to: `/branches/${b.id}` } : {})}
                        className={`flex items-center gap-2.5 p-2.5 rounded-xl border transition-[background-color] text-left w-full ${puede?'hover:bg-warning/10 cursor-pointer':'cursor-default'} border-warning/30 bg-warning/10`}>
                        <AlertTriangle size={13} className="text-warning-text shrink-0"/>
                        <div className="flex-1 min-w-0"><p className="text-label font-black text-content-2 truncate">{b.name}</p><p className="text-micro text-warning-text font-semibold">{issue}</p></div>
                        {puede&&<ChevronRight size={11} className="text-content-3 shrink-0"/>}
                      </Caja>
                    );
                  })()
                );
              })
            )}
          </div>
        </WidgetCard>
      , staggerIdx);
    }

    /* ── CALENDAR ── */
    if (wid === 'calendar') {
      if (!showWidget('calendar','dash_calendar')) return null;
      return wrapWidget('calendar',
        <WidgetCard title="Calendario" icon={CalendarDays} category="general" action={
          // El centro no es un rótulo sino un selector que se abre, así que va
          // como hijo de `PeriodStepper` (§17.1) — envolverlo en el botón de
          // "volver a hoy" daría un `<button>` dentro de otro.
          <PeriodStepper
            size="sm"
            unit="mes"
            onPrev={()=>setCalMonth(m=>new Date(m.getFullYear(),m.getMonth()-1,1))}
            onNext={()=>setCalMonth(m=>new Date(m.getFullYear(),m.getMonth()+1,1))}
          >
            <MonthYearPicker value={calMonth} onChange={setCalMonth} isMobile={isMobile}/>
          </PeriodStepper>
        }>
          <div className="px-3 pb-3 pt-1 flex flex-col h-full overflow-hidden">
            {/* Day headers — always visible */}
            <div className="grid grid-cols-7 mb-0.5 shrink-0">
              {['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map((d,i)=><div key={i} className="text-center text-micro font-black text-content-3 uppercase py-1">{d}</div>)}
            </div>
            {/* Day grid — scrolls internally if widget is too small */}
            <div className="overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] flex-1 min-h-0 [&::-webkit-scrollbar]:hidden">
              {employees.length === 0 ? (
                <div className="grid grid-cols-7 h-full" style={{ gridAutoRows: 'minmax(28px,1fr)' }}>
                  {Array.from({ length: 35 }).map((_, i) => (
                    i % 3 === 1 ? <Skel key={i} className="m-0.5 rounded-full" style={{ minHeight: 24 }} /> : <div key={i} />
                  ))}
                </div>
              ) : (
              <div className="grid grid-cols-7 h-full" style={{ gridAutoRows: 'minmax(28px,1fr)' }}>
                {calendarDays.cells.map((day,i)=>{
                  if (!day) return <div key={`pad-${i}`}/>;
                  const mm=String(calendarDays.month+1).padStart(2,'0'), dd=String(day).padStart(2,'0');
                  const ds=`${calendarDays.year}-${mm}-${dd}`, isToday=ds===localDateStr();
                  const ev=calendarEvents[ds], hasH=ev?.holidays?.length>0;
                  return (
                    <div key={day}
                      onMouseEnter={e=>{if(!hasH)return; const r=e.currentTarget.getBoundingClientRect(); setCalTooltip({holidays:ev?.holidays||[],x:r.left+r.width/2,y:r.top});}}
                      onMouseLeave={()=>setCalTooltip(null)}
                      className={`flex flex-col items-center justify-center rounded-full relative cursor-default transition-[background-color] duration-[var(--dur-fast)] ${isToday?'bg-brand':hasH?'bg-danger/10 hover:bg-danger/10':'hover:bg-surface-card-hover/80'}`}>
                      <span className={`text-body-sm font-bold leading-none ${isToday?'text-white':hasH?'text-danger-text':'text-content-2'}`}>{day}</span>
                      {hasH&&!isToday&&<div className="flex gap-0.5 mt-0.5"><span className="w-1 h-1 rounded-full bg-danger"/></div>}
                    </div>
                  );
                })}
              </div>
              )}
            </div>
          </div>
        </WidgetCard>
      , staggerIdx);
    }

    /* ── ANNOUNCEMENTS ── */
    if (wid === 'announcements') {
      if (!showWidget('announcements','dash_announcements')) return null;
      return wrapWidget('announcements',
        <WidgetCard title="Avisos recientes" icon={Megaphone} category="general"
          action={puedeAbrir('/announcements')&&<Button variant="ghost" size="xs" onClick={()=>navigate('/announcements')}>Ver todos <ChevronRight size={11}/></Button>}>
          <div className="divide-y divide-divider overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] h-full">
            {employees.length === 0 ? [0,1,2,3].map(i => (
              <div key={i} className="flex items-start gap-3 px-5 py-3.5">
                <Skel className="w-7 h-7 rounded-lg flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <Skel className="h-3 w-4/5" />
                  <Skel className="h-2.5 w-1/3" />
                </div>
              </div>
            )) : recentAnnouncements.length===0?<EmptyState linea icon={Megaphone} title="Sin avisos recientes" />
              :recentAnnouncements.map(a=>(
                <ListRow key={a.id} density="sm"
                  icon={a.priority==='URGENT'?Flame:Megaphone}
                  iconClass={a.priority==='URGENT'?'text-danger-text':'text-chart-1-text'}
                  iconBoxClass={a.priority==='URGENT'?'bg-danger/10 border-danger/30':'bg-chart-1/10 border-chart-1/30'}
                  title={a.title}
                  subtitle={new Date(a.date).toLocaleDateString('es-SV',{day:'2-digit',month:'short',year:'numeric'})}
                  onClick={puedeAbrir('/announcements')?()=>navigate('/announcements'):undefined}
                  className="rounded-none border-x-0 border-t-0 px-5"
                  trailing={a.priority==='URGENT'&&<Badge variant="danger" size="sm" uppercase={false}>URGENTE</Badge>} />
              ))}
          </div>
        </WidgetCard>
      , staggerIdx);
    }

    /* ── BIRTHDAYS ── */
    if (wid === 'birthdays') {
      if (!showWidget('birthdays','dash_birthdays')) return null;
      const bdScope = getScope('dash_birthdays');
      const displayBirthdays = bdScope === 'BRANCH' && userBranchStr
        ? birthdaysOfMonth.filter(e => String(e.branchId ?? e.branch_id ?? '') === userBranchStr)
        : birthdaysOfMonth;
      const MONTH_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
      return wrapWidget('birthdays',
        <div data-surface="card" className="h-full relative rounded-card border border-border-card shadow-[var(--shadow-glass-3)] hover:shadow-[var(--shadow-glass-4)] transition-[transform,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-spring)] flex flex-col overflow-hidden">
          {/* El brillo, igual que en `WidgetCard`. La capa de vidrio que iba acá se
              retiró: `data-surface="card"` ya la pone (ver la nota en WidgetCard). */}
          <div className="absolute inset-0 pointer-events-none rounded-card" style={{ background: 'linear-gradient(to bottom, var(--card-sheen), transparent)' }} />
          {/* Header */}
          <div className="relative px-4 py-3 border-b border-border-card shrink-0">
            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-brand/10 border border-brand/15 flex items-center justify-center">
                  <Gift size={13} className="text-brand-text" strokeWidth={2}/>
                </div>
                <h3 className="text-body-sm font-black text-content tracking-tight">Cumpleaños</h3>
              </div>
              <PeriodStepper
                size="sm"
                unit="mes"
                label={MONTH_ES[bdMonth.getMonth()]}
                onPrev={() => setBdMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
                onNext={() => setBdMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
              />
            </div>
          </div>
          {/* Content */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] px-3 pb-3 pt-2">
            {employees.length === 0 ? (
              <div className="space-y-1.5">
                {[0,1,2,3].map(i => (
                  <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-2xl border border-border-card bg-surface-card-hover">
                    <Skel className="w-9 h-9 rounded-full flex-shrink-0" />
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <Skel className="h-3 w-2/3" />
                      <Skel className="h-2 w-1/3" />
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <Skel className="h-3 w-10" />
                      <Skel className="h-4 w-12 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : displayBirthdays.length === 0 ? (
              /* Era el último vacío escrito a mano del tablero: icono de 32px
                 y el texto partido con un `<br/>`, o sea 181px contra los 56 de
                 los otros diez. */
              <EmptyState linea icon={Gift} title="Sin cumpleaños este mes" />
            ) : (
              <div className="space-y-1.5">
                {displayBirthdays.map((e,i)=>{
                  const initials=employeeInitials(e);
                  const dayLabel=`${e.day} ${new Date(bdMonth.getFullYear(),bdMonth.getMonth(),e.day).toLocaleDateString('es-SV',{month:'short'})}`;
                  const cardCls = e.isToday
                    ? 'bg-brand/5 border-brand/20 shadow-[var(--shadow-glow-brand)]'
                    : e.isTomorrow
                    ? 'bg-warning/10 border-warning/30 shadow-[var(--shadow-glow-warning)]'
                    : e.isPast
                    ? 'bg-surface-card border-border-card opacity-40'
                    : 'bg-surface-card border-border-card hover:bg-surface-card hover:border-divider hover:shadow-sm';
                  return (
                    <div key={e.id||i} className={`flex items-center gap-2.5 p-2.5 rounded-2xl border transition-[background-color,border-color,box-shadow] duration-[var(--dur-base)] ${cardCls}`}>
                      {/* Avatar */}
                      <div className="relative flex-shrink-0">
                        {e.photo_url||e.photo
                          ?<img src={e.photo||e.photo_url} alt={e.name} className={`w-9 h-9 rounded-full object-cover border-2 shadow-sm ${e.isToday?'border-brand/30':e.isTomorrow?'border-warning/40':'border-surface-card'}`}/>
                          :<div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 shadow-sm font-black text-body-sm ${e.isToday?'bg-brand text-white border-brand/30':e.isTomorrow?'bg-warning-solid text-white border-warning/40':'bg-surface-card-hover text-content-3 border-surface-card'}`}>{initials}</div>
                        }
                        {e.isToday&&<div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-brand flex items-center justify-center ring-2 ring-surface-card shadow-sm"><Gift size={8} className="text-white" strokeWidth={3}/></div>}
                        {e.isTomorrow&&<div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-warning flex items-center justify-center ring-2 ring-surface-card shadow-sm"><Clock size={8} className="text-white" strokeWidth={3}/></div>}
                      </div>
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className={`text-body-sm font-black truncate leading-tight ${e.isToday?'text-brand-text':e.isTomorrow?'text-warning-text':'text-content'}`} title={e.name}>{shortEmployeeName(e)}</p>
                        <p className="text-micro text-content-3 font-medium truncate">{e.branchName}</p>
                      </div>
                      {/* Badges */}
                      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                        <span className={`text-caption font-black ${e.isToday?'text-brand-text':e.isTomorrow?'text-warning-text':'text-content-2'}`}>{dayLabel}</span>
                        {e.isToday
                          ?<Badge variant="info" size="sm" uppercase={false}>Hoy</Badge>
                          :e.isTomorrow
                          ?<Badge variant="warning" size="sm" uppercase={false}>Mañana</Badge>
                          :<Badge size="sm" uppercase={false}>{e.age} años</Badge>
                        }
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      , staggerIdx);
    }

    /* ── COTIZACIONES ── */
    if (wid === 'cotizaciones') {
      if (!showWidget('cotizaciones', 'dash_cotizaciones')) return null;
      const fmt = v => formatMoney(v);
      return wrapWidget('cotizaciones',
        <WidgetCard title="Cotizaciones activas" icon={Receipt} category="ventas"
          action={puedeAbrir('/cotizaciones')&&<Button variant="ghost" size="xs" onClick={() => navigate('/cotizaciones')}>Ver <ChevronRight size={11}/></Button>}>
          {cotizLoading ? (
            <div className="flex flex-col h-full">
              <div className="flex items-end gap-4 px-4 pt-3 pb-2 border-b border-divider shrink-0">
                <div className="space-y-1.5">
                  <Skel className="h-8 w-10" />
                  <Skel className="h-2 w-16" />
                </div>
                <div className="mb-1 space-y-1.5">
                  <Skel className="h-4 w-20" />
                  <Skel className="h-2 w-14" />
                </div>
              </div>
              <div className="flex-1 divide-y divide-divider">
                {[0,1,2,3].map(i => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <Skel className="w-6 h-6 rounded-lg flex-shrink-0" />
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <Skel className="h-2.5 w-3/4" />
                      <Skel className="h-2 w-1/2" />
                    </div>
                    <Skel className="h-3 w-14 flex-shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
          <div className="flex flex-col h-full">
            <div className="flex items-end gap-3 px-4 pt-3 pb-2 border-b border-divider shrink-0">
              <div>
                <p className="text-display-lg font-black text-content leading-none">{cotizStats.activas}</p>
                <p className="text-caption font-semibold text-content-3 mt-0.5">últ. 30 días</p>
              </div>
              <div className="mb-1">
                <p className="text-body font-black text-success-text">{fmt(cotizStats.total)}</p>
                <p className="text-micro font-bold text-content-2 uppercase tracking-wide">monto total</p>
              </div>
            </div>
            <div className="overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] flex-1 divide-y divide-divider">
              {cotizStats.recent.length === 0 ? (
                <EmptyState linea icon={Receipt} title="Sin cotizaciones activas" />
              ) : cotizStats.recent.map(c => (
                <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="w-6 h-6 rounded-lg bg-chart-1/10 border border-chart-1/30 flex items-center justify-center shrink-0">
                    <Receipt size={11} className="text-brand-text"/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-label font-semibold text-content truncate">{c.customer_name || '—'}</p>
                    <p className="text-micro text-content-3">{c.numero} · {new Date(c.fecha+'T12:00:00').toLocaleDateString('es-SV',{day:'2-digit',month:'short'})}</p>
                  </div>
                  <span className="text-label font-black text-content-2 shrink-0">{fmt(c.total)}</span>
                </div>
              ))}
            </div>
          </div>
          )}
        </WidgetCard>
      , staggerIdx);
    }

    /* ── FACTURACION HOY ── */
    if (wid === 'facturacion') {
      if (!showWidget('facturacion', 'dash_facturacion')) return null;
      const fmt = v => formatMoney(v);
      return wrapWidget('facturacion',
        <WidgetCard title="Facturación hoy" icon={FileText} category="ventas"
          action={puedeAbrir('/facturacion')&&<Button variant="ghost" size="xs" onClick={() => navigate('/facturacion')}>Ver <ChevronRight size={11}/></Button>}>
          {factLoading ? (
            <div className="flex flex-col h-full px-4 py-3 gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-surface-card-hover/80 rounded-2xl p-3 space-y-2">
                  <Skel className="h-8 w-12" />
                  <Skel className="h-2 w-16" />
                </div>
                <div className="bg-success/10 rounded-2xl p-3 space-y-2">
                  <Skel className="h-5 w-20" />
                  <Skel className="h-2 w-16" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-danger/10 rounded-xl px-3 py-2 space-y-2">
                  <Skel className="h-5 w-8" />
                  <Skel className="h-2 w-10" />
                </div>
                <div className="bg-surface-card-hover rounded-xl px-3 py-2 space-y-2">
                  <Skel className="h-5 w-8" />
                  <Skel className="h-2 w-10" />
                </div>
              </div>
            </div>
          ) : (
          <div className="flex flex-col h-full px-4 py-3 gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-surface-card-hover/80 rounded-2xl p-3">
                <p className="text-display font-black text-content leading-none">{factStats.count}</p>
                <p className="text-caption font-semibold text-content-3 mt-1">documentos</p>
              </div>
              <div className="bg-success/10 rounded-2xl p-3">
                <p className="text-body-xl font-black text-success-text leading-none">{fmt(factStats.total)}</p>
                <p className="text-caption font-semibold text-success-text mt-1">total emitido</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-2 bg-danger/10 rounded-xl px-3 py-2">
                <span className="w-2 h-2 rounded-full bg-danger shrink-0"/>
                <div>
                  <p className="text-body-lg font-black text-danger-text">{factStats.ccf}</p>
                  <p className="text-micro font-bold text-danger-text uppercase tracking-wide">CCF</p>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-surface-card-hover rounded-xl px-3 py-2">
                <span className="w-2 h-2 rounded-full bg-content-3 shrink-0"/>
                <div>
                  <p className="text-body-lg font-black text-content-2">{factStats.fcf}</p>
                  <p className="text-micro font-bold text-content-2 uppercase tracking-wide">FCF / otros</p>
                </div>
              </div>
            </div>
          </div>
          )}
        </WidgetCard>
      , staggerIdx);
    }

    /* ── TOP PRODUCTOS ── */
    if (wid === 'top_productos') {
      if (!showWidget('top_productos', 'dash_top_productos')) return null;
      const fmt = v => formatMoney(v, { decimales: 0 });
      const maxNeto = topProductos[0]?.neto ?? 1;
      return wrapWidget('top_productos',
        <WidgetCard title="Top productos · mes actual" icon={Package} category="productos"
          action={puedeAbrir('/ventas')&&<Button variant="ghost" size="xs" onClick={() => navigate('/ventas')}>Ver <ChevronRight size={11}/></Button>}>
          <div className="overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] h-full px-3 py-2">
            {topProdLoading ? (
              <div className="space-y-0.5 py-1">
                {[0,1,2,3,4,5,6].map(i => (
                  <div key={i} className="flex items-center gap-2.5 py-1.5">
                    <Skel className="w-4 h-2.5 rounded-sm flex-shrink-0" />
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <Skel className={`h-2.5 rounded-md ${i % 3 === 0 ? 'w-4/5' : i % 3 === 1 ? 'w-3/5' : 'w-2/3'}`} />
                      <div className="flex items-center gap-2">
                        <Skel className="flex-1 h-1.5 rounded-full" />
                        <Skel className="h-2.5 w-12 rounded-sm flex-shrink-0" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : topProductos.length === 0 ? (
              <EmptyState linea icon={Package} title="Sin datos este mes" />
            ) : topProductos.map((p, i) => {
              const pct = Math.max(Math.round((p.neto / maxNeto) * 100), 4);
              return (
                <div key={p.erp_product_id} className="flex items-center gap-2.5 py-1.5">
                  <span className="text-micro font-black text-content-3 w-4 shrink-0 text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-caption font-semibold text-content-2 truncate leading-tight">{p.descripcion}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="flex-1 h-1.5 bg-surface-card-hover rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }}/>
                      </div>
                      <span className="text-micro font-black text-content-3 shrink-0">{fmt(p.neto)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </WidgetCard>
      , staggerIdx);
    }

    /* ── INV SEARCH ── */
    // Baldosa 1×1 que abre el buscador en un modal, como sus tres hermanos.
    // A pedido del usuario: el resultado de una búsqueda son siete secciones de
    // sucursal con sus lotes, y en la tarjeta del tablero entraban dos.
    if (wid === 'inv_search') {
      if (!showWidget('inv_search', 'dash_inv_search')) return null;
      return wrapWidget('inv_search', <WidgetInventorySearch />, staggerIdx);
    }

    /* ── ANNULMENT REQUEST ── */
    if (wid === 'annulment_req') {
      if (!showWidget('annulment_req', 'dash_annulment_req')) return null;
      const isAnnAllScope = getScope('dash_annulment_req') === 'ALL';
      // Solo las que facturan, y en el orden en que las nombra el negocio (el
      // de `SALAS_QUE_FACTURAN`, no el del maestro).
      const annulmentOpts = SALAS_QUE_FACTURAN
        .map(id => branches.find(b => Number(b.id) === id))
        .filter(Boolean)
        .map(b => ({ value: String(b.id), label: b.name }));
      return wrapWidget('annulment_req',
        <WidgetAnnulmentRequest
          selectedBranchId={isAnnAllScope ? annulmentBranch : null}
          selectorSucursal={isAnnAllScope && annulmentOpts.length > 0 && (
            <LiquidSelect
              value={annulmentBranch}
              onChange={val => setAnnulmentBranch(val ?? salaQueFacturaPorDefecto(user?.branchId ?? user?.branch_id))}
              options={annulmentOpts}
              placeholder="Sucursal..."
              clearable={false}
            />
          )}
        />
      , staggerIdx);
    }

    /* ── MIN/MAX ADJUSTMENT REQUEST ── */
    if (wid === 'minmax_req') {
      if (!showWidget('minmax_req', 'dash_minmax_req')) return null;
      const isMmAllScope = getScope('dash_minmax_req') === 'ALL';
      const ownErp = MM_BRANCH_TO_ERP[user?.branchId ?? user?.branch_id] ?? null;
      return wrapWidget('minmax_req',
        <WidgetMinMaxRequest
          selectedErp={isMmAllScope ? Number(minmaxErp) : ownErp}
          selectorSucursal={isMmAllScope && (
            <LiquidSelect
              value={minmaxErp}
              onChange={val => setMinmaxErp(val ?? String(ownErp ?? 5))}
              options={MM_ERP_ORDER.map(id => ({ value: String(id), label: MM_ERP_NAMES[id] }))}
              placeholder="Sucursal..."
              clearable={false}
            />
          )}
        />
      , staggerIdx);
    }

    /* ── AJUSTE DE INVENTARIO ── */
    // Baldosa 1×1 que abre el formulario en un modal: metido en la tarjeta del
    // tablero no entraba —con un producto agregado la lista de resultados
    // quedaba en una franja y no se veía que se podían sumar más—. El selector
    // de sucursal se va adentro con él.
    if (wid === 'inv_movement') {
      if (!showWidget('inv_movement', 'dash_inv_movement')) return null;
      const isMovAllScope = getScope('dash_inv_movement') === 'ALL';
      const ownErpMov = MM_BRANCH_TO_ERP[user?.branchId ?? user?.branch_id] ?? null;
      const erpMov = isMovAllScope ? Number(movimientoErp) : ownErpMov;
      const branchIdMov = Number(
        Object.keys(MM_BRANCH_TO_ERP).find(b => MM_BRANCH_TO_ERP[b] === erpMov) ?? 0,
      ) || null;
      return wrapWidget('inv_movement',
        <WidgetInventoryMovement
          erpSucursalId={erpMov}
          branchId={branchIdMov}
          branchName={MM_ERP_NAMES[erpMov] ?? ''}
          erpUbicacionId={ERP_UBICACION_POR_SUCURSAL[erpMov] ?? null}
          selectorSucursal={isMovAllScope && (
            <LiquidSelect
              value={movimientoErp}
              onChange={val => setMovimientoErp(val ?? String(ownErpMov ?? 5))}
              options={MM_ERP_ORDER.map(id => ({ value: String(id), label: MM_ERP_NAMES[id] }))}
              placeholder="Sucursal..."
              clearable={false}
            />
          )}
        />
      , staggerIdx);
    }

    /* ── RECETAS PENDIENTES DE MI SALA ── */
    // Sin selector de sucursal, por lo mismo que las bitácoras: quien completa
    // el renglón es quien atendió la venta y se acuerda del paciente.
    if (wid === 'recetas_pend') {
      if (!showWidget('recetas_pend', 'dash_recetas_pendientes')) return null;
      return wrapWidget('recetas_pend',
        <WidgetCard title="Recetas pendientes" icon={Pill} category="productos">
          <WidgetRecetasPendientes />
        </WidgetCard>
      , staggerIdx);
    }

    /* ── BITÁCORAS DE MI SALA ── */
    // Sin selector de sucursal, ni con alcance ALL: una bitácora se llena
    // ESTANDO en la sala, con el termómetro delante. Ofrecer «mirá la de Salud
    // 3» desde otra sala invitaría a anotar una lectura que no se tomó — y el
    // ítem 6.1.14 del RTS pide justamente que el registro sea contemporáneo.
    // Para revisar las demás está el módulo, que sí tiene la ranura.
    if (wid === 'bitacoras') {
      if (!showWidget('bitacoras', 'dash_bitacoras')) return null;
      return wrapWidget('bitacoras',
        <WidgetCard title="Bitácoras" icon={Thermometer} category="productos">
          <WidgetBitacoras />
        </WidgetCard>
      , staggerIdx);
    }

    /* ── FACTURAS DE MI SALA ── */
    // Baldosa 1×1 que abre la lista en un modal, como sus hermanas. El selector
    // de sucursal va adentro (en la ranura de herramientas del modal), no en la
    // baldosa: la baldosa es la puerta y solo lleva el número de lo que espera.
    if (wid === 'facturas_sala') {
      if (!showWidget('facturas_sala', 'dash_facturas_sala')) return null;
      const isFactAllScope = getScope('dash_facturas_sala') === 'ALL';
      // Con alcance BRANCH el desplegable ni se ofrece: la base rechaza
      // cualquier sala que no sea la propia, así que un selector prometería un
      // alcance que no existe. Con ALL, elegir sala es todo el sentido.
      const propia = String(user?.branchId ?? user?.branch_id ?? '');
      const factBranch = isFactAllScope ? facturasBranch : propia;
      // Las siete que cargan compras, en el orden en que las nombra el negocio
      // —el de `MM_ERP_ORDER`, no el del maestro—. Filtrar por `type` traería
      // también Administración, que no carga ninguna.
      const factOpts = MM_ERP_ORDER
        .map(erp => Object.keys(MM_BRANCH_TO_ERP).find(b => MM_BRANCH_TO_ERP[b] === erp))
        .map(id => branches.find(b => String(b.id) === String(id)))
        .filter(Boolean)
        .map(b => ({ value: String(b.id), label: b.name }));
      return wrapWidget('facturas_sala',
        <WidgetFacturasSala
          branchId={factBranch ? Number(factBranch) : null}
          selectorSucursal={isFactAllScope && factOpts.length > 0 && (
            <LiquidSelect
              value={facturasBranch}
              onChange={val => setFacturasBranch(val ?? String(SALA_COMPRAS_POR_DEFECTO))}
              options={factOpts}
              placeholder="Sucursal..."
              clearable={false}
            />
          )}
        />
      , staggerIdx);
    }

    /* ── TRASLADOS ENTRE SALAS ── */
    // La otra mitad de la lista de faltantes de Consulta de Inventario: allá se
    // pide lo que no hay, acá la sala que lo tiene confirma. No necesita
    // selector de sucursal — el RLS ya decide qué solicitudes son suyas, y
    // ofrecer un desplegable de salas sugeriría un alcance que no existe.
    if (wid === 'traslados') {
      if (!showWidget('traslados', 'dash_traslados')) return null;
      return wrapWidget('traslados', <WidgetTransferRequests />, staggerIdx);
    }

    /* ── DATOS QUE FALTAN ── */
    // El portal le pide a la sala el dato que le falta para terminar un
    // documento (hoy: el correo de un contribuyente que Hacienda rechazó). Sin
    // selector de sucursal a propósito: el RPC filtra por la sala del empleado,
    // y ofrecer un desplegable sugeriría que se puede contestar por otra —el
    // correo de un cliente que no se tuvo enfrente no se puede averiguar.
    if (wid === 'dato_pedido') {
      if (!showWidget('dato_pedido', 'dash_dato_pedido')) return null;
      return wrapWidget('dato_pedido', <WidgetDatoPedido />, staggerIdx);
    }

    /* ── META DE LA SALA ── */
    /* ── CORTES DE CAJA DE MI SALA ── */
    // La sala confirma acá lo que acaba de cortar, sin ir al módulo. La cifra
    // es el TRAMO y sale del mismo `conTramo` que usa CortesView: dos pantallas
    // que calculan por su cuenta terminan diciendo cosas distintas del mismo
    // corte, y acá eso significaría cobrarle a alguien por una resta que la
    // otra pantalla no hace.
    if (wid === 'cortes_sala') {
      if (!showWidget('cortes_sala', 'dash_cortes_sala')) return null;
      // Con alcance ALL el selector SÍ va: quien ve las seis salas no tiene
      // caja propia y sin él la baldosa no sirve para nada. Con BRANCH no se
      // ofrece — la base rechaza cualquier otra sala y prometería un alcance
      // que no existe (mismo criterio que `facturas_sala` y `meta_sala`).
      const cortesAllScope = getScope('dash_cortes_sala') === 'ALL';
      const cortesOpts = MM_ERP_ORDER
        .map(erp => Object.keys(MM_BRANCH_TO_ERP).find(b => MM_BRANCH_TO_ERP[b] === erp))
        .map(id => branches.find(b => String(b.id) === String(id)))
        .filter(Boolean)
        .map(b => ({ value: String(b.id), label: b.name }));
      return wrapWidget('cortes_sala',
        <WidgetCard title="Cortes de caja" icon={Wallet} category="ventas"
          action={cortesAllScope && cortesOpts.length > 1 && (
            <LiquidSelect
              value={cortesBranch}
              onChange={val => setCortesBranch(val || '')}
              options={cortesOpts}
              placeholder="Todas"
              icon={Building2}
              clearable
              compact
              bare
            />
          )}
        >
          <WidgetCortesSala
            soloMiSala={!cortesAllScope}
            salaElegida={cortesAllScope ? (cortesBranch || null) : null}
          />
        </WidgetCard>
      , staggerIdx);
    }

    /* ── BOLSAS DE EFECTIVO DE MI SALA ── */
    // Lo que pasa DESPUÉS del corte: el efectivo se guarda en una bolsa y espera
    // ahí hasta que alguien lo retira. Va en su propia baldosa y no dentro de la
    // de cortes porque son dos preguntas distintas —«¿confirmé lo que corté?» y
    // «¿cuánto efectivo tengo guardado?»— y las contesta gente en momentos
    // distintos del día.
    if (wid === 'bolsas_sala') {
      if (!showWidget('bolsas_sala', 'dash_bolsas_sala')) return null;
      // Mismo criterio que cortes: con alcance ALL el selector sí va —quien ve
      // las seis salas no tiene caja propia—; con BRANCH no se ofrece, porque la
      // base rechaza cualquier otra sala y prometería un alcance que no existe.
      const bolsasAllScope = getScope('dash_bolsas_sala') === 'ALL';
      const bolsasOpts = MM_ERP_ORDER
        .map(erp => Object.keys(MM_BRANCH_TO_ERP).find(b => MM_BRANCH_TO_ERP[b] === erp))
        .map(id => branches.find(b => String(b.id) === String(id)))
        .filter(Boolean)
        .map(b => ({ value: String(b.id), label: b.name }));
      return wrapWidget('bolsas_sala',
        <WidgetCard title="Bolsas de efectivo" icon={Package} category="ventas"
          action={bolsasAllScope && bolsasOpts.length > 1 && (
            <LiquidSelect
              value={bolsasBranch}
              onChange={val => setBolsasBranch(val || '')}
              options={bolsasOpts}
              placeholder="Todas"
              icon={Building2}
              clearable
              compact
              bare
            />
          )}
        >
          <WidgetBolsasSala
            soloMiSala={!bolsasAllScope}
            salaElegida={bolsasAllScope ? (bolsasBranch || null) : null}
          />
        </WidgetCard>
      , staggerIdx);
    }

    if (wid === 'meta_sala') {
      if (!showWidget('meta_sala', 'dash_meta_sala')) return null;
      // Con scope BRANCH el RPC ignora el parámetro y devuelve su propia sala:
      // el selector ni se ofrece. Con ALL, elegir sala es todo el sentido.
      const isMetaAllScope = getScope('dash_meta_sala') === 'ALL';
      const metaOpts = branches
        .filter(b => META_SALA_IDS.includes(Number(b.id)))
        .sort((a, b) => META_SALA_IDS.indexOf(Number(a.id)) - META_SALA_IDS.indexOf(Number(b.id)))
        .map(b => ({ value: String(b.id), label: b.name }));
      return wrapWidget('meta_sala',
        <WidgetCard title="Meta del mes" icon={Target} category="ventas"
          action={isMetaAllScope && metaOpts.length > 1 && (
            <LiquidSelect
              value={metaBranch}
              onChange={val => setMetaBranch(val ?? String(META_SALA_IDS[0]))}
              options={metaOpts}
              placeholder="Sala..."
              icon={Building2}
              clearable={false}
              compact
              bare
            />
          )}
        >
          {/* `key` por sala: cambiar de sala remonta el widget y el skeleton
              vuelve solo, sin un setState dentro del efecto. */}
          <WidgetMetaSala
            key={metaBranch}
            selectedBranchId={isMetaAllScope ? Number(metaBranch) : null}
            conSelector={isMetaAllScope && metaOpts.length > 1}
          />
        </WidgetCard>
      , staggerIdx);
    }

    /* ── QUIÉN ESTÁ VENDIENDO ── */
    if (wid === 'vendedores') {
      if (!showWidget('vendedores', 'dash_vendedores')) return null;
      // Mismo criterio que la meta: con alcance de una sola sala el RPC ignora
      // el parámetro y devuelve la suya, así que el selector ni se ofrece.
      const isVendAllScope = getScope('dash_vendedores') === 'ALL';
      const vendOpts = branches
        .filter(b => META_SALA_IDS.includes(Number(b.id)))
        .sort((a, b) => META_SALA_IDS.indexOf(Number(a.id)) - META_SALA_IDS.indexOf(Number(b.id)))
        .map(b => ({ value: String(b.id), label: b.name }));
      return wrapWidget('vendedores',
        <WidgetCard title="Venta por vendedor" icon={Users} category="ventas"
          action={isVendAllScope && vendOpts.length > 1 && (
            <LiquidSelect
              value={metaBranch}
              onChange={val => setMetaBranch(val ?? String(META_SALA_IDS[0]))}
              options={vendOpts}
              placeholder="Sala..."
              icon={Building2}
              clearable={false}
              compact
              bare
            />
          )}
        >
          <div className="px-4 pb-4 pt-2 h-full overflow-y-auto overscroll-contain">
            <WidgetVendedores
              key={metaBranch}
              selectedBranchId={isVendAllScope ? Number(metaBranch) : null}
            />
          </div>
        </WidgetCard>
      , staggerIdx);
    }


    return null;
  };

  // Mientras no llegó el canon, una pestaña temática NO se pinta con el orden
  // por defecto: se vería el tablero completo y se reacomodaría solo un segundo
  // después. El esqueleto dice lo mismo sin mentir sobre el acomodo.
  const canonCargando = !acomodoLibre && canon === null;

  // ── Build widget list from explicit positions ──────────────────────────────
  const buildWidgetList = () => {
    if (canonCargando) {
      const cuantos = (TAB_WIDGETS[activeTab] || []).filter(id => id !== 'kpi').length;
      return Array.from({ length: cuantos }).map((_, i) => {
        const id = (TAB_WIDGETS[activeTab] || []).filter(w => w !== 'kpi')[i];
        const def = getWidgetSize(id);
        return (
          <div key={`skel-canon-${i}`} className="animate-stagger-child" style={{
            gridColumnEnd: `span ${esTelefono ? anchoEnTelefono(id) : Math.min(def.minCols, activeCols)}`,
            gridRowEnd: `span ${def.minRows}`,
            '--stagger-delay': `${i * 45}ms`,
          }}>
            <Skel className="w-full h-full rounded-card" />
          </div>
        );
      });
    }

    const sorted = Object.keys(activeLayout).sort((a, b) => {
      const pa = activeLayout[a], pb = activeLayout[b];
      return pa.row !== pb.row ? pa.row - pb.row : pa.col - pb.col;
    });
    const widgets = sorted.map((id, idx) => renderWidget(id, idx));

    // Show skeleton cards for branch sales widgets while branch IDs are loading.
    // Count comes from the saved layout (already in localStorage), so the number
    // of skeletons matches exactly what the user has added. Falls back to
    // branches.length if the layout has none yet (first load with data).
    if (salesBranchIdsLoading && activeTab === 'general' && showWidget('sales', 'dash_sales')) {
      const savedCount = sorted.filter(id => id.startsWith('sales_branch_')).length;
      const skeletonCount = savedCount > 0 ? savedCount : branches.length;
      Array.from({ length: skeletonCount }).forEach((_, i) => {
        widgets.push(
          <div key={`skel-branch-${i}`} className="animate-stagger-child" style={{ '--stagger-delay': `${(sorted.length + i) * 45}ms` }}>
            <SalesBranchSkeleton />
          </div>
        );
      });
    }

    return widgets;
  };

  // ── filtersContent ─────────────────────────────────────────────────────────
  const filtersContent = (
    <div className="flex items-center gap-2">
      <ViewTabBar
        tabs={TABS_VISIBLES.map(t => ({ key: t.id, label: t.label, icon: t.icon }))}
        activeTab={activeTab}
        onTabChange={switchTab}
        showSearch={false}
      />

      {/* Divider */}
      <div className="w-px h-5 bg-divider" />

      {/* Personalizar — py-3 en mobile para alcanzar el touch target de 44px (v2.47.4) */}
      {/* El engranaje giraba 60° al abrir: se conserva con `className` en el
          canónico, porque es la única señal de que el panel quedó abierto
          además del color. */}
      {/* En General —la pestaña propia— «Personalizar» abre el editor en chico:
          ahí adentro están las tres cosas que el panel de abajo hacía por
          separado (encender, acomodar, medir) y además se ve el tablero entero
          sin scrollear. Pedido del usuario.

          En el TELÉFONO sigue abriendo el panel, y no por espacio: con
          `esTelefono` la rejilla ignora `gridColumnStart` y acomoda por orden
          del DOM (ver `wrapWidget`), así que un editor de POSICIONES mostraría
          un tablero que ahí no existe. Lo que sí aplica en el teléfono —el
          tamaño y el encendido— es exactamente lo que el panel ya ofrece.

          En las pestañas temáticas también, porque ahí el panel no personaliza:
          publica el acomodo para todos, que es otro trabajo. */}
      <Button
        aria-expanded={editorEnModal ? undefined : showConfig}
        variant={showConfig && !editorEnModal ? undefined : 'secondary'}
        tone={showConfig && !editorEnModal ? 'brand' : null}
        icon={Settings2}
        className={showConfig && !editorEnModal ? '[&_svg]:rotate-[60deg] [&_svg]:transition-transform [&_svg]:duration-[var(--dur-slow)]' : '[&_svg]:transition-transform [&_svg]:duration-[var(--dur-slow)]'}
        onClick={() => (editorEnModal ? setAcomodarAbierto(true) : setShowConfig(v => !v))}
      >
        Personalizar
      </Button>
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <GlassViewLayout icon={LayoutDashboard} title="Inicio" filtersContent={filtersContent} transparentBody={true}>
      <div className="pb-0 px-2">

        {/* Config panel — configura SIEMPRE la pestaña abierta.
            El `mb-5` no es cosmético: sin él el panel apoyaba contra la primera
            fila de widgets y las dos superficies de vidrio se leían como una
            sola. Es el mismo paso que el `space-y-5` del contenido. */}
        {showConfig && (() => {
          const esGeneral   = activeTab === 'general';
          const etiquetaTab = TABS.find(t => t.id === activeTab)?.label ?? activeTab;
          const tabWidgetIds = TAB_WIDGETS[activeTab] ?? [];
          // Sólo lo que esta persona PUEDE ver (pedido del usuario,
          // 2026-08-10). Antes se listaba el catálogo entero, así que la lista
          // ofrecía encender widgets que su cargo no le deja abrir: el
          // interruptor quedaba en «sí» y en el tablero no aparecía nada. Un
          // control que no controla nada es peor que no tenerlo.
          const tabDefs = WIDGET_DEFS.filter(w =>
            w.id !== 'kpi' && tabWidgetIds.includes(w.id) && canSee(w.permission));
          const sinUbicar = esGeneral ? [] : widgetsSinUbicar(activeTab, canon?.[activeTab]?.orden);
          const rotuloDe = (id) => WIDGET_DEFS.find(w => w.id === id)?.label ?? id;
          return (
            <div data-surface="card" className="animate-in fade-in slide-in-from-top-2 duration-[var(--dur-fast)] p-4 mb-5 space-y-3">
              {/* Header — el nombre de la pestaña va acá, que es lo que la
                  barra de adentro decía sin dejar cambiar nada. */}
              <div className="flex items-center justify-between gap-2 px-1">
                <p className="text-label font-black uppercase tracking-widest text-content-2">
                  Personalizar {etiquetaTab}
                </p>
                {/* Restablecer sólo donde hay algo propio que restablecer: en una
                    pestaña temática que uno no acomoda, no le pertenece nada. */}
                {(esGeneral || isSU) && (
                  <Button variant="secondary" icon={RotateCcw} onClick={() => resetTab(activeTab)}>
                    Restablecer
                  </Button>
                )}
              </div>

              {esGeneral ? (
                <>
                  <Notice variant="neutral" compact>
                    Esta pestaña es tuya: acomoda los widgets, cámbiales el tamaño y elige cuáles quieres ver.
                  </Notice>
                  {/* Widgets for selected tab */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {tabDefs.map(w => {
                      const hasAccess = !w.permission || hasPermission(w.permission, 'can_view');
                      const enabled = isWidgetOn(w.id);
                      const WIcon = w.icon;
                      return (
                        <button key={w.id}
                          aria-pressed={enabled && hasAccess}
                          disabled={!hasAccess}
                          onClick={() => hasAccess && toggleWidget(w.id)}
                          className={`flex items-center gap-2.5 p-3 rounded-2xl border text-left transition-[background-color,border-color] duration-[var(--dur-fast)] ${!hasAccess ? 'opacity-40 cursor-not-allowed bg-surface-card-hover border-divider' : enabled ? 'bg-brand/5 border-brand/20 hover:bg-brand/8' : 'bg-surface-card border-divider hover:bg-surface-card-hover'}`}>
                          <WIcon size={14} className={enabled && hasAccess ? 'text-brand-text' : 'text-content-3'}/>
                          <span className={`text-label font-semibold flex-1 ${enabled && hasAccess ? 'text-content' : 'text-content-3'}`}>{w.label}</span>
                          {/* Indicador, no control: la fila entera ya es el botón.
                              Sin onChange el canónico renderiza un <span> — un
                              <button> anidado sería HTML inválido y una segunda
                              parada de tabulación para la misma acción. */}
                          <Switch checked={enabled && hasAccess} size="sm" />
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : isSU ? (
                <div className="space-y-3">
                  <Notice variant="info">
                    Acomoda <b>{etiquetaTab}</b> como quieres que la vean todos y publícala. A cada cargo se le
                    reacomoda sola, con los widgets que tiene permitidos.
                  </Notice>

                  {sinUbicar.length > 0 && (
                    <Notice variant="warning">
                      {sinUbicar.length === 1
                        ? <>Quedó un widget fuera del acomodo publicado: <b>{rotuloDe(sinUbicar[0])}</b>.</>
                        : <>Quedaron {sinUbicar.length} widgets fuera del acomodo publicado: <b>{sinUbicar.map(rotuloDe).join(', ')}</b>.</>}
                      {' '}Se muestran al final hasta que publiques de nuevo.
                    </Notice>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    {/* Ver como — la lente para revisar antes de publicar. */}
                    <div className="flex items-center gap-2 min-w-[240px]">
                      <Eye size={14} className="text-content-3 shrink-0" />
                      <span className="text-label font-black uppercase tracking-widest text-content-2 shrink-0">Ver como</span>
                      <LiquidSelect
                        compact
                        value={verComoRol ?? ''}
                        onChange={v => setVerComoRol(v === '' || v == null ? null : Number(v))}
                        options={(cargos ?? []).map(c => ({ value: String(c.id), label: c.name }))}
                        placeholder={cargos ? 'Mi vista' : 'Cargando…'}
                        clearLabel="Mi vista"
                        ariaLabel="Ver el tablero como otro cargo"
                        disabled={!cargos}
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      {publicado === activeTab && (
                        <Badge variant="success" tone="soft" size="sm">Publicado</Badge>
                      )}
                      <Button icon={Upload} loading={publicando} onClick={() => publicarAcomodo(activeTab)}>
                        Publicar acomodo
                      </Button>
                    </div>
                  </div>

                  {verComoRol != null && (
                    <Notice variant="neutral" compact icon={Eye}>
                      Estás viendo el tablero con los permisos de otro cargo. Lo que falte es lo que ese cargo no tiene habilitado.
                    </Notice>
                  )}
                </div>
              ) : (
                <Notice variant="neutral" icon={Lock}>
                  El acomodo de <b>{etiquetaTab}</b> es el mismo para toda la empresa, y los widgets que ves
                  son los de tu cargo. Para armar un tablero a tu gusto, usa <b>General</b>.
                </Notice>
              )}
            </div>
          );
        })()}

        {/* Tab content — animates on tab switch */}
        <div key={activeTab} className={`space-y-5 pb-10 ${tabDir === 'right' ? 'animate-tab-enter-right' : 'animate-tab-enter-left'}`}>

        {/* KPI row — content varies by tab */}
        {(()=>{
          const kpiScope = getScope('dash_kpi') !== 'ALL';
          const kpiBranchStr = kpiScope ? userBranchStr : '';
          const kpiEmps = kpiBranchStr
            ? activeEmployees.filter(e => String(e.branchId ?? e.branch_id ?? '') === kpiBranchStr)
            : activeEmployees;
          const kpiPresent = kpiBranchStr
            ? (() => { const ids=new Set(); kpiEmps.forEach(e=>(e.attendance||[]).forEach(a=>{if((a.date||a.timestamp?.split('T')[0])===today) ids.add(e.id);})); return ids.size; })()
            : presentToday;
          const kpiPending = kpiBranchStr
            ? pendingReqs.filter(r => { const emp=employees.find(e=>String(e.id)===String(r.employee_id)); return emp&&String(emp.branchId??emp.branch_id??'')===kpiBranchStr; }).length
            : pendingReqs.length;
          const kpiBranches = kpiBranchStr ? branches.filter(b=>String(b.id)===kpiBranchStr) : branches;
          const kpiBranchAlerts = kpiBranchStr ? branchAlerts.filter(b=>String(b.id)===kpiBranchStr) : branchAlerts;
          const kpiAbsCount = kpiBranchStr
            ? absences.filter(r => { const emp=employees.find(e=>String(e.id)===String(r.employee_id)); return emp&&String(emp.branchId??emp.branch_id??'')===kpiBranchStr; }).length
            : absences.length;
          return (<>
        {showWidget('kpi','dash_kpi') && activeTab === 'general' && (
          employees.length === 0
            ? <div key="kpi-general-skel" className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[0,1,2,3].map(i=><KpiCardSkeleton key={i}/>)}</div>
            : <div key="kpi-general" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard icon={Users}         label="Empleados activos"     value={kpiEmps.length}          color="var(--brand)" onClick={puedeAbrir('/dashboard')?()=>navigate('/dashboard'):undefined}/>
                {/* `0% del total` cuando nadie marcó todavía se lee como un
                    cálculo que falló, no como la hora del día. Un cero con
                    motivo tiene que decir el motivo. */}
                <KpiCard icon={UserCheck}     label="Presentes hoy"         value={kpiPresent}              color="var(--success)" sub={kpiPresent===0?'Sin marcaciones aún':(kpiEmps.length>0?`${Math.round(kpiPresent/kpiEmps.length*100)}% del total`:undefined)}/>
                <KpiCard icon={ClipboardList} label="Solicitudes pendientes" value={kpiPending}              color="var(--warning)" pide={kpiPending>0} sub={kpiPending===0?'Al día':undefined} onClick={puedeAbrir('/requests')?()=>navigate('/requests'):undefined}/>
                <KpiCard icon={Building2}     label="Sucursales"            value={kpiBranches.length}      color={kpiBranchAlerts.length>0?'var(--danger)':'var(--success)'} pide={kpiBranchAlerts.length>0} sub={kpiBranchAlerts.length>0?`${kpiBranchAlerts.length} alerta${kpiBranchAlerts.length>1?'s':''}`:'Sin alertas'} onClick={puedeAbrir('/branches')?()=>navigate('/branches'):undefined}/>
              </div>
        )}
        {showWidget('kpi','dash_kpi') && activeTab === 'comercial' && (
          <div key="kpi-comercial" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon={Receipt}       label="Cotizaciones activas"  value={cotizStats.activas}      color="var(--brand)" sub="últ. 30 días" onClick={puedeAbrir('/cotizaciones')?()=>navigate('/cotizaciones'):undefined}/>
            <KpiCard icon={TrendingUp}    label="Monto cotizado"        value={formatMoney(cotizStats.total, { decimales: 0 })} color="var(--success)" sub="en cotizaciones"/>
            <KpiCard icon={FileText}      label="Documentos hoy"        value={factStats.count}         color="var(--brand-purple)" sub={factStats.count===1?'documento':'documentos'} onClick={puedeAbrir('/facturacion')?()=>navigate('/facturacion'):undefined}/>
            <KpiCard icon={BarChart2}     label="Facturado hoy"         value={formatMoney(factStats.total, { decimales: 0 })} color="var(--warning)" sub="total del día"/>
          </div>
        )}
        {showWidget('kpi','dash_kpi') && activeTab === 'rrhh' && (
          employees.length === 0
            ? <div key="kpi-rrhh-skel" className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[0,1,2,3].map(i=><KpiCardSkeleton key={i}/>)}</div>
            : <div key="kpi-rrhh" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard icon={Users}         label="Empleados activos"     value={kpiEmps.length}          color="var(--brand)"/>
                <KpiCard icon={UserCheck}     label="Presentes hoy"         value={kpiPresent}              color="var(--success)" sub={kpiEmps.length>0?`${Math.round(kpiPresent/kpiEmps.length*100)}% del total`:'0%'}/>
                <KpiCard icon={UserX}         label="Ausencias activas"     value={kpiAbsCount}             color="var(--danger)" sub={kpiAbsCount===0?'Sin ausencias':undefined} onClick={puedeAbrir('/requests')?()=>navigate('/requests'):undefined}/>
                <KpiCard icon={ClipboardList} label="Solicitudes pendientes" value={kpiPending}              color="var(--warning)" sub={kpiPending===0?'Al día':undefined} onClick={puedeAbrir('/requests')?()=>navigate('/requests'):undefined}/>
              </div>
        )}
          </>);
        })()}

        {/* Una pestaña sin nada que mostrar tenía una rejilla vacía y nada más:
            una franja en blanco que se lee como una pantalla a medio cargar. El
            caso habitual ahora es el previsualizador —el cargo elegido no tiene
            ni un widget de esta categoría—, y ahí el vacío es precisamente la
            respuesta que se fue a buscar, así que tiene que decirlo. */}
        {!canonCargando && Object.keys(activeLayout).length === 0 ? (
          <EmptyState
            icon={verComoRol != null ? Eye : LayoutDashboard}
            title={verComoRol != null ? 'Este cargo no ve nada aquí' : 'Todavía no hay nada en esta pestaña'}
            subtitle={verComoRol != null
              ? `${cargos?.find(c => c.id === verComoRol)?.name ?? 'El cargo elegido'} no tiene habilitado ningún widget de ${TABS.find(t => t.id === activeTab)?.label ?? 'esta sección'}.`
              : activeTab === 'general'
                ? 'Abre «Personalizar» y enciende los widgets que quieras ver.'
                : 'Cuando tu cargo tenga widgets habilitados en esta categoría, aparecen aquí.'}
            compact
          />
        ) : (
        /* Main widget grid — 4 cols desktop, 2 cols mobile */
        <div
          ref={gridRef}
          /* Marca la rejilla para la regla táctil de §scroll del tablero
             (index.css): en un dedo las baldosas encadenan como en el iPhone. */
          data-rejilla-widgets=""
          className={`grid gap-4 relative ${isMobile ? 'grid-cols-2' : 'grid-cols-4 min-w-[700px]'}`}
          style={{ gridAutoRows: `${isMobile ? ROW_H_MOVIL : ROW_H}px` }}
        >
          {buildWidgetList()}

          {/* Drop preview — shown while dragging, snaps to grid cell */}
          {dndActive && dndSnap && (
            <div
              style={{
                gridColumnStart: dndSnap.col,
                gridRowStart:    dndSnap.row,
                gridColumnEnd:   `span ${getEffectiveCols(dndActive)}`,
                gridRowEnd:      `span ${getEffectiveRows(dndActive)}`,
                pointerEvents:   'none',
                zIndex: 25,
              }}
              className={`rounded-card border-2 border-dashed transition-colors duration-[var(--dur-fast)] ${dndSnap.valid ? 'border-brand/50 bg-brand/5' : 'border-warning/60 bg-warning/10'}`}
            />
          )}
        </div>
        )}

        </div>{/* end tab content */}
      </div>

      {/* Sales bar tooltip */}
      {salesBarTip && createPortal(
        <div style={{position:'fixed',top:salesBarTip.y-8,left:salesBarTip.x,transform:'translate(-50%,-100%)',zIndex:99999,pointerEvents:'none'}}
          data-surface="tooltip" className="px-2.5 py-1.5 animate-in fade-in zoom-in-95 duration-[var(--dur-fast)] flex flex-col items-center gap-0.5 min-w-[70px]">
          <span className="text-micro text-content-tooltip-2 font-semibold">{salesBarTip.label}</span>
          {salesBarTip.amount&&<span className="text-caption text-success-text font-black">{salesBarTip.amount}</span>}
          {salesBarTip.txCount>0&&<span className="text-micro text-content-tooltip-2 font-semibold">{salesBarTip.txCount} tx</span>}
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 -mt-1 rotate-45" style={{ background: 'var(--tooltip-bg)' }}/>
        </div>,
        document.body
      )}

      {/* Calendar tooltip */}
      {calTooltip && createPortal(
        <div style={{position:'fixed',top:calTooltip.y-10,left:calTooltip.x,transform:'translate(-50%,-100%)',zIndex:99999,pointerEvents:'none'}}
          data-surface="tooltip" className="overflow-hidden max-w-[220px] min-w-[140px] animate-in fade-in zoom-in-95 duration-[var(--dur-fast)]">
          {calTooltip.holidays?.length>0&&(
            <div className="px-3 py-2 border-b border-border-tooltip">
              {calTooltip.holidays.map((h,i)=>(
                <div key={i} className="flex items-center gap-1.5 text-label font-medium text-danger-text">
                  <span>📅</span><span>{h}</span>
                </div>
              ))}
            </div>
          )}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-slate-900"/>
        </div>,
        document.body
      )}

      {/* Drag ghost pill */}
      {dndActive && createPortal(
        <div style={{position:'fixed',left:dndPos.x,top:dndPos.y,transform:'translate(-50%,-50%) rotate(-2deg)',zIndex:99999,pointerEvents:'none'}}
          className="bg-brand text-white text-label font-bold px-4 py-2 rounded-full shadow-2xl flex items-center gap-2 animate-in zoom-in-95 duration-[var(--dur-fast)]">
          <GripVertical size={12}/>
          {getWidgetSize(dndActive).label}
        </div>,
        document.body
      )}

      {/* El tablero en chico. `lazy` como el resto de lo que vive detrás de un
          botón: no tiene que viajar en el chunk de quien nunca personaliza. */}
      {editorEnModal && acomodarAbierto && (
        <Suspense fallback={null}>
          <AcomodarModal
            abierto={acomodarAbierto}
            onCerrar={() => setAcomodarAbierto(false)}
            titulo={TABS.find(t => t.id === activeTab)?.label ?? activeTab}
            columnas={activeCols}
            widgets={catalogoDelModal}
            acomodo={activeLayout}
            medidas={activeSizes}
            minimos={getWidgetSize}
            onAplicar={aplicarAcomodo}
            onRestablecer={() => { resetTab(activeTab); setAcomodarAbierto(false); }}
          />
        </Suspense>
      )}
    </GlassViewLayout>
  );
};

export default DashboardView;
