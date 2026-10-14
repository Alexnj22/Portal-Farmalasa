// Recordarme tomarlo (2026-10-12): cuántas veces al día y a qué horas, hasta
// cuándo, y una nota («con comida»). Todo se queda en el teléfono
// (lib/tomas.js): no se manda nada al servidor.
//
// 2026-10-14: más frecuencias —1, 2, 3, 4 o 6 veces al día, o cada 4, 6, 8 o
// 12 horas— con las horas recomendadas ya puestas. En «cada N horas», mover
// una toma corre las demás (manda el intervalo); en «N veces al día» se puede
// mover cada una, y si quedan muy juntas o fuera de orden se advierte con
// «Ajustar automáticamente». Las reglas viven en lib/tomas.js.
import { useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, TextInput, View } from 'react-native';
import Presionable from './Presionable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Icono from './Icono';
import { colorSistema } from './sistema';
import { Boton, RADIO, Seccion } from './ui';
import SelectorHora, { HORA_NATIVA } from './SelectorHora';
import { nombrePropio } from '../lib/formato';
import { DURACIONES, FRECUENCIAS, PRESETS, diaTexto, guardarRecordatorio, horaTexto, horasCada, horasRecomendadas, horasVeces, hoyLocal, quitarRecordatorio, revisarHoras, sumarDias } from '../lib/tomas';
import { useTema } from '../tema/tema';

const dos = (n) => String(n).padStart(2, '0');
// Mover una hora: las horas dan la vuelta (23 → 0) y los minutos van de 15 en 15.
function mover(h, horas, minutos) {
  const [hh, mm] = h.split(':').map(Number);
  let total = (hh * 60 + mm + horas * 60 + minutos) % 1440;
  if (total < 0) total += 1440;
  return `${dos(Math.floor(total / 60))}:${dos(total % 60)}`;
}
const MAX_DIAS = 365;

