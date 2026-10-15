// Entrega a domicilio de la app de clientes, NATIVO — `EnvioPanel.jsx` del
// portal: si se ofrece, cuánto cuesta, desde qué monto es gratis y la nota que
// ve el cliente. La app lo lee al abrir el carrito y el servidor vuelve a
// calcular el envío al reservar, así que lo que se guarda acá es lo que se
// cobra. Se edita con `ofertas_clientes` editar (como el portal); sin él, se mira.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchAjustesEnvio, guardarAjustesEnvio } from '@nucleo/data/reservas';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { BotonGrande, Campo, Seccion } from '../formulario/Piezas';
import Interruptor from '../Interruptor';
import { fallo, listo } from '../Progreso';

const Rotulo = ({ texto }) => <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', marginBottom: -4, marginLeft: 2 }}>{texto}</Text>;

export default function Envio({ puedeEditar }) {
  const { user } = useAuth();
  const [cfg, setCfg] = useState(null);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    fetchAjustesEnvio().then((d) => setCfg({
      activo: !!d?.envio_activo, costo: String(d?.envio_costo ?? ''), gratisDesde: d?.envio_gratis_desde == null ? '' : String(d.envio_gratis_desde), nota: d?.envio_nota ?? '',
    })).catch(() => setCfg({ activo: false, costo: '', gratisDesde: '', nota: '' }));
  }, []);
  if (!cfg) return <ActivityIndicator style={{ marginTop: 12 }} />;
  const costo = Number(cfg.costo);
  const valido = cfg.costo !== '' && costo >= 0 && (cfg.gratisDesde === '' || Number(cfg.gratisDesde) > 0);
  const cambiar = (k) => (v) => setCfg((x) => ({ ...x, [k]: v }));

  const guardar = async () => {
    setGuardando(true);
    try {
      await guardarAjustesEnvio(cfg, user?.id);
      useStaffStore.getState().appendAuditLog?.('APP_ENVIO_AJUSTES', null, { activo: cfg.activo, costo, gratis_desde: cfg.gratisDesde || null, desde: 'app' })?.catch?.(() => {});
      listo('Envío guardado', cfg.activo ? `Envío ${formatMoney(costo)}${cfg.gratisDesde ? `, gratis desde ${formatMoney(Number(cfg.gratisDesde))}` : ''}.` : 'La app ya no ofrece entrega a domicilio.');
    } catch (e) { fallo('No se pudo guardar', mensajeAmigable(e, 'Intenta de nuevo.')); }
    setGuardando(false);
  };

  return (
    <View style={{ marginHorizontal: 16 }}>
      <Seccion titulo="Entrega a domicilio">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Ofrecer entrega a domicilio</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>La app lo ofrece al abrir el carrito.</Text>
          </View>
          <Interruptor value={cfg.activo} disabled={!puedeEditar} onValueChange={cambiar('activo')} />
        </View>
        {cfg.activo ? (
          <>
            <Rotulo texto="Costo del envío ($)" />
            <Campo multiline={false} keyboardType="decimal-pad" editable={puedeEditar} value={cfg.costo} onChangeText={cambiar('costo')} placeholder="0.00" />
            <Rotulo texto="Gratis desde ($, opcional)" />
            <Campo multiline={false} keyboardType="decimal-pad" editable={puedeEditar} value={cfg.gratisDesde} onChangeText={cambiar('gratisDesde')} placeholder="Sin envío gratis" />
            <Rotulo texto="Nota que ve el cliente" />
            <Campo editable={puedeEditar} maxLength={200} value={cfg.nota} onChangeText={cambiar('nota')} placeholder="Ej. Sólo en el casco urbano." />
          </>
        ) : null}
        {puedeEditar ? <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar'} deshabilitado={!valido || guardando} onPress={guardar} /> : null}
      </Seccion>
    </View>
  );
}
