/**
 * DeviceManager - Handles device enumeration and permissions
 */

import type { Disposable } from '../core/types';

export interface DeviceInfo {
  deviceId: string;
  label: string;
}

export interface DeviceList {
  microphones: DeviceInfo[];
  cameras: DeviceInfo[];
}

export class DeviceManager implements Disposable {
  private _disposed = false;

  async listDevices(): Promise<DeviceList> {
    const safeEnumerate = async (): Promise<MediaDeviceInfo[]> => {
      try {
        return await navigator.mediaDevices.enumerateDevices();
      } catch {
        return [];
      }
    };

    let devices = await safeEnumerate();
    let microphones = devices.filter((d) => d.kind === 'audioinput').map((d) => ({ deviceId: d.deviceId, label: d.label }));
    let cameras = devices.filter((d) => d.kind === 'videoinput').map((d) => ({ deviceId: d.deviceId, label: d.label }));

    // Request permissions if no labels
    const missingDevices = microphones.length === 0 && cameras.length === 0;
    const missingLabels = devices.length > 0 && devices.every((d) => !d.label);

    if (missingDevices || missingLabels) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        for (const track of stream.getTracks()) {
          track.stop();
        }
      } catch {}

      devices = await safeEnumerate();
      microphones = devices.filter((d) => d.kind === 'audioinput').map((d) => ({ deviceId: d.deviceId, label: d.label }));
      cameras = devices.filter((d) => d.kind === 'videoinput').map((d) => ({ deviceId: d.deviceId, label: d.label }));
    }

    // Deduplicate
    const uniqueById = <T extends { deviceId: string }>(arr: T[]): T[] => {
      const seen = new Set<string>();
      return arr.filter((item) => {
        if (seen.has(item.deviceId)) return false;
        seen.add(item.deviceId);
        return true;
      });
    };

    return {
      microphones: uniqueById(microphones).map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Microphone ${i + 1}`,
      })),
      cameras: uniqueById(cameras).map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Camera ${i + 1}`,
      })),
    };
  }

  async ensurePermissions(audio: boolean, video: boolean): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio, video });
      for (const track of stream.getTracks()) {
        track.stop();
      }
      return true;
    } catch {
      return false;
    }
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
  }
}
