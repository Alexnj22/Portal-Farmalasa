// «¿Sigues ahí?» — el aviso previo al cierre por inactividad, como el del
// portal (`AvisoDeInactividad.jsx`). CUÁNDO sale lo decide la sesión
// (`useAvisoDeSesion` del `AuthProvider`, el mismo código de la web): un minuto
// antes de cerrarse. Esto sólo lo dibuja.
//
// Un solo botón, como allá: cualquier forma de descartarlo —el botón, el gesto
// de atrás de Android— significa lo mismo, que hay alguien. Quien quiera salir
// tiene «Salir» de siempre.
import { useEffect, useState } from 'react';
import { Modal, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useAvisoDeSesion } from '@nucleo/context/AuthContext';
import { colorSistema } from './Formulario';
import { BotonGrande } from './formulario/Piezas';
import { MARCA } from './inicio/marca';
import Vidrio from './Vidrio';

export default function AvisoDeInactividad() {
  const { hasta, seguir } = useAvisoDeSesion() ?? {};
  const [restante, setRestante] = useState(0);

  useEffect(() => {
    if (!hasta) return undefined;
    const calcular = () => setRestante(Math.max(0, Math.ceil((hasta - Date.now()) / 1000)));
    calcular();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    const t = setInterval(calcular, 1000);
    return () => clearInterval(t);
  }, [hasta]);

  if (!hasta) return null;
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => seguir?.()}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <Vidrio radio={26} style={{ width: '100%', maxWidth: 380 }}>
          <View style={{ padding: 22, gap: 14 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>¿Sigues ahí?</Text>
            <Text style={{ color: colorSistema.texto, fontSize: 16, lineHeight: 22 }}>
              {'Vamos a cerrar tu sesión en '}
              <Text style={{ fontWeight: '800', color: MARCA.ambar }}>{`${restante} segundo${restante === 1 ? '' : 's'}`}</Text>
              {' porque nadie ha usado la app.'}
            </Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Lo que no hayas guardado se va a perder.</Text>
            <BotonGrande texto="Sigo aquí" onPress={() => seguir?.()} />
          </View>
        </Vidrio>
      </View>
    </Modal>
  );
}
