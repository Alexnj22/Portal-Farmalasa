// La ficha de un pedido en una sala, NATIVA — lo que el tablero del portal
// muestra al abrir la tarjeta (`TabPedidos`): en qué va, la línea de vida con
// quién hizo cada paso y cuánto tardó, quién apoyó, cómo llegó, las
// diferencias y los productos por laboratorio.
//
// Todo de lectura, con las mismas reglas del portal (núcleo: `pasosDelPedido`,
// `seccionesDeRenglones`, `resumenDeRecepcion`, `renglonesConDiferencia`).
// Confirmar la llegada, contar y la llegada de un reenvío abren pantallas
// nativas; Bodega inicia, pausa, programa o anula desde aquí
// (`AccionesDeBodega`). Decidir una diferencia y finalizar siguen en el portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import {
  fetchApoyoForPedido, fetchEntregasDePedidos, fetchPedidoItemEventosAll, fetchPedidoItemsAll, fetchPedidosEnCurso,
} from '@nucleo/data/pedidos';
import {
  estadoDeLaSala, etapasPorPedido, faltantesDeLaSala, describirFaltantes, renglonesConDiferencia, resumenDeRecepcion, ROTULO_DE_ESTADO, seccionesDeRenglones,
} from '@nucleo/utils/tableroDePedidos';
import { ERP_NAMES } from '@nucleo/constants/erp';
import { fechaTexto } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { signPhotosDeep } from '@nucleo/utils/storageFiles';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande } from '../../componentes/formulario/Piezas';
import { Pasos, Pildora, Panel, Fichas } from '../../componentes/avisos/Piezas';
import Vidrio from '../../componentes/Vidrio';
import Avatar from '../../componentes/Avatar';
import { MARCA } from '../../componentes/inicio/marca';
import LineaDeVida from '../../componentes/pedidos/LineaDeVida';
import Renglones from '../../componentes/pedidos/Renglones';
import Diferencias from '../../componentes/pedidos/Diferencias';
import { idsDelPedido, usePersonas } from '../../componentes/pedidos/personas';
import { ETAPA, etapaDeLaTarjeta, PASOS, pasoDeLaEtapa } from '../../componentes/pedidos/etapa';
import AccionesDeBodega from '../../componentes/pedidos/AccionesDeBodega';

const COLOR_ESTADO = { confirmado: MARCA.azulClaro, enviado: MARCA.violetaClaro, parcial: MARCA.ambar, completado: MARCA.verde, anulado: MARCA.rojo };

function Bloque({ titulo, children }) {
  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={22}>
        <View style={{ padding: 14, gap: 10 }}>
          {titulo ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{titulo}</Text> : null}
          {children}
        </View>
      </Vidrio>
    </View>
  );
}

