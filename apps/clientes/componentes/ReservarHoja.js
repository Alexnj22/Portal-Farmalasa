// Reservar un producto de una oferta (2026-10-06). Una hoja en tres pasos:
//
//   1. la PRIMERA vez, las condiciones (las manda el servidor con su versión;
//      si cambian, se vuelven a pedir);
//   2. sucursal y cantidad: cada sucursal dice si «hay», quedan «pocas» o «no
//      hay ahora» (igual se puede reservar: se avisa cuando llegue);
//   3. listo: el código de la reserva y a dónde verla.
//
// Pagar es en la sucursal, al retirar.
//
// Por cantidad (2026-10-15): cada sucursal dice si alcanza para las que se
// piden («Tiene suficiente» / «Tiene 2 de las 4 que pides»), con la misma
// regla de la ficha (componentes/DondeLoHay). La oferta se reserva en su
// presentación menor y el servidor cuenta en unidades (`alcance`).
//
// Bajo receta (2026-10-12): el servidor dice si el producto la pide
// (`reserva_existencias.receta`) y entonces el paso 2 lleva «Foto de tu
// receta»; sin foto no se confirma. La reserva nace «en revisión», se sube la
// foto y la sucursal decide. Si la subida falla, la reserva queda igual y la
// foto se sube desde Mis reservas.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, Text, View } from 'react-native';
import { MAX_UNIDADES } from '../lib/carrito';
import Presionable from './Presionable';
import { Seccion } from './ui';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colorSistema } from './sistema';
import BotonNativo from './BotonNativo';
import Icono from './Icono';
import { useSesion } from '../lib/sesion';
import { useBloqueo } from '../lib/bloqueo';
import { useCuenta } from '../lib/cuenta';
import { dolares } from '../lib/formato';
import { suave, useTema } from '../tema/tema';
import { navegar } from '../lib/navegar';
import { router } from 'expo-router';
import RecetaFoto from './RecetaFoto';
import { subirReceta } from '../lib/fotos';
import { datosDePrueba } from '../lib/exclusiva';
import { colorDeTono, estadoDeAlcance, fondoDeTono } from './DondeLoHay';

const CLAVE_TERMINOS = 'puntos_salud_terminos_reserva';
// Los colores salen del tema (cambian con el modo oscuro).
// Sin existencia se reserva igual (queda en espera); con existencia, lo que
// alcanza para la cantidad elegida.
const nivelDe = (t, s, cantidad) => {
  if (!s || s.nivel === 'sin') return { texto: 'Te avisamos cuando llegue', color: colorSistema.texto2, fondo: 'rgba(120,110,130,0.14)' };
  const e = estadoDeAlcance({ alcance: s.alcance ?? null, hayAlgo: true, nivel: s.nivel, cantidad });
  return { texto: e.texto, color: colorDeTono(t, e.tono), fondo: fondoDeTono(t, e.tono), clave: e.clave };
};

