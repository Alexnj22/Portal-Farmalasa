// La baldosa de una sala en «Ventas de hoy» — la misma del tablero del portal
// (`sales_branch_<id>` en DashboardView): nombre, cuánto lleva vendido, y una
// barra por hora cuya ALTURA son los tickets y cuyo COLOR dice qué tan cargada
// estuvo esa hora (muerta · normal · pico · crítica, `nivelDeVolumen` del
// núcleo, colores `--txvol-*` de los tokens). La hora en curso lleva un punto
// verde que late.
//
// Pedido del usuario del 2026-09-30: «los elementos son como widgets, así que
// deben ser interactivos o al menos como funcionan en el portal». Tocarla abre
// la sala en «Ventas de hoy».
import { useEffect, useRef } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import tokens from '@nucleo/constants/tokens.json';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { nivelDeVolumen } from '@nucleo/utils/inicio';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';

const T = tokens.temas.dark;
export const COLOR_VOLUMEN = {
  muerta: T['txvol-muerta'], normal: T['txvol-normal'], pico: T['txvol-pico'], critica: T['txvol-critica'],
};
export const VERDE = '#12B76A';

const corta = (h) => (h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`);

function Latido() {
  const v = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0.3, duration: 700, useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [v]);
  return <Animated.View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: VERDE, opacity: v, marginBottom: 2 }} />;
}

/**
 * @param sala    { branchId, total, tickets, ticketsPorHora } de `ventasPorSala`
 * @param nombre  el de la sala
 * @param desde   hora de la primera barra (7)
 */
export default function MiniSala({ sala, nombre, desde = 7, alto = 46, onPress, activa = false }) {
  const tickets = sala.ticketsPorHora ?? [];
  const max = Math.max(1, ...tickets);
  const ahora = new Date().getHours();
  const paso = Math.max(1, Math.ceil(tickets.length / 5));
  const vendio = sala.total > 0;

  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress?.(); }}
      style={({ pressed }) => ({ flex: 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <Vidrio radio={20} interactivo tinte={activa ? 'rgba(18,183,106,0.22)' : undefined}>
        <View style={{ padding: 12, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13, fontWeight: '700' }} numberOfLines={1}>{nombre}</Text>
          </View>
          <Text style={{ color: vendio ? colorSistema.texto : colorSistema.texto2, fontSize: 19, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: -4 }}
            numberOfLines={1} adjustsFontSizeToFit>
            {vendio ? formatMoney(sala.total) : 'Sin ventas'}
          </Text>

          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 1.5, height: alto }}>
            {tickets.map((t, i) => {
              const h = desde + i;
              const esAhora = h === ahora;
              return (
                <View key={i} style={{ flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center' }}>
                  {esAhora ? <Latido /> : null}
                  <View style={{
                    width: '100%', borderTopLeftRadius: 2, borderTopRightRadius: 2,
                    height: t > 0 ? Math.max(3, (t / max) * (alto - 8)) : 2,
                    backgroundColor: COLOR_VOLUMEN[nivelDeVolumen(t)], opacity: t > 0 ? 1 : 0.35,
                  }} />
                </View>
              );
            })}
          </View>
          {/* Los rótulos van puestos en su hora y no en una columna cada uno:
              una columna mide ~10px y cortaba «10a» en «1…». */}
          <View style={{ height: 12, marginTop: -4 }}>
            {tickets.map((_, i) => {
              const h = desde + i;
              const mostrar = h === ahora || (i % paso === 0 && Math.abs(h - ahora) > 1);
              if (!mostrar) return null;
              return (
                <Text key={i} style={{ position: 'absolute', left: `${((i + 0.5) / tickets.length) * 100}%`, width: 28, marginLeft: -14,
                  fontSize: 10, textAlign: 'center', color: h === ahora ? VERDE : colorSistema.texto2, fontWeight: h === ahora ? '700' : '500' }}>
                  {corta(h)}
                </Text>
              );
            })}
          </View>
          <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
            {sala.tickets} ticket{sala.tickets === 1 ? '' : 's'}
          </Text>
        </View>
      </Vidrio>
    </Pressable>
  );
}

/** Dos por renglón, como las baldosas del tablero. */
export function RejillaDeSalas({ salas, nombre, onElegir, activa }) {
  const filas = [];
  for (let i = 0; i < salas.length; i += 2) filas.push(salas.slice(i, i + 2));
  return (
    <View style={{ gap: 10 }}>
      {filas.map((par) => (
        <View key={par[0].branchId} style={{ flexDirection: 'row', gap: 10 }}>
          {par.map((s) => (
            <MiniSala key={s.branchId} sala={s} nombre={nombre(s.branchId)} activa={activa === s.branchId}
              onPress={() => onElegir(s.branchId)} />
          ))}
          {par.length === 1 ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
    </View>
  );
}

/** La leyenda de colores, arriba de las barras (igual que el portal). */
export function LeyendaDeVolumen() {
  const N = [['muerta', 'Muerta'], ['normal', 'Normal'], ['pico', 'Pico'], ['critica', 'Crítica']];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {N.map(([k, l]) => (
        <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: COLOR_VOLUMEN[k] }} />
          <Text style={{ color: colorSistema.texto2, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' }}>{l}</Text>
        </View>
      ))}
    </View>
  );
}
