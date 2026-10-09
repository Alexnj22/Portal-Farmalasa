// «De dónde sale» la meta de una sala, NATIVO — `ExplicacionMeta` del portal:
// el ritmo diario de los últimos tres meses, por los días del mes, por el
// factor que corresponde a cómo cerró el último. Se pide al abrirla
// (`explicar_meta_propuesta`), no antes: casi nadie la abre.
import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { explicarMetaPropuesta } from '@nucleo/data/metas';
import { ymLabelCorto } from '@nucleo/utils/metasUtils';
import { formatMoney, formatPct } from '@nucleo/utils/formatNumber';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import Tocable from '../Tocable';

function Paso({ n, titulo, monto, children }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '800', width: 12 }}>{n}</Text>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 }}>{titulo}</Text>
          <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{monto}</Text>
        </View>
        {children}
      </View>
    </View>
  );
}

export default function Explicacion({ branchId, yearMonth, montoPropuesto }) {
  const [abierto, setAbierto] = useState(false);
  const [d, setD] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(false);
  const alternar = () => {
    Haptics.selectionAsync().catch(() => {});
    const nuevo = !abierto;
    setAbierto(nuevo);
    if (nuevo && !d && !cargando) {
      setCargando(true);
      explicarMetaPropuesta({ branchId, yearMonth })
        .then((x) => { setD(x); setCargando(false); })
        .catch(() => { setError(true); setCargando(false); });
    }
  };
  const nota = (t) => <Text style={{ color: colorSistema.texto2, fontSize: 13, lineHeight: 18 }}>{t}</Text>;
  const coincide = d != null && montoPropuesto != null && Math.abs(Number(d.recalculada) - Number(montoPropuesto)) < 0.01;
  const proyectado = (d?.meses_base || []).find((m) => m.proyectado);

  return (
    <Vidrio radio={20}>
      <View style={{ padding: 14, gap: 12 }}>
        <Tocable onPress={alternar} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 32 }}>
          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>De dónde sale la meta</Text>
          <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>{abierto ? 'Ocultar' : 'Ver'}</Text>
        </Tocable>
        {abierto && cargando ? <ActivityIndicator /> : null}
        {abierto && error ? nota('No se pudo traer el detalle del cálculo.') : null}
        {abierto && d ? (
          <View style={{ gap: 12 }}>
            <Paso n="1" titulo="Su ritmo diario" monto={`${formatMoney(d.ritmo_dia)}/día`}>
              {nota((d.meses_base || []).map((m) => `${ymLabelCorto(m.ym)} ${formatMoney(m.venta)}${m.proyectado ? ' (proy.)' : ''}`).join(' · '))}
              {nota(`${formatMoney(d.suma_venta)} entre los ${d.suma_dias} días de esos tres meses. Se divide por días y no por meses, para que uno de 30 y uno de 31 no pesen distinto.`)}
              {proyectado ? nota(`${ymLabelCorto(proyectado.ym)} todavía no cierra: entra con lo que lleva vendido llevado a mes completo.`) : null}
            </Paso>
            <Paso n="2" titulo={`Por los ${d.dias_mes} días del mes`} monto={formatMoney(d.sub_ritmo)}>
              {nota('Lo que vendería el mes si mantuviera exactamente ese ritmo.')}
            </Paso>
            <Paso n="3" titulo={`Por el factor ${Number(d.factor).toFixed(2)}`} monto={formatMoney(d.recalculada)}>
              {d.pct_ultimo != null
                ? nota(`${d.ultimo_proyectado ? 'Viene cerrando' : 'Cerró'} ${ymLabelCorto(d.ym_ultimo)} en ${formatPct(d.pct_ultimo)}${d.meta_ultimo != null ? ` de su meta de ${formatMoney(d.meta_ultimo)}` : ''}.`)
                : nota(`Ese mes no tuvo meta, así que el factor queda en ${Number(d.factor).toFixed(2)}: no se pide crecimiento sobre algo que no se pudo medir.`)}
              <View style={{ gap: 2, marginTop: 4 }}>
                {(d.tramos || []).map((t, i, arr) => {
                  const suyo = d.pct_ultimo != null && Number(t.factor) === Number(d.factor);
                  const hasta = i === 0 ? null : Number(arr[i - 1].desde) - 0.01;
                  const rango = i === 0 ? `≥ ${t.desde}%` : Number(t.desde) === 0 ? `< ${hasta + 0.01}%` : `${t.desde}% – ${hasta}%`;
                  return (
                    <View key={t.desde} style={{ flexDirection: 'row', maxWidth: 220 }}>
                      <Text style={{ flex: 1, color: suyo ? colorSistema.texto : colorSistema.texto2, fontSize: 13, fontWeight: suyo ? '800' : '400' }}>{rango}</Text>
                      <Text style={{ color: suyo ? colorSistema.texto : colorSistema.texto2, fontSize: 13, fontWeight: suyo ? '800' : '400', fontVariant: ['tabular-nums'] }}>{Number(t.factor).toFixed(2)}</Text>
                    </View>
                  );
                })}
              </View>
              {nota('A la sala que se quedó corta se le pide crecer más, para que recupere terreno. A la que va bien se le pide sostenerse.')}
            </Paso>
            {montoPropuesto != null ? (
              coincide
                ? <Text style={{ color: MARCA.verde, fontSize: 13, fontWeight: '700' }}>{`= ${formatMoney(d.recalculada)} — el mismo monto de la meta.`}</Text>
                : d.ultimo_proyectado
                  ? nota(`Hoy la cuenta da ${formatMoney(d.recalculada)}: la propuesta se guardó en ${formatMoney(montoPropuesto)} y ${ymLabelCorto(d.ym_ultimo)} siguió vendiendo. Manda la guardada.`)
                  : <Text style={{ color: MARCA.ambar, fontSize: 13, fontWeight: '600' }}>{`Con la fórmula de hoy da ${formatMoney(d.recalculada)} y la propuesta guardada es ${formatMoney(montoPropuesto)}. Manda la guardada.`}</Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </Vidrio>
  );
}
