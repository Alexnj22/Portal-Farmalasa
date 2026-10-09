// Reservas de mi sala — el `WidgetReservas` del tablero del portal, nativo:
// lo que los clientes apartaron desde la app de clientes en ESTA sala (o en
// todas, con alcance todas). Cuántas esperan que alguien las aparte y las
// primeras de la lista; tocar abre `reservas-sala`, donde se apartan y avisan,
// se marcan retiradas o se cancelan. Las cuentas salen del núcleo
// (`reservasDeSala`), las mismas del portal.
import { Text } from 'react-native';
import { router } from 'expo-router';
import { codigoDeReserva, fetchReservasDeSucursal } from '@nucleo/data/reservas';
import { pilaDelCliente, reservasPendientes } from '@nucleo/utils/reservasDeSala';
import Widget, { Esqueleto, Renglon, Vacio } from '../Widget';
import { useDato } from '../useDato';
import { colorSistema } from '../../Formulario';
import { MARCA } from '../marca';

const PRIMERAS = 4;

export function Reservas({ ctx }) {
  const todas = ctx.getScope?.('dash_reservas') === 'ALL';
  const sala = todas ? null : ctx.sala;
  const { dato, cargando } = useDato(`reservas:${sala ?? 'todas'}`, async () => ((sala || todas) ? fetchReservasDeSucursal(sala, true) : []));
  const filas = dato || [];
  const pendientes = reservasPendientes(filas);
  const abrir = () => router.push({ pathname: '/reservas-sala', params: todas ? { todas: '1' } : {} });
  return (
    <Widget titulo="Reservas de mi sala" icono="ShoppingBag" color={MARCA.ambar} cuenta={pendientes || null} onAbrir={abrir}>
      {cargando && !dato ? <Esqueleto lineas={2} /> : !sala && !todas ? <Vacio texto="Las reservas son de una sala de ventas." /> : !filas.length ? <Vacio texto="Sin reservas" bien /> : (
        <>
          {pendientes ? <Text style={{ color: colorSistema.texto2, fontSize: 13, marginBottom: 2 }}>{`${pendientes} ${pendientes === 1 ? 'reserva espera' : 'reservas esperan'} que alguien las aparte`}</Text> : null}
          {filas.slice(0, PRIMERAS).map((r, i) => (
            <Renglon key={r.id} primero={i === 0} onPress={abrir}
              titulo={`${r.cantidad} × ${r.producto}`}
              detalle={`${todas && r.sala ? `${r.sala} · ` : ''}${codigoDeReserva(r.id)} · ${pilaDelCliente(r)}`}
              derecha={r.estado === 'pendiente' ? 'Por apartar' : 'Lista'} colorDerecha={r.estado === 'pendiente' ? MARCA.ambar : MARCA.verde} />
          ))}
          {filas.length > PRIMERAS ? <Text style={{ color: colorSistema.texto2, fontSize: 13, marginTop: 4 }}>{`y ${filas.length - PRIMERAS} más`}</Text> : null}
        </>
      )}
    </Widget>
  );
}
