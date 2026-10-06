// El día de la caja en una tarjeta — `PanelDelDia` de «Mi caja» del portal:
//   · por qué manos pasó la caja (`EntregaDelTurno`);
//   · lo VENDIDO hoy por forma de pago, con su barra;
//   · la cuenta del CAJÓN: abrió con + vendido en efectivo + ingresos − vales
//     − guardado en bolsas = total en efectivo.
// Las dos cuentas salen del núcleo (`cuentaDelCajon`) y los renglones del
// efectivo son los que sumó el servidor, no una suma rehecha acá.
//
// `veLosMontos` es el conteo a ciegas (regla del usuario, 1-sep): quien cuenta
// ese cajón no puede ver antes cuánto debería haber. Sin él quedan las formas
// de pago con su cantidad de ventas —la barra mide ventas, no dinero— y se DICE
// por qué no está el total, en vez de dejar un hueco que parece una falla.
import { Text, View } from 'react-native';
import { cuentaDelCajon, conMayuscula } from '@nucleo/utils/cajaDelDia';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import Vidrio from '../Vidrio';
import EntregaDelTurno from './EntregaDelTurno';

const titulo = { color: colorSistema.texto2, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 };

function Fila({ rotulo, monto, fuerte = false, apagado = false }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
      <Text style={{ flex: 1, color: fuerte ? colorSistema.texto : colorSistema.texto2, fontSize: 15, fontWeight: fuerte ? '800' : '500' }}>{rotulo}</Text>
      <Text style={{ color: fuerte ? MARCA.verde : apagado ? colorSistema.texto2 : colorSistema.texto, fontSize: fuerte ? 18 : 15, fontWeight: fuerte ? '800' : '600', fontVariant: ['tabular-nums'] }}>
        {formatMoney(monto)}
      </Text>
    </View>
  );
}

export default function PanelDelDia({ estado, ventas, veLosMontos, entregas, personas }) {
  const hayEntrega = (entregas || []).length > 0;
  if (!estado?.abierta && !hayEntrega) return null;
  const c = cuentaDelCajon({ estado, ventas });

  return (
    <Vidrio radio={24}>
      <View style={{ padding: 16, gap: 16 }}>
        {hayEntrega ? (
          <View style={{ paddingBottom: estado?.abierta ? 14 : 0, borderBottomWidth: estado?.abierta ? 0.5 : 0, borderBottomColor: colorSistema.separador }}>
            <EntregaDelTurno entregas={entregas} personas={personas} />
          </View>
        ) : null}

        {estado?.abierta ? (c.formas.length === 0 ? (
          <View style={{ gap: 4 }}>
            <Text style={titulo}>Vendido hoy</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>Todavía no hay ninguna venta registrada en este día.</Text>
          </View>
        ) : (
          <>
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={titulo}>Vendido hoy</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${c.docs} venta${c.docs === 1 ? '' : 's'} · por forma de pago`}</Text>
                </View>
                {veLosMontos ? <Text style={{ color: colorSistema.texto, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(c.total)}</Text> : null}
              </View>
              {c.formas.map((f) => {
                const base = veLosMontos ? c.total : c.docs;
                const parte = veLosMontos ? f.total : f.docs;
                const pct = base > 0 ? Math.max(2, Math.round((parte / base) * 100)) : 0;
                return (
                  <View key={f.tipo} style={{ gap: 5 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>
                        {conMayuscula(f.tipo)}
                        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{` · ${f.docs} venta${f.docs === 1 ? '' : 's'}`}</Text>
                      </Text>
                      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{veLosMontos ? formatMoney(f.total) : `${pct}%`}</Text>
                    </View>
                    <View style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(127,127,127,0.2)', overflow: 'hidden' }}>
                      <View style={{ width: `${pct}%`, height: '100%', borderRadius: 3, backgroundColor: MARCA.azulClaro }} />
                    </View>
                  </View>
                );
              })}
            </View>

            <View style={{ gap: 10, paddingTop: 14, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={titulo}>Efectivo en caja</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                    {!veLosMontos ? 'se cuenta al cortar' : c.puedeSumar ? 'lo que debería haber en el cajón' : 'sin la cuenta completa todavía'}
                  </Text>
                </View>
                {veLosMontos && c.puedeSumar ? <Text style={{ color: MARCA.verde, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(c.enCaja)}</Text> : null}
              </View>
              {veLosMontos ? (
                <View style={{ gap: 7, padding: 12, borderRadius: 14, backgroundColor: 'rgba(127,127,127,0.1)' }}>
                  <Fila rotulo="Con lo que abrió la caja" monto={c.apertura} apagado />
                  <Fila rotulo="+ Vendido en efectivo" monto={c.efectivoVendido} />
                  {c.puedeSumar ? (
                    <>
                      <Fila rotulo="+ Ingresos" monto={c.entradas} />
                      <Fila rotulo="− Vales" monto={c.vales} />
                      {c.enBolsas > 0.005 ? <Fila rotulo="− Guardado en bolsas" monto={c.enBolsas} /> : null}
                      <View style={{ paddingTop: 7, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
                        <Fila rotulo="Total en efectivo" monto={c.enCaja} fuerte />
                      </View>
                    </>
                  ) : null}
                </View>
              ) : (
                <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
                  Los montos no se muestran antes del corte: el conteo se hace contando, y verlos de antemano sería copiarlos.
                </Text>
              )}
            </View>
          </>
        )) : null}
      </View>
    </Vidrio>
  );
}
