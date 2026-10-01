// Pasar la ronda — la misma captura que `components/bitacoras/PasarLaRonda.jsx`
// del portal: agrupada por MOMENTO (se camina una vez con el termohigrómetro y
// se anota todo lo de esa pasada), lo que queda en blanco no se manda, y una
// lectura fuera de rango exige decir qué se hizo. La lógica es la del núcleo
// (`utils/rondaDeBitacora`); acá sólo se dibuja, en vidrio sobre la aurora como
// el resto de la app.
import { useCallback, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { fueraDeRango, registrarRonda, rotularRango } from '@nucleo/data/bitacoras';
import {
  agruparRondaPorMomento, alternarGrupoDePuntos, alternarPunto, armarEnvioDeRonda, gruposDePuntos,
  lecturasSinAccion, marcarTurnoDeLimpieza, mueblesQueFaltan, rotuloCortoDePunto,
} from '@nucleo/utils/rondaDeBitacora';
import { rango12 } from '@nucleo/utils/hora';
import Aurora from '../Aurora';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Campo } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import { MARCA } from '../inicio/marca';

const numero = (v) => v.replace(',', '.').replace(/[^0-9.-]/g, '');

function Casilla({ marcada, onCambio, children, etiqueta }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: !!marcada }} accessibilityLabel={etiqueta}
      onPress={() => { Haptics.selectionAsync().catch(() => {}); onCambio(!marcada); }}
      style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: marcada ? MARCA.azulClaro : colorSistema.texto2,
        backgroundColor: marcada ? MARCA.azulClaro : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {marcada ? <Text style={{ color: '#fff', fontWeight: '900', fontSize: 13 }}>✓</Text> : null}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </Pressable>
  );
}

function TextoBoton({ texto, onPress, color = colorSistema.acento }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={{ minHeight: 44, minWidth: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color, fontSize: 15, fontWeight: '600' }}>{texto}</Text>
    </Pressable>
  );
}

function RenglonLectura({ item, valor, onCambio, errorServidor }) {
  const { area } = item;
  const fuera = fueraDeRango(area, valor.temp);
  const faltaAccion = fuera && !String(valor.accion || '').trim();
  const borde = (mal) => (mal ? { borderWidth: 2, borderColor: MARCA.rojo } : null);
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{area.nombre}</Text>
          <Text numberOfLines={1} style={{ color: colorSistema.texto2, fontSize: 13 }}>{rotularRango(area)}</Text>
        </View>
        <View style={{ width: 84 }}>
          <Campo multiline={false} value={valor.temp || ''} onChangeText={(v) => onCambio({ temp: numero(v) })} keyboardType="decimal-pad"
            accessibilityLabel={`Temperatura de ${area.nombre} en grados`} style={[{ textAlign: 'center', fontSize: 18, fontVariant: ['tabular-nums'] }, borde(fuera)]} />
        </View>
        {area.mide_humedad ? (
          <View style={{ width: 84 }}>
            <Campo multiline={false} value={valor.hum || ''} onChangeText={(v) => onCambio({ hum: numero(v) })} keyboardType="decimal-pad"
              accessibilityLabel={`Humedad de ${area.nombre} en porcentaje`} style={{ textAlign: 'center', fontSize: 18, fontVariant: ['tabular-nums'] }} />
          </View>
        ) : <Text style={{ width: 84, textAlign: 'center', color: colorSistema.texto2 }}>—</Text>}
      </View>
      {fuera ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '600' }}>
            Fuera del rango. Hay que anotar qué se hizo: una lectura fuera de rango sin acción al lado prueba que se vio y no se actuó.
          </Text>
          <Campo value={valor.accion || ''} onChangeText={(v) => onCambio({ accion: v })} style={borde(faltaAccion)}
            accessibilityLabel={`Qué se hizo con la temperatura de ${area.nombre}`}
            placeholder="Se encendió el aire y se bajó la persiana. Recontrolado a las 13:40." />
        </View>
      ) : null}
      {errorServidor ? <Text style={{ color: MARCA.rojo, fontWeight: '600' }}>{errorServidor}</Text> : null}
    </View>
  );
}

