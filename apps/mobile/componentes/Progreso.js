// La capa de progreso de una acción que viene de una notificación (o de un
// botón de una tarjeta): «Aprobando…» con la rueda, y al terminar un
// «✓ Aprobada» con vibración, o el motivo si no se pudo.
//
// Existe porque el usuario lo pidió el 2026-09-30: al apretar «Aprobar» la app
// se abría y no se veía nada —ni que estaba trabajando ni en qué terminó— y la
// alerta de resultado se perdía mientras la app arrancaba. Una capa que se
// monta UNA vez en la raíz no depende de qué pantalla esté abierta.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import { colorSistema } from './Formulario';

const i = (ios, android) => Icon.select({ ios, android });
const OK = i('checkmark.circle.fill', require('@expo/material-symbols/check_circle.xml'));
const MAL = i('exclamationmark.triangle.fill', require('@expo/material-symbols/warning.xml'));

let actual = null;
const oyentes = new Set();
let cierre = null;

const publicar = (e) => { actual = e; oyentes.forEach((f) => f(e)); };

/** Empieza: la rueda con un texto («Aprobando anulación…»). */
export function trabajando(texto) {
  clearTimeout(cierre);
  publicar({ estado: 'trabajando', texto });
}

/** Termina bien: se cierra sola. */
export function listo(titulo, texto) {
  clearTimeout(cierre);
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  publicar({ estado: 'ok', titulo, texto });
  cierre = setTimeout(() => publicar(null), 2200);
}

/** Termina mal: queda hasta que se toca, porque el motivo hay que leerlo. */
export function fallo(titulo, texto) {
  clearTimeout(cierre);
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  publicar({ estado: 'error', titulo, texto });
}

export function cerrarProgreso() { clearTimeout(cierre); publicar(null); }

export function CapaDeProgreso() {
  const [e, setE] = useState(actual);
  useEffect(() => { oyentes.add(setE); return () => { oyentes.delete(setE); }; }, []);
  if (!e) return null;
  const color = e.estado === 'ok' ? colorSistema.verde : colorSistema.rojo;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={cerrarProgreso}>
      <Pressable onPress={e.estado === 'trabajando' ? undefined : cerrarProgreso}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <View style={{ backgroundColor: colorSistema.fila, borderRadius: 22, paddingVertical: 24, paddingHorizontal: 22, minWidth: 240, maxWidth: 320, alignItems: 'center', gap: 12 }}>
          {e.estado === 'trabajando'
            ? <ActivityIndicator size="large" />
            : <Host matchContents><Icon name={e.estado === 'ok' ? OK : MAL} size={44} color={color} /></Host>}
          {e.titulo ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center' }}>{e.titulo}</Text> : null}
          {e.texto ? <Text style={{ color: colorSistema.texto2, fontSize: 15, textAlign: 'center' }}>{e.texto}</Text> : null}
          {e.estado === 'error' ? <Text style={{ color: colorSistema.acento, fontSize: 15, marginTop: 4 }}>Toca para cerrar</Text> : null}
        </View>
      </Pressable>
    </Modal>
  );
}
