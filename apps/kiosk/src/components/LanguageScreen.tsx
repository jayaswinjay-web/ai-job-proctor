import { Icon } from '@proctor/ui';
import { KButton } from '../ui.js';

/**
 * Language selection.
 *
 * Each language is shown twice: in its own script (so a person who cannot read Latin
 * characters still recognises their own) and in the kiosk's default language as a
 * secondary line. The spoken prompt names each language in its own tongue as well as
 * the current one, which is what actually lets someone who is illiterate pick correctly.
 *
 * Selection is available by touch, by voice ("Hindi", "Marathi") and by the keyboard.
 */
export function LanguageScreen({
  languages,
  current,
  onSelect,
  onBack,
}: {
  languages: Array<{ code: string; name: string; nativeName: string }>;
  current: string;
  onSelect: (code: string) => void;
  onBack?: () => void;
}) {
  return (
    <div className="k-screen">
      <main className="k-center">
        <Icon name="globe" size={68} color="var(--k-primary)" aria-hidden />
        <h1 className="k-question">Which language would you like to use?</h1>
        <p className="k-caption">Please speak the language name, or touch it on the screen.</p>

        <div className="k-choices">
          {languages.map((language) => (
            <button
              key={language.code}
              type="button"
              className={`k-choice${language.code === current ? ' k-choice--selected' : ''}`}
              onClick={() => onSelect(language.code)}
              aria-pressed={language.code === current}
            >
              <span className="k-choice-native" lang={language.code}>
                {language.nativeName}
              </span>
              {language.nativeName !== language.name && <span className="k-choice-name">{language.name}</span>}
              {language.code === current && <Icon name="check" size={34} color="var(--k-primary)" aria-label="Selected" />}
            </button>
          ))}
        </div>

        <div className="k-btn-row">
          {onBack && (
            <KButton variant="secondary" onClick={onBack} icon={<Icon name="arrow-left" size={34} aria-hidden />}>
              Back
            </KButton>
          )}
        </div>
      </main>
    </div>
  );
}

/**
 * Job selection.
 *
 * Only open jobs are listed, and each card carries a large title plus a spoken-friendly
 * summary. A kiosk may have exactly one job, in which case the card is shown alone and
 * spoken as "the only job available".
 */
export function JobScreen({
  jobs,
  onSelect,
  onBack,
}: {
  jobs: Array<{ id: string; title: string; description: string; location: string; questionCount: number; durationMinutes: number }>;
  onSelect: (jobId: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="k-screen">
      <main className="k-center">
        <Icon name="briefcase" size={68} color="var(--k-primary)" aria-hidden />
        <h1 className="k-question">Which job do you want to apply for?</h1>
        <p className="k-caption">Please say the job name, or touch it on the screen.</p>

        <div className="k-choices">
          {jobs.map((job) => (
            <button key={job.id} type="button" className="k-choice" onClick={() => onSelect(job.id)}>
              <Icon name="briefcase" size={44} color="var(--k-primary)" aria-hidden />
              <span className="k-choice-title">{job.title}</span>
              <span className="k-choice-meta">
                {job.questionCount} questions · about {job.durationMinutes} minutes
              </span>
              {job.location && <span className="k-choice-meta">{job.location}</span>}
            </button>
          ))}
        </div>

        <div className="k-btn-row">
          <KButton variant="secondary" onClick={onBack} icon={<Icon name="arrow-left" size={34} aria-hidden />}>
            Back
          </KButton>
        </div>
      </main>
    </div>
  );
}
