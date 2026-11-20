// El resumen diario de cada sala, NATIVO — lo que Saly escribe cada mañana a
// las 5:30 (`resumen-diario-salas`) y el portal muestra en dos sitios:
//   · `LineaDeSaly`  — la línea de la tarjeta en Sucursales (`BranchesView`):
//                      lo más urgente de ayer, con el color de su ánimo.
//   · `ResumenDeSala` — la pestaña «Resumen» de la ficha (`TabResumen`): el
//                      último día con los números de donde salió (ventas,
//                      cortes, faltantes, vencimientos) y los 14 anteriores.
// Leer y el ánimo salen del núcleo (`fetchResumenDeSalas`, `animoDeSaly`), lo
// mismo del portal. El ánimo sale de las novedades, nunca de la IA.
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { animoDeSaly, fetchResumenDeSalas } from '@nucleo/data/resumenSala';
import { fechaTexto } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { Aviso, Cargando, Seccion } from '../formulario/Piezas';
import { MARCA } from '../inicio/marca';

const dinero = (v) => formatMoney(v, { decimales: 0 });
const dineroExacto = (v) => formatMoney(v);
const dia = (f, largo = false) => fechaTexto(f, largo
  ? { weekday: 'long', day: 'numeric', month: 'long' }
  : { weekday: 'short', day: 'numeric', month: 'short' });
const mayuscula = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/** El color del ánimo de Saly: preocupación, atención o alegría. */
export const colorDeAnimo = (r) => {
  const a = animoDeSaly(r);
  return a === 'preocupacion' ? MARCA.rojo : a === 'alegria' ? MARCA.verde : MARCA.ambar;
};

/** Una línea: «Saly: …», con un punto del color de su ánimo. */
export function LineaDeSaly({ resumen, lineas = 2 }) {
  if (!resumen?.texto) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}
      accessibilityLabel={`Resumen del ${fechaTexto(resumen.fecha, { day: 'numeric', month: 'long' })}: ${resumen.texto}`}>
      <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: colorDeAnimo(resumen) }} />
      <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13, lineHeight: 18 }} numberOfLines={lineas}>
        <Text style={{ color: colorSistema.texto, fontWeight: '700' }}>Saly: </Text>{resumen.texto}
      </Text>
    </View>
  );
}

function Renglones({ items, vacio, render }) {
  if (!items?.length) return <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{vacio}</Text>;
  return items.map((x, i) => <Text key={i} style={{ color: colorSistema.texto, fontSize: 14 }}>{`• ${render(x)}`}</Text>);
}

