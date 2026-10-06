// «Cómo va el mes» de una sala o de la red, NATIVO — `GraficaMes` y
// `RankingVendedores` del portal, con las mismas cuentas (núcleo:
// `resumenDelMesEnCurso` y `rankingDeVendedores`).
//
//   · Día por día: una barra por día hasta hoy (hoy más clara, todavía no
//     termina) contra la raya del ritmo que hay que vender cada día para
//     llegar justo a fin de mes. Lo que falta del mes se DICE, no se dibuja.
//   · Termómetro: lo vendido, la proyección como sombra y las marcas del 95% y
//     el 100%; abajo, cuánto falta por día para llegar.
//   · El ranking: foto y nombre corto, la barra contra el más alto con la marca
//     del promedio, y «bajo / sobre el promedio» dicho con palabras.
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useStaffStore } from '@nucleo/store/staffStore';
import { ORDENES_RANKING, SUFIJO_RANKING, TRAMO_CFG, rankingDeVendedores, resumenDelMesEnCurso } from '@nucleo/utils/metasUtils';
import { formatMoney, formatMoneyCorto, formatPct } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import Segmentos from '../Segmentos';
import Avatar from '../Avatar';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import Grafica, { Termometro } from './Graficas';

export const COLOR_TRAMO = { completo: MARCA.verde, medio: MARCA.ambar, nada: MARCA.rojo };

const Titulo = ({ children }) => (
  <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' }}>{children}</Text>
);

