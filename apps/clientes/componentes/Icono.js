// Un ícono del SISTEMA: SF Symbols en iPhone (los mismos de la barra de abajo)
// y Material Symbols en Android (2026-10-08), con un respaldo de texto para la
// web y para un nombre que no esté en el mapa. Así la campana, la cartera o el
// carrito se ven como el resto del teléfono y no como un emoji.
//
// En Android los dibuja `expo-symbols` con la fuente de Material Symbols. Antes
// salía el `respaldo`, y la mitad de los íconos lo tienen vacío: en Android
// quedaban huecos donde iOS mostraba el ícono. Un SF nuevo se agrega acá con
// su par de https://fonts.google.com/icons (el nombre tiene que existir en
// `expo-symbols/build/android/symbols.json`).
import { Platform, Text } from 'react-native';

let SymbolView = null;
if (Platform.OS === 'ios' || Platform.OS === 'android') {
  try { ({ SymbolView } = require('expo-symbols')); } catch { SymbolView = null; }
}

const MATERIAL = {
  'arrow.clockwise': 'refresh',
  'arrow.counterclockwise': 'undo',
  'arrow.right': 'arrow_forward',
  'arrow.up': 'arrow_upward',
  'arrow.uturn.backward': 'undo',
  'arrow.uturn.backward.circle.fill': 'undo',
  'arrow.uturn.down': 'u_turn_left',
  'bag.fill': 'shopping_bag',
  'bag.fill.badge.plus': 'shopping_bag',
  'banknote.fill': 'payments',
  'bell': 'notifications',
  'bell.badge': 'notifications_unread',
  'bell.fill': 'notifications',
  'building.2.fill': 'apartment',
  'calendar': 'calendar_month',
  'cart': 'shopping_cart',
  'cart.badge.plus': 'add_shopping_cart',
  'cart.fill': 'shopping_cart',
  'checklist': 'checklist',
  'checkmark': 'check',
  'checkmark.circle.fill': 'check_circle',
  'checkmark.seal.fill': 'verified',
  'checkmark.shield.fill': 'verified_user',
  'chevron.down': 'expand_more',
  'chevron.left': 'chevron_left',
  'chevron.right': 'chevron_right',
  'chevron.up': 'expand_less',
  'circle': 'radio_button_unchecked',
  'circle.lefthalf.filled': 'contrast',
  'clock': 'schedule',
  'clock.arrow.circlepath': 'history',
  'clock.fill': 'schedule',
  'creditcard.fill': 'credit_card',
  'cross.case.fill': 'medical_services',
  'crown.fill': 'crown',
  'curlybraces': 'data_object',
  'diamond': 'diamond',
  'diamond.fill': 'diamond',
  'doc.richtext.fill': 'article',
  'doc.text.fill': 'description',
  'drop.fill': 'water_drop',
  'envelope.fill': 'mail',
  'exclamationmark.circle.fill': 'error',
  'faceid': 'face',
  'figure.and.child.holdinghands': 'family_restroom',
  'gearshape.fill': 'settings',
  'gift.fill': 'redeem',
  'hand.draw.fill': 'gesture',
  'hand.raised.fill': 'pan_tool',
  'heart': 'favorite',
  'heart.fill': 'favorite',
  'heart.text.square.fill': 'cardiology',
  'house': 'home',
  'house.fill': 'home',
  'info.circle': 'info',
  'leaf.fill': 'eco',
  'location': 'near_me',
  'location.fill': 'near_me',
  'lock.fill': 'lock',
  'magnifyingglass': 'search',
  'map.fill': 'map',
  'mappin.and.ellipse': 'location_on',
  'minus': 'remove',
  'minus.circle.fill': 'do_not_disturb_on',
  'paperplane.fill': 'send',
  'person.2.fill': 'group',
  'person.crop.circle': 'account_circle',
  'person.crop.circle.fill': 'account_circle',
  'person.fill': 'person',
  'phone.fill': 'call',
  'pills': 'pill',
  'pills.fill': 'pill',
  'plus': 'add',
  'plus.circle.fill': 'add_circle',
  'qrcode': 'qr_code_2',
  'questionmark.circle': 'help',
  'rectangle.portrait.and.arrow.right': 'logout',
  'shippingbox.fill': 'package_2',
  'sparkles': 'auto_awesome',
  'square.and.arrow.up': 'ios_share',
  'square.grid.2x2.fill': 'grid_view',
  'square.stack.3d.up.fill': 'stacks',
  'star.fill': 'star',
  'storefront.fill': 'storefront',
  'syringe.fill': 'syringe',
  'tag': 'sell',
  'tag.fill': 'sell',
  'testtube.2': 'science',
  'thermometer.medium': 'thermometer',
  'ticket.fill': 'confirmation_number',
  'timer': 'timer',
  'touchid': 'fingerprint',
  'trash': 'delete',
  'trash.fill': 'delete',
  'wallet.pass.fill': 'wallet',
  'wifi.slash': 'wifi_off',
  'wind': 'air',
  'xmark': 'close',
  'xmark.circle': 'cancel',
  'xmark.circle.fill': 'cancel',
};

export default function Icono({ sf, respaldo = '•', tam = 22, color }) {
  const textoDeRespaldo = <Text style={{ fontSize: tam * 0.9, color }}>{respaldo}</Text>;
  if (SymbolView && Platform.OS === 'ios') {
    return <SymbolView name={sf} size={tam} tintColor={color} type="hierarchical" weight="medium" />;
  }
  if (SymbolView && MATERIAL[sf]) {
    return <SymbolView name={{ android: MATERIAL[sf] }} size={tam} tintColor={color} fallback={textoDeRespaldo} />;
  }
  return textoDeRespaldo;
}