function RenglonLimpieza({ item, valor, onCambio, errorServidor }) {
  const { area, bloque } = item;
  const [conNota, setConNota] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const marcadas = valor.puntos || new Set();
  const grupos = gruposDePuntos(area.puntos);
  const total = (area.puntos || []).length;
  const faltan = mueblesQueFaltan(area, marcadas);

  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Casilla marcada={!!valor.marcada} onCambio={(m) => onCambio(marcarTurnoDeLimpieza(area, m))} etiqueta={`Limpieza de ${area.nombre}, ${bloque.label}`}>
            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>
              {area.nombre}<Text style={{ color: colorSistema.texto2, fontWeight: '400' }}>{` · ${bloque.label}`}</Text>
            </Text>
          </Casilla>
        </View>
        {valor.marcada && grupos.length ? <TextoBoton texto={`${total - faltan} de ${total}`} color={faltan ? MARCA.rojo : colorSistema.acento} onPress={() => setAbierto((a) => !a)} /> : null}
        {valor.marcada && !conNota ? <TextoBoton texto="Nota" onPress={() => setConNota(true)} /> : null}
      </View>
      {valor.marcada && abierto ? grupos.map((g) => {
        const hechas = g.items.filter((p) => marcadas.has(p.clave)).length;
        const completo = hechas === g.items.length;
        return (
          <View key={g.tipo} style={{ gap: 4, paddingLeft: 34 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colorSistema.texto2, fontWeight: '700', fontSize: 12, textTransform: 'uppercase' }}>{g.label}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: completo ? MARCA.verde : colorSistema.texto2, fontWeight: '700' }}>{`${hechas} de ${g.items.length}`}</Text>
                <TextoBoton texto={completo ? 'Ninguna' : 'Todas'} onPress={() => onCambio({ puntos: alternarGrupoDePuntos(marcadas, g.items) })} />
              </View>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {g.items.map((p) => (
                <View key={p.clave} style={{ width: '31%' }}>
                  <Casilla marcada={marcadas.has(p.clave)} etiqueta={p.label || 'Sin nombre'} onCambio={() => onCambio({ puntos: alternarPunto(marcadas, p.clave) })}>
                    <Text style={{ color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{rotuloCortoDePunto(p, g.singular)}</Text>
                  </Casilla>
                </View>
              ))}
            </View>
          </View>
        );
      }) : null}
      {valor.marcada && conNota ? (
        <Campo value={valor.obs || ''} onChangeText={(v) => onCambio({ obs: v })} accessibilityLabel={`Observación de la limpieza de ${area.nombre}`}
          placeholder="Una gotera, una vitrina que hubo que reacomodar…" />
      ) : null}
      {errorServidor ? <Text style={{ color: MARCA.rojo, fontWeight: '600' }}>{errorServidor}</Text> : null}
    </View>
  );
}

