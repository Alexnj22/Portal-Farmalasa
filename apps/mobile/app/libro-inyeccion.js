// Los datos del libro de inyectables de una aplicación, NATIVOS — gemelo de
// `src/views/inyecciones/LibroInyectableModal.jsx` (2026-11-13, «dejemos TODO
// completamente nativo»). Lo pide el CSSP por tener inyectorio: documento y
// edad del paciente, médico, vía, sitio, reacción y la firma del paciente.
// Lote, vencimiento y dosis son de la ampolla: si la aplicación ya los tiene se
// muestran; si no, se piden. Lo escrito se guarda como borrador (la firma no:
// es del paciente que está enfrente). Lo que falta lo dice `faltaDelLibro`, lo
// mismo que exige `inyeccion_libro_guardar`.
import { useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, KeyboardAvoidingView, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { guardarLibroDeInyectable } from '@nucleo/data/inyecciones';
import { REACCIONES_DEL_LIBRO, VIAS_DE_APLICACION, faltaDelLibro, venceDeAmpolla } from '@nucleo/utils/inyeccionesPendientes';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Seccion, Vacio } from '../componentes/formulario/Piezas';
import Fecha from '../componentes/formulario/Fecha';
import FirmaEnPantalla from '../componentes/FirmaEnPantalla';
import Tocable from '../componentes/Tocable';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo } from '../componentes/Progreso';
import { leer } from '../componentes/comercial/elegido';
import { volver } from '../componentes/volver';

const VACIO = { documento: '', edad: '', medico: '', junta_medico: '', via: '', sitio: '', reaccion: '', observaciones: '', lote: '', vence: '', dosis_ml: '' };

function Rotulo({ texto }) {
  return <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', marginBottom: -4, marginLeft: 2 }}>{texto}</Text>;
}

function Elegir({ rotulo, valor, opciones, onElegir }) {
  const abrir = () => ActionSheetIOS.showActionSheetWithOptions(
    { title: rotulo, options: [...opciones.map((o) => o.label), 'Cancelar'], cancelButtonIndex: opciones.length },
    (i) => { if (i < opciones.length) onElegir(opciones[i].value); },
  );
  return (
    <Tocable onPress={abrir} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 10 }}>
      <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{rotulo}</Text>
      <Text style={{ flex: 1, color: valor ? colorSistema.acento : colorSistema.texto2, fontSize: 16, textAlign: 'right' }} numberOfLines={2}>
        {opciones.find((o) => o.value === valor)?.label ?? 'Elegir'}
      </Text>
      <Text style={{ color: colorSistema.texto2, fontSize: 18 }}>›</Text>
    </Tocable>
  );
}

export default function LibroDeInyeccion() {
  const entrada = useMemo(() => leer('libro-inyeccion'), []);
  if (!entrada?.fila) {
    return (
      <>
        <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Datos del libro', headerLargeTitle: false }} />
        <Vacio>Vuelve a la bitácora y elige la aplicación.</Vacio>
      </>
    );
  }
  return <Cuerpo fila={entrada.fila} libro={entrada.libro} />;
}

