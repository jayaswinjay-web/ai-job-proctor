import { useEffect, useRef, useState } from 'react';
import { Icon } from '@proctor/ui';
import type { KioskController } from '../hooks/useKioskController.js';
import { KButton, LiveRegion } from '../ui.js';

/**
 * Full-screen Rajapalayam Mills introductory video.
 *
 * Rendered by the app shell as a one-time loading screen, above every other screen
 * (including the voice-first screen). It plays with sound. Browsers block autoplay with
 * audio until the page has been interacted with, so if the unmuted `play()` is rejected
 * we show a large tap-to-start button that unlocks audio on the first touch. A kiosk
 * launch flag (`--autoplay-policy=no-user-gesture-required`) makes it start by itself.
 */
export function WelcomeVideo({ onFinished }: { onFinished: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const finishedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [blocked, setBlocked] = useState(false);

  const finish = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    onFinished();
  };

  const armFallback = (ms: number) => {
    if (finishedRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(finish, ms);
  };

  const startPlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    video.volume = 1;
    const result = video.play();
    if (result && typeof result.catch === 'function') {
      result.then(() => setBlocked(false)).catch(() => setBlocked(true));
    }
  };

  useEffect(() => {
    // Safety net so the kiosk can never get stuck on the video screen.
    armFallback(60000);
    startPlayback();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        background: '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      <video
        ref={videoRef}
        playsInline
        preload="auto"
        onEnded={finish}
        onError={finish}
        onLoadedMetadata={(e) => {
          const duration = Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 60;
          armFallback(duration * 1000 + 5000);
        }}
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      >
        <source src="/ramco-mills-intro.mp4" type="video/mp4" />
        Your browser does not support the video tag.
      </video>

      {blocked && (
        <button
          type="button"
          onClick={startPlayback}
          style={{
            position: 'absolute',
            bottom: '8%',
            padding: '24px 48px',
            fontSize: 'clamp(1.4rem, 2.6vw, 2rem)',
            fontWeight: 800,
            fontFamily: 'inherit',
            color: '#fff',
            background: 'rgba(11, 61, 107, 0.92)',
            border: '4px solid #fff',
            borderRadius: 999,
            cursor: 'pointer',
          }}
        >
          ▶ தொடங்க தட்டவும் · Tap to play with sound
        </button>
      )}
    </div>
  );
}

/**
 * Welcome screen.
 *
 * One button, one sentence, no reading required. The full-screen introductory video is
 * played once by the app shell, above this screen.
 */
export function WelcomeScreen({ kiosk, onContinue }: { kiosk: KioskController; onContinue: () => void }) {
  const { bootstrap } = kiosk;
  if (!bootstrap) return null;

  const needsPermission = !kiosk.speechAvailable;

  return (
    <div className="k-screen">
      <TopBar kiosk={kiosk} title={bootstrap.siteName} subtitle={bootstrap.jobs.length > 0 ? undefined : 'No jobs are open right now'} />

      <main className="k-center">
        <Icon name="mic" size={72} color="var(--k-primary)" aria-hidden />

        <h1 className="k-display">Welcome</h1>
        <p className="k-body">
          Welcome to <strong>Rajapalayam Mills (Ramco Group)</strong>.
          <br />
          I will ask you a few simple questions for the job application.
          <br />
          You only need to <strong>speak</strong> your answers.
          <br />
          There is no need to type or read anything.
        </p>

        {needsPermission && (
          <div className="k-state k-state-error" style={{ maxWidth: 560 }}>
            <Icon name="alert" size={32} aria-hidden />
            <span>This kiosk needs a keyboard with a microphone and speakers. Please call the person at the desk.</span>
          </div>
        )}

        <div className="k-btn-row">
          <KButton
            // Pressing Start is also the gesture that unlocks audio in browsers which
            // block speech synthesis until the user has interacted with the page.
            onClick={onContinue}
            icon={<Icon name="play" size={38} aria-hidden />}
          >
            Start
          </KButton>
          <KButton
            variant="secondary"
            onClick={() => kiosk.openHelp()}
            icon={<Icon name="help" size={36} aria-hidden />}
          >
            Help
          </KButton>
        </div>

        <LiveRegion message="Welcome. I will ask you a few simple questions. You only need to speak your answers." />
      </main>

      <BottomHint />
    </div>
  );
}

export function TopBar({
  kiosk,
  title,
  subtitle,
  showHelp = true,
}: {
  kiosk: KioskController;
  title: string;
  subtitle?: string;
  showHelp?: boolean;
}) {
  return (
    <header className="k-topbar">
      <div>
        <div className="k-topbar-title">{title}</div>
        {subtitle && <div className="k-topbar-sub">{subtitle}</div>}
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {!kiosk.online && (
          <div className="k-state k-state-offline" role="status">
            <Icon name="wifi-off" size={30} aria-hidden />
            <span>No connection</span>
          </div>
        )}
        {kiosk.session && (
          <button
            type="button"
            className={`k-iconbtn${kiosk.muted ? ' k-iconbtn--active' : ''}`}
            onClick={kiosk.toggleMute}
            aria-pressed={kiosk.muted}
            aria-label={kiosk.muted ? 'Turn the microphone on' : 'Turn the microphone off'}
            title={kiosk.muted ? 'Microphone off — tap to turn on' : 'Microphone on — tap to mute'}
          >
            <Icon name={kiosk.muted ? 'mic-off' : 'mic'} size={40} aria-hidden />
          </button>
        )}
        {kiosk.session && (
          <button
            type="button"
            className="k-iconbtn"
            onClick={kiosk.repeatLast}
            aria-label="Say the question again"
            title="Say the question again"
          >
            <Icon name="repeat" size={40} aria-hidden />
          </button>
        )}
        {showHelp && (
          <button type="button" className="k-iconbtn" onClick={kiosk.openHelp} aria-label="Get help" title="Get help">
            <Icon name="help" size={40} aria-hidden />
          </button>
        )}
      </div>
    </header>
  );
}

export function BottomHint() {
  return (
    <footer
      style={{
        padding: '18px 24px',
        textAlign: 'center',
        fontSize: 'clamp(0.9rem, 1.4vw, 1.05rem)',
        color: 'var(--k-ink-soft)',
      }}
    >
      If you need help, please say <strong>“help”</strong> or touch the help button.
    </footer>
  );
}
