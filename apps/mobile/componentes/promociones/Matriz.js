// La matriz de una promoción de laboratorio, NATIVA — `MatrizLaboratorio`: el
// nivel que alcanzó cada sala, lo que le cuesta, cuánto le falta para el
// siguiente (lo que la sala puede PERSEGUIR) y el total del mes. Se puede
// medir contra otro mes («estás simulando»); un mes cerrado muestra los
// números congelados que se pagaron, no un recálculo de hoy.
import { useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { fetchPromocionLaboratorio } from '@nucleo/data/promociones';
import { fmtMoneda, fmtUnidades, mesesRecientes, rotuloMes } from '@nucleo/utils/promocionesUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { Aviso } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Vidrio from '../Vidrio';
import Kpi, { FilaDeKpis } from '../inicio/Kpi';
import { MARCA } from '../inicio/marca';
import { Barra, TresDatos } from './Piezas';

export default function Matriz({ promocionId }) {
  const [mes, setMes] = useState('');
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
    let vivo = true;
    setCargando(true);
    fetchPromocionLaboratorio(promocionId, mes || null)
      .then((d) => { if (vivo) { setDatos(d); setError(null); } })
      .catch((e) => { if (vivo) setError(mensajeAmigable(e, 'No se pudo calcular el avance.')); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [promocionId, mes]);

  const salas = Array.isArray(datos?.salas) ? datos.salas : [];
  const opciones = useMemo(() => {
    const base = mesesRecientes();
    const propio = datos?.year_month;
    return !propio || base.some((o) => o.value === propio) ? base : [...base, { value: propio, label: rotuloMes(propio) }];
  }, [datos?.year_month]);
  const elegirMes = () => {
    Haptics.selectionAsync().catch(() => {});
    const labels = [...opciones.map((o) => o.label), 'Cancelar'];
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Medir contra el mes', options: labels, cancelButtonIndex: labels.length - 1 }, (i) => {
      if (i < opciones.length) setMes(opciones[i].value === datos?.year_month ? '' : opciones[i].value);
    });
  };
  // La barra de cada sala: lo vendido contra el umbral del siguiente nivel.
  const mayorVenta = Math.max(1, ...salas.map((s) => Number(s.venta) || 0));

  if (cargando && !datos) return <ActivityIndicator style={{ marginTop: 16 }} />;
  if (error) return <Aviso tono="freno" texto={error} />;
  if (!datos) return <Aviso tono="cuidado" texto="Ya no está en el portal. Puede que la hayan borrado." />;
  return (
    <View style={{ gap: 12, opacity: cargando ? 0.6 : 1 }}>
      {datos.congelado ? <Aviso texto={`Mes cerrado: estos números quedaron congelados al terminar ${rotuloMes(datos.year_month)} — son los que se pagaron.`} /> : null}
      {datos.simulacion ? <Aviso tono="cuidado" texto={`Estás simulando: así habría quedado si hubiera corrido en ${rotuloMes(datos.mes_medido)}. La promoción es de ${rotuloMes(datos.year_month)} y no cambió.`} /> : null}
      <Pressable onPress={elegirMes} style={({ pressed }) => ({ alignSelf: 'flex-start', opacity: pressed ? 0.7 : 1 })}>
        <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>{`Medido contra ${rotuloMes(datos.mes_medido || datos.year_month)} ▾`}</Text>
      </Pressable>
      <View style={{ marginHorizontal: -16 }}>
        <FilaDeKpis>
          <Kpi icono="TrendingUp" rotulo="Venta del mes" valor={fmtMoneda(datos.venta_total)} color={MARCA.azulClaro}
            apoyo={`${salas.filter((x) => x.nivel != null).length} de ${salas.length} salas con nivel`} />
          <Kpi icono="Wallet" rotulo="Costo del bono" valor={fmtMoneda(datos.costo_total)} color={MARCA.violetaClaro}
            apoyo={`${fmtUnidades(datos.personas_pagadas)} cobran bono`} />
        </FilaDeKpis>
      </View>
      {Array.isArray(datos.laboratorios) && datos.laboratorios.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {datos.laboratorios.map((l) => <Pildora key={l.id} texto={l.nombre} color={colorSistema.texto2} />)}
        </View>
      ) : null}
      {!salas.length ? <Aviso texto="Ninguna sala tiene cuánto vender todavía: se escriben al editar la promoción." /> : null}
      {salas.map((s) => {
        const alcanzo = s.nivel != null;
        return (
          <Vidrio key={s.branch_id} radio={18}>
            <View style={{ padding: 14, gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{s.sala}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Vendió ${fmtMoneda(s.venta)} · ${fmtUnidades(s.personas)} ${Number(s.personas) === 1 ? 'persona' : 'personas'}`}</Text>
                </View>
                <Pildora texto={alcanzo ? `Nivel ${s.nivel}` : 'Sin nivel'} color={alcanzo ? MARCA.verde : colorSistema.texto2} />
              </View>
              <Barra pct={((Number(s.venta) || 0) / mayorVenta) * 100} color={alcanzo ? MARCA.verde : MARCA.azulClaro} alto={8} />
              <TresDatos datos={[
                { rotulo: 'Cada persona', valor: fmtMoneda(s.monto_por_persona) },
                { rotulo: 'Le cuesta', valor: fmtMoneda(s.costo) },
                { rotulo: 'Le falta', valor: s.siguiente_nivel != null ? fmtMoneda(s.falta) : '—', color: s.siguiente_nivel != null ? MARCA.azulClaro : undefined },
              ]} />
              {s.siguiente_nivel != null ? (
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  {`Le faltan ${fmtMoneda(s.falta)} para el nivel ${s.siguiente_nivel}${s.siguiente_monto != null ? ` (${fmtMoneda(s.siguiente_monto)} cada uno)` : ''}.`}
                </Text>
              ) : null}
            </View>
          </Vidrio>
        );
      })}
    </View>
  );
}
