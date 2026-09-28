import { Redirect } from 'expo-router';

import { useAccessState } from '../bootstrap/AppServices';
import { ConnectScreen } from '../features/access/ConnectScreen';

export default function ConnectRoute() {
  const state = useAccessState();
  if (state.kind === 'signed_in') return <Redirect href="/" />;
  return <ConnectScreen />;
}
