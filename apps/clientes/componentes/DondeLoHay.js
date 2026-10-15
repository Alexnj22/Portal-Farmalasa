// «¿Dónde lo hay y está abierta?» (2026-10-15). En la ficha del producto, cada
// sucursal junta tres cosas: si alcanza para LO QUE SE PIDE (presentación ×
// cantidad), si está abierta ahora con su hora de cierre, y a cuánto queda.
// Primero las que tienen suficiente Y están abiertas; después, por distancia.
//
// Cuánto alcanza lo cuenta el servidor en UNIDADES (`alcance`, por factor de
// presentación y con tope en 5): una caja de 100 no la cubren 40 sueltas.
// Como en el resto de la app, nunca se muestra la existencia exacta: sólo
// «Tiene suficiente», «Tiene 2 de las 4 que pides» o «Agotado».
//
// La ubicación sigue las reglas de lib/cercania: se usa si ya dio el permiso,
// y si no, sólo cuando toca «Ordenar por cercanía». No sale del teléfono.
//
// `estadoDeAlcance` es la MISMA regla para la hoja de reservar y el carrito:
// si cada pantalla la escribiera, una diría «suficiente» y otra «no alcanza».
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Presionable from './Presionable';
import Icono from './Icono';
import { colorSistema } from './sistema';
import { llamar } from '../lib/api';
import { copiaParaEmpezar } from '../lib/sinConexion';
import { distanciaKm, textoDistancia, useUbicacionMientrasSeUsa } from '../lib/cercania';
import { suave, useTema } from '../tema/tema';

/**
 * Qué puede cubrir una sala de lo que se pide.
 *  - `alcance`: cuántas de esa presentación alcanzan (0–5), o null si el
 *    servidor no lo mandó (versión vieja): entonces decide `hayAlgo`/`nivel`.
 *  - `hayAlgo`: si tiene existencia de ese producto.
 * Devuelve { clave: 'suficiente' | 'parcial' | 'corto' | 'agotado', texto, sf, tono }.
 */
export function estadoDeAlcance({ alcance, hayAlgo, nivel, cantidad }) {
  const n = Math.max(1, Number(cantidad) || 1);
  if (!hayAlgo) return { clave: 'agotado', texto: 'Agotado', sf: 'xmark.circle', tono: 'neutro' };
  if (alcance == null) {
    // Sin la cuenta por cantidad: lo de antes («Disponible» / «Pocas unidades»).
    return nivel === 'pocas' ? { clave: 'suficiente', texto: 'Pocas unidades', sf: 'exclamationmark.circle.fill', tono: 'aviso' }
      : { clave: 'suficiente', texto: 'Disponible', sf: 'checkmark.circle.fill', tono: 'exito' };
  }
  if (alcance >= n) return { clave: 'suficiente', texto: 'Tiene suficiente', sf: 'checkmark.circle.fill', tono: 'exito' };
  if (alcance > 0) return { clave: 'parcial', texto: `Tiene ${alcance} de las ${n} que pides`, sf: 'circle.lefthalf.filled', tono: 'aviso' };
  // Tiene algo, pero no completa ni una de la presentación elegida (p. ej.
  // unidades sueltas de una caja de 100).
  return { clave: 'corto', texto: n === 1 ? 'No completa esta presentación' : `No completa las ${n} que pides`, sf: 'circle.lefthalf.filled', tono: 'aviso' };
}

/** El color del texto de cada tono, del tema. */
export const colorDeTono = (t, tono) => ({ exito: t.color.exitoTexto, aviso: t.color.avisoTexto, neutro: colorSistema.texto3 }[tono] ?? colorSistema.texto3);
/** El fondo de la pastilla de cada tono. */
export const fondoDeTono = (t, tono) => ({
  exito: suave(t.color.verde, t.oscuro ? 0.24 : 0.14),
  aviso: 'rgba(255,159,10,0.18)',
  neutro: t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(120,110,130,0.12)',
}[tono]);

