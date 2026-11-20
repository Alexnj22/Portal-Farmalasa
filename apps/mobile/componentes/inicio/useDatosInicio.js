// Lo que el Inicio necesita, leído con las funciones del núcleo (las mismas
// del tablero del portal) y sólo lo que el cargo puede ver: una sección sin
// permiso no pide nada.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { contarSolicitudesPendientes, fetchAlertasOperativas, fetchAusenciasDeHoy, fetchCotizacionesActivas, fetchSalesBranchIdsSince, fetchTodayHourlySales, fetchTodayInvoicesSummary } from '@nucleo/data/dashboard';
import { contarCortesPorConfirmar } from '@nucleo/data/cortes';
import { fetchMetaSala } from '@nucleo/data/metas';
import { conTodasLasSalas, empleadosActivos, ventasPorSala } from '@nucleo/utils/inicio';
import { hoySV, sumarDias } from '@nucleo/utils/fecha';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';

const TRASLADOS = ['INVENTORY_TRANSFER_REQUEST'];
const NO_SON_SOLICITUDES = ['INVENTORY_TRANSFER_REQUEST', 'INVENTORY_TRANSFER_PUSH'];

/**
 * Las ventas de hoy de TODAS las salas que venden — las que no han vendido
 * hoy, en cero. Qué salas venden lo dice la última semana, igual que el
 * tablero del portal. Lo usan el Inicio y «Ventas de hoy».
 */
export async function leerVentasDeHoy(fecha) {
  const [{ data, error }, ids] = await Promise.all([
    fetchTodayHourlySales(fecha),
    fetchSalesBranchIdsSince(sumarDias(fecha, -7)).then(({ data: d }) => [...new Set((d || []).map((r) => String(r.branch_id)))]).catch(() => []),
  ]);
  if (error) throw error;
  return conTodasLasSalas(ventasPorSala(data || []), ids);
}

// Una lectura que falla no tumba el Inicio: esa sección queda sin dato.
const suave = (p) => Promise.resolve().then(() => p).catch((e) => { console.warn('inicio', e?.message ?? e); return null; });
// Un `{ data, error }` de supabase que lanza si trae error (así `suave` lo deja en null).
const conError = (p) => Promise.resolve(p).then((r) => { if (r?.error) throw r.error; return r; });

/**
 * Las cotizaciones ACTIVAS, sin ventana de fechas (`fetchCotizacionesActivas`,
 * la misma del portal): `{ n, lista }`, con `n` del conteo exacto y la lista
 * de la más vieja a la más nueva.
 */
async function leerCotizacionesActivas() {
  const { data, count } = await conError(fetchCotizacionesActivas());
  const lista = data || [];
  return { n: count ?? lista.length, lista };
}

/**
 * Quién falta HOY, de la ficha (`fetchAusenciasDeHoy`, como el portal): las
 * ausencias se registran como eventos de la ficha, no como solicitudes.
 * Cada fila es `{ employee_id, clave, hasta }`.
 */
async function leerAusenciasDeHoy(ids) {
  const { filas, error } = await fetchAusenciasDeHoy(ids);
  if (error) throw error;
  return filas;
}

export default function useDatosInicio() {
  const { user, hasPermission, getScope } = useAuth();
  const cargarAsistencia = useStaffStore((s) => s.loadAttendanceLastDays);
  const empleados = useStaffStore((s) => s.employees);
  // Los activos, como el portal: de ellos se pregunta quién falta.
  const idsActivos = useMemo(() => empleadosActivos(empleados || []).map((e) => e.id).sort().join(','), [empleados]);
  // `hoy` desde el primer dibujo: las secciones cuentan «de hoy» antes de que
  // lleguen los datos.
  const [datos, setDatos] = useState(() => ({ hoy: hoySV() }));
  const [cargando, setCargando] = useState(true);
  const puede = useCallback((m, a = 'can_view') => hasPermission(m, a), [hasPermission]);

  const cargar = useCallback(async () => {
    const hoy = hoySV();
    const sala = salaDelUsuario(user);
    const aprueba = ['requests', 'requests_facturacion', 'requests_inventario', 'requests_caja', 'requests_personales', 'requests_minmax']
      .some((m) => puede(m, 'can_approve'));
    const [ventas, solicitudes, traslados, cortes, meta, facturas, cotizaciones, alertasOp] = await Promise.all([
      puede('dash_sales') ? suave(leerVentasDeHoy(hoy)) : null,
      aprueba ? suave(contarSolicitudesPendientes({ excepto: NO_SON_SOLICITUDES })) : null,
      puede('traslados', 'can_approve') ? suave(contarSolicitudesPendientes({ tipos: TRASLADOS })) : null,
      puede('cortes_caja', 'can_edit') ? suave(contarCortesPorConfirmar(hoy)) : null,
      puede('dash_meta_sala') && sala ? suave(fetchMetaSala(sala)) : null,
      puede('dash_facturacion') ? suave(fetchTodayInvoicesSummary(hoy)) : null,
      puede('dash_cotizaciones') || puede('dash_kpi') ? suave(leerCotizacionesActivas()) : null,
      // Cortes sin confirmar, caja de un día anterior sin cerrar, sala sin
      // ventas en 2 h. El juez y el alcance viven en la base.
      puede('dash_branches') || puede('dash_kpi') ? suave(conError(fetchAlertasOperativas()).then(({ data }) => (Array.isArray(data) ? data : []))) : null,
      // Siete días: los usa «Asistencia de la semana».
      suave(cargarAsistencia?.(7)),
    ]);
    // Con alcance TODAS la meta la lee el widget, por la sala que se elija.
    const metaTodas = puede('dash_meta_sala') && getScope?.('dash_meta_sala') === 'ALL';
    setDatos((d) => ({ ...d, hoy, ventas, solicitudes, traslados, cortes, meta, metaTodas, facturas, cotizaciones, alertasOp }));
    setCargando(false);
  }, [user, puede, getScope, cargarAsistencia]);

  // Las ausencias esperan a la plantilla: sin ids no hay a quién preguntar.
  // `undefined` = leyendo; `null` = no se pudo leer.
  const veAusencias = puede('dash_absences') || puede('dash_kpi');
  const cargarAusencias = useCallback(async () => {
    if (!veAusencias || !idsActivos) return;
    const ausencias = await suave(leerAusenciasDeHoy(idsActivos.split(',')));
    setDatos((d) => ({ ...d, ausencias }));
  }, [veAusencias, idsActivos]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { cargarAusencias(); }, [cargarAusencias]);
  const recargar = useCallback(() => Promise.all([cargar(), cargarAusencias()]), [cargar, cargarAusencias]);
  return { datos, cargando, recargar, puede };
}
