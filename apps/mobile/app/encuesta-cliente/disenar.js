// Diseñar las preguntas de una encuesta a clientes, NATIVO — el `Constructor`
// del portal: secciones, preguntas, tipos, opciones y «mostrar sólo si…».
//
// Como en el portal, NO hay botón de guardar: cada cambio se escribe solo un
// instante después (`guardarDiseno`), y lo pendiente se escribe igual al salir.
// Sólo se edita en borrador y con permiso; si no, se ve igual, sin controles.
// Las operaciones sobre el cuestionario son del núcleo (`encuestasClientes`).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, KeyboardAvoidingView, ScrollView, Switch, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchDimensiones, fetchEncuesta, guardarDiseno } from '@nucleo/data/encuestasClientes';
import {
  TIPOS_PREGUNTA, agregarPregunta, agregarSeccion, cambiarPregunta, cambiarSeccion, cambiarTipo, condicionSobre,
  duplicarPregunta, mover, moverPregunta, nuevaOpcion, operadoresPara, preguntasEnOrden, puedeSerCondicion,
  quitarPregunta, quitarSeccion, sinCondicion, textoDeCondicion, tipoDe,
} from '@nucleo/utils/encuestasClientes';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo } from '../../componentes/Progreso';
import Tocable from '../../componentes/Tocable';

const RETARDO = 900;

const hoja = (titulo, opciones, onElegir, destructivo) => ActionSheetIOS.showActionSheetWithOptions(
  { title: titulo, options: [...opciones.map((o) => o.label), 'Cancelar'], cancelButtonIndex: opciones.length, destructiveButtonIndex: destructivo },
  (i) => { if (i < opciones.length) onElegir(opciones[i].value); },
);

function Rotulo({ texto }) {
  return <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', marginBottom: -4, marginLeft: 2 }}>{texto}</Text>;
}

function Elegir({ rotulo, valor, onPress }) {
  return (
    <Tocable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 40, gap: 10, opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{rotulo}</Text>
      <Text style={{ flex: 1, color: colorSistema.acento, fontSize: 15, textAlign: 'right' }}>{valor}</Text>
      <Text style={{ color: colorSistema.texto2, fontSize: 18 }}>›</Text>
    </Tocable>
  );
}

// Los valores que puede tomar una condición, según la pregunta que mira.
function valoresDeCondicion(pregunta) {
  if (pregunta.tipo === 'si_no') return [{ value: true, label: 'Sí' }, { value: false, label: 'No' }];
  if (pregunta.opciones) return pregunta.opciones.map((o) => ({ value: o.id, label: o.texto || '(sin texto)' }));
  const min = pregunta.tipo === 'nps' ? 0 : 1;
  const max = pregunta.tipo === 'nps' ? 10 : 5;
  return Array.from({ length: max - min + 1 }, (_, i) => ({ value: i + min, label: String(i + min) }));
}

