// Consultas de existencia, NATIVO — la pestaña del portal
// (`inventario/TabConsultasExistencia`, en Conteo de inventario):
//
//   · «Te toca contar»: lo que le preguntaron a la sucursal de quien abre;
//     tocarlo abre `consulta-existencia/[id]` (conteo ciego, con reconteo).
//   · «Consultas»: una tarjeta por producto con el resultado sucursal por
//     sucursal (contó · la existencia decía · la diferencia), quién la pidió y
//     lo que corrigió la revisión de factor.
//   · Un descuadre confirmado (no cuadró dos veces) lo ajusta SÓLO quien
//     aprueba inventario: «Ajustar» crea la carga o el descarte y la aplica
//     (`pedirAjusteDeConsulta` + `aplicarMovimientoInventarioEnErp`), o «Sin
//     ajuste» con su porqué. Si la existencia cambió desde el conteo, ofrece
//     pedir otro conteo, igual que el portal.
//
// «Pedir conteo» (con `conteo_inventario` · editar) abre `consulta-existencia/nueva`.
// Las reglas y los textos de la base salen del núcleo (`consultasExistencia`).
import { useCallback, useMemo, useState } from 'react';
import { ActionSheetIOS, Alert, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaNumerica, venceDelMes } from '@nucleo/utils/fecha';
import { formatQty } from '@nucleo/utils/formatNumber';
import { supervisorQueResuelve } from '@nucleo/utils/aprobadorOperativo';
import { aplicarMovimientoInventarioEnErp } from '@nucleo/data/requests';
import {
  agruparPorProducto, ajusteNecesitaVence, crearConsultaExistencia, efectoDeCorreccion, enPresentaciones,
  fetchAjusteDeConsulta, fetchConsultasExistencia, pedirAjusteDeConsulta, resolverConsulta, textoDeDiferencia,
} from '@nucleo/data/consultasExistencia';
import Refrescar from '../componentes/Refrescar';
import Tocable, { Presionable as Pressable } from '../componentes/Tocable';
import Avatar from '../componentes/Avatar';
import { MenuDeFiltros } from '../componentes/Filtros';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, Cargando, PantallaSinDato, Seccion, Vacio } from '../componentes/formulario/Piezas';
import { ErrorConReintento } from '../componentes/ListaPaginada';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { cerrarProgreso, fallo, listo, trabajando } from '../componentes/Progreso';

const ESTADO = {
  PENDIENTE: { texto: 'Por contar', get color() { return colorSistema.texto2; } },
  RECONTAR: { texto: 'Recontando', color: MARCA.ambar },
  CUADRA: { texto: 'Cuadra', color: MARCA.verde },
  DESCUADRE: { texto: 'Descuadre', color: MARCA.rojo },
  AJUSTADA: { texto: 'Ajustada', color: MARCA.verde },
  SIN_AJUSTE: { texto: 'Sin ajuste', get color() { return colorSistema.texto2; } },
};
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const unidades = (n) => `${formatQty(Math.abs(n))} ${Math.abs(n) === 1 ? 'unidad' : 'unidades'}`;

/** Año y después mes, en dos hojas: «AAAA-MM» (para la carga de un perecedero sin fecha). */
function pedirMes(titulo, alElegir) {
  const hoy = new Date().getFullYear();
  const anios = Array.from({ length: 9 }, (_, i) => String(hoy - 2 + i));
  ActionSheetIOS.showActionSheetWithOptions({ title: titulo, options: [...anios, 'Cancelar'], cancelButtonIndex: anios.length }, (i) => {
    if (i >= anios.length) return;
    ActionSheetIOS.showActionSheetWithOptions({ title: `Mes de ${anios[i]}`, options: [...MESES, 'Cancelar'], cancelButtonIndex: 12 }, (m) => {
      if (m < 12) alElegir(`${anios[i]}-${String(m + 1).padStart(2, '0')}`);
    });
  });
}

