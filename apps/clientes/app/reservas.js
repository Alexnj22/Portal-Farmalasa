// Mis reservas (2026-10-06): lo que el cliente apartó de las ofertas, en qué
// va y hasta cuándo puede retirarlo. Una reserva «lista» muestra la cuenta
// regresiva de las 24 horas; una pendiente o lista se puede cancelar.
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Cargando, Pantalla, Tarjeta, Vacio } from '../componentes/ui';
import Icono from '../componentes/Icono';
import { Entrada, Latido } from '../componentes/animacion';
import { colorSistema } from '../componentes/sistema';
import { useSesion } from '../lib/sesion';
import { dolares, fecha } from '../lib/formato';
import { useTema } from '../tema/tema';

const ESTADO = {
  pendiente: { texto: 'Preparando', color: '#B35C00', fondo: 'rgba(255,159,10,0.18)' },
  lista: { texto: '¡Lista para retirar!', color: '#1E7B34', fondo: 'rgba(52,199,89,0.2)' },
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
  const abiertas = d.reservas.filter((r) => r.estado === 'pendiente' || r.estado === 'lista');
  const cerradas = d.reservas.filter((r) => r.estado !== 'pendiente' && r.estado !== 'lista');
  return (
    <Pantalla conPestanas={false}>
      {abiertas.map((r, i) => (
        <Entrada key={r.id} indice={Math.min(i, 8)}>
          <ReservaAbierta r={r} ahora={ahora} alCancelar={() => cancelar(r)} />
        </Entrada>
      ))}
      {cerradas.length ? (
        <Text style={{ fontSize: 13, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: colorSistema.texto2, marginLeft: 4, marginTop: 8 }}>Anteriores</Text>
      ) : null}
      {cerradas.map((r, i) => {
        const e = ESTADO[r.estado] ?? ESTADO.cancelada;
        return (
          <Entrada key={r.id} indice={Math.min(abiertas.length + i, 8)}>
            <Tarjeta estilo={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Icono sf={r.estado === 'retirada' ? 'checkmark.circle.fill' : 'xmark.circle'} respaldo="•" tam={22} color={e.color} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: colorSistema.texto }} numberOfLines={1}>{r.cantidad} × {r.producto_nombre}</Text>
                <Text style={{ fontSize: 13, color: colorSistema.texto3 }}>{e.texto} · {r.sala} · {fecha(String(r.cerrada_at ?? r.created_at).slice(0, 10))}</Text>
              </View>
            </Tarjeta>
          </Entrada>
        );
      })}
    </Pantalla>
  );
}

// Una reserva en curso: lo que se reservó, dónde, cuánto se paga y en qué paso
// va (Recibida → Lista → Retirada), con la cuenta regresiva cuando está lista.
function ReservaAbierta({ r, ahora, alCancelar }) {
  const t = useTema();
  const lista = r.estado === 'lista';
  const e = ESTADO[r.estado];
  const pasos = ['Recibida', 'Lista', 'Retirada'];
  const actual = lista ? 1 : 0;
  return (
    <Tarjeta tono={lista ? t.color.verde : undefined} estilo={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        {lista ? <Latido><Pildora e={e} /></Latido> : <Pildora e={e} />}
        <Text style={{ fontSize: 13, fontWeight: '800', color: colorSistema.texto3, fontVariant: ['tabular-nums'] }}>{r.codigo}</Text>
      </View>

      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 20, fontWeight: '800', color: colorSistema.texto, letterSpacing: -0.3 }}>{r.producto_nombre}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icono sf="storefront" respaldo="🏪" tam={14} color={colorSistema.texto2} />
          <Text style={{ fontSize: 14, color: colorSistema.texto2 }}>{r.sala}</Text>
        </View>
      </View>

      {/* Los pasos: dónde va la reserva. */}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {pasos.map((p, i) => (
          <View key={p} style={{ flex: i < pasos.length - 1 ? 1 : 0, flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ alignItems: 'center', gap: 4 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
                backgroundColor: i <= actual ? (lista ? '#34C759' : t.color.magenta) : (t.oscuro ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)') }}>
                {i <= actual ? <Icono sf="checkmark" respaldo="✓" tam={11} color="#FFFFFF" /> : null}
              </View>
              <Text style={{ fontSize: 11, fontWeight: i === actual ? '800' : '600', color: i <= actual ? colorSistema.texto : colorSistema.texto3 }}>{p}</Text>
            </View>
            {i < pasos.length - 1 ? (
              <View style={{ flex: 1, height: 2, marginHorizontal: 6, marginBottom: 16, borderRadius: 1,
                backgroundColor: i < actual ? (lista ? '#34C759' : t.color.magenta) : (t.oscuro ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)') }} />
            ) : null}
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <View style={{ gap: 2 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: colorSistema.texto3 }}>{r.cantidad} {r.cantidad === 1 ? 'UNIDAD' : 'UNIDADES'} · PAGAS AL RETIRAR</Text>
          {r.precio_unitario != null ? (
            <Text style={{ fontSize: 24, fontWeight: '900', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{dolares(r.precio_unitario * r.cantidad)}</Text>
          ) : null}
        </View>
        {lista && r.vence_at ? (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: colorSistema.texto3 }}>PARA RETIRARLA</Text>
            <Text style={{ fontSize: 16, fontWeight: '900', color: t.oscuro ? '#7EE08F' : '#1E7B34' }}>{restante(r.vence_at, ahora)}</Text>
          </View>
        ) : null}
      </View>

      {!lista ? (
        <Text style={{ fontSize: 14, lineHeight: 20, color: colorSistema.texto2 }}>
          La sucursal la está preparando. Te avisamos cuando esté lista{r.oferta_fin ? `; la oferta vale hasta el ${fecha(r.oferta_fin)}` : ''}.
        </Text>
      ) : null}

      <Pressable onPress={alCancelar} hitSlop={8} style={{ alignSelf: 'flex-start' }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: colorSistema.rojo }}>Cancelar reserva</Text>
      </Pressable>
    </Tarjeta>
  );
}

function Pildora({ e }) {
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: e.fondo, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Text style={{ fontSize: 12, fontWeight: '800', color: e.color }}>{e.texto}</Text>
    </View>
  );
}
