import { HomeScreen } from '../../features/home/HomeScreen';
import { useRestoreLastPage } from '../../features/chat/usePagePersistence';

export default function HomeRoute() {
  // Cold start: reopen the conversation that was open when the app was killed.
  useRestoreLastPage();
  return <HomeScreen />;
}
