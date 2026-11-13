// Los pasos del trámite que pone la ley, NATIVOS — gemelo de
// `src/views/datos/TramiteDeLey.jsx` (2026-11-13, «dejemos TODO completamente
// nativo»): prórroga (Art. 20), prevención (Art. 18), «la completó», archivar
// tras los diez días, negativa con su causal (Art. 22) y el aviso a terceros
// (cinco días hábiles). Cada paso va por `solicitud_datos_accion` /
// `solicitud_datos_tercero`: la base comprueba que la prórroga y la prevención
// se den UNA vez, que no se archive antes de tiempo y que la negativa diga su
// causal, y anota la bitácora con lo que se le comunicó a la persona.
import { useEffect, useState } from 'react';
import { ActionSheetIOS, Alert, Text, View } from 'react-native';
import {
  CAUSALES_DE_NEGATIVA, accionSolicitud, agregarTercero, anotarTerceroAvisado, fetchTercerosDeSolicitud, plazoDePrevencion,
} from '@nucleo/data/solicitudesDatos';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Campo } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import { MARCA } from '../inicio/marca';
import { listo as avisoListo } from '../Progreso';

const dia = (d) => fechaTexto(d, { day: 'numeric', month: 'long', year: 'numeric' });

const PASOS = {
  prorrogar: { rotulo: 'Causa de la prórroga (se le comunica a la persona)', boton: 'Prorrogar veinte días hábiles' },
  prevenir: { rotulo: 'Qué le falta presentar o completar', boton: 'Registrar la prevención' },
  subsanar: { rotulo: 'Qué presentó (opcional)', boton: 'La completó' },
  negar: { rotulo: 'Motivo de la negativa (va en la resolución)', boton: 'Negar la solicitud' },
};

function Rotulo({ texto }) {
  return <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', marginBottom: -4, marginLeft: 2 }}>{texto}</Text>;
}

export default function TramiteDeLey({ solicitud, onCambio }) {
  const [paso, setPaso] = useState(null);
  const [texto, setTexto] = useState('');
  const [causal, setCausal] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const prevencion = plazoDePrevencion(solicitud);
  const prevenida = solicitud.estado === 'PREVENIDA';

  const correr = async (accion, txt = texto, cau = causal) => {
    setOcupado(true);
    try {
      const fila = await accionSolicitud(solicitud.id, accion, txt?.trim() || null, cau || null);
      avisoListo('Listo', `Solicitud ${solicitud.folio_txt}`);
      setPaso(null); setTexto(''); setCausal('');
      onCambio?.(fila);
    } catch (e) {
      Alert.alert('No se pudo', mensajeAmigable(e, 'Intenta de nuevo.'));
    } finally { setOcupado(false); }
  };

  const abrir = (p) => { setPaso(p); setTexto(''); setCausal(''); };
  const completo = paso === 'negar' ? !!causal && !!texto.trim() : paso === 'subsanar' || !!texto.trim();
  const elegirCausal = () => ActionSheetIOS.showActionSheetWithOptions(
    { title: 'Causal (Art. 22)', options: [...CAUSALES_DE_NEGATIVA.map((c) => c.label), 'Cancelar'], cancelButtonIndex: CAUSALES_DE_NEGATIVA.length },
    (i) => { if (i < CAUSALES_DE_NEGATIVA.length) setCausal(CAUSALES_DE_NEGATIVA[i].value); },
  );
  const archivar = () => Alert.alert('Archivar la solicitud',
    'Pasaron los diez días hábiles de la prevención sin que la completara. Se archiva sin más trámite y puede presentar una nueva.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Archivar', style: 'destructive', onPress: () => correr('archivar', null, null) },
    ]);

  const botones = [
    !solicitud.prorrogada_at && !prevenida ? { id: 'prorrogar', texto: 'Prorrogar' } : null,
    !solicitud.prevenida_at ? { id: 'prevenir', texto: 'Prevenir' } : null,
    prevenida ? { id: 'subsanar', texto: 'La completó' } : null,
    prevenida && prevencion?.vencida ? { id: 'archivar', texto: 'Archivar' } : null,
    !prevenida ? { id: 'negar', texto: 'Negar', color: MARCA.rojo } : null,
  ].filter(Boolean);

  return (
    <View style={{ gap: 10 }}>
      {solicitud.prorrogada_at ? (
        <Aviso texto={`Prorrogada el ${dia(solicitud.prorrogada_at)}: el plazo es de cuarenta días hábiles desde el acuse.${solicitud.motivo_prorroga ? ` Causa: «${solicitud.motivo_prorroga}».` : ''}`} />
      ) : null}
      {prevenida && prevencion ? (
        <Aviso tono={prevencion.vencida ? 'cuidado' : 'nota'}
          texto={`Prevenida el ${dia(solicitud.prevenida_at)}${solicitud.prevencion ? `: «${solicitud.prevencion}»` : ''}. ${prevencion.vencida
            ? `Los diez días hábiles vencieron el ${dia(prevencion.vence)}. Si no la completó, se archiva sin más trámite y puede presentar una nueva.`
            : `Tiene hasta el ${dia(prevencion.vence)} para completarla.`}`} />
      ) : null}

      {!paso ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {botones.map((b) => (
            <View key={b.id} style={{ flexGrow: 1, flexBasis: '45%' }}>
              <BotonGrande texto={b.texto} borde color={b.color ?? MARCA.azulClaro} deshabilitado={ocupado}
                onPress={() => (b.id === 'archivar' ? archivar() : abrir(b.id))} />
            </View>
          ))}
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {paso === 'negar' ? (
            <BotonGrande texto={causal ? CAUSALES_DE_NEGATIVA.find((c) => c.value === causal)?.label : 'Elegir la causal (Art. 22)'}
              borde color={causal ? colorSistema.texto : MARCA.azulClaro} onPress={elegirCausal} />
          ) : null}
          <Rotulo texto={PASOS[paso].rotulo} />
          <Campo value={texto} onChangeText={(t) => setTexto(t.slice(0, 600))} style={{ minHeight: 70 }} autoFocus />
          <BotonGrande texto={ocupado ? 'Guardando…' : PASOS[paso].boton} color={paso === 'negar' ? MARCA.rojo : MARCA.azul}
            deshabilitado={!completo || ocupado} onPress={() => correr(paso)} />
          <BotonGrande texto="Cancelar" borde color={colorSistema.texto2} deshabilitado={ocupado} onPress={() => setPaso(null)} />
        </View>
      )}

      <Terceros solicitud={solicitud} />
    </View>
  );
}

