// «Nueva encuesta», NATIVO — `NuevaEncuestaModal` del portal: empezar en
// blanco o desde una plantilla, con un nombre (con plantilla puede quedar
// vacío y usa el de la plantilla), y crearla como encuesta para aplicar o como
// plantilla para reutilizar. Las mismas llamadas del portal
// (`crearEncuesta`, `duplicarEncuesta` + `guardarDiseno`). Al crearla abre su
// diseño.
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, ScrollView } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { crearEncuesta, duplicarEncuesta, fetchEncuestas, guardarDiseno } from '@nucleo/data/encuestasClientes';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../../componentes/formulario/Piezas';
import { fallo } from '../../componentes/Progreso';

export default function NuevaEncuesta() {
  // `base`: se llega desde una plantilla con ella ya elegida.
  const { base: baseInicial } = useLocalSearchParams();
  const [plantillas, setPlantillas] = useState(null);
  const [base, setBase] = useState(baseInicial ? String(baseInicial) : '');
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState('encuesta');
  const [creando, setCreando] = useState(false);
  useEffect(() => {
    fetchEncuestas().then((es) => setPlantillas((es || []).filter((e) => e.es_plantilla))).catch(() => setPlantillas([]));
  }, []);
  const valido = nombre.trim() || base;

  const crear = async () => {
    setCreando(true);
    try {
      let id;
      if (base) {
        id = await duplicarEncuesta(base, tipo === 'plantilla');
        if (nombre.trim()) await guardarDiseno(id, { nombre: nombre.trim() });
      } else {
        id = await crearEncuesta({ nombre: nombre.trim(), es_plantilla: tipo === 'plantilla' });
      }
      router.replace({ pathname: '/encuesta-cliente/disenar', params: { id: String(id) } });
    } catch (e) {
      fallo('No se pudo crear', mensajeAmigable(e, 'Intenta de nuevo.'));
      setCreando(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Nueva encuesta', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          <Seccion titulo="Empezar desde">
            {plantillas == null ? <ActivityIndicator /> : (
              <Opciones valor={base} onCambiar={setBase}
                opciones={[{ id: '', label: 'En blanco' }, ...plantillas.map((p) => ({ id: String(p.id), label: p.nombre, detalle: p.objetivo || undefined }))]} />
            )}
          </Seccion>
          <Seccion titulo="Nombre" pie={base ? 'Si lo dejas vacío, usa el de la plantilla.' : null}>
            <Campo multiline={false} value={nombre} onChangeText={setNombre} placeholder="Ej. Satisfacción en sala — octubre" />
          </Seccion>
          <Seccion titulo="Es">
            <Opciones valor={tipo} onCambiar={setTipo} opciones={[
              { id: 'encuesta', label: 'Una encuesta para aplicar' },
              { id: 'plantilla', label: 'Una plantilla para reutilizar' },
            ]} />
          </Seccion>
          {!valido ? <Aviso texto="Escribe un nombre o elige una plantilla." /> : null}
          <BotonGrande texto={creando ? 'Creando…' : 'Crear'} deshabilitado={!valido || creando} onPress={crear} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
