// Reservas, NATIVO — el `WidgetReservas` del portal y su pantalla del menú
// (`ReservasView`) enteros: lo que los clientes apartaron desde la app de
// clientes y lo apartado o encargado en el mostrador. Con alcance «todas»
// (`?todas=1` desde el Inicio, o `reservas` con alcance todas) se ven las de
// toda la red, con la sucursal como filtro.
//
// Se busca por el código que muestra el cliente (R-000123, o el pedido P-XXXXXX
// con su total, si se pagó en línea y los datos para el crédito fiscal). Un
// pedido es UNA tarjeta con todos sus productos, y la lista se parte en «Por
// preparar» y «Listas para retirar» (`reservasDeSala` del núcleo, lo mismo que
// el portal). Cada tarjeta va en cuatro bloques —qué es, de quién, qué lleva
// (dos productos y «+N más») y cuánto— y se toca para ver el detalle entero
// (`reserva/[id]`). Cada una se aparta y avisa, se manda a caja como preventa, se
// prorroga una vez, se retira (`reserva-retirar`: lo pagado se aplica a la
// factura) o se cancela; lo que no llegó entero se resuelve (`reserva-resolver`),
// y una reserva de la app que la sala no tiene se trae de otra sala o de Bodega
// («Traer de otra sala», `reservaPorTraer`): mientras viene, su plazo se detiene.
// A quien no tiene la app se le avisa por WhatsApp con el mensaje del núcleo.
// Las recetas («en revisión») se abren en `reserva-receta`; pasadas las 4 h se
// marcan urgentes. Abajo, los saldos a favor (también los de otra sala, al
// escribir su código), las devoluciones por entregar y los encargos.
//
// Ver sin editar: quien tiene la pantalla de Reservas sólo para mirar (y no la
// tarjeta del Inicio) la ve sin botones que cambien nada, como en el portal.
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  buscarSaldoAFavor, codigoDeReserva, fetchReservasDeSucursal, HORAS_RECETA_URGENTE, devolucionesPorEntregar,
} from '@nucleo/data/reservas';
import {
  accionesDeReservaNucleo, agruparPorPedido, quienRevisaLaReceta, codigoCompleto, conteoDeReservas, listaDePrecioDelGrupo, origenDelSaldo, pilaDelCliente,
  reservasAbiertas, reservasPorCodigo, resumenDelPedido, saldosAFavor, seccionesDeReservas,
} from '@nucleo/utils/reservasDeSala';
import { textoDePreventa } from '@nucleo/utils/preventa';
import { fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, Seccion } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Pestanas from '../componentes/inicio/Pestanas';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { fallo } from '../componentes/Progreso';
import { Accion } from '../componentes/reservas/piezas';
import TarjetaDeReserva from '../componentes/reservas/TarjetaDeReserva';
import { permisosDeReservas, useAccionesDeReserva } from '../componentes/reservas/useAccionesDeReserva';
import Encargos from '../componentes/reservas/Encargos';

const REFRESCO_MS = 2 * 60 * 1000;

// Cuánto lleva esperando una receta, en palabras cortas («25 min», «3 h 10 min»), como el portal.
function esperaDeReceta(desde, ahora) {
  const ms = desde ? Math.max(0, ahora - Date.parse(desde)) : 0;
  const min = Math.floor(ms / 60000);
  const horas = Math.floor(min / 60);
  return { horas: ms / 3600000, texto: horas ? `${horas} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min` };
}

