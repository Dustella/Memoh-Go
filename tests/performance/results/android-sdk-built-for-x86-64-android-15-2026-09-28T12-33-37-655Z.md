Device: Android SDK built for x86_64 / Android 15 · build: release · 2026-09-28T12:33:37.656Z

| scenario | list | mount | JS dropped | JS p95 frame | UI janky | visible latency p50/p95 | anchor drift | heap end |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| stream100 | flat | 89ms | 15.4% | 31.4ms | 67.8% | 51.1/66.1ms | — | 20MB |
| stream100 | flash | 62ms | 17.8% | 31.5ms | 33.94% | 53/65.6ms | — | 16MB |
| stream100 | legend | 136ms | 16.6% | 32ms | 67.13% | 52.2/64.8ms | — | 20MB |
| burst500 | flat | 52ms | 16.6% | 31.3ms | 75.45% | 51.5/65.5ms | — | 16MB |
| burst500 | flash | 65ms | 16.5% | 31.7ms | 67.24% | 50.9/63.9ms | — | 16MB |
| burst500 | legend | 97ms | 22.3% | 33.1ms | 49.21% | 54.2/67.7ms | — | 20MB |
| history10k | flat | 84ms | 19% | 32.4ms | 20.29% | — | — | 24MB |
| history10k | flash | 137ms | 14.8% | 31.5ms | 40.82% | — | — | 20MB |
| history10k | legend | 177ms | 18.6% | 31.8ms | 14.5% | — | — | 24MB |
| huge100k | flat | 84ms | 19.6% | 32.1ms | 24.38% | — | — | 20MB |
| huge100k | flash | 77ms | 14.8% | 31.3ms | 34.6% | — | — | 16MB |
| huge100k | legend | 120ms | 18.8% | 32.4ms | 14.87% | — | — | 20MB |
| prepend | flat | 90ms | 16% | 47ms | 41.56% | — | lost | 16MB |
| prepend | flash | 107ms | 22.1% | 41.5ms | 24.64% | — | 0px | 16MB |
| prepend | legend | 103ms | 14% | 30.9ms | 25.86% | — | 1.1px | 16MB |
