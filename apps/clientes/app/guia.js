// El PRIMER INICIO (2026-10-14, aprobado por el usuario): cinco páginas a
// pantalla completa que cuentan cómo funciona la app, una vez, después de la
// primera entrada o registro en este teléfono (lib/novedades.js decide cuándo).
// También se abre a mano desde Cuenta → «Cómo funciona la app» y desde el modo
// de prueba.
//
//   1. Tu tarjeta Puntos Salud — la tarjeta de verdad, que se toca y gira.
//   2. Tu nivel y tu cupón — la escalera de materiales.
//   3. Tienda y reservas.
//   4. Chat con la farmacia (y los recordatorios de Mis tratamientos).
//   5. Avisos y seguridad — los dos son opcionales y se activan aquí mismo.
//
// Se pasa de página deslizando (el paginado nativo del ScrollView) o con
// «Siguiente»; «Saltar» está siempre. Se presenta como modal a pantalla
// completa con la animación del sistema (app/_layout.js). Sin parallax: los
// puntos de abajo son lo único que sigue al dedo, y con «Reducir movimiento» o
// en un teléfono liviano ni eso — cambian de golpe.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import Animated, { Extrapolation, interpolate, runOnJS, useAnimatedScrollHandler, useAnimatedStyle, useReducedMotion, useSharedValue } from 'react-native-reanimated';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Aurora from '../componentes/Aurora';
import Presionable from '../componentes/Presionable';
import TarjetaSocio, { COLORES_NIVEL } from '../componentes/TarjetaSocio';
import Icono from '../componentes/Icono';
import { Boton, Texto } from '../componentes/ui';
import { colorSistema } from '../componentes/sistema';
import { rangoReal } from '../componentes/Mayorista';
import { suave, useTema } from '../tema/tema';
import { useSesion } from '../lib/sesion';
import { useCuenta } from '../lib/cuenta';
import { pedirTokenDeAvisos, recordarAvisos } from '../lib/avisos';
import { conBiometria, nombreBiometria, sinBloquear, useBloqueo } from '../lib/bloqueo';
import { marcarGuiaVista, usePresentacion } from '../lib/novedades';
import { LIVIANO } from '../lib/rendimiento';
import { agregarAGoogleWallet, agregarDirecto, agregarPorSafari, googleWalletDisponible, tienePase, walletDisponible } from '../modules/wallet';

const PAGINAS = 5;
const ESCALERA = [['bronce', 'Bronce'], ['plata', 'Plata'], ['oro', 'Oro'], ['platino', 'Platino']];

