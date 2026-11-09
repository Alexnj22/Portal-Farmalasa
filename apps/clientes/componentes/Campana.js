// La campana del encabezado de cada pestaña (2026-11-09).
import { useCallback } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { create } from 'zustand';
import Presionable from './Presionable';
import Icono from './Icono';
import { colorSistema } from './sistema';
import { useCuenta } from '../lib/cuenta';
import { useSesion } from '../lib/sesion';
import { alLlegarAviso } from '../lib/avisos';
import { navegar } from '../lib/navegar';
import { useTema } from '../tema/tema';

// El número es UNO para todas las pestañas: con un estado por pestaña, la que
// se montó antes de la consulta se quedaba sin contador hasta el minuto siguiente.
const useSinLeer = create((set) => ({ n: 0, poner: (n) => set({ n }), sumar: () => set((s) => ({ n: s.n + 1 })) }));
let campanaAt = 0;
let campanaGen = -1;
// Al cerrar sesión vuelve a cero: el número no puede pasar a la cuenta siguiente.
useSesion.subscribe((s, antes) => {
  if (antes.token && !s.token) { useSinLeer.getState().poner(0); campanaAt = 0; campanaGen = -1; }
});
// Una sola suscripción: con una por campana, cada aviso sumaba cinco.
alLlegarAviso((a) => {
  if (a?.tipo && a.tipo !== 'chat') useSinLeer.getState().sumar();
});

export default function Campana() {
  const t = useTema();
  const generacion = useCuenta((s) => s.generacion);
  const pedir = useSesion((s) => s.pedir);
  const sinLeer = useSinLeer((s) => s.n);
  // Al volver a una pestaña, a lo sumo una vez por minuto; con un resumen nuevo, siempre.
  useFocusEffect(useCallback(() => {
    if (generacion === campanaGen && Date.now() - campanaAt < 60_000) return;
    campanaGen = generacion; campanaAt = Date.now();
    pedir('bandeja').then((r) => { if (r?.ok) useSinLeer.getState().poner(r.sin_leer ?? 0); });
  }, [pedir, generacion]));
  // Abrir la bandeja los marca leídos: la campana se apaga ya.
  const abrirBandeja = () => { useSinLeer.getState().poner(0); navegar('/notificaciones'); };
  return (
    // Sin fondo propio: la barra del sistema ya le pone el suyo al botón.
    <Presionable onPress={abrirBandeja} hitSlop={10} accessibilityRole="button"
      accessibilityLabel={sinLeer ? `Notificaciones, ${sinLeer} sin leer` : 'Notificaciones'}
      style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.92 : 1 }] })}>
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
