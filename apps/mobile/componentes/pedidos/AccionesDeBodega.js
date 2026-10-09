// Lo que Bodega hace sobre la sala de un pedido, NATIVO — los botones de la
// tarjeta del portal (`TabPedidos`) con las MISMAS reglas:
//   · apoyo en la preparación (carnés, uno tras otro)
//   · iniciar (`puedePrepararse`), pausar con motivo, reanudar
//   · FINALIZAR con sus cajas y hojas (`pedido/finalizar`)
//   · la hoja de despacho para imprimir o compartir (`pedidos_descargar`)
//   · programar la entrega y armar la ruta cuando ya está listo
//   · reenviar lo que no llegó (`pedido/reenviar`)
//   · reintentar el ingreso al inventario de lo que la sala contó y no entró
//   · anular el pedido entero (`anulacionDelPedido`)
//
// Las escrituras son las del núcleo (`accionesDePedido`, `accionesDeBodega`),
// las mismas del portal.
import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { anularPedidoConMotivo, etapaDePedido } from '@nucleo/data/accionesDePedido';
import { reintentarIngreso } from '@nucleo/data/accionesDeBodega';
import {
  fetchActiveRutas, fetchApoyoForPedido, fetchEmployeeByKioskPin, fetchPedidoItemsAll, fetchPedidoSucursalStatus,
  fetchResumenIngresoPedidos, upsertPedidoApoyo,
} from '@nucleo/data/pedidos';
import { anulacionDelPedido, claveParada, faltantesDeLaSala, puedeDespacharse, puedePrepararse } from '@nucleo/utils/tableroDePedidos';
import { seccionDePedido } from '@nucleo/utils/papelDePedido';
import { papelDePedidoHtml } from '@nucleo/utils/papelDePedidoHtml';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { hora12 } from '@nucleo/utils/hora';
import { fechaTexto } from '@nucleo/utils/fecha';
import { registrarEgreso } from '@nucleo/data/egreso';
import { BotonGrande, Aviso } from '../formulario/Piezas';
import { MARCA } from '../inicio/marca';
import { fallo, listo, trabajando, cerrarProgreso } from '../Progreso';
import { compartirPdf, imprimirPapel } from '../pdf';
import Escaner from '../Escaner';

const hoyIso = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

