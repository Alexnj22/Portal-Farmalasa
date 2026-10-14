// Lo que el widget de la pantalla de inicio muestra (targets/saldo): la app lo
// deja en el App Group cada vez que carga el resumen, y le pide al sistema que
// lo vuelva a dibujar. Al cerrar sesión se borra, para que el widget no siga
// mostrando el saldo de la persona anterior en un teléfono compartido.
//
// En Android (2026-10-08) el mismo JSON va al widget nativo de
// modules/widget-saldo (preferencias de la app en vez de App Group).
import { Platform } from 'react-native';
import { borrarWidget, guardarEnWidget } from '../modules/widget-saldo';

const GRUPO = 'group.lat.farmasalud.clientes';
let almacen = null;
function abrir() {
  if (Platform.OS !== 'ios') return null;
  if (!almacen) {
    try {
      const { ExtensionStorage } = require('@bacons/apple-targets');
      almacen = { Clase: ExtensionStorage, grupo: new ExtensionStorage(GRUPO) };
    } catch { return null; }
  }
  return almacen;
}

// El material de la tarjeta (2026-10-14, «el widget con el material de su
// nivel, como la tarjeta»): la MISMA regla de la pantalla de Puntos — el rango
// de mayoreo aprobado manda (Jade…Diamante); si no, el nivel (Bronce…Platino;
// la clave del nivel de entrada sigue siendo 'vip'). Los widgets traen una
// imagen por material (targets/saldo/Assets.xcassets y drawable-nodpi de
// modules/widget-saldo); una clave que no conocen dibuja el degradado de
// siempre, así que mandar `null` nunca rompe nada.
const MATERIALES_WIDGET = ['bronce', 'plata', 'oro', 'platino', 'jade', 'zafiro', 'rubi', 'diamante'];
const ROTULOS = { bronce: 'BRONCE', plata: 'PLATA', oro: 'ORO', platino: 'PLATINO', jade: 'JADE', zafiro: 'ZAFIRO', rubi: 'RUBÍ', diamante: 'DIAMANTE' };
function materialDe(resumen) {
  const m = resumen.mayorista;
  const clave = m && m.estado === 'aprobado' ? (m.rango ?? 'jade')
    : resumen.nivel?.clave === 'vip' ? 'bronce' : resumen.nivel?.clave;
  return MATERIALES_WIDGET.includes(clave) ? clave : null;
}

export function publicarEnWidget(resumen) {
  const a = abrir();
  if ((!a && Platform.OS !== 'android') || !resumen || resumen.pendiente) return;
  const hoy = Date.now() - 6 * 3600_000;
  const vencen90 = (resumen.vencimientos ?? [])
    .filter((v) => { const t = Date.parse(`${v.vence}T00:00:00Z`); return t >= hoy - 86400_000 && t <= hoy + 90 * 86400_000; })
    .reduce((s, v) => s + Number(v.puntos), 0);
  const p = String(resumen.nombre ?? '').trim().split(/\s+/);
  const nombre = p.length >= 4 ? `${p[0]} ${p[2]}` : p.length === 3 ? `${p[0]} ${p[1]}` : p.join(' ');
  const material = materialDe(resumen);
  const mayoreo = ['jade', 'zafiro', 'rubi', 'diamante'].includes(material);
  const json = JSON.stringify({
    nombre, saldo: Math.round(Number(resumen.saldo ?? 0)), equivale: Number(resumen.equivale ?? 0),
    vencen90, actualizado: new Date().toISOString(),
    material, rotulo: material ? ROTULOS[material] : null, mayoreo, equipo: !!resumen.empleado,
  });
  if (Platform.OS === 'android') { guardarEnWidget(json); return; }
  try {
    a.grupo.set('resumen', json);
    a.Clase.reloadWidget();
  } catch { /* sin widget instalado o sin App Group: no es un error de la app */ }
}

export function borrarDelWidget() {
  if (Platform.OS === 'android') { borrarWidget(); return; }
  const a = abrir();
  if (!a) return;
  try { a.grupo.remove('resumen'); a.Clase.reloadWidget(); } catch { /* nada que borrar */ }
}
