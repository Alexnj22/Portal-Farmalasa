// Piezas del chat con clientes, NATIVAS — las del portal (`ClienteAvatar`,
// `ChipsDeEstado`, las etiquetas de tipo y nivel). Qué dice cada una sale del
// núcleo (`utils/chatClientes`).
import { memo, useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Host, Icon } from '@expo/ui';
import { iconoDe } from '../../tema/iconos';
import { ESTADOS, NIVELES, claveDeNivel, esperaDe, estadoDeConversacion, inicialesDeCliente, nombreDeCliente, tipoDeCliente } from '@nucleo/utils/chatClientes';
import Avatar from '../Avatar';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { Pildora } from '../avisos/Piezas';
import { MARCA } from '../inicio/marca';

// Las variantes del portal, en los colores de la app.
export const COLOR = {
  info: MARCA.azulClaro, success: MARCA.verde, warning: MARCA.ambar, danger: MARCA.rojo, neutral: '#8E8E93',
  'chart-1': MARCA.azul, 'chart-4': '#B7791F', 'chart-6': '#6929C4', 'chart-9': '#981D97',
};
export const colorDe = (variant) => COLOR[variant] ?? COLOR.neutral;

// El metal de la tarjeta de socio —hondo, tono, reflejo—, el mismo de
// `COLORES_NIVEL` (apps/clientes/componentes/TarjetaSocio.js) y de
// `.aro-cliente` del portal: el aro dice el nivel como lo ve el cliente.
const METAL = {
  bronce: ['#3A1A08', '#9A5A2C', '#F2B07A'], plata: ['#4A525E', '#A9B2BE', '#F4F7FB'],
  oro: ['#7A4A00', '#E0A93A', '#FFE7A3'], platino: ['#08090C', '#4A505C', '#E8ECF2'],
  jade: ['#06281F', '#1F9E77', '#8CF5CE'], zafiro: ['#061440', '#2E5BD6', '#A9C2FF'],
  rubi: ['#3A0410', '#C0163A', '#FF9AAE'], diamante: ['#26384A', '#8FB3CF', '#EAF6FF'],
};
// El acento rosa de la tarjeta del equipo.
const TEAM = '#D45AB4';

// Un anillo de metal que gira (o quieto): un círculo de SVG con trazo en
// degradado, y es el anillo el que rota —la foto, encima, no—, así el
// reflejo corre por el metal.
function Anillo({ tam, grosor, metal, id, giro }) {
  const r = (tam - grosor) / 2;
  const [hondo, tono, brillo] = metal;
  const rot = giro ? giro.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) : '0deg';
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', width: tam, height: tam, transform: [{ rotate: rot }] }}>
      <Svg width={tam} height={tam}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={brillo} />
            <Stop offset="0.3" stopColor={tono} />
            <Stop offset="0.65" stopColor={hondo} />
            <Stop offset="1" stopColor={tono} />
          </LinearGradient>
        </Defs>
        <Circle cx={tam / 2} cy={tam / 2} r={r} stroke={`url(#${id})`} strokeWidth={grosor} fill="none" />
      </Svg>
    </Animated.View>
  );
}

function useGiro(activo, ms) {
  const [giro] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!activo) return undefined;
    let vuelta = null;
    let vivo = true;
    // «Reducir movimiento» del sistema: el aro queda quieto.
    AccessibilityInfo.isReduceMotionEnabled().then((reducir) => {
      if (!vivo || reducir) return;
      vuelta = Animated.loop(Animated.timing(giro, { toValue: 1, duration: ms, easing: Easing.linear, useNativeDriver: true }));
      vuelta.start();
    }).catch(() => {});
    return () => { vivo = false; vuelta?.stop(); };
  }, [activo, ms, giro]);
  return activo ? giro : null;
}

let siguienteId = 0;

