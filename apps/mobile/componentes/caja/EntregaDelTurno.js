// Por qué manos pasó la caja hoy — `EntregaDelTurno` del portal. La cadena la
// arma el núcleo (`cadenaDeEntregas`): quien hizo cada corte se la entrega a
// quien la recibió al confirmarlo. Un salto (otra persona cortó sin haberla
// recibido) va con un punto, no con una flecha: nadie entregó ahí. Un hueco es
// un corte confirmado SIN entregar la caja, y se dibuja como tal.
import { Text, View } from 'react-native';
import { cadenaDeEntregas } from '@nucleo/utils/cortesDiagnostico';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { hora12 } from '@nucleo/utils/hora';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import Avatar from '../Avatar';

export default function EntregaDelTurno({ entregas, personas }) {
  const nodos = cadenaDeEntregas(entregas);
  if (nodos.length < 2) return null;
  const ficha = (n) => (n?.id ? (personas?.get(n.id) || { id: n.id, name: n.name }) : null);
  const ultimo = nodos[nodos.length - 1];
  const primero = nodos[0];
  const cuantas = nodos.filter((n) => n.hora).length;
  // Con más de cuatro manos se pliega el medio, como en el portal.
  const visibles = nodos.length > 4 ? [nodos[0], { plegado: nodos.length - 3 }, nodos[nodos.length - 2], ultimo] : nodos;
  const nombre = (n) => shortEmployeeName(ficha(n) || { name: '' }) || 'Sin nombre';

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
        {visibles.map((n, i) => (
          <View key={n.plegado ? 'plegado' : `${n.id || 'hueco'}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {i > 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 15, fontWeight: '700' }}>{n.salto ? '·' : '›'}</Text> : null}
            {n.plegado ? (
              <View style={{ paddingHorizontal: 8, height: 30, borderRadius: 15, justifyContent: 'center', backgroundColor: colorSistema.separador }}>
                <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '700' }}>{`+${n.plegado}`}</Text>
              </View>
            ) : n.hueco ? (
              <View accessibilityLabel="nadie recibió la caja"
                style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderStyle: 'dashed', borderColor: MARCA.ambar, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: MARCA.ambar, fontSize: 13, fontWeight: '800' }}>?</Text>
              </View>
            ) : (
              <View style={{ borderRadius: 17, borderWidth: n === ultimo ? 2 : 0, borderColor: `${MARCA.verde}AA`, padding: n === ultimo ? 1 : 0 }}>
                <Avatar empleado={ficha(n)} tamano={30} />
              </View>
            )}
          </View>
        ))}
      </View>
      <Text style={{ color: colorSistema.texto2, fontSize: 14, lineHeight: 19 }}>
        {ultimo.hueco ? (
          <>
            <Text style={{ color: colorSistema.texto, fontWeight: '700' }}>{nombre(nodos[nodos.length - 2])}</Text>
            {' confirmó '}
            <Text style={{ color: MARCA.ambar, fontWeight: '700' }}>sin entregar la caja</Text>
            {ultimo.motivo ? ` · ${ultimo.motivo}` : ''}
          </>
        ) : cuantas > 1 ? (
          <>
            {`La caja pasó por ${cuantas} manos hoy · ahora la tiene `}
            <Text style={{ color: MARCA.verde, fontWeight: '700' }}>{nombre(ultimo)}</Text>
          </>
        ) : (
          <>
            <Text style={{ color: colorSistema.texto, fontWeight: '700' }}>{nombre(primero)}</Text>
            {' le entregó la caja a '}
            <Text style={{ color: MARCA.verde, fontWeight: '700' }}>{nombre(ultimo)}</Text>
          </>
        )}
        {`  ·  ${cuantas > 1 ? 'última entrega' : 'corte'} de las ${hora12(ultimo.hora)}`}
      </Text>
    </View>
  );
}