function Pregunta({ p, numero, anteriores, numeradas, dimensiones, editable, abierta, onToggle, onChange, onMenu }) {
  const tipo = tipoDe(p.tipo);
  const set = (k) => (v) => onChange({ ...p, [k]: v });
  const candidatas = anteriores.filter((a) => puedeSerCondicion(a.tipo));
  const condicion = p.condicion?.pregunta ? p.condicion : null;
  const mirada = condicion ? numeradas.find((x) => x.id === condicion.pregunta) : null;
  const dimension = dimensiones.find((d) => d.clave === p.dimension);
  return (
    <Vidrio radio={16}>
      <View style={{ padding: 12, gap: 10 }}>
        <Tocable onPress={editable ? onToggle : undefined} onLongPress={editable ? onMenu : undefined} style={{ flexDirection: 'row', gap: 8 }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 14, fontWeight: '700', width: 24 }}>{`${numero}.`}</Text>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: p.texto ? colorSistema.texto : colorSistema.texto2, fontSize: 15, fontWeight: '600', fontStyle: p.texto ? 'normal' : 'italic' }}>
              {p.texto || 'Pregunta sin texto'}{p.obligatoria ? <Text style={{ color: MARCA.rojo }}> *</Text> : null}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              <Pildora texto={tipo.corto} color={colorSistema.texto2} />
              {dimension ? <Pildora texto={dimension.nombre} color={MARCA.violetaClaro} /> : null}
              {condicion ? <Pildora texto={textoDeCondicion(condicion, numeradas)} color={MARCA.azulClaro} /> : null}
            </View>
            {!abierta && tipo.opciones ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{(p.opciones || []).map((o) => o.texto || '—').join(' · ')}</Text> : null}
          </View>
          {editable ? <Text style={{ color: colorSistema.texto2, fontSize: 18 }}>{abierta ? '▾' : '›'}</Text> : null}
        </Tocable>

        {editable && abierta ? (
          <View style={{ gap: 10 }}>
            <Rotulo texto="Pregunta" />
            <Campo value={p.texto || ''} onChangeText={set('texto')} placeholder="¿Qué quieres preguntar?" />
            <Elegir rotulo="Tipo de respuesta" valor={tipo.label}
              onPress={() => hoja('Tipo de respuesta', TIPOS_PREGUNTA.map((t) => ({ value: t.value, label: t.label })), (v) => onChange(cambiarTipo(p, v)))} />
            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{tipo.ayuda}</Text>
            <Elegir rotulo="Qué mide" valor={dimension?.nombre ?? 'Sin dimensión'}
              onPress={() => hoja('Qué mide', [{ value: null, label: 'Sin dimensión' }, ...dimensiones.filter((d) => d.activo || d.clave === p.dimension).map((d) => ({ value: d.clave, label: d.nombre }))],
                (v) => set('dimension')(v || undefined))} />
            <Rotulo texto="Ayuda (opcional)" />
            <Campo multiline={false} value={p.ayuda || ''} onChangeText={set('ayuda')} placeholder="Una aclaración debajo de la pregunta" />

            {tipo.opciones ? (
              <View style={{ gap: 8 }}>
                <Rotulo texto="Opciones" />
                {(p.opciones || []).map((o, oi) => (
                  <View key={o.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Campo multiline={false} value={o.texto} placeholder={`Opción ${oi + 1}`} style={{ flex: 1 }}
                      onChangeText={(v) => set('opciones')(p.opciones.map((x) => (x.id === o.id ? { ...x, texto: v } : x)))} />
                    <Tocable hitSlop={6} disabled={oi === 0} onPress={() => set('opciones')(mover(p.opciones, oi, -1))}>
                      <Text style={{ color: oi === 0 ? colorSistema.texto2 : MARCA.azulClaro, fontSize: 18 }}>↑</Text>
                    </Tocable>
                    <Tocable hitSlop={6} disabled={p.opciones.length <= 2} onPress={() => set('opciones')(p.opciones.filter((x) => x.id !== o.id))}>
                      <Text style={{ color: p.opciones.length <= 2 ? colorSistema.texto2 : MARCA.rojo, fontSize: 16, fontWeight: '700' }}>✕</Text>
                    </Tocable>
                  </View>
                ))}
                <Tocable onPress={() => set('opciones')([...(p.opciones || []), nuevaOpcion(p.opciones)])}>
                  <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '700' }}>+ Agregar opción</Text>
                </Tocable>
              </View>
            ) : null}

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>Obligatoria</Text>
              <Switch value={!!p.obligatoria} onValueChange={set('obligatoria')} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>
                {candidatas.length || condicion ? 'Mostrar sólo si…' : 'Mostrar sólo si… (no hay una pregunta antes que sirva)'}
              </Text>
              <Switch value={!!condicion} disabled={!candidatas.length && !condicion}
                onValueChange={(on) => onChange(on ? { ...p, condicion: condicionSobre(candidatas[candidatas.length - 1]) } : sinCondicion(p))} />
            </View>
            {condicion ? (
              <View style={{ gap: 4 }}>
                <Elegir rotulo="La pregunta" valor={mirada ? `${mirada.numero}. ${mirada.texto || 'Sin texto'}` : 'Elegir'}
                  onPress={() => hoja('De qué pregunta depende', candidatas.map((c) => ({ value: c.id, label: `${c.numero}. ${c.texto || 'Sin texto'}` })), (v) => {
                    const c = candidatas.find((x) => x.id === v);
                    if (c) onChange({ ...p, condicion: condicionSobre(c) });
                  })} />
                {mirada ? (
                  <>
                    <Elegir rotulo="Condición" valor={operadoresPara(mirada.tipo).find((o) => o.value === condicion.operador)?.label ?? condicion.operador}
                      onPress={() => hoja('Condición', operadoresPara(mirada.tipo), (v) => set('condicion')({ ...condicion, operador: v }))} />
                    {mirada.tipo === 'numero' ? (
                      <Campo multiline={false} keyboardType="number-pad" value={String(condicion.valor ?? '')}
                        onChangeText={(v) => set('condicion')({ ...condicion, valor: Number(v.replace(/\D/g, '')) || 0 })} />
                    ) : (
                      <Elegir rotulo="Valor" valor={valoresDeCondicion(mirada).find((o) => o.value === condicion.valor)?.label ?? String(condicion.valor)}
                        onPress={() => hoja('Valor', valoresDeCondicion(mirada), (v) => set('condicion')({ ...condicion, valor: v }))} />
                    )}
                  </>
                ) : null}
              </View>
            ) : null}
            <Tocable onPress={onMenu}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>Subir, bajar, duplicar o quitar…</Text>
            </Tocable>
          </View>
        ) : null}
      </View>
    </Vidrio>
  );
}

