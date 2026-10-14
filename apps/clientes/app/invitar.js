// Invita a un amigo (2026-10-06). Decisión del usuario: 50 puntos para cada
// uno cuando el invitado hace su primera compra de $10 o más. El premio lo da
// la base (`puntos_premiar_referidos`, cada hora); acá sólo se comparte el
// código y se ve cómo va.
//
// El código de invitación NO es el de la tarjeta: ése sirve para entrar a la
// cuenta y compartirlo sería regalar el acceso.
import { useCallback, useState } from 'react';
import { Share, Text, View } from 'react-native';
import Presionable from '../componentes/Presionable';
import { useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Boton, Cargando, Pantalla, RADIO, Tarjeta, Texto, Titulo, Vacio } from '../componentes/ui';
import { Entrada, NumeroAnimado } from '../componentes/animacion';
import { colorSistema } from '../componentes/sistema';
import { useSesion } from '../lib/sesion';
import { useTema } from '../tema/tema';
import Icono from '../componentes/Icono';
import { sinBloquear } from '../lib/bloqueo';

const ENLACE_APP = 'https://portal.farmasalud.lat/mis-puntos';

export default function Invitar() {
  const t = useTema();
  const pedir = useSesion((s) => s.pedir);
  const [d, setD] = useState(null);
  const cargar = useCallback(() => pedir('referido').then(setD), [pedir]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  const reintentar = () => { setD(null); cargar(); };

  if (!d) return <Cargando />;
  // Sin ficha todavía (2026-10-12): el código de invitación llega con el registro.
  if (d.pendiente) {
    return <Pantalla conPestanas={false}><Vacio titulo="Tu código llega con tu registro" icono="person.2.fill" respaldo="🤝">Cuando completes tu registro en cualquier sucursal tendrás tu código para invitar a tus amigos.</Vacio></Pantalla>;
  }
  if (!d.ok || !d.codigo) {
    return <Pantalla conPestanas={false}><Vacio titulo="No se pudo cargar tu código" accion="Reintentar" alAccion={reintentar}>{d.mensaje ?? 'Revisa tu conexión e intenta de nuevo.'}</Vacio></Pantalla>;
  }

  // El enlace (2026-10-13): no hay todavía un enlace de tienda en el repo; el de
  // Mis puntos abre la app si está instalada (enlace universal) y, si no, la
  // página de Puntos Salud del portal.
  const mensaje = `¡Únete a Puntos Salud de Farmacia Salud! Usa mi código ${d.codigo} al registrarte en la app y los dos ganamos ${d.puntos} puntos con tu primera compra de $${d.minimo} o más. ${ENLACE_APP}`;
  const compartir = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try { await sinBloquear(() => Share.share({ message: mensaje })); } catch { /* cancelado */ }
  };

  return (
    <Pantalla conPestanas={false}>
      <Entrada indice={0}>
        <LinearGradient colors={['#2B0B3A', t.color.magenta, '#5B1E9C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ borderRadius: RADIO.tarjeta, padding: 22, gap: 10, alignItems: 'center' }}>
          <Icono sf="person.2.fill" respaldo="🤝" tam={44} color="#FFFFFF" />
          <Text style={{ fontSize: 24, fontWeight: '800', color: '#FFFFFF', textAlign: 'center' }}>
            Invita y ganen {d.puntos} puntos cada uno
          </Text>
          <Text style={{ fontSize: 15, lineHeight: 21, color: 'rgba(255,255,255,0.88)', textAlign: 'center' }}>
            Cuando tu amigo haga su primera compra de ${d.minimo} o más.
          </Text>
          <Presionable onPress={compartir} accessibilityRole="button" accessibilityLabel={`Tu código ${d.codigo}. Toca para compartir.`}
            style={({ pressed }) => ({
              marginTop: 6, maxWidth: '100%', backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: RADIO.medio, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
              borderStyle: 'dashed', paddingVertical: 14, paddingHorizontal: 28, transform: [{ scale: pressed ? 0.97 : 1 }],
            })}>
            {/* Con letra grande o pantalla chica, el código se encoge: partido en dos líneas no se puede dictar. */}
            <Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.5}
              style={{ fontSize: 34, fontWeight: '900', letterSpacing: 6, color: '#FFFFFF', fontVariant: ['tabular-nums'] }}>{d.codigo}</Text>
          </Presionable>
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
