// Borrar mi cuenta (2026-11-11). Antes era una alerta con tres párrafos y
// tres botones: en Android los botones se desplazaban dentro de la hoja y en
// iPhone la letra chica de la alerta casi no se leía (usuario: «los botones no
// se ven bien, hacen scroll y es raro, y en ios el texto casi no se lee»).
// Ahora es una pantalla: lo que se borra, lo que se conserva y lo de los
// puntos, con letra normal, y los dos botones al final. Confirmar sigue
// siendo un paso aparte, corto.
//
// La lista es la misma de la cláusula 10 del aviso de privacidad y de
// `borrarLoPersonal` (app-clientes). Se mueven juntas.
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import * as Haptics from 'expo-haptics';
import Icono from '../componentes/Icono';
import BotonNativo from '../componentes/BotonNativo';
import { Pantalla, Seccion, Tarjeta } from '../componentes/ui';
import { colorSistema } from '../componentes/sistema';
import { useSesion } from '../lib/sesion';
import { olvidarEntrada } from '../lib/entradaGuardada';
import { useTema } from '../tema/tema';

const SE_BORRA = [
  'Se cierra la sesión en todos tus teléfonos y dejas de recibir avisos.',
  'Tu registro en la app, tu foto de perfil y tu código para invitar.',
  'Tus conversaciones con la farmacia y la calificación que les diste.',
  'Los correos que guardaste para tus facturas y las novedades que viste.',
  'Las fotos de recetas que no se usaron.',
  'Tu tarjeta de Apple Wallet deja de actualizarse y la de Google Wallet queda vencida.',
  'Las reservas que no pagaste se cancelan. Las que pagaste siguen en pie.',
];
const SE_CONSERVA = [
  'Tu ficha de cliente con tus compras y facturas.',
  'La receta de un medicamento que ya retiraste.',
];

function Lista({ filas, sf, color }) {
  return filas.map((f) => (
    <View key={f} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <View style={{ paddingTop: 2 }}><Icono sf={sf} respaldo="•" tam={16} color={color} /></View>
      <Text style={{ flex: 1, fontSize: 16, lineHeight: 22, color: colorSistema.texto }}>{f}</Text>
    </View>
  ));
}

export default function BorrarCuenta() {
  const t = useTema();
  const { pedir, cerrar } = useSesion(useShallow((x) => ({ pedir: x.pedir, cerrar: x.cerrar })));
  const [borrando, setBorrando] = useState(false);
  // Un hex, no el color del sistema: el botón de SwiftUI recibe el tinte como
  // texto y `PlatformColor` no lo es.
  const rojo = t.acentos.rojo.fuerte;

  const borrar = async (retirar) => {
    if (borrando) return;
    setBorrando(true);
    const r = await pedir('borrar_cuenta', { retirar_permisos: retirar === true });
    if (r?.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await olvidarEntrada();
      await cerrar();
      return;
    }
    setBorrando(false);
    Alert.alert('No se pudo borrar la cuenta', r?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.');
  };
  const confirmar = (retirar) => Alert.alert(
    retirar ? '¿Borrar tu cuenta y dejar de acumular puntos?' : '¿Borrar tu cuenta?',
    'No se puede deshacer.',
    [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: () => borrar(retirar) },
    ],
  );

  return (
    <Pantalla conPestanas={false} conBurbuja={false}>
      <Text style={{ fontSize: 16, lineHeight: 22, color: colorSistema.texto2 }}>
        Antes de borrar tu cuenta, esto es lo que pasa.
      </Text>

      <Seccion>Se borra</Seccion>
      <Tarjeta estilo={{ gap: 12 }}>
        <Lista filas={SE_BORRA} sf="xmark.circle.fill" color={colorSistema.rojo} />
      </Tarjeta>

      <Seccion>Se conserva, porque la ley lo exige</Seccion>
      <Tarjeta estilo={{ gap: 12 }}>
        <Lista filas={SE_CONSERVA} sf="checkmark.circle.fill" color={t.color.verdeTexto} />
      </Tarjeta>

      <Seccion>Tus puntos</Seccion>
      <Tarjeta estilo={{ gap: 10 }}>
        <Text style={{ fontSize: 16, lineHeight: 22, color: colorSistema.texto }}>
          Siguen ahí. Si compras con tu DUI sigues acumulando, y puedes volver a entrar cuando quieras.
        </Text>
        <Text style={{ fontSize: 16, lineHeight: 22, color: colorSistema.texto }}>
          Si además quieres dejar de acumular, elige «Borrar y dejar de acumular puntos»: tu saldo queda en pausa
          (no vence ni se puede canjear) y dejas de recibir promociones, hasta que vuelvas a aceptarlo.
        </Text>
      </Tarjeta>

      <View style={{ gap: 12, marginTop: 8 }}>
        <View style={{ minHeight: 52, justifyContent: 'center' }}>
          <BotonNativo etiqueta={borrando ? 'Un momento…' : 'Borrar mi cuenta'} alTocar={() => confirmar(false)}
            variante="filled" deshabilitado={borrando} color={rojo} />
        </View>
        <View style={{ minHeight: 48, justifyContent: 'center' }}>
          <BotonNativo etiqueta="Borrar y dejar de acumular puntos" alTocar={() => confirmar(true)}
            variante="text" deshabilitado={borrando} color={rojo} />
        </View>
      </View>
    </Pantalla>
  );
}
