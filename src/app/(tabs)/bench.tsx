import { Redirect } from 'expo-router';

import { BenchScreen } from '../../features/bench/BenchScreen';

/** Render benchmark; available in dev builds and in release builds made with EXPO_PUBLIC_BENCH=1. */
export default function BenchRoute() {
  return __DEV__ || process.env.EXPO_PUBLIC_BENCH === '1' ? <BenchScreen /> : <Redirect href="/" />;
}