export default function AccionesDeBodega({ row, etapa, etapas, onCambio }) {
  const { user, hasPermission } = useAuth();
  const [ocupado, setOcupado] = useState(false);
  const [ingreso, setIngreso] = useState(null);
  const [enRuta, setEnRuta] = useState(false);
  const [escaneando, setEscaneando] = useState(false);
  const [apoyo, setApoyo] = useState([]);
  const [avisoApoyo, setAvisoApoyo] = useState(null);
  const anular = anulacionDelPedido(row, etapas);
  const params = { pedidoId: String(row.pedido_id), sucId: String(row.erp_sucursal_id), numero: String(row.numero ?? '') };
  const faltan = faltantesDeLaSala(row);
  const puedePapel = hasPermission('pedidos_descargar');

  // Lo que entró al inventario, y si el conductor sigue en ruta con este pedido.
  const leer = useCallback(() => {
    Promise.resolve(fetchResumenIngresoPedidos([row.pedido_id])).then(({ data }) => {
      setIngreso((data ?? []).find((x) => Number(x.erp_sucursal_id) === Number(row.erp_sucursal_id)) ?? null);
    }).catch(() => {});
    Promise.resolve(fetchActiveRutas(hoyIso())).then(({ data }) => {
      const clave = claveParada(row.pedido_id, row.erp_sucursal_id);
      setEnRuta((data ?? []).some((r) => r.status === 'en_ruta' && !r.vuelta_base_at
        && (r.ruta_pedidos ?? []).some((p) => claveParada(p.pedido_id, p.erp_sucursal_id) === clave)));
    }).catch(() => {});
  }, [row.pedido_id, row.erp_sucursal_id]);
  useEffect(() => { leer(); }, [leer]);

  const avanzar = async (stage, titulo) => {
    setOcupado(true);
    try {
      await etapaDePedido({ pedidoId: row.pedido_id, sucId: row.erp_sucursal_id, stage, userId: user?.id ?? null });
      useStaffStore.getState().appendAuditLog?.(`PEDIDO_LIFECYCLE_${stage.toUpperCase()}`, row.pedido_id, { sucursal_id: row.erp_sucursal_id, desde: 'app' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo(titulo, '');
      onCambio?.();
    } catch (e) {
      fallo('No se pudo', mensajeAmigable(e));
    } finally {
      setOcupado(false);
    }
  };

  const hacerAnular = async (motivo) => {
    setOcupado(true);
    try {
      await anularPedidoConMotivo({ pedidoId: row.pedido_id, userId: user?.id ?? null, motivo });
      useStaffStore.getState().appendAuditLog?.('PEDIDO_ANULADO', row.pedido_id, { numero: row.numero, motivo, desde: 'app' });
      listo(`Pedido #${row.numero} anulado`, motivo ? `Motivo: ${motivo}` : '');
      onCambio?.();
    } catch (e) {
      fallo('No se pudo anular', mensajeAmigable(e));
    } finally {
      setOcupado(false);
    }
  };
  const pedirAnular = () => {
    const texto = `Se anula el pedido #${row.numero} completo, en todas sus salas. No se deshace.`;
    if (anular.pideMotivo && Platform.OS !== 'web') {
      Alert.prompt('Anular pedido', `${texto}\n\nUna sala ya lo está preparando: escribe el motivo.`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Anular', style: 'destructive', onPress: (m) => { if (String(m ?? '').trim()) hacerAnular(String(m).trim()); else fallo('Falta el motivo', 'Escríbelo para poder anular.'); } },
      ], 'plain-text');
      return;
    }
    Alert.alert('Anular pedido', texto, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Anular', style: 'destructive', onPress: () => hacerAnular(null) },
    ]);
  };

  // La hoja de despacho: la misma del portal, partida en las hojas guardadas.
  const papel = async (modo) => {
    setOcupado(true);
    trabajando('Armando la hoja…');
    try {
      const [items, { data: pss }] = await Promise.all([
        fetchPedidoItemsAll(row.pedido_id, row.erp_sucursal_id),
        Promise.resolve(fetchPedidoSucursalStatus(row.pedido_id, row.erp_sucursal_id, 'paginas, caja_map')).catch(() => ({ data: null })),
      ]);
      // Sala ya finalizada: la hoja dice lo que SALIÓ (`cantidad_enviada`), como el portal.
      const seccion = seccionDePedido(Number(row.erp_sucursal_id), items ?? [], row.codigo ?? null,
        row.finalizado_at ? { cantidad: 'enviada' } : {});
      const html = papelDePedidoHtml(seccion, { numero: row.numero, codigo: row.codigo, paginas: pss?.paginas, cajaMap: pss?.caja_map });
      cerrarProgreso();
      if (modo === 'imprimir') await imprimirPapel(html);
      else if (await compartirPdf({ html, nombre: row.codigo ?? `Pedido ${row.numero} ${seccion.nombre}` })) {
        registrarEgreso('pedidos', { formato: 'pdf', filas: seccion.rows.length, detalle: { pedido_id: row.pedido_id, sucursal_id: row.erp_sucursal_id, desde: 'app' } });
      }
    } catch (e) {
      fallo('No se pudo armar la hoja', mensajeAmigable(e));
    } finally {
      setOcupado(false);
    }
  };
  const elegirPapel = () => Alert.alert('Hoja de despacho', `Pedido #${row.numero}`, [
    { text: 'Imprimir', onPress: () => papel('imprimir') },
    { text: 'Compartir PDF', onPress: () => papel('compartir') },
    { text: 'Cancelar', style: 'cancel' },
  ]);

  // Apoyo en la preparación: carnés uno tras otro, como el `ApoioScanModal`.
  const abrirApoyo = async () => {
    const { data } = await Promise.resolve(fetchApoyoForPedido(row.pedido_id, row.erp_sucursal_id)).catch(() => ({ data: [] }));
    setApoyo((data ?? []).filter((a) => (a.tipo ?? 'preparacion') === 'preparacion'));
    setAvisoApoyo(null);
    setEscaneando(true);
  };
  const leerCarne = async (codigo) => {
    const { data: emp, error } = await fetchEmployeeByKioskPin(String(codigo).toUpperCase().trim());
    if (error || !emp) { setAvisoApoyo(error ? mensajeAmigable(error, 'No se pudo confirmar el carné.') : 'Ese carné no es de nadie.'); return false; }
    if (apoyo.some((a) => a.employee_id === emp.id)) { setAvisoApoyo(`${shortEmployeeName(emp)} ya está anotado.`); return false; }
    const { error: e } = await upsertPedidoApoyo({ pedido_id: row.pedido_id, erp_sucursal_id: row.erp_sucursal_id, employee_id: emp.id, registered_by: user?.id ?? null, tipo: 'preparacion' });
    if (e) { setAvisoApoyo(mensajeAmigable(e, 'No se pudo registrar el apoyo.')); return false; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setApoyo((xs) => [...xs, { employee_id: emp.id, tipo: 'preparacion' }]);
    setAvisoApoyo(`${shortEmployeeName(emp)} anotado. Escanea el siguiente o cierra.`);
    return false;
  };

  const hacerReintento = async () => {
    setOcupado(true);
    try {
      const r = await reintentarIngreso({ pedidoId: row.pedido_id, sucId: row.erp_sucursal_id });
      if (r.nada) listo('Nada que ingresar', 'Todo lo confirmado ya está en el inventario.');
      else {
        useStaffStore.getState().appendAuditLog?.('REINTENTAR_INGRESO_INVENTARIO', row.pedido_id, {
          sucursal_id: row.erp_sucursal_id, items_count: r.pedidos, entraron: r.entraron, completo: r.completo, desde: 'app',
        });
        if (r.entraron === 0) fallo('Nada entró al inventario', 'Los productos siguen pendientes. Si se repite, hay que revisarlos en el sistema.');
        else listo('Ingresado', `${r.entraron} producto${r.entraron === 1 ? '' : 's'} entr${r.entraron === 1 ? 'ó' : 'aron'} al inventario.${r.completo === false ? ` Quedan ${r.pedidos - r.entraron} por reintentar.` : ''}`);
      }
      leer();
      onCambio?.();
    } catch (e) {
      fallo('No se pudo ingresar', mensajeAmigable(e));
    } finally {
      setOcupado(false);
    }
  };
  const pedirReintento = () => Alert.alert('Reintentar el ingreso',
    'Vuelve a ingresar al inventario sólo lo que la sala ya contó y no entró.',
    [{ text: 'Cancelar', style: 'cancel' }, { text: 'Reintentar', onPress: hacerReintento }]);

  const botones = [];
  if (['sin_iniciar', 'preparando', 'pausado'].includes(etapa)) botones.push(<BotonGrande key="apo" texto="Apoyo (carnés)" color={MARCA.azulClaro} borde deshabilitado={ocupado} onPress={abrirApoyo} />);
  if (puedePrepararse(row)) botones.push(<BotonGrande key="ini" texto="Iniciar preparación" color={MARCA.azul} deshabilitado={ocupado} onPress={() => avanzar('iniciar', 'Preparación iniciada')} />);
  if (etapa === 'preparando') {
    botones.push(<BotonGrande key="fin" texto="Finalizar (cajas y hojas)" color={MARCA.verde} deshabilitado={ocupado} onPress={() => router.push({ pathname: '/pedido/finalizar', params })} />);
    botones.push(<BotonGrande key="pau" texto="Pausar" color={MARCA.ambar} borde deshabilitado={ocupado} onPress={() => router.push({ pathname: '/pedido/pausa', params })} />);
  }
  if (etapa === 'pausado') botones.push(<BotonGrande key="rea" texto="Reanudar" color={MARCA.verde} deshabilitado={ocupado} onPress={() => avanzar('reanudar', 'Preparación reanudada')} />);
  if (etapa === 'preparado') {
    botones.push(<BotonGrande key="pro" texto={row.entrega_programada_at ? `Entrega: ${fechaTexto(row.entrega_programada_at, { weekday: 'short', day: 'numeric', month: 'short' })} ${hora12(row.entrega_programada_at)}` : 'Programar entrega'}
      color={MARCA.violetaClaro} borde deshabilitado={ocupado} onPress={() => router.push({ pathname: '/pedido/programar', params })} />);
  }
  if (puedeDespacharse(row)) botones.push(<BotonGrande key="ruta" texto="Armar ruta de reparto" color={MARCA.violetaClaro} deshabilitado={ocupado} onPress={() => router.push({ pathname: '/pedido/ruta/nueva', params: { con: claveParada(row.pedido_id, row.erp_sucursal_id) } })} />);
  if (puedePapel) botones.push(<BotonGrande key="pdf" texto="Hoja de despacho" borde deshabilitado={ocupado} onPress={elegirPapel} />);
  if (faltan.hay && !faltan.enCamino && !enRuta) botones.push(<BotonGrande key="ree" texto="Reenviar lo que no llegó" color={MARCA.rojo} deshabilitado={ocupado} onPress={() => router.push({ pathname: '/pedido/reenviar', params })} />);
  if (ingreso?.sin_ingresar > 0) botones.push(<BotonGrande key="ing" texto={`Reintentar ingreso (${ingreso.sin_ingresar})`} color={MARCA.rojo} borde deshabilitado={ocupado} onPress={pedirReintento} />);
  if (anular.puede) botones.push(<BotonGrande key="anu" texto="Anular pedido" color={MARCA.rojo} borde deshabilitado={ocupado} onPress={pedirAnular} />);
  if (!botones.length) return null;

  return (
    <View style={{ gap: 8 }}>
      {ingreso?.sin_ingresar > 0 ? <Aviso tono="freno" texto={`${ingreso.sin_ingresar} producto${ingreso.sin_ingresar === 1 ? '' : 's'} contado${ingreso.sin_ingresar === 1 ? '' : 's'} y sin ingresar al inventario: la sala no los puede facturar.`} />
        : ingreso?.ingresadas > 0 ? <Aviso texto={`${ingreso.ingresadas} en el inventario.`} /> : null}
      {faltan.hay && !faltan.enCamino && enRuta ? <Aviso texto="Esperando que el conductor vuelva a base para reenviar." /> : null}
      {botones}
      <Escaner visible={escaneando} titulo="Quién apoyó en la preparación" ayuda="Apunta al código del carné; puedes escanear varios seguidos"
        onCodigo={leerCarne} onCerrar={() => { setEscaneando(false); onCambio?.(); }}
        pie={avisoApoyo ? <Text style={{ color: '#fff', fontSize: 14, textAlign: 'center' }}>{avisoApoyo}</Text> : null} />
    </View>
  );
}
