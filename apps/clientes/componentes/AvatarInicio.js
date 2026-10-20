// La foto junto al saludo del Inicio (2026-10-20, «agrega la foto para que se
// sienta más personal, y un indicador si no tiene ninguna; al subirla, que
// explique de forma corta para qué se usa»).
//
//   · Con foto: el avatar con el anillo de su nivel; tocarlo abre Cuenta.
//   · Sin foto: las iniciales y una burbuja con una cámara que late un par de
//     veces; tocarlo abre la cámara o la galería con la explicación en una
//     línea (`PARA_QUE_FOTO`) y la vista previa redonda de siempre.
//   · Con la sesión de CÓDIGO no hay foto (como en Cuenta): no se muestra.
import { useState } from 'react';
import { Alert, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Presionable from './Presionable';
import AvatarNivel from './AvatarNivel';
import Icono from './Icono';
import { Latido } from './animacion';
import { usarVistaPreviaFoto } from './VistaPreviaFoto';
import { PARA_QUE_FOTO, subirFotoPerfil, useFotoPerfil } from '../lib/fotoPerfil';
import { navegar } from '../lib/navegar';
import { useTema } from '../tema/tema';

const TAM = 46;

export default function AvatarInicio({ codigo, nombre, material, equipo }) {
  const t = useTema();
  const guardada = useFotoPerfil();
  const [subiendo, setSubiendo] = useState(false);
  const vistaPrevia = usarVistaPreviaFoto();
  const mia = guardada.codigo === codigo;
  const url = mia ? guardada.url : null;

  const tocar = async () => {
    Haptics.selectionAsync().catch(() => {});
    if (url) { navegar('/cuenta'); return; }
    const f = await vistaPrevia.elegir({ titulo: 'Agrega tu foto', mensaje: PARA_QUE_FOTO, circular: true });
    if (!f) return;
    setSubiendo(true);
    const r = await subirFotoPerfil(codigo, f.uri);
    setSubiendo(false);
    if (r?.ok) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    else Alert.alert('No se pudo guardar la foto', r?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.');
  };

  return (
    <>
      <Presionable onPress={tocar} hitSlop={6} accessibilityRole="button"
        accessibilityLabel={url ? 'Tu perfil' : 'Agregar tu foto de perfil'} accessibilityHint={url ? 'Abre Cuenta' : PARA_QUE_FOTO}
        style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.92 : 1 }] })}>
        <AvatarNivel nombre={nombre} material={material} equipo={equipo} uri={url} clave={mia ? guardada.clave : null} tam={TAM} atenuado={subiendo} />
        {!url ? (
          <Latido estilo={{ position: 'absolute', right: -3, bottom: -3 }} escala={1.18}>
            <View style={{ width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
              backgroundColor: t.color.magenta, borderWidth: 2, borderColor: t.oscuro ? '#1C1B22' : '#FFFFFF' }}>
              <Icono sf="camera.fill" respaldo="+" tam={9} color="#FFFFFF" />
            </View>
          </Latido>
        ) : null}
      </Presionable>
      {vistaPrevia.vista}
    </>
  );
}