export default function Guia() {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const { width: ancho } = useWindowDimensions();
  const reducir = useReducedMotion() || LIVIANO;
  const resumen = useCuenta((s) => s.resumen);
  const cargarCuenta = useCuenta((s) => s.cargar);
  const [pagina, setPagina] = useState(0);
  const lista = useRef(null);
  const x = useSharedValue(0);
  const alDesplazar = useAnimatedScrollHandler({
    onScroll: (e) => { x.value = e.contentOffset.x; },
    onMomentumEnd: (e) => { runOnJS(setPagina)(Math.round(e.contentOffset.x / Math.max(1, ancho))); },
  });

  // Se marca al ABRIRLA: si cierra la app a mitad, no vuelve a salir sola.
  useEffect(() => {
    marcarGuiaVista();
    usePresentacion.getState().guiaAbierta();
    if (!resumen) cargarCuenta();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cerrar = useCallback(() => {
    if (router.canGoBack()) router.back(); else router.replace('/puntos');
  }, []);
  const ir = (n) => {
    lista.current?.scrollTo({ x: n * ancho, animated: !reducir });
    setPagina(n);
    if (reducir) x.value = n * ancho;
  };
  const siguiente = () => {
    Haptics.selectionAsync().catch(() => {});
    if (pagina >= PAGINAS - 1) cerrar(); else ir(pagina + 1);
  };
  const saltar = () => { Haptics.selectionAsync().catch(() => {}); cerrar(); };

  return (
    <View style={{ flex: 1 }}>
      <Aurora activa={!reducir} />
      {/* Arriba: «Saltar», siempre. */}
      <View style={{ paddingTop: ins.top + 6, paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'flex-end' }}>
        <Presionable onPress={saltar} hitSlop={10} accessibilityRole="button" accessibilityLabel="Saltar la guía"
          style={({ pressed }) => ({ minHeight: 44, minWidth: 44, paddingHorizontal: 12, borderRadius: 22, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
          <Text style={{ fontSize: 17, fontWeight: '600', color: t.color.magentaTexto }}>Saltar</Text>
        </Presionable>
      </View>

      <Animated.ScrollView ref={lista} horizontal pagingEnabled showsHorizontalScrollIndicator={false} bounces={false}
        onScroll={alDesplazar} scrollEventThrottle={16} style={{ flex: 1 }} decelerationRate="fast">
        <Pagina ancho={ancho} titulo="Tu tarjeta Puntos Salud"
          arte={<Tarjeta resumen={resumen} activa={pagina === 0} ancho={ancho} />}
          extra={<BotonWallet resumen={resumen} />}>
          Muéstrala en caja: por cada $1 de compra acumulas puntos, y 100 puntos = $1 de descuento. Tócala para ver tu código.
        </Pagina>
        <Pagina ancho={ancho} titulo="Tu nivel y tu cupón"
          arte={<Escalera actual={rangoReal(resumen?.mayorista) ? null : (resumen?.nivel?.clave === 'vip' ? 'bronce' : resumen?.nivel?.clave)} />}
          nota={resumen?.nivel?.activos === false
            ? 'Los niveles se activan pronto, según el reglamento vigente.'
            : 'Los niveles y sus beneficios siguen el reglamento vigente.'}>
          Mientras más compras, mejor tu material y tus beneficios. Oro y Platino reciben un cupón raspable cada mes.
        </Pagina>
        <Pagina ancho={ancho} titulo="Tienda y reservas" arte={<Insignia sf="bag.fill" respaldo="◍" color={t.color.magenta} texto={t.color.magentaTexto} />}>
          Aparta productos y retíralos sin hacer fila. Si llevan receta, súbela con una foto.
        </Pagina>
        <Pagina ancho={ancho} titulo="Chat con la farmacia" arte={<Insignia sf="bubble.left.and.bubble.right.fill" respaldo="✉" color={t.color.verde} texto={t.color.verdeTexto} />}
          nota="En Mis tratamientos te recordamos tus tomas y cuándo te toca volver a comprar.">
          Pregúntanos por un medicamento, su precio o si lo tenemos. Te responde nuestro equipo.
        </Pagina>
        <Pagina ancho={ancho} titulo="Avisos y seguridad" arte={<Insignia sf="bell.badge" respaldo="!" color={t.color.magenta} texto={t.color.magentaTexto} />}
          extra={<Permisos resumen={resumen} />}>
          Te avisamos cuando ganas puntos, cuando tu reserva está lista y cuando te responden en el chat. Y puedes pedir tu huella o tu cara al abrir la app, para que nadie más vea tu saldo. Las dos cosas son opcionales.
        </Pagina>
      </Animated.ScrollView>

      {/* Abajo: los puntos y el botón principal. */}
      <View style={{ paddingHorizontal: 24, paddingBottom: ins.bottom + 16, paddingTop: 8, gap: 18, width: '100%', maxWidth: 520, alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}
          accessible accessibilityRole="adjustable" accessibilityLabel={`Página ${pagina + 1} de ${PAGINAS}`}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'increment' && pagina < PAGINAS - 1) ir(pagina + 1);
            if (e.nativeEvent.actionName === 'decrement' && pagina > 0) ir(pagina - 1);
          }}>
          {Array.from({ length: PAGINAS }, (_, i) => (
            <Punto key={i} i={i} x={x} ancho={ancho} activo={pagina === i} quieto={reducir} />
          ))}
        </View>
        <Boton alTocar={siguiente}>{pagina >= PAGINAS - 1 ? 'Empezar' : 'Siguiente'}</Boton>
      </View>
    </View>
  );
}

// Una página: el arte arriba, el título, el texto y lo que se pueda hacer.
// Cada una se desplaza sola hacia abajo si la letra grande no cabe.
function Pagina({ ancho, arte, titulo, children, nota, extra }) {
  return (
    <ScrollView style={{ width: ancho }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 16 }}
      showsVerticalScrollIndicator={false}>
      <View style={{ width: '100%', maxWidth: 460, alignSelf: 'center', alignItems: 'center', gap: 22 }}>
        {arte}
        <View style={{ gap: 10, alignItems: 'center' }}>
          <Text accessibilityRole="header" style={{ fontSize: 28, fontWeight: '800', letterSpacing: -0.4, textAlign: 'center', color: colorSistema.texto }}>{titulo}</Text>
          <Texto nivel={2} estilo={{ textAlign: 'center', fontSize: 17, lineHeight: 24 }}>{children}</Texto>
          {nota ? <Texto nivel={3} estilo={{ textAlign: 'center', fontSize: 14, lineHeight: 20 }}>{nota}</Texto> : null}
        </View>
        {extra ? <View style={{ alignSelf: 'stretch', gap: 10 }}>{extra}</View> : null}
      </View>
    </ScrollView>
  );
}

// Un punto del indicador: la píldora larga es la página actual. Sigue al dedo
// mientras se desliza; con movimiento reducido cambia de golpe.
function Punto({ i, x, ancho, activo, quieto }) {
  const t = useTema();
  const estilo = useAnimatedStyle(() => {
    if (quieto) return {};
    const p = x.value / Math.max(1, ancho);
    return {
      width: interpolate(p, [i - 1, i, i + 1], [8, 24, 8], Extrapolation.CLAMP),
      opacity: interpolate(p, [i - 1, i, i + 1], [0.35, 1, 0.35], Extrapolation.CLAMP),
    };
  });
  return (
    <Animated.View style={[{ height: 8, borderRadius: 4, backgroundColor: t.color.magenta,
      width: activo ? 24 : 8, opacity: activo ? 1 : 0.35 }, estilo]} />
  );
}

// El ícono grande de una página, en su círculo de color.
function Insignia({ sf, respaldo, color, texto }) {
  const t = useTema();
  return (
    <View style={{ width: 120, height: 120, borderRadius: 60, alignItems: 'center', justifyContent: 'center',
      backgroundColor: suave(color, t.oscuro ? 0.28 : 0.14) }}>
      <Icono sf={sf} respaldo={respaldo} tam={50} color={texto} />
    </View>
  );
}

// La tarjeta de la persona, la de verdad (se toca y gira); sin ficha todavía
// (pre-registro) o sin el resumen, una tarjeta quieta de muestra en Bronce.
function Tarjeta({ resumen, activa, ancho }) {
  const lado = Math.min(ancho - 56, 340);
  if (resumen?.codigo && !resumen.pendiente) {
    const material = rangoReal(resumen.mayorista)?.clave ?? resumen.nivel?.clave;
    return (
      <View style={{ width: lado }}>
        <TarjetaSocio activa={activa} nivel={material} nombre={resumen.nombre} saldo={Number(resumen.saldo ?? 0)} equivale={resumen.equivale}
          codigo={resumen.codigo} socioDesde={resumen.socio_desde} equipo={!!resumen.empleado} />
      </View>
    );
  }
  const p = COLORES_NIVEL.bronce;
  return (
    <LinearGradient colors={p.frente} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{ width: lado, aspectRatio: 1.586, borderRadius: 18, padding: 20, justifyContent: 'space-between' }}>
      <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '800', letterSpacing: 1.2 }}>PUNTOS SALUD</Text>
      <View style={{ gap: 2 }}>
        <Text style={{ color: p.acento, fontSize: 12, fontWeight: '700', letterSpacing: 1 }}>{p.rotulo}</Text>
        <Text style={{ color: '#FFFFFF', fontSize: 26, fontWeight: '800' }}>0 pts</Text>
      </View>
    </LinearGradient>
  );
}

