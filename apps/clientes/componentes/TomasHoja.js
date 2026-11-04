// Recordarme tomarlo (2026-10-12): cuántas veces al día y a qué horas, hasta
// cuándo, y una nota («con comida»). Todo se queda en el teléfono
// (lib/tomas.js): no se manda nada al servidor.
//
// 2026-10-14: más frecuencias —1, 2, 3, 4 o 6 veces al día, o cada 4, 6, 8 o
// 12 horas— con las horas recomendadas ya puestas. En «cada N horas», mover
// una toma corre las demás (manda el intervalo); en «N veces al día» se puede
// mover cada una, y si quedan muy juntas o fuera de orden se advierte con
// «Ajustar automáticamente». Las reglas viven en lib/tomas.js.
//
// 2026-10-14 (tarde, «¿por qué pregunta veces al día Y cada cuántas horas?»):
// UNA pregunta, «¿Cada cuánto lo tomas?», con opciones que dicen las dos
// cosas («3 veces al día · cada 8 h») y «Otro horario». Las de intervalo se
// reparten parejo desde la primera toma (8:00 por defecto) y mover una corre
// las demás; «Otro horario» deja elegir cuántas tomas y cada hora libre.
//
// 2026-10-29: «¿Cuánto tomas cada vez?» (½, 1, 1½ o 2). Las tomas al día por
// esa cantidad es la dosis diaria, y ESO —sólo eso, nunca los horarios— se
// manda al servidor (`tratamiento_dosis`) para calcular cuándo se acaba lo
// comprado. No se pregunta en anticonceptivos ni en los de toma semanal
// (`ajusta_dosis` falso): su ciclo es fijo.
//
// 2026-11-03 (usuario: «si me tomo 1/4? si me tomo 3? no tengo esas opciones.
// en los días, también más opciones. poner cuándo inicio el tratamiento si es
// nuevo»):
//   · Cantidad de ¼ en ¼, de ¼ a 10, con atajos ¼ ½ 1 2 3 y un contador
//     (lib/dosis.js). El aviso dice cuánto («½ tableta»).
//   · Duración: 3, 5, 7, 10, 14, 21, 30, 60 o 90 días, «Otro» con contador,
//     «Sin fecha de fin» y «Hasta una fecha».
//   · «¿Cuándo empiezas?»: hoy, mañana u otra fecha. Ningún aviso suena antes
//     y el último día sale de ahí (lib/tomas.js, `empieza`).
//
// 2026-11-04 (usuario: «el selector de los días, y todo eso mejóralo. Hazlo
// simple, pero útil. No tan limitado pero visualmente correcto»):
//   · «¿Por cuánto tiempo?» deja de ser una lista de 36 filas: el segmentado
//     del sistema con tres modos —Días · Hasta una fecha · Sin fin— y, en
//     Días, un contador grande con ±1 y ±7 más atajos (3 5 7 10 14 30 60 90).
//     Cualquier número de 1 a 365 sin cambiar de modo.
//   · Uno nuevo arranca en «Sin fin»: lo que está en Mis tratamientos es lo
//     que se compra con regularidad. Antes no había nada elegido y el botón
//     decía «Elige por cuánto tiempo»; ahora el resumen dice qué va a pasar.
//   · La cantidad, con la misma pieza (componentes/Pasos.js): el contador al
//     centro y los atajos ¼ ½ 1 2 3 debajo, en una sola caja.
//   · La nota de privacidad baja al final, en chico: arriba estorbaba.
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, Text, TextInput, View } from 'react-native';
import Presionable from './Presionable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Icono from './Icono';
import Segmentos from './Segmentos';
import { Atajos, Caja, Contador } from './Pasos';
import { colorSistema } from './sistema';
import { Boton, RADIO, Seccion } from './ui';
import SelectorHora, { HORA_NATIVA } from './SelectorHora';
import SelectorFecha, { FECHA_NATIVA } from './SelectorFecha';
import { CANTIDADES_RAPIDAS, CANTIDAD_MAX, CANTIDAD_MIN, CANTIDAD_PASO, cantidadDe, fraccionTexto, normalizarCantidad } from '../lib/dosis';
import { nombrePropio } from '../lib/formato';
import { useSesion } from '../lib/sesion';
import { MAX_DIAS_DURACION, finDelTratamiento, INICIO_DEFECTO, MAX_TOMAS_LIBRES, OPCIONES, diaTexto, guardarRecordatorio, horaTexto, horasCada, horasRecomendadas, inicioRecomendado, horasVeces, hoyLocal, opcionGuardada, quitarRecordatorio, revisarHoras, sumarDias } from '../lib/tomas';
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
// Hasta cuánto antes de hoy se puede decir que empezó (ya lo venía tomando) y
// hasta cuánto después.
const ATRAS_INICIO = 60;
// Los atajos de días: lo que más se receta (antibióticos 3–14, un mes, dos o
// tres meses). El contador cubre todo lo demás.
const ATAJOS_DIAS = [3, 5, 7, 10, 14, 30, 60, 90];
const ADELANTE_INICIO = 90;
// La duración guardada → { tipo, dias }. Los '7', '14', '30' de antes son días.
function duracionGuardada(actual) {
  const d = actual?.duracion;
  if (d === 'continuo' || d === 'fecha') return { tipo: d, dias: 7 };
  const dias = Number(actual?.dias ?? d);
  return Number.isInteger(dias) && dias > 0 ? { tipo: 'dias', dias: Math.min(MAX_DIAS_DURACION, dias) } : { tipo: null, dias: 7 };
}

