// El PRIMER INICIO (2026-10-14, aprobado por el usuario): seis páginas a
// pantalla completa que cuentan cómo funciona la app, una vez, después de la
// primera entrada o registro en este teléfono (lib/novedades.js decide cuándo).
// También se abre a mano desde Cuenta → «Cómo funciona la app» y desde el modo
// de prueba.
//
//   1. Tu tarjeta Puntos Salud — la tarjeta de verdad, que se toca y gira.
//   2. Tu nivel y tu cupón — la escalera de materiales.
//   3. Tienda y reservas.
//   4. Chat con la farmacia (y los recordatorios de Mis tratamientos).
//   5. Reglas y privacidad — el reglamento y el aviso, para leer y ACEPTAR.
//   6. Avisos y seguridad — los dos son opcionales y se activan aquí mismo.
//
// Pedido del usuario (2026-10-14): «que tenga botón atrás, que no se pueda
// saltar, que salgan las políticas y reglas ahí y no se pueda continuar hasta
// marcar como leído». Por eso:
//   · No hay «Saltar». «Atrás» arriba a la izquierda, deslizar hacia atrás, y
//     el botón atrás de Android va a la página anterior (en la primera no hace
//     nada: la guía no se cierra por ahí).
//   · La página 5 muestra los dos documentos enteros; cada casilla se habilita
//     al llegar al final de su documento, y «Aceptar y continuar» sólo con las
//     dos marcadas. La aceptación se guarda en el SERVIDOR (lib/aceptacion.js)
//     y si falla se dice y se reintenta: sin eso no se pasa. Hasta aceptar, la
//     página 6 ni existe, así que deslizando tampoco se pasa.
//   · Si después cambia la versión de un documento, la raíz abre esta misma
//     pantalla con `?solo=reglas`: sólo la página 5.
//   · Con la cuenta de prueba la aceptación se rehace cada vez y, si no se
//     puede guardar, se avisa pero no se traba.
//
// Se presenta como modal a pantalla completa con la animación del sistema
// (app/_layout.js). Sin parallax: los puntos de abajo son lo único que sigue
// al dedo, y con «Reducir movimiento» o en un teléfono liviano ni eso — cambian
// de golpe.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Platform, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import Animated, { Extrapolation, interpolate, runOnJS, useAnimatedScrollHandler, useAnimatedStyle, useReducedMotion, useSharedValue } from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Aurora from '../componentes/Aurora';
import Presionable from '../componentes/Presionable';
import TarjetaSocio, { COLORES_NIVEL } from '../componentes/TarjetaSocio';
import Icono from '../componentes/Icono';
import DocumentoLegal from '../componentes/DocumentoLegal';
import { Boton, Texto } from '../componentes/ui';
import { colorSistema } from '../componentes/sistema';
import { rangoReal } from '../componentes/Mayorista';
import { suave, useTema } from '../tema/tema';
import { useSesion } from '../lib/sesion';
import { fechaLarga } from '../lib/formato';
import { useCuenta } from '../lib/cuenta';
import { pedirTokenDeAvisos, recordarAvisos } from '../lib/avisos';
import { conBiometria, nombreBiometria, sinBloquear, useBloqueo } from '../lib/bloqueo';
import { marcarGuiaVista, usePresentacion } from '../lib/novedades';
import { aceptadoEnTelefono, aceptarDocumentos, documentosVigentes, ultimaAceptacion, useAceptacion } from '../lib/aceptacion';
import { LIVIANO } from '../lib/rendimiento';
import { agregarAGoogleWallet, agregarDirecto, agregarPorSafari, googleWalletDisponible, tienePase, walletDisponible } from '../modules/wallet';

const PAGINAS = 6;
const REGLAS = 4; // la página de «Reglas y privacidad» (índice)
const ESCALERA = [['bronce', 'Bronce'], ['plata', 'Plata'], ['oro', 'Oro'], ['platino', 'Platino']];
const DOCUMENTOS = [
  { clave: 'reglamento', rotulo: 'Reglamento', url: 'https://portal.farmasalud.lat/reglamento-puntos',
    casilla: 'He leído y acepto el Reglamento del programa Puntos Salud' },
  { clave: 'aviso', rotulo: 'Aviso de privacidad', url: 'https://portal.farmasalud.lat/privacidad.html',
    casilla: 'He leído y acepto el Aviso de privacidad' },
];
const NADA = { reglamento: false, aviso: false };
const TODO = { reglamento: true, aviso: true };

