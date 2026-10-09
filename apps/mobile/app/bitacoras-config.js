// Configuración de las bitácoras de una sala, NATIVA — `bitacoras/
// TabConfiguracion` del portal. `?sala=` la sucursal.
//
// Lo mismo que el portal: el horario de la sucursal (a qué hora se toma cada
// lectura y cada limpieza, entre las horas en que la sala está abierta — vale
// para todas las áreas, la vuelta se camina una vez), el refrigerador con su
// interruptor (encenderlo pide la fecha del certificado), cada área con su
// interruptor, cuántos puntos de limpieza tiene y —en el refrigerador— el
// termómetro y su calibración, y agregar un área. Las reglas y la escritura
// son las del núcleo (`data/bitacoras`, `configuracionDeBitacoras`).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, KeyboardAvoidingView, Pressable, RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  PLANTILLA_AREA, TIPO_AREA, ajustarPuntos, aplicarHorarios, apagarRefrigerador, areaNueva, crearArea, encenderRefrigerador,
  fetchAreas, guardarArea, rangoDeLaSucursal, rotularRango, soloLimpieza,
} from '@nucleo/data/bitacoras';
import {
  areaCambiada, areasAgregables, conHorarioCambiado, hhmm, horariosUnidos, horasParaElegir, mediasHoras, puntosDelArea, unAnoDespues,
} from '@nucleo/utils/configuracionDeBitacoras';
import { hora12, rango12 } from '@nucleo/utils/hora';
import { hoySV, fechaTexto } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Fecha from '../componentes/formulario/Fecha';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo } from '../componentes/Progreso';

const textoDelError = (e) => (typeof e === 'string' ? e : e?.message || 'Intenta de nuevo.');
const hoja = (titulo, opciones, onElegir) => ActionSheetIOS.showActionSheetWithOptions(
  { title: titulo, options: [...opciones.map((o) => o.label), 'Cancelar'], cancelButtonIndex: opciones.length },
  (i) => { if (i < opciones.length) onElegir(opciones[i].value); },
);

