// Mis reservas (2026-10-06): lo que el cliente apartó de las ofertas, en qué
// va y hasta cuándo puede retirarlo. Una reserva «lista» muestra la cuenta
// regresiva de las 24 horas; una pendiente o lista se puede cancelar.
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Cargando, Pantalla, Tarjeta, Vacio } from '../componentes/ui';
import { Entrada, Latido } from '../componentes/animacion';
import { colorSistema } from '../componentes/sistema';
import { useSesion } from '../lib/sesion';
import { dolares, fecha } from '../lib/formato';
import { useTema } from '../tema/tema';

const ESTADO = {
  pendiente: { texto: 'Preparando', color: '#B35C00', fondo: 'rgba(255,159,10,0.18)' },
  lista: { texto: 'Lista para retirar', color: '#1E7B34', fondo: 'rgba(52,199,89,0.18)' },
  retirada: { texto: 'Retirada', color: '#4A4552', fondo: 'rgba(120,110,130,0.14)' },
  vencida: { texto: 'Venció', color: '#B3261E', fondo: 'rgba(255,59,48,0.14)' },
  cancelada: { texto: 'Cancelada', color: '#4A4552', fondo: 'rgba(120,110,130,0.14)' },
};

function restante(iso, ahora) {
  const ms = Date.parse(iso) - ahora;
  if (ms <= 0) return 'vence ahora';
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return h ? `quedan ${h} h ${m} min` : `quedan ${m} min`;
}

export default function Reservas() {
  const t = useTema();
  const pedir = useSesion((s) => s.pedir);
  const [d, setD] = useState(null);
  const [ahora, setAhora] = useState(Date.now());
  const cargar = useCallback(() => pedir('mis_reservas').then(setD), [pedir]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  useEffect(() => { const id = setInterval(() => setAhora(Date.now()), 30000); return () => clearInterval(id); }, []);

  const cancelar = (r) => Alert.alert('Cancelar reserva', `¿Cancelar ${r.producto_nombre}?`, [
    { text: 'No', style: 'cancel' },
    { text: 'Cancelar reserva', style: 'destructive', onPress: async () => {
      Haptics.selectionAsync().catch(() => {});
      await pedir('cancelar_reserva', { id: r.id });
      cargar();
    } },
  ]);

  if (!d) return <Cargando />;
  if (!d.ok) return <Pantalla conPestanas={false}><Vacio titulo="Reservas">{d.mensaje}</Vacio></Pantalla>;
  if (!d.reservas.length) {
    return (
      <Pantalla conPestanas={false}>
        <Vacio titulo="Sin reservas">Aparta productos de las ofertas y pásalos a retirar sin hacer fila.</Vacio>
        <Pressable onPress={() => router.push('/ofertas')} style={{ alignSelf: 'center', padding: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: t.color.magentaTexto }}>Ver ofertas</Text>
        </Pressable>
      </Pantalla>
    );
  }
  return (
    <Pantalla conPestanas={false}>
      {d.reservas.map((r, i) => {
        const e = ESTADO[r.estado] ?? ESTADO.pendiente;
        const abierta = r.estado === 'pendiente' || r.estado === 'lista';
        const pill = (
          <View style={{ alignSelf: 'flex-start', backgroundColor: e.fondo, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: e.color }}>{e.texto}</Text>
          </View>
        );
        return (
          <Entrada key={r.id} indice={Math.min(i, 8)}>
            <Tarjeta tono={r.estado === 'lista' ? t.color.verde : undefined} estilo={{ gap: 8, opacity: abierta ? 1 : 0.75 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                {r.estado === 'lista' ? <Latido>{pill}</Latido> : pill}
                <Text style={{ fontSize: 12, fontWeight: '700', color: colorSistema.texto3, fontVariant: ['tabular-nums'] }}>{r.codigo}</Text>
              </View>
              <Text style={{ fontSize: 17, fontWeight: '800', color: colorSistema.texto }}>{r.cantidad} × {r.producto_nombre}</Text>
              <Text style={{ fontSize: 14, color: colorSistema.texto2 }}>
                {r.sala}{r.precio_unitario != null ? ` · ${dolares(r.precio_unitario * r.cantidad)} al retirar` : ''}
              </Text>
              {r.estado === 'lista' && r.vence_at ? (
                <Text style={{ fontSize: 15, fontWeight: '800', color: '#1E7B34' }}>Retírala: {restante(r.vence_at, ahora)}</Text>
              ) : null}
              {r.estado === 'pendiente' ? (
                <Text style={{ fontSize: 14, color: colorSistema.texto2 }}>Te avisamos cuando esté lista{r.oferta_fin ? ` · oferta hasta el ${fecha(r.oferta_fin)}` : ''}.</Text>
              ) : null}
              {abierta ? (
                <Pressable onPress={() => cancelar(r)} hitSlop={8} style={{ alignSelf: 'flex-start', paddingVertical: 6 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: colorSistema.rojo }}>Cancelar reserva</Text>
                </Pressable>
              ) : null}
            </Tarjeta>
          </Entrada>
        );
      })}
    </Pantalla>
  );
}
