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
// orden sólo cambia al abrir, nunca mientras se mira. «Hoy» va siempre
// primero.
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import Encabezado, { FotoDeCuenta, saludo } from '../../../componentes/inicio/Encabezado';
import Pestanas from '../../../componentes/inicio/Pestanas';
import useDatosInicio from '../../../componentes/inicio/useDatosInicio';
import { anotar, ordenar } from '../../../componentes/inicio/uso';
import { Hoy, SECCIONES } from '../../../componentes/inicio/Secciones';
import { abrirRuta, abrirSolicitud } from '../../../pantallas';
import { Recarga } from '../../../componentes/inicio/useDato';

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
  // El orden se fija al ENTRAR a la pantalla (no mientras se mira).
  const [orden, setOrden] = useState(() => ordenar(SECCIONES.map((s) => s.id), user?.id));
  useFocusEffect(useCallback(() => { setOrden(ordenar(SECCIONES.map((s) => s.id), user?.id)); }, [user?.id]));

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
    return s && (!s.permiso || [].concat(s.permiso).some((x) => puede(x))) && (!s.visible || s.visible(datos));
  };
  const pestanas = PESTANAS.filter((p) => p.id === 'general' || SECCIONES.some((s) => s.pestanas.includes(p.id) && visibles(s.id)) || puede('dash_kpi'));
  const secciones = orden
    .map((id) => SECCIONES.find((s) => s.id === id))
    .filter((s) => s && s.pestanas.includes(pestana) && visibles(s.id));

  const abrirSeccion = (id, ruta) => { anotar(user?.id, id); abrirRuta(ruta); };

  return (
    <Recarga.Provider value={recarga}>
    <Stack.Screen options={{ title: saludo(user), headerRight: () => <FotoDeCuenta user={user} /> }} />
    <ScrollView style={{ flex: 1 }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 24, gap: 16 }}
      refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); setRecarga((n) => n + 1); await recargar(); setRecargando(false); }} />}>
      <Encabezado sala={nombreSala} />
      <Pestanas opciones={pestanas} activa={pestana} onCambiar={setPestana} />
      {puede('dash_kpi') ? <Hoy pestana={pestana} datos={datos} ctx={{ ...ctx, abrir: (r) => abrirSeccion('hoy', r) }} /> : null}
      {secciones.map(({ id, Componente }) => (
        <Componente key={id} datos={datos} ctx={{ ...ctx, abrir: (r) => abrirSeccion(id, r) }} />
      ))}
    </ScrollView>
    </Recarga.Provider>
  );
}
