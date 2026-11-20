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
import * as escalaDeAvatar from '@nucleo/utils/avatar';
import { resolverTurnoDelDia, claveDeDia, aMinutos } from '@nucleo/utils/turnoDelDia';
import { hoySV, ahoraSV } from '@nucleo/utils/fecha';
import { papel } from '../tema/papel';
import { useStaffStore } from '@nucleo/store/staffStore';
import { leerEstado, pedirEstado, suscribirse, hayQuePreguntar as hayQuePreguntarPor, estadoDesdeRemoto } from '@nucleo/data/estadosDePersonas';
import { useAuthSiHay } from '@nucleo/context/AuthContext';
import { colorSistema } from './Formulario';
import { iconoDe } from '../tema/iconos';
import IconoFijo from './IconoFijo';

const { tamanoDeAvatar, geometriaDeAvatar } = escalaDeAvatar;

/* ── Línea Mostrador · anatomía B «Arco del turno» (2026-11-19) ─────────────
 * La misma del portal (`AvatarConEstado`, rama Mostrador; MOSTRADOR.md §3.16):
 * la escala de cuatro (24 Firma · 40 Lista · 64 Ficha · 104 Retrato; el
 * tamaño que pasa cada pantalla se TRADUCE con `geometriaMostrador`) y cada
 * estado con FORMA además de color, para leerse sin distinguir colores:
 * apoyo continuo, inducción abierto, permiso guiones, vacaciones puntos,
 * incapacidad doble, suspensión cuatro tramos, «no está hoy» media luna;
 * inactivo una diagonal sobre la foto apagada; liquidado, además un aro fino.
 * Sin estado y dentro de su turno publicado de hoy, un arco de la marca
 * recorre lo que va del turno (un reloj por minuto para todas las fotos).
 * El chip va arriba a la derecha sobre el aro y el «!» abajo; a 104 el estado
 * va escrito en una píldora que muerde el borde.
 *
 * La tabla de respaldo es la de `src/utils/avatar.js` y sólo se usa si el
 * núcleo publicado todavía no la trae: así una actualización por aire nunca
 * deja a la app sin fotos. */
const GEOMETRIA_B = {
  24: { px: 24, aro: 2, hueco: 1.5, chip: 0, marca: 0, medalla: 0 },
  40: { px: 40, aro: 2.5, hueco: 2, chip: 16, marca: 16, medalla: 0 },
  64: { px: 64, aro: 3.5, hueco: 2, chip: 22, marca: 20, medalla: 22 },
  104: { px: 104, aro: 4.5, hueco: 3, chip: 0, marca: 26, medalla: 30 },
};
function geometriaB(px) {
  if (typeof escalaDeAvatar.geometriaMostrador === 'function') return escalaDeAvatar.geometriaMostrador(px);
  const n = Number(px) || 36;
  return GEOMETRIA_B[n <= 24 ? 24 : n <= 40 ? 40 : n <= 80 ? 64 : 104];
}
const FORMA_B = {
  SUPPORT: 'continuo', INDUCTION: 'abierto', PERMIT: 'guiones', VACATION: 'puntos',
  DISABILITY: 'doble', SUSPENSION: 'cortado', SUSPENDIDO: 'cortado', AUSENTE: 'media',
  INACTIVO: 'baja', BAJA: 'baja', LIQUIDADO: 'cerrado',
};
// El tono del estado en Papel (los chart-* siguen con su token).
const PAPEL_DE_VARIANTE = { danger: 'error', warning: 'aviso', success: 'exito', neutral: 'tinta3', 'chart-1': 'marca', info: 'marca' };

const oyentesDelMinuto = new Set();
let relojDelMinuto = null;
const minutoDeAhora = () => { const a = ahoraSV(); return a.h * 60 + a.min; };
let minutoActual = minutoDeAhora();
function suscribirseAlMinuto(fn) {
  oyentesDelMinuto.add(fn);
  if (!relojDelMinuto) {
    relojDelMinuto = setInterval(() => { minutoActual = minutoDeAhora(); oyentesDelMinuto.forEach((f) => f()); }, 60_000);
  }
  return () => {
    oyentesDelMinuto.delete(fn);
    if (!oyentesDelMinuto.size) { clearInterval(relojDelMinuto); relojDelMinuto = null; }
  };
}

