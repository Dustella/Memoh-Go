import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';

import { useAccessState } from '../bootstrap/AppServices';

/** Screens outside the tab bar that need an account. */
export function RequireSignIn({ children }: { children: ReactNode }) {
  const state = useAccessState();
  if (state.kind === 'signed_out' || state.kind === 'needs_sign_in') return <Redirect href="/connect" />;
  return <>{children}</>;
}
