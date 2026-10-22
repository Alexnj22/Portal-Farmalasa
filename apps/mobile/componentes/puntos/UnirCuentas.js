// Unir dos cuentas de puntos de la misma persona, NATIVO — `UnirCuentas` del
// portal (2026-10-15: «Ana Eduviges Calderón y Ana Calderón es la misma
// persona, pero tiene puntos en ambas»). Se abre desde la cuenta que SE QUEDA
// y se elige la otra: «traer los puntos de esa cuenta a ésta».
//
// Primero la base dice qué pasaría (`simular`): los dos saldos y el resultado;
// recién con eso se confirma. No se deshace desde aquí. Mismo permiso que dar
// o quitar puntos (`puntos_ajustar`); la base lo vuelve a exigir y rechaza
// las uniones sin sentido (una cuenta ya unida, una que no participa).
//
// `AvisoDeUniones`: si esta cuenta se unió a otra, o reunió otras.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { fetchClientesConPuntos, fetchUnionesDeCuenta, fusionarCuentasDePuntos } from '@nucleo/data/puntos';
import { puntosTexto } from '@nucleo/utils/puntosTexto';
import { fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../formulario/Piezas';
import { MARCA } from '../inicio/marca';
import { fallo, listo, trabajando } from '../Progreso';

/** Las uniones de una cuenta: a cuál se unió (`fusionadaEn`) y cuáles reunió (`recibidas`). */
export function useUnionesDeCuenta(customerId, version) {
  const [uniones, setUniones] = useState([]);
  useEffect(() => {
    if (customerId == null) return undefined;
    let vivo = true;
    Promise.resolve(fetchUnionesDeCuenta(customerId)).then((u) => { if (vivo) setUniones(u ?? []); }).catch(() => {});
    return () => { vivo = false; };
  }, [customerId, version]);
  const id = Number(customerId);
  return {
    fusionadaEn: uniones.find((u) => Number(u.origen) === id) ?? null,
    recibidas: uniones.filter((u) => Number(u.destino) === id),
  };
}

export function AvisoDeUniones({ fusionadaEn, recibidas }) {
  if (fusionadaEn) {
    return <Aviso texto={`Esta cuenta se unió a la de ${fusionadaEn.destino_nombre} el ${fechaTexto(fusionadaEn.created_at, { day: 'numeric', month: 'short', year: 'numeric' })}. Sus puntos y lo que compre con esta ficha se suman en esa cuenta.`} />;
  }
  if (!recibidas?.length) return null;
  const nombres = recibidas.map((u) => u.origen_nombre);
  const lista = nombres.length > 1 ? `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}` : nombres[0];
  return <Aviso texto={`Esta cuenta reúne también los puntos de ${lista}. Lo que compre con esa ficha también se suma aquí.`} />;
}

export default function UnirCuentas({ customerId, nombre, onCerrar, onHecho }) {
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [otra, setOtra] = useState(null);
  const [vista, setVista] = useState(null);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);

  // Busca en la base (son ~28,500 clientes), con una pausa para no salir con cada tecla.
  useEffect(() => {
    const q = busqueda.trim();
    if (q.length < 3) { setResultados([]); return undefined; }
    let vivo = true;
    setBuscando(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetchClientesConPuntos({ busqueda: q, limite: 8 });
        if (vivo) setResultados((r?.filas ?? []).filter((c) => Number(c.customer_id) !== Number(customerId)));
      } catch (e) {
        if (vivo) fallo('No se pudo buscar', mensajeAmigable(e));
      } finally {
        if (vivo) setBuscando(false);
      }
    }, 350);
    return () => { vivo = false; clearTimeout(t); };
  }, [busqueda, customerId]);

  // Al elegir la otra cuenta, la base dice qué pasaría.
  useEffect(() => {
    if (!otra) { setVista(null); return undefined; }
    let vivo = true;
    Promise.resolve(fusionarCuentasDePuntos({ origen: otra.customer_id, destino: customerId, simular: true }))
      .then((r) => { if (vivo) setVista(r); })
      .catch((e) => { if (vivo) setVista({ error: mensajeAmigable(e) }); });
    return () => { vivo = false; };
  }, [otra, customerId]);

  const unir = () => Alert.alert('¿Unir las cuentas?', `Los puntos de ${vista.origen?.nombre} pasan a ${vista.destino?.nombre}. Quedará con ${puntosTexto(vista.saldo_final)} puntos. No se deshace desde aquí.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Unir', style: 'destructive', onPress: async () => {
      setGuardando(true); trabajando('Uniendo…');
      try {
        // La bitácora la anota `fusionarCuentasDePuntos`.
        const r = await fusionarCuentasDePuntos({ origen: otra.customer_id, destino: customerId, nota, simular: false },
          { nombre, origen_nombre: otra.nombre, desde: 'app' });
        listo('Cuentas unidas', `Ahora tiene ${puntosTexto(r?.saldo_final)} puntos.`);
        onHecho?.();
      } catch (e) { fallo('No se pudieron unir', mensajeAmigable(e)); }
      setGuardando(false);
    } },
  ]);

  return (
    <Seccion titulo="Unir con otra cuenta" pie="Para la misma persona con dos fichas. Los puntos de la otra cuenta pasan a ésta con sus fechas de vencimiento, y lo que compre después con la otra ficha también se suma aquí.">
      {!otra ? (
        <>
          <Campo multiline={false} autoFocus value={busqueda} onChangeText={setBusqueda} placeholder="Nombre, DUI o teléfono de la otra cuenta" accessibilityLabel="Buscar la otra cuenta" />
          {buscando ? <ActivityIndicator /> : null}
          {busqueda.trim().length >= 3 && !buscando && !resultados.length ? <Aviso texto="Sin coincidencias." /> : null}
          {resultados.map((c, i) => (
            <Pressable key={c.customer_id} accessibilityRole="button" onPress={() => { Haptics.selectionAsync().catch(() => {}); setOtra(c); }}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingTop: i ? 8 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{c.nombre}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${c.dui || 'Sin DUI'} · ${c.telefono || 'Sin teléfono'}`}</Text>
              </View>
              <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800' }}>{`${puntosTexto(c.saldo)} pts`}</Text>
            </Pressable>
          ))}
        </>
      ) : !vista ? <ActivityIndicator /> : vista.error ? <Aviso tono="cuidado" texto={vista.error} /> : (
        <>
          <View style={{ gap: 2 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700' }}>SE UNE</Text>
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{vista.origen?.nombre}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`${puntosTexto(vista.origen?.saldo)} puntos`}</Text>
          </View>
          <View style={{ gap: 2 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700' }}>A ESTA CUENTA</Text>
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{vista.destino?.nombre}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`${puntosTexto(vista.destino?.saldo)} puntos`}</Text>
          </View>
          <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{`Quedará con ${puntosTexto(vista.saldo_final)} puntos.`}</Text>
          <Campo value={nota} onChangeText={(v) => setNota(v.slice(0, 200))} placeholder="Opcional: cómo se confirmó que es la misma persona" accessibilityLabel="Detalle" />
          <Aviso tono="cuidado" texto="No se deshace desde aquí: después de unir, los canjes toman puntos de las dos historias." />
        </>
      )}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><BotonGrande texto={otra ? 'Elegir otra' : 'Cancelar'} borde deshabilitado={guardando} onPress={otra ? () => setOtra(null) : onCerrar} /></View>
        {otra && vista && !vista.error ? (
          <View style={{ flex: 1 }}><BotonGrande texto={guardando ? 'Uniendo…' : 'Unir cuentas'} color={MARCA.azul} deshabilitado={guardando} onPress={unir} /></View>
        ) : null}
      </View>
    </Seccion>
  );
}
