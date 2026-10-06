// La bandeja: los avisos que ya te llegaron al teléfono, para verlos otra vez
// (pedido del usuario, 2026-10-06). Salen de `app_cliente_avisos`, la misma
// bitácora que impide mandar dos veces; al abrir la bandeja se marcan leídos.
// Tocar uno lleva a donde llevaba el aviso.
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Cargando, Pantalla, Tarjeta, Vacio } from '../componentes/ui';
import { Entrada } from '../componentes/animacion';
import { colorSistema } from '../componentes/sistema';
import { useSesion } from '../lib/sesion';
import { useTema } from '../tema/tema';

const ICONO = { ganado: '⭐️', cumpleanos: '🎂', vence: '⏳', inyeccion: '💉', oferta: '🏷️' };

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
  const pedir = useSesion((s) => s.pedir);
  const [d, setD] = useState(null);
  useFocusEffect(useCallback(() => {
    pedir('bandeja').then((r) => {
      setD(r);
      if (r?.ok && r.sin_leer) pedir('bandeja_leida');
    });
  }, [pedir]));

  if (!d) return <Cargando />;
  if (!d.avisos?.length) {
    return <Pantalla conPestanas={false}><Vacio titulo="Sin notificaciones">Aquí verás tus puntos ganados, ofertas y recordatorios.</Vacio></Pantalla>;
  }
  return (
    <Pantalla conPestanas={false}>
      {d.avisos.map((a, i) => (
        <Entrada key={a.id} indice={Math.min(i, 8)}>
          <Pressable disabled={!a.url} onPress={() => a.url && router.push(a.url)} accessibilityRole={a.url ? 'button' : undefined}
            style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}>
            <Tarjeta tono={!a.leido_at ? t.color.magenta : undefined} estilo={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(155,33,155,0.14)', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 20 }}>{ICONO[a.tipo] ?? '🔔'}</Text>
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
      ))}
    </Pantalla>
  );
}
