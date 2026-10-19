// Mis puntos. Se habla en DÓLARES primero —«$4.20 de descuento» se entiende,
// «420 puntos» no— y el número de puntos va como el detalle de la cifra.
// Misma decisión que /mis-puntos de la web.
import { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Platform, Text, View } from 'react-native';
import Presionable from '../../../componentes/Presionable';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as Haptics from 'expo-haptics';
import { Aviso, Cargando, Pantalla, RADIO, Tarjeta, Texto, Titulo, Vacio } from '../../../componentes/ui';
import { useCuenta } from '../../../lib/cuenta';
import { diasHasta, dolares, entero, fecha, fechaLarga, finDeMes, nombrePropio } from '../../../lib/formato';
import TarjetaSocio from '../../../componentes/TarjetaSocio';
import Nivel from '../../../componentes/Nivel';
import Mayorista, { BeneficiosEquipo, Equipo, rangoDePrueba, rangoReal } from '../../../componentes/Mayorista';
import Cupon from '../../../componentes/Cupon';
import SubisteDeNivel from '../../../componentes/SubisteDeNivel';
import { LinearGradient } from 'expo-linear-gradient';
import Vencimientos from '../../../componentes/Vencimientos';
import Cumpleanos from '../../../componentes/Cumpleanos';
import Historias from '../../../componentes/Historias';
import Icono from '../../../componentes/Icono';
import { useVisible } from '../../../lib/visible';
import { BarraAnimada, Confeti, Entrada, Latido, NumeroAnimado, Tocable } from '../../../componentes/animacion';
import { useSesion } from '../../../lib/sesion';
import { alLlegarAviso, sincronizarAvisos } from '../../../lib/avisos';
import { cuponDePrueba, nivelDePrueba, useModoPrueba } from '../../../lib/prueba';
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
// El signo sale del NÚMERO, no del tipo: un ajuste puede sumar o restar.
const ROTULOS = {
  compra: 'Compra', canje: 'Canje', vencimiento: 'Vencieron', anulacion: 'Compra anulada', ajuste: 'Ajuste',
  cumpleanos: 'Regalo de cumpleaños', canje_devuelto: 'Canje devuelto', referido: 'Por invitar a un amigo',
  // El cupón del mes (2026-10-14): el servidor lo distingue de una compra porque vence a fin de mes.
  cupon: 'Cupón del mes',
};