export default function TomasHoja({ tratamiento, actual, alCerrar }) {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const [inicial] = useState(() => opcionGuardada(actual));
  const [opcion, setOpcion] = useState(inicial.opcion);
  const [horas, setHoras] = useState(inicial.horas);
  // `cada`: horas entre tomas (opciones de intervalo); null en «Otro horario».
  const cada = OPCIONES.find((o) => o.id === opcion)?.cada ?? null;
  const libre = cada == null;
  const n = libre ? horas.length : cada;
  const hoy = hoyLocal();
  const [durInicial] = useState(() => duracionGuardada(actual));
  // `duracion`: 'dias' (con `dias`), 'continuo' o 'fecha'; null hasta que elija.
  // Uno nuevo arranca en «Sin fin» (lo de esta lista se compra con regularidad).
  const [duracion, setDuracion] = useState(durInicial.tipo ?? (actual ? 'dias' : 'continuo'));
  const [dias, setDias] = useState(durInicial.dias);
  // Cuándo empieza. Uno guardado antes de 2026-11-03 no lo tiene: ya empezó.
  const [empiezaInicial] = useState(() => actual?.empieza ?? hoy);
  const [empieza, setEmpieza] = useState(empiezaInicial);
  const [otraFecha, setOtraFecha] = useState(empiezaInicial !== hoy && empiezaInicial !== sumarDias(hoy, 1));
  const minInicio = empiezaInicial < sumarDias(hoy, -ATRAS_INICIO) ? empiezaInicial : sumarDias(hoy, -ATRAS_INICIO);
  const maxInicio = sumarDias(hoy, ADELANTE_INICIO);
  const [hasta, setHasta] = useState(actual?.duracion === 'fecha' ? actual.hasta : finDelTratamiento(empiezaInicial, 14));
  const [nota, setNota] = useState(actual?.nota ?? '');
  const ajusta = !!tratamiento.ajusta_dosis;
  // Número (0.25 … 10). Lo guardado antes (0.5, 1.5) se lee igual.
  const [cantidad, setCantidad] = useState(() => normalizarCantidad(actual?.cantidad, 1));
  const pedir = useSesion((s) => s.pedir);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const fondo = t.oscuro ? '#121016' : '#F5F4F8';
  const superficie = t.oscuro ? '#1E1B24' : '#FFFFFF';

  const elegirOpcion = (id) => {
    if (id === opcion) return;
    Haptics.selectionAsync().catch(() => {});
    const op = OPCIONES.find((o) => o.id === id);
    if (op?.cada) {
      // Al cambiar de frecuencia se proponen las horas recomendadas para esa
      // frecuencia (la primera toma se puede mover y las demás la siguen).
      setHoras(horasCada(inicioRecomendado(op.cada), op.cada));
    } else {
      // A «Otro horario» se pasa con las horas que ya había, en orden.
      setHoras((xs) => [...xs].sort().slice(0, MAX_TOMAS_LIBRES));
    }
    setOpcion(id);
  };
  // «Otro horario»: cuántas tomas. Se reparten parejo dentro del día; después
  // se mueve cada una.
  const cambiarCuantas = (d) => {
    const nueva = Math.max(1, Math.min(MAX_TOMAS_LIBRES, horas.length + d));
    if (nueva === horas.length) return;
    Haptics.selectionAsync().catch(() => {});
    setHoras(horasRecomendadas('veces', nueva));
  };
  // Una hora nueva para la toma i. Con intervalo se corren todas.
  const aplicar = (i, nueva) => setHoras((xs) => {
    if (!libre) return horasCada(mover(nueva, 0, -i * cada * 60), cada);
    return xs.map((x, j) => (j === i ? nueva : x));
  });
  const cambiarHora = (i, h, m) => aplicar(i, mover(horas[i], h, m));
  const fijarHora = (i, nueva) => aplicar(i, nueva);
  const aviso = libre ? revisarHoras(horas, n) : null;
  const ajustar = () => {
    Haptics.selectionAsync().catch(() => {});
    // Desde la primera toma, con la separación pareja; si con eso la última
    // pasa de medianoche, desde la recomendada.
    const base = horasVeces(horas[0], n);
    setHoras(revisarHoras(base, n) ? horasRecomendadas('veces', n) : base);
  };
  // «Hasta el»: no antes del primer día (ni de hoy) ni más de un año después.
  const minHasta = empieza > hoy ? empieza : hoy;
  const maxHasta = sumarDias(minHasta, MAX_DIAS);
  const acotar = (f, min, max) => (f < min ? min : f > max ? max : f);
  const moverFecha = (n) => setHasta((f) => acotar(sumarDias(f, n), minHasta, maxHasta));
  const ponerEmpieza = (nueva) => {
    const f = acotar(nueva, minInicio, maxInicio);
    setEmpieza(f);
    // Si el fin quedó antes del nuevo inicio, se corre con él.
    setHasta((h) => (h < f ? finDelTratamiento(f, 14) : h));
  };
  const moverEmpieza = (n) => ponerEmpieza(sumarDias(empieza, n));
  const elegirInicio = (id) => {
    Haptics.selectionAsync().catch(() => {});
    if (id === 'hoy') { setOtraFecha(false); ponerEmpieza(hoy); } else if (id === 'manana') { setOtraFecha(false); ponerEmpieza(sumarDias(hoy, 1)); } else setOtraFecha(true);
  };

  // El último día, tal como se va a guardar. Si no cambió ni la duración ni
  // el inicio se respeta la fecha de fin que ya tenía: editar la hora el día
  // 5 de un tratamiento de 7 días no lo alarga a 12.
  const guardadaIgual = actual?.hasta && empieza === empiezaInicial && duracion === durInicial.tipo
    && (duracion !== 'dias' || dias === durInicial.dias) && duracion !== 'fecha';
  const fin = duracion === 'continuo' || !duracion ? null
    : duracion === 'fecha' ? acotar(hasta, minHasta, maxHasta)
      : guardadaIgual ? actual.hasta : finDelTratamiento(empieza, dias);
  const yaTermino = !!fin && fin < hoy;

  const guardar = async () => {
    if (guardando || !duracion) return;
    if (yaTermino) { setError('Con esa fecha de inicio el tratamiento ya terminó. Revisa cuándo empezaste o por cuántos días lo tomas.'); return; }
    setGuardando(true); setError(null);
    const r = await guardarRecordatorio({
      product_id: String(tratamiento.product_id), nombre: tratamiento.nombre, se_acaba: tratamiento.se_acaba ?? null,
      horas, duracion: duracion === 'dias' ? String(dias) : duracion, dias: duracion === 'dias' ? dias : null, hasta: fin,
      // Uno viejo sin inicio que no se tocó sigue sin inicio (ya empezó).
      empieza: actual && !actual.empieza && empieza === empiezaInicial ? null : empieza,
      nota: nota.trim(),
      modo: libre ? 'veces' : 'cada', n, inicio: libre ? null : horas[0], cantidad: ajusta ? cantidad : null,
    });
    if (!r.ok) { setGuardando(false); setError(r.error); return; }
    // El recordatorio ya quedó en el teléfono: si la dosis no llega, se avisa
    // pero no se deshace lo guardado.
    // El servidor acepta hasta 24 al día (`app_tratamientos.dosis_dia`,
    // numeric(5,2)); más que eso sólo cambia cuándo se le acaba, así que se
    // topa ahí en vez de perder el aviso de recompra.
    const d = ajusta ? await pedir('tratamiento_dosis', { product_id: tratamiento.product_id, dosis: Math.min(24, horas.length * cantidad) }) : { ok: true };
    setGuardando(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    alCerrar();
    if (!d?.ok) Alert.alert('Recordatorio guardado', 'No pudimos actualizar cuándo se te acaba. Lo intentaremos la próxima vez que lo guardes.');
  };
  const quitar = async () => {
    await quitarRecordatorio(String(tratamiento.product_id));
    // Sin recordatorio se vuelve a contar una toma al día.
    if (ajusta) pedir('tratamiento_dosis', { product_id: tratamiento.product_id, dosis: null });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    alCerrar();
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={alCerrar}>
      <View style={{ flex: 1, backgroundColor: fondo }}>
        {/* La barra de una hoja de edición de iOS (2026-11-04): «Cancelar» a la
            izquierda, el título al centro y «Guardar» en negrita a la derecha. */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10 }}>
          <Presionable onPress={alCerrar} hitSlop={12} accessibilityRole="button"
            style={({ pressed }) => ({ minHeight: 44, minWidth: 72, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
            <Text style={{ fontSize: 17, color: t.color.magentaTexto }}>Cancelar</Text>
          </Presionable>
          <Text accessibilityRole="header" numberOfLines={1} style={{ flexShrink: 1, fontSize: 17, fontWeight: '700', color: colorSistema.texto, textAlign: 'center' }}>
            {actual ? 'Recordatorio' : 'Nuevo recordatorio'}
          </Text>
          <Presionable onPress={guardar} disabled={guardando} hitSlop={12} accessibilityRole="button" accessibilityState={{ disabled: guardando }}
            style={({ pressed }) => ({ minHeight: 44, minWidth: 72, justifyContent: 'center', alignItems: 'flex-end', opacity: pressed || guardando ? 0.5 : 1 })}>
            {guardando ? <ActivityIndicator /> : <Text style={{ fontSize: 17, fontWeight: '700', color: t.color.magentaTexto }}>Guardar</Text>}
          </Presionable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: ins.bottom + 24, gap: 16 }} keyboardShouldPersistTaps="handled">
          <View style={{ backgroundColor: superficie, borderRadius: RADIO.medio, padding: 16, gap: 4 }}>
            <Text style={{ fontSize: 17, fontWeight: '800', color: colorSistema.texto }}>{nombrePropio(tratamiento.nombre)}</Text>
            <Text style={{ fontSize: 13, lineHeight: 18, color: colorSistema.texto3 }}>Te avisamos en este teléfono a la hora de cada toma.</Text>
          </View>

          <Seccion>¿Cada cuánto lo tomas?</Seccion>
          <View style={{ backgroundColor: superficie, borderRadius: RADIO.medio, overflow: 'hidden' }}>
            {OPCIONES.map((o, i) => {
              const elegida = o.id === opcion;
              return (
                <Presionable key={o.id} onPress={() => elegirOpcion(o.id)} accessibilityRole="radio" accessibilityState={{ selected: elegida }}
                  accessibilityLabel={o.detalle ? `${o.texto}, ${o.detalle}` : o.texto}>
                  {i > 0 ? <View style={{ height: 0.5, backgroundColor: colorSistema.separador, marginLeft: 16 }} /> : null}
                  {/* Elección única como en Ajustes: la marca va a la derecha. */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, minHeight: 48 }}>
                    <View style={{ flex: 1, gap: 1 }}>
                      <Text style={{ fontSize: 17, color: colorSistema.texto }}>{o.texto}</Text>
                      {o.detalle ? <Text style={{ fontSize: 13, color: colorSistema.texto3 }}>{o.detalle}</Text> : null}
                    </View>
                    {elegida ? <Icono sf="checkmark" respaldo="✓" tam={17} color={t.color.magentaTexto} /> : null}
                  </View>
                </Presionable>
              );
            })}
          </View>
          <Text style={{ fontSize: 12, lineHeight: 17, color: colorSistema.texto3, marginTop: -6, marginLeft: 4 }}>
            {libre
              ? 'Elige cuántas tomas al día y pon cada una a la hora que quieras.'
              : cada === 24 ? 'Una toma al día. Cámbiala a la hora que te quede mejor.'
                : `Repartidas cada ${cada} horas desde la primera. Si cambias una hora, las demás se mueven para mantener ${cada} horas entre tomas.`}
          </Text>
          {libre ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between', backgroundColor: superficie, borderRadius: RADIO.medio, padding: 14 }}>
              <Text style={{ flexShrink: 1, fontSize: 15, fontWeight: '600', color: colorSistema.texto2 }}>Tomas al día</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Paso sf="minus" etiqueta="Una toma menos" alTocar={() => cambiarCuantas(-1)} />
                <Text accessibilityLabel={`${horas.length} ${horas.length === 1 ? 'toma' : 'tomas'} al día`}
                  style={{ fontSize: 20, fontWeight: '900', color: colorSistema.texto, minWidth: 28, textAlign: 'center', fontVariant: ['tabular-nums'] }}>{horas.length}</Text>
                <Paso sf="plus" etiqueta="Una toma más" alTocar={() => cambiarCuantas(1)} />
              </View>
            </View>
          ) : null}
          <View style={{ backgroundColor: superficie, borderRadius: RADIO.medio, overflow: 'hidden' }}>
            {horas.map((h, i) => (
              <View key={i}>
                {i > 0 ? <View style={{ height: 0.5, backgroundColor: colorSistema.separador, marginLeft: 16 }} /> : null}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between', padding: 14 }}>
                  <Text style={{ flexShrink: 1, fontSize: 15, fontWeight: '600', color: colorSistema.texto2 }}>{horas.length === 1 ? 'Hora' : !libre && i === 0 ? 'Primera toma' : `Toma ${i + 1}`}</Text>
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
                  style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, justifyContent: 'center',
                    backgroundColor: t.color.magenta, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
                  <Text style={{ fontSize: 14, fontWeight: '800', color: '#FFFFFF' }}>Ajustar automáticamente</Text>
                </Presionable>
              </View>
            </View>
          ) : null}
          {!HORA_NATIVA ? <Text style={{ fontSize: 12, color: colorSistema.texto3, marginTop: aviso ? 0 : -8, marginLeft: 4 }}>Los botones de la izquierda mueven la hora; los de la derecha, de 15 en 15 minutos.</Text> : null}

          {ajusta ? (
            <>
              <Seccion>¿Cuánto tomas cada vez?</Seccion>
              <Caja superficie={superficie}>
                <Contador valor={cantidad} texto={cantidadDe(cantidad, tratamiento.nombre)} min={CANTIDAD_MIN} max={CANTIDAD_MAX} paso={CANTIDAD_PASO}
                  etiquetaMenos="Un cuarto menos" etiquetaMas="Un cuarto más" alCambiar={setCantidad} />
                <Atajos opciones={CANTIDADES_RAPIDAS.map((v) => ({ v, texto: fraccionTexto(v), etiqueta: cantidadDe(v, tratamiento.nombre) }))}
                  valor={cantidad} alElegir={setCantidad} />
              </Caja>
              <Text style={{ fontSize: 12, lineHeight: 17, color: colorSistema.texto3, marginTop: -6, marginLeft: 4 }}>
                {`En total, ${cantidadDe(horas.length * cantidad, tratamiento.nombre)} al día: con eso calculamos cuándo se te acaba.`}
              </Text>
            </>
          ) : null}

          <Seccion>¿Cuándo empiezas?</Seccion>
          <Caja superficie={superficie}>
            <Atajos opciones={[{ v: 'hoy', texto: 'Hoy' }, { v: 'manana', texto: 'Mañana' }, { v: 'otra', texto: 'Otra fecha' }]}
              valor={otraFecha ? 'otra' : empieza === hoy ? 'hoy' : empieza === sumarDias(hoy, 1) ? 'manana' : 'otra'} alElegir={elegirInicio} />
            {otraFecha ? (
              <FilaFecha etiqueta="Empiezo el" titulo="Empiezo el" valor={empieza} desde={minInicio} hasta={maxInicio}
                alCambiar={ponerEmpieza} alMover={moverEmpieza} />
            ) : null}
          </Caja>
          <Text style={{ fontSize: 12, lineHeight: 17, color: colorSistema.texto3, marginTop: -6, marginLeft: 4 }}>
            {empieza > hoy ? `Los avisos empiezan el ${diaTexto(empieza)}; antes no suena nada.`
              : empieza < hoy ? `Si ya lo venías tomando, contamos los días desde el ${diaTexto(empieza)}.`
                : 'Si es un tratamiento nuevo y lo empiezas otro día, cámbialo aquí.'}
          </Text>

          <Seccion>¿Por cuánto tiempo?</Seccion>
          {/* El segmentado del sistema trae su propio margen de 16 a los lados. */}
          <View style={{ marginHorizontal: -16 }}>
            <Segmentos valor={duracion} alCambiar={(v) => { Haptics.selectionAsync().catch(() => {}); setDuracion(v); }}
              opciones={[{ valor: 'dias', rotulo: 'Días' }, { valor: 'fecha', rotulo: 'Hasta una fecha' }, { valor: 'continuo', rotulo: 'Sin fin' }]} />
          </View>
          {duracion === 'dias' ? (
            <Caja superficie={superficie}>
              <Contador valor={dias} texto={`${dias} ${dias === 1 ? 'día' : 'días'}`} detalle={semanas(dias)} min={1} max={MAX_DIAS_DURACION} salto={7}
                etiquetaMenos="Un día menos" etiquetaMas="Un día más" alCambiar={setDias} />
              <Atajos opciones={ATAJOS_DIAS.map((x) => ({ v: x, texto: String(x), etiqueta: `${x} días` }))} valor={dias} alElegir={setDias} />
            </Caja>
          ) : duracion === 'fecha' ? (
            <Caja superficie={superficie}>
              <FilaFecha etiqueta="Hasta el" titulo="Hasta el" valor={acotar(hasta, minHasta, maxHasta)} desde={minHasta} hasta={maxHasta}
                alCambiar={(f) => setHasta(acotar(f, minHasta, maxHasta))} alMover={moverFecha} />
            </Caja>
          ) : null}
          {/* Lo que va a pasar, en una frase: el resumen manda, no el control. */}
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: -4, marginLeft: 4 }}>
            <Icono sf={yaTermino ? 'exclamationmark.triangle.fill' : 'calendar'} respaldo="•" tam={13} color={yaTermino ? t.color.peligroTexto : colorSistema.texto3} />
            <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, color: yaTermino ? t.color.peligroTexto : colorSistema.texto2 }}>
              {duracion === 'continuo' ? `Desde el ${diaTexto(empieza)}, todos los días hasta que quites el recordatorio.`
                : yaTermino ? `Con esa fecha de inicio terminó el ${diaTexto(fin)}.`
                  : `Del ${diaTexto(empieza)} al ${diaTexto(fin)}${duracion === 'dias' ? ' (el primer día cuenta)' : ''}.`}
            </Text>
          </View>

          <TextInput value={nota} onChangeText={setNota} placeholder="Nota (opcional), por ejemplo «con comida»" placeholderTextColor={colorSistema.texto3}
            maxLength={80}
            style={{ minHeight: 48, borderRadius: 16, padding: 14, fontSize: 15, color: colorSistema.texto, backgroundColor: superficie }} />

          {error ? <Text style={{ fontSize: 14, color: t.color.peligroTexto }}>{error}</Text> : null}
          {/* Los botones en su propio bloque con alto mínimo (2026-10-14, «el
              texto sale pegado al botón»): el botón nativo de iPhone se mide
              DESPUÉS del primer cuadro (`matchContents`) y mientras tanto
              ocupaba 0 pt, así que el texto de arriba quedaba montado encima.
              La nota de privacidad subió a la tarjeta del principio. */}
          <View style={{ marginTop: 8, gap: 10 }}>
            <View style={{ minHeight: 52, justifyContent: 'center' }}>
              {guardando ? <ActivityIndicator /> : <Boton alTocar={guardar}>Guardar recordatorio</Boton>}
            </View>
            {actual && !guardando ? <View style={{ minHeight: 48, justifyContent: 'center' }}><Boton tipo="peligro" alTocar={quitar}>Quitar recordatorio</Boton></View> : null}
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 4, paddingHorizontal: 4 }}>
            <Icono sf="lock.fill" respaldo="i" tam={12} color={colorSistema.texto3} />
            <Text style={{ flex: 1, fontSize: 12, lineHeight: 17, color: colorSistema.texto3 }}>
              {ajusta
                ? 'Tus horarios se guardan sólo en este teléfono. A la farmacia sólo le llega cuánto tomas al día, para avisarte antes de que se te acabe.'
                : 'Tus horarios se guardan sólo en este teléfono; no los enviamos a nadie.'} Si cierras sesión, se borran.
            </Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// «30 días» → «un mes»; «14 días» → «2 semanas». Sólo cuando es exacto.
