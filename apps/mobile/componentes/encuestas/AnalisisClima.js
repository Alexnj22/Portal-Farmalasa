// El análisis de la encuesta de clima, NATIVO — las pestañas Resumen,
// Segmentos e Individuos de `EncuestaView`. Las cuentas salen del núcleo
// (`climaLaboral`), las mismas del portal; acá sólo se dibujan, y las barras
// de puntaje usan la `Grafica` de Metas (react-native-svg, con el mismo gesto).
//
// Si la encuesta es anónima, Individuos no muestra nombres (como Encuestas).
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  CANALES_DE_INCONFORMIDAD, IDX_INCONFORMIDADES, IDX_RAZONES, RANGOS_DE_AUTOCALIFICACION, RAZONES_DE_PERMANENCIA,
  autocalificacion, conteoDeOpciones, filasPorSucursal, indiceDeAutocalificacion, leerAutocalificacion, nivelDePuntaje, puntajeDeBloque,
} from '@nucleo/utils/climaLaboral';
import Grafica, { BarraDePartes } from '../metas/Graficas';
import { Seccion } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Kpi, { FilaDeKpis } from '../inicio/Kpi';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import { colorDeVariante } from '../colorDeVariante';

const COLOR_ABCD = { A: MARCA.verde, B: MARCA.azulClaro, C: MARCA.ambar, D: MARCA.rojo };
const redondo = (v) => (v == null ? '—' : String(Math.round(v)));
const colorDe = (v) => (v == null ? colorSistema.texto2 : colorDeVariante(nivelDePuntaje(v).severidad));
// El rótulo de un bloque en el eje: corto, para que quepan todos.
const corto = (t) => (String(t || '').length > 9 ? `${String(t).slice(0, 8)}…` : String(t || ''));

function Reparto({ conteo, opciones }) {
  const total = Object.values(conteo).reduce((s, n) => s + n, 0);
  if (!total) return <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin respuestas.</Text>;
  return (
    <BarraDePartes total={total} partes={opciones.filter((o) => conteo[o.k]).map((o) => ({
      clave: o.k, rotulo: o.label, valor: conteo[o.k], pct: Math.round((conteo[o.k] / total) * 100), color: COLOR_ABCD[o.k],
    }))} />
  );
}

function GraficaDeBloques({ bloques, series, alto = 190 }) {
  return (
    <Grafica alto={alto} dominio={[0, 100]} datos={bloques} series={series}
      formato={(v, s) => `${s.rotulo}: ${redondo(v)}`} detalle={(f) => f.titulo}
      referencias={[{ valor: 70, color: MARCA.azulClaro, rotulo: 'Bueno' }, { valor: 85, color: MARCA.verde, rotulo: 'Excelente' }]} />
  );
}

export function Resumen({ filas, bloques, preguntas, inv }) {
  const jefes = filas.filter((r) => r.isJefe).length;
  const sucursales = new Set(filas.map((r) => r.sucursal)).size;
  const idxAuto = indiceDeAutocalificacion(preguntas);
  const auto = useMemo(() => autocalificacion(filas, idxAuto), [filas, idxAuto]);
  const datos = useMemo(() => bloques.map((b) => ({ etiqueta: corto(b.nombre), titulo: b.nombre, puntaje: puntajeDeBloque(filas, b.indices, inv) ?? 0 })), [bloques, filas, inv]);
  return (
    <View style={{ gap: 12 }}>
      <FilaDeKpis>
        <Kpi icono="Users" rotulo="Participantes" valor={String(filas.length)} color={MARCA.azul} apoyo={`${jefes} jefe${jefes === 1 ? '' : 's'} · ${filas.length - jefes} empleados`} />
        <Kpi icono="Building2" rotulo="Sucursales" valor={String(sucursales)} color={MARCA.verde} apoyo="representadas" />
      </FilaDeKpis>
      <View style={{ marginHorizontal: 16, gap: 12 }}>
        <Seccion titulo="Puntaje por bloque">
          <GraficaDeBloques bloques={datos} series={[{ clave: 'puntaje', rotulo: 'Puntaje', color: MARCA.azul, tipo: 'barra' }]} />
        </Seccion>
        <Seccion titulo="¿Por qué se quedan?">
          <Reparto conteo={conteoDeOpciones(filas, IDX_RAZONES)} opciones={RAZONES_DE_PERMANENCIA} />
        </Seccion>
        <Seccion titulo={`Autocalificación${auto.promedio != null ? ` · promedio ${auto.promedio.toFixed(1)} / 10` : ''}`}>
          <Reparto conteo={auto.dist} opciones={RANGOS_DE_AUTOCALIFICACION} />
        </Seccion>
        <Seccion titulo="¿Con quién comunican las inconformidades?">
          <Reparto conteo={conteoDeOpciones(filas, IDX_INCONFORMIDADES)} opciones={CANALES_DE_INCONFORMIDAD} />
        </Seccion>
      </View>
    </View>
  );
}

