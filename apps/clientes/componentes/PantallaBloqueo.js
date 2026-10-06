// La pantalla de bloqueo: la aurora, el logo y un botón. Al aparecer pide la
// biometría sola; si la persona cancela, queda el botón para volver a intentar.
import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Aurora from './Aurora';
import BotonNativo from './BotonNativo';
import { colorSistema } from './sistema';
import { nombreBiometria, useBloqueo } from '../lib/bloqueo';
import { useTema } from '../tema/tema';

export default function PantallaBloqueo({ soloCubrir = false }) {
  const t = useTema();
  const desbloquear = useBloqueo((s) => s.desbloquear);
  const [nombre, setNombre] = useState('Face ID');
  useEffect(() => {
    if (soloCubrir) return;
    nombreBiometria().then((n) => n && setNombre(n));
    desbloquear();
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
            <BotonNativo etiqueta={`Desbloquear con ${nombre}`} alTocar={desbloquear} color={t.color.magenta} />
          </View>
        )}
      </View>
    </View>
  );
}