export default function Guia() {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const { width: ancho } = useWindowDimensions();
  const reducir = useReducedMotion() || LIVIANO;
  const { solo } = useLocalSearchParams();
  const soloReglas = solo === 'reglas';
  const resumen = useCuenta((s) => s.resumen);
  const cargarCuenta = useCuenta((s) => s.cargar);
  const prueba = !!resumen?.prueba;
  const [pagina, setPagina] = useState(0);
  const lista = useRef(null);
  const x = useSharedValue(0);
  const alDesplazar = useAnimatedScrollHandler({
    onScroll: (e) => { x.value = e.contentOffset.x; },
    onMomentumEnd: (e) => { runOnJS(setPagina)(Math.round(e.contentOffset.x / Math.max(1, ancho))); },
  });

  // Reglas y privacidad: qué versiones se aceptan, qué se leyó hasta el final,
  // qué se marcó y si ya quedó guardado.
  const [vigentes, setVigentes] = useState(() => useAceptacion.getState().vigentes);
  const [leidos, setLeidos] = useState(NADA);
  const [marcas, setMarcas] = useState(NADA);
  const [yaAceptado, setYaAceptado] = useState(false); // de antes, vigente
  const [guardado, setGuardado] = useState(false);     // ahora, en el servidor
  const [guardando, setGuardando] = useState(false);
  const [errorReglas, setErrorReglas] = useState(null);
  // La cuenta de prueba rehace la aceptación cada vez.
  const aceptado = guardado || (yaAceptado && !prueba);
  const total = soloReglas ? 1 : aceptado ? PAGINAS : REGLAS + 1; // hasta aceptar, la última no existe
  const enReglas = soloReglas || pagina === REGLAS;

  // Se marca al ABRIRLA: si cierra la app a mitad, no vuelve a salir sola (la
  // aceptación sí: la pide la raíz mientras no esté guardada).
  useEffect(() => {
    if (!soloReglas) {
      marcarGuiaVista();
      usePresentacion.getState().guiaAbierta();
    }
    if (!resumen) cargarCuenta();
    (async () => {
      const v = (await documentosVigentes()) ?? useAceptacion.getState().vigentes;
      if (v) {
        setVigentes(v);
        if (await aceptadoEnTelefono(v)) { setYaAceptado(true); setLeidos(TODO); setMarcas(TODO); }
        return;
      }
      // Sin conexión y sin versiones: vale lo que esta sesión ya aceptó aquí.
      const ultima = await ultimaAceptacion();
      if (ultima) { setVigentes(ultima); setYaAceptado(true); setLeidos(TODO); setMarcas(TODO); }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // La cuenta de prueba empieza en blanco aunque ya hubiera aceptado.
  useEffect(() => { if (prueba && !guardado) { setMarcas(NADA); setLeidos(NADA); } }, [prueba]); // eslint-disable-line react-hooks/exhaustive-deps

  const cerrar = useCallback(() => {
    if (router.canGoBack()) router.back(); else router.replace('/puntos');
  }, []);
  const ir = (n) => {
    lista.current?.scrollTo({ x: n * ancho, animated: !reducir });
    setPagina(n);
    if (reducir) x.value = n * ancho;
  };

  // Atrás de Android: la página anterior; en la primera (o sólo reglas), nada.
  const paginaRef = useRef(pagina);
  paginaRef.current = pagina;
  const irRef = useRef(ir);
  irRef.current = ir;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!soloReglas && paginaRef.current > 0) irRef.current(paginaRef.current - 1);
      return true;
    });
    return () => sub.remove();
  }, [soloReglas]);

  const despuesDeAceptar = () => {
    if (soloReglas) { cerrar(); return; }
    // La última página recién existe: se espera a que se pinte para ir.
    setTimeout(() => irRef.current(REGLAS + 1), 60);
  };
  const aceptar = async () => {
    if (guardando) return;
    setErrorReglas(null);
    setGuardando(true);
    try {
      const v = vigentes ?? (await documentosVigentes());
      if (!v) {
        if (prueba) { setGuardado(true); despuesDeAceptar(); return; }
        setErrorReglas('No se pudieron cargar los documentos. Revisa tu conexión e intenta de nuevo.');
        return;
      }
      setVigentes(v);
      const r = await aceptarDocumentos(v);
      if (r.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setGuardado(true);
        despuesDeAceptar();
        return;
      }
      if (r.motivo === 'version' && r.documentos) {
        // Cambiaron mientras se leían: se vuelven a leer y a marcar.
        setVigentes(r.documentos);
        setLeidos(NADA); setMarcas(NADA);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      if (prueba) {
        Alert.alert('Modo de prueba', `No se guardó la aceptación (${r.mensaje}). Se sigue igual.`);
        setGuardado(true);
        despuesDeAceptar();
        return;
      }
      setErrorReglas(r.mensaje);
    } finally {
      setGuardando(false);
    }
  };

  const siguiente = () => {
    Haptics.selectionAsync().catch(() => {});
    if (enReglas && !aceptado) { aceptar(); return; }
    if (soloReglas || pagina >= PAGINAS - 1) cerrar(); else ir(pagina + 1);
  };
  const atras = () => {
    if (soloReglas || pagina <= 0) return;
    Haptics.selectionAsync().catch(() => {});
    ir(pagina - 1);
  };

  const reglas = (
    <PaginaReglas ancho={ancho} leidos={leidos} marcas={marcas} aceptado={aceptado} error={errorReglas}
      alLeer={(c) => setLeidos((l) => (l[c] ? l : { ...l, [c]: true }))}
      alMarcar={(c) => { Haptics.selectionAsync().catch(() => {}); setErrorReglas(null); setMarcas((m) => ({ ...m, [c]: !m[c] })); }} />
  );
  const rotulo = enReglas && !aceptado ? 'Aceptar y continuar'
    : soloReglas || pagina >= PAGINAS - 1 ? 'Empezar' : 'Siguiente';
  const bloqueado = enReglas && !aceptado && !(marcas.reglamento && marcas.aviso);
  // 2026-10-20: un botón gris sin explicación no dice qué falta. Lo dice aquí,
  // pegado al botón, en el orden en que se exige: leer hasta el final, marcar.
  const faltanLeer = DOCUMENTOS.filter((d) => !leidos[d.clave]);
  const motivo = !bloqueado ? null
    : faltanLeer.length === 2 ? 'Baja hasta el final de los dos documentos para continuar.'
      : faltanLeer.length === 1 ? `Falta bajar hasta el final del ${faltanLeer[0].rotulo.toLowerCase()}.`
        : 'Marca las dos casillas para continuar.';

  return (
    <View style={{ flex: 1 }}>
      <Aurora activa={!reducir} />
      {/* Arriba: «Atrás» desde la segunda página. No hay «Saltar». */}
      <View style={{ paddingTop: ins.top + 6, paddingHorizontal: 8, minHeight: ins.top + 50, flexDirection: 'row', justifyContent: 'flex-start' }}>
        {!soloReglas && pagina > 0 ? (
          <Presionable onPress={atras} hitSlop={10} accessibilityRole="button" accessibilityLabel="Atrás"
            style={({ pressed }) => ({ minHeight: 44, minWidth: 44, paddingHorizontal: 8, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 2, opacity: pressed ? 0.6 : 1 })}>
            <Icono sf="chevron.left" respaldo="‹" tam={20} color={t.color.magentaTexto} />
            <Text style={{ fontSize: 17, fontWeight: Platform.OS === 'ios' ? '400' : '600', color: t.color.magentaTexto }}>Atrás</Text>
          </Presionable>
        ) : null}
      </View>

      {soloReglas ? <View style={{ flex: 1 }}>{reglas}</View> : (
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
              ? (resumen?.nivel?.desde ? `Los niveles empiezan el ${fechaLarga(resumen.nivel.desde)}, con el reglamento nuevo.` : 'Los niveles se activan pronto, según el reglamento vigente.')
              : 'Los niveles y sus beneficios siguen el reglamento vigente.'}>
            {/* 2026-10-19: apagados, sin prometer beneficios que el reglamento
                vigente no da; encendidos, sin nombrar niveles a mano (el
                raspable se configura en el portal y puede cambiar de nivel). */}
            {resumen?.nivel?.activos === false
              ? 'Cuando se activen, tu nivel saldrá de lo que compraste en los últimos 12 meses.'
              : 'Mientras más compras, mejor tu material y tus beneficios. Mira los de tu nivel en Mis puntos.'}
          </Pagina>
          <Pagina ancho={ancho} titulo="Tienda y reservas" arte={<Insignia sf="bag.fill" respaldo="◍" color={t.color.magenta} texto={t.color.magentaTexto} />}>
            Aparta productos y retíralos sin hacer fila. Si llevan receta, súbela con una foto.
          </Pagina>
          <Pagina ancho={ancho} titulo="Chat con la farmacia" arte={<Insignia sf="bubble.left.and.bubble.right.fill" respaldo="✉" color={t.color.verde} texto={t.color.verdeTexto} />}
            nota="En Mis tratamientos te recordamos tus tomas y cuándo te toca volver a comprar.">
            Pregúntanos por un medicamento, su precio o si lo tenemos. Te responde nuestro equipo.
          </Pagina>
          {reglas}
          {aceptado ? (
            <Pagina ancho={ancho} titulo="Avisos y seguridad" arte={<Insignia sf="bell.badge" respaldo="!" color={t.color.magenta} texto={t.color.magentaTexto} />}
              extra={<Permisos resumen={resumen} />}>
              Te avisamos cuando ganas puntos, cuando tu reserva está lista y cuando te responden en el chat. Y puedes pedir tu huella o tu cara al abrir la app, para que nadie más vea tu saldo. Las dos cosas son opcionales.
            </Pagina>
          ) : null}
        </Animated.ScrollView>
      )}

      {/* Abajo: los puntos y el botón principal. */}
      <View style={{ paddingHorizontal: 24, paddingBottom: ins.bottom + 16, paddingTop: 8, gap: 18, width: '100%', maxWidth: 520, alignSelf: 'center' }}>
        {soloReglas ? null : (
          <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}
            accessible accessibilityRole="adjustable" accessibilityLabel={`Página ${pagina + 1} de ${PAGINAS}`}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(e) => {
              if (e.nativeEvent.actionName === 'increment' && pagina < total - 1) ir(pagina + 1);
              if (e.nativeEvent.actionName === 'decrement' && pagina > 0) ir(pagina - 1);
            }}>
            {Array.from({ length: PAGINAS }, (_, i) => (
              <Punto key={i} i={i} x={x} ancho={ancho} activo={pagina === i} quieto={reducir} />
            ))}
          </View>
        )}
        {motivo ? (
          <Texto nivel={2} estilo={{ textAlign: 'center', fontSize: 14, lineHeight: 19, marginBottom: -8 }}>{motivo}</Texto>
        ) : null}
        <Boton alTocar={siguiente} cargando={guardando} deshabilitado={bloqueado}>{rotulo}</Boton>
      </View>
    </View>
  );
}