// La escalera de materiales, del de entrada al más alto, con el actual marcado.
function Escalera({ actual }) {
  const t = useTema();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 10 }}
      accessible accessibilityLabel={`Niveles: Bronce, Plata, Oro y Platino${actual ? `. El tuyo: ${ESCALERA.find(([c]) => c === actual)?.[1] ?? ''}` : ''}`}>
      {ESCALERA.map(([clave, nombre], i) => {
        const p = COLORES_NIVEL[clave];
        const tuyo = clave === actual;
        return (
          <View key={clave} style={{ alignItems: 'center', gap: 8 }}>
            <LinearGradient colors={p.frente} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ width: 62, height: 40 + i * 12, borderRadius: 10,
                borderWidth: tuyo ? 3 : 0, borderColor: t.color.magenta }} />
            <Text style={{ fontSize: 13, fontWeight: tuyo ? '800' : '600', color: tuyo ? t.color.magentaTexto : colorSistema.texto2 }}>{nombre}</Text>
          </View>
        );
      })}
    </View>
  );
}

// «Agregar a Wallet», si la cartera del teléfono está y la tarjeta no.
function BotonWallet({ resumen }) {
  const pedir = useSesion((s) => s.pedir);
  const [cargando, setCargando] = useState(false);
  const [lista, setLista] = useState(false);
  const apple = Platform.OS === 'ios' && walletDisponible() && !!resumen?.wallet_serial && !tienePase(resumen.wallet_serial);
  const google = googleWalletDisponible(resumen);
  if (lista || (!apple && !google)) return null;
  const tocar = async () => {
    if (cargando) return;
    setCargando(true);
    try {
      if (apple) {
        const ok = await sinBloquear(() => agregarDirecto(pedir, null));
        if (ok) setLista(true);
        else if (ok === null && !(await agregarPorSafari(pedir, null))) Alert.alert('No se pudo preparar la tarjeta', 'Revisa tu conexión e intenta de nuevo.');
      } else if (await sinBloquear(() => agregarAGoogleWallet(pedir, null))) setLista(true);
      else Alert.alert('No se pudo preparar la tarjeta', 'Revisa tu conexión e intenta de nuevo.');
    } finally { setCargando(false); }
  };
  return <Boton tipo="secundario" cargando={cargando} alTocar={tocar}>{apple ? 'Agregar a Apple Wallet' : 'Agregar a Google Wallet'}</Boton>;
}

