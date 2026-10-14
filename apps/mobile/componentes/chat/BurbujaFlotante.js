// La burbuja del chat con clientes, NATIVA — la `BurbujaChat` del portal
// («estilo Messenger»): flota abajo a la derecha, encima de la barra de
// pestañas, con el número de mensajes de clientes que esperan respuesta EN
// VIVO (`useSinLeerDelChat`, el mismo cálculo que el portal) y late cuando ese
// número sube. Tocarla abre la bandeja del chat.
//
// Sólo para quien puede ver el chat (`chat_clientes`), y no aparece donde ya
// está todo (el chat mismo), antes de entrar, ni con el teclado abierto: tapa
// el campo en el que se está escribiendo.
//
// En iPhone es Liquid Glass teñido de la marca; en Android, el botón de acción
// flotante (FAB) de Material: superficie sólida, sombra y onda.
import { memo, useEffect, useState } from 'react';
import { Animated, Keyboard, Platform, Pressable, Text, View } from 'react-native';
import { router, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import { useAuth } from '@nucleo/context/AuthContext';
import { useSinLeerDelChat } from '@nucleo/hooks/useSinLeerDelChat';
import Vidrio from '../Vidrio';
import { MARCA } from '../inicio/marca';
import { iconoDe } from '../../tema/iconos';

const ANDROID = Platform.OS === 'android';
const TAMANO = 56;
// Alto de la barra de pestañas encima del área segura (la flotante de iOS 26
// y la de Material), para que la burbuja quede justo arriba.
const ALTO_PESTANAS = ANDROID ? 80 : 64;

function Numero({ n }) {
  if (!n) return null;
  return (
    <View style={{ position: 'absolute', top: -4, right: -4, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6,
      alignItems: 'center', justifyContent: 'center', backgroundColor: MARCA.rojo, borderWidth: 2, borderColor: '#fff' }}>
      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{n > 99 ? '99+' : n}</Text>
    </View>
  );
}

function BurbujaFlotante() {
  const { user, hasPermission } = useAuth();
  const segmentos = useSegments();
  const abajo = useSafeAreaInsets().bottom;
  const puede = !!user && !!hasPermission?.('chat_clientes', 'can_view');
  const { sinLeer, late } = useSinLeerDelChat({ activo: puede });
  const [teclado, setTeclado] = useState(false);
  const [escala] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const a = Keyboard.addListener(ANDROID ? 'keyboardDidShow' : 'keyboardWillShow', () => setTeclado(true));
    const b = Keyboard.addListener(ANDROID ? 'keyboardDidHide' : 'keyboardWillHide', () => setTeclado(false));
    return () => { a.remove(); b.remove(); };
  }, []);

  // El latido: tres pulsos cuando el número sube.
  useEffect(() => {
    if (!late) return undefined;
    const pulso = Animated.sequence([
      Animated.timing(escala, { toValue: 1.14, duration: 180, useNativeDriver: true }),
      Animated.timing(escala, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]);
    const anim = Animated.loop(pulso, { iterations: 3 });
    anim.start();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    return () => anim.stop();
  }, [late, escala]);

  const raiz = segmentos[0];
  const enElChat = segmentos.some((s) => String(s).startsWith('chat-clientes'));
  // Sólo sobre las pestañas principales: en una ficha o un formulario la
  // burbuja tapaba los botones de abajo (visto en la ficha del mayorista:
  // «Rechazar» quedaba debajo). Es el mismo criterio del portal, que la
  // esconde cuando la vista tiene su barra de acciones abajo.
  const enPestana = raiz === '(tabs)';
  if (!puede || teclado || enElChat || !enPestana) return null;

  const enPestanas = raiz === '(tabs)';
  const etiqueta = sinLeer > 0
    ? `Chat con clientes: ${sinLeer} ${sinLeer === 1 ? 'mensaje' : 'mensajes'} sin responder`
    : 'Chat con clientes';
  const abrir = () => { Haptics.selectionAsync().catch(() => {}); router.push('/chat-clientes'); };
  const icono = <Host matchContents><Icon name={iconoDe('MessageCircle')} size={26} color="#FFFFFF" /></Host>;

  return (
    <Animated.View pointerEvents="box-none"
      style={{ position: 'absolute', right: 16, bottom: abajo + (enPestanas ? ALTO_PESTANAS : 16), transform: [{ scale: escala }] }}>
      {ANDROID ? (
        <View style={{ borderRadius: 16, elevation: 6, backgroundColor: MARCA.azul }}>
          <Pressable onPress={abrir} accessibilityRole="button" accessibilityLabel={etiqueta}
            android_ripple={{ color: 'rgba(255,255,255,0.28)', borderless: false }}
            style={{ width: TAMANO, height: TAMANO, borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {icono}
          </Pressable>
          <Numero n={sinLeer} />
        </View>
      ) : (
        <Pressable onPress={abrir} accessibilityRole="button" accessibilityLabel={etiqueta}>
          {({ pressed }) => (
            <View style={{ transform: [{ scale: pressed ? 0.93 : 1 }] }}>
              <Vidrio radio={TAMANO / 2} interactivo tinte="rgba(0,82,204,0.85)">
                <View style={{ width: TAMANO, height: TAMANO, alignItems: 'center', justifyContent: 'center' }}>{icono}</View>
              </Vidrio>
              <Numero n={sinLeer} />
            </View>
          )}
        </Pressable>
      )}
    </Animated.View>
  );
}

export default memo(BurbujaFlotante);
