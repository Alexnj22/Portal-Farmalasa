// El interruptor del sistema. En iPhone es el UISwitch (el `Switch` de React
// Native); en Android, el Switch de Material 3 de Compose — el de React Native
// en Android es el viejo de Material 2 (pista fina, sin ícono), y se notaba
// «portado» al lado de los demás controles nativos (2026-10-12, «adapta todo
// a los elementos nativos de Android»). Misma firma que el `Switch` de React
// Native: `value`, `onValueChange`, `disabled`.
import { Host, Switch as SwitchCompose } from '@expo/ui/jetpack-compose';
import { MARCA } from './inicio/marca';

export default function Interruptor({ value, onValueChange, disabled }) {
  return (
    <Host matchContents>
      <SwitchCompose value={!!value} enabled={!disabled} onCheckedChange={(v) => onValueChange?.(v)}
        colors={{ checkedTrackColor: MARCA.azul, checkedThumbColor: '#FFFFFF' }} />
    </Host>
  );
}
