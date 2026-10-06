// Editar UN día del horario de una persona, NATIVO — el `InlineDayEditor` del
// portal: libre, un turno del catálogo que quepa en el horario de la sala ese
// día, u horas propias; con almuerzo y lactancia. Las reglas son del núcleo
// (`edicionDeHorario`): qué turnos se ofrecen, qué se guarda y qué reparos
// frenan el guardado. El día resultante lo resuelve `resolverTurnoDelDia`.
//
// Quien llama decide a dónde va: el horario de la persona
// (`guardarDiaDeHorario`, que NO toca el estado de publicación) o la cobertura
// de alguien de otra sala.
import { useMemo, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { resolverTurnoDelDia } from '@nucleo/utils/turnoDelDia';
import {
  datosDelDiaParaGuardar, horasDelTurno, limitesDeLaSalaElDia, reparosDeLaCelda, turnosQueCabenElDia,
} from '@nucleo/utils/edicionDeHorario';
import { hora12 } from '@nucleo/utils/hora';
import { fechaTexto } from '@nucleo/utils/fecha';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Opciones, Seccion } from '../formulario/Piezas';
import { MARCA } from '../inicio/marca';
import Hora from './Hora';

const estadoInicial = (actual) => ({
  turno: actual?.shiftId ? String(actual.shiftId) : actual?.isOff ? 'OFF' : (actual?.customStart ? '' : 'OFF'),
  inicio: actual?.customStart || '08:00',
  fin: actual?.customEnd || '16:00',
  conPausa: Boolean(actual?.hasLunch),
  pausa: actual?.lunchStart || '12:00',
  conLactancia: Boolean(actual?.hasLactation),
  lactancia: actual?.lactationStart || '15:00',
});

function Interruptor({ titulo, valor, onCambiar, children }) {
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{titulo}</Text>
        <Switch value={valor} onValueChange={onCambiar} />
      </View>
      {valor ? children : null}
    </View>
  );
}

function FilaHora({ rotulo, valor, onCambiar }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>{rotulo}</Text>
      <Hora valor={valor} onCambiar={onCambiar} />
    </View>
  );
}

export default function EditorDeDia({ fecha, dia, actual, turnos, sala, onGuardar, guardando = false, aviso = null }) {
  const [f, setF] = useState(() => estadoInicial(actual));
  const cambiar = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const limites = useMemo(() => limitesDeLaSalaElDia(sala, dia), [sala, dia]);
  const ofrecidos = useMemo(() => turnosQueCabenElDia(turnos, limites), [turnos, limites]);

  // Elegir un turno trae sus horas y su pausa (desde el 2026-08-27 el turno las trae).
  const elegir = (id) => {
    if (id === 'OFF' || id === '') { setF((x) => ({ ...x, turno: id })); return; }
    const h = horasDelTurno(ofrecidos.find((t) => String(t.id) === String(id)));
    setF((x) => ({ ...x, turno: id, ...(h ? { inicio: h.inicio, fin: h.fin, ...(h.conPausa ? { conPausa: true, pausa: h.pausa } : {}) } : {}) }));
  };

  const trabaja = f.turno !== 'OFF';
  const resuelto = useMemo(() => resolverTurnoDelDia(trabaja ? {
    shiftId: f.turno, customStart: f.inicio, customEnd: f.fin, hasLunch: f.conPausa, lunchStart: f.pausa,
    hasLactation: f.conLactancia, lactationStart: f.lactancia, isOff: false,
  } : { isOff: true }, turnos || []), [f, trabaja, turnos]);
  const reparos = useMemo(() => reparosDeLaCelda(f, turnos, limites), [f, turnos, limites]);

  const opciones = [
    { id: 'OFF', label: 'Libre / descanso' },
    ...ofrecidos.map((t) => ({ id: String(t.id), label: t.name, detalle: `${hora12(horasDelTurno(t).inicio)} – ${hora12(horasDelTurno(t).fin)}` })),
    { id: '', label: 'Horas propias', detalle: 'Escribir la entrada y la salida' },
  ];

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 4 }}>
        {fechaTexto(fecha, { weekday: 'long', day: 'numeric', month: 'long' })}
      </Text>
      {aviso ? <Aviso tono="cuidado" texto={aviso} /> : null}
      {!limites.hayHorario ? <Aviso tono="cuidado" texto={`${limites.nombre} no tiene horario de atención configurado: el catálogo no ofrece turnos para este día.`} /> : null}
      {limites.cerrada ? <Aviso tono="cuidado" texto={`${limites.nombre} no abre este día.`} /> : null}

      <Seccion titulo="Turno">
        <Opciones opciones={opciones} valor={f.turno} onCambiar={elegir} />
      </Seccion>

      {trabaja ? (
        <>
          <Seccion titulo="Horas">
            <FilaHora rotulo="Entra" valor={f.inicio} onCambiar={(v) => setF((x) => ({ ...x, turno: x.turno && x.turno !== 'OFF' ? '' : x.turno, inicio: v }))} />
            <FilaHora rotulo="Sale" valor={f.fin} onCambiar={(v) => setF((x) => ({ ...x, turno: x.turno && x.turno !== 'OFF' ? '' : x.turno, fin: v }))} />
          </Seccion>
          <Seccion>
            <Interruptor titulo="Almuerzo" valor={f.conPausa} onCambiar={cambiar('conPausa')}>
              <FilaHora rotulo="Sale a almorzar" valor={f.pausa} onCambiar={cambiar('pausa')} />
            </Interruptor>
            <Interruptor titulo="Lactancia" valor={f.conLactancia} onCambiar={cambiar('conLactancia')}>
              <FilaHora rotulo="Hora de lactancia" valor={f.lactancia} onCambiar={cambiar('lactancia')} />
            </Interruptor>
          </Seccion>
          {resuelto.trabaja ? (
            <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 4 }}>
              {`${hora12(resuelto.inicio)} – ${hora12(resuelto.fin)} · ${Number((resuelto.minutosPagados / 60).toFixed(1))} h pagadas${resuelto.esJornadaNocturna ? ' · jornada nocturna' : ''}`}
            </Text>
          ) : null}
        </>
      ) : null}

      {reparos.map((r) => <Aviso key={r} tono="freno" texto={r} />)}
      <BotonGrande texto={guardando ? 'Guardando…' : trabaja ? 'Guardar el día' : 'Asignar descanso'} color={trabaja ? MARCA.azul : MARCA.violeta}
        deshabilitado={guardando || reparos.length > 0}
        onPress={() => onGuardar(datosDelDiaParaGuardar(f))} />
    </ScrollView>
  );
}
