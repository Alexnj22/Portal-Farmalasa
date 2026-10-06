// Reservar un producto de una oferta (2026-10-06). Una hoja en tres pasos:
//
//   1. la PRIMERA vez, las condiciones (las manda el servidor con su versión;
//      si cambian, se vuelven a pedir);
//   2. sucursal y cantidad: cada sucursal dice si «hay», quedan «pocas» o «no
//      hay ahora» (igual se puede reservar: se avisa cuando llegue);
//   3. listo: el código de la reserva y a dónde verla.
//
// Pagar es en la sucursal, al retirar.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colorSistema } from './sistema';
import { useSesion } from '../lib/sesion';
import { dolares } from '../lib/formato';
import { suave, useTema } from '../tema/tema';

const CLAVE_TERMINOS = 'puntos_salud_terminos_reserva';
const NIVEL = {
  hay: { texto: 'Hay', color: '#1E7B34', fondo: 'rgba(52,199,89,0.16)' },
  pocas: { texto: 'Quedan pocas', color: '#B35C00', fondo: 'rgba(255,159,10,0.18)' },
  sin: { texto: 'Te avisamos cuando llegue', color: '#6B6475', fondo: 'rgba(120,110,130,0.14)' },
};

export default function ReservarHoja({ oferta, producto, alCerrar }) {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const pedir = useSesion((s) => s.pedir);
  const [paso, setPaso] = useState('cargando');
  const [terminos, setTerminos] = useState(null);
  const [sucursales, setSucursales] = useState([]);
  const [sala, setSala] = useState(null);
  const [cantidad, setCantidad] = useState(1);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const [hecha, setHecha] = useState(null);
  const fondo = t.oscuro ? '#121016' : '#F5F4F8';
  const superficie = t.oscuro ? '#1E1B24' : '#FFFFFF';

  useEffect(() => {
    (async () => {
      const [term, ex, aceptada] = await Promise.all([
        pedir('reserva_terminos'),
        pedir('reserva_existencias', { producto_id: producto.id }),
        SecureStore.getItemAsync(CLAVE_TERMINOS).catch(() => null),
      ]);
      setTerminos(term?.ok ? term : null);
      const lista = (ex?.sucursales ?? []).filter((s) => !oferta.salas || oferta.salas.includes(s.sala));
      setSucursales(lista);
      setSala(lista.find((s) => s.nivel !== 'sin')?.branch_id ?? lista[0]?.branch_id ?? null);
      setPaso(term?.ok && aceptada !== term.version ? 'terminos' : 'elegir');
    })();
  }, [pedir, producto.id, oferta.salas]);

  const aceptar = async () => {
    Haptics.selectionAsync().catch(() => {});
    await SecureStore.setItemAsync(CLAVE_TERMINOS, terminos.version).catch(() => {});
    setPaso('elegir');
  };
  const reservar = async () => {
    if (enviando || !sala) return;
    setEnviando(true);
    setError(null);
    const r = await pedir('reservar', {
      oferta_id: oferta.id, producto_id: producto.id, branch_id: sala, cantidad, acepta_terminos: terminos?.version,
    });
    setEnviando(false);
    if (r?.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setHecha(r);
      setPaso('hecha');
    } else {
      if (r?.motivo === 'terminos') setPaso('terminos');
      setError(r?.mensaje ?? 'No se pudo reservar. Intenta de nuevo.');
    }
  };
  const elegida = sucursales.find((s) => s.branch_id === sala);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={alCerrar}>
      <View style={{ flex: 1, backgroundColor: fondo }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18 }}>
          <Text style={{ fontSize: 20, fontWeight: '800', color: colorSistema.texto }}>
            {paso === 'terminos' ? 'Antes de reservar' : paso === 'hecha' ? '¡Reservado!' : 'Reservar'}
          </Text>
          <Pressable onPress={alCerrar} hitSlop={12} accessibilityRole="button" accessibilityLabel="Cerrar">
            <Text style={{ fontSize: 17, fontWeight: '600', color: t.color.magentaTexto }}>Cerrar</Text>
          </Pressable>
        </View>

        {paso === 'cargando' ? <ActivityIndicator style={{ marginTop: 40 }} /> : null}

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

            <Text style={{ fontSize: 13, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: colorSistema.texto2, marginLeft: 4 }}>¿Dónde lo retiras?</Text>
            <View style={{ backgroundColor: superficie, borderRadius: 18, overflow: 'hidden' }}>
              {sucursales.map((s, i) => {
                const n = NIVEL[s.nivel] ?? NIVEL.sin;
                const activa = s.branch_id === sala;
                return (
                  <Pressable key={s.branch_id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setSala(s.branch_id); }}
                    accessibilityRole="radio" accessibilityState={{ selected: activa }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14,
                      borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador,
                      backgroundColor: activa ? suave(t.color.magenta, 0.1) : 'transparent' }}>
                    <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: activa ? t.color.magenta : colorSistema.texto3, alignItems: 'center', justifyContent: 'center' }}>
                      {activa ? <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: t.color.magenta }} /> : null}
                    </View>
                    <Text style={{ flex: 1, fontSize: 16, fontWeight: activa ? '700' : '500', color: colorSistema.texto }}>{s.sala}</Text>
                    <View style={{ backgroundColor: n.fondo, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: n.color }}>{n.texto}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: superficie, borderRadius: 18, padding: 14 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: colorSistema.texto }}>Cantidad</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                <Paso texto="−" deshabilitado={cantidad <= 1} alTocar={() => setCantidad((c) => Math.max(1, c - 1))} />
                <Text style={{ fontSize: 20, fontWeight: '800', minWidth: 24, textAlign: 'center', color: colorSistema.texto }}>{cantidad}</Text>
                <Paso texto="+" deshabilitado={cantidad >= 5} alTocar={() => setCantidad((c) => Math.min(5, c + 1))} />
              </View>
            </View>

            {producto.precio_descuento != null ? (
              <Text style={{ fontSize: 15, color: colorSistema.texto2, textAlign: 'center' }}>
                Total al retirar: <Text style={{ fontWeight: '800', color: colorSistema.texto }}>{dolares(producto.precio_descuento * cantidad)}</Text>
              </Text>
            ) : null}
            {elegida?.nivel === 'sin' ? (
              <Text style={{ fontSize: 14, color: colorSistema.texto2, textAlign: 'center' }}>
                Ahora no hay en {elegida.sala}. Tu reserva queda en espera y te avisamos cuando llegue.
              </Text>
            ) : null}
            {error ? <Text style={{ fontSize: 15, color: colorSistema.rojo, textAlign: 'center' }}>{error}</Text> : null}
            <Boton texto={enviando ? 'Reservando…' : 'Reservar'} color={t.color.magenta} alTocar={reservar} deshabilitado={!sala || enviando} />
            <Text style={{ fontSize: 13, color: colorSistema.texto3, textAlign: 'center' }}>Pagas en la sucursal al retirar.</Text>
          </ScrollView>
        ) : null}

        {paso === 'hecha' && hecha ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 }}>
            <Text style={{ fontSize: 70 }}>🛍️</Text>
            <Text style={{ fontSize: 26, fontWeight: '900', color: colorSistema.texto, textAlign: 'center' }}>Tu reserva {hecha.codigo}</Text>
            <Text style={{ fontSize: 16, lineHeight: 22, color: colorSistema.texto2, textAlign: 'center' }}>
              Te avisamos cuando {elegida?.sala ?? 'la sucursal'} la tenga lista. Desde ese aviso tienes 24 horas para retirarla.
            </Text>
            <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 10 }}>
              <Boton texto="Ver mis reservas" color={t.color.magenta} alTocar={() => { alCerrar(); setTimeout(() => router.push('/reservas'), 300); }} />
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function Boton({ texto, color, alTocar, deshabilitado }) {
  return (
    <Pressable onPress={deshabilitado ? undefined : alTocar} accessibilityRole="button" accessibilityState={{ disabled: !!deshabilitado }}
      style={({ pressed }) => ({ backgroundColor: color, borderRadius: 999, paddingVertical: 16, alignItems: 'center',
        opacity: deshabilitado ? 0.5 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <Text style={{ color: '#FFF', fontSize: 17, fontWeight: '800' }}>{texto}</Text>
    </Pressable>
  );
}

function Paso({ texto, alTocar, deshabilitado }) {
  return (
    <Pressable onPress={deshabilitado ? undefined : () => { Haptics.selectionAsync().catch(() => {}); alTocar(); }} hitSlop={8}
      accessibilityRole="button" accessibilityLabel={texto === '+' ? 'Más' : 'Menos'}
      style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(155,33,155,0.12)', opacity: deshabilitado ? 0.35 : 1 }}>
      <Text style={{ fontSize: 22, fontWeight: '800', color: '#9B219B' }}>{texto}</Text>
    </Pressable>
  );
}
