// Conexiones, NATIVO — `SesionesView`: quién tiene el portal abierto y en qué
// dispositivos, cuándo se movió por última vez y cuánto aguanta su sesión sin
// uso. Tocar a alguien muestra sus conexiones y deja cerrar una o todas (con
// confirmación); si entre ellas está la propia, la app sale.
//
// Agrupar, describir el dispositivo y el «hace cuánto» salen del núcleo
// (`data/sesiones`), lo mismo del portal. Bloquear a una persona sigue en el
// portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import {
  agruparPorPersona, cerrarSesion, cerrarTodasDe, describirBloqueo, describirDispositivo, describirLimite, diasDesde, fetchSesiones, haceCuanto,
} from '@nucleo/data/sesiones';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

export default function Sesiones() {
  const { hasPermission, logout } = useAuth();
  const puedeCerrar = hasPermission('sesiones', 'can_edit');
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [filtro, setFiltro] = useState('todas');
  const [texto, setTexto] = useState('');
  const [abierta, setAbierta] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error: e } = await fetchSesiones();
    setError(e ? (e.code === '42501' ? 'Tu cargo todavía no tiene acceso a Conexiones.' : 'No se pudo cargar la lista.') : null);
    setFilas(data || []);
  }, []);
  useEffect(() => { cargar(); const t = setInterval(cargar, 60_000); return () => clearInterval(t); }, [cargar]);

  const personas = useMemo(() => agruparPorPersona(filas || []), [filas]);
  const visibles = personas.filter((p) => {
    if (texto.trim() && !tokenMatch(texto.trim(), p.empleado, p.cuenta, p.cargo)) return false;
    const d = diasDesde(p.ultimo_movimiento);
    if (filtro === 'hoy') return d <= 1;
    if (filtro === 'olvidadas') return d > 7;
    return true;
  });
  const vivas = personas.reduce((s, p) => s + p.conexiones.length, 0);

  const cerrar = (persona, conexion) => {
    const todas = !conexion;
    const mia = todas ? persona.tiene_esta : conexion.es_actual;
    Alert.alert(
      todas ? `¿Cerrar las ${persona.conexiones.length} conexiones?` : '¿Cerrar esta conexión?',
      `${shortEmployeeName({ name: persona.empleado })}${mia ? ' — incluye la de este equipo: vas a tener que volver a entrar.' : ''}`,
      [{ text: 'Cancelar', style: 'cancel' }, { text: 'Cerrar', style: 'destructive', onPress: async () => {
        trabajando('Cerrando…');
        const quien = { persona: persona.empleado, cuenta: persona.cuenta };
        const { data, error: e } = todas ? await cerrarTodasDe(persona.ficha_id, quien) : await cerrarSesion(conexion.session_id, quien);
        if (e) { fallo('No se pudo cerrar', 'Vuelve a intentar en un momento.'); return; }
        listo(todas ? `${data} conexiones cerradas` : 'Conexión cerrada', 'Esos dispositivos ya no pueden renovar su acceso.');
        if (mia) { logout(); return; }
        cargar();
      } }],
    );
  };

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Conexiones', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Persona, cuenta o cargo', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Segmentos activa={filtro} onCambiar={setFiltro} opciones={[{ id: 'todas', label: 'Todas' }, { id: 'hoy', label: 'Activas hoy' }, { id: 'olvidadas', label: 'Olvidadas' }]} />
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {filas ? <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${personas.length} persona${personas.length === 1 ? '' : 's'} · ${vivas} conexi${vivas === 1 ? 'ón abierta' : 'ones abiertas'}`}</Text> : null}
        {filas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : visibles.map((p) => {
          const abiertaEsta = abierta === p.ficha_id;
          const bloqueo = describirBloqueo(p.bloqueado_hasta);
          return (
            <Pressable key={p.ficha_id ?? p.cuenta} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierta(abiertaEsta ? null : p.ficha_id); }} style={{ marginHorizontal: 16 }}>
              <Vidrio radio={18} interactivo tinte={p.bloqueado ? 'rgba(240,68,56,0.12)' : undefined}>
                <View style={{ padding: 12, gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Avatar empleado={{ id: p.ficha_id, name: p.empleado, photo: p.foto }} tamano={36} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{shortEmployeeName({ name: p.empleado || p.cuenta })}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>{[p.cargo, haceCuanto(p.ultimo_movimiento)].filter(Boolean).join(' · ')}</Text>
                    </View>
                    <Pildora texto={`${p.conexiones.length}`} color={p.conexiones.length ? MARCA.verde : colorSistema.texto2} />
                  </View>
                  {bloqueo ? <Pildora texto={bloqueo} color={MARCA.rojo} /> : null}
                  {p.tiene_esta ? <Pildora texto="Incluye este equipo" color={MARCA.azulClaro} /> : null}
                  {abiertaEsta ? (
                    <View style={{ gap: 8 }}>
                      {p.conexiones.length ? [...p.conexiones.filter((c) => c.es_actual), ...p.conexiones.filter((c) => !c.es_actual)].slice(0, 30).map((c) => (
                        <View key={c.session_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, paddingTop: 8 }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{`${describirDispositivo(c.agente)}${c.es_actual ? ' · este equipo' : ''}`}</Text>
                            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{[haceCuanto(c.ultimo_uso || c.ultima_renovacion || c.inicio), describirLimite(c.limite_min) ? `se cierra con ${describirLimite(c.limite_min)}` : null].filter(Boolean).join(' · ')}</Text>
                          </View>
                          {puedeCerrar ? (
                            <Pressable onPress={() => cerrar(p, c)} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 }}>
                              <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '600' }}>Cerrar</Text>
                            </Pressable>
                          ) : null}
                        </View>
                      )) : <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Sin conexiones abiertas.</Text>}
                      {p.conexiones.length > 30 ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Y ${p.conexiones.length - 30} más.`}</Text> : null}
                      {puedeCerrar && p.conexiones.length > 1 ? <BotonGrande texto="Cerrar todas" borde color={MARCA.rojo} onPress={() => cerrar(p, null)} /> : null}
                    </View>
                  ) : null}
                </View>
              </Vidrio>
            </Pressable>
          );
        })}
        {filas && !visibles.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>Nadie en este grupo</Text> : null}
        <View style={{ marginHorizontal: 16, marginTop: 8 }}>
          <BotonGrande texto="Bloquear a alguien (portal)" borde color={colorSistema.texto2}
            onPress={() => router.push({ pathname: '/portal', params: { ruta: '/sesiones', nombre: 'Conexiones' } })} />
        </View>
      </ScrollView>
    </>
  );
}