function Gente({ rotulo, personas }) {
  if (!personas?.length) return null;
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700', letterSpacing: 0.4 }}>{rotulo}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {personas.map((p) => (
          <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Avatar empleado={p} tamano={26} />
            <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{shortEmployeeName(p)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function DetalleDePedido() {
  const { pedidoId, sucId, numero } = useLocalSearchParams();
  const suc = Number(sucId);
  const { hasPermission, getScope } = useAuth();
  const puede = hasPermission('pedidos', 'can_edit');
  const esSala = getScope?.('pedidos') !== 'ALL';
  const [row, setRow] = useState(undefined);
  const [todasLasFilas, setTodasLasFilas] = useState([]);
  const [items, setItems] = useState(null);
  const [eventos, setEventos] = useState([]);
  const [apoyo, setApoyo] = useState({ preparacion: [], recepcion: [] });
  const [entrega, setEntrega] = useState(null);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const [{ data: filas, error: e1 }, renglones, { data: apo }, { data: ents }] = await Promise.all([
      fetchPedidosEnCurso(),
      fetchPedidoItemsAll(pedidoId, suc).catch(() => null),
      fetchApoyoForPedido(pedidoId, suc),
      fetchEntregasDePedidos([pedidoId]),
    ]);
    if (e1) { setError('No se pudo cargar el pedido.'); setRow(null); return; }
    setError(null);
    setTodasLasFilas(filas ?? []);
    setRow((filas ?? []).find((r) => String(r.pedido_id) === String(pedidoId) && Number(r.erp_sucursal_id) === suc) ?? null);
    setItems(renglones ?? []);
    await signPhotosDeep(apo ?? []).catch(() => {});
    const porTipo = { preparacion: [], recepcion: [] };
    (apo ?? []).forEach((a) => {
      const t = a.tipo ?? 'preparacion';
      (porTipo[t] ??= []);
      if (!porTipo[t].some((x) => x.id === a.employee_id)) porTipo[t].push({ id: a.employee_id, ...a.employees, photo: a.employees?.photo_url });
    });
    setApoyo(porTipo);
    setEntrega((ents ?? []).find((x) => Number(x.erp_sucursal_id) === suc) ?? null);
  }, [pedidoId, suc]);
  // Al volver de pausar o programar, la ficha se relee.
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const difs = useMemo(() => renglonesConDiferencia(items), [items]);
  const etapas = useMemo(() => etapasPorPedido(todasLasFilas), [todasLasFilas]);
  useEffect(() => {
    if (!difs.length) return undefined;
    let vivo = true;
    fetchPedidoItemEventosAll(pedidoId, suc).then((ev) => { if (vivo) setEventos(ev ?? []); }).catch(() => {});
    return () => { vivo = false; };
  }, [difs.length, pedidoId, suc]);

  const ids = useMemo(() => [...idsDelPedido(row), ...eventos.map((e) => e.hecho_por), entrega?.entregado_por, entrega?.conductor_id].filter(Boolean),
    [row, eventos, entrega]);
  const quien = usePersonas(ids);

  const titulo = `Pedido #${row?.numero ?? numero ?? ''}`;
  if (row === undefined) return <><Stack.Screen options={{ ...BARRA_NATIVA, title: titulo, headerLargeTitle: false }} /><ActivityIndicator style={{ marginTop: 40 }} /></>;

  const etapa = row ? etapaDeLaTarjeta(row) : null;
  const [rotuloEtapa, colorEtapa] = ETAPA[etapa] ?? [etapa, MARCA.azulClaro];
  const estado = row ? estadoDeLaSala(row) : null;
  const sec = seccionesDeRenglones(items);
  const unidades = sec.enviados.reduce((t, r) => t + (Number(r.cantidad_enviada ?? r.cantidad_asignada) || 0), 0);
  const recepcion = row ? resumenDeRecepcion(row, difs) : null;
  const faltan = row ? faltantesDeLaSala(row) : null;
  const conductor = entrega?.conductor_id ? quien(entrega.conductor_id) ?? { id: entrega.conductor_id, name: entrega.conductor_nombre } : null;
  const ir = (pathname) => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname, params: { pedidoId: String(pedidoId), sucId: String(suc), numero: String(row?.numero ?? '') } }); };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: titulo, headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {!row ? (
          <View style={{ marginHorizontal: 16 }}><Aviso tono="cuidado" texto="Este pedido ya no está en el tablero de esta sala." /></View>
        ) : (
          <>
            <Bloque>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{ERP_NAMES[suc] ?? `Sala ${suc}`}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                    {[row.codigo, row.created_at ? fechaTexto(String(row.created_at).slice(0, 10), { weekday: 'short', day: 'numeric', month: 'short' }) : null].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 5 }}>
                  <Pildora texto={rotuloEtapa} color={colorEtapa} />
                  {estado && estado !== 'confirmado' && estado !== 'enviado' ? <Pildora texto={ROTULO_DE_ESTADO[estado]} color={COLOR_ESTADO[estado]} /> : null}
                </View>
              </View>
              <Pasos pasos={PASOS} actual={pasoDeLaEtapa(etapa)} color={colorEtapa} />
              <Panel datos={[
                row.total_cajas ? { etiqueta: `caja${row.total_cajas === 1 ? '' : 's'}`, valor: String(row.total_cajas) } : null,
                items ? { etiqueta: 'productos enviados', valor: String(sec.enviados.length) } : null,
                items ? { etiqueta: 'unidades', valor: unidades.toLocaleString('es-SV') } : null,
                difs.length ? { etiqueta: `diferencia${difs.length === 1 ? '' : 's'}`, valor: String(difs.length), color: MARCA.ambar } : null,
              ]} />
              {row.notes ? <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{`“${row.notes}”`}</Text> : null}
              {faltan?.hay ? (
                <Aviso tono="cuidado" texto={`No llegó: ${describirFaltantes(faltan).join(', ')}${faltan.enCamino ? ' — ya viene en un reenvío.' : ' — bodega todavía no lo reenvía.'}`} />
              ) : null}
              {puede && etapa === 'transito' ? <BotonGrande texto="Confirmar que llegó" color={MARCA.azul} onPress={() => ir('/pedido/llegada')} /> : null}
              {puede && etapa === 'contando' ? <BotonGrande texto="Contar lo que llegó" color={MARCA.verde} onPress={() => ir('/pedido/recibir')} /> : null}
              {puede && faltan?.enCamino ? <BotonGrande texto="Llegó el reenvío" color={MARCA.azul} borde onPress={() => ir('/pedido/reenvio')} /> : null}
              {puede && !esSala ? <AccionesDeBodega row={row} etapa={etapa} etapas={etapas} onCambio={cargar} /> : null}
            </Bloque>

            <Bloque titulo="Cómo va">
              <LineaDeVida row={row} etapa={etapa} quien={quien} entrega={entrega} conductor={conductor} esSala={esSala} apoyoRecepcion={apoyo.recepcion ?? []} />
              <Gente rotulo="APOYÓ EN LA PREPARACIÓN" personas={apoyo.preparacion} />
            </Bloque>

            {row.llegada_fisica_at || recepcion.reenvios || recepcion.difResueltas || recepcion.difPendientes ? (
              <Bloque titulo="Cómo llegó">
                <Fichas color={recepcion.llegada === 'Recibido sin novedad' ? MARCA.verde : MARCA.ambar} textos={[
                  recepcion.llegada,
                  recepcion.cajasDanadas.length ? `Caja${recepcion.cajasDanadas.length > 1 ? 's' : ''} ${recepcion.cajasDanadas.map((n) => `#${n}`).join(', ')} dañada${recepcion.cajasDanadas.length > 1 ? 's' : ''}` : null,
                  recepcion.reenvios ? `${recepcion.reenvios} reenvío${recepcion.reenvios > 1 ? 's' : ''}` : null,
                  recepcion.difResueltas ? `${recepcion.difResueltas} dif. resuelta${recepcion.difResueltas > 1 ? 's' : ''}` : null,
                  recepcion.difPendientes ? `${recepcion.difPendientes} dif. pendiente${recepcion.difPendientes > 1 ? 's' : ''}` : null,
                ].filter(Boolean)} />
              </Bloque>
            ) : null}

            {difs.length ? (
              <Bloque titulo="Diferencias">
                <Diferencias items={difs} eventos={eventos} quien={quien} />
                {puede && row.diferencias_reportadas_at && !row.confirmado_correccion_at ? (
                  <BotonGrande texto="Resolver en el portal" borde color={MARCA.ambar}
                    onPress={() => router.push({ pathname: '/portal', params: { ruta: '/pedidos', nombre: 'Pedidos' } })} />
                ) : null}
              </Bloque>
            ) : null}

            <Bloque titulo="Productos">
              {items == null ? <ActivityIndicator /> : <Renglones items={items} />}
            </Bloque>
          </>
        )}
      </ScrollView>
    </>
  );
}
