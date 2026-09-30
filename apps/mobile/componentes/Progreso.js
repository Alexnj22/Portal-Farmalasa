// El aviso de una acción (aprobar, rechazar, enviar, recibir…), a la manera
// del sistema. Reporte del usuario del 2026-09-30: «el aviso de aprobado al
// confirmar o rechazar no se ve nativo, se ve raro» — era una caja oscura en
// medio de la pantalla que la oscurecía entera.
//
//   · trabajando — una cápsula de vidrio arriba, con la rueda del sistema. No
//                  oscurece ni bloquea: la pantalla sigue a la vista.
//   · listo      — vibración de éxito y la misma cápsula con ✓; se va sola,
//                  como el «Copiado» del iPhone.
//   · fallo      — la alerta NATIVA del sistema (UIAlertController en
//                  iPhone), porque el motivo hay que leerlo y cerrarlo.
//
// Se monta UNA vez en la raíz, así que funciona desde cualquier pantalla —
// también cuando la acción viene de una notificación con la app arrancando.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import Vidrio from './Vidrio';
import { colorSistema } from './Formulario';

const OK = Icon.select({ ios: 'checkmark.circle.fill', android: require('@expo/material-symbols/check_circle.xml') });

let actual = null;
const oyentes = new Set();
let cierre = null;

const publicar = (e) => { actual = e; oyentes.forEach((f) => f(e)); };

/** Empieza: la cápsula con la rueda («Aprobando…»). */
export function trabajando(texto) {
  clearTimeout(cierre);
  publicar({ estado: 'trabajando', texto });
}

/** Termina bien: vibra, muestra ✓ y se va sola. */
export function listo(titulo, texto) {
  clearTimeout(cierre);
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  publicar({ estado: 'ok', titulo, texto });
  cierre = setTimeout(() => publicar(null), 2000);
}

/** Termina mal: la alerta del sistema, que se cierra con «Aceptar». */
export function fallo(titulo, texto) {
  clearTimeout(cierre);
  publicar(null);
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  Alert.alert(titulo || 'No se pudo', texto || undefined, [{ text: 'Aceptar' }]);
}

export function cerrarProgreso() { clearTimeout(cierre); publicar(null); }

export function CapaDeProgreso() {
  const [e, setE] = useState(actual);
  const [ultimo, setUltimo] = useState(actual);
  const margen = useSafeAreaInsets();
  const y = useRef(new Animated.Value(-140)).current;
  useEffect(() => { oyentes.add(setE); return () => { oyentes.delete(setE); }; }, []);
  useEffect(() => {
    if (e) setUltimo(e);   // lo último que se mostró sigue a la vista mientras sube
    Animated.spring(y, { toValue: e ? 0 : -140, useNativeDriver: true, damping: 18, stiffness: 180 }).start();
  }, [e, y]);
  if (!ultimo) return null;
  return (
    <Animated.View pointerEvents="none"
      style={{ position: 'absolute', top: margen.top + 6, left: 0, right: 0, alignItems: 'center', transform: [{ translateY: y }] }}>
      <Vidrio radio={26}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingVertical: 12, maxWidth: 340 }}>
          {ultimo.estado === 'trabajando'
            ? <ActivityIndicator />
            : <Host matchContents><Icon name={OK} size={22} color={colorSistema.verde} /></Host>}
          <View style={{ flexShrink: 1 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>
              {ultimo.estado === 'trabajando' ? ultimo.texto : ultimo.titulo}
            </Text>
            {ultimo.estado === 'ok' && ultimo.texto ? (
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={2}>{ultimo.texto}</Text>
            ) : null}
          </View>
        </View>
      </Vidrio>
    </Animated.View>
  );
}