export function Segmentos({ filas, bloques, inv }) {
  const jefes = useMemo(() => filas.filter((r) => r.isJefe), [filas]);
  const colabs = useMemo(() => filas.filter((r) => !r.isJefe), [filas]);
  const todos = useMemo(() => bloques.flatMap((b) => b.indices || []), [bloques]);
  const datos = useMemo(() => bloques.map((b) => ({
    etiqueta: corto(b.nombre), titulo: b.nombre,
    jefes: puntajeDeBloque(jefes, b.indices, inv) ?? 0, colabs: puntajeDeBloque(colabs, b.indices, inv) ?? 0,
  })), [bloques, jefes, colabs, inv]);
  const porSala = useMemo(() => filasPorSucursal(filas), [filas]);
  return (
    <View style={{ marginHorizontal: 16, gap: 12 }}>
      <Seccion titulo={`Jefes (${jefes.length}) contra empleados (${colabs.length})`}>
        <GraficaDeBloques bloques={datos} series={[
          { clave: 'jefes', rotulo: 'Jefes', color: MARCA.ambar, tipo: 'barra' },
          { clave: 'colabs', rotulo: 'Empleados', color: MARCA.azul, tipo: 'barra' },
        ]} />
        {datos.map((d) => {
          const brecha = Math.round(d.jefes - d.colabs);
          return (
            <View key={d.titulo} style={{ flexDirection: 'row', gap: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, paddingTop: 6 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }}>{d.titulo}</Text>
              <Text style={{ width: 34, textAlign: 'right', color: colorDe(d.jefes), fontSize: 14, fontWeight: '700' }}>{redondo(d.jefes)}</Text>
              <Text style={{ width: 34, textAlign: 'right', color: colorDe(d.colabs), fontSize: 14, fontWeight: '700' }}>{redondo(d.colabs)}</Text>
              <Text style={{ width: 40, textAlign: 'right', color: Math.abs(brecha) >= 15 ? MARCA.rojo : colorSistema.texto2, fontSize: 13 }}>{`${brecha > 0 ? '+' : ''}${brecha}`}</Text>
            </View>
          );
        })}
        <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Jefes · Empleados · brecha. Una brecha de 15 o más va en rojo.</Text>
      </Seccion>
      <Seccion titulo="Por sucursal">
        {porSala.map(([sala, rows]) => {
          const s = puntajeDeBloque(rows, todos, inv);
          return (
            <View key={sala} style={{ gap: 4, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, paddingTop: 6 }}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{sala}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${rows.length} resp.`}</Text>
                <Text style={{ color: colorDe(s), fontSize: 16, fontWeight: '800' }}>{redondo(s)}</Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {bloques.map((b) => {
                  const v = puntajeDeBloque(rows, b.indices, inv);
                  return <Pildora key={b.id} texto={`${corto(b.nombre)} ${redondo(v)}`} color={colorDe(v)} />;
                })}
              </View>
            </View>
          );
        })}
      </Seccion>
    </View>
  );
}

export function Individuos({ filas, bloques, preguntas, inv, anonima }) {
  const [rol, setRol] = useState('todos');
  const [abierta, setAbierta] = useState(null);
  const todos = useMemo(() => bloques.flatMap((b) => b.indices || []), [bloques]);
  const idxAuto = indiceDeAutocalificacion(preguntas);
  const visibles = rol === 'jefe' ? filas.filter((r) => r.isJefe) : rol === 'colab' ? filas.filter((r) => !r.isJefe) : filas;
  const porSala = filasPorSucursal(visibles);
  let n = 0;
  return (
    <View style={{ marginHorizontal: 16, gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[{ id: 'todos', label: 'Todos' }, { id: 'jefe', label: 'Solo jefes' }, { id: 'colab', label: 'Solo empleados' }].map((o) => (
          <Pressable key={o.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setRol(o.id); }}
            style={{ paddingHorizontal: 14, minHeight: 36, justifyContent: 'center', borderRadius: 999, backgroundColor: rol === o.id ? MARCA.azul : 'rgba(127,127,127,0.18)' }}>
            <Text style={{ color: rol === o.id ? '#fff' : colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
      {porSala.map(([sala, rows]) => (
        <Seccion key={sala} titulo={`${sala} · ${rows.length}`}>
          {rows.map((row) => {
            n += 1;
            const clave = `${sala}-${n}`;
            const global = puntajeDeBloque([row], todos, inv);
            const auto = leerAutocalificacion(row.r?.[idxAuto]);
            const esta = abierta === clave;
            return (
              <Pressable key={clave} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierta(esta ? null : clave); }}>
                <Vidrio radio={14} interactivo>
                  <View style={{ padding: 10, gap: 6 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{anonima ? `Respuesta ${n}` : row.nombre || '—'}</Text>
                      <Pildora texto={row.isJefe ? 'Jefe/a' : 'Colab.'} color={row.isJefe ? MARCA.ambar : colorSistema.texto2} />
                      <Text style={{ color: colorDe(global), fontSize: 17, fontWeight: '800', minWidth: 30, textAlign: 'right' }}>{redondo(global)}</Text>
                    </View>
                    {auto ? <Text style={{ color: COLOR_ABCD[auto.rango], fontSize: 12 }}>{`Se califica: ${Number.isInteger(auto.numero) ? `${auto.numero} / 10` : RANGOS_DE_AUTOCALIFICACION.find((r) => r.k === auto.rango)?.label}`}</Text> : null}
                    {esta ? bloques.map((b) => {
                      const v = puntajeDeBloque([row], b.indices, inv);
                      return (
                        <View key={b.id} style={{ flexDirection: 'row', gap: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, paddingTop: 4 }}>
                          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 13 }}>{b.nombre}</Text>
                          <Text style={{ color: colorDe(v), fontSize: 13, fontWeight: '700' }}>{redondo(v)}</Text>
                        </View>
                      );
                    }) : null}
                  </View>
                </Vidrio>
              </Pressable>
            );
          })}
        </Seccion>
      ))}
      {!visibles.length ? <Text style={{ color: colorSistema.texto2, fontSize: 14, textAlign: 'center' }}>Nadie en este grupo.</Text> : null}
    </View>
  );
}