/** Cuánto lleva del turno de hoy (0–1), o null si no está dentro de su turno. */
function avanceDelTurno(persona, turnos, ahora) {
  const horario = persona?.weeklySchedule || persona?.weekly_roster;
  if (!horario || !Array.isArray(turnos)) return null;
  const dia = claveDeDia(`${hoySV()}T12:00:00`);
  const t = resolverTurnoDelDia(horario[dia] ?? horario[Number(dia)], turnos);
  if (!t?.trabaja || !t.minutosBrutos) return null;
  const ini = aMinutos(t.inicio);
  let m = ahora;
  if (t.cruzaMedianoche && m < ini) m += 1440;
  const a = (m - ini) / t.minutosBrutos;
  return a >= 0 && a <= 1 ? a : null;
}

/** El aro de la anatomía B: la forma es su `strokeDasharray`. */
function AroB({ forma, tono, geo, avance, tenue, carril }) {
  const doble = forma === 'doble' ? 2 : 0;
  const fuera = geo.hueco + geo.aro + doble;
  const lado = geo.px + fuera * 2;
  const c = lado / 2;
  const r = geo.px / 2 + geo.hueco + geo.aro / 2 + doble / 2;
  const L = 2 * Math.PI * r;
  const comun = { cx: c, cy: c, r, fill: 'none', strokeLinecap: 'round' };
  let figura;
  if (forma === 'turno') {
    figura = (
      <>
        <Circle {...comun} stroke={carril} strokeWidth={geo.aro} />
        <Circle {...comun} stroke={tono} strokeWidth={geo.aro} strokeDasharray={`${L} ${L}`} strokeDashoffset={L * (1 - avance)}
          rotation={-90} origin={`${c}, ${c}`} />
      </>
    );
  } else if (forma === 'doble') {
    const t = Math.max(1, geo.aro * 0.6);
    figura = (
      <>
        <Circle {...comun} r={r + t} stroke={tono} strokeWidth={t} />
        <Circle {...comun} r={r - t} stroke={tono} strokeWidth={t} />
      </>
    );
  } else {
    const chico = geo.px < 40;
    const patron = {
      puntos: `0.01 ${L / (chico ? 8 : 14)}`,
      guiones: `${L / (chico ? 12 : 18)} ${L / (chico ? 12 : 18)}`,
      cortado: `${L / 4 - L / 12} ${L / 12}`,
      abierto: `${L * 0.8} ${L * 0.2}`,
      media: `${L / 2} ${L / 2}`,
    }[forma];
    const ancho = forma === 'puntos' ? geo.aro * 1.4 : forma === 'cerrado' ? Math.max(1, geo.aro * 0.5) : geo.aro;
    const giro = { abierto: -54, media: 0 }[forma] ?? -90;
    figura = <Circle {...comun} stroke={tono} strokeWidth={ancho} strokeDasharray={patron} rotation={giro} origin={`${c}, ${c}`} />;
  }
  return (
    <Svg pointerEvents="none" width={lado} height={lado} style={{ position: 'absolute', top: -fuera, left: -fuera, opacity: tenue ? 0.5 : 1 }}>
      {figura}
    </Svg>
  );
}

/** Una marca de la anatomía B: el círculo con un aro de 2 del color de la fila. */
function MarcaB({ tam, fondo, style, children }) {
  return (
    <View pointerEvents="none" style={[{
      position: 'absolute', width: tam + 4, height: tam + 4, borderRadius: (tam + 4) / 2, zIndex: 3,
      borderWidth: 2, borderColor: colorSistema.fila, backgroundColor: fondo, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    }, style]}>
      {children}
    </View>
  );
}

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

