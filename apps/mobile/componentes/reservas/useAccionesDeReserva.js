// Las acciones de una tarjeta de reserva en la app del personal (2026-10-22):
// QUÉ se ofrece y en qué orden lo decide el núcleo (`accionesDeReservaNucleo`,
// la misma lista que arma el portal); acá vive el CÓMO de cada una —la
// confirmación, la llamada y la pantalla que se abre—, escrito una vez para la
// lista (`reservas-sala`) y el detalle (`reserva/[id]`). Dos lugares que hacen
// lo mismo con código propio terminan haciendo cosas distintas.
import { useState } from 'react';
import { Alert, Linking } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  amarrarReservaAVenta, cambiarEstadoReserva, codigoDeReserva, enviarPreventa, marcarAvisadaPorWhatsapp, mensajeDeReservaLista, prorrogarReserva, ventasDelError, whatsappDe,
} from '@nucleo/data/reservas';
import { puedeEnviarPreventa } from '@nucleo/utils/preventa';
import { modoDeProrroga } from '@nucleo/utils/reservasDeSala';
import { fechaTexto } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaHora12 } from '@nucleo/utils/hora';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fallo, listo, trabajando } from '../Progreso';

/**
 * Los permisos de la pantalla de Reservas, iguales en la lista y el detalle.
 * Con «ver» y sin «editar» se mira sin botones; la tarjeta del Inicio
 * (`dash_reservas`) trabaja la lista como en el portal. Enviar a caja pide
 * editar la pantalla de Reservas (el servidor lo vuelve a decidir).
 */
export function permisosDeReservas(hasPermission) {
  const soloLectura = !hasPermission('reservas', 'can_edit') && !hasPermission('dash_reservas');
  return {
    soloLectura,
    puedeRecetas: hasPermission('recetas_app', 'can_approve'),
    puedePreventa: !soloLectura && hasPermission('reservas', 'can_edit'),
  };
}

