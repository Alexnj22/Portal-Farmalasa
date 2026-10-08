// Mis puntos. Se habla en DÓLARES primero —«$4.20 de descuento» se entiende,
// «420 puntos» no— y el número de puntos va como el detalle de la cifra.
// Misma decisión que /mis-puntos de la web.
import { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Platform, Pressable, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as Haptics from 'expo-haptics';
import { Aviso, Cargando, Pantalla, Tarjeta, Texto, Titulo } from '../../../componentes/ui';
import { useCuenta } from '../../../lib/cuenta';
import { dolares, entero, fecha, nombrePropio } from '../../../lib/formato';
import TarjetaSocio from '../../../componentes/TarjetaSocio';
import Nivel from '../../../componentes/Nivel';
import Mayorista, { rangoDePrueba } from '../../../componentes/Mayorista';
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
import { sincronizarAvisos } from '../../../lib/avisos';
import { cuponDePrueba, nivelDePrueba, useModoPrueba } from '../../../lib/prueba';
import { BotonWalletNativo, abrirPase, agregarDirecto, agregarPorSafari, tienePase, walletDisponible } from '../../../modules/wallet';
import { suave, useTema } from '../../../tema/tema';
import { colorSistema } from '../../../componentes/sistema';
import { navegar } from '../../../lib/navegar';

const MINIMO_DE_CANJE = 100;
let confetiMostrado = false;
const marcarConfeti = () => { confetiMostrado = true; };
// El signo sale del NÚMERO, no del tipo: un ajuste puede sumar o restar.
const ROTULOS = {
  compra: 'Compra', canje: 'Canje', vencimiento: 'Vencieron', anulacion: 'Compra anulada', ajuste: 'Ajuste',
  cumpleanos: 'Regalo de cumpleaños', canje_devuelto: 'Canje devuelto', referido: 'Por invitar a un amigo',
};

export default function Puntos() {
  const t = useTema();
  const { cumple, nivel: verNivel } = useLocalSearchParams();
  const { resumen: real, error, cargar, generacion } = useCuenta();
  // Modo de prueba (sólo la cuenta de prueba): se ve como el nivel elegido.
  const prueba = useModoPrueba();
  const enPrueba = !!real?.prueba && prueba.activo;
  // El cupón de prueba se arma UNA vez (su premio es al azar).
  const cuponPrueba = useMemo(() => cuponDePrueba(prueba.nivel, prueba.semilla, prueba.cuponUsado), [prueba.nivel, prueba.semilla, prueba.cuponUsado]);
  // En prueba el saldo se puede mover a mano («Simular: ganar/usar puntos») para ver la animación.
  const saldoPrueba = enPrueba && real ? Math.max(0, Number(real.saldo ?? 0) + prueba.ajuste) : null;
  // Cliente Mayorista (Condiciones, cláusula 5): NO tiene nivel de Puntos
  // Salud, sólo su rango. La raspable: Zafiro como Oro; Rubí y Diamante como Platino.
  const mayorista = enPrueba ? prueba.mayorista : null;
  const raspableDe = mayorista ? ({ zafiro: 'oro', rubi: 'platino', diamante: 'platino' }[mayorista] ?? null)
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
  if (!resumen) return <Pantalla alRefrescar={refrescar} refrescando={refrescando}><Aviso>{error}</Aviso></Pantalla>;

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
    <Pantalla alRefrescar={refrescar} refrescando={refrescando}>
      {enPrueba ? (
        <Pressable onPress={() => navegar('/cuenta')} accessibilityRole="button"
          style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FF9F0A', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
          <Icono sf="testtube.2" respaldo="" tam={12} color="#1A1000" />
          <Text style={{ fontSize: 12, fontWeight: '800', color: '#1A1000' }}>MODO DE PRUEBA · {String(mayorista ? `Mayorista ${rangoDePrueba(mayorista).nombre}` : resumen.nivel?.nombre ?? '').toUpperCase()}</Text>
        </Pressable>
      ) : null}
      <SubisteDeNivel nivel={resumen.nivel} forzar={verNivel === '1'} />
      <Cumpleanos activo={!!resumen.cumpleanos} forzar={cumple === '1'} nombre={primerNombre} puntos={resumen.regalo_cumpleanos} />
      {/* Encima de todo (zIndex): la tarjeta de abajo gira y se escala, y no puede tapar la campana. */}
      <Entrada indice={0} estilo={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 2 }}>
        <Texto nivel={2} estilo={{ fontSize: 17 }}>{resumen.cumpleanos ? `¡Feliz cumpleaños, ${primerNombre}!` : `Hola, ${primerNombre}`}</Texto>
        <Campana generacion={generacion} />
      </Entrada>

      {/* Historias: promociones e información, tipo estados. */}
      <Historias generacion={generacion} />

      {/* La tarjeta de socio: saldo al frente, código y QR al reverso. */}
      <Entrada indice={1}>
        <TarjetaSocio activa={visible} nivel={mayorista ?? resumen.nivel?.clave} nombre={resumen.nombre} saldo={saldo} equivale={resumen.equivale}
          previo={movSaldo.previo} cambio={movSaldo.cambio}
          codigo={resumen.codigo} socioDesde={resumen.socio_desde} />
      </Entrada>

      {/* Apple Wallet, justo debajo de la tarjeta (usuario, 2026-10-08): la tarjeta en la Cartera, para mostrarla en caja sin abrir la app. */}
      {Platform.OS === 'ios' ? (
        <Entrada indice={1}>
          <BotonWallet serial={resumen.wallet_serial} nivelPrueba={enPrueba ? (mayorista ?? prueba.nivel) : null} />
        </Entrada>
      ) : null}

      {/* El nivel: Cliente VIP, Plata, Oro o Platino, y cuánto falta. Justo
          debajo de la tarjeta (usuario, 2026-10-07). */}
      {/* Cliente Mayorista (modo de prueba): su rango, arriba del nivel de puntos. */}
      {mayorista ? (
        <Entrada indice={1}>
          <Mayorista rango={rangoDePrueba(mayorista)} />
        </Entrada>
      ) : null}
      {/* Mientras los niveles estén apagados (Reglamento v2 sin publicar) no se
          muestra la escalera; en el modo de prueba, sí. */}
      {resumen.nivel && !mayorista && resumen.nivel.activos !== false ? (
        <Entrada indice={1}>
          <Nivel nivel={resumen.nivel} />
        </Entrada>
      ) : null}

      {/* El cupón del mes (Platino): saldo de regalo que vence a fin de mes. */}
      {resumen.cupon ? (
        <Entrada indice={2}>
          <Cupon cupon={resumen.cupon} nivel={mayorista ?? resumen.nivel?.clave} activa={visible} fondo={t.oscuro ? '#0A090E' : '#F5F4F8'} demo={enPrueba ? prueba.demoCupon : 0} />
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

      {/* El estado del canje. El saldo cuenta hacia arriba y la barra se llena
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
            <Texto nivel={3}>Ganados</Texto>
            <NumeroAnimado valor={resumen.acumulados} formato="entero" estilo={{ fontSize: 24, fontWeight: '700', color: t.color.verdeTexto }} />
          </Tarjeta>
        </View>
        <View style={{ flex: 1 }}>
          <Tarjeta>
            <Texto nivel={3}>Usados</Texto>
            <NumeroAnimado valor={resumen.canjeados} formato="entero" estilo={{ fontSize: 24, fontWeight: '700', color: t.color.magentaTexto }} />
          </Tarjeta>
        </View>
      </Entrada>

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
            style={{ borderRadius: 26, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14, overflow: 'hidden' }}>
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
          <Tarjeta estilo={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ gap: 2 }}>
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
        <BotonWalletNativo style={{ width: 260, height: 48 }} onPress={tocar} />
      </View>
    );
  }
  return (
    <Pressable onPress={tocar} accessibilityRole="button" accessibilityLabel={tiene ? 'Ver en Apple Wallet' : 'Agregar a Apple Wallet'}
      style={({ pressed }) => ({
        alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#000000',
        borderRadius: 12, paddingHorizontal: 18, minHeight: 48, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
        opacity: cargando ? 0.6 : 1, transform: [{ scale: pressed ? 0.97 : 1 }],
      })}>
      <Icono sf="wallet.pass.fill" respaldo="💳" tam={20} color="#FFFFFF" />
      <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>
        {cargando ? 'Preparando…' : 'Agregar a Apple Wallet'}
      </Text>
    </Pressable>
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
  return (
    <Pressable onPress={() => navegar('/notificaciones')} hitSlop={10} accessibilityRole="button"
      accessibilityLabel={sinLeer ? `Notificaciones, ${sinLeer} sin leer` : 'Notificaciones'}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
        backgroundColor: t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)', transform: [{ scale: pressed ? 0.92 : 1 }] })}>
      <Icono sf={sinLeer ? 'bell.badge' : 'bell'} respaldo="🔔" tam={21} color={t.color.magentaTexto} />
      {sinLeer ? (
        <View style={{ position: 'absolute', top: 4, right: 4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
          backgroundColor: '#FF3B30', alignItems: 'center', justifyContent: 'center' }}>
          <Text maxFontSizeMultiplier={1.2} style={{ color: '#FFF', fontSize: 11, fontWeight: '800' }}>{sinLeer > 9 ? '9+' : sinLeer}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// Un acceso del Inicio: ícono, nombre y una línea de cómo va.
const diasHasta = (f) => Math.round((Date.parse(`${f}T12:00:00Z`) - Date.parse(`${new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10)}T12:00:00Z`)) / 86400_000);

function TratamientosInicio({ lista }) {
  const t = useTema();
  return (
    <Tarjeta estilo={{ gap: 10 }}>
      <Pressable onPress={() => navegar('/tratamientos')} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 }}>
        <View style={{ width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: suave(t.color.verde, t.oscuro ? 0.28 : 0.16) }}>
          <Icono sf="pills.fill" respaldo="💊" tam={17} color={t.color.verdeTexto} />
        </View>
        <Text style={{ flex: 1, fontSize: 16, fontWeight: '700', color: colorSistema.texto }}>Mis tratamientos</Text>
        <Text style={{ fontSize: 14, fontWeight: '600', color: colorSistema.texto2 }}>Ver todos</Text>
        <Icono sf="chevron.right" respaldo="›" tam={12} color={colorSistema.texto3} />
      </Pressable>
      {!lista.length ? (
        <Text style={{ fontSize: 14, color: colorSistema.texto2 }}>
          Cuando compres un medicamento con regularidad, te avisamos aquí antes de que se te acabe.
        </Text>
      ) : lista.map((x) => {
        const d = diasHasta(x.se_acaba);
        const urge = d <= 3;
        return (
          <View key={x.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: colorSistema.texto }} numberOfLines={1}>{nombrePropio(x.nombre)}</Text>
              <Text style={{ fontSize: 13, fontWeight: urge ? '700' : '400', color: urge ? t.color.magentaTexto : colorSistema.texto2 }}>
                {d < 0 ? `Se te acabó hace ${-d} día${d === -1 ? '' : 's'}` : d === 0 ? 'Se te acaba hoy' : `Se te acaba en ${d} día${d === 1 ? '' : 's'}`}
              </Text>
            </View>
            <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); navegar(`/producto/${x.product_id}`); }} accessibilityRole="button"
              style={({ pressed }) => ({ minHeight: 34, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center',
                backgroundColor: urge ? t.color.magenta : (t.oscuro ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)'), transform: [{ scale: pressed ? 0.95 : 1 }] })}>
              <Text style={{ fontSize: 13, fontWeight: '800', color: urge ? '#FFFFFF' : colorSistema.texto }}>Reservar</Text>
            </Pressable>
          </View>
        );
      })}
    </Tarjeta>
  );
}

function Acceso({ sf, titulo, detalle, color, resaltar, alTocar }) {
  const t = useTema();
  return (
    <Pressable onPress={alTocar} accessibilityRole="button" accessibilityLabel={`${titulo}: ${detalle}`}
      style={({ pressed }) => ({ flex: 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <Tarjeta estilo={{ gap: 10, paddingVertical: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: suave(color, t.oscuro ? 0.28 : 0.16) }}>
            <Icono sf={sf} respaldo="" tam={17} color={color} />
          </View>
          {resaltar ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: '#FF3B30' }} /> : null}
        </View>
        <View style={{ gap: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colorSistema.texto }}>{titulo}</Text>
          <Text style={{ fontSize: 13, color: resaltar ? colorSistema.texto : colorSistema.texto2, fontWeight: resaltar ? '600' : '400' }} numberOfLines={1}>{detalle}</Text>
        </View>
      </Tarjeta>
    </Pressable>
  );
}
