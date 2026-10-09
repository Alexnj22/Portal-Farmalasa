// Capturar o corregir la respuesta de una persona a una encuesta interna,
// NATIVO — el formulario de `EncuestaAdminView`: la persona (sólo quienes
// todavía no respondieron), si responde como empleado o como jefe de sala,
// cada pregunta por bloque con sus opciones A·B·C·D (o del 1 al 10 en las
// numéricas) y el comentario. La pregunta 1 (antigüedad) y la de sucursal se
// llenan solas desde la ficha, con la misma regla del portal
// (`categoriaDeAntiguedad`, núcleo).
//
// Se guarda con `insertSurveyResponse` / `updateSurveyResponse`, los mismos
// del portal, que anotan la bitácora solos. Una respuesta ya capturada también
// se elimina (`deleteSurveyResponse`, con confirmación), como en el portal.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  deleteSurveyResponse, fetchEmployeesForSurvey, fetchSurveyBloques, fetchSurveyPreguntas, fetchSurveyResponses, insertSurveyResponse, updateSurveyResponse,
} from '@nucleo/data/encuestas';
import { categoriaDeAntiguedad } from '@nucleo/utils/climaLaboral';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../../componentes/formulario/Piezas';
import Segmentos from '../../componentes/Segmentos';
import { MARCA } from '../../componentes/inicio/marca';
import { encuestaInternaAbierta } from '../../componentes/encuestas/interna';
import { fallo, listo } from '../../componentes/Progreso';

const LETRAS = ['A', 'B', 'C', 'D'];
const nombreDe = (e) => shortEmployeeName({ name: `${e?.first_names ?? ''} ${e?.last_names ?? ''}`.trim() });