const hora12 = (h) => {
  const m = String(h ?? '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const n = Number(m[1]);
  return `${n % 12 || 12}:${m[2]} ${n < 12 ? 'a. m.' : 'p. m.'}`;
};
const minutos = (h) => { const m = String(h ?? '').match(/(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** «Abierta · cierra a las 8:00 p. m.» / «Cerrada · abre a las 7:00 a. m.» / «Cerrada por hoy». */
export function textoHorario(h) {
  if (!h) return null;
  if (h.abierta) return `Abierta · cierra a las ${hora12(h.cierra_hoy)}`;
  const sv = new Date(Date.now() - 6 * 3600_000);
  const ahora = sv.getUTCHours() * 60 + sv.getUTCMinutes();
  const abre = minutos(h.abre_hoy);
  return abre != null && ahora < abre ? `Cerrada · abre a las ${hora12(h.abre_hoy)}` : 'Cerrada por hoy';
}

// El orden: suficiente y abierta → suficiente → algo y abierta → algo → agotado.
const RANGO = { suficiente: 0, parcial: 2, corto: 2, agotado: 4 };

/**
 * La lista de la ficha. `existencias` son las de `catalogo_producto`
 * ({ branch_id, nivel, alcance: { [factor]: n } }) y `salas` las farmacias
 * ({ id, sala }). `factor` y `cantidad` son lo elegido abajo en la ficha.
 */
export default function DondeLoHay({ existencias, salas, factor, cantidad, tipo, superficie }) {
  const t = useTema();
  const ubicacion = useUbicacionMientrasSeUsa();
  const [horario, setHorario] = useState(null);
  // El horario de hoy de cada sala (pública; lo de la vez anterior al instante).
  useEffect(() => {
    let vivo = true;
    copiaParaEmpezar('salas', {}).then((c) => { if (vivo && c?.ok) setHorario((a) => a ?? c.salas); });
    llamar('salas').then((r) => { if (vivo && r?.ok) setHorario(r.salas); });
    return () => { vivo = false; };
  }, []);

  const filas = useMemo(() => {
    const ex = new Map((existencias ?? []).map((e) => [Number(e.branch_id), e]));
    const hs = new Map((horario ?? []).map((h) => [Number(h.id), h]));
    return (salas ?? []).map((s) => {
      const e = ex.get(Number(s.id));
      const h = hs.get(Number(s.id)) ?? null;
      const alcance = e?.alcance ? (e.alcance[String(factor)] ?? e.alcance[factor] ?? null) : null;
      const estado = estadoDeAlcance({ alcance, hayAlgo: !!e, nivel: e?.nivel, cantidad });
      const km = distanciaKm(ubicacion.posicion, h);
      const rango = RANGO[estado.clave] + (estado.clave !== 'agotado' && !h?.abierta ? 1 : 0);
      return { ...s, h, estado, km, rango };
    }).sort((a, b) => a.rango - b.rango || (a.km ?? Infinity) - (b.km ?? Infinity) || String(a.sala).localeCompare(String(b.sala)));
  }, [existencias, salas, horario, factor, cantidad, ubicacion.posicion]);

  const listas = filas.filter((f) => f.estado.clave === 'suficiente' && f.h?.abierta).length;
  const n = Math.max(1, Number(cantidad) || 1);

  return (
    <View style={{ gap: 8 }}>
      {/* Para qué se cuenta: lo elegido abajo. Cambia al tocar la presentación o «+». */}
      <View style={{ marginHorizontal: 32, flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>
          Para {n} × {tipo || 'Unidad'}
          {horario ? ` · ${listas ? `${listas === 1 ? '1 abierta ahora lo tiene' : `${listas} abiertas ahora lo tienen`}` : 'ninguna abierta ahora lo tiene completo'}` : ''}
        </Text>
      </View>
      {ubicacion.puedePedir && !ubicacion.posicion ? (
        <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); ubicacion.pedir(); }} disabled={ubicacion.buscando}
          accessibilityRole="button" accessibilityLabel="Ordenar las sucursales por cercanía"
          style={({ pressed }) => ({ alignSelf: 'flex-start', marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44,
            paddingHorizontal: 16, borderRadius: 22, opacity: ubicacion.buscando ? 0.6 : 1,
            backgroundColor: suave(t.color.magenta, pressed ? (t.oscuro ? 0.4 : 0.24) : (t.oscuro ? 0.26 : 0.13)) })}>
          <Icono sf="location.fill" respaldo="📍" tam={15} color={t.color.magentaTexto} />
          <Text style={{ fontSize: 15, fontWeight: '700', color: t.color.magentaTexto }}>{ubicacion.buscando ? 'Buscando dónde estás…' : 'Ordenar por cercanía'}</Text>
        </Presionable>
      ) : null}
      <View style={{ marginHorizontal: 16, borderRadius: 20, backgroundColor: superficie, overflow: 'hidden' }}>
        {filas.map((s, i) => {
          const e = s.estado;
          const horarioTxt = textoHorario(s.h);
          return (
            <View key={s.id} accessible accessibilityLabel={`${s.sala}. ${e.texto}.${horarioTxt ? ` ${horarioTxt}.` : ''}${s.km != null ? ` ${textoDistancia(s.km)}.` : ''}`}>
              {i > 0 ? <View style={{ height: 0.5, backgroundColor: colorSistema.separador, marginLeft: 16 }} /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, minHeight: 56,
                opacity: e.clave === 'agotado' ? 0.7 : 1 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: 15, fontWeight: '600', color: colorSistema.texto }} numberOfLines={1}>{s.sala}</Text>
                  {horarioTxt || s.km != null ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      {s.h ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: s.h.abierta ? '#34C759' : '#FF453A' }} /> : null}
                      <Text style={{ flexShrink: 1, fontSize: 13, color: colorSistema.texto2 }} numberOfLines={1}>
                        {[horarioTxt, s.km != null ? textoDistancia(s.km) : null].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '52%', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
                  backgroundColor: fondoDeTono(t, e.tono) }}>
                  <Icono sf={e.sf} respaldo="" tam={12} color={colorDeTono(t, e.tono)} />
                  <Text style={{ flexShrink: 1, fontSize: 12, fontWeight: '700', color: colorDeTono(t, e.tono) }}>{e.texto}</Text>
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}
