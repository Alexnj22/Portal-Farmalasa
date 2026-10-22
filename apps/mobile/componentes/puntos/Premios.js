// Puntos → Premios, NATIVO — `PremiosDelPrograma` del portal (2026-10-19).
// Los premios del raspable que NO son puntos: un PRODUCTO del inventario o un
// regalo PROMOCIONAL.
//
//   · Por entregar — la sala busca el premio (código, cliente o DUI, en la
//     barra de búsqueda) y lo entrega aquí (`entregarPremioPorCodigo`, el mismo
//     camino que escanearlo en Consulta). Administración elige la sucursal.
//   · Regalos promocionales — lo pedido por clientes, lo que viene en camino
//     (la sala de destino confirma «Recibido») y, para administración, el
//     catálogo con sus existencias por sala: entrada o ajuste, enviar y editar
//     (`app/puntos-regalo`).
//
// Quién puede qué lo decide la base: administrar es de quien edita los
// niveles; entregar y recibir, de la sala propia.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchPremiosPorEntregar, fetchPromocionales, recibirPromocional } from '@nucleo/data/puntos';
import { ESTADO_DE_PREMIO, detalleDelPremio, dondeSeRetiraElPremio } from '@nucleo/utils/nivelesDePuntos';
import { leerCodigoDePremio } from '@nucleo/utils/codigoDePremio';
import { fechaTexto } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Interruptor from '../Interruptor';
import Vidrio from '../Vidrio';
import SelectorDeSala from '../inicio/SelectorDeSala';
import { MARCA } from '../inicio/marca';
import { fallo, listo, trabajando } from '../Progreso';
import { guardar as dejar } from '../comercial/elegido';
import { entregarPremioPorCodigo } from './entregarPremio';

const COLOR = { info: MARCA.azulClaro, warning: MARCA.ambar, success: MARCA.verde, neutral: '#8E8E93' };
const fechaCorta = (f) => fechaTexto(f, { day: 'numeric', month: 'short' }, '—');

const Titulo = ({ children }) => (
  <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginHorizontal: 32, marginTop: 6 }}>{children}</Text>
);

