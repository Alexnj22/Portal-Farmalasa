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
  'arrowshape.turn.up.left.fill': 'reply',
  'bag.fill': 'shopping_bag',
  'bag.fill.badge.plus': 'shopping_bag',
  'banknote.fill': 'payments',
  'bell': 'notifications',
  'bell.badge': 'notifications_unread',
  'bell.fill': 'notifications',
  'bubble.left.and.bubble.right.fill': 'forum',
  'building.2.fill': 'apartment',
  'camera.fill': 'photo_camera',
  'calendar': 'calendar_month',
  'cart': 'shopping_cart',
  'cart.badge.plus': 'add_shopping_cart',
  'cart.fill': 'shopping_cart',
  'checklist': 'checklist',
  'checkmark': 'check',
  'doc.on.doc': 'content_copy',
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
  'lock.open.fill': 'lock_open',
  'magnifyingglass': 'search',
  'moon.fill': 'bedtime',
  'map.fill': 'map',
  'mappin.and.ellipse': 'location_on',
  'minus': 'remove',
  'minus.circle.fill': 'do_not_disturb_on',
  'paperplane.fill': 'send',
  'person.2.fill': 'group',
  'person.crop.circle.badge.checkmark': 'support_agent',
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
  'square.and.arrow.up': 'share', // el «compartir» de Android, no el de iOS
  'square.grid.2x2.fill': 'grid_view',
  'square.stack.3d.up.fill': 'stacks',
  'star': 'star',
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
  // El chat (2026-10-20): editar, nota de voz, documento.
  'pencil': 'edit',
  'mic.fill': 'mic',
  'doc.fill': 'description',
  'stop.fill': 'stop',
  'play.fill': 'play_arrow',
  'pause.fill': 'pause',
  'waveform': 'graphic_eq',
  'nosign': 'block',
  'barcode': 'barcode',
  'mappin.circle.fill': 'location_on',
  'trash.fill': 'delete',
  'wallet.pass.fill': 'wallet',
  'wifi.slash': 'wifi_off',
  'wind': 'air',
  'photo.on.rectangle': 'photo_library',
  'xmark': 'close',
  'xmark.circle': 'cancel',
  'xmark.circle.fill': 'cancel',
  // Los que faltaban y en Android salían como su respaldo de texto (2026-10-13).
  'arrow.down.circle.fill': 'download_for_offline',
  'bell.badge.fill': 'notifications_active',
  'birthday.cake.fill': 'cake',
  'doc.text.image': 'image',
  'doc.text.viewfinder': 'document_scanner',
  'ellipsis': 'more_horiz',
  'square.and.arrow.down': 'download',
  'wifi.exclamationmark': 'signal_wifi_bad',
  // La bandeja de avisos (2026-10-14): leída / no leída, el menú y las borradas.
  'envelope.badge.fill': 'mark_email_unread',
  'envelope.open.fill': 'drafts',
  'ellipsis.circle': 'more_vert',
  'tray': 'inbox',
  'trash.slash.fill': 'restore_from_trash',
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
