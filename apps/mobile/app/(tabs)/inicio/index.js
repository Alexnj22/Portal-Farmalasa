// Inicio, NATIVO (pedido del usuario del 2026-09-30). Hasta ese día era el
// tablero del portal incrustado.
//
// De arriba abajo: el saludo (personal y compacto), las pestañas del portal
// (General · Comercial · RRHH · Operación: «para tener acceso a todo
// siempre»), los números del día y las secciones de esa pestaña. Todo en
// vidrio sobre la aurora de la app.
//
// Las secciones APRENDEN: cada toque se anota y, al abrir el Inicio, las que
// más se usaron en las últimas semanas suben (`utils/ordenPorUso.js`). El
// orden se calcula UNA vez, al abrir la app: antes se recalculaba al volver de
// un widget y la tarjeta que se acababa de tocar saltaba de sitio (2026-11-09,
// «se mueve de un solo»). «Hoy» va siempre primero.
//
// Los widgets que la persona apagó (en el portal o en «Personalizar el
// Inicio», que se abre al final) no salen: es la misma preferencia
// (`user_dashboard_prefs.widgets`).
import { useCallback, useMemo, useState } from 'react';
import { LayoutAnimation, Pressable, RefreshControl, ScrollView, Text } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { leer, guardar } from '@plataforma/almacen';
import { fetchUserDashboardPrefs } from '@nucleo/data/dashboard';
import { colorSistema } from '../../../componentes/Formulario';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import Encabezado, { saludo } from '../../../componentes/inicio/Encabezado';
import Segmentos from '../../../componentes/Segmentos';
import FijoArriba from '../../../componentes/FijoArriba';
import useDatosInicio from '../../../componentes/inicio/useDatosInicio';
import { anotar, ordenar } from '../../../componentes/inicio/uso';
import { Hoy, SECCIONES, WIDGET_WEB } from '../../../componentes/inicio/Secciones';
import { abrirRuta, abrirSolicitud } from '../../../pantallas';
import { Recarga } from '../../../componentes/inicio/useDato';
import FranjaDelPortal from '../../../componentes/FranjaDelPortal';

const PESTANAS = [
  { id: 'general', label: 'General' },
  { id: 'comercial', label: 'Comercial' },
  { id: 'rrhh', label: 'RRHH' },
  { id: 'operacion', label: 'Operación' },
];

export default function Inicio() {
  const { user, getScope } = useAuth();
  const empleados = useStaffStore((s) => s.employees);
  const sucursales = useStaffStore((s) => s.branches);
  const comunicados = useStaffStore((s) => s.announcements);
  const { datos, recargar, puede } = useDatosInicio();
  const [pestana, setPestana] = useState('general');
  const [recargando, setRecargando] = useState(false);
  // El orden se fija al abrir la app y no se mueve durante la sesión.
  const [orden] = useState(() => ordenar(SECCIONES.map((s) => s.id), user?.id));
  // Los apagados se releen al volver (de «Personalizar el Inicio», por ejemplo).
  // Arranca con lo último que se supo: si esperara a la base, los widgets
  // apagados se pintarían un instante y desaparecerían empujando todo.
  const claveApagados = `inicio.apagados.${user?.id ?? 'anon'}`;
  const [apagados, setApagados] = useState(() => {
    try { return new Set(JSON.parse(leer(claveApagados) || '[]')); } catch { return new Set(); }
  });
  useFocusEffect(useCallback(() => {
    let vivo = true;
    if (user?.id) {
      Promise.resolve(fetchUserDashboardPrefs(user.id)).then(({ data }) => {
        if (!vivo) return;
        const ids = (Array.isArray(data?.widgets) ? data.widgets : []).filter((w) => w.enabled === false).map((w) => w.id);
        try { guardar(claveApagados, JSON.stringify(ids)); } catch { /* sin almacén: sólo no se recuerda */ }
        setApagados((antes) => (antes.size === ids.length && ids.every((id) => antes.has(id)) ? antes : new Set(ids)));
      }).catch(() => {});
    }
    return () => { vivo = false; };
  }, [user?.id, claveApagados]));

  const sala = salaDelUsuario(user);
  const nombreSala = (sucursales || []).find((b) => String(b.id) === String(sala))?.name;

  const ctx = useMemo(() => ({
    empleados: empleados || [], sucursales, comunicados, sala, puede,
    alcanceSala: getScope?.('dash_kpi') !== 'ALL',
    alcanceSalaVentas: getScope?.('dash_sales') !== 'ALL',
    abrir: abrirRuta, abrirSolicitud, getScope,
  }), [empleados, sucursales, comunicados, sala, puede, getScope]);
  // Deslizar hacia abajo sube este número y los widgets vuelven a leer.
  const [recarga, setRecarga] = useState(0);

  // Una pestaña sólo aparece si tiene algo que mostrar para este cargo.
  const visibles = (id) => {
    const s = SECCIONES.find((x) => x.id === id);
    return s && !(WIDGET_WEB[s.id] && apagados.has(WIDGET_WEB[s.id])) && (!s.permiso || [].concat(s.permiso).some((x) => puede(x))) && (!s.visible || s.visible(datos));
  };
  const pestanas = PESTANAS.filter((p) => p.id === 'general' || SECCIONES.some((s) => s.pestanas.includes(p.id) && visibles(s.id)) || puede('dash_kpi'));
  const secciones = orden
    .map((id) => SECCIONES.find((s) => s.id === id))
    .filter((s) => s && s.pestanas.includes(pestana) && visibles(s.id));

  const abrirSeccion = (id, ruta) => { anotar(user?.id, id); abrirRuta(ruta); };

  return (
    <Recarga.Provider value={recarga}>
    {/* El control segmentado del sistema, como en el resto de la app (las
        píldoras sólo cuando los rótulos no caben: lo decide `Segmentos`), y
        fijo arriba al desplazar (2026-11-11). */}
    {pestanas.length > 1 ? (
      <FijoArriba>
        <Segmentos opciones={pestanas} activa={pestana} onCambiar={(p) => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setPestana(p); }} />
      </FijoArriba>
    ) : null}
    <ScrollView style={{ flex: 1 }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 24, gap: 16 }}
      refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); setRecarga((n) => n + 1); await recargar(); setRecargando(false); }} />}>
      <FranjaDelPortal />
      <Encabezado sala={nombreSala} saludo={saludo(user)} />
      {puede('dash_kpi') ? <Hoy pestana={pestana} datos={datos} ctx={{ ...ctx, abrir: (r) => abrirSeccion('hoy', r) }} /> : null}
      {secciones.map(({ id, Componente }) => (
        <Componente key={id} datos={datos} ctx={{ ...ctx, abrir: (r) => abrirSeccion(id, r) }} />
      ))}
      <Pressable onPress={() => router.push('/personalizar-inicio')} hitSlop={8} accessibilityRole="button"
        style={({ pressed }) => ({ alignSelf: 'center', minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.55 : 1 })}>
        <Text style={{ color: colorSistema.acento, fontSize: 15, fontWeight: '600' }}>Personalizar el Inicio</Text>
      </Pressable>
    </ScrollView>
    </Recarga.Provider>
  );
}
