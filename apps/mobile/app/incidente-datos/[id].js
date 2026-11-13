// Un incidente de seguridad de datos personales (Art. 25), NATIVO — gemelo de
// la `Ficha` de `src/views/datos/IncidentesDatos.jsx` (2026-11-13, «dejemos
// TODO completamente nativo»). Setenta y dos horas desde que se detecta para
// notificar a la Agencia de Ciberseguridad, a la Fiscalía y a las personas
// afectadas. Quién lo registró lo pone la base; los avisos de 48 y 72 horas los
// manda `avisar_incidentes_datos`. Lo escrito se guarda como borrador: la
// sesión se cierra sola por inactividad.
import { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { NOTIFICACIONES_DE_INCIDENTE, fetchIncidentes, guardarIncidente, plazoDeIncidente } from '@nucleo/data/solicitudesDatos';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { diaSV, fechaTexto, hoySV, horaSV } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Cargando, Seccion } from '../../componentes/formulario/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import Hora from '../../componentes/personas/Hora';
import Tocable from '../../componentes/Tocable';
import { MARCA } from '../../componentes/inicio/marca';
import { listo } from '../../componentes/Progreso';

const CAMPOS_FECHA = ['detectado_at', 'ocurrido_at', 'notificado_agencia_at', 'notificado_fiscalia_at', 'notificado_titulares_at', 'cerrado_at'];
const TEXTOS = ['naturaleza', 'datos_comprometidos', 'afectados', 'medidas_inmediatas', 'recomendaciones', 'medidas_definitivas', 'notas'];
const instante = (dia, hora) => new Date(`${dia}T${hora}:00-06:00`).toISOString();
const cuando = (iso) => (iso ? fechaTexto(iso, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

function Rotulo({ texto }) {
  return <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', marginBottom: -4, marginLeft: 2 }}>{texto}</Text>;
}

/** Fecha y hora en una fila; vacía se anota con «Anotar» y se puede quitar si no es obligatoria. */
function Momento({ rotulo, valor, onCambiar, editable, obligatorio }) {
  if (!editable) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 8 }}>
        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>{rotulo}</Text>
        <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>{cuando(valor)}</Text>
      </View>
    );
  }
  const dia = valor ? diaSV(valor) : null;
  const hora = valor ? horaSV(valor).slice(0, 5) : null;
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 8 }}>
        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>{rotulo}</Text>
        {valor ? (
          <>
            <Fecha valor={dia} hasta={hoySV()} onCambiar={(d) => onCambiar(instante(d, hora))} />
            <Hora valor={hora} onCambiar={(h) => onCambiar(instante(dia, String(h).slice(0, 5)))} />
          </>
        ) : (
          <Tocable onPress={() => onCambiar(new Date().toISOString())} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }}>
            <Text style={{ color: colorSistema.acento, fontSize: 15 }}>Anotar</Text>
          </Tocable>
        )}
      </View>
      {valor && !obligatorio ? (
        <Tocable onPress={() => onCambiar(null)} style={{ alignSelf: 'flex-end', minHeight: 32, justifyContent: 'center' }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Quitar (${hora12(hora)})`}</Text>
        </Tocable>
      ) : null}
    </View>
  );
}

export default function IncidenteDeDatos() {
  const { id } = useLocalSearchParams();
  const nuevo = id === 'nuevo';
  const [inc, setInc] = useState(nuevo ? {} : null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (nuevo) return;
    fetchIncidentes()
      .then((filas) => {
        const i = filas.find((x) => String(x.id) === String(id));
        if (i) setInc(i); else setError('No se encontró el incidente.');
      })
      .catch((e) => setError(mensajeAmigable(e, 'No se pudo cargar el incidente.')));
  }, [id, nuevo]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: nuevo ? 'Registrar incidente' : 'Incidente de seguridad', headerLargeTitle: false }} />
      {error ? <View style={{ padding: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {!inc && !error ? <Cargando /> : null}
      {inc ? <Cuerpo inc={inc} /> : null}
    </>
  );
}

function Cuerpo({ inc }) {
  const nuevo = !inc.id;
  const borrador = `incidente_datos_${inc.id ?? 'nuevo'}`;
  const cerrado = !!inc.cerrado_at;
  const [f, setF] = useState(() => loadDraft(borrador) ?? {
    ...Object.fromEntries(CAMPOS_FECHA.map((k) => [k, inc[k] ?? null])),
    detectado_at: inc.detectado_at ?? new Date().toISOString(),
    ...Object.fromEntries(TEXTOS.map((k) => [k, inc[k] ?? ''])),
  });
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { if (!cerrado) saveDraft(borrador, f); }, [borrador, f, cerrado]);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  const completo = !!f.detectado_at && !!String(f.naturaleza).trim() && !!String(f.datos_comprometidos).trim();
  const plazo = useMemo(() => plazoDeIncidente({ ...inc, ...f }), [inc, f]);

  const guardar = async (cerrar = false) => {
    setGuardando(true);
    try {
      const campos = { ...f };
      if (cerrar) campos.cerrado_at = new Date().toISOString();
      await guardarIncidente(inc.id ?? null, campos);
      clearDraft(borrador);
      listo('Guardado', nuevo ? 'Incidente registrado: corre el plazo de 72 horas' : cerrar ? 'Incidente cerrado' : 'Incidente actualizado');
      router.back();
    } catch (e) {
      Alert.alert('No se pudo guardar', mensajeAmigable(e));
    } finally { setGuardando(false); }
  };
  const cerrarIncidente = () => Alert.alert('Cerrar el incidente', 'Queda cerrado y ya no se edita.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Cerrar', onPress: () => guardar(true) },
  ]);

  const texto = (k, rotulo, alto = 60) => (
    <>
      <Rotulo texto={rotulo} />
      <Campo editable={!cerrado} value={f[k]} onChangeText={set(k)} style={{ minHeight: alto }} />
    </>
  );

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled">
        {cerrado ? <Aviso texto={`Cerrado el ${cuando(inc.cerrado_at)}. Ya no se edita.`} /> : null}
        {plazo && !plazo.completo && !cerrado ? (
          <Aviso tono={plazo.vencido ? 'freno' : 'cuidado'}
            texto={`${plazo.vencido ? 'Pasaron las 72 horas.' : `Hay que notificar a más tardar el ${cuando(plazo.vence).replace(/\.$/, '')}.`} Falta: ${plazo.faltan.map((x) => x.rotulo).join(', ')}.`} />
        ) : null}
        {plazo?.completo && !cerrado ? <Aviso texto="Las tres notificaciones están hechas: ya se puede cerrar." /> : null}

        <Seccion titulo="Qué pasó">
          <Momento rotulo="Cuándo se detectó" valor={f.detectado_at} onCambiar={set('detectado_at')} editable={!cerrado} obligatorio />
          <Momento rotulo="Cuándo ocurrió (si se sabe)" valor={f.ocurrido_at} onCambiar={set('ocurrido_at')} editable={!cerrado} />
          {texto('naturaleza', 'Qué pasó y por qué', 80)}
          {texto('datos_comprometidos', 'Qué datos se comprometieron')}
          {texto('afectados', 'A quiénes afecta (cuántas personas, quiénes)')}
          {texto('medidas_inmediatas', 'Medidas inmediatas')}
          {texto('recomendaciones', 'Recomendaciones a las personas afectadas')}
        </Seccion>

        <Seccion titulo="Notificaciones">
          {NOTIFICACIONES_DE_INCIDENTE.map((n) => (
            <Momento key={n.campo} rotulo={n.rotulo} valor={f[n.campo]} onCambiar={set(n.campo)} editable={!cerrado} />
          ))}
        </Seccion>

        <Seccion titulo="Cierre">
          {texto('medidas_definitivas', 'Medidas definitivas')}
          {texto('notas', 'Notas internas')}
          {inc.registrado ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Lo registró ${shortEmployeeName(inc.registrado)}`}</Text> : null}
        </Seccion>

        {!cerrado ? (
          <>
            <BotonGrande texto={guardando ? 'Guardando…' : nuevo ? 'Registrar' : 'Guardar'} color={MARCA.azul}
              deshabilitado={guardando || !completo} onPress={() => guardar(false)} />
            {!nuevo ? (
              <BotonGrande texto="Cerrar el incidente" borde color={MARCA.verde}
                deshabilitado={guardando || !completo || !plazo?.completo} onPress={cerrarIncidente} />
            ) : null}
            {!nuevo && !plazo?.completo ? <Text style={{ color: colorSistema.texto2, fontSize: 12, textAlign: 'center' }}>Para cerrarlo tienen que estar las tres notificaciones.</Text> : null}
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
