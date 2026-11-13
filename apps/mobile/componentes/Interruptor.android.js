// El interruptor del sistema. En iPhone es el UISwitch (el `Switch` de React
// Native); en Android, el Switch de Material 3 de Compose — el de React Native
// en Android es el viejo de Material 2 (pista fina, sin ícono), y se notaba
// «portado» al lado de los demás controles nativos (2026-10-12, «adapta todo
// a los elementos nativos de Android»). Misma firma que el `Switch` de React
// Native: `value`, `onValueChange`, `disabled`.
import { Host, Switch as SwitchCompose } from '@expo/ui/jetpack-compose';
import { SEMILLA, usePaleta } from '../tema/material';

export default function Interruptor({ value, onValueChange, disabled }) {
  // Los colores del sistema leídos en vivo (el Host los tiene congelados
  // desde que cargó el WebView): pista primaria y botón onPrimary, como
  // Material 3.
  const p = usePaleta();
  return (
    <Host seedColor={SEMILLA} matchContents>
      <SwitchCompose value={!!value} enabled={!disabled} onCheckedChange={(v) => onValueChange?.(v)}
        colors={p ? { checkedTrackColor: p.primary, checkedThumbColor: p.onPrimary, uncheckedTrackColor: p.surfaceContainerHighest, uncheckedThumbColor: p.outline, uncheckedBorderColor: p.outline } : undefined} />
    </Host>
  );
}
