import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { test } from '@playwright/test';

interface Measurement {
  ok: boolean;
  errorName?: string;
  errorMessage?: string;
  trackLabel?: string;
  contextState?: string;
  maxRms?: number;
  width?: number;
  height?: number;
  bytesReceived?: number;
}

interface DeviceCounts {
  audioinput: number;
  audiooutput: number;
  videoinput: number;
  errorName?: string;
  errorMessage?: string;
}

interface TrackGroup {
  count: number;
  tracks: Array<{ label: string; readyState: string }>;
}

interface DisplayMeasurement extends Measurement {
  videoTracks?: TrackGroup;
  audioTracks?: TrackGroup;
}

function getErrorDetails(error: unknown): {
  errorName: string;
  errorMessage: string;
} {
  if (error instanceof Error) {
    return { errorName: error.name, errorMessage: error.message };
  }
  return { errorName: 'UnknownError', errorMessage: String(error) };
}

async function capture<T>(name: string, measurement: () => Promise<T>, onError: (error: unknown) => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      measurement(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} timed out after 10000ms`)), 10_000);
      }),
    ]);
  } catch (error) {
    return onError(error);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function measurementFailure(error: unknown): Measurement {
  return { ok: false, ...getErrorDetails(error) };
}

test('capabilities', async ({ page, browserName }, testInfo) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(
      '<!doctype html><html><head><meta charset="utf-8"><title>Capabilities</title></head><body><button id="audio-capture" type="button">Capture audio</button><button id="display-capture" type="button">Capture screen</button></body></html>',
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, resolve);
  });

  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('The capability probe server has no TCP address.');
    }
    await page.goto(`http://localhost:${address.port}`);

    const mediaDevices = await capture(
      'mediaDevices',
      () => page.evaluate(() => Boolean(navigator.mediaDevices)),
      () => false,
    );

    const enumerateDevices = await capture<DeviceCounts>(
      'enumerateDevices',
      () =>
        page.evaluate(async () => {
          const devices = await navigator.mediaDevices.enumerateDevices();
          return {
            audioinput: devices.filter((device) => device.kind === 'audioinput').length,
            audiooutput: devices.filter((device) => device.kind === 'audiooutput').length,
            videoinput: devices.filter((device) => device.kind === 'videoinput').length,
          };
        }),
      (error) => ({
        audioinput: 0,
        audiooutput: 0,
        videoinput: 0,
        ...getErrorDetails(error),
      }),
    );

    const getUserMediaAudio = await capture<Measurement>(
      'getUserMediaAudio',
      async () => {
        const result = page.evaluate<Measurement>(
          () =>
            new Promise((resolve) => {
              const button = document.querySelector<HTMLButtonElement>('#audio-capture');
              if (!button) {
                resolve({
                  ok: false,
                  errorName: 'MissingButton',
                  errorMessage: 'The audio-capture button is missing.',
                });
                return;
              }

              button.addEventListener(
                'click',
                () => {
                  void (async () => {
                    let stream: MediaStream | undefined;
                    let context: AudioContext | undefined;
                    let contextState: string | undefined;
                    try {
                      context = new AudioContext();
                      await context.resume();
                      contextState = context.state;

                      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                      const track = stream.getAudioTracks()[0];
                      if (!track) throw new Error('getUserMedia returned no audio track.');

                      const source = context.createMediaStreamSource(stream);
                      const analyser = context.createAnalyser();
                      analyser.fftSize = 2048;
                      source.connect(analyser);

                      const samples = new Float32Array(analyser.fftSize);
                      let maxRms = 0;
                      const endAt = performance.now() + 2_000;
                      while (performance.now() < endAt) {
                        analyser.getFloatTimeDomainData(samples);
                        let squaredSamples = 0;
                        for (const sample of samples) squaredSamples += sample * sample;
                        maxRms = Math.max(maxRms, Math.sqrt(squaredSamples / samples.length));
                        await new Promise((resolveDelay) => window.setTimeout(resolveDelay, 25));
                      }

                      resolve({ ok: true, trackLabel: track.label, contextState, maxRms });
                    } catch (error) {
                      const failedContextState = contextState ?? context?.state;
                      resolve({
                        ok: false,
                        ...(failedContextState ? { contextState: failedContextState } : {}),
                        errorName: error instanceof Error ? error.name : 'UnknownError',
                        errorMessage: error instanceof Error ? error.message : String(error),
                      });
                    } finally {
                      stream?.getTracks().forEach((track) => track.stop());
                      if (context && context.state !== 'closed') await context.close();
                    }
                  })();
                },
                { once: true },
              );
            }),
        );
        await page.click('#audio-capture');
        return result;
      },
      measurementFailure,
    );
    const audioNonSilent = getUserMediaAudio.ok && (getUserMediaAudio.maxRms ?? 0) > 0.001;

    const getUserMediaVideo = await capture<Measurement>(
      'getUserMediaVideo',
      () =>
        page.evaluate(async () => {
          let stream: MediaStream | undefined;
          let video: HTMLVideoElement | undefined;
          try {
            stream = await navigator.mediaDevices.getUserMedia({ video: true });
            video = document.createElement('video');
            video.autoplay = true;
            video.muted = true;
            video.playsInline = true;
            video.srcObject = stream;

            const metadataReady = new Promise<void>((resolve, reject) => {
              if (video && video.videoWidth > 0 && video.videoHeight > 0) {
                resolve();
                return;
              }
              const timer = window.setTimeout(() => reject(new Error('Timed out waiting for video metadata.')), 5_000);
              video?.addEventListener(
                'loadedmetadata',
                () => {
                  window.clearTimeout(timer);
                  resolve();
                },
                { once: true },
              );
              video?.addEventListener(
                'error',
                () => {
                  window.clearTimeout(timer);
                  reject(new Error('The video element failed to load metadata.'));
                },
                { once: true },
              );
            });

            await video.play();
            await metadataReady;
            return {
              ok: true,
              width: video.videoWidth,
              height: video.videoHeight,
            };
          } catch (error) {
            return {
              ok: false,
              errorName: error instanceof Error ? error.name : 'UnknownError',
              errorMessage: error instanceof Error ? error.message : String(error),
            };
          } finally {
            video?.pause();
            if (video) video.srcObject = null;
            stream?.getTracks().forEach((track) => track.stop());
            video?.remove();
          }
        }),
      measurementFailure,
    );

    const getDisplayMedia = await capture<DisplayMeasurement>(
      'getDisplayMedia',
      async () => {
        const result = page.evaluate<DisplayMeasurement>(
          () =>
            new Promise((resolve) => {
              const button = document.querySelector<HTMLButtonElement>('#display-capture');
              if (!button) {
                resolve({
                  ok: false,
                  errorName: 'MissingButton',
                  errorMessage: 'The display-capture button is missing.',
                });
                return;
              }

              button.addEventListener(
                'click',
                () => {
                  void (async () => {
                    try {
                      const stream = await navigator.mediaDevices.getDisplayMedia({
                        video: true,
                        audio: true,
                      });
                      const summarizeTracks = (tracks: MediaStreamTrack[]): TrackGroup => ({
                        count: tracks.length,
                        tracks: tracks.map((track) => ({
                          label: track.label,
                          readyState: track.readyState,
                        })),
                      });
                      const videoTracks = summarizeTracks(stream.getVideoTracks());
                      const audioTracks = summarizeTracks(stream.getAudioTracks());
                      stream.getTracks().forEach((track) => track.stop());
                      resolve({ ok: true, videoTracks, audioTracks });
                    } catch (error) {
                      resolve({
                        ok: false,
                        errorName: error instanceof Error ? error.name : 'UnknownError',
                        errorMessage: error instanceof Error ? error.message : String(error),
                      });
                    }
                  })();
                },
                { once: true },
              );
            }),
        );
        await page.click('#display-capture');
        return result;
      },
      measurementFailure,
    );

    const webrtcLoopback = await capture<Measurement>(
      'webrtcLoopback',
      () =>
        page.evaluate(async () => {
          let stream: MediaStream | undefined;
          let sender: RTCPeerConnection | undefined;
          let receiver: RTCPeerConnection | undefined;
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const audioTrack = stream.getAudioTracks()[0];
            if (!audioTrack) throw new Error('getUserMedia returned no audio track.');

            sender = new RTCPeerConnection();
            receiver = new RTCPeerConnection();
            sender.addTrack(audioTrack, stream);

            const waitForIceGathering = (connection: RTCPeerConnection): Promise<void> =>
              new Promise((resolve, reject) => {
                if (connection.iceGatheringState === 'complete') {
                  resolve();
                  return;
                }
                const timer = window.setTimeout(() => reject(new Error('Timed out gathering ICE candidates.')), 5_000);
                connection.addEventListener('icegatheringstatechange', () => {
                  if (connection.iceGatheringState === 'complete') {
                    window.clearTimeout(timer);
                    resolve();
                  }
                });
              });

            await sender.setLocalDescription(await sender.createOffer());
            await waitForIceGathering(sender);
            if (!sender.localDescription) {
              throw new Error('The sender has no local offer.');
            }
            await receiver.setRemoteDescription(sender.localDescription);
            await receiver.setLocalDescription(await receiver.createAnswer());
            await waitForIceGathering(receiver);
            if (!receiver.localDescription) {
              throw new Error('The receiver has no local answer.');
            }
            await sender.setRemoteDescription(receiver.localDescription);
            await new Promise((resolve) => window.setTimeout(resolve, 2_000));

            let bytesReceived = 0;
            const stats = await receiver.getStats();
            for (const stat of stats.values()) {
              if (stat.type !== 'inbound-rtp') continue;
              const inbound = stat as RTCInboundRtpStreamStats;
              if (inbound.kind === 'audio' && typeof inbound.bytesReceived === 'number') {
                bytesReceived += inbound.bytesReceived;
              }
            }

            return bytesReceived > 0
              ? { ok: true, bytesReceived }
              : {
                  ok: false,
                  errorName: 'NoInboundRtp',
                  errorMessage: 'No inbound audio RTP bytes were received.',
                  bytesReceived,
                };
          } catch (error) {
            return {
              ok: false,
              errorName: error instanceof Error ? error.name : 'UnknownError',
              errorMessage: error instanceof Error ? error.message : String(error),
            };
          } finally {
            sender?.close();
            receiver?.close();
            stream?.getTracks().forEach((track) => track.stop());
          }
        }),
      measurementFailure,
    );

    const results = {
      project: testInfo.project.name,
      browser: browserName,
      mediaDevices,
      enumerateDevices,
      getUserMediaAudio,
      audioNonSilent,
      getUserMediaVideo,
      getDisplayMedia,
      screenShareAudio: getDisplayMedia.ok && (getDisplayMedia.audioTracks?.count ?? 0) > 0,
      webrtcLoopback,
    };
    const outputPath = join(testInfo.project.outputDir, `capabilities-${testInfo.project.name}.json`);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(results, null, 2)}\n`);
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
