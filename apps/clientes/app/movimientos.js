// Mis puntos: lo acumulado, lo canjeado y cada movimiento (2026-11-03). Vivía
// al final del Inicio; con el menú nuevo pasó a su propia pantalla, y el
// Inicio se quedó con la tarjeta, el nivel y el estado del canje.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Presionable from '../componentes/Presionable';
import { useFocusEffect } from 'expo-router';
import { useShallow } from 'zustand/react/shallow';
import { Cargando, Pantalla, Tarjeta, Texto, Titulo, Vacio } from '../componentes/ui';
import { Entrada, NumeroAnimado } from '../componentes/animacion';
import { colorSistema } from '../componentes/sistema';
import { useCuenta } from '../lib/cuenta';
import { useSesion } from '../lib/sesion';
import { diasHasta, entero, fecha, fechaLarga, finDeMes } from '../lib/formato';
import { useTema } from '../tema/tema';

// El signo sale del NÚMERO, no del tipo: un ajuste puede sumar o restar.
const ROTULOS = {
  compra: 'Compra', canje: 'Canje', vencimiento: 'Vencieron', anulacion: 'Compra anulada', ajuste: 'Ajuste',
  cumpleanos: 'Regalo de cumpleaños', canje_devuelto: 'Canje devuelto', referido: 'Por invitar a un amigo',
  // El cupón del mes (2026-10-14): el servidor lo distingue de una compra porque vence a fin de mes.
  cupon: 'Cupón del mes',
  // Saldo a favor de una reserva que pasó a puntos para descontarlo en caja (2026-10-21).
  saldo_favor: 'Saldo a favor de una reserva',
};

export default function Movimientos() {
  const t = useTema();
  const { resumen, error, cargar, generacion } = useCuenta(useShallow((s) => ({
    resumen: s.resumen, error: s.error, cargar: s.cargar, generacion: s.generacion,
  })));
  const pedir = useSesion((s) => s.pedir);
  const [mas, setMas] = useState([]);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [refrescando, setRefrescando] = useState(false);
  const pidiendo = useRef(false);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  // Lo cargado de más se descarta sólo con un resumen NUEVO (otra generación).
  useEffect(() => { setMas([]); }, [generacion]);
  const refrescar = async () => { setRefrescando(true); await cargar({ forzar: true }); setRefrescando(false); };

  if (!resumen && !error) return <Cargando />;
  if (!resumen || resumen.pendiente) {
    return (
      <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}>
        <Vacio titulo={resumen?.pendiente ? 'Todavía no hay movimientos' : 'No se pudo cargar'} accion={resumen ? undefined : 'Reintentar'} alAccion={refrescar}>
          {resumen?.pendiente ? 'Desde tu primera compra con tu DUI empiezas a acumular.' : error}
        </Vacio>
      </Pantalla>
    );
  }

  const movimientos = [...(resumen.movimientos ?? []), ...mas];
  const total = resumen.movimientos_total ?? movimientos.length;
  // Una página a la vez (la ref frena el doble toque), y si mientras tanto
  // llegó un resumen nuevo, la respuesta vieja se descarta.
  const verMas = async () => {
    if (pidiendo.current) return;
    pidiendo.current = true;
    setCargandoMas(true);
    const gen = generacion;
    const r = await pedir('movimientos', { desde: movimientos.length });
    if (r?.ok && useCuenta.getState().generacion === gen) setMas((x) => [...x, ...r.movimientos]);
    setCargandoMas(false);
    pidiendo.current = false;
  };

  return (
    <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando} sinVidrio>
      <Entrada indice={0} estilo={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Tarjeta>
            <Texto nivel={3}>Acumulados</Texto>
            <NumeroAnimado valor={resumen.acumulados} formato="entero" estilo={{ fontSize: 24, fontWeight: '700', color: t.color.verdeTexto }} />
          </Tarjeta>
        </View>
        <View style={{ flex: 1 }}>
          <Tarjeta>
            <Texto nivel={3}>Canjeados</Texto>
            <NumeroAnimado valor={resumen.canjeados} formato="entero" estilo={{ fontSize: 24, fontWeight: '700', color: t.color.magentaTexto }} />
          </Tarjeta>
        </View>
      </Entrada>

      <Entrada indice={1}>
        <Tarjeta>
          <Titulo>Movimientos</Titulo>
          {movimientos.length === 0 ? <Texto nivel={2}>Todavía no hay movimientos.</Texto> : null}
          {movimientos.map((m, i) => {
            const gana = Number(m.puntos) > 0;
            // Una sola lectura por fila (2026-11-04): el lector de pantalla
            // leía cuatro pedazos sueltos —el rótulo, la fecha, «+120» con el
            // signo— y no se entendía si se ganó o se usó.
            const vence = m.tipo === 'cupon' ? textoVence(m.fecha) : null;
            const etiqueta = [
              `${ROTULOS[m.tipo] ?? 'Movimiento'}: ${gana ? 'ganaste' : 'usaste'} ${entero(Math.abs(m.puntos))} ${Math.abs(Number(m.puntos)) === 1 ? 'punto' : 'puntos'}`,
              `${fecha(m.fecha)}${m.sala ? `, ${m.sala}` : ''}`,
              vence?.texto,
            ].filter(Boolean).join('. ');
            return (
              <View key={`${m.fecha}-${i}`} accessible accessibilityLabel={etiqueta}
                style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Texto>{ROTULOS[m.tipo] ?? 'Movimiento'}</Texto>
                  <Texto nivel={3}>{fecha(m.fecha)}{m.sala ? ` · ${m.sala}` : ''}</Texto>
                  {m.tipo === 'cupon' ? <VenceCupon fecha={m.fecha} /> : null}
                </View>
                <Text style={{ fontSize: 17, fontWeight: '700', color: gana ? t.color.verdeTexto : t.color.magentaTexto, fontVariant: ['tabular-nums'] }}>
                  {gana ? '+' : '−'}{entero(Math.abs(m.puntos))}
                </Text>
              </View>
            );
          })}
          {movimientos.length < total ? (
            // Un botón de verdad (2026-11-04): con `<Text onPress>` el toque no
            // acusaba recibo y el área era sólo la del texto.
            <Presionable onPress={verMas} disabled={cargandoMas} accessibilityRole="button" accessibilityState={{ busy: cargandoMas }}
              style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ color: t.color.magentaTexto, fontWeight: '600', paddingVertical: 12 }}>
                {cargandoMas ? 'Cargando…' : `Ver más · ${movimientos.length} de ${total}`}
              </Text>
            </Presionable>
          ) : null}
        </Tarjeta>
      </Entrada>
    </Pantalla>
  );
}

// Los puntos de un cupón vencen el último día de SU mes (2026-10-14).
// El texto sale de una función aparte para que la etiqueta de la fila diga lo
// mismo que se ve (2026-11-04).
function textoVence(f) {
  const vence = finDeMes(f);
  const dias = diasHasta(vence);
  if (vence == null || dias == null) return null;
  return { vigente: dias >= 0, texto: dias >= 0 ? `Vencen el ${fechaLarga(vence)} — úsalos este mes` : `Vencieron el ${fechaLarga(vence)}` };
}
function VenceCupon({ fecha: f }) {
  const t = useTema();
  const v = textoVence(f);
  if (!v) return null;
  return (
    <Text style={{ fontSize: 13, fontWeight: v.vigente ? '700' : '400', color: v.vigente ? t.color.magentaTexto : colorSistema.texto3 }}>
      {v.texto}
    </Text>
  );
}
