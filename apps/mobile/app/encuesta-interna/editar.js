// Crear o editar una encuesta interna, NATIVO — el formulario de
// `EncuestaAdminView`: título, año, tipo (clima, satisfacción, desempeño,
// personalizada), estado, descripción, anónima, si comparte resultados y las
// fechas. Se guarda con `insertSurvey` / `actualizarEncuesta`, los mismos del
// portal, que anotan la bitácora solos.
//
// A quién va (todos / sucursales / cargos / personas): una encuesta nueva
// nace para TODOS; al editar se conserva el alcance que ya tenía. Elegir
// sucursales o personas sigue en el portal, donde está el buscador.
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, ScrollView, Switch, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { actualizarEncuesta, insertSurvey } from '@nucleo/data/encuestas';
import { ESTADO_ENCUESTA, TIPO_ENCUESTA } from '@nucleo/utils/climaLaboral';
import { hoySV } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../../componentes/formulario/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import { encuestaInternaAbierta } from '../../componentes/encuestas/interna';
import { fallo, listo } from '../../componentes/Progreso';

const ALCANCE = { all: 'Todo el personal', branches: 'Sucursales elegidas', roles: 'Jefaturas', employees: 'Personas elegidas' };

function Rotulo({ texto }) {
  return <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', marginBottom: -4, marginLeft: 2 }}>{texto}</Text>;
}

function Interruptor({ titulo, detalle, valor, onCambiar, primero }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: primero ? 0 : 10, borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{titulo}</Text>
        {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{detalle}</Text> : null}
      </View>
      <Switch value={valor} onValueChange={onCambiar} />
    </View>
  );
}

export default function EditarEncuestaInterna() {
  const { id } = useLocalSearchParams();
  const abierta = encuestaInternaAbierta();
  const e = id !== 'nueva' && abierta?.encuesta && String(abierta.encuesta.id) === String(id) ? abierta.encuesta : null;
  const [f, setF] = useState({
    nombre: e?.nombre ?? '', anio: String(e?.['año'] ?? new Date().getFullYear()), tipo: e?.tipo ?? 'clima',
    estado: e?.estado ?? 'activa', descripcion: e?.descripcion ?? '', anonima: e?.anonima ?? true,
    compartir: e?.compartir_resultados ?? false, inicio: e?.fecha_inicio ?? '', fin: e?.fecha_fin ?? '',
  });
  const [guardando, setGuardando] = useState(false);
  const cambiar = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const alcance = e?.scope_tipo ?? 'all';

  const guardar = async () => {
    if (!f.nombre.trim()) { Alert.alert('Falta el título', 'El título de la encuesta es obligatorio.'); return; }
    const anio = Number(f.anio);
    if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) { Alert.alert('Año', 'Escribe un año válido.'); return; }
    if (f.inicio && f.fin && f.fin < f.inicio) { Alert.alert('Fechas', 'La fecha de cierre es anterior a la de inicio.'); return; }
    setGuardando(true);
    const payload = {
      nombre: f.nombre.trim(), 'año': anio, tipo: f.tipo, estado: f.estado,
      descripcion: f.descripcion.trim() || null, anonima: f.anonima, compartir_resultados: f.compartir,
      fecha_inicio: f.inicio || null, fecha_fin: f.fin || null,
      ...(e ? {} : { scope_tipo: 'all', scope_ids: [] }),
    };
    const { error } = e ? await actualizarEncuesta(e.id, payload) : await insertSurvey(payload);
    setGuardando(false);
    if (error) { fallo(e ? 'No se pudo actualizar' : 'No se pudo crear', error.message || ''); return; }
    listo(e ? 'Encuesta actualizada' : 'Encuesta creada', f.nombre.trim());
    router.back();
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: e ? 'Editar encuesta' : 'Nueva encuesta', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          <Seccion titulo="La encuesta">
            <Rotulo texto="Título" />
            <Campo multiline={false} value={f.nombre} onChangeText={cambiar('nombre')} maxLength={120} placeholder="Ej. Clima laboral 2026" />
            <Rotulo texto="Año" />
            <Campo multiline={false} value={f.anio} onChangeText={cambiar('anio')} keyboardType="number-pad" maxLength={4} />
            <Rotulo texto="Descripción (opcional)" />
            <Campo value={f.descripcion} onChangeText={cambiar('descripcion')} maxLength={600} style={{ minHeight: 80 }} />
          </Seccion>
          <Seccion titulo="Tipo">
            <Opciones opciones={Object.entries(TIPO_ENCUESTA).map(([k, v]) => ({ id: k, label: v }))} valor={f.tipo} onCambiar={cambiar('tipo')} />
          </Seccion>
          <Seccion titulo="Estado">
            <Opciones opciones={Object.entries(ESTADO_ENCUESTA).map(([k, v]) => ({ id: k, label: v }))} valor={f.estado} onCambiar={cambiar('estado')} />
          </Seccion>
          <Seccion titulo="Fechas (opcionales)">
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Desde</Text>
              <Fecha valor={f.inicio || hoySV()} onCambiar={cambiar('inicio')} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Hasta</Text>
              <Fecha valor={f.fin || f.inicio || hoySV()} onCambiar={cambiar('fin')} desde={f.inicio || undefined} />
            </View>
            {!f.inicio && !f.fin ? <Aviso texto="Sin fechas, la encuesta no tiene apertura ni cierre automáticos." /> : null}
          </Seccion>
          <Seccion>
            <Interruptor primero titulo="Anónima" detalle="Los resultados no muestran quién respondió." valor={f.anonima} onCambiar={cambiar('anonima')} />
            <Interruptor titulo="Compartir resultados" detalle="El personal puede ver el resultado general." valor={f.compartir} onCambiar={cambiar('compartir')} />
          </Seccion>
          <Aviso texto={e ? `Va dirigida a: ${ALCANCE[alcance] ?? alcance}. Para cambiar a quién va, usa el portal.` : 'Una encuesta nueva va dirigida a todo el personal. Para elegir sucursales o personas, edítala en el portal.'} />
          <BotonGrande texto={guardando ? 'Guardando…' : e ? 'Guardar cambios' : 'Crear encuesta'} onPress={guardar} deshabilitado={guardando} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
