// Mis puntos. Se habla en DÓLARES primero —«$4.20 de descuento» se entiende,
// «420 puntos» no— y el número de puntos va como el detalle de la cifra.
// Misma decisión que /mis-puntos de la web.
import { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Platform, Text, useWindowDimensions, View } from 'react-native';
import Presionable from '../../../componentes/Presionable';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as Haptics from 'expo-haptics';
import { Aviso, Cargando, Pantalla, Seccion, Tarjeta, Texto, Titulo, Vacio } from '../../../componentes/ui';
import { useCuenta } from '../../../lib/cuenta';
import { diasHasta, dolares, entero, fechaLarga, nombrePropio } from '../../../lib/formato';
import TarjetaSocio from '../../../componentes/TarjetaSocio';
import AvatarInicio from '../../../componentes/AvatarInicio';
import Nivel from '../../../componentes/Nivel';
import Mayorista, { BeneficiosEquipo, Equipo, rangoDePrueba, rangoReal } from '../../../componentes/Mayorista';
import Cupon from '../../../componentes/Cupon';
import SubisteDeNivel from '../../../componentes/SubisteDeNivel';
import Vencimientos from '../../../componentes/Vencimientos';
import Cumpleanos from '../../../componentes/Cumpleanos';
import Historias from '../../../componentes/Historias';
import Icono from '../../../componentes/Icono';
import FraseDelDia from '../../../componentes/FraseDelDia';
import { useVisible } from '../../../lib/visible';
import { BarraAnimada, Confeti, Entrada, Latido, NumeroAnimado, Tocable } from '../../../componentes/animacion';
import { useConCodigo, useSesion } from '../../../lib/sesion';
import { alLlegarAviso, sincronizarAvisos } from '../../../lib/avisos';
import { cuponDePrueba, nivelDePrueba, raspableDePrueba, useModoPrueba } from '../../../lib/prueba';
import { resumenConDemo, useDemo } from '../../../lib/demo';
import { BotonWalletNativo, abrirPase, agregarAGoogleWallet, agregarDirecto, agregarPorSafari, googleWalletDisponible, tienePase, walletDisponible } from '../../../modules/wallet';
import { suave, useTema } from '../../../tema/tema';
import { colorSistema } from '../../../componentes/sistema';
import { navegar } from '../../../lib/navegar';
import { sinBloquear } from '../../../lib/bloqueo';
import { useDesplazamiento } from '../../../lib/desplazamiento';
import { useShallow } from 'zustand/react/shallow';

const MINIMO_DE_CANJE = 100;
let confetiMostrado = false;
const marcarConfeti = () => { confetiMostrado = true; };

