import { Redirect } from 'expo-router';

import { DatabaseSelfTestScreen } from '../../features/diagnostics/DatabaseSelfTestScreen';

/** Development-only self-test; release builds redirect to the home tab. */
export default function DatabaseSelfTestRoute() {
  return __DEV__ ? <DatabaseSelfTestScreen /> : <Redirect href="/" />;
}