function FilaDeSala({ s, primero, puedeAjustar, ocupado, onAjustar, onSinAjuste }) {
  const corr = efectoDeCorreccion(s);
  const est = corr?.tipo === 'cubierta' ? { texto: 'Corregida', color: MARCA.verde }
    : corr?.tipo === 'parcial' ? { texto: 'Corregida en parte', color: MARCA.ambar }
      : (ESTADO[s.estado] ?? ESTADO.PENDIENTE);
  const pendienteDeAjuste = s.estado === 'DESCUADRE' && corr?.tipo !== 'cubierta';
  return (
    <View style={{ gap: 4, paddingTop: primero ? 0 : 9, borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{s.sala}</Text>
        <Pildora texto={est.texto} color={est.color} />
      </View>
      {s.final ? (
        <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>
          {`Contó ${enPresentaciones(s.contado_texto, s.final.contado)} · la existencia decía ${enPresentaciones(s.sistema_texto, s.final.sistema)}`
            + `${s.diferencia ? ` · ${textoDeDiferencia(s)}` : ''}${s.recontada ? ' · contado dos veces' : ''}`}
        </Text>
      ) : null}
      {corr ? (
        <Text style={{ color: corr.tipo === 'parcial' ? MARCA.ambar : MARCA.verde, fontSize: 13, fontWeight: '600' }}>
          {corr.tipo === 'cubierta' ? `Se corrigió por el cambio de presentación el ${fechaNumerica(corr.at)}.`
            : corr.tipo === 'parcial' ? `El cambio de presentación corrigió ${unidades(corr.unidades)}. ${corr.resto > 0 ? 'Sobran' : 'Faltan'} ${unidades(corr.resto)} por ajustar.`
              : `Ya se corrigió por el cambio de presentación el ${fechaNumerica(corr.at)}. El conteo lo confirma.`}
        </Text>
      ) : null}
      {s.nota ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{s.nota}</Text> : null}
      {pendienteDeAjuste && puedeAjustar ? (
        <View style={{ flexDirection: 'row', gap: 20, justifyContent: 'flex-end' }}>
          <Tocable onPress={onSinAjuste} disabled={ocupado} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 15, fontWeight: '600' }}>Sin ajuste</Text>
          </Tocable>
          <Tocable onPress={onAjustar} disabled={ocupado} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ color: colorSistema.acento, fontSize: 15, fontWeight: '700' }}>Ajustar</Text>
          </Tocable>
        </View>
      ) : null}
    </View>
  );
}

