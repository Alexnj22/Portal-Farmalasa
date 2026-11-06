// La foto de una persona — el MISMO diseño que `AvatarConEstado` del portal
// (2026-11-06, «cuatro esquinas»). Antes la app pintaba sólo la foto o las
// iniciales: nadie veía en el teléfono quién estaba de vacaciones, ni el
// cumpleaños, ni los años en la empresa.
//
//   arriba-izq  la torta (hoy cumple) · arriba-der «!» (expediente incompleto)
//   abajo-der   el estado              · abajo-izq la medalla de antigüedad
//
// El aro de estado va POR FUERA y separado de la foto por un filo vacío, que
// deja ver el fondo de detrás. Los tamaños son los de la escala del núcleo
// (`TAMANOS_DE_AVATAR`): un `tamano` fuera de ella se lleva al más cercano, así
// la misma persona se ve igual en cualquier pantalla. La regla de qué marca
// aparece a qué tamaño vive en `geometriaDeAvatar`, compartida con el portal.
//
// La ficha se busca en el store por id, igual que en el portal: la mitad de
// los llamadores pasan `{ id, name }` y la foto firmada, el historial, la fecha
// de ingreso y el cumpleaños viven en la ficha. `memo` porque se pinta en cada
// fila de listas largas y sus props casi nunca cambian.
import { memo, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Image, Text, View, useColorScheme } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Host, Icon } from '@expo/ui';
import tokens from '@nucleo/constants/tokens.json';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { estadoDePersona, normalizarPersona } from '@nucleo/utils/estadoDePersona';
import { antiguedadDePersona, pendientesDePersona } from '@nucleo/utils/alertasDePersona';
import { esFichaQueNoEsEmpleado } from '@nucleo/utils/tipoDeFicha';
import { esCumpleHoy } from '@nucleo/utils/miPerfil';
import { tamanoDeAvatar, geometriaDeAvatar } from '@nucleo/utils/avatar';
import { useStaffStore } from '@nucleo/store/staffStore';
import { leerEstado, pedirEstado, suscribirse, hayQuePreguntar as hayQuePreguntarPor, estadoDesdeRemoto } from '@nucleo/data/estadosDePersonas';
import { useAuthSiHay } from '@nucleo/context/AuthContext';
import { colorSistema } from './Formulario';
import { iconoDe } from '../tema/iconos';

// Los mismos íconos que el portal, por nombre (la traducción a SF Symbols y
// Material vive en `tema/iconos`).
const ICONO = {
  VACATION: 'Palmtree', DISABILITY: 'Stethoscope', SUPPORT: 'Briefcase', INDUCTION: 'Baby',
  PERMIT: 'Clock', INACTIVO: 'UserMinus', LIQUIDADO: 'UserX', SUSPENDIDO: 'HelpCircle',
  SUSPENSION: 'Ban', AUSENTE: 'Moon',
};

// La variante del estado → el token del aro y el del chip. `neutral` es el
// gris de la paleta (chart-8), igual que en el portal.
const TOKEN = { neutral: 'chart-8' };

// Los metales de la medalla, copiados de `.medalla-antiguedad` (src/index.css).
const METAL = {
  bronce: { hondo: '#7a4521', tono: '#c08050', brillo: '#f2c196', tinta: '#341703' },
  plata: { hondo: '#8a95a4', tono: '#c9d1dc', brillo: '#ffffff', tinta: '#232b38' },
  oro: { hondo: '#b0820a', tono: '#ecbd34', brillo: '#fff1b0', tinta: '#3f2a00' },
  platino: { hondo: '#8f7ade', tono: '#d6caff', brillo: '#ffffff', tinta: '#241858' },
};

/** Un círculo de marca con su filo del color de la fila, como `.avatar-marca`. */
function Marca({ tam, fondo, style, children }) {
  return (
    <View pointerEvents="none" style={[{
      position: 'absolute', width: tam + 4, height: tam + 4, borderRadius: (tam + 4) / 2,
      borderWidth: 2, borderColor: colorSistema.fila, backgroundColor: fondo,
      alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    }, style]}>
      {children}
    </View>
  );
}

function Medalla({ tam, tramo, anios }) {
  const m = METAL[tramo] || METAL.bronce;
  return (
    <Marca tam={tam} fondo={m.tono} style={{ bottom: -4, left: -4 }}>
      <Svg width={tam} height={tam} style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id={`med-${tramo}`} x1="0.2" y1="0" x2="0.8" y2="1">
            <Stop offset="0" stopColor={m.brillo} />
            <Stop offset="0.55" stopColor={m.tono} />
            <Stop offset="1" stopColor={m.hondo} />
          </LinearGradient>
        </Defs>
        <Circle cx={tam / 2} cy={tam / 2} r={tam / 2} fill={`url(#med-${tramo})`} />
      </Svg>
      <Text allowFontScaling={false} style={{ color: m.tinta, fontSize: Math.round(tam * 0.5), fontWeight: '900', fontVariant: ['tabular-nums'] }}>{anios}</Text>
    </Marca>
  );
}