const MESES_LARGOS = { 30: 'un mes', 60: 'dos meses', 90: 'tres meses', 120: 'cuatro meses', 180: 'seis meses', 365: 'un año' };
function semanas(x) {
  if (MESES_LARGOS[x]) return MESES_LARGOS[x];
  if (x % 7 === 0) return x === 7 ? '1 semana' : `${x / 7} semanas`;
  return null;
}

function Paso({ sf, texto, etiqueta, alTocar, apagado }) {
  const t = useTema();
  return (
    <Presionable onPress={() => { if (apagado) return; Haptics.selectionAsync().catch(() => {}); alTocar(); }}
      accessibilityRole="button" accessibilityLabel={etiqueta} hitSlop={6} disabled={!!apagado} accessibilityState={{ disabled: !!apagado }}
      // 32 de lado + 6 de `hitSlop` por lado = 44 pt de dedo (2026-10-13).
      style={({ pressed }) => ({ minWidth: 32, minHeight: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.92 : 1 }],
        opacity: apagado ? 0.35 : 1,
        backgroundColor: t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)' })}>
      {texto ? <Text style={{ fontSize: 12, fontWeight: '800', color: colorSistema.texto }}>{texto}</Text>
        : <Icono sf={sf} respaldo={sf === 'minus' ? '−' : '+'} tam={13} color={colorSistema.texto} />}
    </Presionable>
  );
}

// Una fecha: en iPhone el selector del sistema; en Android, ± un día y ± una semana.
function FilaFecha({ etiqueta, titulo, valor, desde, hasta, alCambiar, alMover }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ flexShrink: 1, fontSize: 15, fontWeight: '600', color: colorSistema.texto2 }}>{etiqueta}</Text>
      {FECHA_NATIVA ? (
        <SelectorFecha valor={valor} titulo={titulo} desde={desde} hasta={hasta} alCambiar={alCambiar} />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Paso texto="−7" etiqueta="Una semana antes" alTocar={() => alMover(-7)} apagado={valor <= desde} />
          <Paso sf="minus" etiqueta="Un día antes" alTocar={() => alMover(-1)} apagado={valor <= desde} />
          <Text accessibilityLiveRegion="polite" style={{ fontSize: 17, fontWeight: '900', color: colorSistema.texto, minWidth: 74, textAlign: 'center' }}>{diaTexto(valor)}</Text>
          <Paso sf="plus" etiqueta="Un día después" alTocar={() => alMover(1)} apagado={valor >= hasta} />
          <Paso texto="+7" etiqueta="Una semana después" alTocar={() => alMover(7)} apagado={valor >= hasta} />
        </View>
      )}
    </View>
  );
}
