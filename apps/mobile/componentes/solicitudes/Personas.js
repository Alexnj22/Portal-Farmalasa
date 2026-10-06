// Las dos puntas de una solicitud: quién la mandó y en qué terminó — el
// `BloquePersonas` del portal (`solicitudes/PersonasSolicitud.jsx`), en la app.
//
// Va arriba del detalle porque es lo que uno pregunta antes de leer nada más.
// Las reglas de QUIÉN se nombra son las del núcleo, las mismas de la tarjeta y
// del portal:
//   · un traslado pendiente lo espera la SALA que tiene el producto (`salaQueEspera`);
//   · lo que resuelve un permiso y no una persona dice el ÁREA (`areaQueDecide`)
//     — nombrar a uno de cuatro se lee como que hay que esperar a ése;
//   · un Min/Max no tiene aprobador asignado: lo resuelve quien administre Min/Max;
//   · ya decidida, `aprobador` es quien de verdad la firmó, con su cara y su hora.
import { Text, View } from 'react-native';
import { useNowTick } from '@nucleo/hooks/useNowTick';
import {
  areaQueDecide, cuandoSeDecidio, cuantoTardo, desdeHace, fmtFechaHora, personasDe, salaQueEspera,
} from '@nucleo/utils/movimientoTexto';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import Avatar from '../Avatar';
import Vidrio from '../Vidrio';

const TONO = { warning: MARCA.ambar, danger: MARCA.rojo, success: MARCA.verde, card: colorSistema.texto2 };

function Ficha({ rotulo, persona, sala, vacio, cuando, apunte, tono = 'card', primero }) {
  const color = TONO[tono];
  const nombre = sala || (persona ? shortEmployeeName(persona) : vacio);
  return (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 10,
      borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador }}>
      {persona && !sala ? <Avatar empleado={persona} tamano={40} />
        : <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: `${color}26` }} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color, fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' }}>{rotulo}</Text>
        <Text style={{ color: sala || persona ? colorSistema.texto : colorSistema.texto2, fontSize: 16, fontWeight: sala || persona ? '700' : '500',
          fontStyle: sala || persona ? 'normal' : 'italic' }}>{nombre}</Text>
        {sala ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>La sala que tiene el producto</Text>
          : persona?.role ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{persona.role}</Text> : null}
        {cuando || apunte ? (
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
            {[cuando ? fmtFechaHora(cuando) : null, apunte || null].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export default function PersonasDeSolicitud({ req, empleadosPorId }) {
  const ahora = useNowTick(60_000);
  const { solicitante, aprobador } = personasDe(req, empleadosPorId);
  const cerro = cuandoSeDecidio(req);
  const cancelada = req.status === 'CANCELLED';
  const rechazada = req.status === 'REJECTED';
  const pendiente = req.status === 'PENDING';
  const esperaSala = salaQueEspera(req);
  const area = areaQueDecide(req);

  return (
    <Vidrio radio={20}>
      <View style={{ paddingHorizontal: 14, paddingVertical: 2 }}>
        <Ficha primero rotulo="Solicitó" persona={solicitante} vacio="Sin nombre" cuando={req.created_at}
          apunte={pendiente ? '' : desdeHace(req.created_at, ahora)} />
        <Ficha
          rotulo={pendiente ? 'Pendiente de' : cancelada ? 'Cancelada' : rechazada ? 'Rechazó' : 'Aprobó'}
          persona={cancelada || area ? null : aprobador}
          sala={cancelada ? null : esperaSala}
          vacio={cancelada ? 'La retiró quien la envió'
            : !pendiente ? 'Sin registro'
            : req.type === 'MINMAX_CHANGE_REQUEST' ? 'Quien administre Min/Max'
            : area || 'Sin asignar'}
          cuando={cancelada ? req.updated_at : cerro}
          apunte={pendiente ? `Esperando ${desdeHace(req.created_at, ahora)}` : cuantoTardo(req.created_at, cancelada ? req.updated_at : cerro)}
          tono={pendiente ? 'warning' : cancelada ? 'card' : rechazada ? 'danger' : 'success'} />
      </View>
    </Vidrio>
  );
}
