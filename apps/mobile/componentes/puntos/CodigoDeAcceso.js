// El código de acceso a «Mis puntos», NATIVO — `CodigoDeAcceso` del portal.
//
// Es una LLAVE: quien la ve puede consultar el saldo de esa persona. Por eso al
// abrir sólo se dice que existe y desde cuándo; verla es un botón aparte que la
// base anota en la bitácora (`puntos_codigo_ver`). «Generar uno nuevo» deja
// inservible el anterior en el acto. Imprimir manda el papel a la caja de la
// sala de hoy (`salaDeHoy`) por la cola; quien anda por varias salas elige.
// En vez de «Copiar» (el teléfono no lo trae) está «Compartir», que hace lo
// mismo y además lo manda.
import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, Share, Text, View } from 'react-native';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { emitirCodigoAcceso, estadoCodigoAcceso, salaDeHoy, verCodigoAcceso } from '@nucleo/data/puntos';
import { construirTicketDeCodigo, urlConCodigo } from '@nucleo/utils/puntosCodigoTicket';
import { mensajeDelCodigo, telefonoParaWhatsapp } from '@nucleo/utils/codigoDePuntos';
import { fechaTexto } from '@nucleo/utils/fecha';
import { colorSistema } from '../Formulario';
import { Seccion } from '../formulario/Piezas';
import { MARCA } from '../inicio/marca';
import { fallo, listo } from '../Progreso';
import { imprimirEnLaSala } from '../imprimir';

function Boton({ texto, onPress, deshabilitado, color = MARCA.azulClaro }) {
  return (
    <Pressable onPress={onPress} disabled={deshabilitado} accessibilityRole="button"
      style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: 14, borderRadius: 20, justifyContent: 'center', backgroundColor: `${color}26`, opacity: deshabilitado ? 0.4 : pressed ? 0.7 : 1 })}>
      <Text style={{ color, fontSize: 14, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

export default function CodigoDeAcceso({ customerId, nombre, telefono, puedeEditar }) {
  const { user, getScope } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const [estado, setEstado] = useState(null);
  const [codigo, setCodigo] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [eligiendo, setEligiendo] = useState(false);

  useEffect(() => {
    let vivo = true;
    estadoCodigoAcceso(customerId).then((e) => { if (vivo) setEstado(e); }).catch(() => { if (vivo) setEstado({ tiene: false }); });
    return () => { vivo = false; };
  }, [customerId]);

  const conError = (accion) => async (fn) => {
    setOcupado(true);
    try { await fn(); } catch (e) {
      fallo('No se pudo', e?.message === 'FORBIDDEN' ? `No tienes permiso para ${accion}.` : `No se pudo ${accion}. ${e?.message ?? 'Intenta de nuevo.'}`);
    } finally { setOcupado(false); }
  };
  const valor = async () => codigo ?? (await verCodigoAcceso(customerId));
  const tiene = !!estado?.tiene;
  const tel = telefonoParaWhatsapp(telefono);

  const ver = () => conError('ver el código')(async () => setCodigo(await verCodigoAcceso(customerId)));
  const emitir = () => Alert.alert(tiene ? '¿Generar un código nuevo?' : '¿Generar el código?',
    tiene ? 'El anterior deja de servir en este momento.' : 'Con él, el cliente ve su saldo en su teléfono.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Generar', onPress: () => conError('generar el código')(async () => {
        const r = await emitirCodigoAcceso(customerId);
        setCodigo(r?.codigo ?? null);
        setEstado(await estadoCodigoAcceso(customerId));
        listo(r?.veces_emitido > 1 ? 'Código nuevo' : 'Código generado', r?.veces_emitido > 1 ? 'El anterior dejó de servir.' : 'Ya se puede entregar.');
      }) },
    ]);
  const compartir = () => conError('compartir el código')(async () => {
    const v = await valor(); if (!v) return; setCodigo(v);
    await Share.share({ message: mensajeDelCodigo({ nombre, codigo: v, enlace: urlConCodigo(v) }) });
  });
  const whatsapp = () => conError('preparar el mensaje')(async () => {
    const v = await valor(); if (!v) return; setCodigo(v);
    await Linking.openURL(`https://wa.me/${tel}?text=${encodeURIComponent(mensajeDelCodigo({ nombre, codigo: v, enlace: urlConCodigo(v) }))}`);
  });
  const imprimirEn = (sala) => conError('imprimir el papel')(async () => {
    setEligiendo(false);
    const v = await valor();
    if (!v) { fallo('Sin código', 'Este cliente todavía no tiene uno. Genéralo primero.'); return; }
    const r = await imprimirEnLaSala(construirTicketDeCodigo({ nombre, codigo: v, emitidoPor: user?.name || '' }), sala, 'Codigo de acceso a Mis puntos');
    if (r.ok) listo('Enviado a imprimir', r.detalle); else fallo('No se pudo imprimir', r.detalle);
  });
  const imprimir = () => conError('imprimir el papel')(async () => {
    const varias = getScope?.('ventas') === 'ALL';
    let mia = null;
    try { mia = await salaDeHoy(); } catch { mia = user?.branchId ?? null; }
    if (mia == null) mia = user?.branchId ?? null;
    if (!varias && mia != null) { await imprimirEn(Number(mia)); return; }
    setEligiendo(true);
  });

  const casillas = (codigo ?? '•••••••').split('');
  return (
    <Seccion titulo="Código de acceso a Mis puntos"
      pie={tiene ? `Emitido el ${estado?.emitido_at ? fechaTexto(estado.emitido_at) : '—'}${estado?.veces_emitido > 1 ? ` · ${estado.veces_emitido} veces` : ''}. Verlo queda anotado.` : 'Todavía no tiene código.'}>
      {tiene ? (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }} accessibilityLabel={codigo ? `Código ${codigo}` : 'Código oculto'}>
          {casillas.map((c, i) => (
            <View key={i} style={{ width: 34, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(127,127,127,0.16)' }}>
              <Text style={{ color: codigo ? colorSistema.texto : colorSistema.texto2, fontSize: 20, fontWeight: '800' }}>{c}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {tiene && !codigo ? <Boton texto="Ver" onPress={ver} deshabilitado={ocupado} /> : null}
        {tiene ? <Boton texto="Compartir" onPress={compartir} deshabilitado={ocupado} /> : null}
        {tiene && tel ? <Boton texto="WhatsApp" onPress={whatsapp} deshabilitado={ocupado} color={MARCA.verde} /> : null}
        {tiene ? <Boton texto="Imprimir" onPress={imprimir} deshabilitado={ocupado} /> : null}
        {puedeEditar ? <Boton texto={tiene ? 'Generar uno nuevo' : 'Generar código'} onPress={emitir} deshabilitado={ocupado} color={tiene ? MARCA.ambar : MARCA.verde} /> : null}
      </View>
      {eligiendo ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>¿En qué sala se imprime?</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(sucursales || []).map((b) => <Boton key={b.id} texto={b.name} onPress={() => imprimirEn(Number(b.id))} deshabilitado={ocupado} />)}
          </View>
        </View>
      ) : null}
    </Seccion>
  );
}
