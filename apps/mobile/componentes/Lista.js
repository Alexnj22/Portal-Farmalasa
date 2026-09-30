// En Android (y web) la lista universal de @expo/ui tal cual.
import { List } from '@expo/ui';

export default function Lista({ children, onRefresh }) {
  return <List onRefresh={onRefresh}>{children}</List>;
}
