// Invita a un amigo (2026-10-06). Decisión del usuario: 50 puntos para cada
// uno cuando el invitado hace su primera compra de $10 o más. El premio lo da
// la base (`puntos_premiar_referidos`, cada hora); acá sólo se comparte el
// código y se ve cómo va.
//
// El código de invitación NO es el de la tarjeta: ése sirve para entrar a la
// cuenta y compartirlo sería regalar el acceso.
import { useCallback, useState } from 'react';
import { Pressable, Share, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Aviso, Boton, Cargando, Pantalla, Tarjeta, Texto, Titulo } from '../componentes/ui';
import { Entrada, NumeroAnimado } from '../componentes/animacion';
import { colorSistema } from '../componentes/sistema';
import { useSesion } from '../lib/sesion';
import { useTema } from '../tema/tema';

export default function Invitar() {
  const t = useTema();
  const pedir = useSesion((s) => s.pedir);
  const [d, setD] = useState(null);
  useFocusEffect(useCallback(() => { pedir('referido').then(setD); }, [pedir]));

  if (!d) return <Cargando />;
  if (!d.ok || !d.codigo) return <Pantalla conPestanas={false}><Aviso>{d.mensaje ?? 'No se pudo cargar tu código.'}</Aviso></Pantalla>;

  const mensaje = `¡Únete a Puntos Salud de Farmacia Salud! Usa mi código ${d.codigo} al registrarte en la app y los dos ganamos ${d.puntos} puntos con tu primera compra de $${d.minimo} o más.`;
  const compartir = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try { await Share.share({ message: mensaje }); } catch { /* cancelado */ }
  };

  return (
    <Pantalla conPestanas={false}>
      <Entrada indice={0}>
        <LinearGradient colors={['#2B0B3A', t.color.magenta, '#5B1E9C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ borderRadius: 26, padding: 22, gap: 10, alignItems: 'center' }}>
          <Text style={{ fontSize: 44 }}>🤝</Text>
          <Text style={{ fontSize: 24, fontWeight: '800', color: '#FFFFFF', textAlign: 'center' }}>
            Invita y ganen {d.puntos} puntos cada uno
          </Text>
          <Text style={{ fontSize: 15, lineHeight: 21, color: 'rgba(255,255,255,0.88)', textAlign: 'center' }}>
            Cuando tu amigo haga su primera compra de ${d.minimo} o más.
          </Text>
          <Pressable onPress={compartir} accessibilityRole="button" accessibilityLabel={`Tu código ${d.codigo}. Toca para compartir.`}
            style={({ pressed }) => ({
              marginTop: 6, backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
              borderStyle: 'dashed', paddingVertical: 14, paddingHorizontal: 28, transform: [{ scale: pressed ? 0.97 : 1 }],
            })}>
            <Text style={{ fontSize: 34, fontWeight: '900', letterSpacing: 6, color: '#FFFFFF', fontVariant: ['tabular-nums'] }}>{d.codigo}</Text>
          </Pressable>
        </LinearGradient>
      </Entrada>

      <Entrada indice={1}>
        <Boton alTocar={compartir}>Compartir mi código</Boton>
      </Entrada>

      <Entrada indice={2} estilo={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Tarjeta>
            <Texto nivel={3}>Invitados</Texto>
            <NumeroAnimado valor={d.invitados} formato="entero" estilo={{ fontSize: 26, fontWeight: '800', color: colorSistema.texto }} />
          </Tarjeta>
        </View>
        <View style={{ flex: 1 }}>
          <Tarjeta>
            <Texto nivel={3}>Ganaste</Texto>
            <NumeroAnimado valor={d.ganados} formato="entero" estilo={{ fontSize: 26, fontWeight: '800', color: t.color.verdeTexto }} />
          </Tarjeta>
        </View>
      </Entrada>

      <Entrada indice={3}>
        <Tarjeta estilo={{ gap: 12 }}>
          <Titulo>Cómo funciona</Titulo>
          <Paso n="1" texto="Comparte tu código por WhatsApp o como quieras." color={t.color.magenta} />
          <Paso n="2" texto="Tu amigo descarga la app y lo escribe al unirse." color={t.color.magenta} />
          <Paso n="3" texto={`Con su primera compra de $${d.minimo} o más, los dos reciben ${d.puntos} puntos.`} color={t.color.magenta} />
          {d.pendientes ? <Texto nivel={2} estilo={{ fontSize: 14 }}>{d.pendientes} {d.pendientes === 1 ? 'invitación espera' : 'invitaciones esperan'} su primera compra.</Texto> : null}
          <Texto nivel={3} estilo={{ fontSize: 13 }}>Sólo cuenta para clientes nuevos. Hasta 10 premios al mes.</Texto>
        </Tarjeta>
      </Entrada>
    </Pantalla>
  );
}

function Paso({ n, texto, color }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>{n}</Text>
      </View>
      <Text style={{ flex: 1, fontSize: 15, lineHeight: 21, color: colorSistema.texto }}>{texto}</Text>
    </View>
  );
}