/** A quién se le habían comunicado los datos corregidos o eliminados: cinco días hábiles para avisarle. */
function Terceros({ solicitud }) {
  const [filas, setFilas] = useState(null);
  const [tercero, setTercero] = useState('');
  const [que, setQue] = useState('');
  const [medios, setMedios] = useState({});
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetchTercerosDeSolicitud(solicitud.id)
      .then((d) => { if (vivo) setFilas(d); })
      .catch((e) => { if (vivo) { setFilas([]); Alert.alert('No se pudo cargar', mensajeAmigable(e)); } });
    return () => { vivo = false; };
  }, [solicitud.id]);

  const pedir = async (fn) => {
    setOcupado(true);
    try {
      const fila = await fn();
      setFilas((p) => [...(p ?? []).filter((x) => x.id !== fila.id), fila]
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))));
      return true;
    } catch (e) {
      Alert.alert('No se pudo', mensajeAmigable(e, 'Intenta de nuevo.'));
      return false;
    } finally { setOcupado(false); }
  };

  const pide = (solicitud.derechos ?? []).some((d) => ['rectificacion', 'cancelacion', 'olvido'].includes(d));
  if (!pide && !filas?.length) return null;

  return (
    <View style={{ gap: 8, marginTop: 6 }}>
      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>Aviso a terceros</Text>
      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
        Si los datos corregidos o eliminados se le habían comunicado a otra empresa o persona, hay que avisarle en cinco días hábiles.
      </Text>
      {(filas ?? []).map((t) => {
        const vencido = !t.avisado_at && t.vence < hoySV();
        return (
          <View key={t.id} style={{ gap: 6, paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{t.tercero}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{t.que}</Text>
              </View>
              {t.avisado_at
                ? <Pildora texto={`Avisado el ${fechaTexto(t.avisado_at, { day: 'numeric', month: 'short' })}`} color={MARCA.verde} />
                : <Pildora texto={vencido ? 'Plazo vencido' : `Hasta el ${fechaTexto(t.vence, { day: 'numeric', month: 'short' })}`} color={vencido ? MARCA.rojo : MARCA.ambar} />}
            </View>
            {t.avisado_at ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Por ${t.medio}`}</Text> : (
              <>
                <Campo multiline={false} value={medios[t.id] ?? ''} placeholder="Por qué medio se le avisó"
                  onChangeText={(v) => setMedios((m) => ({ ...m, [t.id]: v }))} />
                <BotonGrande texto="Ya se avisó" borde color={MARCA.azulClaro} deshabilitado={ocupado || !(medios[t.id] ?? '').trim()}
                  onPress={() => pedir(() => anotarTerceroAvisado(t.id, medios[t.id]))} />
              </>
            )}
          </View>
        );
      })}
      <Rotulo texto="A quién" />
      <Campo multiline={false} value={tercero} onChangeText={setTercero} />
      <Rotulo texto="Qué se corrigió o eliminó" />
      <Campo multiline={false} value={que} onChangeText={setQue} />
      <BotonGrande texto="Anotar" borde color={MARCA.azulClaro} deshabilitado={ocupado || !tercero.trim() || !que.trim()}
        onPress={async () => { if (await pedir(() => agregarTercero(solicitud.id, tercero, que))) { setTercero(''); setQue(''); } }} />
    </View>
  );
}
