// El lote y el vencimiento que trae la caja, NATIVO — gemelo de
// `src/views/traslados/LoteDeLaCaja.jsx` (2026-11-13). Se pide cuando lo que
// sale de la sala no los trae: un regulado sin lote asignado (lote + vence) o un
// perecedero sin control de lote y sin fecha (`soloVence`: sólo el vence).
//
// La regla es la del núcleo (`utils/loteDeCaja`), no se repite acá: qué falta,
// el choque con un lote ya registrado y la fecha que viaja. El valor es
// `{ lote, vence: 'AAAA-MM', nuevo?, envio }`; `envio` lo pone este componente
// (`{ lote, vence: 'AAAA-MM-DD' }` cuando se puede mandar, `null` mientras no).
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Presionable as Pressable } from './Tocable';
import { fetchLotesConocidosDeProducto } from '@nucleo/data/traslados';
import {
  choqueDeLote, loteDeCajaParaEnviar, motivoDeLoteDeCaja, motivoDeVenceDeCaja, venceDeCajaParaEnviar,
} from '@nucleo/utils/loteDeCaja';
import { venceNormal } from '@nucleo/utils/cobroDeAplicacion';
import { colorSistema } from './Formulario';
import { Aviso, Campo } from './formulario/Piezas';
import { MARCA } from './inicio/marca';

export const LOTE_DE_CAJA_VACIO = { lote: '', vence: '' };

const mesAnio = (v) => { const [a, m] = String(v).split('-'); return `${m}/${a}`; };

/** Lo que se escribe como MM/AAAA, guardado como AAAA-MM (lo que lee la regla). */
const aGuardado = (t) => {
  const limpio = String(t).replace(/[^\d/]/g, '').slice(0, 7);
  const v = venceNormal(limpio);
  return /^\d{4}-\d{2}$/.test(v) ? v : limpio;
};
const aPantalla = (v) => (/^\d{4}-\d{2}$/.test(String(v)) ? mesAnio(v) : String(v ?? ''));

function Chip({ texto, onPress, color = MARCA.azulClaro }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({
      minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 22,
      borderWidth: 1, borderColor: color, opacity: pressed ? 0.6 : 1,
    })}>
      <Text style={{ color, fontSize: 14, fontWeight: '600' }}>{texto}</Text>
    </Pressable>
  );
}

export default function LoteDeLaCaja({ erpProductId, producto, valor, onChange, soloVence = false }) {
  const [conocidos, setConocidos] = useState([]);
  useEffect(() => {
    if (soloVence) return undefined;
    let vivo = true;
    fetchLotesConocidosDeProducto(erpProductId).then((l) => { if (vivo) setConocidos(l); });
    return () => { vivo = false; };
  }, [erpProductId, soloVence]);

  const motivo = soloVence ? motivoDeVenceDeCaja(valor) : motivoDeLoteDeCaja(valor, conocidos);
  const envio = motivo ? null : soloVence ? venceDeCajaParaEnviar(valor) : loteDeCajaParaEnviar(valor, conocidos);
  const choque = soloVence ? null : choqueDeLote(valor, conocidos);
  const tocado = Boolean(valor?.lote || valor?.vence);

  const envioLote = envio ? envio.lote : null;
  const envioVence = envio?.vence ?? null;
  useEffect(() => {
    if ((valor?.envio?.lote ?? null) !== envioLote || (valor?.envio?.vence ?? null) !== envioVence)
      onChange({ ...valor, envio: envioVence ? { lote: envioLote, vence: envioVence } : null });
  }, [envioLote, envioVence, valor, onChange]);

  const usar = (c) => onChange({ lote: c.lote, vence: c.vence, envio: valor?.envio ?? null });
  const escrito = String(valor?.lote || '').trim().toUpperCase();
  const sugeridos = soloVence ? [] : conocidos
    .filter((c) => !escrito || c.lote.startsWith(escrito))
    .slice(0, 6);

  return (
    <View style={{ gap: 8 }}>
      {!soloVence ? (
        <>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Lote de la caja</Text>
          <Campo multiline={false} value={valor?.lote ?? ''} autoCapitalize="characters" autoCorrect={false}
            accessibilityLabel={`Lote de ${producto}`} placeholder="Lote"
            onChangeText={(t) => {
              const lote = t.toUpperCase();
              const c = conocidos.find((k) => k.lote === lote);
              onChange({ ...valor, lote, nuevo: false, ...(c && !valor?.vence ? { vence: c.vence } : {}) });
            }} />
          {sugeridos.length && !(sugeridos.length === 1 && sugeridos[0].lote === escrito) ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {sugeridos.map((c) => (
                <Chip key={`${c.lote}|${c.fecha}`} texto={`${c.lote} · ${mesAnio(c.vence)}`} onPress={() => usar(c)} />
              ))}
            </View>
          ) : null}
        </>
      ) : null}
      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Vencimiento de la caja</Text>
      <Campo multiline={false} value={aPantalla(valor?.vence)} placeholder="MM/AAAA" keyboardType="numbers-and-punctuation"
        accessibilityLabel={`Vencimiento de ${producto}`}
        onChangeText={(t) => onChange({ ...valor, ...(soloVence ? { lote: '' } : {}), vence: aGuardado(t), nuevo: false })} />
      {choque ? (
        <View style={{ gap: 8 }}>
          <Aviso tono="cuidado" texto={choque.mismoNumero
            ? `El lote ${choque.lote} ya está registrado con vencimiento ${mesAnio(choque.vence)}. Un lote tiene un solo vencimiento: revisa la caja.`
            : `¿Es el lote ${choque.lote} · ${mesAnio(choque.vence)}? Se parece al que escribiste.`} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip texto={`Usar ${choque.lote} · ${mesAnio(choque.vence)}`} onPress={() => usar(choque)} />
            {!choque.mismoNumero ? (
              <Chip texto="No, es otro lote" color={colorSistema.texto2} onPress={() => onChange({ ...valor, nuevo: true })} />
            ) : null}
          </View>
        </View>
      ) : motivo ? (
        <Aviso tono={tocado ? 'cuidado' : 'nota'} texto={motivo} />
      ) : null}
    </View>
  );
}