function Avatar({ empleado, tamano = 36, pendientes: conPendientes = true }) {
  const px = tamanoDeAvatar(tamano);
  const g = geometriaDeAvatar(px);
  const t = tokens.temas[useColorScheme() === 'dark' ? 'solid-dark' : 'solid'];

  const emp = useMemo(() => normalizarPersona(empleado), [empleado]);
  const fila = useStaffStore((s) => (emp?.id
    ? (s.employees || []).find((e) => String(e.id) === String(emp.id)) || null
    : null));
  const persona = fila || emp;

  // ── El estado: local si el historial alcanza, si no se le pregunta a la base
  // (misma regla que el portal: un historial acotado no puede decir «está»).
  const historialCompleto = useStaffStore((s) => s.historialCompleto);
  const local = useMemo(() => estadoDePersona(persona), [persona]);
  const hayQuePreguntar = !local && hayQuePreguntarPor(emp, historialCompleto);
  const remoto = useSyncExternalStore(suscribirse, () => (hayQuePreguntar ? leerEstado(emp.id) : null), () => null);
  useEffect(() => { if (hayQuePreguntar) pedirEstado(emp.id); }, [hayQuePreguntar, emp?.id]);
  const estado = local || estadoDesdeRemoto(remoto);

  const deBaja = !!persona?.status && persona.status !== 'ACTIVO';
  const esEmpleado = !!persona && !esFichaQueNoEsEmpleado(persona);
  const antiguedad = useMemo(() => (esEmpleado && !deBaja ? antiguedadDePersona(persona) : null), [persona, esEmpleado, deBaja]);
  const deCumple = !g.firma && esEmpleado && !deBaja && esCumpleHoy(persona);

  // El «!» lo ve sólo quien puede corregir la ficha, igual que en el portal.
  const auth = useAuthSiHay();
  const puedeCorregir = !!auth?.hasPermission
    && (auth.hasPermission('staff_list', 'can_edit') || auth.hasPermission('staff_detail', 'can_edit'));
  const pendientes = useMemo(
    () => (conPendientes && puedeCorregir && fila && esEmpleado && !deBaja ? pendientesDePersona(fila) : []),
    [conPendientes, puedeCorregir, fila, esEmpleado, deBaja]);

  const variante = estado ? (TOKEN[estado.variante] || estado.variante) : null;
  const aro = variante ? t[variante] : null;
  const chip = variante ? (t[`${variante}-solid`] || aro) : null;
  const icono = estado ? ICONO[estado.clave] : null;

  const foto = fila?.photo || fila?.photo_url || emp?.photo || emp?.photo_url;
  const [rota, setRota] = useState(null);
  const letras = shortEmployeeName(emp).split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('');

  const etiqueta = [
    shortEmployeeName(emp),
    deCumple ? 'hoy cumple años' : '',
    estado ? `${estado.texto}${estado.hasta && !estado.faltan ? `, vuelve el ${estado.hasta}` : ''}` : '',
    antiguedad ? `${antiguedad.anios} ${antiguedad.anios === 1 ? 'año' : 'años'} en la empresa` : '',
    pendientes.length ? `expediente incompleto: ${pendientes.length} ${pendientes.length === 1 ? 'dato' : 'datos'}` : '',
  ].filter(Boolean).join(', ');

  const r = px / 2;
  const fuera = g.filo + g.aro;
  const tamCumple = Math.max(14, g.tamChip);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={etiqueta}
      style={{ width: px, height: px }}>
      {aro ? (
        <View pointerEvents="none" style={{
          position: 'absolute', top: -fuera, left: -fuera, width: px + 2 * fuera, height: px + 2 * fuera,
          borderRadius: r + fuera, borderWidth: g.aro, borderColor: aro,
        }} />
      ) : null}
      {foto && rota !== foto ? (
        <Image source={{ uri: foto, cache: 'force-cache' }} onError={() => setRota(foto)}
          style={{ width: px, height: px, borderRadius: r, backgroundColor: colorSistema.separador }} />
      ) : (
        <View style={{ width: px, height: px, borderRadius: r, backgroundColor: colorSistema.separador, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: colorSistema.texto2, fontSize: px * 0.36, fontWeight: '600' }} allowFontScaling={false}>{letras || '•'}</Text>
        </View>
      )}

      {/* El estado: el ícono cuando ya está, «−N» mientras falta. */}
      {g.conChip && estado && (estado.faltan > 0 || icono) ? (
        <Marca tam={g.tamChip} fondo={chip} style={{ bottom: -4, right: -4 }}>
          {estado.faltan > 0 ? (
            <Text allowFontScaling={false} style={{ color: '#fff', fontWeight: '900', fontSize: Math.round(g.tamChip * 0.5), fontVariant: ['tabular-nums'] }}>−{estado.faltan}</Text>
          ) : (
            <Host matchContents><Icon name={iconoDe(icono)} size={Math.round(g.tamChip * 0.56)} color="#fff" /></Host>
          )}
        </Marca>
      ) : null}

      {/* La torta: blanca con la torta rosa, en los dos temas. */}
      {deCumple ? (
        <Marca tam={tamCumple} fondo="#fff" style={{ top: -4, left: -4 }}>
          <Host matchContents><Icon name={iconoDe('Cake')} size={Math.round(tamCumple * 0.58)} color={t['chart-6-solid']} /></Host>
        </Marca>
      ) : null}

      {pendientes.length > 0 && !g.firma ? (
        <Marca tam={g.tamPendiente} fondo={t['warning-solid']} style={{ top: -4, right: -4 }}>
          <Text allowFontScaling={false} style={{ color: '#fff', fontWeight: '900', fontSize: Math.round(g.tamPendiente * 0.62) }}>!</Text>
        </Marca>
      ) : null}

      {antiguedad && g.conMedalla ? <Medalla tam={g.tamChip} tramo={antiguedad.tramo} anios={antiguedad.anios} /> : null}
    </View>
  );
}

export default memo(Avatar);