// «Reglas y privacidad»: los dos documentos enteros, uno a la vez, con texto
// nativo (componentes/DocumentoLegal: la misma página publicada en el portal,
// la que se archiva como prueba). Cada casilla se habilita al llegar al final de
// su documento; tocar una todavía cerrada lleva a ese documento.
//
// 2026-10-20, el dueño: «no se entiende arriba para seleccionar el otro, ni que
// debe leer todo». Lo de arriba eran dos píldoras que parecían etiquetas, y
// nada decía que el botón se habilita al bajar hasta el final. Ahora:
//   · arriba, PASOS numerados («1 Reglamento», «2 Aviso de privacidad») que
//     dicen «Paso 1 de 2» y se tachan con ✓ al leerse — se ve que son dos y en
//     qué orden;
//   · debajo, una barra con cuánto se leyó del documento abierto y qué falta;
//   · al final del primero, un botón «Siguiente: Aviso de privacidad».
// Lo que se exige no cambió: llegar al final de cada uno y marcar las dos.
function PaginaReglas({ ancho, leidos, marcas, aceptado, error, alLeer, alMarcar }) {
  const t = useTema();
  const [doc, setDoc] = useState('reglamento');
  const [pista, setPista] = useState(null);
  // Lo más lejos que se bajó en cada documento (0 a 1): la barra no retrocede
  // si la persona sube a releer algo.
  const [avance, setAvance] = useState({ reglamento: 0, aviso: 0 });
  const indice = DOCUMENTOS.findIndex((d) => d.clave === doc);
  const actual = DOCUMENTOS[indice];
  const otro = DOCUMENTOS.find((d) => d.clave !== doc);
  const leido = !!leidos[doc] || aceptado;
  const fraccion = leido ? 1 : avance[doc];
  const elegir = (clave) => { setDoc(clave); setPista(null); Haptics.selectionAsync().catch(() => {}); };
  const avanzar = useCallback((f) => {
    setAvance((a) => (f > a[doc] + 0.01 || (f === 1 && a[doc] < 1) ? { ...a, [doc]: f } : a));
  }, [doc]);

  // Al pie del documento: el paso siguiente, donde la persona termina de leer.
  const pie = aceptado ? null : !leidos[otro.clave] ? (
    <View style={{ marginTop: 8, gap: 8 }}>
      <Texto nivel={3} estilo={{ textAlign: 'center', fontSize: 13 }}>
        {leido ? `Listo, terminaste el ${actual.rotulo.toLowerCase()}.` : `Fin del ${actual.rotulo.toLowerCase()}.`}
      </Texto>
      <Boton alTocar={() => elegir(otro.clave)}>{`Siguiente: ${otro.rotulo}`}</Boton>
    </View>
  ) : (
    <Texto nivel={3} estilo={{ textAlign: 'center', fontSize: 13, marginTop: 8 }}>
      Leíste los dos. Marca las casillas de abajo para aceptarlos.
    </Texto>
  );

  return (
    <View style={{ width: ancho, flex: 1, paddingHorizontal: 20, paddingTop: 4 }}>
      <View style={{ flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center', gap: 10 }}>
        <View style={{ gap: 4, alignItems: 'center' }}>
          <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: '800', letterSpacing: -0.4, textAlign: 'center', color: colorSistema.texto }}>Reglas y privacidad</Text>
          <Texto nivel={2} estilo={{ textAlign: 'center', fontSize: 15, lineHeight: 21 }}>
            {aceptado ? 'Ya los aceptaste. Puedes volver a leerlos cuando quieras en Cuenta.'
              : 'Son dos documentos. Lee cada uno hasta el final y luego marca que los aceptas para continuar.'}
          </Texto>
        </View>

        {/* Los pasos: se tocan para pasar de uno a otro. */}
        <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="tablist">
          {DOCUMENTOS.map((d, i) => {
            const elegido = d.clave === doc;
            const listo = !!leidos[d.clave] || aceptado;
            return (
              <Presionable key={d.clave} onPress={() => elegir(d.clave)} accessibilityRole="tab"
                accessibilityState={{ selected: elegido }}
                accessibilityLabel={`Paso ${i + 1} de ${DOCUMENTOS.length}: ${d.rotulo}${listo ? ', leído' : ', sin leer'}`}
                accessibilityHint={elegido ? undefined : 'Abre este documento.'}
                style={({ pressed }) => ({ flex: 1, minHeight: 56, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 14,
                  flexDirection: 'row', alignItems: 'center', gap: 8,
                  backgroundColor: elegido ? suave(t.color.magenta, t.oscuro ? 0.32 : 0.16) : colorSistema.superficie,
                  borderWidth: elegido ? 2 : 1, borderColor: elegido ? t.color.magenta : colorSistema.contornoSuave, opacity: pressed ? 0.7 : 1 })}>
                <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: listo ? suave(t.color.verde, t.oscuro ? 0.3 : 0.18) : elegido ? t.color.magenta : 'transparent',
                  borderWidth: listo || elegido ? 0 : 1.5, borderColor: colorSistema.texto2 }}>
                  {listo ? <Icono sf="checkmark" respaldo="✓" tam={14} color={t.color.verdeTexto} />
                    : <Text style={{ fontSize: 14, fontWeight: '800', color: elegido ? '#FFFFFF' : colorSistema.texto2 }}>{i + 1}</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: colorSistema.texto2 }}>
                    {`Paso ${i + 1} de ${DOCUMENTOS.length}${listo ? ' · leído' : ''}`}
                  </Text>
                  <Text numberOfLines={2} style={{ fontSize: 15, lineHeight: 19, fontWeight: elegido ? '700' : '600', color: elegido ? t.color.magentaTexto : colorSistema.texto }}>{d.rotulo}</Text>
                </View>
              </Presionable>
            );
          })}
        </View>

        {/* Cuánto se leyó del abierto, y qué falta. */}
        <View style={{ gap: 4 }} accessible accessibilityRole="progressbar"
          accessibilityLabel={`${actual.rotulo}: ${leido ? 'leído hasta el final' : `leído ${Math.round(fraccion * 100)} por ciento`}`}
          accessibilityValue={{ min: 0, max: 100, now: Math.round(fraccion * 100) }}>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: colorSistema.contornoSuave, overflow: 'hidden' }}>
            <View style={{ height: 6, borderRadius: 3, width: `${Math.round(fraccion * 100)}%`, backgroundColor: leido ? t.color.verde : t.color.magenta }} />
          </View>
          <Texto nivel={3} estilo={{ fontSize: 13 }}>
            {leido ? `${actual.rotulo}: leído hasta el final ✓`
              : `${actual.rotulo}: ${Math.round(fraccion * 100)} % · baja hasta el final para poder aceptarlo`}
          </Texto>
        </View>

        <View style={{ flex: 1, minHeight: 160, borderRadius: 16, borderWidth: 1, borderColor: colorSistema.contornoSuave,
          backgroundColor: colorSistema.superficie, overflow: 'hidden' }}>
          <DocumentoLegal key={actual.clave} url={actual.url} incrustado pie={pie}
            alAvanzar={avanzar} alFinal={() => alLeer(actual.clave)} />
        </View>
        <View style={{ gap: 2 }}>
          {DOCUMENTOS.map((d) => (
            <Casilla key={d.clave} texto={d.casilla} marcada={!!marcas[d.clave]} habilitada={!aceptado && !!leidos[d.clave]} fija={aceptado}
              alTocar={() => {
                if (aceptado) return;
                if (!leidos[d.clave]) { setDoc(d.clave); setPista(`Lee el ${d.rotulo.toLowerCase()} hasta el final para poder marcarlo.`); return; }
                setPista(null);
                alMarcar(d.clave);
              }} />
          ))}
          {pista ? <Texto nivel={3} estilo={{ textAlign: 'center', fontSize: 13 }}>{pista}</Texto> : null}
          {error ? <Texto nivel={2} estilo={{ textAlign: 'center', color: colorSistema.rojo, fontSize: 14 }}>{error}</Texto> : null}
        </View>
      </View>
    </View>
  );
}

// Una casilla de aceptación. Antes de leer el documento se ve atenuada (pero
// se puede tocar: lleva al documento y dice por qué no se marca todavía).
function Casilla({ texto, marcada, habilitada, fija, alTocar }) {
  const t = useTema();
  const atenuada = !habilitada && !fija && !marcada;
  return (
    <Presionable onPress={alTocar} accessibilityRole="checkbox" accessibilityLabel={texto}
      accessibilityState={{ checked: marcada, disabled: !habilitada }}
      accessibilityHint={habilitada || fija ? undefined : 'Primero lee el documento hasta el final.'}
      style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6, opacity: pressed ? 0.6 : atenuada ? 0.55 : 1 })}>
      <Icono sf={marcada ? 'checkmark.square.fill' : 'square'} respaldo={marcada ? '☑' : '☐'} tam={24}
        color={marcada ? t.color.magenta : colorSistema.texto2} />
      <Text style={{ flex: 1, fontSize: 15, lineHeight: 20, color: colorSistema.texto }}>{texto}</Text>
    </Presionable>
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
    const g = await pedir('avisos', { acepta: true, push_token: r.token, formato: r.formato, responde: !!r.responde });
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