export default function Puntos() {
  const t = useTema();
  // Los `ver*` (modo de prueba y avisos) llegan con un valor que cambia en cada
  // toque (2026-10-20): con un '1' fijo, la segunda vez no volvía a abrirse.
  const { cumple, nivel: verNivel, rango: verRango, precio: verPrecio, mayoreo: verMayoreo, tunivel: verTuNivel } = useLocalSearchParams();
  // Sólo lo que esta pantalla pinta (2026-10-14): con el almacén entero, cada
  // `cargando: true/false` de una consulta repintaba el Inicio completo.
  const { resumen: crudo, error, cargar, generacion } = useCuenta(useShallow((s) => ({
    resumen: s.resumen, error: s.error, cargar: s.cargar, generacion: s.generacion,
  })));
  // El demo del modo de prueba (2026-10-20): las reservas y el saldo a favor de
  // muestra cuentan en el Inicio como si fueran reales (lib/demo.js).
  const demo = useDemo();
  // Antes de cualquier `return`: es un hook.
  const sesionDeCodigo = useConCodigo();
  const real = useMemo(() => resumenConDemo(crudo, demo), [crudo, demo]);
  // Modo de prueba (sólo la cuenta de prueba): se ve como el nivel elegido.
  const prueba = useModoPrueba();
  const enPrueba = !!real?.prueba && prueba.activo;
  // En prueba el saldo se puede mover a mano («Simular: ganar/usar puntos») para ver la animación.
  const saldoPrueba = enPrueba && real ? Math.max(0, Number(real.saldo ?? 0) + prueba.ajuste) : null;
  // Cliente Mayorista (Condiciones, cláusula 5): NO tiene nivel de Puntos
  // Salud, sólo su rango. La raspable: Zafiro como Oro; Rubí y Diamante como Platino.
  // El rango: de prueba, o el real si Administración lo aprobó.
  const mayoristaReal = !enPrueba ? rangoReal(real?.mayorista, real?.programa) : null;
  const mayorista = enPrueba ? prueba.mayorista : mayoristaReal?.clave ?? null;
  // Empleado activo (2026-10-08): lleva la tarjeta de SU nivel de cliente, o la
  // de su rango si Administración lo aprobó como mayorista, con el sello de
  // Equipo encima. Acumula puntos en lo que compra a precio Preferente o más.
  const empleado = enPrueba ? !!prueba.empleado : !!real?.empleado;
  const material = mayorista;
  // El raspable de muestra (2026-10-19): con los premios CONFIGURADOS en el
  // portal para ese nivel o, si se mira como mayorista, para ese rango
  // (`resumen.programa`). Se arma UNA vez: su premio es al azar.
  const programa = real?.programa ?? null;
  const fuenteRaspable = enPrueba ? raspableDePrueba(programa, { nivel: prueba.nivel, mayorista }) : null;
  const cuponPrueba = useMemo(() => cuponDePrueba(fuenteRaspable, prueba.semilla, prueba.cuponUsado),
    [fuenteRaspable, prueba.semilla, prueba.cuponUsado]);
  const resumen = enPrueba ? { ...real, nivel: mayorista ? null : nivelDePrueba(prueba.nivel, programa), cupon: cuponPrueba,
    saldo: saldoPrueba, equivale: saldoPrueba / 100 } : real;

  // Sumar y restar se VEN (2026-10-08): el último saldo que se mostró queda en
  // el teléfono; si el nuevo es distinto, la tarjeta cuenta desde el anterior.
  const saldoActual = resumen && !resumen.pendiente ? Number(resumen.saldo ?? 0) : null;
  const claveSaldo = `puntos_salud_saldo_visto_${String(resumen?.codigo ?? '').replace(/[^\w]/g, '')}`;
  const [movSaldo, setMovSaldo] = useState({ previo: null, cambio: null });
  useEffect(() => {
    if (saldoActual == null || !resumen?.codigo) return;
    SecureStore.getItemAsync(claveSaldo).catch(() => null).then((v) => {
      const antes = v == null ? null : Number(v);
      if (antes != null && Number.isFinite(antes) && antes !== saldoActual) {
        setMovSaldo({ previo: { saldo: antes, equivale: antes / 100 }, cambio: { id: Date.now(), delta: saldoActual - antes } });
      }
      SecureStore.setItemAsync(claveSaldo, String(saldoActual)).catch(() => {});
    });
  }, [saldoActual, claveSaldo]); // eslint-disable-line react-hooks/exhaustive-deps
  const visible = useVisible();
  const [refrescando, setRefrescando] = useState(false);
  const pedir = useSesion((s) => s.pedir);

  // Al volver a la pestaña sólo se pide si el resumen tiene más de un minuto.
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  // Los avisos de este teléfono: si ya los había aceptado, la sesión nueva los
  // retoma sola (ver lib/avisos.js).
  const acepta = resumen?.acepta_avisos;
  const conResumen = !!resumen && !resumen.pendiente;
  useEffect(() => { if (conResumen) sincronizarAvisos(pedir, acepta === true); }, [conResumen, acepta, pedir]);

  const refrescar = async () => { setRefrescando(true); await cargar({ forzar: true }); setRefrescando(false); };

  if (!resumen && !error) return <Cargando />;
  if (!resumen) {
    return (
      <Pantalla alRefrescar={refrescar} refrescando={refrescando}>
        <Vacio titulo="No se pudo cargar" accion="Reintentar" alAccion={refrescar}>{error}</Vacio>
      </Pantalla>
    );
  }

  if (resumen.pendiente) {
    return (
      <Pantalla alRefrescar={refrescar} refrescando={refrescando}>
        <Tarjeta tono={t.color.verde}>
          <Titulo>¡Ya casi!</Titulo>
          <Texto>
            Tu registro está guardado. En tu próxima compra en cualquiera de nuestras salas di que te uniste desde la
            app y muestra tu DUI: desde esa compra empiezas a acumular.
          </Texto>
          <Texto nivel={3}>Mientras tanto ya puedes ver las ofertas.</Texto>
        </Tarjeta>
      </Pantalla>
    );
  }

  const saldo = Number(resumen.saldo ?? 0);
  const falta = Math.max(0, MINIMO_DE_CANJE - saldo);
  const congelado = resumen.consentimiento?.programa === false;
  const conCodigo = sesionDeCodigo || resumen.alcance === 'codigo';
  const urgentes = (Array.isArray(resumen.tratamientos) ? resumen.tratamientos : [])
    .filter((x) => { const d = diasHasta(x.se_acaba); return d != null && d <= 3; });
  const primerNombre = nombrePropio(String(resumen.nombre ?? '').split(' ')[0]);

  return (
    // `sinVidrio`: las tarjetas de esta lista, en el relleno del vidrio sin el
    // vidrio vivo (ver Pantalla en componentes/ui.js). La aurora de atrás
    // está quieta (puntos/_layout.js), así que se ven iguales.
    <Pantalla alRefrescar={refrescar} refrescando={refrescando} sinVidrio sinBarra>
      {enPrueba ? (
        <Presionable onPress={() => navegar('/cuenta')} accessibilityRole="button" hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
          accessibilityLabel="Modo de prueba activo. Cambiarlo en Cuenta" accessibilityHint="Abre Cuenta, donde se elige el nivel de prueba"
          style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FF9F0A', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, minHeight: 28 }}>
          <Icono sf="testtube.2" respaldo="" tam={12} color="#1A1000" />
          <Text style={{ flexShrink: 1, fontSize: 12, fontWeight: '800', color: '#1A1000' }}>MODO DE PRUEBA · {String(`${mayorista ? `Mayoreo ${rangoDePrueba(mayorista, real?.programa).nombre}` : resumen.nivel?.nombre ?? ''}${empleado ? ' · Team' : ''}`).toUpperCase()}</Text>
        </Presionable>
      ) : null}
      <SubisteDeNivel nivel={resumen.nivel} forzar={verNivel || false} mayoreo={mayorista ? (mayoristaReal ?? rangoDePrueba(mayorista, real?.programa)) : null}
        forzarRango={verRango || false} forzarPrecio={verPrecio || false} forzarBienvenida={verMayoreo || false} forzarTuNivel={verTuNivel || false} />
      <Cumpleanos activo={!!resumen.cumpleanos} forzar={cumple ? String(cumple) : false} nombre={primerNombre} puntos={resumen.regalo_cumpleanos} />
      {/* Encima de todo (zIndex): la tarjeta de abajo gira y se escala, y no puede tapar la campana. */}
      <Entrada indice={0} estilo={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 2 }}>
        {/* La foto junto al saludo (2026-10-20): más personal; sin foto, la
            invitación a ponerla. Con la sesión de código no hay foto. */}
        {!conCodigo && !resumen.pendiente ? (
          <View style={{ marginRight: 12 }}>
            <AvatarInicio codigo={resumen.codigo} nombre={resumen.nombre} equipo={empleado}
              material={material ?? resumen.nivel?.clave ?? null} />
          </View>
        ) : null}
        {/* El saludo ES el título del Inicio (2026-10-20): sin la barra de «Inicio» encima. */}
        <Text accessibilityRole="header" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={1.3}
          style={{ flex: 1, fontSize: 30, fontWeight: '800', letterSpacing: -0.6, color: colorSistema.texto }}>
          {resumen.cumpleanos ? `¡Feliz cumpleaños, ${primerNombre}!` : `Hola, ${primerNombre}`}
        </Text>
        <Campana generacion={generacion} />
      </Entrada>

      {/* Mis créditos (2026-10-15): si alguno pasó su fecha límite, la alerta
          va ARRIBA de todo. Sin créditos pendientes no se muestra nada. */}
      {resumen.creditos?.vencidos > 0 ? (
        <Entrada indice={0}>
          <AlertaCreditos vencidos={resumen.creditos.vencidos} />
        </Entrada>
      ) : null}

      {/* Historias: promociones e información, tipo estados. */}
      <Historias generacion={generacion} />

      {/* La tarjeta de socio: saldo al frente, código y QR al reverso. */}
      <TarjetaEnVista activa={visible} equipo={empleado} estiloLogo={enPrueba ? prueba.logo : 'material'} nivel={material ?? resumen.nivel?.clave} nombre={resumen.nombre} saldo={saldo} equivale={resumen.equivale}
        previo={movSaldo.previo} cambio={movSaldo.cambio}
        codigo={resumen.codigo} socioDesde={resumen.socio_desde} aFavor={resumen.saldo_a_favor?.total} />

      {/* Apple Wallet, justo debajo de la tarjeta (usuario, 2026-10-08): la tarjeta en la Cartera, para mostrarla en caja sin abrir la app. */}
      {Platform.OS === 'ios' ? (
        <Entrada indice={1}>
          <BotonWallet serial={resumen.wallet_serial} nivelPrueba={enPrueba ? `${material ?? prueba.nivel}${empleado ? '+equipo' : ''}` : null} />
        </Entrada>
      ) : googleWalletDisponible(resumen) ? (
        <Entrada indice={1}>
          <BotonGoogleWallet nivelPrueba={enPrueba ? `${material ?? prueba.nivel}${empleado ? '+equipo' : ''}` : null} />
        </Entrada>
      ) : null}

      {/* El nivel: Bronce, Plata, Oro o Platino, y cuánto falta. Justo
          debajo de la tarjeta (usuario, 2026-10-07). */}
      {/* Cliente Mayorista (el aprobado, o el modo de prueba): su rango, arriba del nivel de puntos. */}
      {mayorista ? (
        <Entrada indice={1}>
          <Mayorista rango={mayoristaReal ?? rangoDePrueba(mayorista, real?.programa)} pie={empleado ? <BeneficiosEquipo mayoreo={mayoristaReal ?? rangoDePrueba(mayorista, real?.programa)} /> : null} />
        </Entrada>
      ) : null}
      {/* Sin panel de nivel (niveles apagados), los beneficios de Equipo van solos. */}
      {empleado && !mayorista && !resumen.nivel ? (
        <Entrada indice={1}>
          <Equipo />
        </Entrada>
      ) : null}
      {/* Con los niveles apagados (Reglamento v2 sin publicar) el panel se muestra igual y lo explica; antes no se
          muestra la escalera; en el modo de prueba, sí. */}
      {resumen.nivel && !mayorista ? (
        <Entrada indice={1}>
          <Nivel nivel={resumen.nivel} pie={empleado ? <BeneficiosEquipo /> : null} />
        </Entrada>
      ) : null}

      {/* El estado del canje (2026-10-09: justo debajo del nivel, pedido del usuario). El saldo cuenta hacia arriba y la barra se llena
          con resorte: lo primero que se ve MOVERSE es lo que la persona tiene. */}
      <Entrada indice={2}>
        <Tarjeta tono={falta > 0 ? t.color.magenta : t.color.verde} estilo={{ gap: 10 }}>
          {falta > 0 ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                <NumeroAnimado valor={saldo} formato="entero" estilo={{ fontSize: 28, fontWeight: '800', color: t.color.magentaTexto }} />
                <Texto nivel={2} estilo={{ flexShrink: 1 }}>de {MINIMO_DE_CANJE} puntos para tu primer canje</Texto>
              </View>
              <BarraAnimada avance={saldo / MINIMO_DE_CANJE} color={t.color.magenta} fondo={suave(t.color.magenta, 0.18)} />
              <Texto nivel={2} estilo={{ fontSize: 14 }}>Te faltan {entero(falta)} puntos.</Texto>
            </>
          ) : (
            <>
              <Latido estilo={{ alignSelf: 'flex-start' }}>
                <View style={{ backgroundColor: t.color.verde, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 }}>
                  <Text style={{ fontSize: 15, fontWeight: '800', color: '#1A2600' }}>¡Ya puedes canjear!</Text>
                </View>
              </Latido>
              <Texto nivel={2} estilo={{ fontSize: 14 }}>
                Tienes <Text style={{ fontWeight: '800', color: t.color.verdeTexto }}>{dolares(resumen.equivale)}</Text> para descontar. Toca tu tarjeta y muestra el código en caja.
              </Texto>
            </>
          )}
        </Tarjeta>
        {/* Fuera de la tarjeta (que recorta) y UNA vez por sesión. */}
        {falta === 0 && !confetiMostrado ? <Confeti colores={[t.color.verde, t.color.magenta, '#FFD60A', '#5AC8FA']} alTerminar={marcarConfeti} /> : null}
      </Entrada>

      {/* El cupón del mes (Platino): saldo de regalo que vence a fin de mes. */}
      {resumen.cupon ? (
        <Entrada indice={2}>
          <Cupon cupon={resumen.cupon} nivel={mayorista ?? resumen.nivel?.clave} activa={visible} fondo={Platform.OS === 'android' ? colorSistema.fondo : (t.oscuro ? '#0A090E' : '#F5F4F8')} demo={enPrueba ? prueba.demoCupon : 0} alCambiar={() => cargar({ forzar: true })} />
        </Entrada>
      ) : null}

      {/* Una encuesta por responder: paga puntos. */}
      {resumen.encuesta ? (
        <Entrada indice={2}>
          <Tocable alTocar={() => navegar(`/encuesta?id=${resumen.encuesta.id}`)}>
            <Tarjeta estilo={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: suave(t.color.magenta, t.oscuro ? 0.28 : 0.15) }}>
                <Icono sf="checklist" respaldo="📝" tam={20} color={t.color.magentaTexto} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 16, fontWeight: '800', color: colorSistema.texto }}>Gana {entero(resumen.encuesta.puntos)} puntos</Text>
                <Text style={{ fontSize: 14, color: colorSistema.texto2 }} numberOfLines={2}>Responde «{resumen.encuesta.nombre}» en un par de minutos.</Text>
              </View>
              <Icono sf="chevron.right" respaldo="›" tam={14} color={colorSistema.texto2} />
            </Tarjeta>
          </Tocable>
        </Entrada>
      ) : null}

      {/* La frase del día (2026-11-03): lista a las 8:00; tocarla abre Bienestar. */}
      <Entrada indice={2}>
        <FraseDelDia />
      </Entrada>

      {/* Mis tratamientos: arriba SÓLO lo que se acaba en 3 días o menos; la
          lista completa está en el menú. */}
      {urgentes.length ? (
        <Entrada indice={2}>
          <TratamientosInicio lista={urgentes} />
        </Entrada>
      ) : null}

      {congelado ? (
        <Aviso tipo="aviso">Tu saldo está en pausa porque no aceptaste el programa. Puedes volver a aceptarlo en Cuenta.</Aviso>
      ) : null}

      {resumen.vencimientos?.length ? (
        <Entrada indice={3}>
          <Vencimientos vencimientos={resumen.vencimientos} />
        </Entrada>
      ) : null}

      {/* Lo que queda del cupón del mes vence con el mes (2026-10-14): se dice
          con la fecha exacta. Sólo ya raspado. */}
      {resumen.cupon?.raspado && !resumen.cupon.descuento && Number(resumen.cupon.restantes) > 0 && (diasHasta(resumen.cupon.vence) ?? -1) >= 0 ? (
        <Entrada indice={3}>
          <Tarjeta estilo={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Icono sf="clock.badge.exclamationmark.fill" respaldo="⏰" tam={22} color={colorSistema.naranja} />
            <Text style={{ flex: 1, fontSize: 14, lineHeight: 19, color: colorSistema.texto }}>
              <Text style={{ fontWeight: '800' }}>{entero(resumen.cupon.restantes)} puntos son del cupón del mes. </Text>
              {`Vencen el ${fechaLarga(resumen.cupon.vence)} — úsalos este mes: si no los canjeas, se pierden.`}
            </Text>
          </Tarjeta>
        </Entrada>
      ) : null}

      {/* El menú (2026-11-03): seis accesos, los más usados (ver `Menu`). El
          resto vive en Cuenta, y «Todo» lleva allá. El punto rojo es lo que
          pide atención. */}
      <Entrada indice={4} estilo={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flexShrink: 1 }}><Seccion>Lo tuyo</Seccion></View>
        <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); navegar('/cuenta'); }} accessibilityRole="button"
          accessibilityLabel="Ver todo en Cuenta" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, opacity: pressed ? 0.6 : 1 })}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: t.color.magentaTexto }}>Ver todo</Text>
          <Icono sf="chevron.right" respaldo="›" tam={12} color={t.color.magentaTexto} />
        </Presionable>
      </Entrada>
      <Entrada indice={4}>
        <Menu resumen={resumen} urgentes={urgentes.length} />
      </Entrada>
    </Pantalla>
  );
}

