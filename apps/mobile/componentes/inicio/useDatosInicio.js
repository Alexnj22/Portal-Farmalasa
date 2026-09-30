// Lo que el Inicio necesita, leído con las funciones del núcleo (las mismas
// del tablero del portal) y sólo lo que el cargo puede ver: una sección sin
// permiso no pide nada.
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { contarSolicitudesPendientes, fetchActiveLeaveRequests, fetchRecentCotizaciones, fetchTodayHourlySales, fetchTodayInvoicesSummary } from '@nucleo/data/dashboard';
import { contarCortesPorConfirmar } from '@nucleo/data/cortes';
import { fetchMetaSala } from '@nucleo/data/metas';
import { ausenciasDelDia, ventasPorSala } from '@nucleo/utils/inicio';
import { hoySV, sumarDias } from '@nucleo/utils/fecha';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';

const TRASLADOS = ['INVENTORY_TRANSFER_REQUEST'];
const NO_SON_SOLICITUDES = ['INVENTORY_TRANSFER_REQUEST', 'INVENTORY_TRANSFER_PUSH'];

// Una lectura que falla no tumba el Inicio: esa sección queda sin dato.
const suave = (p) => Promise.resolve().then(() => p).catch((e) => { console.warn('inicio', e?.message ?? e); return null; });

export default function useDatosInicio() {
  const { user, hasPermission } = useAuth();
  const cargarAsistencia = useStaffStore((s) => s.loadAttendanceLastDays);
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
    const [ventas, solicitudes, traslados, cortes, meta, ausencias, facturas, cotizaciones] = await Promise.all([
      puede('dash_sales') ? suave(fetchTodayHourlySales(hoy).then(({ data, error }) => { if (error) throw error; return ventasPorSala(data || []); })) : null,
      aprueba ? suave(contarSolicitudesPendientes({ excepto: NO_SON_SOLICITUDES })) : null,
      puede('traslados', 'can_approve') ? suave(contarSolicitudesPendientes({ tipos: TRASLADOS })) : null,
      puede('cortes_caja', 'can_edit') ? suave(contarCortesPorConfirmar(hoy)) : null,
      puede('dash_meta_sala') && sala ? suave(fetchMetaSala(sala)) : null,
      puede('dash_absences') || puede('dash_kpi') ? suave(fetchActiveLeaveRequests().then((f) => ausenciasDelDia(f || [], hoy))) : null,
      puede('dash_facturacion') ? suave(fetchTodayInvoicesSummary(hoy)) : null,
      puede('dash_cotizaciones') ? suave(fetchRecentCotizaciones(sumarDias(hoy, -30)).then(({ data }) => (data || []).filter((c) => c.status === 'ACTIVA'))) : null,
      suave(cargarAsistencia?.(1)),
    ]);
    setDatos({ hoy, ventas, solicitudes, traslados, cortes, meta, ausencias, facturas, cotizaciones });
    setCargando(false);
  }, [user, puede, cargarAsistencia]);

  useEffect(() => { cargar(); }, [cargar]);
  return { datos, cargando, recargar: cargar, puede };
}
