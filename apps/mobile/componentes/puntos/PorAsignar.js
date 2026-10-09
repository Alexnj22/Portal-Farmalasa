// Las cuentas del sistema anterior que no pasaron solas a una ficha, NATIVO —
// la pestaña «Cuentas por asignar» de Puntos. Cada una dice por qué no pasó y
// cuántos puntos trae; tocarla abre `asignar-cuenta`, donde se elige la ficha.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { fetchCuentasPorAsignar } from '@nucleo/data/puntos';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { puntosTexto } from '@nucleo/utils/puntosTexto';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { Aviso } from '../formulario/Piezas';
import Vidrio from '../Vidrio';

export default function PorAsignar({ busqueda = '' }) {
  const [lista, setLista] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    Promise.resolve(fetchCuentasPorAsignar()).then((r) => setLista(Array.isArray(r) ? r : [])).catch((e) => { setError(mensajeAmigable(e)); setLista([]); });
  }, []);
  const visibles = useMemo(() => (lista || []).filter((c) => !busqueda.trim() || tokenMatch(busqueda, c.nombre, c.dui, c.telefono, String(c.id_cliente))), [lista, busqueda]);
  if (lista == null) return <ActivityIndicator style={{ marginTop: 24 }} />;
  return (
    <View style={{ gap: 10 }}>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {!visibles.length ? <View style={{ marginHorizontal: 16 }}><Aviso texto={busqueda.trim() ? 'Sin coincidencias.' : 'Sin cuentas por asignar.'} /></View> : null}
      {visibles.slice(0, 200).map((c) => (
        <Pressable key={c.id_cliente} onPress={() => router.push({ pathname: '/asignar-cuenta', params: { cuenta: JSON.stringify(c) } })}
          style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
          <Vidrio radio={18} interactivo>
            <View style={{ padding: 12, gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{c.nombre || 'Sin nombre'}</Text>
                <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{`${puntosTexto(c.saldo)} pts`}</Text>
              </View>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                {[`Cuenta ${c.id_cliente}`, c.dui ? `DUI ${c.dui}` : null, c.telefono || null, formatMoney((Number(c.saldo) || 0) / 100),
                  c.ultima_compra ? `última compra ${fechaTexto(c.ultima_compra, { day: 'numeric', month: 'short', year: 'numeric' })}` : null].filter(Boolean).join(' · ')}
              </Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13, fontStyle: 'italic' }}>{c.motivo}</Text>
            </View>
          </Vidrio>
        </Pressable>
      ))}
    </View>
  );
}