// Los números del día: de donde salió cada frase de Saly.
function Numeros({ ind }) {
  if (!ind) return null;
  const v = ind.ventas || {};
  const m = ind.meta;
  const f = ind.faltantes_a || {};
  const c = ind.cortes || {};
  const ve = ind.vencimiento || {};
  const diaSemana = fechaTexto(ind.fecha, { weekday: 'long' });
  const texto = { color: colorSistema.texto, fontSize: 14 };
  return (<>
    <Seccion titulo="Ventas">
      <Text style={texto}>
        <Text style={{ fontWeight: '800' }}>{dinero(v.dia)}</Text>
        {v.promedio != null ? ` contra ${dinero(v.promedio)} de sus últimos ${v.semanas} ${diaSemana}` : ''}
        {v.cambio_pct != null ? (
          <Text style={{ fontWeight: '700', color: v.cambio_pct < 0 ? MARCA.rojo : MARCA.verde }}>
            {` (${v.cambio_pct > 0 ? '+' : ''}${Math.round(v.cambio_pct)}%)`}
          </Text>
        ) : null}
      </Text>
      {ind.feriado ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Fue feriado (${ind.feriado}): no se compara.`}</Text> : null}
      {m ? <Text style={texto}>{`Meta del mes ${dinero(m.meta)} · lleva ${dinero(m.acumulada)} · cerraría en ${Math.round(m.pct_proyectado)}%`}</Text> : null}
    </Seccion>
    <Seccion titulo="Cortes de caja">
      <Text style={texto}>
        {c.confirmados ? `${c.confirmados} confirmados` : 'Ningún corte confirmado'}
        {Number(c.faltante) < 0 ? <Text style={{ fontWeight: '700', color: MARCA.rojo }}>{` · ${dineroExacto(Math.abs(c.faltante))} de faltante`}</Text> : null}
        {Number(c.sobrante) > 0 ? ` · ${dineroExacto(c.sobrante)} de sobrante` : ''}
      </Text>
    </Seccion>
    <Seccion titulo={`Faltan de los que más se venden · ${f.total ?? 0}`}
      pie={f.total > (f.lista?.length || 0) ? `y ${f.total - f.lista.length} más` : null}>
      <Renglones items={f.lista} vacio="No falta ninguno." render={(x) => `${x.producto} · mínimo ${x.minimo}`} />
    </Seccion>
    <Seccion titulo="Vencimientos">
      <Text style={{ color: MARCA.rojo, fontSize: 13, fontWeight: '700' }}>{`Vencidos y a la venta · ${ve.vencidos?.length ?? 0}`}</Text>
      <Renglones items={ve.vencidos} vacio="Ninguno."
        render={(x) => `${x.producto} · lote ${x.lote} · ${fechaTexto(x.vence, { month: 'short', year: 'numeric' })} · ${x.unidades} u.`} />
      <Text style={{ color: MARCA.ambar, fontSize: 13, fontWeight: '700', marginTop: 4 }}>{`Vencen en 60 días · ${ve.por_vencer?.length ?? 0}`}</Text>
      <Renglones items={ve.por_vencer} vacio="Ninguno."
        render={(x) => `${x.producto} · ${fechaTexto(x.vence, { day: 'numeric', month: 'short' })} · ${x.unidades} u.`} />
    </Seccion>
  </>);
}

/** El resumen de la sala: el último día con sus números, y los 14 anteriores. */
export function ResumenDeSala({ branchId }) {
  const [estado, setEstado] = useState({ cargando: true, resumenes: [], error: null });
  useEffect(() => {
    let vivo = true;
    fetchResumenDeSalas({ branchId, dias: 14 })
      .then(({ resumenes, error }) => { if (vivo) setEstado({ cargando: false, resumenes, error }); })
      .catch((error) => { if (vivo) setEstado({ cargando: false, resumenes: [], error }); });
    return () => { vivo = false; };
  }, [branchId]);
  const { cargando, resumenes, error } = estado;
  const [ultimo, ...anteriores] = resumenes;
  if (cargando) return <Cargando />;
  if (error) return <Aviso tono="freno" texto={mensajeAmigable(error)} />;
  if (!ultimo) {
    return <Aviso texto="Saly todavía no ha escrito nada. Cada mañana, a las 5:30, cuenta cómo le fue ayer a esta sucursal." />;
  }
  return (<>
    <Seccion titulo={mayuscula(dia(ultimo.fecha, true))}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 6, backgroundColor: colorDeAnimo(ultimo) }} />
        <Text selectable style={{ flex: 1, color: colorSistema.texto, fontSize: 15, lineHeight: 21 }}>
          <Text style={{ fontWeight: '700' }}>Saly: </Text>{ultimo.texto}
        </Text>
      </View>
    </Seccion>
    <Numeros ind={ultimo.indicadores} />
    {anteriores.length ? (
      <Seccion titulo="Días anteriores">
        {anteriores.map((r, i) => (
          <View key={r.id ?? i} style={{ gap: 2, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 8 : 0 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '700' }}>{mayuscula(dia(r.fecha))}</Text>
            <LineaDeSaly resumen={r} lineas={0} />
          </View>
        ))}
      </Seccion>
    ) : null}
  </>);
}
