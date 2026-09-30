// Los íconos del menú del portal, en los de cada sistema: SF Symbols en iPhone
// y Material Symbols en Android. El núcleo da el ícono por NOMBRE
// (`MODULE_MAP[...].icono`, los de lucide que usa la web); acá se traduce.
// Un nombre nuevo sin traducción sale con el genérico — y se agrega acá.
import { Icon } from '@expo/ui';

const i = (ios, android) => Icon.select({ ios, android });

export const ICONOS = {
  Home: i('house', require('@expo/material-symbols/home.xml')),
  Bell: i('bell', require('@expo/material-symbols/notifications.xml')),
  User: i('person', require('@expo/material-symbols/person.xml')),
  Users: i('person.2', require('@expo/material-symbols/group.xml')),
  FolderOpen: i('folder', require('@expo/material-symbols/folder_open.xml')),
  Monitor: i('desktopcomputer', require('@expo/material-symbols/monitor.xml')),
  MonitorSmartphone: i('laptopcomputer.and.iphone', require('@expo/material-symbols/devices.xml')),
  Smartphone: i('iphone', require('@expo/material-symbols/mobile.xml')),
  AlertTriangle: i('exclamationmark.triangle', require('@expo/material-symbols/warning.xml')),
  Calendar: i('calendar', require('@expo/material-symbols/calendar_month.xml')),
  CalendarCheck: i('calendar.badge.checkmark', require('@expo/material-symbols/event_available.xml')),
  ClipboardList: i('list.clipboard', require('@expo/material-symbols/assignment.xml')),
  ClipboardCheck: i('checklist', require('@expo/material-symbols/assignment_turned_in.xml')),
  Palmtree: i('beach.umbrella', require('@expo/material-symbols/beach_access.xml')),
  ArrowLeftRight: i('arrow.left.arrow.right', require('@expo/material-symbols/swap_horiz.xml')),
  DollarSign: i('dollarsign', require('@expo/material-symbols/attach_money.xml')),
  ShieldCheck: i('checkmark.shield', require('@expo/material-symbols/verified_user.xml')),
  Megaphone: i('megaphone', require('@expo/material-symbols/campaign.xml')),
  Lock: i('lock', require('@expo/material-symbols/lock.xml')),
  Activity: i('waveform.path.ecg', require('@expo/material-symbols/monitor_heart.xml')),
  Printer: i('printer', require('@expo/material-symbols/print.xml')),
  IdCard: i('person.text.rectangle', require('@expo/material-symbols/badge.xml')),
  RadioTower: i('antenna.radiowaves.left.and.right', require('@expo/material-symbols/cell_tower.xml')),
  Ghost: i('questionmark.folder', require('@expo/material-symbols/help_center.xml')),
  Wrench: i('wrench.and.screwdriver', require('@expo/material-symbols/build.xml')),
  TrendingUp: i('chart.line.uptrend.xyaxis', require('@expo/material-symbols/trending_up.xml')),
  Wallet: i('wallet.bifold', require('@expo/material-symbols/account_balance_wallet.xml')),
  Package: i('shippingbox', require('@expo/material-symbols/inventory_2.xml')),
  PackagePlus: i('plus.rectangle.on.rectangle', require('@expo/material-symbols/add_box.xml')),
  PackageMinus: i('minus.rectangle', require('@expo/material-symbols/inventory.xml')),
  Boxes: i('square.stack.3d.up', require('@expo/material-symbols/inventory.xml')),
  HandCoins: i('dollarsign.circle', require('@expo/material-symbols/payments.xml')),
  Target: i('target', require('@expo/material-symbols/target.xml')),
  Star: i('star', require('@expo/material-symbols/star.xml')),
  Gift: i('gift', require('@expo/material-symbols/redeem.xml')),
  Receipt: i('receipt', require('@expo/material-symbols/receipt.xml')),
  ReceiptText: i('doc.text', require('@expo/material-symbols/receipt_long.xml')),
  FileText: i('doc.text', require('@expo/material-symbols/description.xml')),
  BookOpen: i('book', require('@expo/material-symbols/menu_book.xml')),
  Landmark: i('building.columns', require('@expo/material-symbols/account_balance.xml')),
  Calculator: i('plus.forwardslash.minus', require('@expo/material-symbols/calculate.xml')),
  ShoppingCart: i('cart', require('@expo/material-symbols/shopping_cart.xml')),
  Truck: i('truck.box', require('@expo/material-symbols/local_shipping.xml')),
  Thermometer: i('thermometer.medium', require('@expo/material-symbols/thermostat.xml')),
  FlaskConical: i('flask', require('@expo/material-symbols/science.xml')),
  PenLine: i('pencil.line', require('@expo/material-symbols/edit.xml')),
  Mail: i('envelope', require('@expo/material-symbols/mail.xml')),
  BarChart2: i('chart.bar', require('@expo/material-symbols/bar_chart.xml')),
  Building2: i('building.2', require('@expo/material-symbols/domain.xml')),
  UserCheck: i('person.crop.circle.badge.checkmark', require('@expo/material-symbols/how_to_reg.xml')),
  UserX: i('person.crop.circle.badge.xmark', require('@expo/material-symbols/person_off.xml')),
  Contact: i('person.crop.rectangle', require('@expo/material-symbols/contact_page.xml')),
};

export const ICONO_GENERICO = i('square.grid.2x2', require('@expo/material-symbols/apps.xml'));
export const ICONO_SALIR = i('rectangle.portrait.and.arrow.right', require('@expo/material-symbols/logout.xml'));
export const ICONO_ABRIR = i('chevron.right', require('@expo/material-symbols/chevron_right.xml'));

export const iconoDe = (nombre) => ICONOS[nombre] ?? ICONO_GENERICO;