// Los dos permisos de la última página, cada uno con su botón. El de avisos
// sigue el mismo camino que el interruptor de Cuenta (permiso del sistema →
// token → servidor → se recuerda en el teléfono); el de biometría, el de
// lib/bloqueo con el nombre real de lo que el teléfono tiene registrado.
function Permisos({ resumen }) {
  const pedir = useSesion((s) => s.pedir);
  const cargar = useCuenta((s) => s.cargar);
  const bloqueoActivo = useBloqueo((s) => s.activo);
  const encender = useBloqueo((s) => s.encender);
  const [biometria, setBiometria] = useState(null);
  const [avisos, setAvisos] = useState(resumen?.acepta_avisos === true ? 'listo' : null);
  const [mensaje, setMensaje] = useState(null);
  const [bloqueando, setBloqueando] = useState(false);
  useEffect(() => { nombreBiometria().then(setBiometria); }, []);
  useEffect(() => { if (resumen?.acepta_avisos === true) setAvisos('listo'); }, [resumen?.acepta_avisos]);

  const activarAvisos = async () => {
    if (avisos === 'cargando' || avisos === 'listo') return;
    setMensaje(null); setAvisos('cargando');
    const r = await pedirTokenDeAvisos().catch(() => ({ error: 'No se pudieron activar los avisos. Intenta más tarde.' }));
    if (r.error) { setMensaje(r.error); setAvisos(null); return; }
    const g = await pedir('avisos', { acepta: true, push_token: r.token });
    if (!g?.ok) { setMensaje(g?.mensaje ?? 'No se pudo guardar. Puedes activarlos después en Cuenta.'); setAvisos(null); return; }
    await recordarAvisos(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setAvisos('listo');
    cargar({ forzar: true });
  };
  const activarBloqueo = async () => {
    if (bloqueando || bloqueoActivo) return;
    setBloqueando(true);
    const ok = await encender();
    setBloqueando(false);
    if (ok) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    else Alert.alert('No se activó el bloqueo', `Para activarlo hay que confirmar ${conBiometria(biometria)}.`);
  };
  const rotuloBio = biometria === 'Face ID' || biometria === 'Touch ID' ? biometria
    : biometria === 'huella' ? 'la huella' : biometria === 'reconocimiento facial' ? 'el reconocimiento facial' : 'el bloqueo biométrico';
  return (
    <>
      {avisos === 'listo' ? <Hecho texto="Avisos activados" />
        : <Boton tipo="secundario" cargando={avisos === 'cargando'} alTocar={activarAvisos}>Activar avisos</Boton>}
      {biometria ? (bloqueoActivo ? <Hecho texto={`Bloqueo ${conBiometria(biometria)} activado`} />
        : <Boton tipo="secundario" cargando={bloqueando} alTocar={activarBloqueo}>{`Activar ${rotuloBio}`}</Boton>) : null}
      {mensaje ? <Texto nivel={2} estilo={{ textAlign: 'center', color: colorSistema.rojo, fontSize: 14 }}>{mensaje}</Texto> : null}
      <Texto nivel={3} estilo={{ textAlign: 'center', fontSize: 13 }}>Puedes cambiar las dos cosas cuando quieras en Cuenta.</Texto>
    </>
  );
}

function Hecho({ texto }) {
  const t = useTema();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48 }}>
      <Icono sf="checkmark.circle.fill" respaldo="✓" tam={20} color={t.color.verdeTexto} />
      <Text style={{ fontSize: 16, fontWeight: '600', color: colorSistema.texto }}>{texto}</Text>
    </View>
  );
}
