// El detalle de una bolsa de efectivo, NATIVO — `DetalleDeBolsa` del portal,
// en una hoja del sistema:
//   · lo que se guardó, lo que salió en vales y el efectivo que debe haber;
//   · cada salida con su vale, a nombre de quién, la boleta, quién lo recibió
//     y cómo se identificó, y su comprobante;
//   · la bitácora (quién la guardó, entregó, recibió, contó…) con caras.
// Los rótulos de la bitácora son los del núcleo (`ACCION_DE_BOLSA`). Anular y
// reimprimir el vale siguen en el portal: acá se LEE.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { fetchEventosDeBolsa, fetchSalidasDeBolsa } from '@nucleo/data/bolsas';
import { ACCION_DE_BOLSA, COMO_SE_IDENTIFICO } from '@nucleo/utils/bolsasTexto';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { fechaHora12, hora12 } from '@nucleo/utils/hora';
import { getSignedFileUrl } from '@nucleo/utils/storageFiles';
import { colorSistema } from '../Formulario';
import { Aviso, Dato, Seccion } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import { MARCA } from '../inicio/marca';
import Avatar from '../Avatar';
import Vidrio from '../Vidrio';

function Salida({ s }) {
  const [foto, setFoto] = useState(null);
  const ver = async () => {
    if (foto && foto !== 'cargando') { setFoto(null); return; }
    setFoto('cargando');
    try { const url = await getSignedFileUrl(s.foto_url); setFoto(url ? { url } : { error: true }); } catch { setFoto({ error: true }); }
  };
  return (
    <Vidrio radio={18}>
      <View style={{ padding: 12, gap: 7, opacity: s.anulado_at ? 0.6 : 1 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{s.etiqueta}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[s.vale_folio, s.registrado_at ? fechaHora12(s.registrado_at) : null].filter(Boolean).join(' · ')}</Text>
          </View>
          <Text style={{ color: s.anulado_at ? colorSistema.texto2 : colorSistema.texto, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'],
            textDecorationLine: s.anulado_at ? 'line-through' : 'none' }}>{formatMoney(s.monto)}</Text>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {s.anulado_at ? <Pildora texto="Anulada" color={colorSistema.texto2} /> : null}
          {!s.anulado_at && !s.impreso_at ? <Pildora texto="Vale sin imprimir" color={MARCA.ambar} /> : null}
          {s.entidad ? <Pildora texto={s.entidad} color={MARCA.azulClaro} /> : null}
          {s.numero_boleta ? <Pildora texto={`Boleta ${s.numero_boleta}`} color={MARCA.azulClaro} /> : null}
        </View>
        {s.recibido_nombre ? (
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
            {`Lo recibió ${s.recibido_nombre}${s.recibido_metodo ? ` (${COMO_SE_IDENTIFICO[s.recibido_metodo] || 'identificado'})` : ''}`}
          </Text>
        ) : null}
        {s.nota ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{s.nota}</Text> : null}
        {s.foto_url ? (
          <Pressable onPress={ver} accessibilityRole="button"
            style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 40, paddingHorizontal: 14, borderRadius: 20, justifyContent: 'center', backgroundColor: `${MARCA.azulClaro}26`, opacity: pressed ? 0.7 : 1 })}>
            {foto === 'cargando' ? <ActivityIndicator /> : <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '700' }}>{foto ? 'Ocultar el comprobante' : 'Ver el comprobante'}</Text>}
          </Pressable>
        ) : null}
        {foto?.error ? <Aviso tono="freno" texto="No se pudo abrir el comprobante. Vuelve a intentar en un momento." /> : null}
        {foto?.url ? <Image source={{ uri: foto.url }} resizeMode="contain" style={{ width: '100%', height: 300, borderRadius: 12, backgroundColor: 'rgba(127,127,127,0.1)' }} /> : null}
      </View>
    </Vidrio>
  );
}

export default function DetalleDeBolsa({ bolsa, sala, verMontos = true, onCerrar }) {
  const [salidas, setSalidas] = useState(null);
  const [eventos, setEventos] = useState([]);

  const cargar = useCallback(async () => {
    if (!bolsa) return;
    setSalidas(null);
    const [s, e] = await Promise.all([fetchSalidasDeBolsa(bolsa.id), fetchEventosDeBolsa(bolsa.id)]);
    setSalidas(s || []); setEventos(e || []);
  }, [bolsa]);
  useEffect(() => { cargar(); }, [cargar]);

  const vivas = (salidas || []).filter((s) => !s.anulado_at);
  const guardado = Number(bolsa?.monto_inicial || 0);
  const saldo = guardado + vivas.reduce((a, s) => a + Number(s.monto || 0), 0);

  return (
    <Modal visible={!!bolsa} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCerrar}>
      {bolsa ? (
        <View style={{ flex: 1, backgroundColor: colorSistema.fondo }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10, gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '800' }}>{bolsa.folio}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`${sala} · corte del ${fechaNumerica(bolsa.fecha, { vacio: '' })} ${hora12(bolsa.hora)}`}</Text>
            </View>
            <Pressable onPress={onCerrar} hitSlop={10} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: colorSistema.acento, fontSize: 17, fontWeight: '600' }}>Listo</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}>
            {verMontos ? (
              <Seccion titulo="El dinero">
                <Dato primero rotulo="Se guardó" valor={formatMoney(guardado)} />
                {vivas.length ? <Dato rotulo={`Salió en ${vivas.length} ${vivas.length === 1 ? 'vale' : 'vales'}`} valor={`−${formatMoney(Math.abs(saldo - guardado))}`} /> : null}
                <Dato rotulo="Efectivo que debe haber" valor={formatMoney(saldo)} fuerte />
              </Seccion>
            ) : null}
            {salidas == null ? <ActivityIndicator style={{ marginTop: 12 }} /> : (
              <View style={{ gap: 10 }}>
                <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginLeft: 16 }}>Lo que salió de esta bolsa</Text>
                {salidas.length ? salidas.map((s) => <Salida key={s.movimiento_id} s={s} />)
                  : <Text style={{ color: colorSistema.texto2, fontSize: 15, marginLeft: 16 }}>Sin salidas.</Text>}
              </View>
            )}
            {eventos.length ? (
              <Seccion titulo="La bitácora">
                {eventos.map((ev, i) => (
                  <View key={ev.id} style={{ flexDirection: 'row', gap: 10, paddingTop: i ? 9 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                    {ev.nombre ? <Avatar empleado={{ id: ev.employee_id, name: ev.nombre, photo: ev.photo_url }} tamano={26} /> : <View style={{ width: 26 }} />}
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 14 }}>
                        <Text style={{ fontWeight: '700' }}>{ACCION_DE_BOLSA[ev.accion] || ev.accion}</Text>
                        {[ev.nombre, ev.motivo || ev.nota].filter(Boolean).map((t) => ` · ${t}`).join('')}
                      </Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{ev.created_at ? fechaHora12(ev.created_at) : ''}</Text>
                    </View>
                  </View>
                ))}
              </Seccion>
            ) : null}
            {bolsa.estado !== 'ABIERTA' ? <Aviso texto="Esta bolsa ya salió de la sala: aquí no se corrige nada. Si el dinero no cuadra, se resuelve en el conteo." /> : null}
          </ScrollView>
        </View>
      ) : null}
    </Modal>
  );
}