function Hora({ etiqueta, valor, horas, onCambiar, nombre }) {
  if (!onCambiar) return <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`${etiqueta} ${hora12(hhmm(valor))}`}</Text>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${nombre}: hora ${etiqueta}`}
      onPress={() => hoja(`${nombre} · ${etiqueta}`, horasParaElegir(valor, horas).map((h) => ({ value: h, label: hora12(h) })), onCambiar)}
      style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{etiqueta}</Text>
      <Text style={{ color: colorSistema.acento, fontSize: 15, fontWeight: '600' }}>{hora12(hhmm(valor))}</Text>
    </Pressable>
  );
}

function Horario({ titulo, filas, horas, onCambiar }) {
  if (!filas.length) return null;
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>{titulo}</Text>
      {filas.map((f, i) => (
        <View key={f.clave} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
          <Text style={{ width: 84, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{f.label}</Text>
          {onCambiar ? (
            <>
              <Hora etiqueta="desde" nombre={f.label} valor={f.desde} horas={horas} onCambiar={(v) => onCambiar(conHorarioCambiado(filas, i, { desde: v }))} />
              <Hora etiqueta="hasta" nombre={f.label} valor={f.hasta} horas={horas} onCambiar={(v) => onCambiar(conHorarioCambiado(filas, i, { hasta: v }))} />
            </>
          ) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{rango12(f.desde, f.hasta)}</Text>}
        </View>
      ))}
    </View>
  );
}

function HorarioDeLaSucursal({ sala, areas, puedeEditar, onCambio }) {
  const sucursal = useStaffStore((s) => s.branches?.find((b) => String(b.id) === String(sala)));
  const rango = useMemo(() => rangoDeLaSucursal(sucursal), [sucursal]);
  const horas = useMemo(() => mediasHoras(rango?.abre, rango?.cierra), [rango]);
  const [franjas, setFranjas] = useState(() => horariosUnidos(areas, 'franjas'));
  const [limpiezas, setLimpiezas] = useState(() => horariosUnidos(areas, 'limpiezas'));
  const sucio = JSON.stringify(franjas) !== JSON.stringify(horariosUnidos(areas, 'franjas')) || JSON.stringify(limpiezas) !== JSON.stringify(horariosUnidos(areas, 'limpiezas'));
  if (!franjas.length && !limpiezas.length) return null;

  const guardar = () => Alert.alert('Guardar el horario', 'Vale para todas las áreas, y también para los días de este mes que ya pasaron (lo ya anotado no se toca, ni un mes cerrado).', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Guardar', onPress: async () => {
      const { error } = await Promise.resolve(aplicarHorarios(sala, franjas, limpiezas)).catch((e) => ({ error: e }));
      if (error) { fallo('No se pudo guardar', textoDelError(error)); return; }
      listo('Horario guardado', 'En todas las áreas.'); onCambio();
    } },
  ]);

  return (
    <Seccion titulo="Horarios de la sucursal" pie={`Valen para todas las áreas: la vuelta se camina una sola vez.${rango ? ` Las horas van entre las que abre y cierra la sucursal (${hora12(rango.abre)} a ${hora12(rango.cierra)}).` : ''}`}>
      <Horario titulo="Lecturas de temperatura" filas={franjas} horas={horas} onCambiar={puedeEditar ? setFranjas : null} />
      <Horario titulo="Limpieza" filas={limpiezas} horas={horas} onCambiar={puedeEditar ? setLimpiezas : null} />
      {puedeEditar && sucio ? <BotonGrande texto="Guardar el horario" onPress={guardar} /> : null}
    </Seccion>
  );
}

function Refrigerador({ sala, areas, puedeEditar, onCambio }) {
  const refri = areas.find((a) => a.tipo === 'refrigerador');
  const activo = Boolean(refri?.activa);
  const [fecha, setFecha] = useState('');
  const encender = () => Alert.alert('Encender el refrigerador', `Pide dos lecturas al día entre 2 y 8 °C. Calibrado el ${fecha}, vence el ${unAnoDespues(fecha)} (se puede corregir en su tarjeta).`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Encender', onPress: async () => {
      const { error } = await Promise.resolve(encenderRefrigerador({ refri, nueva: refri ? null : areaNueva('refrigerador', sala, areas), branchId: sala, calibradoEl: fecha, calibradoHasta: unAnoDespues(fecha) })).catch((e) => ({ error: e }));
      if (error) { fallo('No se pudo encender', textoDelError(error)); return; }
      setFecha(''); listo('Refrigerador encendido', ''); onCambio();
    } },
  ]);
  const apagar = () => Alert.alert('Apagar el refrigerador', 'Deja de pedir lecturas desde hoy. Lo ya anotado no se toca.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Apagar', style: 'destructive', onPress: async () => {
      const { error } = await Promise.resolve(apagarRefrigerador(refri.id, sala)).catch((e) => ({ error: e }));
      if (error) { fallo('No se pudo apagar', textoDelError(error)); return; }
      listo('Refrigerador apagado', ''); onCambio();
    } },
  ]);
  return (
    <Seccion titulo="Refrigerador con medicamentos" pie="Encendido, pide termómetro calibrado y dos lecturas al día entre 2 y 8 °C.">
      {!puedeEditar ? <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{activo ? 'Encendido.' : 'Esta sucursal no lleva refrigerador.'}</Text> : activo ? (
        <>
          <Text style={{ color: colorSistema.texto, fontSize: 15 }}>
            {`Encendido. ${refri?.calibrado_el ? `Calibrado el ${refri.calibrado_el}${refri.calibrado_hasta ? `, vence el ${refri.calibrado_hasta}` : ''}.` : 'Sin fecha de calibración anotada.'}`}
          </Text>
          <BotonGrande texto="Apagar" borde onPress={apagar} />
        </>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Última calibración</Text>
            <Fecha valor={fecha} onCambiar={setFecha} hasta={hoySV()} />
          </View>
          {!fecha ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Hace falta la fecha del certificado para encenderlo.</Text> : null}
          <BotonGrande texto="Encender" onPress={encender} deshabilitado={!fecha} />
        </>
      )}
    </Seccion>
  );
}

function Paso({ texto, onPress, deshabilitado, etiqueta }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} disabled={deshabilitado} hitSlop={6} accessibilityLabel={etiqueta}
      style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: deshabilitado ? 0.3 : pressed ? 0.6 : 1 })}>
      <Text style={{ color: MARCA.azulClaro, fontSize: 24, fontWeight: '600' }}>{texto}</Text>
    </Pressable>
  );
}

function Contador({ label, valor, minimo, onCambiar }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>{label}</Text>
      <Paso texto="−" etiqueta={`Menos ${label}`} onPress={() => onCambiar(Math.max(minimo, valor - 1))} deshabilitado={valor <= minimo} />
      <Text style={{ minWidth: 28, textAlign: 'center', color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{valor}</Text>
      <Paso texto="+" etiqueta={`Más ${label}`} onPress={() => onCambiar(valor + 1)} />
    </View>
  );
}

function Area({ area, puedeEditar, onGuardado }) {
  const sinTemperatura = soloLimpieza(area);
  const esRefri = area.tipo === 'refrigerador';
  const [activa, setActiva] = useState(area.activa);
  const [instrumento, setInstrumento] = useState(area.instrumento || '');
  const [calibrado, setCalibrado] = useState(area.calibrado_hasta || '');
  const [calibradoEl, setCalibradoEl] = useState(area.calibrado_el || '');
  const [puntos, setPuntos] = useState(() => area.puntos || []);
  const sucio = areaCambiada(area, { activa, instrumento, calibrado, calibradoEl, puntos });
  const vencida = area.calibrado_hasta && area.calibrado_hasta < hoySV();
  const receta = puntosDelArea(area.tipo, puntos);

  const guardar = () => Alert.alert('Guardar el área', `«${area.nombre}»${!activa && area.activa ? ` deja de pedir ${sinTemperatura ? 'registros' : 'lecturas'} desde hoy (lo ya anotado no se toca)` : ''}.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Guardar', onPress: async () => {
      const { error } = await Promise.resolve(guardarArea(area.id, { activa, instrumento: instrumento.trim() || null, calibrado_hasta: calibrado || null, calibrado_el: calibradoEl || null, puntos }, { area: area.nombre ?? null }))
        .catch((e) => ({ error: e }));
      if (error) { fallo('No se pudo guardar', textoDelError(error)); return; }
      listo('Guardado', area.nombre); onGuardado();
    } },
  ]);

  return (
    <Seccion titulo={area.nombre} pie={`Lleva bitácora desde el ${fechaTexto(area.vigente_desde)}. Los días anteriores no cuentan como faltantes.`}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {TIPO_AREA[area.tipo] !== area.nombre ? <Pildora texto={TIPO_AREA[area.tipo] || area.tipo} color={colorSistema.texto2} /> : null}
        {sinTemperatura ? <Pildora texto="sólo limpieza" color={MARCA.verde} /> : <Pildora texto={rotularRango(area)} color={MARCA.azulClaro} />}
        {!sinTemperatura && area.mide_humedad ? <Pildora texto="humedad" color={colorSistema.texto2} /> : null}
        {!sinTemperatura && vencida ? <Pildora texto="Calibración vencida" color={MARCA.rojo} /> : null}
        {(area.franjas || []).map((f) => <Pildora key={f.clave} texto={f.label} color={MARCA.azulClaro} />)}
        {(area.limpiezas || []).length ? <Pildora texto={area.limpiezas.map((t) => t.label).join(' · ')} color={MARCA.verde} /> : null}
      </View>
      {puedeEditar ? (
        <>
          {esRefri ? (
            <>
              <Campo multiline={false} value={instrumento} onChangeText={setInstrumento} placeholder="Termómetro (p. ej. digital R-01)" />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 15 }}>Última calibración</Text>
                <Fecha valor={calibradoEl} onCambiar={(v) => { setCalibradoEl(v || ''); if (v && !calibrado) setCalibrado(unAnoDespues(v)); }} />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 15 }}>Vence (vencida, invalida las lecturas)</Text>
                <Fecha valor={calibrado} onCambiar={(v) => setCalibrado(v || '')} />
              </View>
            </>
          ) : null}
          {receta ? (
            <View style={{ gap: 2 }}>
              <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>Cuántos hay</Text>
              {receta.tipos.map((t) => <Contador key={t.tipo} label={t.label} valor={t.cuenta} minimo={receta.minimo} onCambiar={(n) => setPuntos(ajustarPuntos(puntos, t.tipo, n))} />)}
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{receta.total > 1 ? `Al anotar la limpieza se marca cuáles de los ${receta.total} se limpiaron.` : 'Con uno solo, la limpieza se anota con una sola casilla.'}</Text>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>{activa ? 'El área lleva bitácora' : 'Apagada — no cuenta como faltante'}</Text>
            <Switch value={activa} onValueChange={setActiva} />
          </View>
          {sucio ? <BotonGrande texto="Guardar" onPress={guardar} /> : null}
        </>
      ) : !sinTemperatura ? (
        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${area.instrumento || 'Sin instrumento identificado'}${area.calibrado_hasta ? ` · calibrado hasta ${area.calibrado_hasta}` : ' · sin fecha de calibración'}`}</Text>
      ) : null}
    </Seccion>
  );
}

function AgregarArea({ sala, areas, onCreada }) {
  const disponibles = useMemo(() => areasAgregables(areas), [areas]);
  const [tipo, setTipo] = useState('');
  const [nombre, setNombre] = useState('');
  if (!disponibles.length) return null;
  const crear = () => Alert.alert('Agregar el área', `«${nombre.trim() || PLANTILLA_AREA[tipo]?.nombre}» nace encendida y con los horarios de las áreas que la sucursal ya lleva.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Agregar', onPress: async () => {
      const base = areaNueva(tipo, sala, areas);
      if (nombre.trim()) base.nombre = nombre.trim();
      const { error } = await Promise.resolve(crearArea(base)).catch((e) => ({ error: e }));
      if (error) { fallo('No se pudo agregar', textoDelError(error)); return; }
      setTipo(''); setNombre(''); listo('Área agregada', base.nombre); onCreada();
    } },
  ]);
  return (
    <Seccion titulo="Agregar un área" pie="El refrigerador no se agrega por aquí: tiene su propio interruptor arriba.">
      <Pressable onPress={() => hoja('Qué área', disponibles, setTipo)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 44, opacity: pressed ? 0.6 : 1 })}>
        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>Qué área</Text>
        <Text style={{ color: colorSistema.acento, fontSize: 16 }}>{tipo ? TIPO_AREA[tipo] || tipo : 'Elegir'}</Text>
        <Text style={{ color: colorSistema.texto2, fontSize: 18 }}> ›</Text>
      </Pressable>
      <Campo multiline={false} value={nombre} onChangeText={setNombre} placeholder={tipo ? `Cómo se llama (${PLANTILLA_AREA[tipo]?.nombre})` : 'Cómo se llama (opcional)'} />
      <BotonGrande texto="Agregar" onPress={crear} deshabilitado={!tipo} />
    </Seccion>
  );
}

