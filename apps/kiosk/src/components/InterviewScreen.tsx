import { useState } from 'react';
import { Icon } from '@proctor/ui';
import { KButton, LiveRegion } from '../ui.js';
import { MicOrb, StateChip } from './MicOrb.js';
import { ProgressDots } from '../ui.js';
import { TopBar } from './WelcomeScreen.js';
import type { KioskController } from '../hooks/useKioskController.js';

/**
 * The interview screen.
 *
 * Everything the candidate must understand is delivered three ways at once:
 *  1. Spoken, through the synthesiser — the primary channel.
 *  2. As a large caption, when the phrase carries meaning the gesture does not.
 *  3. As a state banner with an icon and a plain sentence, for the deaf-blind case
 *     where speech is unavailable and the caption is the only route.
 *
 * Controls are deliberately few and enormous. Every one of them is also achievable by
 * voice, so a candidate is never blocked by not finding a button.
 */
export function InterviewScreen({ kiosk }: { kiosk: KioskController }) {
  const [confirmStop, setConfirmStop] = useState(false);

  const isSpeaking = kiosk.phase === 'speaking';
  const isListening = kiosk.phase === 'listening';

  return (
    <div className="k-screen">
      <TopBar kiosk={kiosk} title={kiosk.session?.jobTitle ?? 'Interview'} subtitle={kiosk.session ? undefined : undefined} />

      <main
        className="k-center"
        style={{ gap: 26, paddingTop: 20, paddingBottom: 12 }}
      >
        <StateChip state={isSpeaking ? 'speaking' : isListening ? 'listening' : kiosk.phase === 'offline' ? 'offline' : kiosk.phase === 'error' ? 'error' : 'thinking'} />

        <MicOrb
          state={kiosk.muted ? 'muted' : isSpeaking ? 'speaking' : isListening ? 'listening' : kiosk.phase === 'offline' ? 'offline' : 'thinking'}
          level={kiosk.micLevel}
          onToggle={kiosk.toggleMute}
        />

        {kiosk.caption && (
          <p className="k-question" key={kiosk.caption}>
            {kiosk.caption}
          </p>
        )}

        {isListening && kiosk.listeningHint && (
          <p className="k-caption" style={{ margin: 0 }} aria-live="polite">
            {kiosk.listeningHint}
          </p>
        )}

        {kiosk.heardText && (
          <p className="k-transcript" aria-live="polite">
            <span style={{ opacity: 0.7, fontSize: '0.85em' }}>You said: </span>
            {kiosk.heardText}
          </p>
        )}

        <ProgressDots answered={kiosk.progress.answered} total={kiosk.progress.total} label={kiosk.progress.label} />
      </main>

      <footer
        style={{
          padding: '14px 20px 22px',
          display: 'flex',
          justifyContent: 'center',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        <KButton
          variant="secondary"
          onClick={kiosk.repeatLast}
          icon={<Icon name="repeat" size={34} aria-hidden />}
          ariaLabel="Say the question again"
        >
          Again
        </KButton>
        <KButton
          variant="secondary"
          onClick={() => void kiosk.submitTurn('Speak slowly')}
          icon={<Icon name="user" size={34} aria-hidden />}
          ariaLabel="Speak more slowly"
        >
          Slower
        </KButton>
        <KButton
          variant="secondary"
          onClick={() => void kiosk.submitTurn("I don't understand")}
          icon={<Icon name="help" size={34} aria-hidden />}
          ariaLabel="I do not understand"
        >
          I don&apos;t know
        </KButton>
        <KButton
          variant="secondary"
          onClick={() => void kiosk.skipCurrent()}
          icon={<Icon name="skip" size={34} aria-hidden />}
          ariaLabel="Go to the next question"
        >
          Next
        </KButton>
        <KButton
          variant={confirmStop ? 'danger' : 'ghost'}
          onClick={() => {
            if (confirmStop) {
              void kiosk.cancel('Candidate asked to stop');
              return;
            }
            setConfirmStop(true);
            // Un-confirm automatically so a stray tap cannot end the interview.
            setTimeout(() => setConfirmStop(false), 6000);
          }}
          icon={<Icon name={confirmStop ? 'cross' : 'stop'} size={32} aria-hidden />}
          ariaLabel={confirmStop ? 'Confirm: end the interview now' : 'End the interview'}
        >
          {confirmStop ? 'End now?' : 'End'}
        </KButton>
      </footer>

      <LiveRegion message={kiosk.caption ?? ''} />
    </div>
  );
}

/**
 * Completion.
 *
 * The score is deliberately hidden unless an administrator has enabled it. Announcing
 * a score to a non-reading candidate invites an argument at the kiosk, which is exactly
 * the situation human review exists to handle.
 */
export function CompletionScreen({ kiosk, onDone }: { kiosk: KioskController; onDone: () => void }) {
  const reveal = kiosk.bootstrap?.scoring.discloseScoreToCandidate ?? false;
  const delay = kiosk.bootstrap?.resetDelaySeconds ?? 20;

  return (
    <div className="k-screen">
      <main className="k-center">
        <div className="k-orb k-orb-listening" style={{ width: 190, height: 190, cursor: 'default' }}>
          <Icon name="check" size={96} strokeWidth={2.5} aria-hidden />
        </div>

        <h1 className="k-display">Thank you</h1>
        <p className="k-body">
          You have completed the interview.
          <br />
          Your application has been submitted successfully.
        </p>

        {reveal && (
          <p className="k-body">
            Your result will be shared with the recruitment team.
          </p>
        )}

        <p className="k-caption">This screen will reset in {delay} seconds.</p>

        <KButton onClick={onDone} icon={<Icon name="arrow-right" size={34} aria-hidden />}>
          Finish
        </KButton>

        <p className="k-caption">Please give the slip to the person at the desk.</p>

        <LiveRegion message="Thank you. You have completed the interview. Your application has been submitted successfully." />
      </main>
    </div>
  );
}

/** Shown when the kiosk cannot continue. Always offers a way back to the welcome screen. */
export function ErrorScreen({ kiosk }: { kiosk: KioskController }) {
  const error = kiosk.error;
  return (
    <div className="k-screen">
      <main className="k-center">
        <div className="k-orb k-orb-error" style={{ width: 170, height: 170, cursor: 'default' }}>
          <Icon name="alert" size={80} aria-hidden />
        </div>
        <h1 className="k-question">Please wait</h1>
        <p className="k-body">{error?.message ?? 'There is a small technical problem. Please wait a moment.'}</p>
        <p className="k-caption">Please call the person at the desk for help.</p>

        <div className="k-btn-row">
          <KButton
            onClick={() => {
              kiosk.reportError('RETRY_FROM_ERROR');
              kiosk.resetToWelcome();
            }}
            icon={<Icon name="repeat" size={34} aria-hidden />}
          >
            Start again
          </KButton>
        </div>

        {error?.errorId && (
          <p className="k-caption" style={{ opacity: 0.6 }}>
            Reference for the support team: {error.errorId}
          </p>
        )}

        <LiveRegion message={error?.message ?? 'There is a small technical problem. Please call the person at the desk for help.'} />
      </main>
    </div>
  );
}

/**
 * Help overlay.
 *
 * Lists the voice commands and, crucially, what to do when nothing works — because the
 * people most likely to need this screen are those who cannot easily ask a question.
 */
export function HelpOverlay({ kiosk }: { kiosk: KioskController }) {
  const commands: Array<{ icon: Parameters<typeof Icon>[0]['name']; say: string; does: string }> = [
    { icon: 'repeat', say: '“Again”', does: 'Ask the same question once more' },
    { icon: 'user', say: '“Slower”', does: 'Speak more slowly and simply' },
    { icon: 'help', say: '“I don’t understand”', does: 'Ask the question in a simpler way' },
    { icon: 'skip', say: '“Next”', does: 'Move to the next question' },
    { icon: 'arrow-left', say: '“Back”', does: 'Go back one question' },
    { icon: 'help', say: '“I don’t know”', does: 'Skip without any problem' },
    { icon: 'stop', say: '“Stop”', does: 'End the interview now' },
    { icon: 'globe', say: '“Tamil” / “Hindi”', does: 'Change the language' },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Help"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(13, 27, 42, 0.55)',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        zIndex: 50,
      }}
      onClick={() => kiosk.closeHelp()}
    >
      <div
        className="k-card"
        style={{ maxWidth: 760, maxHeight: '86vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="k-question" style={{ marginBottom: 18 }}>
          What you can say
        </h2>

        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
          {commands.map((command) => (
            <li
              key={command.say}
              style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 14px', background: 'rgba(255, 255, 255, 0.6)', backdropFilter: 'blur(12px) saturate(150%)', WebkitBackdropFilter: 'blur(12px) saturate(150%)', border: '1px solid rgba(255, 255, 255, 0.55)', borderRadius: 12 }}
            >
              <Icon name={command.icon} size={32} color="var(--k-primary)" aria-hidden />
              <span style={{ fontSize: 'clamp(1.05rem,1.7vw,1.3rem)', fontWeight: 700, minWidth: 200 }}>{command.say}</span>
              <span className="k-caption" style={{ margin: 0 }}>{command.does}</span>
            </li>
          ))}
        </ul>

        <div className="k-state k-state-error" style={{ marginTop: 20, maxWidth: 'none' }}>
          <Icon name="alert" size={30} aria-hidden />
          <span>If something goes wrong, please say “help” or call the person at the desk. Your answers are saved.</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 22 }}>
          <KButton onClick={kiosk.closeHelp} icon={<Icon name="cross" size={32} aria-hidden />}>
            Close
          </KButton>
        </div>
      </div>
    </div>
  );
}