export default function Puntos() {
  const t = useTema();
  const { cumple, nivel: verNivel, rango: verRango, precio: verPrecio, mayoreo: verMayoreo } = useLocalSearchParams();
  // Sólo lo que esta pantalla pinta (2026-10-14): con el almacén entero, cada
  // `cargando: true/false` de una consulta repintaba el Inicio completo.
  const { resumen: real, error, cargar, generacion } = useCuenta(useShallow((s) => ({
    resumen: s.resumen, error: s.error, cargar: s.cargar, generacion: s.generacion,
  })));
  // Modo de prueba (sólo la cuenta de prueba): se ve como el nivel elegido.
  const prueba = useModoPrueba();
  const enPrueba = !!real?.prueba && prueba.activo;
  // El cupón de prueba se arma UNA vez (su premio es al azar).
  const cuponPrueba = useMemo(() => cuponDePrueba(prueba.nivel, prueba.semilla, prueba.cuponUsado), [prueba.nivel, prueba.semilla, prueba.cuponUsado]);
  // En prueba el saldo se puede mover a mano («Simular: ganar/usar puntos») para ver la animación.
  const saldoPrueba = enPrueba && real ? Math.max(0, Number(real.saldo ?? 0) + prueba.ajuste) : null;
  // Cliente Mayorista (Condiciones, cláusula 5): NO tiene nivel de Puntos
  // Salud, sólo su rango. La raspable: Zafiro como Oro; Rubí y Diamante como Platino.
  // El rango: de prueba, o el real si Administración lo aprobó.
  const mayoristaReal = !enPrueba ? rangoReal(real?.mayorista) : null;
  const mayorista = enPrueba ? prueba.mayorista : mayoristaReal?.clave ?? null;
  // Empleado activo (2026-10-08): lleva la tarjeta de SU nivel de cliente, o la
  // de su rango si Administración lo aprobó como mayorista, con el sello de
  // Equipo encima. Acumula puntos en lo que compra a precio Preferente o más.
  const empleado = enPrueba ? !!prueba.empleado : !!real?.empleado;
  const material = mayorista;
  // Condiciones §5.4: Rubí recibe el raspable de Oro y Diamante el de Platino.
  const raspableDe = mayorista ? ({ rubi: 'oro', diamante: 'platino' }[mayorista] ?? null)
    : (['oro', 'platino'].includes(prueba.nivel) ? prueba.nivel : null);
  const cuponMay = useMemo(() => (raspableDe ? cuponDePrueba(raspableDe, prueba.semilla, prueba.cuponUsado) : null), [raspableDe, prueba.semilla, prueba.cuponUsado]);
  const resumen = enPrueba ? { ...real, nivel: mayorista ? null : nivelDePrueba(prueba.nivel), cupon: mayorista ? cuponMay : (raspableDe ? cuponPrueba : null),
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
  const [mas, setMas] = useState([]);
  const [cargandoMas, setCargandoMas] = useState(false);
  const pidiendo = useRef(false);

  // Al volver a la pestaña sólo se pide si el resumen tiene más de un minuto.
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  // Lo cargado de más se descarta sólo con un resumen NUEVO (otra generación),
  // no cada vez que se vuelve a la pestaña.
  useEffect(() => { setMas([]); }, [generacion]);
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
  const movimientos = [...resumen.movimientos, ...mas];
  const total = resumen.movimientos_total ?? movimientos.length;
  // Una página a la vez (la ref frena el doble toque), y si mientras tanto
  // llegó un resumen nuevo, la respuesta vieja se descarta.
  const verMas = async () => {
    if (pidiendo.current) return;
    pidiendo.current = true;
    setCargandoMas(true);
    const gen = generacion;
    const r = await pedir('movimientos', { desde: movimientos.length });
    if (r?.ok && useCuenta.getState().generacion === gen) setMas((x) => [...x, ...r.movimientos]);
    setCargandoMas(false);
    pidiendo.current = false;
  };
  const primerNombre = nombrePropio(String(resumen.nombre ?? '').split(' ')[0]);

  return (
    // `sinVidrio`: las tarjetas de esta lista, en el relleno del vidrio sin el
    // vidrio vivo (ver Pantalla en componentes/ui.js). La aurora de atrás
    // está quieta (puntos/_layout.js), así que se ven iguales.
    <Pantalla alRefrescar={refrescar} refrescando={refrescando} sinVidrio>
      {enPrueba ? (
        <Presionable onPress={() => navegar('/cuenta')} accessibilityRole="button" hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
          accessibilityLabel="Modo de prueba activo. Cambiarlo en Cuenta" accessibilityHint="Abre Cuenta, donde se elige el nivel de prueba"
          style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FF9F0A', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, minHeight: 28 }}>
          <Icono sf="testtube.2" respaldo="" tam={12} color="#1A1000" />
          <Text style={{ fontSize: 12, fontWeight: '800', color: '#1A1000' }}>MODO DE PRUEBA · {String(`${mayorista ? `Mayoreo ${rangoDePrueba(mayorista).nombre}` : resumen.nivel?.nombre ?? ''}${empleado ? ' · Team' : ''}`).toUpperCase()}</Text>
        </Presionable>
      ) : null}
      <SubisteDeNivel nivel={resumen.nivel} forzar={verNivel === '1'} mayoreo={mayorista ? (mayoristaReal ?? rangoDePrueba(mayorista)) : null}
        forzarRango={verRango === '1'} forzarPrecio={verPrecio === '1'} forzarBienvenida={verMayoreo === '1'} />
      <Cumpleanos activo={!!resumen.cumpleanos} forzar={cumple ? String(cumple) : false} nombre={primerNombre} puntos={resumen.regalo_cumpleanos} />
      {/* Encima de todo (zIndex): la tarjeta de abajo gira y se escala, y no puede tapar la campana. */}
      <Entrada indice={0} estilo={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 2 }}>
        <Texto nivel={2} estilo={{ fontSize: 17 }}>{resumen.cumpleanos ? `¡Feliz cumpleaños, ${primerNombre}!` : `Hola, ${primerNombre}`}</Texto>
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
        codigo={resumen.codigo} socioDesde={resumen.socio_desde} />

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

      {/* El nivel: Cliente VIP, Plata, Oro o Platino, y cuánto falta. Justo
          debajo de la tarjeta (usuario, 2026-10-07). */}
      {/* Cliente Mayorista (el aprobado, o el modo de prueba): su rango, arriba del nivel de puntos. */}
      {mayorista ? (
        <Entrada indice={1}>
          <Mayorista rango={mayoristaReal ?? rangoDePrueba(mayorista)} pie={empleado ? <BeneficiosEquipo mayoreo={mayoristaReal ?? rangoDePrueba(mayorista)} /> : null} />
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
                <Texto nivel={2}>de {MINIMO_DE_CANJE} puntos para tu primer canje</Texto>
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
          <Cupon cupon={resumen.cupon} nivel={mayorista ?? resumen.nivel?.clave} activa={visible} fondo={Platform.OS === 'android' ? colorSistema.fondo : (t.oscuro ? '#0A090E' : '#F5F4F8')} demo={enPrueba ? prueba.demoCupon : 0} />
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

      {/* Accesos: inyecciones (antes era una pestaña) y reservas. */}
      <Entrada indice={2} estilo={{ flexDirection: 'row', gap: 10 }}>
        <Acceso sf="syringe.fill" titulo="Inyecciones" color={t.color.verde}
          detalle={resumen.inyecciones_pendientes ? `${resumen.inyecciones_pendientes} por aplicar` : 'Al día'}
          resaltar={resumen.inyecciones_pendientes > 0} alTocar={() => navegar('/inyecciones')} />
        <Acceso sf="bag.fill" titulo="Mis reservas" color={t.color.magenta}
          detalle={resumen.reservas_listas ? `${resumen.reservas_listas} lista${resumen.reservas_listas === 1 ? '' : 's'} para retirar` : resumen.reservas_abiertas ? `${resumen.reservas_abiertas} en curso` : 'Ninguna activa'}
          resaltar={resumen.reservas_listas > 0} alTocar={() => navegar('/reservas')} />
      </Entrada>

      {/* Mis tratamientos (2026-10-08): lo que compra con regularidad y cuándo se le acaba. */}
      {Array.isArray(resumen.tratamientos) ? (
        <Entrada indice={2}>
          <TratamientosInicio lista={resumen.tratamientos} />
        </Entrada>
      ) : null}

      {/* Mis créditos al día (2026-10-15): una entrada tranquila, sin alerta. */}
      {resumen.creditos?.pendientes > 0 && !(resumen.creditos.vencidos > 0) ? (
        <Entrada indice={2}>
          <Tocable alTocar={() => navegar('/creditos')} etiqueta="Mis créditos">
            <Tarjeta estilo={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: suave(t.color.verde, t.oscuro ? 0.28 : 0.16) }}>
                <Icono sf="doc.text.fill" respaldo="🧾" tam={20} color={t.color.verdeTexto} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 16, fontWeight: '800', color: colorSistema.texto }}>Mis créditos</Text>
                <Text style={{ fontSize: 14, color: colorSistema.texto2 }}>
                  {resumen.creditos.pendientes === 1 ? '1 pendiente' : `${resumen.creditos.pendientes} pendientes`} · al día
                </Text>
              </View>
              <Icono sf="chevron.right" respaldo="›" tam={14} color={colorSistema.texto2} />
            </Tarjeta>
          </Tocable>
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

      <Entrada indice={3} estilo={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Tarjeta>
            <Texto nivel={3}>Acumulados</Texto>
            <NumeroAnimado valor={resumen.acumulados} formato="entero" estilo={{ fontSize: 24, fontWeight: '700', color: t.color.verdeTexto }} />
          </Tarjeta>
        </View>
        <View style={{ flex: 1 }}>
          <Tarjeta>
            <Texto nivel={3}>Canjeados</Texto>
            <NumeroAnimado valor={resumen.canjeados} formato="entero" estilo={{ fontSize: 24, fontWeight: '700', color: t.color.magentaTexto }} />
          </Tarjeta>
        </View>
      </Entrada>

      {/* Lo que queda del cupón del mes vence con el mes (2026-10-14): se dice
          junto al resumen, con la fecha exacta. Sólo ya raspado. */}
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

      {/* Invitar: 50 puntos para cada uno (ver app/invitar.js). */}
      <Entrada indice={4}>
        <Tocable alTocar={() => navegar('/invitar')} etiqueta="Invita y ganen 50 puntos">
          <Tarjeta tono={t.color.verde} estilo={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Icono sf="person.2.fill" respaldo="🤝" tam={26} color={t.color.verdeTexto} />
            <View style={{ flex: 1, gap: 2 }}>
              <Titulo>Invita y ganen 50 puntos</Titulo>
              <Texto nivel={2} estilo={{ fontSize: 14 }}>Cada uno, con la primera compra de tu amigo.</Texto>
            </View>
            <Icono sf="chevron.right" respaldo="›" tam={15} color={colorSistema.texto3} />
          </Tarjeta>
        </Tocable>
      </Entrada>

      {/* Sucursales: entrada llamativa (pedido del usuario, 2026-10-06). */}
      <Entrada indice={4}>
        <Tocable alTocar={() => navegar('/sucursales')} etiqueta="Nuestras sucursales">
          <LinearGradient colors={['#4B1E8C', t.color.magenta]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ borderRadius: RADIO.tarjeta, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14, overflow: 'hidden' }}>
            <Text style={{ position: 'absolute', right: 40, top: -30, fontSize: 130, fontWeight: '900', color: 'rgba(255,255,255,0.08)' }}>+</Text>
            <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
              <Icono sf="mappin.and.ellipse" respaldo="📍" tam={24} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: 19, fontWeight: '800', color: '#FFFFFF' }}>Nuestras sucursales</Text>
              <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.88)' }}>Horarios, cómo llegar y WhatsApp</Text>
            </View>
            <Icono sf="chevron.right" respaldo="›" tam={16} color="#FFFFFF" />
          </LinearGradient>
        </Tocable>
      </Entrada>

      {/* Las compras, con sus productos: de ahí salen los puntos y las inyecciones. */}
      <Entrada indice={4}>
        <Tocable alTocar={() => navegar('/compras')} etiqueta="Mis compras">
          <Tarjeta estilo={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Titulo>Mis compras</Titulo>
              <Texto nivel={2} estilo={{ fontSize: 14 }}>Qué compraste, dónde y cuántos puntos te dio.</Texto>
            </View>
            <Icono sf="chevron.right" respaldo="›" tam={15} color={colorSistema.texto3} />
          </Tarjeta>
        </Tocable>
      </Entrada>

      <Entrada indice={5}>
        <Tarjeta>
          <Titulo>Movimientos</Titulo>
          {movimientos.length === 0 ? <Texto nivel={2}>Todavía no hay movimientos.</Texto> : null}
          {movimientos.map((m, i) => {
            const gana = Number(m.puntos) > 0;
            return (
              <View key={`${m.fecha}-${i}`} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Texto>{ROTULOS[m.tipo] ?? 'Movimiento'}</Texto>
                  <Texto nivel={3}>{fecha(m.fecha)}{m.sala ? ` · ${m.sala}` : ''}</Texto>
                  {m.tipo === 'cupon' ? <VenceCupon fecha={m.fecha} /> : null}
                </View>
                <Text style={{ fontSize: 17, fontWeight: '700', color: gana ? t.color.verdeTexto : t.color.magentaTexto, fontVariant: ['tabular-nums'] }}>
                  {gana ? '+' : '−'}{entero(Math.abs(m.puntos))}
                </Text>
              </View>
            );
          })}
          {movimientos.length < total ? (
            <Text onPress={cargandoMas ? undefined : verMas} accessibilityRole="button"
              style={{ color: t.color.magentaTexto, fontWeight: '600', paddingVertical: 12, minHeight: 44 }}>
              {cargandoMas ? 'Cargando…' : `Ver más · ${movimientos.length} de ${total}`}
            </Text>
          ) : null}
        </Tarjeta>
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
      <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>
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
      <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>
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

// Los puntos de un cupón vencen el último día de SU mes (2026-10-14).
function VenceCupon({ fecha: f }) {
  const t = useTema();
  const vence = finDeMes(f);
  const dias = diasHasta(vence);
  if (vence == null || dias == null) return null;
  return (
    <Text style={{ fontSize: 13, fontWeight: dias >= 0 ? '700' : '400', color: dias >= 0 ? t.color.magentaTexto : colorSistema.texto3 }}>
      {dias >= 0 ? `Vencen el ${fechaLarga(vence)} — úsalos este mes` : `Vencieron el ${fechaLarga(vence)}`}
    </Text>
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

function TratamientosInicio({ lista }) {
  const t = useTema();
  return (
    <Tarjeta estilo={{ gap: 10 }}>
      <Presionable onPress={() => navegar('/tratamientos')} accessibilityRole="button" accessibilityLabel="Mis tratamientos, ver todos"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
        <View style={{ width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: suave(t.color.verde, t.oscuro ? 0.28 : 0.16) }}>
          <Icono sf="pills.fill" respaldo="💊" tam={17} color={t.color.verdeTexto} />
        </View>
        <Text style={{ flex: 1, fontSize: 16, fontWeight: '700', color: colorSistema.texto }}>Mis tratamientos</Text>
        <Text style={{ fontSize: 14, fontWeight: '600', color: colorSistema.texto2 }}>Ver todos</Text>
        <Icono sf="chevron.right" respaldo="›" tam={12} color={colorSistema.texto3} />
      </Presionable>
      {!lista.length ? (
        <Text style={{ fontSize: 14, color: colorSistema.texto2 }}>
          Cuando compres un medicamento con regularidad, te avisamos aquí antes de que se te acabe.
        </Text>
      ) : lista.map((x) => {
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

function Acceso({ sf, titulo, detalle, color, resaltar, alTocar }) {
  const t = useTema();
  return (
    <Presionable onPress={alTocar} accessibilityRole="button" accessibilityLabel={`${titulo}: ${detalle}`}
      style={({ pressed }) => ({ flex: 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <Tarjeta estilo={{ gap: 10, paddingVertical: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: suave(color, t.oscuro ? 0.28 : 0.16) }}>
            <Icono sf={sf} respaldo="" tam={17} color={color} />
          </View>
          {resaltar ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: colorSistema.rojo }} /> : null}
        </View>
        <View style={{ gap: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colorSistema.texto }}>{titulo}</Text>
          <Text style={{ fontSize: 13, color: resaltar ? colorSistema.texto : colorSistema.texto2, fontWeight: resaltar ? '600' : '400' }} numberOfLines={2}>{detalle}</Text>
        </View>
      </Tarjeta>
    </Presionable>
  );
}