export function GraficaDelMes({ data }) {
  const r = useMemo(() => resumenDelMesEnCurso(data), [data]);
  // Con días que dibujar se ofrecen las dos vistas; sin ellos, el termómetro.
  const hayDias = r.dias.some((d) => d.venta != null);
  const [vista, setVista] = useState(hayDias ? 'dias' : 'termo');
  const vistaReal = hayDias ? vista : 'termo';
  const datos = r.dias.map((d) => ({ etiqueta: String(d.dia), titulo: d.esHoy ? `Día ${d.dia} · hoy, todavía no termina` : `Día ${d.dia}`, venta: d.venta, tenue: d.esHoy }));
  const color = COLOR_TRAMO[r.tramoProy] ?? MARCA.azul;

  return (
    <Vidrio radio={20}>
      <View style={{ padding: 14, gap: 10 }}>
        <View style={{ gap: 2 }}>
          <Titulo>{`${data?.sala ?? 'La sala'} · este mes`}</Titulo>
          <Text style={{ color: colorSistema.texto, fontSize: 14 }}>
            {vistaReal === 'dias'
              ? <><Text style={{ fontWeight: '800' }}>{`${r.sobreRitmo} de ${r.cerrados}`}</Text> días cerrados por encima del ritmo</>
              : `Día ${data?.dia_hoy} de ${data?.dias_mes} · faltan ${formatMoney(Math.max(0, r.falta))}`}
          </Text>
        </View>
        {hayDias ? <Segmentos margen={0} activa={vistaReal} onCambiar={setVista} opciones={[{ id: 'dias', label: 'Día por día' }, { id: 'termo', label: 'Termómetro' }]} /> : null}
        {vistaReal === 'dias' ? (
          <>
            <Grafica datos={datos} series={[{ clave: 'venta', rotulo: 'Vendido', color: MARCA.azulClaro, tipo: 'barra' }]}
              formato={(v) => formatMoney(v)} formatoEje={(v) => (v ? formatMoneyCorto(v) : '0')}
              referencias={r.ritmo > 0 ? [{ valor: r.ritmo, color: '#8E8E93', rotulo: `ritmo ${formatMoneyCorto(r.ritmo)}` }] : []}
              detalle={(f) => (f.venta == null ? null : f.venta >= r.ritmo ? 'Por encima del ritmo' : `Le faltaron ${formatMoney(r.ritmo - f.venta)} para el ritmo`)}
              resumen={(
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 26, fontWeight: '800' }}>{formatMoney(r.acum)}</Text>
                  {r.pct != null ? <Text style={{ color, fontSize: 16, fontWeight: '800' }}>{formatPct(r.pct)}</Text> : null}
                  {r.meta > 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`de ${formatMoney(r.meta)}`}</Text> : null}
                </View>
              )} />
            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
              {`El día de hoy va más claro porque todavía no termina.${r.porVenir > 0 ? ` Quedan ${r.porVenir} día${r.porVenir === 1 ? '' : 's'} del mes.` : ''}`}
            </Text>
          </>
        ) : (
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <Text style={{ color: colorSistema.texto, fontSize: 30, fontWeight: '800' }}>{formatMoney(r.acum)}</Text>
              {r.pct != null ? <Text style={{ color, fontSize: 17, fontWeight: '800' }}>{formatPct(r.pct)}</Text> : null}
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`de ${formatMoney(r.meta)}`}</Text>
            </View>
            <Termometro pct={r.pct} pctProyectado={r.pctProy} color={color} umbralMedio={r.umbralMedio} umbralTotal={r.umbralTotal} />
            {r.proy != null ? (
              <Text style={{ color: colorSistema.texto, fontSize: 14 }}>
                Cierra en <Text style={{ fontWeight: '800' }}>{formatMoney(r.proy)}</Text>{' → '}
                <Text style={{ fontWeight: '800', color }}>{formatPct(r.pctProy)}</Text>
                {r.porDiaParaLlegar != null ? <Text style={{ color: colorSistema.texto2 }}>{` · faltan ${formatMoney(r.falta)} en ${r.diasRestantes} día${r.diasRestantes === 1 ? '' : 's'} — ${formatMoney(r.porDiaParaLlegar)} por día`}</Text> : null}
              </Text>
            ) : null}
            {r.tramoProy ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Al ritmo de hoy: ${TRAMO_CFG[r.tramoProy]?.sinBono?.toLowerCase()}.`}</Text> : null}
          </View>
        )}
      </View>
    </Vidrio>
  );
}

const horasCortas = (h) => Number(Number(h).toFixed(1));

export function Ranking({ data, limite }) {
  const [orden, setOrden] = useState('total');
  const empleados = useStaffStore((s) => s.employees);
  const r = useMemo(() => rankingDeVendedores(data, orden), [data, orden]);
  const porId = useMemo(() => new Map((empleados || []).map((e) => [String(e.id), e])), [empleados]);
  if (!r.filas.length) {
    return (
      <Vidrio radio={20}>
        <View style={{ padding: 16 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>Sin ventas este mes</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Cuando alguien registre una venta, aparece aquí con su puesto.</Text>
        </View>
      </Vidrio>
    );
  }
  const sufijo = SUFIJO_RANKING[r.ordenActivo];
  const filas = limite ? r.filas.slice(0, limite) : r.filas;
  const opciones = ORDENES_RANKING.filter((o) => o.value !== 'hora' || r.horaDisponible).map((o) => ({ id: o.value, label: o.label }));
  return (
    <Vidrio radio={20}>
      <View style={{ padding: 14, gap: 10 }}>
        <View style={{ gap: 2 }}>
          <Titulo>{`Venta por vendedor · ${data?.sala ?? ''}`}</Titulo>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
            {`${r.filas.length} persona${r.filas.length === 1 ? '' : 's'} · promedio ${formatMoney(r.promedio)}${sufijo}${data?.promedio_ticket != null ? ` · ticket de la sala ${formatMoney(data.promedio_ticket)}` : ''}`}
          </Text>
        </View>
        {opciones.length > 1 ? <Segmentos margen={0} activa={r.ordenActivo} onCambiar={setOrden} opciones={opciones} /> : null}
        {!r.horaDisponible ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>«Por hora» aparece cuando todas las personas tienen horario.</Text> : null}
        {filas.map((v, i) => {
          const valor = v[r.clave];
          const bajo = valor < r.promedio;
          const top = i < 2;
          const ancho = r.maximo > 0 ? Math.max(2, (valor / r.maximo) * 100) : 0;
          const marca = r.maximo > 0 ? Math.min(100, (r.promedio / r.maximo) * 100) : 0;
          const persona = porId.get(String(v.employee_id)) ?? { id: v.employee_id, name: v.nombre };
          const tono = top ? MARCA.azulClaro : bajo ? MARCA.rojo : colorSistema.texto2;
          return (
            <View key={`${v.employee_id}-${v.sala}`} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 6, paddingHorizontal: 6, borderRadius: 14, backgroundColor: top ? 'rgba(59,130,246,0.10)' : bajo ? 'rgba(240,68,56,0.07)' : 'transparent' }}>
              <Text style={{ width: 24, textAlign: 'center', color: tono, fontSize: 13, fontWeight: '800' }}>{`${i + 1}º`}</Text>
              <Avatar empleado={persona} tamano={34} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={{ color: bajo ? MARCA.rojo : colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>
                  {shortEmployeeName(persona)}
                  {data?.todas && v.sala ? <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '500' }}>{` · ${v.sala}`}</Text> : null}
                </Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                  {`${v.tickets} tickets · ${formatMoney(v.ticket)} c/u · `}
                  <Text style={v.dias <= 1 ? { color: MARCA.ambar, fontWeight: '800' } : null}>{`${v.dias} día${v.dias === 1 ? '' : 's'}`}</Text>
                  {r.ordenActivo === 'hora' ? ` · ${horasCortas(v.horas)} h${v.dias_horario !== v.dias ? ` en ${v.dias_horario}` : ''}` : ` · ${formatMoney(v.venta_dia)}/día`}
                </Text>
                {v.sala_ajena || v.dias_sin_turno > 0 ? (
                  <Text style={{ color: MARCA.ambar, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' }}>
                    {[v.sala_ajena ? 'No es su sala' : null, v.dias_sin_turno > 0 ? `${v.dias_sin_turno} día${v.dias_sin_turno === 1 ? '' : 's'} sin turno` : null].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
                <View style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(127,127,127,0.15)', marginTop: 2 }}>
                  <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${ancho}%`, borderRadius: 3, backgroundColor: top ? MARCA.azulClaro : bajo ? MARCA.rojo : 'rgba(127,127,127,0.55)' }} />
                  <View style={{ position: 'absolute', left: `${marca}%`, top: -3, bottom: -3, width: 2, borderRadius: 1, backgroundColor: colorSistema.texto }} />
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: bajo ? MARCA.rojo : colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(valor)}</Text>
                <Text style={{ color: bajo ? MARCA.rojo : MARCA.verde, fontSize: 10, fontWeight: '800', textTransform: 'uppercase' }}>{bajo ? 'bajo el promedio' : 'sobre el promedio'}</Text>
              </View>
            </View>
          );
        })}
        <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
          La raya de cada barra es el promedio. Quien trabajó un solo día lo lleva anotado: un total bajo con pocos días no es lo mismo que un total bajo con el mes entero.
        </Text>
      </View>
    </Vidrio>
  );
}
