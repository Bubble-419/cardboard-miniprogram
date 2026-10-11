'use strict';

const BROADCAST_INTERVAL_MS = 500;

/** 私有 PCM 策略：资源所有权/授权/交接由 partner-audio 统一负责。 */
function createSilentSampler({ scope, now, live, publish, onLevel }) {
  let level = null, lastBroadcastAt = -Infinity, publishing = false;
  return {
    frame(event) {
      if (!live() || !event || !event.frameBuffer) return;
      let samples;
      try { samples = new Int16Array(event.frameBuffer); } catch (error) { return; }
      if (!samples.length) return;
      let sum = 0;
      for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
      const rms = Math.sqrt(sum / samples.length);
      const dbfs = rms > 0 ? 20 * Math.log10(rms / 32768) : -100;
      const next = Math.min(1, Math.max(0, dbfs + 94) / 80);
      level = level == null ? next : level * 0.74 + next * 0.26;
      onLevel(level);
      if (publishing || now() - lastBroadcastAt < BROADCAST_INTERVAL_MS) return;
      lastBroadcastAt = now();
      publishing = true;
      const signal = { roomId: scope.roomId, sessionId: scope.sessionId, turnId: scope.turnId,
        signalType: 'PARTNER_SILENT_SOUND', value: level };
      Promise.resolve().then(() => live() && publish(signal)).catch(() => {})
        .finally(() => { publishing = false; });
    }
  };
}

module.exports = { createSilentSampler };
