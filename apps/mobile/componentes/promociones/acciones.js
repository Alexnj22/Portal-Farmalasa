// Las acciones de una promoción en la app, con las MISMAS funciones del portal
// (`activarPromocion`, `duplicarPromocion`) y sus mismas confirmaciones:
//  · pausar pide confirmación porque deja de contar ventas en el acto
//    («Volver a borrador» en el portal); activar no;
//  · duplicar pide el nombre de la copia y, si se quiere, UNA sala (el sistema
//    de ventas admite un descuento para una sala o para todas, nunca un grupo).
import { ActionSheetIOS, Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { activarPromocion, duplicarPromocion } from '@nucleo/data/promociones';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { SALAS_VENTA } from '@nucleo/utils/metasUtils';
import { fallo, listo } from '../Progreso';

export function alternarPromocion(promo, onListo) {
  const activa = promo.estado === 'activa';
  const hacer = async () => {
    try {
      await activarPromocion(promo.id, !activa);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo(activa ? 'Volvió a borrador' : 'Promoción activa', activa ? 'Deja de contar ventas desde ahora.' : 'Cuenta las ventas de su vigencia.');
      onListo?.();
    } catch (e) {
      fallo('No se pudo cambiar el estado', mensajeAmigable(e, 'Intenta de nuevo.'));
    }
  };
  if (!activa) return hacer();
  return Alert.alert('Volver a borrador', `«${promo.nombre}» deja de contar ventas en el acto, hasta que se vuelva a activar.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Volver a borrador', style: 'destructive', onPress: hacer },
  ]);
}

export function duplicarConPreguntas(promo, branches, onListo) {
  const salas = SALAS_VENTA.map((id) => (branches || []).find((b) => Number(b.id) === id)).filter(Boolean);
  const aviso = Number(promo.descuentos) > 0
    ? '\n\nEsta baja el precio en la venta: la copia sólo podrá tener su descuento si le cambias las fechas.'
    : '';
  Alert.prompt('Duplicar promoción', `El nombre de la copia. Nace en borrador.${aviso}`, [
    { text: 'Cancelar', style: 'cancel' },
    {
      text: 'Siguiente',
      onPress: (nombre) => {
        const limpio = String(nombre ?? '').trim();
        if (limpio.length < 3) { fallo('Falta el nombre', 'Escribe al menos 3 letras.'); return; }
        const opciones = ['Mismas salas que el original', ...salas.map((s) => `Sólo ${s.name}`), 'Cancelar'];
        ActionSheetIOS.showActionSheetWithOptions({ title: '¿Para qué salas?', options: opciones, cancelButtonIndex: opciones.length - 1 }, async (i) => {
          if (i === opciones.length - 1) return;
          try {
            await duplicarPromocion({ id: promo.id, nombre: limpio, branchId: i === 0 ? null : salas[i - 1].id });
            listo('Copia creada', 'Quedó en borrador.');
            onListo?.();
          } catch (e) {
            fallo('No se pudo duplicar', mensajeAmigable(e, 'Intenta de nuevo.'));
          }
        });
      },
    },
  ], 'plain-text', `${promo.nombre} (copia)`);
}