export default function ConsultasExistencia() {
  const { user, hasPermission } = useAuth();
  const employees = useStaffStore((s) => s.employees);
  const puedeVer = hasPermission('conteo_inventario');
  const puedePedir = hasPermission('conteo_inventario', 'can_edit');
  const puedeAjustar = hasPermission('requests_inventario', 'can_approve');
  const [consultas, setConsultas] = useState(null);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error: e } = await fetchConsultasExistencia();
    setError(e ? mensajeAmigable(e) : null);
    setConsultas(data);
  }, []);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  // Una tarjeta por producto con sus sucursales adentro; por sucursal vale el último conteo.
  const grupos = useMemo(() => agruparPorProducto(consultas), [consultas]);
  const porContar = useMemo(() => grupos
    .map((g) => {
      const salas = g.salas.filter((s) => s.puedo_contar);
      return { ...g, salas, motivo: salas[0]?.consulta?.motivo ?? g.primera.motivo };
    })
    .filter((g) => g.salas.length > 0), [grupos]);
  const empleado = useCallback((id) => (employees ?? []).find((e) => e.id === id), [employees]);

  const contar = (s) => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/consulta-existencia/[id]', params: { id: String(s.id) } }); };

  const ajustar = async (consulta, sala, datos, vence = null) => {
    setOcupado(true);
    trabajando('Ajustando…');
    try {
      const { ids, error: e } = await pedirAjusteDeConsulta({
        consulta, sala, ajuste: datos, usuarioId: user?.id, aprobador: supervisorQueResuelve(employees), vence: venceDelMes(vence),
      });
      if (e) throw e;
      const fallos = [];
      for (const id of ids) {
        const r = await aplicarMovimientoInventarioEnErp(id, 'Ajuste por consulta de existencia');
        if (!r?.ok) fallos.push(r?.error ?? 'sin respuesta');
      }
      const { error: e2 } = await resolverConsulta(sala.id, { estado: 'AJUSTADA', solicitudes: ids });
      if (e2) throw e2;
      if (fallos.length) fallo('Ajuste pedido', `Todavía no se aplicó: ${fallos[0]}. Queda en Solicitudes para intentar de nuevo.`);
      else listo('Existencia ajustada', `${consulta.nombre} en ${sala.sala}: ${textoDeDiferencia(sala)}, ya corregido.`);
      await cargar();
    } catch (e) {
      fallo('No se ajustó', mensajeAmigable(e));
    } finally {
      setOcupado(false);
    }
  };

  // La existencia cambió desde el conteo: se descarta este resultado y se pide otro conteo.
  const recontar = async (consulta, sala) => {
    setOcupado(true);
    trabajando('Pidiendo otro conteo…');
    const { error: e } = await resolverConsulta(sala.id, { estado: 'SIN_AJUSTE', nota: 'La existencia cambió después del conteo. Se pidió contar de nuevo.' });
    const r = e ? { error: e } : await crearConsultaExistencia({
      producto: consulta.erp_product_id, salas: [sala.erp_sucursal_id],
      motivo: 'La existencia cambió después del conteo anterior', origen: consulta.origen,
    });
    setOcupado(false);
    if (r.error) { fallo('No se pidió', mensajeAmigable(r.error)); return; }
    listo('Conteo pedido', `${sala.sala} recibió el aviso para volver a contar.`);
    await cargar();
  };

  const abrirAjuste = async (consulta, sala) => {
    setOcupado(true);
    trabajando('Calculando el ajuste…');
    const { data, error: e } = await fetchAjusteDeConsulta(sala.id);
    setOcupado(false);
    if (e) { fallo('No se pudo calcular', mensajeAmigable(e)); return; }
    cerrarProgreso();
    if (data?.cambio) {
      Alert.alert('La existencia cambió',
        `Desde que ${sala.sala} contó, la existencia de ${consulta.nombre} cambió por una venta o una entrada. Si se ajusta con ese conteo, se descuadra. ¿Pedimos que cuenten de nuevo?`,
        [{ text: 'Cancelar', style: 'cancel' }, { text: 'Pedir otro conteo', onPress: () => recontar(consulta, sala) }]);
      return;
    }
    if (!data?.exacto) {
      Alert.alert('No se puede ajustar exacto', `No se puede ajustar ${consulta.nombre} en sus presentaciones activas. Hazlo desde Solicitudes de inventario.`);
      return;
    }
    const texto = `${consulta.nombre}: la sucursal contó ${formatQty(data.contado)} unidades y el sistema dice ${formatQty(data.sistema)}. Se `
      + (data.lineas ?? []).map((l) => `${l.sentido === 'carga' ? 'cargan' : 'descartan'} ${formatQty(l.cantidad)} ${String(l.tipo).toLowerCase()}${l.lote ? ` del lote ${l.lote}` : ''}`).join(' y se ')
      + '.';
    const confirmar = (vence) => Alert.alert(`Ajustar ${sala.sala}`, vence ? `${texto}\n\nVence: ${vence.slice(5, 7)}/${vence.slice(0, 4)}.` : texto, [
      { text: 'Cancelar', style: 'cancel' }, { text: 'Ajustar', onPress: () => ajustar(consulta, sala, data, vence) },
    ]);
    // Una carga de un perecedero sin fecha la rechaza la caja: se pide antes.
    if (ajusteNecesitaVence(data)) pedirMes('Vence (mes y año) de lo que se carga', confirmar);
    else confirmar(null);
  };

  const sinAjuste = (consulta, sala) => Alert.prompt('Cerrar sin ajustar', `${consulta.nombre} en ${sala.sala}: ¿por qué no se ajusta?`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Cerrar', onPress: async (nota) => {
      if (!String(nota ?? '').trim()) { fallo('Falta el motivo', 'Escribe por qué no se ajusta.'); return; }
      setOcupado(true);
      const { error: e } = await resolverConsulta(sala.id, { estado: 'SIN_AJUSTE', nota: String(nota).trim() });
      setOcupado(false);
      if (e) { fallo('No se cerró', mensajeAmigable(e)); return; }
      listo('Cerrada sin ajuste', `${consulta.nombre} en ${sala.sala}.`);
      await cargar();
    } },
  ], 'plain-text', '');

  if (!puedeVer) return <PantallaSinDato titulo="Consultas de existencia" texto="Tu cargo no puede ver los conteos." />;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Consultas de existencia', headerLargeTitle: false }} />
      <MenuDeFiltros grupos={[]} extra={puedePedir ? { icono: 'plus', etiqueta: 'Pedir conteo', onPress: () => { Haptics.selectionAsync().catch(() => {}); router.push('/consulta-existencia/nueva'); } } : null} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<Refrescar refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Aviso texto="Pregunta a una o varias sucursales cuánto tienen de un producto. Cuentan sin ver el sistema. Si no cuadra, vuelven a contar una vez. Si sigue sin cuadrar, lo ajusta quien aprueba inventario." />

        {porContar.length ? (
          <Seccion titulo={`Te toca contar · ${formatQty(porContar.length)}`}>
            {porContar.map((g, gi) => (
              <View key={g.erp_product_id} style={{ gap: 4, paddingTop: gi ? 9 : 0, borderTopWidth: gi ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{g.nombre}</Text>
                {g.motivo ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{g.motivo}</Text> : null}
                {g.salas.map((s) => {
                  const recontarla = s.estado === 'RECONTAR';
                  return (
                    <Pressable key={s.id} onPress={() => contar(s)}
                      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 8, opacity: pressed ? 0.6 : 1 })}>
                      <Text style={{ flex: 1, color: recontarla ? MARCA.ambar : colorSistema.acento, fontSize: 16, fontWeight: '600' }}>
                        {recontarla ? `Volver a contar${g.salas.length > 1 ? ` en ${s.sala}` : ''}` : `Contar${g.salas.length > 1 ? ` en ${s.sala}` : ''}`}
                      </Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 18 }}>›</Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </Seccion>
        ) : null}

        {consultas == null ? <Cargando /> : error && !grupos.length ? (
          <ErrorConReintento mensaje={error} onReintentar={cargar} />
        ) : !grupos.length ? (
          <Vacio titulo="Todavía no se pidió ningún conteo" icono="ClipboardCheck" />
        ) : (
          <View style={{ gap: 10 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', marginLeft: 16 }}>CONSULTAS</Text>
            {grupos.map((g) => {
              const c = g.primera;   // quién lo pidió primero
              const quien = empleado(c.pedido_por);
              const contestaron = g.salas.filter((s) => !['PENDIENTE', 'RECONTAR'].includes(s.estado)).length;
              // Un descuadre que la revisión de factor ya cubrió entero no cuenta.
              const descuadres = g.salas.filter((s) => s.estado === 'DESCUADRE' && efectoDeCorreccion(s)?.tipo !== 'cubierta').length;
              return (
                <Vidrio key={g.erp_product_id} radio={20}>
                  <View style={{ padding: 14, gap: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{c.nombre}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          {quien ? <Avatar empleado={quien} tamano={20} /> : null}
                          <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }}>
                            {`${quien ? shortEmployeeName(quien) : 'Sistema'}${c.pedido_desde ? ` · ${c.pedido_desde}` : ''} · ${fechaNumerica(c.created_at)}${g.pedidos > 1 ? ` · ${g.pedidos} pedidos` : ''}`}
                          </Text>
                        </View>
                      </View>
                      <Pildora color={descuadres ? MARCA.rojo : contestaron === g.salas.length ? MARCA.verde : colorSistema.texto2}
                        texto={descuadres ? `${formatQty(descuadres)} con descuadre` : `${formatQty(contestaron)} de ${formatQty(g.salas.length)} contaron`} />
                    </View>
                    {c.motivo ? <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{c.motivo}</Text> : null}
                    {g.salas.map((s, i) => (
                      <FilaDeSala key={s.id} s={s} primero={i === 0} puedeAjustar={puedeAjustar} ocupado={ocupado}
                        onAjustar={() => abrirAjuste(s.consulta, s)} onSinAjuste={() => sinAjuste(s.consulta, s)} />
                    ))}
                  </View>
                </Vidrio>
              );
            })}
          </View>
        )}
      </ScrollView>
    </>
  );
}