/** `sala`: la sala a la que se mira (null con «todas»); `recargar`: relee después de cada acción. */
export function useAccionesDeReserva({ sala, nombreSala = '', verTodas = false, recargar }) {
  const appendAuditLog = useStaffStore((s) => s.appendAuditLog);
  const [ocupada, setOcupada] = useState(null);
  const releer = () => { Promise.resolve(recargar?.()).catch(() => {}); };

  const avisarPorWhatsapp = (r) => {
    const numero = whatsappDe(r.telefono);
    if (!numero) { Alert.alert('Sin teléfono válido', 'El cliente no tiene un teléfono válido para WhatsApp.'); return; }
    const texto = mensajeDeReservaLista(r, r.sala ?? nombreSala);
    Alert.alert('Avisar por WhatsApp', `Al +${numero}:\n\n${texto}`, [
      { text: 'Ahora no', style: 'cancel' },
      { text: 'Abrir WhatsApp', onPress: async () => {
        await Linking.openURL(`https://wa.me/${numero}?text=${encodeURIComponent(texto)}`)
          .catch((e) => console.warn(`useAccionesDeReserva: no se abrió WhatsApp para la reserva ${r.id}`, e));
        await Promise.resolve(marcarAvisadaPorWhatsapp(r.id))
          .catch((e) => console.warn(`useAccionesDeReserva: no se anotó el aviso por WhatsApp de la reserva ${r.id}`, e));
        releer();
      } },
    ]);
  };

  // Un pedido se mueve ENTERO: «ya llegó» mueve sólo los renglones que esperaban.
  const mover = (r, estado) => {
    const filasDe = r.renglones ?? [r];
    const ids = filasDe.filter((x) => (estado === 'lista' ? x.estado === 'pendiente' : x.estado === r.estado)).map((x) => x.id);
    const que = r.renglones?.length > 1 ? `el pedido ${r.pedido} (${ids.length} ${ids.length === 1 ? 'producto' : 'productos'})` : `${r.cantidad} × ${r.producto}`;
    const textos = {
      lista: ['Apartar y avisar', `Se aparta ${que}${r.tiene_app ? ' y se le avisa al cliente en la app.' : '. El cliente no tiene la app. Después se le avisa por WhatsApp.'}`, 'Apartar'],
    }[estado];
    Alert.alert(textos[0], textos[1], [
      { text: 'Volver', style: 'cancel' },
      { text: textos[2], onPress: async () => {
        setOcupada(r.id);
        try {
          for (const id of ids) await cambiarEstadoReserva(id, estado);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          if (estado === 'lista') {
            if (r.tiene_app) listo('Reserva lista', 'Le avisamos al cliente en la app.');
            else avisarPorWhatsapp({ ...r, estado: 'lista' });
          }
          releer();
        } catch (e) { fallo('No se pudo cambiar', mensajeAmigable(e, 'Intenta de nuevo.')); } finally { setOcupada(null); }
      } },
    ]);
  };

  // Cancelar (reglamento, cláusula 3.10): no se deshace y pide el motivo (≥3
  // caracteres), como el portal. Un pedido se cancela entero. `Alert.prompt`
  // es de iOS; en Android lo pone `componentes/HojasAndroid`.
  const cancelar = (r) => {
    const filasDe = r.renglones ?? [r];
    const que = filasDe.length > 1 ? `el pedido entero (${filasDe.length} productos)` : `${r.cantidad} × ${r.producto}`;
    Alert.prompt(`Cancelar ${r.pedido ?? codigoDeReserva(r.id)}`,
      `Se cancela ${que}. No se deshace. Lo que el cliente ya pagó queda como saldo a favor suyo.\n\nMotivo (queda en la bitácora):`, [
        { text: 'Volver', style: 'cancel' },
        { text: 'Cancelar reserva', style: 'destructive', onPress: async (texto) => {
          const motivo = String(texto ?? '').trim();
          if (motivo.length < 3) { fallo('Falta el motivo', 'Escribe por qué se cancela (al menos 3 letras).'); return; }
          await cancelarConMotivo(r, motivo);
        } },
      ], 'plain-text', '', 'default');
  };

  // Como el portal (2026-10-26): si el producto ya se le facturó al cliente
  // por fuera de «Retirar», la base lanza `VENTA_YA_FACTURADA` y no cancela a
  // ciegas. Los renglones sin esa duda se cancelan igual; los que la tienen
  // esperan a que se diga si el anticipo se descontó en esa factura.
  const cancelarConMotivo = async (r, motivo, anticipoEnVenta = null, soloIds = null) => {
    setOcupada(r.id);
    try {
      const ids = soloIds ?? (r.renglones ?? [r]).map((x) => x.id);
      const conVenta = [];
      for (const id of ids) {
        try {
          await cambiarEstadoReserva(id, 'cancelada', motivo, anticipoEnVenta);
        } catch (err) {
          const ventas = ventasDelError(err);
          if (!ventas) throw err;
          conVenta.push({ id, ventas });
        }
      }
      releer();
      if (conVenta.length) { preguntarSiSeDesconto(r, motivo, conVenta); return; }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo('Reserva cancelada', anticipoEnVenta
        ? 'El anticipo ya se usó en la factura. No queda saldo a favor.'
        : 'Lo que el cliente ya pagó queda como saldo a favor.');
    } catch (e) {
      fallo('No se pudo cancelar', mensajeAmigable(e, 'Intenta de nuevo.'));
      releer();
    } finally { setOcupada(null); }
  };

  const preguntarSiSeDesconto = (r, motivo, conVenta) => {
    const ids = new Set(conVenta.map((x) => x.id));
    const anticipo = (r.renglones ?? [r]).filter((x) => ids.has(x.id)).reduce((t, x) => t + Number(x.anticipo ?? 0), 0);
    const facturas = [...new Map(conVenta.flatMap((x) => x.ventas).map((v) => [v.invoice_id, v])).values()];
    const codigo = r.pedido ?? codigoDeReserva(r.id);
    const lista = facturas.map((v) => `· Factura ${v.factura} · ${fechaTexto(v.fecha, { weekday: 'short', day: 'numeric', month: 'short' })} · ${v.sala} · ${Number(v.cantidad)} u.`).join('\n');
    const soloIds = conVenta.map((x) => x.id);
    Alert.alert('Este producto ya se le facturó',
      `Después de reservar, al mismo cliente se le facturó lo que tenía apartado en ${codigo}:\n${lista}\n\n¿En esa venta se le descontó el anticipo de ${formatMoney(anticipo)}? Si se descontó, cancelar no deja saldo a favor. Si pagó la factura completa, el anticipo queda a su favor.`, [
        { text: 'Ahora no', style: 'cancel' },
        { text: 'Pagó completo', onPress: () => cancelarConMotivo(r, motivo, false, soloIds) },
        { text: 'Sí, se descontó', onPress: () => cancelarConMotivo(r, motivo, true, soloIds) },
      ]);
  };

  // Una sola prórroga de 7 días (reglamento v2); un pedido se prorroga entero.
  const prorrogar = (r) => {
    Alert.alert('Prorrogar el plazo', 'Una sola prórroga de 7 días para retirarla. No admite otra.', [
      { text: 'Volver', style: 'cancel' },
      { text: 'Prorrogar', onPress: async () => {
        setOcupada(r.id);
        try {
          const ids = (r.renglones ?? [r]).filter((x) => modoDeProrroga(x) === 'directa').map((x) => x.id);
          let vence = null;
          for (const id of ids) vence = (await prorrogarReserva(id))?.vence_at ?? vence;
          listo('Plazo prorrogado', vence ? `Puede retirarla hasta el ${fechaTexto(vence, { weekday: 'long', day: 'numeric', month: 'long' })}. No admite otra prórroga.` : '');
          releer();
        } catch (e) { fallo('No se pudo prorrogar', mensajeAmigable(e, 'Intenta de nuevo.')); } finally { setOcupada(null); }
      } },
    ]);
  };

  // La venta de la reserva, ya armada en la caja: producto, cliente y quien la
  // envía como vendedor. Un pedido va en UNA preventa.
  const enviarACaja = (r) => {
    const ids = (r.renglones ?? [r]).filter(puedeEnviarPreventa).map((x) => x.id);
    if (!ids.length) return;
    Alert.alert('Enviar a caja', 'Deja la venta armada en la caja con el producto, el cliente y tú como vendedor.', [
      { text: 'Volver', style: 'cancel' },
      { text: 'Enviar', onPress: async () => {
        setOcupada(r.id); trabajando('Enviando a caja…');
        try {
          const res = await enviarPreventa(ids);
          if (!res?.ok) { fallo('No se envió a caja', mensajeAmigable(res?.error, 'Intenta de nuevo.')); return; }
          Promise.resolve(appendAuditLog?.('RESERVA_PREVENTA', ids.join(','), { referencia: res.referencia ?? null, sala: r.branch_id ?? sala })).catch(() => {});
          const notas = [
            res.cliente_generico ? 'Va como cliente frecuente. El código de la reserva va en la nota.' : '',
            ...(res.avisos ?? []),
            res.externo_id ? 'Al facturarla, la reserva se cierra sola.' : 'Al facturarla, ciérrala con «Retirar».',
          ].filter(Boolean).join(' ');
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          (res.avisos?.length ? fallo : listo)(`Preventa #${res.referencia} en caja`, notas);
        } catch (e) { fallo('No se envió a caja', mensajeAmigable(e, 'Intenta de nuevo.')); } finally { setOcupada(null); releer(); }
      } },
    ]);
  };

  // Retirar: los renglones listos, de a uno (un pedido trae varios).
  const retirar = (r) => {
    const listos = (r.renglones ?? [r]).filter((x) => x.estado === 'lista');
    const ir = (x) => router.push({ pathname: '/reserva-retirar', params: { id: String(x.id), tipo: 'reserva', sala: String(x.branch_id ?? r.branch_id ?? sala) } });
    if (listos.length <= 1) { if (listos[0]) ir(listos[0]); return; }
    Alert.alert('¿Cuál se retira?', 'Cada producto del pedido se factura aparte.', [
      ...listos.map((x) => ({ text: `${x.cantidad} × ${x.producto}`, onPress: () => ir(x) })),
      { text: 'Volver', style: 'cancel' },
    ]);
  };

  // Cerrar con la venta que la caja ya hizo por fuera (2026-11-20), como el portal.
  const amarrarConVenta = async (r, x, seDesconto) => {
    setOcupada(r.id);
    try {
      const res = await amarrarReservaAVenta(x.id, x.vendida_aparte.invoice_id, seDesconto);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo('Reserva cerrada', res?.saldo_favor
        ? `Quedó entregada con esa venta. ${formatMoney(Number(res.saldo_favor))} quedan a favor del cliente.`
        : 'Quedó entregada con esa venta. No queda saldo a favor.');
    } catch (e) {
      fallo('No se pudo cerrar', mensajeAmigable(e, 'Intenta de nuevo.'));
    } finally { setOcupada(null); releer(); }
  };

  const amarrar = (r, x) => {
    if (!x?.vendida_aparte) return;
    const v = x.vendida_aparte;
    const anticipo = Number(x.anticipo ?? 0);
    const titulo = `Cerrar ${r.pedido ?? codigoDeReserva(r.id)} con esa venta`;
    const que = `El ${fechaHora12(v.at)} se le vendió ${x.cantidad} × ${x.producto} en caja por ${formatMoney(Number(v.total ?? 0))}. Al cerrar, la reserva queda entregada con esa venta. No se deshace.`;
    // 2026-11-21: elegir una opción ya no cierra; se confirma aparte, como en el portal.
    const confirmar = (seDesconto) => Alert.alert(titulo, seDesconto
      ? 'Se le descontó el anticipo. No queda nada a su favor.'
      : `Pagó la venta completa. Los ${formatMoney(anticipo)} del anticipo quedan a su favor.`, [
      { text: 'Cerrar reserva', onPress: () => amarrarConVenta(r, x, seDesconto) },
      { text: 'Atrás', style: 'cancel', onPress: () => amarrar(r, x) },
    ]);
    Alert.alert(titulo,
      anticipo > 0 ? `${que}\n\nDejó un anticipo de ${formatMoney(anticipo)}. ¿Qué pasó con él en esa venta?\n\n• Se le descontó: en caja pagó sólo lo que faltaba. No queda nada a su favor. Elige esta también si ya se le devolvió en efectivo.\n\n• Pagó completo: en caja pagó el precio entero, aparte del anticipo. El anticipo queda a su favor.` : que,
      anticipo > 0 ? [
        { text: 'Se le descontó', onPress: () => confirmar(true) },
        { text: 'Pagó completo', onPress: () => confirmar(false) },
        { text: 'Ahora no', style: 'cancel' },
      ] : [
        { text: 'Cerrar reserva', onPress: () => amarrarConVenta(r, x, true) },
        { text: 'Ahora no', style: 'cancel' },
      ]);
  };

  // Resolver y traer de otra sala: el MISMO `reserva-resolver`, sobre el renglón que lo necesita.
  const resolver = (x) => router.push({ pathname: '/reserva-resolver', params: { id: String(x.id), sala: String(x.branch_id ?? sala) } });
  const verReceta = (r) => router.push({ pathname: '/reserva-receta', params: verTodas || (r.branch_id == null && sala == null)
    ? { id: String(r.id), todas: '1' } : { id: String(r.id), sala: String(r.branch_id ?? sala) } });

  /** Hace la acción `a` (de `accionesDeReservaNucleo`) sobre la tarjeta `r`. */
  const ejecutar = (r, a) => {
    switch (a.k) {
      case 'receta': verReceta(r); break;
      case 'resolver': case 'traer': resolver(a.renglon ?? r); break;
      case 'apartar': mover(r, 'lista'); break;
      case 'retirar': retirar(r); break;
      case 'caja': enviarACaja(r); break;
      case 'whatsapp': avisarPorWhatsapp(r); break;
      case 'prorrogar': prorrogar(r); break;
      // Reglamento v2, cláusula 6.4 (2026-10-30): se pide con días y motivo; la autoriza TH o Supervisión.
      case 'pedir_prorroga': {
        const pedibles = (r.renglones ?? [r]).filter((x) => modoDeProrroga(x) === 'pedir');
        router.push({ pathname: '/reserva-prorroga', params: { modo: 'pedir', tipo: 'reserva', ids: pedibles.map((x) => x.id).join(','),
          titulo: r.pedido ?? codigoDeReserva(r.id), vence: String(pedibles[0]?.vence_at ?? '') } });
        break;
      }
      // Reglamento v2, cláusula 9 (lo habilita la base con `registrar_llamada`).
      case 'llamada': router.push({ pathname: '/reserva-llamada', params: {
        reserva: String(r.id), codigo: r.pedido ?? codigoDeReserva(r.id), cliente: String(r.cliente ?? ''), telefono: String(r.telefono ?? '') } }); break;
      case 'amarrar': amarrar(r, a.renglon); break;
      case 'cancelar': cancelar(r); break;
      default: break;
    }
  };

  return { ocupada, ejecutar };
}
