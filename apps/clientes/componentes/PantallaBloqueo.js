// La pantalla de bloqueo: la aurora, el logo y un botón. Al aparecer pide la
// biometría sola; si la persona cancela, queda el botón para volver a intentar.
import { useEffect, useState } from 'react';
import { AppState, Image, StyleSheet, Text, View } from 'react-native';
import Aurora from './Aurora';
import BotonNativo from './BotonNativo';
import { colorSistema } from './sistema';
import { conBiometria, nombreBiometria, useBloqueo } from '../lib/bloqueo';
import { useTema } from '../tema/tema';

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
    <View style={[StyleSheet.absoluteFill, { zIndex: 100 }]}>
      <Aurora />
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
  );
}
