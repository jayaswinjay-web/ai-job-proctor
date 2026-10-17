import { useEffect, useState } from 'react';
import { Icon } from '@proctor/ui';
import { KButton, LiveRegion } from '../ui.js';
import { TopBar } from './WelcomeScreen.js';
import type { KioskController } from '../hooks/useKioskController.js';

/**
 * Consent.
 *
 * The privacy notice is *spoken* first and shown second, which is the correct order for
 * this audience: an unread notice is not consent, but an unheard notice is not
 * information either.
 *
 * Consent is recorded separately from any answer, on the session row, with the exact
 * text that was spoken and the moment it was given — so a later question about "what
 * did they agree to?" has a factual answer.
 */
export function ConsentScreen({
  kiosk,
  onAgree,
  onDecline,
}: {
  kiosk: KioskController;
  onAgree: () => void;
  onDecline: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const notice = kiosk.bootstrap?.consentPhraseKey;

  // Declining is a legitimate choice, so it is one tap away but never the default.
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 6000);
    return () => clearTimeout(timer);
  }, [confirming]);

  if (!kiosk.bootstrap) return null;

  return (
    <div className="k-screen">
      <TopBar kiosk={kiosk} title={kiosk.session?.jobTitle ?? 'Job application'} showHelp={false} />

      <main className="k-center">
        <Icon name="shield" size={68} color="var(--k-primary)" aria-hidden />

        <h1 className="k-question">Before we begin</h1>

        <div className="k-card" style={{ textAlign: 'left', maxWidth: 780 }}>
          <p className="k-body" style={{ marginBottom: 16 }}>
            This interview uses your voice to understand your answers.
          </p>
          <p className="k-caption" style={{ textAlign: 'left' }}>
            Your interview information may be stored for recruitment purposes.
          </p>
          <p className="k-caption" style={{ textAlign: 'left', marginTop: 12 }}>
            You will be asked one question at a time. You can say “again”, “slower”, or
            “I don&apos;t know” at any time. You can stop whenever you want.
          </p>
          <p className="k-caption" style={{ textAlign: 'left', marginTop: 12, opacity: 0.8 }}>
            {kiosk.bootstrap.jurisdictionNote}
          </p>
        </div>

        <p className="k-question" style={{ fontSize: 'clamp(1.6rem, 3vw, 2.4rem)' }}>
          Do you agree to continue?
        </p>
        <p className="k-caption">Please say “yes” or “no”.</p>

        <div className="k-btn-row">
          <KButton
            onClick={onAgree}
            icon={<Icon name="check" size={38} aria-hidden />}
            ariaLabel="Yes, I agree"
          >
            Yes, I agree
          </KButton>
          <KButton
            variant={confirming ? 'danger' : 'secondary'}
            onClick={() => (confirming ? onDecline() : setConfirming(true))}
            icon={<Icon name={confirming ? 'cross' : 'stop'} size={34} aria-hidden />}
            ariaLabel={confirming ? 'Confirm: I do not agree' : 'No, I do not agree'}
          >
            {confirming ? 'Confirm no' : 'No, I do not agree'}
          </KButton>
        </div>

        <LiveRegion
          message={
            notice
              ? 'This interview uses your voice to understand your answers. Your interview information may be stored for recruitment purposes. Do you agree to continue? Please say yes or no.'
              : 'Do you agree to continue? Please say yes or no.'
          }
        />
      </main>
    </div>
  );
}
