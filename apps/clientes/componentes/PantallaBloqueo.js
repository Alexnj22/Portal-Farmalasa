// La pantalla de bloqueo: la aurora, el logo y un botón. Al aparecer pide la
// biometría sola; si la persona cancela, queda el botón para volver a intentar.
import { useEffect, useState } from 'react';
import { AppState, Image, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { FullWindowOverlay } from 'react-native-screens';
import Aurora from './Aurora';
import BotonNativo from './BotonNativo';
import { colorSistema } from './sistema';
import { conBiometria, nombreBiometria, useBloqueo } from '../lib/bloqueo';
import { useTema } from '../tema/tema';

const NADA = () => {};

// ENCIMA DE TODO (2026-10-15, auditoría): como una vista más de la raíz, el
// bloqueo quedaba DEBAJO de lo que se presenta aparte —un <Modal> nativo (el
// PDF de una factura, la foto de una receta) o una pantalla `presentation:
// 'modal'` (una oferta)—: se veía y se podía usar con la app «bloqueada», y
// salía así en la foto del selector de apps.
//   · iOS: `FullWindowOverlay` cuelga la capa de la VENTANA, por encima de lo
//     que esté presentado al montarse. Lo que se presente DESPUÉS quedaría
//     arriba; por eso con la app bloqueada no se abre nada (el toque de un
//     aviso espera al desbloqueo, app/_layout.js).
//   · Android: un <Modal> transparente y sin animación es otra ventana, encima
//     de las que ya estaban. Sólo para el BLOQUEO: un Modal le quita el foco a
//     la actividad (el evento `blur`), y la tapa vive justamente de ese evento
//     —como Modal se pondría encima de cada hoja que la app abre y no se iría
//     nunca—. La tapa en Android sigue siendo una vista de la raíz.
function Capa({ modal, children }) {
  if (Platform.OS === 'ios') {
    return <FullWindowOverlay unstable_accessibilityContainerViewIsModal>{children}</FullWindowOverlay>;
  }
  if (Platform.OS === 'android' && modal) {
    // El botón «atrás» no cierra el bloqueo: `onRequestClose` no hace nada.
    return (
      <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent hardwareAccelerated onRequestClose={NADA}>
        {children}
      </Modal>
    );
  }
  return children;
}

export default function PantallaBloqueo({ soloCubrir = false }) {
  const t = useTema();
  const desbloquear = useBloqueo((s) => s.desbloquear);
  // Sin nombrar nada hasta saber qué tiene el teléfono (antes decía «Face ID»
  // un instante también en un Android con huella).
  const [nombre, setNombre] = useState(null);
  useEffect(() => {
    if (soloCubrir) return undefined;
    nombreBiometria().then((n) => n && setNombre(n));
    // Android (2026-10-14) se bloquea al pasar a segundo plano: la pantalla
    // aparece con la app todavía fuera, y una hoja de huella pedida desde ahí
    // el sistema la cancela. Se pide al volver a primer plano.
    if (AppState.currentState === 'active') { desbloquear(); return undefined; }
    const sub = AppState.addEventListener('change', (e) => { if (e === 'active') { sub.remove(); desbloquear(); } });
    return () => sub.remove();
  }, [desbloquear, soloCubrir]);
  return (
    <Capa modal={!soloCubrir}>
      <View style={[StyleSheet.absoluteFill, { zIndex: 100 }]}>
        {/* La tapa no se anima: está para la foto del selector, no para mirarla. */}
        <Aurora activa={!soloCubrir} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 }}>
          <Image source={require('../assets/icono.png')} style={{ width: 84, height: 84, borderRadius: 20 }} />
          <Text style={{ fontSize: 24, fontWeight: '800', color: colorSistema.texto }}>Puntos Salud</Text>
          <Text style={{ fontSize: 15, color: colorSistema.texto2, textAlign: 'center' }}>Está bloqueada para cuidar tu saldo y tu código.</Text>
          {soloCubrir ? null : (
            <View style={{ width: '100%', marginTop: 12 }}>
              <BotonNativo etiqueta={nombre ? `Desbloquear ${conBiometria(nombre)}` : 'Desbloquear'} alTocar={desbloquear} color={t.color.magenta} />
            </View>
          )}
        </View>
      </View>
    </Capa>
  );
}