// La tarjeta de socio, que se APAGA cuando queda fuera de la vista (2026-10-14,
// «el Inicio se siente lento»): con la lista desplazada hacia abajo, su
// material, su luz y el giroscopio seguían trabajando para nadie. Se decide al
// terminar cada desplazamiento (lib/desplazamiento.js), no cuadro a cuadro, y
// sólo se repinta este bloque, no el Inicio entero.
function TarjetaEnVista({ activa, ...props }) {
  const caja = useRef(null);
  const enVista = useDesplazamiento((e) => {
    const c = caja.current;
    if (!c || !e.alto) return true;
    return e.y < c.y + c.alto && e.y + e.alto > c.y;
  });
  const medir = useCallback((ev) => {
    const { y, height } = ev.nativeEvent.layout;
    caja.current = { y, alto: height };
  }, []);
  return (
    <Entrada indice={1} alMedir={medir}>
      <TarjetaSocio activa={activa && enVista} {...props} />
    </Entrada>
  );
}

// Apple Wallet. La tarjeta se agrega con la HOJA de Apple dentro de la app
// (modules/wallet): el servidor la firma y la manda en base64 — sin abrir
// Safari ni mostrar la dirección del servidor. Si ya está en Wallet, el botón
// cambia a «Ver en Wallet» (antes seguía ofreciendo agregarla, 2026-10-06).
function BotonWallet({ serial, nivelPrueba }) {
  const pedir = useSesion((s) => s.pedir);
  const [cargando, setCargando] = useState(false);
  const [tiene, setTiene] = useState(() => (serial ? tienePase(serial) : false));
  // Al volver a la app (pudo quitarla en Wallet) se vuelve a preguntar.
  useEffect(() => {
    if (!serial) return undefined;
    setTiene(tienePase(serial));
    const sub = AppState.addEventListener('change', (e) => { if (e === 'active') setTiene(tienePase(serial)); });
    return () => sub.remove();
  }, [serial]);
  useFocusEffect(useCallback(() => { if (serial) setTiene(tienePase(serial)); }, [serial]));
  // Ya está en Wallet: el botón se va (se abre desde Cuenta). Sólo invita a
  // agregarla mientras no esté (pedido del usuario, 2026-10-06).
  // En modo de prueba se muestra siempre: es para ver la tarjeta de cada nivel.
  if (!walletDisponible() || (tiene && !nivelPrueba)) return null;

  const tocar = async () => {
    if (cargando) return;
    if (tiene && abrirPase(serial)) return;
    setCargando(true);
    // Directo a Wallet (2026-10-08): la tarjeta se baja acá y la hoja de Apple
    // se presenta en una ventana propia. Si algo falla, por Safari.
    const ok = await agregarDirecto(pedir, nivelPrueba);
    if (ok === null && !(await agregarPorSafari(pedir, nivelPrueba))) {
      Alert.alert('No se pudo preparar la tarjeta', 'Revisa tu conexión e intenta de nuevo.');
    }
    if (ok) setTiene(tienePase(serial));
    setCargando(false);
  };
  // El botón oficial de Apple (PKAddPassButton) cuando está en la compilación;
  // el dibujado a mano queda de respaldo.
  if (BotonWalletNativo && !tiene) {
    return (
      <View style={{ alignSelf: 'center', width: 260, height: 48, opacity: cargando ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Agregar a Apple Wallet">
        <BotonWalletNativo style={{ width: 260, height: 48 }} onAgregar={tocar} />
      </View>
    );
  }
  return (
    <Presionable onPress={tocar} accessibilityRole="button" accessibilityLabel={tiene ? 'Ver en Apple Wallet' : 'Agregar a Apple Wallet'}
      style={({ pressed }) => ({
        alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#000000',
        borderRadius: 12, paddingHorizontal: 18, minHeight: 48, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
        opacity: cargando ? 0.6 : 1, transform: [{ scale: pressed ? 0.97 : 1 }],
      })}>
      <Icono sf="wallet.pass.fill" respaldo="💳" tam={20} color="#FFFFFF" />
      <Text style={{ flexShrink: 1, color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>
        {cargando ? 'Preparando…' : 'Agregar a Apple Wallet'}
      </Text>
    </Presionable>
  );
}

// Google Wallet (Android): el mismo lugar y la misma forma que el de Apple —
// botón negro, redondeado, con el nombre de la cartera—. Google no sabe
// decirle a la app si ya está guardada, así que el botón queda siempre: tocarlo
// otra vez la vuelve a mostrar en Google Wallet.
function BotonGoogleWallet({ nivelPrueba }) {
  const pedir = useSesion((s) => s.pedir);
  const [cargando, setCargando] = useState(false);
  const tocar = async () => {
    if (cargando) return;
    setCargando(true);
    if (!(await sinBloquear(() => agregarAGoogleWallet(pedir, nivelPrueba)))) {
      Alert.alert('No se pudo preparar la tarjeta', 'Revisa tu conexión e intenta de nuevo.');
    }
    setCargando(false);
  };
  return (
    <Presionable onPress={tocar} accessibilityRole="button" accessibilityLabel="Agregar a Google Wallet"
      style={({ pressed }) => ({
        alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#1F1F1F',
        borderRadius: 999, paddingHorizontal: 20, minHeight: 48, borderWidth: 1, borderColor: '#747775',
        opacity: cargando ? 0.6 : 1, transform: [{ scale: pressed ? 0.97 : 1 }],
      })}>
      <Icono sf="wallet.pass.fill" respaldo="💳" tam={20} color="#FFFFFF" />
      <Text style={{ flexShrink: 1, color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>
        {cargando ? 'Preparando…' : 'Agregar a Google Wallet'}
      </Text>
    </Presionable>
  );
}

// La campana: abre la bandeja; el número son los avisos sin leer.
let campanaAt = 0;
let campanaUltimo = 0;
let campanaGen = -1;
function Campana({ generacion }) {
  const t = useTema();
  const pedir = useSesion((s) => s.pedir);
  const [sinLeer, setSinLeer] = useState(campanaUltimo);
  // Al volver a la pestaña, a lo sumo una vez por minuto; con un resumen nuevo
  // (deslizar para refrescar), siempre.
  useFocusEffect(useCallback(() => {
    if (generacion === campanaGen && Date.now() - campanaAt < 60_000) return;
    campanaGen = generacion; campanaAt = Date.now();
    pedir('bandeja').then((r) => { if (r?.ok) { campanaUltimo = r.sin_leer ?? 0; setSinLeer(campanaUltimo); } });
  }, [pedir, generacion]));
  // Un aviso que llega con la app abierta suma uno al instante, sin esperar
  // al minuto de la próxima consulta.
  useEffect(() => alLlegarAviso(() => { campanaUltimo += 1; setSinLeer(campanaUltimo); }), []);
  // Abrir la bandeja los marca leídos: la campana se apaga ya, no al minuto.
  const abrirBandeja = () => { campanaUltimo = 0; setSinLeer(0); navegar('/notificaciones'); };
  return (
    <Presionable onPress={abrirBandeja} hitSlop={10} accessibilityRole="button"
      accessibilityLabel={sinLeer ? `Notificaciones, ${sinLeer} sin leer` : 'Notificaciones'}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
        backgroundColor: t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)', transform: [{ scale: pressed ? 0.92 : 1 }] })}>
      <Icono sf={sinLeer ? 'bell.badge' : 'bell'} respaldo="🔔" tam={21} color={t.color.magentaTexto} />
      {sinLeer ? (
        <View style={{ position: 'absolute', top: 4, right: 4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
          backgroundColor: colorSistema.rojo, alignItems: 'center', justifyContent: 'center' }}>
          <Text maxFontSizeMultiplier={1.2} style={{ color: '#FFF', fontSize: 11, fontWeight: '800' }}>{sinLeer > 9 ? '9+' : sinLeer}</Text>
        </View>
      ) : null}
    </Presionable>
  );
}

// La alerta de créditos vencidos (2026-10-15): como el aviso del cupón que
// vence (reloj naranja), pero tocable y con el rojo del sistema. Sin montos y
// sin tono de cobro: dice qué pasa y a dónde ir.
function AlertaCreditos({ vencidos }) {
  return (
    <Tocable alTocar={() => navegar('/creditos')} etiqueta={vencidos === 1 ? 'Tienes un crédito vencido. Ver detalle' : `Tienes ${vencidos} créditos vencidos. Ver detalle`}>
      <Tarjeta estilo={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Icono sf="exclamationmark.circle.fill" respaldo="!" tam={24} color={colorSistema.rojo} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: colorSistema.texto }}>
            {vencidos === 1 ? 'Tienes un crédito vencido' : `Tienes ${vencidos} créditos vencidos`}
          </Text>
          <Text style={{ fontSize: 14, lineHeight: 19, color: colorSistema.texto2 }}>Toca para ver el detalle y ponerte al día.</Text>
        </View>
        <Icono sf="chevron.right" respaldo="›" tam={14} color={colorSistema.texto2} />
      </Tarjeta>
    </Tocable>
  );
}

// Un acceso del Inicio: ícono, nombre y una línea de cómo va.
// `diasHasta` (días desde hoy en El Salvador) viene de lib/formato.

// Desde el 2026-11-03 sólo recibe los que se acaban en 3 días o menos.
function TratamientosInicio({ lista }) {
  const t = useTema();
  return (
    <Tarjeta estilo={{ gap: 10 }}>
      <Presionable onPress={() => navegar('/tratamientos')} accessibilityRole="button" accessibilityLabel="Mis tratamientos, ver todos"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
        <View style={{ width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: suave(t.color.verde, t.oscuro ? 0.28 : 0.16) }}>
          <Icono sf="pills.fill" respaldo="💊" tam={17} color={t.color.verdeTexto} />
        </View>
        <Text style={{ flex: 1, fontSize: 16, fontWeight: '700', color: colorSistema.texto }}>Se te acaba pronto</Text>
        <Text style={{ fontSize: 14, fontWeight: '600', color: colorSistema.texto2 }}>Ver todos</Text>
        <Icono sf="chevron.right" respaldo="›" tam={12} color={colorSistema.texto3} />
      </Presionable>
      {lista.map((x) => {
        // Sin fecha estimada (`se_acaba` nulo) no hay plazo que contar: sin la
        // línea y sin marcarlo urgente (antes decía «Se te acaba en null días»).
        const d = diasHasta(x.se_acaba);
        const urge = d != null && d <= 3;
        return (
          <View key={x.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: colorSistema.texto }} numberOfLines={1}>{nombrePropio(x.nombre)}</Text>
              {d != null ? (
                <Text style={{ fontSize: 13, fontWeight: urge ? '700' : '400', color: urge ? t.color.magentaTexto : colorSistema.texto2 }}>
                  {d < 0 ? `Se te acabó hace ${-d} día${d === -1 ? '' : 's'}` : d === 0 ? 'Se te acaba hoy' : `Se te acaba en ${d} día${d === 1 ? '' : 's'}`}
                </Text>
              ) : null}
            </View>
            <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); navegar(`/producto/${x.product_id}`); }} accessibilityRole="button"
              accessibilityLabel={`Reservar ${nombrePropio(x.nombre)}`} hitSlop={{ top: 5, bottom: 5, left: 4, right: 4 }}
              style={({ pressed }) => ({ minHeight: 34, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center',
                backgroundColor: urge ? t.color.magenta : (t.oscuro ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)'), transform: [{ scale: pressed ? 0.95 : 1 }] })}>
              <Text style={{ fontSize: 13, fontWeight: '800', color: urge ? '#FFFFFF' : colorSistema.texto }}>Reservar</Text>
            </Presionable>
          </View>
        );
      })}
    </Tarjeta>
  );
}

// El menú del Inicio: SEIS casillas (2026-11-03, «en inicio se quiere dejar
// solo 6 opciones abajo… que queden las más útiles, y las otras a cuenta»).
// Dos filas de tres (tres de dos con letra grande): nunca queda un hueco.
// Se quedaron las que un cliente de farmacia abre más seguido:
//   · Reservas — lo que apartó y si ya está listo para retirar.
//   · Tratamientos — lo que toma seguido y cuándo se le acaba.
//   · Compras — qué compró, para volver a pedirlo igual.
//   · Mis puntos — en qué ganó y en qué usó; es el programa.
//   · Sucursales — horarios y cómo llegar.
//   · La sexta es «lo que te toca»: Créditos si debe algo, si no Inyecciones
//     si tiene alguna por aplicar, y si no Invitar (+50 puntos).
// Salieron al menú de Cuenta (donde está TODO, ordenado por grupos): Facturas
// (sólo la usa quien pide crédito fiscal), Inyecciones y Créditos cuando no
// piden nada, Invitar cuando hay algo más urgente, y el chat — que además
// tiene la burbuja en todas las pantallas.
function Menu({ resumen, urgentes }) {
  const t = useTema();
  const { fontScale } = useWindowDimensions();
  // Desde 1.15: con tres columnas de ~78 pt, «Tratamientos» o «3 por
  // acabarse» ya no caben en letra grande y se cortaban.
  const dos = fontScale > 1.15;
  const r = resumen;
  const tratamientos = Array.isArray(r.tratamientos) ? r.tratamientos.length : 0;
  const sexta = r.creditos?.pendientes > 0
    ? { sf: 'creditcard.fill', titulo: 'Créditos', color: t.acentos.rojo.fuerte, ruta: '/creditos', resaltar: r.creditos.vencidos > 0,
        detalle: r.creditos.vencidos > 0 ? `${r.creditos.vencidos} vencido${r.creditos.vencidos === 1 ? '' : 's'}` : `${r.creditos.pendientes} al día` }
    // (El rojo de los tokens y no `colorSistema.rojo`: en iPhone ése es un
    // PlatformColor, `suave()` no lo aclara y el fondo salía del mismo rojo
    // que el ícono.)
    : r.inyecciones_pendientes > 0
      ? { sf: 'syringe.fill', titulo: 'Inyecciones', color: t.acentos.verde.fuerte, ruta: '/inyecciones', resaltar: true,
          detalle: `${r.inyecciones_pendientes} por aplicar` }
      : { sf: 'person.2.fill', titulo: 'Invitar', color: t.acentos.verde.fuerte, ruta: '/invitar', detalle: '+50 puntos' };
  const casillas = [
    { sf: 'bag.fill', titulo: 'Reservas', color: t.color.magenta, ruta: '/reservas', resaltar: r.reservas_listas > 0,
      detalle: r.reservas_listas ? `${r.reservas_listas} lista${r.reservas_listas === 1 ? '' : 's'}` : r.reservas_abiertas ? `${r.reservas_abiertas} en curso` : 'Ninguna' },
    { sf: 'pills.fill', titulo: 'Tratamientos', color: t.acentos.azul.fuerte, ruta: '/tratamientos', resaltar: urgentes > 0,
      detalle: urgentes ? `${urgentes} por acabarse` : tratamientos ? `${tratamientos} activo${tratamientos === 1 ? '' : 's'}` : 'Ver' },
    { sf: 'list.bullet.rectangle.fill', titulo: 'Compras', color: t.acentos.violeta.fuerte, ruta: '/compras', detalle: 'Volver a pedir' },
    { sf: 'star.fill', titulo: 'Mis puntos', color: t.acentos.naranja.fuerte, ruta: '/movimientos', detalle: 'Movimientos' },
    { sf: 'mappin.and.ellipse', titulo: 'Sucursales', color: t.acentos.violeta.fuerte, ruta: '/sucursales', detalle: 'Horarios' },
    sexta,
  ];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {casillas.map((c) => <Casilla key={c.ruta} {...c} ancho={dos ? '48%' : '31%'} />)}
    </View>
  );
}

function Casilla({ sf, titulo, detalle, color, resaltar, ruta, ancho }) {
  const t = useTema();
  return (
    <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); navegar(ruta); }} accessibilityRole="button"
      accessibilityLabel={`${titulo}: ${detalle}`}
      style={({ pressed }) => ({ width: ancho, flexGrow: 1, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
      <Tarjeta estilo={{ padding: 12, gap: 8, minHeight: 104 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <View style={{ width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: suave(color, t.oscuro ? 0.3 : 0.15) }}>
            <Icono sf={sf} respaldo="" tam={18} color={color} />
          </View>
          {resaltar ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: colorSistema.rojo }} /> : null}
        </View>
        <View style={{ gap: 1 }}>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ fontSize: 14, fontWeight: '800', color: colorSistema.texto }}>{titulo}</Text>
          <Text style={{ fontSize: 12, color: resaltar ? colorSistema.texto : colorSistema.texto2, fontWeight: resaltar ? '700' : '400' }}>{detalle}</Text>
        </View>
      </Tarjeta>
    </Presionable>
  );
}
