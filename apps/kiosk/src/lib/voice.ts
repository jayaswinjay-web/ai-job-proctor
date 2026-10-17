/**
 * LiveKit Cloud thin-client transport.
 *
 * The production interview runs entirely in the cloud: this kiosk only publishes its
 * microphone and plays back the agent's audio. No STT, TTS, LLM or model inference ever
 * runs here, and the LiveKit SDK is imported lazily so the welcome screen is not delayed
 * by a media stack most sessions will not need until later.
 */

export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface VoiceBinding {
  sessionId: string;
  publicId?: string;
  sessionSecret?: string;
}

export interface VoiceRoomHandlers {
  onStatus: (status: VoiceStatus) => void;
  /** True while the remote agent is speaking — drives the on-screen indicator. */
  onAgentSpeaking: (speaking: boolean) => void;
  /** Data messages from the agent, e.g. the session binding. */
  onData?: (message: Record<string, unknown>) => void;
}

export interface VoiceConnection {
  disconnect: () => Promise<void>;
  setMuted: (muted: boolean) => Promise<void>;
}

/**
 * Joins a LiveKit Cloud room and wires up microphone publishing and agent playback.
 *
 * Audio tracks are attached to hidden elements that are appended to the document. This is
 * the only way the browser will actually route the remote audio to the speaker; there is
 * no application-level audio processing.
 */
export async function connectVoiceRoom(opts: {
  url: string;
  token: string;
  handlers: VoiceRoomHandlers;
}): Promise<VoiceConnection> {
  const { Room, RoomEvent, Track } = await import('livekit-client');

  const room = new Room({
    adaptiveStream: false,
    dynacast: false,
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  room.on(RoomEvent.TrackSubscribed, (track: { kind: string; attach: () => HTMLMediaElement }) => {
    if (track.kind === Track.Kind.Audio) {
      const element = track.attach();
      element.autoplay = true;
      element.style.display = 'none';
      document.body.appendChild(element);
    }
  });

  room.on(RoomEvent.TrackUnsubscribed, (track: { detach: () => HTMLMediaElement[] }) => {
    try {
      track.detach().forEach((el) => el.remove());
    } catch {
      /* already detached */
    }
  });

  room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Array<{ isLocal: boolean }>) => {
    opts.handlers.onAgentSpeaking(speakers.some((s) => !s.isLocal));
  });

  room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
    if (!opts.handlers.onData) return;
    try {
      opts.handlers.onData(JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>);
    } catch {
      /* not JSON we understand */
    }
  });

  room.on(RoomEvent.Reconnecting, () => opts.handlers.onStatus('reconnecting'));
  room.on(RoomEvent.Reconnected, () => opts.handlers.onStatus('connected'));
  room.on(RoomEvent.Disconnected, () => opts.handlers.onStatus('disconnected'));

  opts.handlers.onStatus('connecting');
  await room.connect(opts.url, opts.token);
  // Publish the microphone only — the kiosk has no camera role in the voice flow.
  await room.localParticipant.setMicrophoneEnabled(true);
  opts.handlers.onStatus('connected');

  // Unlock agent audio playback. The room connects automatically on load, so the browser
  // will refuse to play until a gesture has been observed. Start audio now and, when it
  // is refused, retry on the first pointer/key activity anywhere on the page.
  const startAudio = async () => {
    try {
      await room.startAudio();
    } catch {
      const onGesture = () => {
        void room.startAudio().catch(() => undefined);
        window.removeEventListener('pointerdown', onGesture);
        window.removeEventListener('touchstart', onGesture);
        window.removeEventListener('keydown', onGesture);
      };
      window.addEventListener('pointerdown', onGesture);
      window.addEventListener('touchstart', onGesture);
      window.addEventListener('keydown', onGesture);
    }
  };
  void startAudio();

  return {
    disconnect: async () => {
      try {
        await room.disconnect();
      } catch {
        /* already gone */
      }
    },
    setMuted: async (muted: boolean) => {
      await room.localParticipant.setMicrophoneEnabled(!muted);
    },
  };
}
