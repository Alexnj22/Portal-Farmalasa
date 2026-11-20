// Un borrador que se OFRECE, nunca se repone solo — el patrón de
// `sacar-dinero.js` y de los formularios del portal (`useBorrador` +
// «Recuperar / Descartar»). La sesión se cierra sola por inactividad y lo
// escrito se perdería; pero reponerlo en silencio es guardar algo sin mirarlo
// (un precio, un premio, una pieza), así que la pantalla lo muestra y la
// persona elige.
//
//   const borrador = useBorradorOfrecido(clave, valor, (b) => setF({ ...f, ...b }), { activo });
//   <BorradorOfrecido borrador={borrador} />
//   …al guardar con éxito: borrador.descartar();
//
// La clave es la MISMA del portal cuando el portal usa una: así un borrador
// empezado en la web se ofrece en la app y al revés.
import { useState } from 'react';
import { View } from 'react-native';
import useBorrador from '@nucleo/hooks/useBorrador';
import { hora12 } from '@nucleo/utils/hora';
import { Aviso, BotonGrande, Seccion } from './Piezas';

// ¿Hay algo escrito? Un objeto con todas sus claves vacías no cuenta.
const hayAlgo = (v) => !!v && typeof v === 'object'
  && Object.values(v).some((x) => (Array.isArray(x) ? x.length > 0 : x != null && x !== false && String(x).trim() !== ''));

export function useBorradorOfrecido(clave, valor, reponer, opciones) {
  const { recuperado, cuando, descartar } = useBorrador(clave, valor, opciones);
  const [visto, setVisto] = useState(false);
  return {
    // Con `vale` (lo mismo que decide si se guarda), se ofrece sólo lo que vale.
    ofrecer: !visto && !!recuperado && (opciones?.vale ? opciones.vale(recuperado) : hayAlgo(recuperado)),
    cuando,
    descartar,
    recuperar: () => { reponer(recuperado); descartar(); setVisto(true); },
    tirar: () => { descartar(); setVisto(true); },
  };
}

export default function BorradorOfrecido({ borrador, titulo = 'Cambios sin terminar' }) {
  if (!borrador?.ofrecer) return null;
  return (
    <Seccion titulo={titulo}>
      <Aviso tono="cuidado" texto={`Quedaron cambios sin guardar${borrador.cuando ? ` de las ${hora12(new Date(borrador.cuando))}` : ''}.`} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><BotonGrande texto="Recuperar" onPress={borrador.recuperar} /></View>
        <View style={{ flex: 1 }}><BotonGrande texto="Descartar" borde onPress={borrador.tirar} /></View>
      </View>
    </Seccion>
  );
}