function Boton({ texto, onPress, color = MARCA.azulClaro }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} accessibilityRole="button" hitSlop={4}
      style={({ pressed }) => ({ minHeight: 36, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center', backgroundColor: `${color}26`, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <Text style={{ color, fontSize: 14, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

function PorEntregar({ busqueda, puedeAdministrar, miSala, nombreSala, salas }) {
  // La sala ve la suya y nada más; administración elige (vacío = todas).
  const [sala, setSala] = useState(puedeAdministrar ? '' : miSala);
  const [entregados, setEntregados] = useState(false);
  const [premios, setPremios] = useState(null);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  // El lector teclea el código sin guion (PS000123): se busca en la forma de la base.
  const buscar = leerCodigoDePremio(busqueda) ?? busqueda;
  const salaQueEntrega = sala !== '' && sala != null ? Number(sala) : miSala;

  useEffect(() => {
    if (!puedeAdministrar && !miSala) return undefined;
    let vivo = true;
    Promise.resolve(fetchPremiosPorEntregar(sala === '' ? null : Number(sala), buscar, entregados))
      .then((r) => { if (vivo) { setPremios(r ?? []); setError(null); } })
      .catch((e) => { if (vivo) { setPremios([]); setError(mensajeAmigable(e)); } });
    return () => { vivo = false; };
  }, [sala, buscar, entregados, version, puedeAdministrar, miSala]);

  if (!puedeAdministrar && !miSala) return <View style={{ marginHorizontal: 16 }}><Aviso tono="cuidado" texto="Tu ficha no tiene sucursal: no hay premios que entregar desde aquí." /></View>;

  return (
    <>
      <Titulo>Premios por entregar</Titulo>
      {puedeAdministrar ? <View style={{ marginHorizontal: 16 }}><SelectorDeSala salas={salas} activa={sala} onCambiar={setSala} todas /></View> : null}
      <View style={{ marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>Ver entregados</Text>
        <Interruptor value={entregados} onValueChange={setEntregados} accessibilityLabel="Ver entregados" />
      </View>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {premios == null ? <ActivityIndicator style={{ marginTop: 12 }} /> : !premios.length ? (
        <Text style={{ color: colorSistema.texto2, fontSize: 15, textAlign: 'center', marginTop: 12 }}>{buscar ? 'Ningún premio coincide.' : 'No hay premios por entregar.'}</Text>
      ) : premios.map((p) => {
        const e = ESTADO_DE_PREMIO[p.estado] ?? ESTADO_DE_PREMIO.POR_RETIRAR;
        return (
          <View key={p.id} style={{ marginHorizontal: 16 }}>
            <Vidrio radio={18}>
              <View style={{ padding: 12, gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>
                    {`${Number(p.cantidad) > 1 ? `${p.cantidad} × ` : ''}${p.nombre}`}
                  </Text>
                  <Pildora texto={e.texto} color={COLOR[e.variante] ?? COLOR.neutral} />
                </View>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{detalleDelPremio(p)}</Text>
                <Text style={{ color: colorSistema.texto, fontSize: 13 }} numberOfLines={1}>{`${p.cliente?.nombre ?? '—'}${p.cliente?.documento ? ` · ${p.cliente.documento}` : ''}`}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${dondeSeRetiraElPremio(p, nombreSala)} · vence ${fechaCorta(p.vence_el)}`}</Text>
                {p.estado === 'POR_RETIRAR' && salaQueEntrega ? (
                  <View style={{ flexDirection: 'row', marginTop: 4 }}>
                    <Boton texto="Entregar aquí" color={MARCA.azul}
                      onPress={() => entregarPremioPorCodigo({ codigo: p.codigo, sala: salaQueEntrega, nombreSala, alTerminar: () => setVersion((v) => v + 1) })} />
                  </View>
                ) : null}
              </View>
            </Vidrio>
          </View>
        );
      })}
    </>
  );
}

function Regalos({ puedeAdministrar, miSala, nombreSala }) {
  const [panel, setPanel] = useState(null);
  const cargar = useCallback(() => {
    Promise.resolve(fetchPromocionales()).then(setPanel)
      .catch((e) => { setPanel({ promocionales: [], envios: [] }); fallo('No se pudieron cargar los regalos', mensajeAmigable(e)); });
  }, []);
  // Se relee al volver del diálogo de un regalo.
  useFocusEffect(cargar);

  const abrir = (modo, promo, extra = {}) => {
    Haptics.selectionAsync().catch(() => {});
    dejar('puntos-regalo', { modo, promo, ...extra });
    router.push({ pathname: '/puntos-regalo', params: { modo } });
  };
  const recibir = (v) => Alert.alert('¿Llegó el envío?', `${v.cantidad} × ${v.nombre}, de ${nombreSala(v.desde)}. Se suma al inventario de regalos de ${nombreSala(v.hacia)}.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Recibido', onPress: async () => {
      trabajando('Guardando…');
      try { await recibirPromocional(v.id); listo('Envío recibido', `${v.cantidad} × ${v.nombre}`); cargar(); }
      catch (e) { fallo('No se pudo recibir', mensajeAmigable(e)); }
    } },
  ]);

  if (!panel) return null;
  // La sala ve lo que viene hacia ella; administración, todo lo que está en camino.
  const envios = (panel.envios ?? []).filter((v) => puedeAdministrar || Number(v.hacia) === Number(miSala));
  const promos = panel.promocionales ?? [];
  if (!puedeAdministrar && !envios.length) return null;

  return (
    <>
      <Titulo>Regalos promocionales</Titulo>
      {puedeAdministrar ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Nuevo regalo" borde onPress={() => abrir('nuevo', null)} /></View> : null}

      {puedeAdministrar && (panel.pedidos ?? []).length ? (
        <>
          <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '700', marginHorizontal: 32 }}>Pedidos por clientes</Text>
          {(panel.pedidos ?? []).map((x) => (
            <View key={`${x.promocional_id}-${x.hacia}`} style={{ marginHorizontal: 16 }}>
              <Vidrio radio={18}>
                <View style={{ padding: 12, gap: 6 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15 }}>
                    <Text style={{ fontWeight: '700' }}>{`${x.cantidad} × ${x.nombre}`}</Text>
                    {` para ${nombreSala(x.hacia)} · ${x.premios === 1 ? '1 cliente esperando' : `${x.premios} clientes esperando`}`}
                  </Text>
                  <View style={{ flexDirection: 'row' }}>
                    <Boton texto="Enviar" onPress={() => abrir('enviar', promos.find((p) => Number(p.id) === Number(x.promocional_id)) ?? null, { hacia: x.hacia, cantidad: x.cantidad })} />
                  </View>
                </View>
              </Vidrio>
            </View>
          ))}
        </>
      ) : null}

      {envios.length ? (
        <>
          <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '700', marginHorizontal: 32 }}>En camino</Text>
          {envios.map((v) => (
            <View key={v.id} style={{ marginHorizontal: 16 }}>
              <Vidrio radio={18}>
                <View style={{ padding: 12, gap: 6 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15 }}>
                    <Text style={{ fontWeight: '700' }}>{`${v.cantidad} × ${v.nombre}`}</Text>
                    {` · de ${nombreSala(v.desde)} a ${nombreSala(v.hacia)} · ${fechaCorta(v.enviado_at)}`}
                  </Text>
                  {puedeAdministrar || Number(v.hacia) === Number(miSala) ? (
                    <View style={{ flexDirection: 'row' }}><Boton texto="Recibido" color={MARCA.verde} onPress={() => recibir(v)} /></View>
                  ) : null}
                </View>
              </Vidrio>
            </View>
          ))}
        </>
      ) : null}

      {puedeAdministrar ? (promos.length ? promos.map((x) => {
        const exist = Object.entries(x.existencias ?? {});
        return (
          <View key={x.id} style={{ marginHorizontal: 16 }}>
            <Vidrio radio={18}>
              <View style={{ padding: 12, gap: 5 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{x.nombre}</Text>
                  {!x.activo ? <Pildora texto="Apagado" color={COLOR.neutral} /> : null}
                </View>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  {`${x.costo != null ? `Cuesta ${formatMoney(Number(x.costo))}` : 'Sin costo anotado'}${Number(x.en_camino) > 0 ? ` · ${x.en_camino} en camino` : ''}`}
                </Text>
                <Text style={{ color: colorSistema.texto, fontSize: 13 }}>{exist.length ? exist.map(([b, n]) => `${nombreSala(b)} ${n}`).join(' · ') : 'Sin existencias'}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  <Boton texto="Entrada o ajuste" onPress={() => abrir('entrada', x)} />
                  <Boton texto="Enviar" onPress={() => abrir('enviar', x)} />
                  <Boton texto="Editar" onPress={() => abrir('editar', x)} />
                </View>
              </View>
            </Vidrio>
          </View>
        );
      }) : <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 32 }}>Todavía no hay regalos. Crea uno para poder ponerlo en el raspable.</Text>) : null}
    </>
  );
}

export default function Premios({ busqueda, puedeAdministrar }) {
  const { user } = useAuth();
  const miSala = user?.branchId ?? user?.branch_id ?? null;
  const sucursales = useStaffStore((s) => s.branches);
  const salas = useMemo(() => (sucursales || []).map((b) => ({ id: b.id, label: b.name })), [sucursales]);
  const nombreSala = useCallback((id) => (sucursales || []).find((b) => Number(b.id) === Number(id))?.name ?? '—', [sucursales]);
  return (
    <>
      <PorEntregar busqueda={busqueda} puedeAdministrar={puedeAdministrar} miSala={miSala} nombreSala={nombreSala} salas={salas} />
      <Regalos puedeAdministrar={puedeAdministrar} miSala={miSala} nombreSala={nombreSala} />
    </>
  );
}
