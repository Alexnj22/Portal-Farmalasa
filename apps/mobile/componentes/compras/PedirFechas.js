// Pedir las fechas de vencimiento a la sucursal que recibió la mercadería,
// NATIVO — el `PedirFechas` de la compra armada del portal. La sucursal
// contesta desde Traslados y las fechas llenan solas los productos vacíos.
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { cancelarPedidoDeVence, fetchPedidosDeVence, pedirVencesASala } from '@nucleo/data/cargarCompra';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import Avatar from '../Avatar';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';
import { Aviso, Ficha } from '../formulario/Piezas';
import { MARCA } from '../inicio/marca';
import { Accion } from './carga';

function Caja({ children }) {
  return <Vidrio radio={20}><View style={{ padding: 14, gap: 6 }}>{children}</View></Vidrio>;
}
function Quien({ id, nombre }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Avatar empleado={{ id, name: nombre }} tamano={20} />
      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{shortEmployeeName(nombre ?? '')}</Text>
    </View>
  );
}

export default function PedirFechas({ documentId, sinFecha, salas, puedeEditar, onFechas }) {
  const [pedidos, setPedidos] = useState(null);
  const [sala, setSala] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const cargar = useCallback(async () => {
    const { pedidos: p, error: e } = await fetchPedidosDeVence();
    if (e) setError(e);
    setPedidos(p.filter((x) => x.document_id === documentId && x.estado !== 'cancelado'));
  }, [documentId]);
  useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial
  const vivo = (pedidos ?? []).find((x) => x.estado === 'pendiente');
  const contestado = (pedidos ?? []).find((x) => x.estado === 'respondido');
  useEffect(() => { if (contestado?.respuestas) onFechas(contestado.respuestas); }, [contestado, onFechas]);

  const pedir = async () => {
    setOcupado(true); setError('');
    const { error: e } = await pedirVencesASala(documentId, sala, sinFecha);
    setOcupado(false);
    if (e) { setError(e); return; }
    cargar();
  };
  const cancelar = async () => {
    setOcupado(true); setError('');
    const { error: e } = await cancelarPedidoDeVence(vivo.id);
    setOcupado(false);
    if (e) setError(e);
    cargar();
  };

  if (!pedidos) return null;
  if (vivo) {
    return (
      <Caja>
        <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{`Fechas pedidas a ${vivo.sala} (${(vivo.renglones ?? []).length} productos), esperando respuesta. Cuando conteste, se llenan solas.`}</Text>
        <Quien id={vivo.pedido_por} nombre={vivo.pedido_nombre} />
        {puedeEditar ? <Accion texto="Cancelar pedido" color={colorSistema.texto2} ocupado={ocupado} onPress={cancelar} /> : null}
        {error ? <Aviso tono="freno" texto={error} /> : null}
      </Caja>
    );
  }
  return (
    <>
      {contestado ? (
        <Caja>
          <Text style={{ color: MARCA.verde, fontSize: 14, fontWeight: '700' }}>{`${contestado.sala} contestó las fechas y ya están puestas en los productos.`}</Text>
          <Quien id={contestado.respondido_por} nombre={contestado.respondido_nombre} />
        </Caja>
      ) : null}
      {sinFecha.length > 0 && puedeEditar ? (
        <Caja>
          <Text style={{ color: MARCA.ambar, fontSize: 14, fontWeight: '700' }}>{`${sinFecha.length === 1 ? 'Un producto no trae' : `${sinFecha.length} productos no traen`} fecha de vencimiento.`}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Si la mercadería llegó a una sucursal, pídele las fechas. ¿Qué sucursal la recibió?</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {salas.map((b) => <Ficha key={b.id} texto={b.name} activa={sala === String(b.id)} onPress={() => setSala(String(b.id))} />)}
          </View>
          <Accion texto="Pedir fechas" ocupado={ocupado} deshabilitado={!sala} onPress={pedir} />
          {error ? <Aviso tono="freno" texto={error} /> : null}
        </Caja>
      ) : null}
    </>
  );
}