export default function DisenarEncuesta() {
  const { id } = useLocalSearchParams();
  const { hasPermission } = useAuth();
  const [encuesta, setEncuesta] = useState(null);
  const [dimensiones, setDimensiones] = useState([]);
  const [error, setError] = useState(null);
  const [estado, setEstado] = useState('listo');   // listo · pendiente · guardando · error
  const [abierta, setAbierta] = useState(null);
  const pendiente = useRef(null);
  const temporizador = useRef(null);

  useEffect(() => {
    Promise.all([fetchEncuesta(id), fetchDimensiones()])
      .then(([e, d]) => { setEncuesta(e); setDimensiones(d || []); })
      .catch((err) => setError(mensajeAmigable(err, 'No se pudo cargar la encuesta.')));
  }, [id]);

  const editable = !!encuesta && encuesta.estado === 'borrador' && hasPermission('encuestas_clientes', 'can_edit');

  const guardarYa = useCallback(async () => {
    clearTimeout(temporizador.current);
    const c = pendiente.current;
    if (!c) return;
    pendiente.current = null;
    setEstado('guardando');
    try {
      await guardarDiseno(id, { cuestionario: c });
      setEstado(pendiente.current ? 'pendiente' : 'listo');
    } catch (err) {
      if (!pendiente.current) pendiente.current = c;
      setEstado('error');
      fallo('No se guardó el último cambio', mensajeAmigable(err, 'Se reintenta con el próximo cambio.'));
    }
  }, [id]);
  // Al salir, lo pendiente se escribe igual.
  const alSalir = useRef(guardarYa);
  useEffect(() => { alSalir.current = guardarYa; }, [guardarYa]);
  useEffect(() => () => { alSalir.current(); }, []);

  const cambiar = (c) => {
    setEncuesta((e) => ({ ...e, cuestionario: c }));
    pendiente.current = c;
    setEstado('pendiente');
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(guardarYa, RETARDO);
  };

  const cuestionario = encuesta?.cuestionario || { secciones: [] };
  const secciones = cuestionario.secciones || [];
  const numeradas = useMemo(() => preguntasEnOrden(cuestionario), [cuestionario]);

  const menuDePregunta = (si, pi, p, ultimaSeccion) => {
    const opciones = [
      ...(si === 0 && pi === 0 ? [] : [{ value: 'subir', label: 'Subir' }]),
      ...(ultimaSeccion && pi === secciones[si].preguntas.length - 1 ? [] : [{ value: 'bajar', label: 'Bajar' }]),
      { value: 'duplicar', label: 'Duplicar' },
      { value: 'quitar', label: 'Quitar la pregunta' },
    ];
    hoja(p.texto || 'Pregunta', opciones, (v) => {
      if (v === 'subir') cambiar(moverPregunta(cuestionario, si, pi, -1));
      else if (v === 'bajar') cambiar(moverPregunta(cuestionario, si, pi, 1));
      else if (v === 'duplicar') { const r = duplicarPregunta(cuestionario, si, pi); cambiar(r.cuestionario); setAbierta(r.id); }
      else if (v === 'quitar') cambiar(quitarPregunta(cuestionario, p.id));
    }, opciones.length - 1);
  };
  const menuDeSeccion = (si) => {
    const opciones = [
      ...(si > 0 ? [{ value: 'subir', label: 'Subir la sección' }] : []),
      ...(si < secciones.length - 1 ? [{ value: 'bajar', label: 'Bajar la sección' }] : []),
      { value: 'quitar', label: 'Quitar la sección y sus preguntas' },
    ];
    hoja(secciones[si].titulo || `Sección ${si + 1}`, opciones, (v) => {
      if (v === 'subir') cambiar({ ...cuestionario, secciones: mover(secciones, si, -1) });
      else if (v === 'bajar') cambiar({ ...cuestionario, secciones: mover(secciones, si, 1) });
      else if (v === 'quitar') {
        Alert.alert('Quitar la sección', 'Se quitan también sus preguntas.', [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Quitar', style: 'destructive', onPress: () => cambiar(quitarSeccion(cuestionario, si)) },
        ]);
      }
    }, opciones.length - 1);
  };

  const rotuloEstado = { listo: 'Guardado', pendiente: 'Sin guardar…', guardando: 'Guardando…', error: 'No se guardó' }[estado];

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Preguntas', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 60 }}
          contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          {error ? <Aviso tono="freno" texto={error} /> : null}
          {!encuesta && !error ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
          {encuesta ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 18, fontWeight: '800' }}>{encuesta.nombre}</Text>
              {editable ? <Text style={{ color: estado === 'error' ? MARCA.rojo : colorSistema.texto2, fontSize: 13 }}>{rotuloEstado}</Text> : null}
            </View>
          ) : null}
          {encuesta && !editable ? <Aviso texto="Sólo se diseña mientras la encuesta está en borrador; acá se ve como quedó." /> : null}

          {encuesta && !secciones.length ? (
            <Aviso texto="Sin preguntas todavía. Arma la encuesta por secciones: por ejemplo «Tu visita de hoy» y «Para cerrar»." />
          ) : null}

          {secciones.map((s, si) => (
            <Seccion key={s.id} titulo={`Sección ${si + 1}`}>
              {editable ? (
                <>
                  <Campo multiline={false} value={s.titulo || ''} placeholder="Título de la sección (opcional)" onChangeText={(v) => cambiar(cambiarSeccion(cuestionario, si, { titulo: v }))} />
                  <Campo multiline={false} value={s.descripcion || ''} placeholder="Una línea que explique la sección (opcional)" onChangeText={(v) => cambiar(cambiarSeccion(cuestionario, si, { descripcion: v }))} />
                </>
              ) : (
                <View style={{ gap: 2 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{s.titulo || 'Sin título'}</Text>
                  {s.descripcion ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{s.descripcion}</Text> : null}
                </View>
              )}
              {(s.preguntas || []).map((p, pi) => {
                const num = numeradas.find((x) => x.id === p.id);
                return (
                  <Pregunta key={p.id} p={p} numero={num?.numero} anteriores={numeradas.slice(0, (num?.numero || 1) - 1)}
                    numeradas={numeradas} dimensiones={dimensiones} editable={editable} abierta={abierta === p.id}
                    onToggle={() => setAbierta((a) => (a === p.id ? null : p.id))}
                    onChange={(n) => cambiar(cambiarPregunta(cuestionario, si, pi, n))}
                    onMenu={() => menuDePregunta(si, pi, p, si === secciones.length - 1)} />
                );
              })}
              {!(s.preguntas || []).length ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Esta sección no tiene preguntas.</Text> : null}
              {editable ? (
                <View style={{ flexDirection: 'row', gap: 14 }}>
                  <Tocable onPress={() => hoja('Agregar pregunta', TIPOS_PREGUNTA.map((t) => ({ value: t.value, label: t.label })), (v) => {
                    const r = agregarPregunta(cuestionario, si, v);
                    cambiar(r.cuestionario);
                    setAbierta(r.id);
                  })}>
                    <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '700' }}>+ Agregar pregunta</Text>
                  </Tocable>
                  <Tocable onPress={() => menuDeSeccion(si)}>
                    <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>Sección…</Text>
                  </Tocable>
                </View>
              ) : null}
            </Seccion>
          ))}
          {editable ? <BotonGrande texto="Agregar sección" borde onPress={() => cambiar(agregarSeccion(cuestionario))} /> : null}
          {editable ? <Text style={{ color: colorSistema.texto2, fontSize: 12, textAlign: 'center' }}>Cada cambio se guarda solo. Mantén presionada una pregunta para moverla o quitarla.</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