function Opcion({ texto, activa, onPress, color = MARCA.azul }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} hitSlop={4}
      style={{ minWidth: 40, height: 36, paddingHorizontal: 8, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
        backgroundColor: activa ? color : 'rgba(127,127,127,0.18)' }}>
      <Text style={{ color: activa ? '#fff' : colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

function Pregunta({ p, valor, onCambiar }) {
  return (
    <View style={{ gap: 8, paddingVertical: 4 }}>
      <Text style={{ color: colorSistema.texto, fontSize: 15 }}>
        <Text style={{ color: colorSistema.texto2, fontWeight: '700' }}>{`${p.numero}. `}</Text>{p.texto}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {p.tipo === 'numerica'
          ? Array.from({ length: 10 }, (_, i) => String(i + 1)).map((n) => (
            <Opcion key={n} texto={n} activa={valor === n} color={Number(n) >= 9 ? MARCA.verde : Number(n) >= 7 ? MARCA.azul : Number(n) >= 5 ? MARCA.ambar : MARCA.rojo}
              onPress={() => onCambiar(valor === n ? null : n)} />
          ))
          : LETRAS.map((l) => <Opcion key={l} texto={l} activa={valor === l} onPress={() => onCambiar(valor === l ? null : l)} />)}
      </View>
    </View>
  );
}

export default function RespuestaInterna() {
  const abierta = encuestaInternaAbierta();
  const encuesta = abierta?.encuesta;
  const editando = abierta?.respuesta ?? null;
  const [bloques, setBloques] = useState(null);
  const [preguntas, setPreguntas] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [respondieron, setRespondieron] = useState(new Set());
  const [empleadoId, setEmpleadoId] = useState(editando?.employee_id ?? null);
  const [jefe, setJefe] = useState(editando?.is_jefe ?? false);
  const [respuestas, setRespuestas] = useState([]);
  const [comentario, setComentario] = useState(editando?.comentario ?? '');
  const [busca, setBusca] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!encuesta) return;
    Promise.all([fetchSurveyBloques(encuesta.id), fetchSurveyPreguntas(encuesta.id), fetchEmployeesForSurvey(), fetchSurveyResponses(encuesta.id)])
      .then(([b, p, e, r]) => {
        const ps = p.data || [];
        const max = ps.reduce((m, x) => Math.max(m, x.indice ?? 0), 0);
        const base = Array(max + 1).fill(null);
        (editando?.responses || []).forEach((v, i) => { base[i] = v; });
        setRespuestas(base);
        setBloques(b.data || []);
        setPreguntas(ps);
        setEmpleados(e.data || []);
        setRespondieron(new Set((r.data || []).map((x) => x.employee_id)));
      })
      .catch((x) => { fallo('No se pudo cargar la encuesta', x?.message || ''); setBloques([]); });
  }, [encuesta, editando]);

  // Al elegir a alguien (respuesta nueva), P1 y la sucursal salen de su ficha.
  const elegir = (id) => {
    setEmpleadoId(id);
    const emp = empleados.find((x) => x.id === id);
    if (!emp || editando) return;
    const p1 = preguntas.find((x) => x.numero === 1);
    const p2 = preguntas.find((x) => x.numero === 2);
    setRespuestas((prev) => {
      const a = [...prev];
      const ant = categoriaDeAntiguedad(emp.hire_date);
      if (p1 && ant) a[p1.indice] = ant;
      if (p2 && emp.branch?.name) a[p2.indice] = emp.branch.name;
      return a;
    });
  };

  const formPreguntas = useMemo(() => preguntas.filter((p) => p.tipo !== 'sucursal'), [preguntas]);
  const contestadas = formPreguntas.filter((p) => respuestas[p.indice] != null).length;
  const generales = preguntas.filter((p) => p.bloque_id == null && p.tipo !== 'sucursal' && p.numero !== 1);
  const disponibles = useMemo(() => empleados
    .filter((e) => !respondieron.has(e.id))
    .filter((e) => !busca.trim() || tokenMatch(busca, `${e.first_names ?? ''} ${e.last_names ?? ''}`, e.branch?.name)), [empleados, respondieron, busca]);
  const elegido = empleados.find((e) => e.id === empleadoId) || editando?.employee || null;

  if (!encuesta) return <View style={{ margin: 16 }}><Aviso tono="freno" texto="Vuelve a abrir la encuesta desde la lista." /></View>;
  const cambiar = (indice, v) => setRespuestas((prev) => { const a = [...prev]; a[indice] = v; return a; });

  const guardar = async () => {
    if (!empleadoId) { Alert.alert('Falta la persona', 'Elige a quién corresponde la respuesta.'); return; }
    setGuardando(true);
    const { error } = editando
      ? await updateSurveyResponse(editando.id, { is_jefe: jefe, responses: respuestas, comentario: comentario.trim() || null, updated_at: new Date().toISOString() },
        { surveyId: encuesta.id, employeeId: empleadoId })
      : await insertSurveyResponse({ survey_id: encuesta.id, employee_id: empleadoId, is_jefe: jefe, responses: respuestas, comentario: comentario.trim() || null });
    setGuardando(false);
    if (error) { fallo(editando ? 'No se pudo actualizar' : 'No se pudo guardar', error.message || ''); return; }
    listo(editando ? 'Respuesta actualizada' : 'Respuesta registrada', elegido ? nombreDe(elegido) : '');
    router.back();
  };

  const eliminar = () => Alert.alert('¿Eliminar la respuesta?', `Se borra la respuesta de ${elegido ? nombreDe(elegido) : 'esta persona'} y deja de contar en los resultados.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Eliminar', style: 'destructive', onPress: async () => {
      setGuardando(true);
      const { error } = await deleteSurveyResponse(editando.id, { surveyId: encuesta.id, employeeId: editando.employee_id });
      setGuardando(false);
      if (error) { fallo('No se pudo eliminar', error.message || ''); return; }
      listo('Respuesta eliminada', '');
      router.back();
    } },
  ]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: editando ? 'Editar respuesta' : 'Nueva respuesta', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{encuesta.nombre}</Text>
          {bloques == null ? <ActivityIndicator /> : (
            <>
              <Seccion titulo="Persona">
                {elegido ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{`${nombreDe(elegido)}${elegido.branch?.name ? ` · ${elegido.branch.name}` : ''}`}</Text>
                    {!editando ? <Pressable onPress={() => setEmpleadoId(null)} hitSlop={8}><Text style={{ color: MARCA.azulClaro, fontSize: 15 }}>Cambiar</Text></Pressable> : null}
                  </View>
                ) : (
                  <>
                    <Campo multiline={false} value={busca} onChangeText={setBusca} placeholder="Buscar por nombre o sala" />
                    {disponibles.slice(0, 30).map((e, i) => (
                      <Pressable key={e.id} onPress={() => elegir(e.id)} style={({ pressed }) => ({ paddingVertical: 8, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
                        <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{nombreDe(e)}</Text>
                        {e.branch?.name ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{e.branch.name}</Text> : null}
                      </Pressable>
                    ))}
                    {!disponibles.length ? <Aviso texto="Todos ya respondieron (o nadie coincide con la búsqueda)." /> : null}
                  </>
                )}
              </Seccion>
              <Segmentos activa={jefe ? 'jefe' : 'empleado'} onCambiar={(v) => setJefe(v === 'jefe')} margen={0}
                opciones={[{ id: 'empleado', label: 'Empleado/a' }, { id: 'jefe', label: 'Jefe/a de sala' }]} />
              {formPreguntas.length ? (
                <View style={{ gap: 4 }}>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: colorSistema.separador, overflow: 'hidden' }}>
                    <View style={{ width: `${(contestadas / formPreguntas.length) * 100}%`, height: 6, backgroundColor: MARCA.azul }} />
                  </View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${contestadas} de ${formPreguntas.length} contestadas`}</Text>
                </View>
              ) : null}
              {generales.length ? (
                <Seccion titulo="Datos generales">
                  {generales.map((p) => <Pregunta key={p.id} p={p} valor={respuestas[p.indice]} onCambiar={(v) => cambiar(p.indice, v)} />)}
                </Seccion>
              ) : null}
              {bloques.map((b) => {
                const qs = preguntas.filter((p) => p.bloque_id === b.id && p.tipo !== 'sucursal');
                if (!qs.length) return null;
                return (
                  <Seccion key={b.id} titulo={`B${b.numero} · ${b.nombre}`}>
                    {qs.map((p) => <Pregunta key={p.id} p={p} valor={respuestas[p.indice]} onCambiar={(v) => cambiar(p.indice, v)} />)}
                  </Seccion>
                );
              })}
              <Seccion titulo="Comentario (opcional)">
                <Campo value={comentario} onChangeText={setComentario} placeholder="¿Qué mejorarías del ambiente de trabajo?" style={{ minHeight: 80 }} />
              </Seccion>
              <BotonGrande texto={guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Registrar respuesta'} onPress={guardar} deshabilitado={guardando || !empleadoId} />
              {editando ? <BotonGrande texto="Eliminar la respuesta" borde color={MARCA.rojo} onPress={eliminar} deshabilitado={guardando} /> : null}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
