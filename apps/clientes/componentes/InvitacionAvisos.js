// Invitación a encender los avisos y a recibir promociones (2026-11-27).
//
// Medido ese día: de 54 clientes con sesión, sólo 10 tenían avisos y 8
// aceptaban promociones. La guía de bienvenida ofrece los avisos UNA vez y
// casi todos la pasaban; 38 nunca respondieron lo de promociones (entraron con
// una ficha que ya existía). Decisión del usuario: pedirlo al entrar.
//
// Reglas para no molestar:
//   · Como mucho 3 veces y con 7 días entre una y otra (`almacen`, por teléfono).
//   · Avisos: no a quien los apagó a propósito en este teléfono (CLAVE_AVISOS = '0').
//   · Promociones: sólo a quien nunca respondió (null). Un «no» se respeta.
//   · Nunca a la sesión de código: el servidor no le deja encender avisos.
//   · En el navegador, sólo si puede recibirlos y el permiso no está negado.
// Cada interruptor guarda al momento, con las mismas acciones que Cuenta.
import { useEffect, useState } from 'react';
import { Alert, Linking, Platform, Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Haptics from 'expo-haptics';
import { Tarjeta, Texto, Titulo } from './ui';
import { FilaInterruptor, colorSistema } from './sistema';
import Presionable from './Presionable';
import { leer, guardar } from '../lib/almacen';
import { CLAVE_AVISOS, estadoAvisosWeb, pedirTokenDeAvisos, recordarAvisos } from '../lib/avisos';
import { useSesion } from '../lib/sesion';
import { useTema } from '../tema/tema';

const CLAVE = 'invitacion_avisos';
const VECES = 3;
const ESPERA = 7 * 86_400_000;
const AJUSTES = 'Activa las notificaciones en los ajustes del teléfono.';

export default function InvitacionAvisos({ resumen, conCodigo, alGuardar }) {
  const t = useTema();
  const pedir = useSesion((s) => s.pedir);
  const [toca, setToca] = useState(false);
  const [apagadoAqui, setApagadoAqui] = useState(true);
  const [guardando, setGuardando] = useState(null);
  const [local, setLocal] = useState({});
  const [cerrada, setCerrada] = useState(false);

  const promos = resumen?.consentimiento?.promociones ?? null;
  const web = estadoAvisosWeb();
  const webPuede = !web || (web.soportado && web.permiso !== 'denied');
  const faltanAvisos = resumen?.acepta_avisos !== true && !apagadoAqui && webPuede;
  const faltanPromos = promos === null;
  const hayQuePedir = !conCodigo && !!resumen && !resumen.pendiente && (faltanAvisos || faltanPromos);

  // ¿Le toca hoy? Se decide una vez por apertura, y se cuenta al mostrarla.
  useEffect(() => {
    let vivo = true;
    (async () => {
      const recordado = await SecureStore.getItemAsync(CLAVE_AVISOS).catch(() => null);
      if (!vivo) return;
      setApagadoAqui(recordado === '0');
      const r = (await leer(CLAVE)) ?? { veces: 0, ultima: 0 };
      if (!vivo) return;
      setToca(Number(r.veces) < VECES && Date.now() - Number(r.ultima) >= ESPERA);
    })();
    return () => { vivo = false; };
  }, []);

  const visible = toca && hayQuePedir && !cerrada;
  const [contada, setContada] = useState(false);
  useEffect(() => {
    if (!visible || contada) return;
    setContada(true);
    leer(CLAVE).then((r) => guardar(CLAVE, { veces: Number(r?.veces ?? 0) + 1, ultima: Date.now() }));
  }, [visible, contada]);

  if (!visible) return null;

  async function avisos(valor) {
    if (guardando || !valor) return;
    setGuardando('avisos');
    setLocal((x) => ({ ...x, avisos: true }));
    const r = await pedirTokenDeAvisos().catch(() => ({ error: 'No se pudieron activar los avisos. Intenta más tarde.' }));
    if (r.error) {
      setLocal((x) => ({ ...x, avisos: false }));
      setGuardando(null);
      // En iPhone, negado una vez, el sistema ya no vuelve a preguntar: a Ajustes.
      if (r.error === AJUSTES && Platform.OS !== 'web') {
        Alert.alert('Activa las notificaciones', 'Están apagadas para esta app. Enciéndelas en Ajustes.', [
          { text: 'Ahora no', style: 'cancel' },
          { text: 'Abrir Ajustes', onPress: () => { Linking.openSettings().catch(() => {}); } },
        ]);
      } else Alert.alert('No se activaron', r.error);
      return;
    }
    const g = await pedir('avisos', { acepta: true, push_token: r.token, formato: r.formato, responde: !!r.responde });
    if (g?.ok) {
      await recordarAvisos(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } else {
      setLocal((x) => ({ ...x, avisos: false }));
      Alert.alert('No se guardó', g?.mensaje ?? 'Puedes activarlas después en Cuenta.');
    }
    setGuardando(null);
    alGuardar?.();
  }

  async function promociones(valor) {
    if (guardando) return;
    setGuardando('promos');
    setLocal((x) => ({ ...x, promos: valor }));
    const g = await pedir('permisos', { promociones: valor });
    if (!g?.ok) {
      setLocal(({ promos: _, ...resto }) => resto);
      Alert.alert('No se guardó', g?.mensaje ?? 'Puedes cambiarlo después en Cuenta.');
    } else Haptics.selectionAsync().catch(() => {});
    setGuardando(null);
    alGuardar?.();
  }

  return (
    <Tarjeta>
      <Titulo>No te pierdas nada</Titulo>
      <Texto nivel={2}>Te avisamos cuando ganes puntos, cuando tu reserva esté lista y cuando haya ofertas.</Texto>
      <View style={{ marginHorizontal: -16 }}>
        {faltanAvisos || local.avisos ? (
          <FilaInterruptor titulo="Notificaciones" detalle="En este teléfono."
            valor={local.avisos ?? false} alCambiar={avisos} color={t.color.magenta} />
        ) : null}
        {faltanPromos || 'promos' in local ? (
          <FilaInterruptor titulo="Promociones" detalle="Ofertas y descuentos para ti."
            valor={local.promos ?? false} alCambiar={promociones} color={t.color.magenta} />
        ) : null}
      </View>
      <Presionable onPress={() => setCerrada(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Ahora no"
        style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: colorSistema.texto2 }}>Ahora no</Text>
      </Presionable>
    </Tarjeta>
  );
}
