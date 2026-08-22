// HUD feedback stays truthful throughout the full nitro envelope.
export const SPEEDOMETER_MAX_KMH = 700;

export function speedometerGauge(speedKmh) {
  return {
    max: SPEEDOMETER_MAX_KMH,
    fraction: Math.max(0, Math.min(1, speedKmh / SPEEDOMETER_MAX_KMH)),
  };
}