function Cifra({ valor, texto, color }) {
  return (
    <View style={{ flex: 1 }}>
      <Vidrio radio={16}>
        <View style={{ padding: 10, gap: 2 }}>
          <Text style={{ color, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{valor ?? '—'}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={2}>{texto}</Text>
        </View>
      </Vidrio>
    </View>
  );
}

export default function ReservasDeSala() {
  const { todas: todasParam } = useLocalSearchParams();
  const { user, hasPermission, getScope } = useAuth();
  const puedeDevolver = hasPermission('dash_reservas_devolver_saldo');
  // Ver sin editar, revisar recetas y enviar a caja: lo mismo que el detalle (`permisosDeReservas`).
  const permisos = permisosDeReservas(hasPermission);
  const { soloLectura, puedeRecetas } = permisos;
  const todas = todasParam === '1' || getScope?.('reservas') === 'ALL';
  const miSala = user?.branchId ?? user?.branch_id ?? null;
  const branches = useStaffStore((s) => s.branches);
  // Con alcance «todas», la sucursal es un filtro (como la píldora del portal).
  const [salaFija, setSalaFija] = useState('todas');
  const salasDeVenta = (branches || []).filter((b) => b.type === 'FARMACIA')
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'es', { numeric: true }));
  const sala = todas ? (salaFija === 'todas' ? null : Number(salaFija)) : miSala;
  const verTodas = todas && sala == null;
  const nombreSala = (branches || []).find((b) => String(b.id) === String(sala))?.name || '';
  // Bodega no tiene reservas propias, pero ve TODOS los encargos.
  const esBodega = (branches || []).find((b) => String(b.id) === String(sala))?.type === 'BODEGA';
  const salaEncargos = verTodas || esBodega ? null : sala;
  // Se aparta en la caja de la sala propia: con otra sucursal elegida, no.
  const puedeApartar = !soloLectura && miSala != null && !esBodega && (sala == null ? !todas : String(sala) === String(miSala));
  const [ahora, setAhora] = useState(0);
  const [filas, setFilas] = useState(null);
  const [codigo, setCodigo] = useState('');
  const [saldosDeFuera, setSaldosDeFuera] = useState([]);
  const [recargando, setRecargando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  const cargar = useCallback(async () => {
    if (!sala && !verTodas) { setFilas([]); return; }
    try { setFilas(await fetchReservasDeSucursal(sala, true)); setAhora(Date.now()); } catch (e) { fallo('No se pudieron cargar', mensajeAmigable(e, '')); setFilas((f) => f ?? []); }
  }, [sala, verTodas]);
  useEffect(() => { const t = setInterval(cargar, REFRESCO_MS); return () => clearInterval(t); }, [cargar]);
  // Al volver de revisar una receta, de apartar o de retirar, se relee.
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  // Qué se puede hacer con cada tarjeta lo decide el núcleo; el cómo, este hook (el mismo del detalle).
  const { ocupada, ejecutar } = useAccionesDeReserva({ sala, nombreSala, verTodas, recargar: cargar });

  // Un código completo que no es de esta sala puede ser un saldo a favor de
  // otra: el saldo vale en cualquier sucursal, así que se busca en toda la red.
  const completo = codigoCompleto(codigo);
  useEffect(() => {
    let vivo = true;
    if (!completo) { setSaldosDeFuera([]); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- vaciar al borrar el código
    buscarSaldoAFavor(completo)
      .then((f) => { if (vivo) setSaldosDeFuera((f || []).filter((x) => String(x.branch_id) !== String(sala))); })
      .catch(() => { if (vivo) setSaldosDeFuera([]); });
    return () => { vivo = false; };
  }, [completo, sala]);

  const usarSaldo = (r) => router.push({ pathname: '/reserva-saldo', params: { id: String(r.id), codigo: r.pedido ?? codigoDeReserva(r.id) } });
  // El detalle de la tarjeta: todo lo que la tarjeta resume, con todos los productos.
  const abrir = (r) => router.push({ pathname: '/reserva/[id]', params: r.branch_id != null || sala != null
    ? { id: String(r.id), sala: String(r.branch_id ?? sala) } : { id: String(r.id), todas: '1' } });
  const devolucion = (r, modo) => router.push({ pathname: '/reserva-devolucion', params: {
    id: String(r.id), modo, codigo: r.pedido ?? codigoDeReserva(r.id), cliente: pilaDelCliente(r), sala: String(r.branch_id ?? sala),
    monto: String(modo === 'entregar' ? r.saldo_favor_devuelto_monto : r.saldo_favor), motivo: r.devolucion_pedida_motivo ?? '' } });

  const lista = filas || [];
  const abiertas = reservasAbiertas(lista);
  const saldos = [...saldosAFavor(lista), ...saldosDeFuera];
  const porEntregar = devolucionesPorEntregar(lista);
  const buscado = codigo.trim().toUpperCase();
  const visibles = reservasPorCodigo(lista, codigo);
  const pedido = resumenDelPedido(visibles, codigo);
  const anticipoPedido = pedido.renglones.reduce((t, r) => t + Number(r.anticipo ?? 0), 0);
  const grupos = agruparPorPedido(visibles);
  const secciones = buscado ? [{ clave: 'todo', titulo: null, lista: grupos }] : seccionesDeReservas(grupos);
  const conteo = filas ? conteoDeReservas(lista) : null;
  const recetas = abiertas.filter((r) => r.estado === 'en_revision' && r.receta_estado === 'pendiente').length;

  const tarjeta = (r) => {
    const enRevision = r.estado === 'en_revision';
    const espera = enRevision ? esperaDeReceta(r.receta_subida_at, ahora) : null;
    const urgente = enRevision && r.receta_estado === 'pendiente' && espera.horas >= HORAS_RECETA_URGENTE;
    const listaDePrecio = listaDePrecioDelGrupo(r);
    const preventa = textoDePreventa(r);
    const extras = [
      r.entrega === 'domicilio' ? `A domicilio: ${r.direccion_entrega ?? ''}${Number(r.costo_envio) > 0 ? ` (envío ${formatMoney(Number(r.costo_envio))})` : ''}` : '',
      r.avisado_via === 'whatsapp' ? 'Avisado por WhatsApp' : '',
      preventa,
    ].filter(Boolean).join(' · ');
    const quienRevisa = quienRevisaLaReceta(r, { puedeRecetas });
    // Lo que se dice aparte de los cuatro bloques: cada cosa en UNA línea.
    const marcas = (
      <>
        {enRevision && r.receta_estado === 'pendiente' ? <Pildora texto={`Receta por revisar · ${espera.texto}${urgente ? ' · ya se avisó a supervisión' : ''}`} color={urgente ? MARCA.rojo : MARCA.ambar} /> : null}
        {quienRevisa ? <Pildora texto={quienRevisa} color={colorSistema.texto2} /> : null}
        {/* Mayoreo: se cobró a precio de mayoreo en la app; en caja se factura con ESA lista. */}
        {listaDePrecio ? <Pildora texto={listaDePrecio} color={MARCA.azulClaro} /> : null}
        {enRevision && r.receta_estado === 'otra_foto' && r.receta_motivo ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>{`Se pidió otra foto: ${r.receta_motivo}`}</Text> : null}
        {extras ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>{extras}</Text> : null}
      </>
    );
    return (
      <TarjetaDeReserva key={`${r.pedido ?? ''}-${r.id}`} r={r} verTodas={verTodas} marcas={marcas}
        acciones={accionesDeReservaNucleo(r, permisos)} onAccion={(a) => ejecutar(r, a)}
        onAbrir={abrir} ocupada={ocupada === r.id} tinte={urgente ? 'rgba(240,68,56,0.12)' : undefined} />
    );
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Reservas', headerLargeTitle: true,
        headerSearchBarOptions: { placeholder: 'Código R-… o P-…', autoCapitalize: 'characters', hideWhenScrolling: false, onChangeText: (e) => setCodigo(e.nativeEvent.text), onCancelButtonPress: () => setCodigo('') } }} />
      <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 8, paddingBottom: 48, gap: 12 }} keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); setRecarga((n) => n + 1); await cargar(); setRecargando(false); }} />}>
        {todas && salasDeVenta.length ? (
          <Pestanas opciones={[{ id: 'todas', label: 'Todas' }, ...salasDeVenta.map((b) => ({ id: String(b.id), label: b.name }))]} activa={salaFija} onCambiar={setSalaFija} />
        ) : null}
        <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 20 }}>
          {!sala && !verTodas ? 'Las reservas son de una sala de ventas.' : `${verTodas ? 'Todas las salas' : nombreSala}${recetas ? ` · ${recetas} ${recetas === 1 ? 'receta por revisar' : 'recetas por revisar'}` : ''}`}
        </Text>
        {conteo && (sala || verTodas) && !esBodega ? (
          <View style={{ flexDirection: 'row', gap: 8, marginHorizontal: 16 }}>
            <Cifra valor={conteo.preparar} texto="Por preparar" color={MARCA.ambar} />
            <Cifra valor={conteo.listas} texto="Listas para retirar" color={MARCA.verde} />
            <Cifra valor={conteo.saldos} texto="Saldos a favor" color={colorSistema.texto} />
          </View>
        ) : null}
        {puedeApartar ? (
          <View style={{ marginHorizontal: 16, flexDirection: 'row' }}>
            <Accion texto="Reservar con anticipo · apartar o encargar" onPress={() => router.push('/reserva-anticipo')} />
          </View>
        ) : null}
        {pedido.renglones.length ? (
          <Seccion titulo={`Pedido ${pedido.pedido}`} pie={pedido.prueba ? 'PAGO DE PRUEBA — cobrar en caja.' : pedido.pagado ? (pedido.renglones[0].origen === 'sucursal' ? 'Pagado.' : 'Pagado en línea: en caja NO se cobra.')
            : anticipoPedido > 0.004 ? `Anticipo ${formatMoney(anticipoPedido)} · falta ${formatMoney(pedido.total - anticipoPedido)} al retirar.` : 'Se cobra en caja.'}>
            <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{`${pedido.renglones.length} ${pedido.renglones.length === 1 ? 'producto' : 'productos'} · ${pilaDelCliente(pedido.renglones[0])} · total ${formatMoney(pedido.total)}${pedido.renglones.some((r) => r.estado === 'pendiente') && pedido.renglones.some((r) => r.estado === 'lista') ? ' · una parte todavía en camino' : ''}`}</Text>
            {pedido.fiscal ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Facturar con crédito fiscal: ${pedido.fiscal.nombre} · NIT ${pedido.fiscal.nit} · NRC ${pedido.fiscal.nrc} · ${pedido.fiscal.giro} · ${pedido.fiscal.direccion}`}</Text> : null}
          </Seccion>
        ) : null}
        {filas && buscado && !visibles.length && !saldosDeFuera.length ? <View style={{ marginHorizontal: 16 }}><Aviso texto={`No hay una reserva abierta con ese código${verTodas ? '' : ' en esta sala'}.`} /></View> : null}
        {filas && !abiertas.length && !saldos.length && (sala || verTodas) && !esBodega ? <View style={{ marginHorizontal: 16 }}><Aviso texto="Sin reservas. Cuando un cliente aparte algo desde la app, aparece aquí." /></View> : null}

        {secciones.map((s) => (
          <View key={s.clave} style={{ gap: 10 }}>
            {s.titulo ? (
              <View style={{ marginHorizontal: 20 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{`${s.titulo} · ${s.lista.length}`}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{s.ayuda}</Text>
              </View>
            ) : null}
            {s.lista.map(tarjeta)}
          </View>
        ))}

        {saldos.length ? (
          <Seccion titulo={`Saldos a favor · ${saldos.length}`} pie="Se usan en cualquier sucursal y se descuentan en caja.">
            {saldos.map((r, i) => {
              const deOtra = verTodas || String(r.branch_id) !== String(sala);
              return (
                <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: i ? 9 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: ocupada === r.id ? 0.5 : 1 }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>
                      {r.confirmado === false ? 'Saldo a favor · confirma al cliente para verlo' : `${formatMoney(Number(r.saldo_favor))} a favor de ${pilaDelCliente(r)}`}
                    </Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                      {r.confirmado === false
                        ? `${r.pedido ?? codigoDeReserva(r.id)} · vale hasta el ${fechaTexto(r.saldo_favor_vence, { day: 'numeric', month: 'short' })}${r.sala ? ` · ${r.sala}` : ''}`
                        : `${r.pedido ?? codigoDeReserva(r.id)} · ${r.producto} · ${origenDelSaldo(r)}${Number(r.saldo_favor_inicial) > Number(r.saldo_favor) ? ` · de ${formatMoney(Number(r.saldo_favor_inicial))}` : ''}${r.saldo_favor_vence ? ` · vale hasta el ${fechaTexto(r.saldo_favor_vence, { day: 'numeric', month: 'short' })}` : ''}${deOtra && r.sala ? ` · ${r.sala}` : ''}`}
                    </Text>
                  </View>
                  {soloLectura ? null : (
                    <View style={{ gap: 6, alignItems: 'flex-end' }}>
                      <Accion texto="Usar en caja" color={MARCA.verde} onPress={() => usarSaldo(r)} deshabilitado={!!ocupada} />
                      {r.devolucion_pedida_at ? (puedeDevolver ? (
                        <>
                          <Accion texto="Autorizar efectivo" onPress={() => devolucion(r, 'autorizar')} />
                          <Accion texto="No autorizar" color={MARCA.rojo} onPress={() => devolucion(r, 'negar')} />
                        </>
                      ) : <Pildora texto="Efectivo pedido" color={MARCA.ambar} />)
                        : puedeDevolver && r.confirmado !== false ? <Accion texto="Devolver en dinero" onPress={() => devolucion(r, 'autorizar')} />
                          : !deOtra && r.confirmado !== false ? <Accion texto="Pedir en efectivo" onPress={() => devolucion(r, 'pedir')} /> : null}
                    </View>
                  )}
                </View>
              );
            })}
          </Seccion>
        ) : null}
        {porEntregar.length && !buscado ? (
          <Seccion titulo={`Devoluciones por entregar · ${porEntregar.length}`} pie="Autorizadas: se entregan en efectivo y salen de la caja como vale «Devolución a un cliente».">
            {porEntregar.map((r, i) => (
              <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: i ? 9 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{`${formatMoney(Number(r.saldo_favor_devuelto_monto))} para ${pilaDelCliente(r)}`}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${r.pedido ?? codigoDeReserva(r.id)}${r.devolucion_pedida_motivo ? ` · ${r.devolucion_pedida_motivo}` : ''}`}</Text>
                </View>
                {!soloLectura && !verTodas ? <Accion texto="Entregar" color={MARCA.rojo} onPress={() => devolucion(r, 'entregar')} /> : null}
              </View>
            ))}
          </Seccion>
        ) : null}
        {(sala || verTodas) ? <Encargos branchId={salaEncargos} soloLectura={soloLectura} recarga={recarga} /> : null}
      </ScrollView>
    </>
  );
}
