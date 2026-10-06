// La bandeja: los avisos que ya te llegaron al teléfono, para verlos otra vez
// (pedido del usuario, 2026-10-06). Salen de `app_cliente_avisos`, la misma
// bitácora que impide mandar dos veces; al abrir la bandeja se marcan leídos.
// Tocar uno lleva a donde llevaba el aviso.
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icono from '../componentes/Icono';
import { router, useFocusEffect } from 'expo-router';
import { Cargando, Pantalla, Tarjeta, Vacio } from '../componentes/ui';
import { Entrada } from '../componentes/animacion';
import { colorSistema } from '../componentes/sistema';
import { useSesion } from '../lib/sesion';
import { suave, useTema } from '../tema/tema';

// SF Symbols del sistema (respaldo de texto fuera de iPhone).
const ICONO = {
  ganado: ['star.fill', '★'], cumpleanos: ['birthday.cake.fill', '🎂'], vence: ['hourglass', '⏳'],
  inyeccion: ['syringe.fill', '+'], oferta: ['tag.fill', '%'], reserva: ['bag.fill', '•'],
};

function cuando(iso) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}

export default function Notificaciones() {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const pedir = useSesion((s) => s.pedir);
  const [d, setD] = useState(null);
  const [refrescando, setRefrescando] = useState(false);
  const cargar = useCallback(async () => {
    const r = await pedir('bandeja');
    setD((ant) => (r?.ok || !ant?.ok ? r : ant));
    if (r?.ok && r.sin_leer) pedir('bandeja_leida');
  }, [pedir]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  const refrescar = async () => { setRefrescando(true); await cargar(); setRefrescando(false); };

  if (!d) return <Cargando />;
  if (!d.ok) {
    return <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}><Vacio titulo="No se pudieron cargar">Revisa tu conexión y desliza hacia abajo para reintentar.</Vacio></Pantalla>;
  }
  if (!d.avisos?.length) {
    return <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}><Vacio titulo="Sin notificaciones">Aquí verás tus puntos ganados, ofertas y recordatorios.</Vacio></Pantalla>;
  }
  // Una lista virtual: hasta 50 avisos en vidrio no se pintan todos de una vez.
  return (
    <FlatList
      data={d.avisos}
      keyExtractor={(a) => String(a.id)}
      contentInsetAdjustmentBehavior="automatic"
      initialNumToRender={8}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} />}
      contentContainerStyle={{ padding: 16, paddingBottom: ins.bottom + 24, gap: 12, width: '100%', maxWidth: 560, alignSelf: 'center' }}
      renderItem={({ item: a, index: i }) => {
        const [sf, respaldo] = ICONO[a.tipo] ?? ['bell.fill', '•'];
        return (
          <Entrada indice={Math.min(i, 6)}>
            <Pressable disabled={!a.url} onPress={() => a.url && router.push(a.url)} accessibilityRole={a.url ? 'button' : undefined}
              accessibilityLabel={`${a.titulo}. ${a.cuerpo}`}
              style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}>
              <Tarjeta tono={!a.leido_at ? t.color.magenta : undefined} estilo={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: suave(t.color.magenta, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                  <Icono sf={sf} respaldo={respaldo} tam={19} color={t.color.magentaTexto} />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <Text style={{ flex: 1, fontSize: 16, fontWeight: '700', color: colorSistema.texto }}>{a.titulo}</Text>
                    <Text style={{ fontSize: 12, color: colorSistema.texto3 }}>{cuando(a.created_at)}</Text>
                  </View>
                  <Text style={{ fontSize: 15, lineHeight: 20, color: colorSistema.texto2 }}>{a.cuerpo}</Text>
                </View>
                {!a.leido_at ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: t.color.magenta, marginTop: 6 }} /> : null}
              </Tarjeta>
            </Pressable>
          </Entrada>
        );
      }}
    />
  );
}
