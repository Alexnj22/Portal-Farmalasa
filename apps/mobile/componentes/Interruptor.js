// El interruptor del sistema: en iPhone, el UISwitch (el `Switch` de React
// Native). En Android va `Interruptor.android.js`, el de Material 3.
import { Switch } from 'react-native';

export default function Interruptor(props) {
  return <Switch {...props} />;
}
