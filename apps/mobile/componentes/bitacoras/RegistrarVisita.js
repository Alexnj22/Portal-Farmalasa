// Anotar una visita del regente — `src/views/bitacoras/RegistrarVisitaModal.jsx`
// del portal. Lo que pide la norma: fecha, horario de permanencia y
// actividades realizadas; la firma y el sello van en la hoja impresa del mes.
// La base valida todo (quién anota, que la salida sea después de la entrada y
// que no choque con otra visita del mismo regente en otra sala) y su mensaje
// se muestra tal cual. Lo escrito queda como borrador por sucursal.
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { ACTIVIDADES_DE_REGENCIA, mensajeDeRegencia, registrarVisitaDeRegencia } from '@nucleo/data/regencia';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { hoySV } from '@nucleo/utils/fecha';
import { Aviso, BotonGrande, Campo, Ficha, Seccion } from '../formulario/Piezas';
import Fecha from '../formulario/Fecha';
import Hora from '../personas/Hora';
import { listo } from '../Progreso';
import { Hoja, Rotulo } from './Piezas';

export default function RegistrarVisita({ branchId, sala, regente, enSuNombre, onCerrar, onHecho }) {
  const BORRADOR = `regencia-visita-${branchId}`;
  const [g] = useState(() => loadDraft(BORRADOR));
  const [fecha, setFecha] = useState(g?.fecha ?? hoySV());
  const [entrada, setEntrada] = useState(g?.entrada ?? '');
  const [salida, setSalida] = useState(g?.salida ?? '');
  const [actividades, setActividades] = useState(g?.actividades ?? []);
  const [notas, setNotas] = useState(g?.notas ?? '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { saveDraft(BORRADOR, { fecha, entrada, salida, actividades, notas }); }, [BORRADOR, fecha, entrada, salida, actividades, notas]);

  const alternar = (v) => setActividades((a) => (a.includes(v) ? a.filter((x) => x !== v) : [...a, v]));
  // Lo que falta, en orden: las mismas condiciones que apagan el botón.
  const queFalta = !fecha ? 'Elige la fecha.'
    : !entrada ? 'Elige la hora de entrada.'
      : !salida ? 'Elige la hora de salida.'
        : !(salida > entrada) ? 'La salida tiene que ser después de la entrada.'
          : actividades.length === 0 ? 'Marca al menos una actividad realizada.'
            : null;

  const guardar = async () => {
    setGuardando(true); setError(null);
    const { error: e } = await registrarVisitaDeRegencia({ branchId, fecha, entrada, salida, actividades, notas });
    setGuardando(false);
    if (e) { setError(mensajeDeRegencia(e)); return; }
    clearDraft(BORRADOR);
    listo('Visita anotada', sala);
    onHecho?.();
  };

  return (
    <Hoja titulo="Anotar visita" subtitulo={`${sala}${regente ? ` · ${regente}` : ''}${enSuNombre ? ' (en su nombre)' : ''}`}
      onCerrar={onCerrar} ocupado={guardando}
      pie={(
        <>
          {queFalta && !guardando ? <Aviso tono="cuidado" texto={queFalta} /> : null}
          <BotonGrande texto={guardando ? 'Anotando…' : 'Anotar visita'} onPress={guardar} deshabilitado={guardando || !!queFalta} />
        </>
      )}>
      <Seccion titulo="Cuándo">
        <View style={{ gap: 4 }}>
          <Rotulo>Fecha</Rotulo>
          <Fecha valor={fecha} hasta={hoySV()} onCambiar={setFecha} />
        </View>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1, gap: 4 }}><Rotulo>{entrada ? 'Entrada' : 'Entrada · sin elegir'}</Rotulo><Hora valor={entrada} onCambiar={setEntrada} /></View>
          <View style={{ flex: 1, gap: 4 }}><Rotulo>{salida ? 'Salida' : 'Salida · sin elegir'}</Rotulo><Hora valor={salida} onCambiar={setSalida} /></View>
        </View>
        {entrada && salida && salida <= entrada ? <Aviso tono="cuidado" texto="La salida tiene que ser después de la entrada." /> : null}
      </Seccion>
      <Seccion titulo="Actividades realizadas">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {ACTIVIDADES_DE_REGENCIA.map((a) => (
            <Ficha key={a.value} texto={a.label} activa={actividades.includes(a.value)} onPress={() => alternar(a.value)} />
          ))}
        </View>
      </Seccion>
      <Seccion titulo="Notas (opcional)">
        <Campo value={notas} maxLength={500} onChangeText={setNotas} placeholder="Notas" />
      </Seccion>
      {error ? <Aviso tono="freno" texto={error} /> : null}
    </Hoja>
  );
}
