// La campana del encabezado de cada pestaña (2026-11-09).
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Presionable from './Presionable';
import Icono from './Icono';
import { colorSistema } from './sistema';
import { useCuenta } from '../lib/cuenta';
import { useSesion } from '../lib/sesion';
import { alLlegarAviso } from '../lib/avisos';
import { navegar } from '../lib/navegar';
import { useTema } from '../tema/tema';

// La campana: abre la bandeja; el número son los avisos sin leer.
let campanaAt = 0;
let campanaUltimo = 0;
let campanaGen = -1;
// Al cerrar sesión la campana vuelve a cero (2026-11-04): el número es de
// módulo y sobrevivía a la sesión — quien entraba después veía, hasta la
// próxima consulta, los avisos sin leer de la cuenta anterior.
useSesion.subscribe((s, antes) => {
  if (antes.token && !s.token) { campanaUltimo = 0; campanaAt = 0; campanaGen = -1; }
});
export default function Campana() {
  const t = useTema();
  const generacion = useCuenta((s) => s.generacion);
  const pedir = useSesion((s) => s.pedir);
  const [sinLeer, setSinLeer] = useState(campanaUltimo);
  // Al volver a la pestaña, a lo sumo una vez por minuto; con un resumen nuevo
  // (deslizar para refrescar), siempre.
  useFocusEffect(useCallback(() => {
    if (generacion === campanaGen && Date.now() - campanaAt < 60_000) return;
    campanaGen = generacion; campanaAt = Date.now();
    pedir('bandeja').then((r) => { if (r?.ok) { campanaUltimo = r.sin_leer ?? 0; setSinLeer(campanaUltimo); } });
  }, [pedir, generacion]));
  // Un aviso que llega con la app abierta suma uno al instante, sin esperar
  // al minuto de la próxima consulta.
  // Sólo los push que van a la BANDEJA (2026-11-04): traen `tipo` y no son
  // del chat (el chat tiene su propio punto y no entra a la bandeja). Los
  // recordatorios de toma son locales y sin `tipo`: antes cada uno sumaba.
  useEffect(() => alLlegarAviso((a) => {
    if (!a?.tipo || a.tipo === 'chat') return;
    campanaUltimo += 1; setSinLeer(campanaUltimo);
  }), []);
  // Abrir la bandeja los marca leídos: la campana se apaga ya, no al minuto.
  const abrirBandeja = () => { campanaUltimo = 0; setSinLeer(0); navegar('/notificaciones'); };
  return (
    <Presionable onPress={abrirBandeja} hitSlop={10} accessibilityRole="button"
      accessibilityLabel={sinLeer ? `Notificaciones, ${sinLeer} sin leer` : 'Notificaciones'}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
        backgroundColor: t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)', transform: [{ scale: pressed ? 0.92 : 1 }] })}>
      <Icono sf={sinLeer ? 'bell.badge' : 'bell'} respaldo="🔔" tam={21} color={t.color.magentaTexto} />
      {sinLeer ? (
        <View style={{ position: 'absolute', top: 4, right: 4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
          backgroundColor: colorSistema.rojo, alignItems: 'center', justifyContent: 'center' }}>
          <Text maxFontSizeMultiplier={1.2} style={{ color: '#FFF', fontSize: 11, fontWeight: '800' }}>{sinLeer > 9 ? '9+' : sinLeer}</Text>
        </View>
      ) : null}
    </Presionable>
  );
}