export default function TomasHoja({ tratamiento, actual, alCerrar }) {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const [modo, setModo] = useState(actual?.modo === 'cada' ? 'cada' : 'veces');
  const [n, setN] = useState(actual?.n ?? actual?.horas?.length ?? 2);
  const [horas, setHoras] = useState(() => (actual?.modo === 'cada' && actual.inicio ? horasCada(actual.inicio, actual.n) : actual?.horas ?? PRESETS[2]));
  const [duracion, setDuracion] = useState(actual?.duracion ?? null);
  const [hasta, setHasta] = useState(actual?.duracion === 'fecha' ? actual.hasta : sumarDias(hoyLocal(), 14));
  const [nota, setNota] = useState(actual?.nota ?? '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const fondo = t.oscuro ? '#121016' : '#F5F4F8';
  const superficie = t.oscuro ? '#1E1B24' : '#FFFFFF';
  const hoy = hoyLocal();

  const elegirFrecuencia = (m, cuantas) => {
    Haptics.selectionAsync().catch(() => {});
    setModo(m); setN(cuantas); setHoras(horasRecomendadas(m, cuantas));
  };
  // Una hora nueva para la toma i. En «cada N horas» se corren todas.
  const aplicar = (i, nueva) => setHoras((xs) => {
    if (modo === 'cada') return horasCada(mover(nueva, 0, -i * n * 60), n);
    return xs.map((x, j) => (j === i ? nueva : x));
  });
  const cambiarHora = (i, h, m) => aplicar(i, mover(horas[i], h, m));
  const fijarHora = (i, nueva) => aplicar(i, nueva);
  const aviso = modo === 'veces' ? revisarHoras(horas, n) : null;
  const ajustar = () => {
    Haptics.selectionAsync().catch(() => {});
    // Desde la primera toma, con la separación pareja; si con eso la última
    // pasa de medianoche, desde la recomendada.
    const base = horasVeces(horas[0], n);
    setHoras(revisarHoras(base, n) ? horasRecomendadas('veces', n) : base);
  };
  const moverFecha = (n) => setHasta((f) => {
    const nueva = sumarDias(f, n);
    if (nueva <= hoy) return sumarDias(hoy, 1);
    if (nueva > sumarDias(hoy, MAX_DIAS)) return sumarDias(hoy, MAX_DIAS);
    return nueva;
  });

  const guardar = async () => {
    if (guardando || !duracion) return;
    setGuardando(true); setError(null);
    const preset = DURACIONES.find((d) => d.id === duracion);
    // Si no cambió la duración se respeta la fecha de fin que ya tenía: editar
    // la hora el día 5 de un tratamiento de 7 días no lo alarga a 12.
    const fin = duracion === 'continuo' ? null
      : duracion === 'fecha' ? hasta
        : actual?.duracion === duracion && actual?.hasta ? actual.hasta
          : sumarDias(hoy, preset.dias - 1);
    const r = await guardarRecordatorio({
      product_id: String(tratamiento.product_id), nombre: tratamiento.nombre, se_acaba: tratamiento.se_acaba ?? null,
      horas, duracion, hasta: fin, nota: nota.trim(),
      modo, n, inicio: modo === 'cada' ? horas[0] : null,
    });
    setGuardando(false);
    if (!r.ok) { setError(r.error); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    alCerrar();
  };
  const quitar = async () => {
    await quitarRecordatorio(String(tratamiento.product_id));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    alCerrar();
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={alCerrar}>
      <View style={{ flex: 1, backgroundColor: fondo }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18 }}>
          <Text style={{ fontSize: 20, fontWeight: '800', color: colorSistema.texto }}>Recordarme tomarlo</Text>
          <Presionable onPress={alCerrar} hitSlop={12} accessibilityRole="button"
            style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 17, fontWeight: '600', color: colorSistema.texto }}>Cerrar</Text>
          </Presionable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: ins.bottom + 24, gap: 16 }} keyboardShouldPersistTaps="handled">
          <View style={{ backgroundColor: superficie, borderRadius: RADIO.medio, padding: 16, gap: 4 }}>
            <Text style={{ fontSize: 17, fontWeight: '800', color: colorSistema.texto }}>{nombrePropio(tratamiento.nombre)}</Text>
            <Text style={{ fontSize: 13, color: colorSistema.texto3 }}>Te avisamos en este teléfono a la hora de cada toma.</Text>
          </View>

          <Seccion>¿Cada cuánto?</Seccion>
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: colorSistema.texto2, marginLeft: 4 }}>Veces al día</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {FRECUENCIAS.veces.map((k) => <Pildora key={`v${k}`} texto={`${k}×`} etiqueta={`${k} ${k === 1 ? 'vez' : 'veces'} al día`}
                elegida={modo === 'veces' && n === k} alTocar={() => elegirFrecuencia('veces', k)} />)}
            </View>
            <Text style={{ fontSize: 13, fontWeight: '600', color: colorSistema.texto2, marginLeft: 4, marginTop: 4 }}>Cada cuántas horas</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {FRECUENCIAS.cada.map((k) => <Pildora key={`c${k}`} texto={`${k} h`} etiqueta={`Cada ${k} horas`}
                elegida={modo === 'cada' && n === k} alTocar={() => elegirFrecuencia('cada', k)} />)}
            </View>
          </View>
          <Text style={{ fontSize: 12, lineHeight: 17, color: colorSistema.texto3, marginTop: -6, marginLeft: 4 }}>
            {modo === 'cada'
              ? `Cada ${n} horas, día y noche. Si cambias una hora, las demás se mueven para mantener ${n} horas entre tomas.`
              : n === 1 ? 'Una toma al día. Cámbiala a la hora que te quede mejor.'
                : 'Ya te pusimos horas repartidas en el día. Puedes cambiar cualquiera.'}
          </Text>
          <View style={{ backgroundColor: superficie, borderRadius: RADIO.medio, overflow: 'hidden' }}>
            {horas.map((h, i) => (
              <View key={i}>
                {i > 0 ? <View style={{ height: 0.5, backgroundColor: colorSistema.separador, marginLeft: 16 }} /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 }}>
                  <Text style={{ fontSize: 15, fontWeight: '600', color: colorSistema.texto2 }}>{horas.length === 1 ? 'Hora' : `Toma ${i + 1}`}</Text>
                  {HORA_NATIVA ? (
                    <SelectorHora valor={h} titulo={horas.length === 1 ? 'Hora' : `Toma ${i + 1}`} alCambiar={(nueva) => fijarHora(i, nueva)} />
                  ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Paso sf="minus" etiqueta="Una hora antes" alTocar={() => cambiarHora(i, -1, 0)} />
                    <Paso sf="plus" etiqueta="Una hora después" alTocar={() => cambiarHora(i, 1, 0)} />
                    <Text accessibilityLabel={`A las ${horaTexto(h)}`}
                      style={{ fontSize: 20, fontWeight: '900', color: colorSistema.texto, minWidth: 64, textAlign: 'center', fontVariant: ['tabular-nums'] }}>{horaTexto(h)}</Text>
                    <Paso sf="minus" etiqueta="15 minutos antes" alTocar={() => cambiarHora(i, 0, -15)} />
                    <Paso sf="plus" etiqueta="15 minutos después" alTocar={() => cambiarHora(i, 0, 15)} />
                  </View>
                  )}
                </View>
              </View>
            ))}
          </View>
          {aviso ? (
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: RADIO.medio,
              backgroundColor: t.oscuro ? 'rgba(255,159,10,0.16)' : 'rgba(255,159,10,0.14)' }} accessibilityRole="alert">
              <Icono sf="exclamationmark.triangle.fill" respaldo="!" tam={16} color={colorSistema.naranja} />
              <View style={{ flex: 1, gap: 8 }}>
                <Text style={{ fontSize: 14, lineHeight: 19, color: colorSistema.texto }}>{aviso.mensaje}</Text>
                <Presionable onPress={ajustar} accessibilityRole="button" hitSlop={6}
                  style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 36, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center',
                    backgroundColor: t.color.magenta, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
                  <Text style={{ fontSize: 14, fontWeight: '800', color: '#FFFFFF' }}>Ajustar automáticamente</Text>
                </Presionable>
              </View>
            </View>
          ) : null}
          {!HORA_NATIVA ? <Text style={{ fontSize: 12, color: colorSistema.texto3, marginTop: aviso ? 0 : -8, marginLeft: 4 }}>Los botones de la izquierda mueven la hora; los de la derecha, de 15 en 15 minutos.</Text> : null}

          <Seccion>¿Por cuánto tiempo?</Seccion>
          <View style={{ backgroundColor: superficie, borderRadius: RADIO.medio, overflow: 'hidden' }}>
            {DURACIONES.map((d, i) => {
              const elegida = d.id === duracion;
              return (
                <Presionable key={d.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setDuracion(d.id); }} accessibilityRole="radio" accessibilityState={{ selected: elegida }}>
                  {i > 0 ? <View style={{ height: 0.5, backgroundColor: colorSistema.separador, marginLeft: 50 }} /> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 44 }}>
                    <Icono sf={elegida ? 'checkmark.circle.fill' : 'circle'} respaldo="" tam={22} color={elegida ? t.color.magenta : colorSistema.texto3} />
                    <Text style={{ fontSize: 15, fontWeight: elegida ? '700' : '500', color: colorSistema.texto }}>{d.texto}</Text>
                  </View>
                </Presionable>
              );
            })}
          </View>
          {duracion === 'fecha' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: superficie, borderRadius: RADIO.medio, padding: 14 }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: colorSistema.texto2 }}>Hasta el</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Paso texto="−7" etiqueta="Una semana antes" alTocar={() => moverFecha(-7)} />
                <Paso sf="minus" etiqueta="Un día antes" alTocar={() => moverFecha(-1)} />
                <Text style={{ fontSize: 17, fontWeight: '900', color: colorSistema.texto, minWidth: 74, textAlign: 'center' }}>{diaTexto(hasta)}</Text>
                <Paso sf="plus" etiqueta="Un día después" alTocar={() => moverFecha(1)} />
                <Paso texto="+7" etiqueta="Una semana después" alTocar={() => moverFecha(7)} />
              </View>
            </View>
          ) : null}

          <TextInput value={nota} onChangeText={setNota} placeholder="Nota (opcional), por ejemplo «con comida»" placeholderTextColor={colorSistema.texto3}
            maxLength={80}
            style={{ minHeight: 48, borderRadius: 16, padding: 14, fontSize: 15, color: colorSistema.texto, backgroundColor: superficie }} />

          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <Icono sf="lock.fill" respaldo="i" tam={14} color={colorSistema.texto3} />
            <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, color: colorSistema.texto3 }}>
              Tus horarios se guardan sólo en este teléfono; no los enviamos a nadie. Si cierras sesión, se borran.
            </Text>
          </View>
          {error ? <Text style={{ fontSize: 14, color: t.color.peligroTexto }}>{error}</Text> : null}
          {guardando ? <ActivityIndicator /> : <Boton alTocar={guardar} deshabilitado={!duracion}>{duracion ? 'Guardar recordatorio' : 'Elige por cuánto tiempo'}</Boton>}
          {actual && !guardando ? <Boton tipo="peligro" alTocar={quitar}>Quitar recordatorio</Boton> : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Pildora({ texto, etiqueta, elegida, alTocar }) {
  const t = useTema();
  return (
    <Presionable onPress={alTocar} accessibilityRole="radio" accessibilityState={{ selected: elegida }} accessibilityLabel={etiqueta}
      style={({ pressed }) => ({ flex: 1, minHeight: 44, borderRadius: RADIO.chico, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.96 : 1 }],
        backgroundColor: elegida ? t.color.magenta : (t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)') })}>
      <Text style={{ fontSize: 15, fontWeight: '700', color: elegida ? '#FFFFFF' : colorSistema.texto }}>{texto}</Text>
    </Presionable>
  );
}

function Paso({ sf, texto, etiqueta, alTocar }) {
  const t = useTema();
  return (
    <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); alTocar(); }}
      accessibilityRole="button" accessibilityLabel={etiqueta} hitSlop={6}
      // 32 de lado + 6 de `hitSlop` por lado = 44 pt de dedo (2026-10-13).
      style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.92 : 1 }],
        backgroundColor: t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)' })}>
      {texto ? <Text style={{ fontSize: 12, fontWeight: '800', color: colorSistema.texto }}>{texto}</Text>
        : <Icono sf={sf} respaldo={sf === 'minus' ? '−' : '+'} tam={13} color={colorSistema.texto} />}
    </Presionable>
  );
}