/**
 * La foto de perfil del cliente (opcional, la sube desde su app) o sus
 * iniciales, dentro del aro de su nivel (2026-10-21, como en la app de
 * puntos y en el portal): UN aro fino del metal de su tarjeta. Del equipo,
 * un emblema rosa en la esquina — un segundo aro era demasiado («¿por qué
 * tanto aro?»). `conversacion` trae nivel, rango y si es del equipo; sin
 * ella, sin aro. `animado`: sólo donde hay UNO a la vista (la barra del hilo).
 */
export const ClienteAvatar = memo(function ClienteAvatar({ cliente, fotoUrl, tamano = 40, conversacion = null, animado = false }) {
  const [id] = useState(() => `aro${siguienteId++}`);
  const nivel = conversacion ? claveDeNivel({ ...conversacion, es_team: false }) : null;
  const team = !!conversacion?.es_team;
  const metal = METAL[nivel] ?? null;
  const giro = useGiro(animado && !!metal, 7000);
  const grosor = Math.max(2, Math.round(tamano * 0.05));
  const hueco = 2;
  const cara = metal ? tamano - 2 * (grosor + hueco) : tamano;
  const emblema = Math.max(13, Math.round(tamano * 0.36));
  const foto = fotoUrl
    ? <Image source={{ uri: fotoUrl }} style={{ width: cara, height: cara, borderRadius: cara / 2 }} accessibilityIgnoresInvertColors />
    : (
      <View style={{ width: cara, height: cara, borderRadius: cara / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,82,204,0.14)' }}>
        <Text style={{ color: MARCA.azulClaro, fontSize: cara * 0.38, fontWeight: '900' }}>{inicialesDeCliente(cliente)}</Text>
      </View>
    );
  return (
    <View style={{ width: tamano, height: tamano, alignItems: 'center', justifyContent: 'center' }}>
      {metal ? <Anillo tam={tamano} grosor={grosor} metal={metal} id={id} giro={giro} /> : null}
      {foto}
      {team ? (
        <View accessibilityLabel="Del equipo" style={{ position: 'absolute', right: -1, bottom: -1, width: emblema, height: emblema, borderRadius: emblema / 2,
          backgroundColor: TEAM, borderWidth: 1.5, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
          <Host matchContents><Icon name={iconoDe('Users')} size={Math.round(emblema * 0.6)} color="#FFFFFF" /></Host>
        </View>
      ) : null}
    </View>
  );
});

/**
 * El estado como UNA línea bajo el nombre — el «en línea» de una app de
 * mensajería. «En atención» lleva la foto y el nombre de quien atiende, y
 * mientras el cliente siga sin respuesta (nuevo o tomada: tomarla no es
 * contestarle), cuánto lleva: gris, ámbar a los 15 min, rojo a la hora.
 */
export function EstadoEnTexto({ conversacion: c, atiende, ahora }) {
  const clave = estadoDeConversacion(c);
  const estado = ESTADOS[clave];
  const espera = esperaDe(c, ahora);
  const conFoto = clave === 'atencion' && atiende;
  const tono = espera ? (espera.tono === 'neutral' ? '#8E8E93' : colorDe(espera.tono)) : null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      {conFoto
        ? <Avatar empleado={atiende} tamano={16} />
        : <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colorDe(estado.variant) }} />}
      <Text numberOfLines={1} style={{ color: '#8E8E93', fontSize: 12, fontWeight: '600', flexShrink: 1 }}>
        {conFoto ? nombreDeCliente(shortEmployeeName(atiende)) : estado.label}
      </Text>
      {espera ? (
        <Text style={{ color: tono, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
          {espera.min < 1 ? '· ahora' : `· espera ${espera.label}`}
        </Text>
      ) : null}
    </View>
  );
}

/** «Team», «Mayoreo <rango>» o «Cliente», y su nivel del programa de puntos. */
export function EtiquetasDeCliente({ c }) {
  const tipo = tipoDeCliente(c);
  const nivel = NIVELES[c?.nivel];
  return (
    <>
      <Pildora texto={tipo.label} color={colorDe(tipo.variant)} />
      {nivel ? <Pildora texto={nivel.label} color={colorDe(nivel.variant)} /> : null}
    </>
  );
}