function Cuerpo({ fila, libro }) {
  const clave = `inyeccion-libro:${fila.id}`;
  const [datos, setDatos] = useState(() => loadDraft(clave) || { ...VACIO, ...(libro || {}), edad: libro?.edad != null ? String(libro.edad) : '' });
  const [firma, setFirma] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [firmando, setFirmando] = useState(false);
  useEffect(() => { saveDraft(clave, datos); }, [clave, datos]);
  const poner = (k) => (v) => setDatos((d) => ({ ...d, [k]: v }));

  const faltan = faltaDelLibro(datos, fila);
  const conReaccion = datos.reaccion && datos.reaccion !== 'Sin reacción';

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      // La bitácora la anota la base (`INYECCION_LIBRO`).
      await guardarLibroDeInyectable(fila.id, { ...datos, firma_png: firma });
      clearDraft(clave);
      listo('Libro completado', fila.producto);
      volver('/inyecciones');
    } catch (e) {
      const texto = e?.hint || mensajeAmigable(e, 'No se pudo guardar');
      setError(texto);
      fallo('No se pudo guardar', texto);
    } finally { setGuardando(false); }
  };

  return (
    <>
      {/* Sin el gesto de volver: firmar de izquierda a derecha es ese mismo
          gesto en iOS y sacaba de la pantalla a mitad de la firma. Se vuelve
          con la flecha. */}
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Datos del libro', headerLargeTitle: false, gestureEnabled: false, fullScreenGestureEnabled: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView scrollEnabled={!firmando} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }}
          contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled">
          <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
            {`${fila.producto} · ${fila.cliente || 'sin cliente'} · ${fila.origen === 'TRAIDA' ? 'lo trajo el paciente' : 'comprado aquí'}`}
          </Text>

          <Seccion titulo="Paciente">
            <Rotulo texto="DUI u otro documento del paciente" />
            <Campo multiline={false} value={datos.documento} onChangeText={poner('documento')} autoCorrect={false} />
            <Rotulo texto="Edad" />
            <Campo multiline={false} keyboardType="number-pad" value={datos.edad} onChangeText={(t) => poner('edad')(t.replace(/\D/g, '').slice(0, 3))} />
            <Rotulo texto="Médico que la recetó (opcional)" />
            <Campo multiline={false} value={datos.medico} onChangeText={poner('medico')} />
            <Rotulo texto="Número JVPM (opcional)" />
            <Campo multiline={false} keyboardType="number-pad" value={datos.junta_medico} onChangeText={poner('junta_medico')} />
          </Seccion>

          <Seccion titulo="La ampolla">
            {fila.lote ? <Dato rotulo="Lote" valor={fila.lote} primero /> : (
              <>
                <Rotulo texto="Lote" />
                <Campo multiline={false} autoCapitalize="characters" autoCorrect={false} value={datos.lote} onChangeText={poner('lote')} />
              </>
            )}
            {fila.vence ? <Dato rotulo="Vence" valor={venceDeAmpolla(fila.vence)} /> : (
              <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 8 }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>Vence</Text>
                {datos.vence ? <Fecha valor={datos.vence} onCambiar={poner('vence')} /> : (
                  <Tocable onPress={() => poner('vence')(new Date().toISOString().slice(0, 10))} style={{ minHeight: 44, justifyContent: 'center' }}>
                    <Text style={{ color: colorSistema.acento, fontSize: 16 }}>Elegir</Text>
                  </Tocable>
                )}
              </View>
            )}
            {fila.dosis_ml != null ? <Dato rotulo="Dosis" valor={`${fila.dosis_ml} ml`} /> : (
              <>
                <Rotulo texto="Dosis (ml)" />
                <Campo multiline={false} keyboardType="decimal-pad" value={String(datos.dosis_ml ?? '')} onChangeText={(t) => poner('dosis_ml')(t.replace(',', '.'))} />
              </>
            )}
          </Seccion>

          <Seccion titulo="La aplicación">
            <Elegir rotulo="Vía" valor={datos.via} opciones={VIAS_DE_APLICACION} onElegir={poner('via')} />
            <Rotulo texto="Sitio de aplicación" />
            <Campo multiline={false} placeholder="Glúteo, deltoides…" value={datos.sitio} onChangeText={poner('sitio')} />
            <Elegir rotulo="Reacción" valor={datos.reaccion} opciones={REACCIONES_DEL_LIBRO} onElegir={poner('reaccion')} />
            <Rotulo texto={conReaccion ? 'Qué pasó y qué se hizo' : 'Observaciones (opcional)'} />
            <Campo value={datos.observaciones} onChangeText={(t) => poner('observaciones')(t.slice(0, 500))} style={{ minHeight: 70 }} />
            {conReaccion ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Anótalo también en Cumplimiento → Farmacovigilancia.</Text> : null}
          </Seccion>

          <Seccion titulo="Firma">
            {libro?.firmado && !firma ? <Aviso texto="El paciente ya firmó. Si firma de nuevo, se reemplaza." /> : null}
            <FirmaEnPantalla onChange={setFirma} disabled={guardando} onFirmando={setFirmando}
              ayuda={libro?.firmado ? 'Opcional: ya hay una firma guardada.' : 'Opcional. Si el paciente no quiere firmar, se guarda igual.'} />
          </Seccion>

          {faltan.length ? <Aviso tono="cuidado" texto={`Falta: ${faltan.join(', ')}.`} /> : null}
          {error ? <Aviso tono="freno" texto={error} /> : null}
          <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar'} color={MARCA.azul} deshabilitado={guardando || faltan.length > 0} onPress={guardar} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