// `marcasDentro`: las marcas pegadas al borde en vez de 4 pt afuera. Para la
// barra de Android, que recorta lo que sale de la caja de la foto (2026-11-12).
function Avatar({ empleado, tamano = 36, pendientes: conPendientes = true, marcasDentro = false }) {
  const af = marcasDentro ? 0 : -4;
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

  // Línea Mostrador · el arco del turno (los hooks corren siempre).
  const turnos = useStaffStore((s) => s.shifts);
  const minuto = useSyncExternalStore(suscribirseAlMinuto, () => minutoActual, () => minutoActual);
  let avance = null;
  try { avance = !estado && esEmpleado && !deBaja ? avanceDelTurno(persona, turnos, minuto) : null; } catch { avance = null; }
  if (!marcasDentro) {
    return <AvatarB {...{ tamano, estado, variante, chip, icono, foto, rota, setRota, letras, etiqueta, avance, deCumple, pendientes, antiguedad, t }} />;
  }

  const r = px / 2;
  // `g.aro` incluye el filo (ver `geometriaDeAvatar`): el trazo es la resta.
  const fuera = g.aro;
  const tamCumple = Math.max(14, g.tamChip);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={etiqueta}
      style={{ width: px, height: px }}>
      {aro ? (
        <View pointerEvents="none" style={{
          position: 'absolute', top: -fuera, left: -fuera, width: px + 2 * fuera, height: px + 2 * fuera,
          borderRadius: r + fuera, borderWidth: g.aro - g.filo, borderColor: aro,
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
        <Marca tam={g.tamChip} fondo={chip} style={{ bottom: af, right: af }}>
          {estado.faltan > 0 ? (
            <Text allowFontScaling={false} style={{ color: '#fff', fontWeight: '900', fontSize: Math.round(g.tamChip * 0.5), fontVariant: ['tabular-nums'] }}>−{estado.faltan}</Text>
          ) : (
            <IconoFijo name={iconoDe(icono)} size={Math.round(g.tamChip * 0.56)} color="#fff" />
          )}
        </Marca>
      ) : null}

      {/* La torta: blanca con la torta rosa, en los dos temas. */}
      {deCumple ? (
        <Marca tam={tamCumple} fondo="#fff" style={{ top: af, left: af }}>
          <IconoFijo name={iconoDe('Cake')} size={Math.round(tamCumple * 0.58)} color={t['chart-6-solid']} />
        </Marca>
      ) : null}

      {pendientes.length > 0 && !g.firma ? (
        <Marca tam={g.tamPendiente} fondo={t['warning-solid']} style={{ top: af, right: af }}>
          <Text allowFontScaling={false} style={{ color: '#fff', fontWeight: '900', fontSize: Math.round(g.tamPendiente * 0.62) }}>!</Text>
        </Marca>
      ) : null}

      {antiguedad && g.conMedalla ? <Medalla tam={g.tamChip} tramo={antiguedad.tramo} anios={antiguedad.anios} /> : null}
    </View>
  );
}

// La anatomía B. `marcasDentro` (la barra de Android, que recorta lo que sale
// de la caja) sigue con la de siempre.
function AvatarB({ tamano, estado, variante, chip, icono, foto, rota, setRota, letras, etiqueta, avance, deCumple, pendientes, antiguedad, t }) {
  const oscuro = useColorScheme() === 'dark';
  const p = papel(oscuro);
  const g = geometriaB(tamano);
  const px = g.px;
  const forma = estado ? FORMA_B[estado.clave] : (avance != null ? 'turno' : null);
  const tono = variante ? (PAPEL_DE_VARIANTE[variante] ? p[PAPEL_DE_VARIANTE[variante]] : t[variante]) : p.marca;
  const relleno = variante && PAPEL_DE_VARIANTE[variante] ? tono : chip;
  const conAro = forma && forma !== 'baja';
  const raya = forma === 'baja' || forma === 'cerrado';
  const apagada = raya ? 0.5 : forma === 'media' ? 0.72 : 1;
  const retrato = px >= 104;
  const conChip = g.chip > 0 && estado && (estado.faltan > 0 || icono) && !retrato;
  const etiquetaTurno = avance != null ? `de turno, lleva ${Math.round(avance * 100)} % del turno` : '';
  const desfase = 0.02 * px - 0.35 * g.chip - 2;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={[etiqueta, etiquetaTurno].filter(Boolean).join(', ')}
      style={{ width: px, height: px }}>
      {conAro ? <AroB forma={forma} tono={tono} geo={g} avance={avance ?? 0} tenue={estado?.faltan > 0} carril={p.linea} /> : null}
      <View style={{ width: px, height: px, borderRadius: px / 2, overflow: 'hidden', opacity: apagada, backgroundColor: p.marcaSuave }}>
        {foto && rota !== foto ? (
          <Image source={{ uri: foto, cache: 'force-cache' }} onError={() => setRota(foto)} style={{ width: px, height: px }} />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: p.marcaTexto, fontSize: px * 0.36, fontWeight: '600' }} allowFontScaling={false}>{letras || '•'}</Text>
          </View>
        )}
      </View>
      {raya ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: -px * 0.1, top: px / 2 - Math.max(1.5, px / 30) / 2, width: px * 1.2,
          height: Math.max(1.5, px / 30), backgroundColor: p.tinta2, transform: [{ rotate: '45deg' }], zIndex: 2 }} />
      ) : null}
      {conChip ? (
        <MarcaB tam={g.chip} fondo={relleno} style={{ top: desfase, right: desfase }}>
          {estado.faltan > 0
            ? <Text allowFontScaling={false} style={{ color: '#fff', fontWeight: '900', fontSize: Math.round(g.chip * 0.5), fontVariant: ['tabular-nums'] }}>−{estado.faltan}</Text>
            : <IconoFijo name={iconoDe(icono)} size={Math.round(g.chip * 0.58)} color="#fff" />}
        </MarcaB>
      ) : null}
      {estado && retrato ? (
        <View pointerEvents="none" style={{ position: 'absolute', bottom: -13, alignSelf: 'center', height: 26, paddingLeft: 4, paddingRight: 11,
          flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, backgroundColor: p.superficie, zIndex: 3,
          borderWidth: 1.5, borderColor: tono }}>
          <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: relleno, alignItems: 'center', justifyContent: 'center' }}>
            {estado.faltan > 0
              ? <Text allowFontScaling={false} style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>−{estado.faltan}</Text>
              : icono ? <IconoFijo name={iconoDe(icono)} size={11} color="#fff" /> : null}
          </View>
          <Text allowFontScaling={false} numberOfLines={1} style={{ color: p.tinta, fontSize: 12, fontWeight: '600' }}>{estado.texto}</Text>
        </View>
      ) : null}
      {deCumple && g.marca > 0 ? (
        <MarcaB tam={g.marca} fondo="#fff" style={px >= 64 ? { left: -10, top: 4 } : { top: -5, left: -5 }}>
          <IconoFijo name={iconoDe('Cake')} size={Math.round(g.marca * 0.6)} color={t['chart-6-solid']} />
        </MarcaB>
      ) : null}
      {pendientes.length > 0 && g.marca > 0 ? (
        <MarcaB tam={g.marca} fondo={p.aviso} style={retrato ? { right: -10, top: 4 } : { bottom: -5, right: -5 }}>
          <Text allowFontScaling={false} style={{ color: '#fff', fontWeight: '900', fontSize: Math.round(g.marca * 0.62) }}>!</Text>
        </MarcaB>
      ) : null}
      {antiguedad && g.medalla > 0 ? (
        <View pointerEvents="none" style={[{ position: 'absolute', zIndex: 3, width: g.medalla, height: g.medalla }, px >= 104 ? { left: -2, bottom: 26 } : { left: -4, bottom: 18 }]}>
          <Medalla tam={g.medalla} tramo={antiguedad.tramo} anios={antiguedad.anios} />
        </View>
      ) : null}
    </View>
  );
}

export default memo(Avatar);