export default function ReservarHoja({ oferta, producto, alCerrar }) {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const pedir = useSesion((s) => s.pedir);
  const [paso, setPaso] = useState('cargando');
  const bloqueada = useBloqueo((s) => s.bloqueada);
  const [terminos, setTerminos] = useState(null);
  const [sucursales, setSucursales] = useState([]);
  const [sala, setSala] = useState(null);
  const [cantidad, setCantidad] = useState(1);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const [hecha, setHecha] = useState(null);
  const [receta, setReceta] = useState(false);
  // Cuántas se piden de lo normal (2026-10-19): arriba de eso se pregunta.
  const [habitual, setHabitual] = useState(5);
  const [fotoReceta, setFotoReceta] = useState(null);
  const fondo = t.oscuro ? '#121016' : '#F5F4F8';
  const superficie = t.oscuro ? '#1E1B24' : '#FFFFFF';

  const [intento, setIntento] = useState(0);
  useEffect(() => {
    (async () => {
      setPaso('cargando');
      const [term, ex, aceptada] = await Promise.all([
        pedir('reserva_terminos'),
        pedir('reserva_existencias', { producto_id: producto.id }),
        SecureStore.getItemAsync(CLAVE_TERMINOS).catch(() => null),
      ]);
      setTerminos(term?.ok ? term : null);
      const lista = (ex?.sucursales ?? []).filter((s) => !oferta.salas || oferta.salas.includes(s.sala));
      setSucursales(lista);
      setReceta(!!ex?.receta);
      setHabitual(Number(ex?.habitual) || 5);
      setSala(lista.find((s) => s.nivel !== 'sin')?.branch_id ?? lista[0]?.branch_id ?? null);
      // Sin condiciones o sin sucursales no se puede reservar: se dice y se
      // ofrece reintentar (antes la hoja podía quedar en blanco).
      if (!term?.ok || !ex?.ok) { setError((!ex?.ok ? ex?.mensaje : term?.mensaje) ?? 'Revisa tu conexión.'); setPaso('error'); return; }
      setError(null);
      setPaso(aceptada !== term.version ? 'terminos' : 'elegir');
    })();
  }, [pedir, producto.id, oferta.salas, intento]);

  const aceptar = async () => {
    Haptics.selectionAsync().catch(() => {});
    await SecureStore.setItemAsync(CLAVE_TERMINOS, terminos.version).catch(() => {});
    setPaso('elegir');
  };
  const reservar = async (confirmada = false) => {
    if (enviando || !sala) return;
    if (receta && !fotoReceta?.uri) { setError('Agrega la foto de tu receta para continuar.'); return; }
    /* La cantidad es libre, pero si no es la habitual se pregunta (decisión
     * del usuario, 2026-10-19): un dedo de más en «+» aparta unidades que
     * otro cliente no va a encontrar. No frena: el cliente confirma. */
    if (!confirmada && cantidad > habitual) {
      Alert.alert('¿La cantidad es correcta?',
        `Vas a reservar ${cantidad} unidades. Lo habitual para este producto es hasta ${habitual}.`,
        [{ text: 'Cambiar', style: 'cancel' }, { text: `Sí, reservar ${cantidad}`, onPress: () => reservar(true) }]);
      return;
    }
    setEnviando(true);
    setError(null);
    const r = await pedir('reservar', {
      oferta_id: oferta.id, producto_id: producto.id, branch_id: sala, cantidad, acepta_terminos: terminos?.version,
      // Ofertas por nivel (2026-10-14): la cuenta de prueba reserva «como» su nivel elegido.
      ...datosDePrueba(),
    });
    if (r?.ok && r.receta && fotoReceta?.uri) {
      // La reserva ya existe: se sube la receta. Si falla, se dice y se sube luego.
      const s = await subirReceta(pedir, r.id, fotoReceta.uri);
      if (!s.ok) r.recetaPendiente = s.mensaje;
    }
    setEnviando(false);
    if (r?.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // El resumen sabe qué productos están reservados (aviso de duplicado y carrito).
      useCuenta.getState().cargar({ forzar: true }).catch(() => {});
      setHecha(r);
      setPaso('hecha');
    } else if (r?.sinConfirmar) {
      // Se cortó por tiempo y PUDO haber entrado (lib/api): reintentar a
      // ciegas duplica la reserva. Se relee el resumen y se manda a revisar.
      useCuenta.getState().cargar({ forzar: true }).catch(() => {});
      setError('No sabemos si se guardó. Revisa Mis reservas antes de intentar de nuevo.');
    } else if (r?.motivo === 'terminos') {
      // Las condiciones cambiaron con la hoja abierta: se piden de nuevo al
      // servidor; las cargadas al abrir son justo las que ya no valen.
      const term = await pedir('reserva_terminos');
      if (term?.ok) { setTerminos(term); setError(null); setPaso('terminos'); }
      else setError(r?.mensaje ?? 'Acepta las condiciones de la reserva para continuar.');
    } else {
      setError(r?.mensaje ?? 'No se pudo reservar. Intenta de nuevo.');
    }
  };
  const elegida = sucursales.find((s) => s.branch_id === sala);
  if (bloqueada) return null;

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={alCerrar}>
      <View style={{ flex: 1, backgroundColor: fondo }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18 }}>
          <Text style={{ fontSize: 20, fontWeight: '800', color: colorSistema.texto }}>
            {paso === 'terminos' ? 'Antes de reservar' : paso === 'hecha' ? (hecha?.receta ? 'Receta enviada' : '¡Reservado!') : 'Reservar'}
          </Text>
          <Presionable onPress={alCerrar} hitSlop={12} accessibilityRole="button" accessibilityLabel="Cerrar">
            <Text style={{ fontSize: 17, fontWeight: '600', color: t.color.magentaTexto }}>Cerrar</Text>
          </Presionable>
        </View>

        {paso === 'cargando' ? <ActivityIndicator style={{ marginTop: 40 }} /> : null}

        {paso === 'error' ? (
          <View style={{ padding: 28, gap: 14, alignItems: 'center' }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: colorSistema.texto }}>No se pudo preparar la reserva</Text>
            <Text style={{ fontSize: 15, color: colorSistema.texto2, textAlign: 'center' }}>{error}</Text>
            <View style={{ alignSelf: 'stretch' }}><BotonNativo etiqueta="Reintentar" alTocar={() => setIntento((x) => x + 1)} color={t.color.magenta} /></View>
          </View>
        ) : null}

        {paso === 'terminos' && terminos ? (
          <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: ins.bottom + 24, gap: 14 }}>
            <Text style={{ fontSize: 24, fontWeight: '900', color: colorSistema.texto }}>{terminos.titulo}</Text>
            <View style={{ backgroundColor: superficie, borderRadius: 18, padding: 16, gap: 12 }}>
              {terminos.puntos.map((p, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: t.color.magenta, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 13 }}>{i + 1}</Text>
                  </View>
                  <Text style={{ flex: 1, fontSize: 15, lineHeight: 21, color: colorSistema.texto }}>{p}</Text>
                </View>
              ))}
            </View>
            <Boton texto="Entendido, continuar" color={t.color.magenta} alTocar={aceptar} />
          </ScrollView>
        ) : null}

        {paso === 'elegir' ? (
          <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: ins.bottom + 24, gap: 16 }}>
            <View style={{ backgroundColor: superficie, borderRadius: 18, padding: 16, gap: 4 }}>
              <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 1, color: colorSistema.texto3 }}>{oferta.titulo?.toUpperCase()}</Text>
              <Text style={{ fontSize: 18, fontWeight: '800', color: colorSistema.texto }}>{producto.nombre}</Text>
              {producto.precio_descuento != null ? (
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                  <Text style={{ fontSize: 22, fontWeight: '900', color: colorSistema.texto }}>{dolares(producto.precio_descuento)}</Text>
                  {producto.precio != null ? <Text style={{ fontSize: 14, color: colorSistema.texto3, textDecorationLine: 'line-through' }}>{dolares(producto.precio)}</Text> : null}
                  <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>c/u</Text>
                </View>
              ) : null}
            </View>

            <Seccion>¿Dónde lo retiras?</Seccion>
            <View style={{ backgroundColor: superficie, borderRadius: 18, overflow: 'hidden' }}>
              {sucursales.map((s, i) => {
                const n = nivelDe(t, s, cantidad);
                const activa = s.branch_id === sala;
                return (
                  <Presionable key={s.branch_id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setSala(s.branch_id); }}
                    accessibilityRole="radio" accessibilityState={{ selected: activa }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14,
                      borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador,
                      backgroundColor: activa ? suave(t.color.magenta, 0.1) : 'transparent' }}>
                    <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: activa ? t.color.magenta : colorSistema.texto3, alignItems: 'center', justifyContent: 'center' }}>
                      {activa ? <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: t.color.magenta }} /> : null}
                    </View>
                    <Text style={{ flex: 1, fontSize: 16, fontWeight: activa ? '700' : '500', color: colorSistema.texto }}>{s.sala}</Text>
                    <View style={{ maxWidth: '55%', backgroundColor: n.fondo, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: n.color }}>{n.texto}</Text>
                    </View>
                  </Presionable>
                );
              })}
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: superficie, borderRadius: 18, padding: 14 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: colorSistema.texto }}>Cantidad</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                <Paso texto="−" deshabilitado={cantidad <= 1} alTocar={() => setCantidad((c) => Math.max(1, c - 1))} />
                <Text style={{ fontSize: 20, fontWeight: '800', minWidth: 24, textAlign: 'center', color: colorSistema.texto }}>{cantidad}</Text>
                <Paso texto="+" deshabilitado={cantidad >= MAX_UNIDADES} alTocar={() => setCantidad((c) => Math.min(MAX_UNIDADES, c + 1))} />
              </View>
            </View>

            {producto.precio_descuento != null ? (
              <Text style={{ fontSize: 15, color: colorSistema.texto2, textAlign: 'center' }}>
                Total al retirar: <Text style={{ fontWeight: '800', color: colorSistema.texto }}>{dolares(producto.precio_descuento * cantidad)}</Text>
              </Text>
            ) : null}
            {elegida && elegida.nivel !== 'sin' && ['parcial', 'corto'].includes(nivelDe(t, elegida, cantidad).clave) ? (
              <Text style={{ fontSize: 14, color: t.color.avisoTexto, textAlign: 'center' }}>
                {elegida.sala} no tiene las {cantidad} que pides. Puedes reservar menos, elegir otra sucursal o reservar igual y la sucursal te confirma.
              </Text>
            ) : null}
            {elegida?.nivel === 'sin' ? (
              <Text style={{ fontSize: 14, color: colorSistema.texto2, textAlign: 'center' }}>
                Ahora no hay en {elegida.sala}. Tu reserva queda en espera y te avisamos cuando llegue.
              </Text>
            ) : null}
            {receta ? <RecetaFoto foto={fotoReceta} alCambiar={(f) => { setFotoReceta(f); setError(null); }} superficie={superficie} /> : null}
            {error ? <Text style={{ fontSize: 15, color: colorSistema.rojo, textAlign: 'center' }}>{error}</Text> : null}
            <Boton texto={enviando ? (receta ? 'Enviando…' : 'Reservando…') : receta ? 'Enviar para revisión' : 'Reservar'} color={t.color.magenta} alTocar={() => reservar()}
              deshabilitado={!sala || enviando || (receta && !fotoReceta?.uri)} />
            <Text style={{ fontSize: 13, color: colorSistema.texto3, textAlign: 'center' }}>Pagas en la sucursal al retirar. Si no puedes ir tú, puedes compartir el código de la reserva con quien la vaya a retirar.</Text>
          </ScrollView>
        ) : null}

        {paso === 'hecha' && hecha ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 }}>
            <Icono sf="bag.fill.badge.plus" respaldo="🛍️" tam={64} color={t.color.magenta} />
            <Text style={{ fontSize: 26, fontWeight: '900', color: colorSistema.texto, textAlign: 'center' }}>Tu reserva {hecha.codigo}</Text>
            <Text style={{ fontSize: 16, lineHeight: 22, color: colorSistema.texto2, textAlign: 'center' }}>
              {hecha.receta
                ? `${elegida?.sala ?? 'La sucursal'} va a revisar tu receta. Te avisamos cuando la apruebe y tu reserva quede confirmada.`
                : `Te avisamos cuando ${elegida?.sala ?? 'la sucursal'} la tenga lista. Desde ese aviso tienes ${terminos?.reglas?.dias_sin_pago ?? 3} días para retirarla.`}
            </Text>
            {hecha.recetaPendiente ? (
              <Text style={{ fontSize: 14, lineHeight: 20, color: t.color.avisoTexto, textAlign: 'center' }}>
                {hecha.recetaPendiente} Puedes subir la foto desde Mis reservas.
              </Text>
            ) : null}
            {/* Retiro por otra persona (2026-10-09): la sucursal la encuentra sólo por el código. */}
            <Text style={{ fontSize: 14, lineHeight: 20, color: colorSistema.texto3, textAlign: 'center' }}>
              Si no puedes ir tú, comparte el código desde Mis reservas con alguien de confianza: quien lo presente en la sucursal puede retirarla.
            </Text>
            <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 10 }}>
              {/* Primero se cierra esta hoja y DESPUÉS la de la oferta (2026-10-12): al
                  navegar con la oferta abierta, Mis reservas quedaba debajo. */}
              <Boton texto="Ver mis reservas" color={t.color.magenta} alTocar={() => {
                alCerrar();
                setTimeout(() => { if (router.canGoBack()) router.back(); setTimeout(() => navegar('/reservas'), 300); }, 300);
              }} />
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

// El botón del sistema (vidrio de iOS 26), el mismo del resto de la app.
function Boton({ texto, color, alTocar, deshabilitado }) {
  return <BotonNativo etiqueta={texto} alTocar={alTocar} color={color} deshabilitado={!!deshabilitado} />;
}

function Paso({ texto, alTocar, deshabilitado }) {
  const t = useTema();
  return (
    <Presionable onPress={deshabilitado ? undefined : () => { Haptics.selectionAsync().catch(() => {}); alTocar(); }} hitSlop={8}
      accessibilityRole="button" accessibilityLabel={texto === '+' ? 'Más' : 'Menos'}
      style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
        backgroundColor: suave(t.color.magenta, 0.12), opacity: deshabilitado ? 0.35 : 1 }}>
      <Text style={{ fontSize: 22, fontWeight: '800', color: t.color.magentaTexto }}>{texto}</Text>
    </Presionable>
  );
}
