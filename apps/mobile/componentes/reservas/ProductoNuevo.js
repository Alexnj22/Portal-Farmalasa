// Encargar un producto que NO tenemos (2026-10-21) — gemela de
// `ProductoQueNoTenemos` de `DialogoApartar`. Se escribe el nombre, se busca
// en el SRS y se puede agregar una foto; va a Bodega como consulta —aparezca o
// no en el SRS— y Bodega responde precio y fecha, o que no se puede con motivo.
// Si al escribir el nombre aparece en el catálogo, se ofrece usar ése.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { buscarEnSrs } from '@nucleo/data/srs';
import { buscarProductosMinMax } from '@nucleo/data/minmaxRequests';
import { resultadoDeSrs } from '@nucleo/utils/srs';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { Aviso, Campo } from '../formulario/Piezas';
import Fotos from '../formulario/Fotos';
import { MARCA } from '../inicio/marca';
import { Accion, Enlace } from './piezas';

function Fila({ titulo, detalle, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingVertical: 4, opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{titulo}</Text>
      {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{detalle}</Text> : null}
    </Pressable>
  );
}

export default function ProductoNuevo({ nombre, srs, noAparece, onNombre, onSrs, onNoAparece, onVolver, cantidad, onCantidad, fotos, onFotos, nota, onNota, onUsarCatalogo }) {
  const [resultados, setResultados] = useState(null);
  const [enCatalogo, setEnCatalogo] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState('');

  // ¿Ya lo tenemos? Se busca en el catálogo mientras se escribe («colestor z»
  // pasaba como producto nuevo y estaba en el catálogo).
  useEffect(() => {
    let vivo = true;
    const q = nombre.trim();
    if (q.length < 3) { setEnCatalogo([]); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- vaciar al borrar
    const t = setTimeout(() => {
      buscarProductosMinMax(q, 5).then(({ filas }) => { if (vivo) setEnCatalogo((filas ?? []).filter((f) => !f.aproximado)); }).catch(() => {});
    }, 300);
    return () => { vivo = false; clearTimeout(t); };
  }, [nombre]);

  const buscar = async () => {
    const q = nombre.trim();
    if (q.length < 3) return;
    setBuscando(true); setError('');
    try {
      const json = await buscarEnSrs(q, { porPagina: 8 });
      setResultados((json.data || []).map(resultadoDeSrs));
    } catch (e) {
      setResultados(null); setError(mensajeAmigable(e, 'No se pudo consultar el SRS. Intenta de nuevo.'));
    } finally {
      setBuscando(false);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <Aviso texto="Producto que no está en el catálogo: va a Bodega como consulta. Bodega responde el precio y para cuándo, o si no se puede conseguir. Ahora no se cobra nada." />
      <Campo multiline={false} value={nombre} onChangeText={onNombre} placeholder="Nombre, como lo pide el cliente" autoFocus returnKeyType="search" onSubmitEditing={buscar} />
      <View style={{ flexDirection: 'row' }}>
        <Accion texto={buscando ? 'Buscando…' : 'Buscar en el SRS'} onPress={buscar} deshabilitado={buscando || nombre.trim().length < 3} />
      </View>
      {error ? <Aviso tono="freno" texto={error} /> : null}

      {enCatalogo.length ? (
        <View>
          <Text style={{ color: MARCA.verde, fontSize: 14, fontWeight: '700' }}>Ya lo tenemos en el catálogo. Elige el que es para apartarlo o encargarlo.</Text>
          {enCatalogo.map((p) => (
            <Fila key={p.id} titulo={p.nombre} detalle={[p.principio_activo, p.laboratorio_nombre].filter(Boolean).join(' · ')} onPress={() => onUsarCatalogo(p)} />
          ))}
        </View>
      ) : null}

      {srs ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{`✓ ${srs.nombre}`}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{[srs.principio, srs.conc, srs.forma, srs.lab, srs.noregistro && `Reg. ${srs.noregistro}`].filter(Boolean).join(' · ')}</Text>
          </View>
          <Enlace texto="Cambiar" onPress={() => onNombre(nombre)} />
        </View>
      ) : noAparece ? (
        <Aviso tono="cuidado" texto="No aparece en el SRS: Bodega lo revisa antes de responder." />
      ) : buscando ? <ActivityIndicator /> : resultados ? (
        <View>
          {!resultados.length ? <Aviso texto="El SRS no tiene nada con ese nombre." /> : null}
          {resultados.map((r, i) => (
            <Fila key={`${r.noregistro}-${i}`} titulo={`${r.nombre}${!r.activo ? ' · registro inactivo' : ''}`}
              detalle={[r.principio, r.conc, r.forma, r.lab].filter(Boolean).join(' · ')} onPress={() => onSrs(r)} />
          ))}
          <Enlace texto="No aparece en el SRS: consultar igual" onPress={onNoAparece} />
        </View>
      ) : null}

      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Cantidad</Text>
      <View style={{ width: 90 }}>
        <Campo multiline={false} value={cantidad} keyboardType="number-pad" onChangeText={(v) => onCantidad(v.replace(/\D/g, '').slice(0, 2))} placeholder="Cant." style={{ textAlign: 'center' }} />
      </View>
      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Foto (opcional)</Text>
      <Fotos fotos={fotos} onCambiar={onFotos} max={1} />
      <Campo value={nota} onChangeText={onNota} maxLength={300} placeholder="Nota para Bodega: presentación, laboratorio, para cuándo lo necesita…" />
      <Enlace texto="Volver a buscar en el catálogo" onPress={onVolver} />
    </View>
  );
}
