// Los íconos de la bandeja y del detalle de una solicitud: SF Symbols en el
// iPhone y Material Symbols en Android, como el resto de la app (`tema/iconos`).
import { Icon } from '@expo/ui';

const i = (ios, android) => Icon.select({ ios, android });

export const ICONO = {
  anterior: i('chevron.left', require('@expo/material-symbols/chevron_left.xml')),
  siguiente: i('chevron.right', require('@expo/material-symbols/chevron_right.xml')),
  marcado: i('checkmark.circle.fill', require('@expo/material-symbols/check_box.xml')),
  sinMarcar: i('circle', require('@expo/material-symbols/check_box_outline_blank.xml')),
  menos: i('minus', require('@expo/material-symbols/remove.xml')),
  mas: i('plus', require('@expo/material-symbols/add.xml')),
  puntos: i('star.fill', require('@expo/material-symbols/star.xml')),
  cancelar: i('xmark.circle', require('@expo/material-symbols/cancel.xml')),
  volver: i('arrow.uturn.backward', require('@expo/material-symbols/undo.xml')),
};