export default function ConfiguracionDeBitacoras() {
  const { sala } = useLocalSearchParams();
  const { hasPermission } = useAuth();
  const puedeEditar = hasPermission('bitacoras_configurar', 'can_edit');
  const nombreSala = useStaffStore((s) => s.branches?.find((b) => String(b.id) === String(sala))?.name) || '';
  const [areas, setAreas] = useState(null);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    if (!sala) return;
    const { areas: a, error: e } = await Promise.resolve(fetchAreas(sala)).catch((x) => ({ areas: [], error: x }));
    setAreas(a || []); setError(e || null); setVersion((v) => v + 1);
  }, [sala]);
  useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial

  const visibles = (areas || []).filter((a) => a.tipo !== 'refrigerador' || a.activa);
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Configuración', headerLargeTitle: true }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 8, paddingBottom: 60, gap: 14 }} keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
          <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 20 }}>{`${nombreSala}: apaga el área que esta sucursal no tenga; deja de contar como faltante al cerrar el mes.`}</Text>
          {areas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : error ? (
            <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={textoDelError(error)} /></View>
          ) : (
            // `key={version}`: al recargar, cada tarjeta arranca de lo guardado.
            <View key={version} style={{ gap: 14 }}>
              {areas.length ? <HorarioDeLaSucursal sala={sala} areas={areas} puedeEditar={puedeEditar} onCambio={cargar} /> : null}
              <Refrigerador sala={sala} areas={areas} puedeEditar={puedeEditar} onCambio={cargar} />
              {visibles.map((a) => <Area key={a.id} area={a} puedeEditar={puedeEditar} onGuardado={cargar} />)}
              {!areas.length ? <View style={{ marginHorizontal: 16 }}><Aviso tono="cuidado" texto={`${nombreSala} no tiene áreas configuradas.`} /></View> : null}
              {puedeEditar ? <AgregarArea sala={sala} areas={areas} onCreada={cargar} /> : null}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