export default function Ronda({ fecha, bloques, onCerrar }) {
  const [pendientes, setPendientes] = useState(bloques);
  const [valores, setValores] = useState({});
  const [errores, setErrores] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [huboCambio, setHuboCambio] = useState(false);

  const cambiar = useCallback((clave, parche) => {
    setValores((v) => ({ ...v, [clave]: { ...(v[clave] || {}), ...parche } }));
  }, []);
  const momentos = useMemo(() => agruparRondaPorMomento(pendientes), [pendientes]);
  const items = useMemo(() => armarEnvioDeRonda(pendientes, valores, fecha), [pendientes, valores, fecha]);
  const incompletos = useMemo(() => lecturasSinAccion(pendientes, valores), [pendientes, valores]);

  const guardar = async () => {
    setError(null);
    setGuardando(true);
    const res = await registrarRonda(items);
    setGuardando(false);
    if (res.error) { setError(res.error); return; }
    if (res.guardados > 0) setHuboCambio(true);
    const fallidas = new Map((res.fallidos || []).map((f) => [f.clave, f.error]));
    if (!fallidas.size) { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); onCerrar(true); return; }
    // Lo que entró desaparece; lo que no, se queda con su motivo y lo tecleado.
    const enviadas = new Set(items.map((i) => i.clave));
    setPendientes((p) => p.filter((it) => !enviadas.has(it.clave) || fallidas.has(it.clave)));
    setErrores(Object.fromEntries(fallidas));
  };

  // «Atrás» en Android y el gesto de bajar la hoja en iOS se hacen sin querer:
  // con algo escrito, se pregunta antes de tirarlo. Una lectura tomada de pie
  // no se puede rehacer de memoria.
  const cerrar = () => {
    if (guardando) return;
    if (!items.length) { onCerrar(huboCambio); return; }
    Alert.alert('¿Salir sin anotar?', items.length === 1 ? 'Hay 1 renglón escrito que todavía no se guardó.' : `Hay ${items.length} renglones escritos que todavía no se guardaron.`, [
      { text: 'Seguir anotando', style: 'cancel' },
      { text: 'Salir sin guardar', style: 'destructive', onPress: () => onCerrar(huboCambio) },
    ]);
  };

  return (
    <Modal visible animationType="slide" onRequestClose={cerrar} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: '#100E1A' }}>
        <Aurora />
        <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={{ padding: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 24, fontWeight: '800' }}>Pasar la ronda</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Lo que dejes en blanco queda pendiente.</Text>
              </View>
              <TextoBoton texto={huboCambio ? 'Listo' : 'Cancelar'} onPress={cerrar} />
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 14 }} keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
              {Object.keys(errores).length ? (
                <Aviso tono="cuidado" texto="Quedaron renglones sin guardar. Lo demás ya está anotado; abajo está el motivo de cada uno." />
              ) : null}
              {momentos.map((m) => (
                <Vidrio key={m.clave} radio={22}>
                  <View style={{ padding: 14, gap: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '700' }}>{m.label}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{rango12(m.desde, m.hasta)}</Text>
                      {m.estado === 'vencida' ? <Pildora texto="Se pasó la hora" color={MARCA.ambar} /> : null}
                    </View>
                    {m.lecturas.length ? (
                      <View style={{ gap: 12 }}>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <View style={{ flex: 1 }} />
                          <Text style={{ width: 84, textAlign: 'center', color: colorSistema.texto2, fontWeight: '700' }}>°C</Text>
                          <Text style={{ width: 84, textAlign: 'center', color: colorSistema.texto2, fontWeight: '700' }}>% HR</Text>
                        </View>
                        {m.lecturas.map((it) => (
                          <RenglonLectura key={it.clave} item={it} valor={valores[it.clave] || {}} onCambio={(p) => cambiar(it.clave, p)} errorServidor={errores[it.clave]} />
                        ))}
                      </View>
                    ) : null}
                    {m.limpiezas.length ? (
                      <View style={{ borderTopWidth: 0.5, borderTopColor: colorSistema.separador, paddingTop: 8 }}>
                        <Text style={{ color: colorSistema.texto2, fontWeight: '700', fontSize: 12, textTransform: 'uppercase' }}>Limpieza</Text>
                        {m.limpiezas.map((it) => (
                          <RenglonLimpieza key={it.clave} item={it} valor={valores[it.clave] || {}} onCambio={(p) => cambiar(it.clave, p)} errorServidor={errores[it.clave]} />
                        ))}
                      </View>
                    ) : null}
                  </View>
                </Vidrio>
              ))}
              {error ? <Aviso tono="freno" texto={error} /> : null}
            </ScrollView>
            <View style={{ padding: 16 }}>
              <BotonGrande texto={guardando ? 'Anotando…' : items.length ? `Anotar ${items.length}` : 'Anotar'} color={MARCA.azul}
                deshabilitado={guardando || !items.length || incompletos.length > 0} onPress={guardar} />
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
