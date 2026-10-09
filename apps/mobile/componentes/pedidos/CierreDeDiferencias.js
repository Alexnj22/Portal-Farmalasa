// «Para cerrar» — el bloque del portal (`DifSection`) que aparece cuando todas
// las diferencias de una sala están resueltas: bodega marca la corrección como
// completa (con nota opcional) y la sala confirma que la recibió. Se muestra
// también sin permiso de edición: ver en qué quedó no es lo mismo que poder
// cerrarlo, y ocultarlo hace que la tarjeta parezca terminada.
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { pasoDeDiferencias } from '@nucleo/data/accionesDeBodega';
import { fmtDia, fmtHM } from '@nucleo/utils/tableroDePedidos';
import { ERP_NAMES } from '@nucleo/constants/erp';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { BotonGrande, Campo } from '../formulario/Piezas';
import { MARCA } from '../inicio/marca';
import { fallo, listo } from '../Progreso';

export default function CierreDeDiferencias({ row, resueltas, actuar, quien }) {
  const { user } = useAuth();
  const [nota, setNota] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const sala = ERP_NAMES[row.erp_sucursal_id] ?? 'la sala';
  const nombre = (id) => { const p = id ? quien?.(id) : null; return p ? shortEmployeeName(p) : null; };

  const paso = (cual, titulo, accion) => async () => {
    setOcupado(true);
    try {
      await pasoDeDiferencias({ pedidoId: row.pedido_id, sucId: row.erp_sucursal_id, userId: user?.id ?? null, paso: cual, nota });
      useStaffStore.getState().appendAuditLog?.(accion, row.pedido_id, { sucursal_id: row.erp_sucursal_id, ...(cual === 'corregir_bodega' ? { nota: nota || null } : {}), desde: 'app' });
      listo(titulo, '');
      actuar?.onCambio?.();
    } catch (e) {
      fallo('No se pudo', mensajeAmigable(e));
    } finally {
      setOcupado(false);
    }
  };

  let cuerpo;
  if (row.confirmado_correccion_at) {
    cuerpo = <Text style={{ color: MARCA.verde, fontSize: 14, fontWeight: '600' }}>{`Cerrado. La sala confirmó que recibió la corrección · ${fmtDia(row.confirmado_correccion_at)} ${fmtHM(row.confirmado_correccion_at)}${nombre(row.confirmado_correccion_por) ? ` · ${nombre(row.confirmado_correccion_por)}` : ''}`}</Text>;
  } else if (row.corregido_bodega_at) {
    cuerpo = actuar?.esSala ? (
      <View style={{ gap: 8 }}>
        <Text style={{ color: MARCA.ambar, fontSize: 14 }}>{`Bodega ya marcó la corrección · ${fmtDia(row.corregido_bodega_at)} ${fmtHM(row.corregido_bodega_at)} — falta que confirmes que la recibiste.`}</Text>
        {row.corregido_bodega_nota ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`«${row.corregido_bodega_nota}»`}</Text> : null}
        <BotonGrande texto="Confirmar corrección recibida" color={MARCA.verde} deshabilitado={ocupado}
          onPress={() => Alert.alert('Confirmar corrección', 'Confirmas que la sala recibió la corrección de bodega.', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Confirmar', onPress: paso('confirmar_correccion', 'Corrección confirmada', 'PEDIDO_CORRECCION_CONFIRMADA') }])} />
      </View>
    ) : (
      <Text style={{ color: MARCA.ambar, fontSize: 14 }}>{`Falta que ${sala} confirme que recibió la corrección. Bodega la marcó el ${fmtDia(row.corregido_bodega_at)} a las ${fmtHM(row.corregido_bodega_at)}.`}</Text>
    );
  } else if (!actuar || actuar.esSala) {
    cuerpo = <Text style={{ color: MARCA.ambar, fontSize: 14 }}>Falta que bodega marque la corrección como completa.</Text>;
  } else {
    cuerpo = (
      <View style={{ gap: 8 }}>
        <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
          {`${resueltas === 1 ? 'La diferencia está resuelta.' : `Las ${resueltas} diferencias están resueltas.`} Marca la corrección como completa y ${sala} tendrá que confirmar que la recibió.`}
        </Text>
        <Campo multiline={false} value={nota} onChangeText={setNota} placeholder="Nota (opcional)" />
        <BotonGrande texto="Marcar corregido" color={MARCA.verde} deshabilitado={ocupado}
          onPress={() => Alert.alert('Marcar corregido', `${sala} va a tener que confirmar que la recibió.`, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Marcar', onPress: paso('corregir_bodega', 'Marcado como corregido', 'PEDIDO_CORREGIDO_BODEGA') }])} />
      </View>
    );
  }
  return (
    <View style={{ gap: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, paddingTop: 10 }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 }}>PARA CERRAR</Text>
      {cuerpo}
    </View>
  );
}
