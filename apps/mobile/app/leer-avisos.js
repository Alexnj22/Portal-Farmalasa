// Los avisos sin leer, al entrar (2026-11-11, usuario: «que salgan al iniciar
// sesión, así se obliga a leerlos»). Antes ni la app ni el portal los
// mostraban solos: quedaban en Mis avisos y nadie entraba (en los últimos 60
// días, menos de un lector por aviso).
//
// Uno por pantalla, urgentes primero (el orden del mazo de Mis avisos), sin
// forma de cerrarla: cada uno se confirma con «Entendido», que lo marca leído
// con la MISMA escritura de Mis avisos (`markAnnouncementAsRead`). Si la marca
// falla (sin señal) se avisa y se sigue: el aviso vuelve a salir la próxima
// vez, mejor que dejar a alguien encerrado sin poder trabajar.
//
// Lo abre `useAvisosAlEntrar` (app/(tabs)/_layout.js) una vez por sesión.
import { useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { comunicadosDeLaPersona, destinoDelComunicado, yaLoLeyo } from '@nucleo/utils/misComunicados';
import { fechaTexto } from '@nucleo/utils/fecha';
import Vidrio from '../componentes/Vidrio';
import Boton from '../componentes/Boton';
import ConAurora from '../componentes/ConAurora';
import { colorSistema } from '../componentes/Formulario';
import { MARCA } from '../componentes/inicio/marca';

export function avisosSinLeer(comunicados, user, roles) {
  if (!user) return [];
  return comunicadosDeLaPersona(comunicados || [], user, roles || []).filter((a) => !yaLoLeyo(a, user.id));
}

export default function LeerAvisos() {
  const { user } = useAuth();
  const comunicados = useStaffStore((s) => s.announcements);
  const roles = useStaffStore((s) => s.roles);
  const marcar = useStaffStore((s) => s.markAnnouncementAsRead);
  // La lista se fija al abrir: al marcar uno, el store lo saca y el índice se correría.
  const inicial = useRef(null);
  if (inicial.current === null) inicial.current = avisosSinLeer(comunicados, user, roles);
  const lista = inicial.current;
  const [i, setI] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const a = lista[i];

  const salir = () => (router.canGoBack() ? router.back() : router.replace('/inicio'));
  const entendido = async () => {
    if (!a) return salir();
    setOcupado(true);
    let ok = false;
    try { ok = await marcar(a.id, user.id); } catch { ok = false; }
    setOcupado(false);
    if (!ok) Alert.alert('No se pudo guardar', 'Sin conexión: este aviso volverá a salir la próxima vez que entres.');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (i + 1 < lista.length) setI(i + 1); else salir();
  };

  const urgente = a?.priority === 'URGENT';
  const fecha = useMemo(() => (a?.createdAt ? fechaTexto(a.createdAt) : ''), [a?.createdAt]);
  if (!a) return null;
  return (
    <ConAurora>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false, presentation: 'fullScreenModal' }} />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={{ paddingHorizontal: 20, paddingTop: 12, gap: 4 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 28, fontWeight: '800' }}>
            {lista.length === 1 ? 'Tienes un aviso' : `Tienes ${lista.length} avisos`}
          </Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>
            {`Léelo y confírmalo para seguir · ${i + 1} de ${lista.length}`}
          </Text>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
          <Vidrio radio={22}>
            <View style={{ padding: 18, gap: 12 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {urgente ? <Etiqueta texto="Urgente" color={MARCA.rojo} /> : null}
                <Etiqueta texto={destinoDelComunicado(a)} color={MARCA.violeta} />
              </View>
              <Text style={{ color: colorSistema.texto, fontSize: 21, fontWeight: '700' }}>{a.title}</Text>
              <Text style={{ color: colorSistema.texto, fontSize: 17, lineHeight: 24 }}>{a.message}</Text>
              {fecha ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{fecha}</Text> : null}
            </View>
          </Vidrio>
        </ScrollView>
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <Boton onPress={entendido} ocupado={ocupado}>{i + 1 < lista.length ? 'Entendido · siguiente' : 'Entendido'}</Boton>
        </View>
      </SafeAreaView>
    </ConAurora>
  );
}

function Etiqueta({ texto, color }) {
  if (!texto) return null;
  return (
    <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: color }}>
      <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>{texto}</Text>
    </View>
  );
}
