import { Redirect } from 'expo-router';

import { DecisionPreviewScreen } from '../../features/diagnostics/DecisionPreviewScreen';

/** Development-only mock preview of approval and question cards; release builds redirect home. */
export default function DecisionPreviewRoute() {
  return __DEV__ ? <DecisionPreviewScreen /> : <Redirect href="/" />;
}
