import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Icon,
  Select,
  TextArea,
  TextInput,
  adminTokens as t,
  titleCase,
} from '@proctor/ui';
import { api } from '../lib/api.js';
import { describe, useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import type { LanguageDto, SystemSettings } from '@proctor/types';

/**
 * Settings.
 *
 * Changes here alter how every future interview behaves, so the page is deliberately
 * conservative: each section saves on its own, the current values are shown before saving,
 * and privacy-relevant switches state their consequence in words rather than relying on
 * the label alone.
 */

type Section = 'general' | 'voice' | 'interview' | 'scoring' | 'proctoring' | 'recording' | 'ai' | 'kiosk' | 'languages';

export function SettingsPage() {
  const { can } = useAuth();
  // The API wraps settings with `envDefaults` so an administrator can see which values
  // come from the environment and cannot be changed here.
  const settings = useAsync<{ settings: SystemSettings; envDefaults: Record<string, unknown> }>(
    () => api('/admin/settings'),
    [],
  );
  const [section, setSection] = useState<Section>('general');
  const [draft, setDraft] = useState<SystemSettings | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  useEffect(() => {
    if (settings.data?.settings) setDraft(settings.data.settings);
  }, [settings.data]);

  const save = async (patch: Record<string, unknown>) => {
    try {
      const updated = await api<{ settings: SystemSettings }>('/admin/settings', { method: 'PATCH', body: patch });
      setDraft(updated.settings);
      setNotice({ tone: 'success', text: 'Settings saved. New interviews use these values; running interviews keep their snapshot.' });
    } catch (err) {
      setNotice({ tone: 'danger', text: describe(err) });
    }
  };

  if (settings.error || !draft) {
    return (
      <div className="stack">
        {settings.error && <Alert tone="danger">{settings.error}</Alert>}
        {!settings.error && <Card>Loading settings…</Card>}
      </div>
    );
  }

  if (!can('settings:read')) {
    return <Alert tone="warning">Your role cannot read system settings.</Alert>;
  }

  const writable = can('settings:write');
  const SECTIONS: Array<[Section, string]> = [
    ['general', 'General'],
    ['languages', 'Languages'],
    ['voice', 'Voice & speech'],
    ['interview', 'Interview behaviour'],
    ['scoring', 'Scoring'],
    ['proctoring', 'Proctoring'],
    ['recording', 'Data retention'],
    ['ai', 'AI providers'],
    ['kiosk', 'Kiosk'],
  ];

  return (
    <div className="stack">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {SECTIONS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setSection(key)}
            style={{
              padding: '7px 13px',
              borderRadius: t.radius.pill,
              border: `1px solid ${section === key ? t.color.primary : t.color.border}`,
              background: section === key ? t.color.primarySoft : t.color.surface,
              color: section === key ? t.color.primary : t.color.textMuted,
              fontWeight: 700,
              fontSize: '0.8rem',
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {section === 'general' && (
        <GeneralSection settings={draft} writable={writable} onSave={(patch) => void save({ general: patch })} />
      )}
      {section === 'languages' && <LanguagesSection />}
      {section === 'voice' && <VoiceSection settings={draft} writable={writable} onSave={(patch) => void save({ voice: patch })} />}
      {section === 'interview' && (
        <InterviewSection settings={draft} writable={writable} onSave={(patch) => void save({ interview: patch })} />
      )}
      {section === 'scoring' && <ScoringSection settings={draft} writable={writable} onSave={(patch) => void save({ scoring: patch })} />}
      {section === 'proctoring' && (
        <ProctoringSection settings={draft} writable={writable} onSave={(patch) => void save({ proctoring: patch })} />
      )}
      {section === 'recording' && (
        <RetentionSection settings={draft} writable={writable} onSave={(patch) => void save({ recording: patch })} />
      )}
      {section === 'ai' && <AiSection settings={draft} writable={writable} onSave={(patch) => void save({ ai: patch })} />}
      {section === 'kiosk' && <KioskSection settings={draft} writable={writable} onSave={(patch) => void save({ kiosk: patch })} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function NumberRow({
  label,
  value,
  onChange,
  hint,
  min,
  max,
  step,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <Field label={label} hint={hint} >
      <TextInput
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        padding: 12,
        border: `1px solid ${t.color.border}`,
        borderRadius: t.radius.md,
        background: t.color.surface,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
      <span>
        <span style={{ display: 'block', fontWeight: 700, fontSize: '0.875rem' }}>{label}</span>
        {description && (
          <span style={{ display: 'block', fontSize: '0.78rem', color: t.color.textMuted, marginTop: 2 }}>{description}</span>
        )}
      </span>
    </label>
  );
}

function SaveRow({ onSave, disabled }: { onSave: () => void; disabled?: boolean }) {
  return (
    <div className="row" style={{ marginTop: 16 }}>
      <Button variant="primary" onClick={onSave} disabled={disabled}>
        Save this section
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function GeneralSection({
  settings,
  writable,
  onSave,
}: {
  settings: SystemSettings;
  writable: boolean;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const [draft, setDraft] = useState(settings.general);
  const set = (patch: Partial<SystemSettings['general']>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <Card title="General" subtitle="Site identity, default language and the privacy notice shown to candidates.">
      <div className="grid-2">
        <Field label="Site name" hint="Shown on the kiosk welcome screen and in reports.">
          <TextInput value={draft.siteName} disabled={!writable} onChange={(e) => set({ siteName: e.target.value })} />
        </Field>
        <Field label="Timezone" hint="Used for report timestamps.">
          <TextInput value={draft.timezone} disabled={!writable} onChange={(e) => set({ timezone: e.target.value })} />
        </Field>
        <Field label="Default language" hint="Preselected on the kiosk. Candidates can change it.">
          <Select value={draft.defaultLanguage} disabled={!writable} onChange={(e) => set({ defaultLanguage: e.target.value })}>
            {draft.supportedLanguages.map((code) => (
              <option key={code} value={code}>
                {code.toUpperCase()}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Fallback language" hint="Used when a translation is missing.">
          <Select value={draft.fallbackLanguage} disabled={!writable} onChange={(e) => set({ fallbackLanguage: e.target.value })}>
            {draft.supportedLanguages.map((code) => (
              <option key={code} value={code}>
                {code.toUpperCase()}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div style={{ marginTop: 14 }}>
        <Toggle
          label="Require privacy notice consent"
          description="The kiosk will not start an interview until the candidate agrees to be recorded and assessed."
          checked={draft.privacyNoticeRequired}
          disabled={!writable}
          onChange={(value) => set({ privacyNoticeRequired: value })}
        />
      </div>
      <div style={{ marginTop: 14 }}>
        <Field
          label="Jurisdiction note"
          hint="Shown with the consent text. State the retention period and the review process in plain language."
        >
          <TextArea value={draft.jurisdictionNote} disabled={!writable} onChange={(e) => set({ jurisdictionNote: e.target.value })} style={{ minHeight: 110 }} />
        </Field>
      </div>
      <SaveRow onSave={() => onSave(draft)} disabled={!writable} />
    </Card>
  );
}

function VoiceSection({
  settings,
  writable,
  onSave,
}: {
  settings: SystemSettings;
  writable: boolean;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const [draft, setDraft] = useState(settings.voice);
  const set = (patch: Partial<SystemSettings['voice']>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <Card title="Voice & speech" subtitle="How the interviewer sounds and how long the kiosk listens.">
      <div className="grid-2">
        <Field label="Speech rate" hint={`${draft.rate.toFixed(2)}×. Slower helps candidates who are less confident with English.`}>
          <input
            type="range"
            min={0.4}
            max={1.8}
            step={0.05}
            value={draft.rate}
            disabled={!writable}
            onChange={(e) => set({ rate: Number(e.target.value) })}
            style={{ width: '100%' }}
          />
        </Field>
        <Field label="Slow rate" hint={`${draft.slowRate.toFixed(2)}×. Used when a candidate asks for repetition.`}>
          <input
            type="range"
            min={0.4}
            max={1.2}
            step={0.05}
            value={draft.slowRate}
            disabled={!writable}
            onChange={(e) => set({ slowRate: Number(e.target.value) })}
            style={{ width: '100%' }}
          />
        </Field>
        <NumberRow label="Maximum answer length (seconds)" value={draft.maxAnswerSeconds} min={15} max={900} disabled={!writable} onChange={(value) => set({ maxAnswerSeconds: value })} />
        <NumberRow
          label="Silence before the kiosk speaks (seconds)"
          value={draft.silenceTimeoutSeconds}
          min={3}
          max={60}
          disabled={!writable}
          onChange={(value) => set({ silenceTimeoutSeconds: value })}
          hint="Higher values give slower speakers more time."
        />
        <NumberRow label="Volume" value={draft.volume} min={0} max={1} step={0.05} disabled={!writable} onChange={(value) => set({ volume: value })} />
        <NumberRow label="Pitch" value={draft.pitch} min={0.4} max={1.6} step={0.05} disabled={!writable} onChange={(value) => set({ pitch: value })} />
      </div>
      <div className="stack" style={{ gap: 10, marginTop: 14 }}>
        <Toggle
          label="Let candidates interrupt the interviewer"
          description="Barge-in stops the spoken question immediately, so a candidate who wants to answer early is not talked over."
          checked={draft.bargeInEnabled}
          disabled={!writable}
          onChange={(value) => set({ bargeInEnabled: value })}
        />
      </div>
      <SaveRow onSave={() => onSave(draft)} disabled={!writable} />
    </Card>
  );
}

function InterviewSection({
  settings,
  writable,
  onSave,
}: {
  settings: SystemSettings;
  writable: boolean;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const [draft, setDraft] = useState(settings.interview);
  const set = (patch: Partial<SystemSettings['interview']>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <Card title="Interview behaviour" subtitle="Length, retries and how the kiosk adapts when a candidate struggles.">
      <div className="grid-2">
        <NumberRow label="Maximum interview length (minutes)" value={draft.maxDurationMinutes} min={1} max={240} disabled={!writable} onChange={(value) => set({ maxDurationMinutes: value })} />
        <NumberRow label="Retries per question" value={draft.retryLimit} min={0} max={5} disabled={!writable} onChange={(value) => set({ retryLimit: value })} />
        <NumberRow
          label="Simplify after this many attempts"
          value={draft.simplifyAfterAttempts}
          min={1}
          max={5}
          disabled={!writable}
          onChange={(value) => set({ simplifyAfterAttempts: value })}
          hint="Shorter, plainer wording, and easier questions first."
        />
        <Field label="Follow-ups" hint="AI-generated follow-ups are limited to the job's own topics.">
          <Select value={draft.followUpMode} disabled={!writable} onChange={(e) => set({ followUpMode: e.target.value as SystemSettings['interview']['followUpMode'] })}>
            <option value="DISABLED">Disabled</option>
            <option value="LIMITED">Limited</option>
            <option value="ALLOWED">Allowed</option>
          </Select>
        </Field>
        <NumberRow label="Maximum follow-ups per question" value={draft.maxFollowUpsPerQuestion} min={0} max={5} disabled={!writable} onChange={(value) => set({ maxFollowUpsPerQuestion: value })} />
        <NumberRow
          label="Idle reset (minutes)"
          value={draft.sessionIdleResetMinutes}
          min={1}
          max={120}
          disabled={!writable}
          onChange={(value) => set({ sessionIdleResetMinutes: value })}
          hint="An abandoned kiosk returns to the welcome screen after this long."
        />
        <NumberRow
          label="Reset delay after finishing (seconds)"
          value={draft.kioskResetDelaySeconds}
          min={0}
          max={600}
          disabled={!writable}
          onChange={(value) => set({ kioskResetDelaySeconds: value })}
        />
      </div>
      <div className="stack" style={{ gap: 10, marginTop: 14 }}>
        <Toggle label="Repeat the welcome message" description="Useful in noisy recruitment centres." checked={draft.repeatWelcome} disabled={!writable} onChange={(value) => set({ repeatWelcome: value })} />
        <Toggle
          label="Tell candidates their score"
          description="Off by default. Scores from an AI screening are provisional until a person reviews them."
          checked={draft.discloseScoreToCandidate}
          disabled={!writable}
          onChange={(value) => set({ discloseScoreToCandidate: value })}
        />
      </div>
      <div style={{ marginTop: 14 }}>
        <Field label="Interviewer prompt override" hint="Replaces the default persona and rules. Leave empty to use the built-in prompt.">
          <TextArea value={draft.interviewerPromptOverride} disabled={!writable} onChange={(e) => set({ interviewerPromptOverride: e.target.value })} style={{ minHeight: 120 }} />
        </Field>
      </div>
      <SaveRow onSave={() => onSave(draft)} disabled={!writable} />
    </Card>
  );
}

function ScoringSection({
  settings,
  writable,
  onSave,
}: {
  settings: SystemSettings;
  writable: boolean;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const [draft, setDraft] = useState(settings.scoring);
  const set = (patch: Partial<SystemSettings['scoring']>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <Card title="Scoring" subtitle="How strict the evaluation is and when a person must confirm the result.">
      <div className="grid-2">
        <Field label="Strictness">
          <Select value={draft.strictness} disabled={!writable} onChange={(e) => set({ strictness: e.target.value as SystemSettings['scoring']['strictness'] })}>
            <option value="LENIENT">Lenient</option>
            <option value="BALANCED">Balanced</option>
            <option value="STRICT">Strict</option>
          </Select>
        </Field>
        <NumberRow label="Default passing score" value={draft.passingScore} min={0} max={100} disabled={!writable} onChange={(value) => set({ passingScore: value })} hint="Each job can override this." />
        <NumberRow
          label="Confidence floor"
          value={draft.confidenceFloor}
          min={0}
          max={1}
          step={0.05}
          disabled={!writable}
          onChange={(value) => set({ confidenceFloor: value })}
          hint="Answers scoring below this are marked low confidence."
        />
        <NumberRow
          label="Require human review below confidence"
          value={draft.requireHumanReviewBelowConfidence}
          min={0}
          max={1}
          step={0.05}
          disabled={!writable}
          onChange={(value) => set({ requireHumanReviewBelowConfidence: value })}
          hint="The main safeguard: a low-confidence result cannot leave the dashboard unreviewed."
        />
      </div>
      <div style={{ marginTop: 14 }}>
        <Toggle
          label="Let the AI produce a recommendation automatically"
          description="Even when enabled, the recommendation stays provisional until a reviewer confirms it."
          checked={draft.autoRecommend}
          disabled={!writable}
          onChange={(value) => set({ autoRecommend: value })}
        />
      </div>
      <SaveRow onSave={() => onSave(draft)} disabled={!writable} />
    </Card>
  );
}

function ProctoringSection({
  settings,
  writable,
  onSave,
}: {
  settings: SystemSettings;
  writable: boolean;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const [draft, setDraft] = useState(settings.proctoring);
  const set = (patch: Partial<SystemSettings['proctoring']>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <div className="stack">
      <Card title="Proctoring" subtitle="Automated observations for a person to review. These never decide an outcome on their own.">
        <div className="grid-2">
          <Field label="Level">
            <Select value={draft.level} disabled={!writable} onChange={(e) => set({ level: e.target.value as SystemSettings['proctoring']['level'] })}>
              <option value="OFF">Off</option>
              <option value="BASIC">Basic</option>
              <option value="STANDARD">Standard</option>
              <option value="ENHANCED">Enhanced</option>
            </Select>
          </Field>
          <NumberRow label="Facing away threshold (seconds)" value={draft.facingAwaySeconds} min={5} max={600} disabled={!writable} onChange={(value) => set({ facingAwaySeconds: value })} />
        </div>
        <div className="stack" style={{ gap: 10, marginTop: 14 }}>
          <Toggle label="Use the camera" description="Required for presence and multiple-person detection." checked={draft.cameraEnabled} disabled={!writable} onChange={(value) => set({ cameraEnabled: value })} />
          <Toggle label="Detect more than one person" checked={draft.detectMultiplePeople} disabled={!writable} onChange={(value) => set({ detectMultiplePeople: value })} />
          <Toggle label="Detect candidate facing away" description="Commonly triggered by poor lighting or a glare; always reviewed by a person." checked={draft.detectFacingAway} disabled={!writable} onChange={(value) => set({ detectFacingAway: value })} />
          <Toggle label="Enforce kiosk fullscreen" description="Reduces tab switching. Also recorded as an observation." checked={draft.kioskFullscreenEnforced} disabled={!writable} onChange={(value) => set({ kioskFullscreenEnforced: value })} />
          <Toggle label="Capture a snapshot on each event" description="Snapshots are retained under the same rules as recordings." checked={draft.snapshotOnEvent} disabled={!writable} onChange={(value) => set({ snapshotOnEvent: value })} />
        </div>
        <SaveRow onSave={() => onSave(draft)} disabled={!writable} />
      </Card>
      <RetentionRunner />
    </div>
  );
}

function RetentionSection({
  settings,
  writable,
  onSave,
}: {
  settings: SystemSettings;
  writable: boolean;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const [draft, setDraft] = useState(settings.recording);
  const set = (patch: Partial<SystemSettings['recording']>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <div className="stack">
      <Card title="What is stored" subtitle="Turn off storage entirely if local policy forbids recording.">
        <div className="stack" style={{ gap: 10 }}>
          <Toggle
            label="Store audio recordings"
            description="With this off, only transcripts and scores are kept."
            checked={draft.storeAudio}
            disabled={!writable}
            onChange={(value) => set({ storeAudio: value })}
          />
          <Toggle label="Store transcripts" description="Required for human review of an AI assessment." checked={draft.storeTranscript} disabled={!writable} onChange={(value) => set({ storeTranscript: value })} />
        </div>
      </Card>

      <Card title="Retention periods" subtitle="Deletion runs on a schedule and is recorded in the audit log.">
        <div className="grid-2">
          <NumberRow label="Recordings kept for (days)" value={draft.recordingRetentionDays} min={1} max={3650} disabled={!writable} onChange={(value) => set({ recordingRetentionDays: value })} />
          <NumberRow label="Transcripts kept for (days)" value={draft.transcriptRetentionDays} min={1} max={3650} disabled={!writable} onChange={(value) => set({ transcriptRetentionDays: value })} />
          <NumberRow
            label="Candidate records kept for (days)"
            value={draft.candidateDataRetentionDays}
            min={1}
            max={3650}
            disabled={!writable}
            onChange={(value) => set({ candidateDataRetentionDays: value })}
          />
          <NumberRow
            label="Signed link lifetime (seconds)"
            value={draft.signedUrlTtlSeconds}
            min={30}
            max={86400}
            disabled={!writable}
            onChange={(value) => set({ signedUrlTtlSeconds: value })}
            hint="How long an audio or snapshot link stays valid once issued."
          />
          <Field label="Anonymise transcripts after (days)" hint="Blank keeps transcripts readable for the full retention period.">
            <TextInput
              type="number"
              min={1}
              max={3650}
              value={draft.anonymizeTranscriptsAfterDays ?? ''}
              disabled={!writable}
              onChange={(e) => set({ anonymizeTranscriptsAfterDays: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </Field>
        </div>
        <SaveRow onSave={() => onSave(draft)} disabled={!writable} />
      </Card>
      <RetentionRunner />
    </div>
  );
}

function RetentionRunner() {
  const { can } = useAuth();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  /**
   * The API defaults to a dry run. That default is deliberate and is kept: an operator
   * sees exactly what would be removed before anything irreversible happens, and
   * hard deletion requires an explicit second opt-in.
   */
  const run = async (hardDelete: boolean) => {
    if (
      !confirm(
        hardDelete
          ? 'Permanently delete expired candidate records and audio now? This cannot be undone.'
          : 'Run a retention dry run? Nothing will be deleted.',
      )
    )
      return;
    setBusy(true);
    setResult(null);
    try {
      const response = await api<{
        dryRun: boolean;
        audioDeleted: number;
        audioBytesFreed: number;
        transcriptsRedacted: number;
        snapshotsDeleted: number;
        candidatesDeleted: number;
        expiredSessionsClosed: number;
        errors: Array<{ scope: string; id: string; message: string }>;
      }>('/admin/settings/retention/run', { method: 'POST', body: { dryRun: !hardDelete, hardDelete } });

      setResult(
        `${response.dryRun ? 'Dry run. Would delete' : 'Deleted'} ${response.audioDeleted} audio file(s) ` +
          `(${Math.round(response.audioBytesFreed / 1024)} KB), ${response.snapshotsDeleted} snapshot(s) and ` +
          `${response.candidatesDeleted} candidate record(s); would redact ${response.transcriptsRedacted} transcript(s) ` +
          `and close ${response.expiredSessionsClosed} expired session(s).` +
          (response.errors.length ? ` ${response.errors.length} item(s) could not be processed.` : ''),
      );
    } catch (err) {
      setResult(describe(err));
    } finally {
      setBusy(false);
    }
  };

  if (!can('settings:write')) return null;

  return (
    <Card title="Run cleanup now">
      <p style={{ marginTop: 0, fontSize: '0.85rem' }}>
        Normally scheduled. Running a dry run is useful before an audit; permanent deletion requires a separate,
        explicit confirmation.
      </p>
      {result && (
        <div style={{ marginBottom: 12 }}>
          <Alert tone="info">{result}</Alert>
        </div>
      )}
      <div className="row">
        <Button variant="secondary" busy={busy} onClick={() => void run(false)}>
          Dry run
        </Button>
        <Button variant="danger" busy={busy} icon={<Icon name="trash" size={15} />} onClick={() => void run(true)}>
          Delete permanently
        </Button>
      </div>
    </Card>
  );
}

function AiSection({
  settings,
  writable,
  onSave,
}: {
  settings: SystemSettings;
  writable: boolean;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const [draft, setDraft] = useState(settings.ai);
  const set = (patch: Partial<SystemSettings['ai']>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <Card title="AI providers" subtitle="Which models run the interviewer and the evaluation.">
      <div className="grid-2">
        <Field label="Conversation model" hint="Drives the interview dialogue.">
          <TextInput value={draft.model} disabled={!writable} onChange={(e) => set({ model: e.target.value })} />
        </Field>
        <Field label="Evaluation model" hint="Scores answers and writes the report.">
          <TextInput value={draft.evaluationModel} disabled={!writable} onChange={(e) => set({ evaluationModel: e.target.value })} />
        </Field>
        <Field label="LLM provider">
          <TextInput value={draft.llmProvider} disabled={!writable} onChange={(e) => set({ llmProvider: e.target.value })} />
        </Field>
        <Field label="Evaluation provider">
          <TextInput value={draft.evaluationProvider} disabled={!writable} onChange={(e) => set({ evaluationProvider: e.target.value })} />
        </Field>
        <NumberRow label="Temperature" value={draft.temperature} min={0} max={1} step={0.05} disabled={!writable} onChange={(value) => set({ temperature: value })} hint="Lower is more predictable, which suits a screening interview." />
        <NumberRow label="Maximum tokens" value={draft.maxTokens} min={128} max={8192} disabled={!writable} onChange={(value) => set({ maxTokens: value })} />
      </div>
      <div style={{ marginTop: 14 }}>
        <Toggle
          label="Demo mode"
          description="Uses deterministic local providers and forces every recommendation into human review. Use for training and demonstrations only."
          checked={draft.demoMode}
          disabled={!writable}
          onChange={(value) => set({ demoMode: value })}
        />
      </div>
      <SaveRow onSave={() => onSave(draft)} disabled={!writable} />
    </Card>
  );
}

function KioskSection({
  settings,
  writable,
  onSave,
}: {
  settings: SystemSettings;
  writable: boolean;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const [draft, setDraft] = useState(settings.kiosk);
  const set = (patch: Partial<SystemSettings['kiosk']>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <Card title="Kiosk" subtitle="Behaviour of the shared device itself.">
      <div className="grid-2">
        <Field label="Kiosk identifier" hint="Recorded on each session so a device can be traced.">
          <TextInput value={draft.kioskId} disabled={!writable} onChange={(e) => set({ kioskId: e.target.value })} />
        </Field>
        <NumberRow label="Session timeout (minutes)" value={draft.sessionTimeoutMinutes} min={1} max={480} disabled={!writable} onChange={(value) => set({ sessionTimeoutMinutes: value })} />
      </div>
      <div className="stack" style={{ gap: 10, marginTop: 14 }}>
        <Toggle label="Prevent page refresh" description="Reduces accidental exits mid-interview." checked={draft.preventRefresh} disabled={!writable} onChange={(value) => set({ preventRefresh: value })} />
        <Toggle label="Clear local data on reset" description="Removes cached audio and transcripts from the kiosk after each candidate." checked={draft.clearLocalDataOnReset} disabled={!writable} onChange={(value) => set({ clearLocalDataOnReset: value })} />
        <Toggle label="Start audio automatically" description="May be blocked by the browser until the candidate interacts." checked={draft.autoStartAudio} disabled={!writable} onChange={(value) => set({ autoStartAudio: value })} />
        <Toggle label="Require a wake word" description="Candidates say a phrase before the microphone opens." checked={draft.requireWakeWord} disabled={!writable} onChange={(value) => set({ requireWakeWord: value })} />
      </div>
      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: 8 }}>Accessibility defaults</div>
        <div className="stack" style={{ gap: 10 }}>
          <Toggle label="Reduced motion" checked={draft.accessibility.reducedMotion} disabled={!writable} onChange={(value) => set({ accessibility: { ...draft.accessibility, reducedMotion: value } })} />
          <Toggle label="High contrast" checked={draft.accessibility.highContrast} disabled={!writable} onChange={(value) => set({ accessibility: { ...draft.accessibility, highContrast: value } })} />
          <Toggle label="Large text" checked={draft.accessibility.largeText} disabled={!writable} onChange={(value) => set({ accessibility: { ...draft.accessibility, largeText: value } })} />
        </div>
      </div>
      <SaveRow onSave={() => onSave(draft)} disabled={!writable} />
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function LanguagesSection() {
  const { can } = useAuth();
  const languages = useAsync<{ items: Array<LanguageDto & { translationCount: number }> }>(() => api('/admin/languages'), []);
  const [editing, setEditing] = useState<Partial<LanguageDto> | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const save = async () => {
    if (!editing?.code || !editing.name || !editing.nativeName) return;
    try {
      await api('/admin/languages', {
        body: {
          code: editing.code,
          name: editing.name,
          nativeName: editing.nativeName,
          enabled: editing.enabled ?? true,
          sttLocale: editing.sttLocale || undefined,
          ttsVoiceHint: editing.ttsVoiceHint || undefined,
          sortOrder: editing.sortOrder ?? 0,
        },
      });
      setEditing(null);
      setNotice({ tone: 'success', text: 'Language saved.' });
      languages.reload();
    } catch (err) {
      setNotice({ tone: 'danger', text: describe(err) });
    }
  };

  return (
    <div className="stack">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      {editing && (
        <Card title={editing.code ? `Edit ${editing.code.toUpperCase()}` : 'Add a language'}>
          <div className="grid-2">
            <Field label="Code" hint="Two-letter code used in transcripts and reports.">
              <TextInput
                value={editing.code ?? ''}
                disabled={Boolean(editing.id)}
                onChange={(e) => setEditing({ ...editing, code: e.target.value.toLowerCase() })}
              />
            </Field>
            <Field label="Name" hint="In English, for recruiters.">
              <TextInput value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field label="Name in the language" hint="Shown to candidates for recognition.">
              <TextInput value={editing.nativeName ?? ''} onChange={(e) => setEditing({ ...editing, nativeName: e.target.value })} />
            </Field>
            <Field label="Speech recognition locale" hint="For example hi-IN.">
              <TextInput value={editing.sttLocale ?? ''} onChange={(e) => setEditing({ ...editing, sttLocale: e.target.value })} />
            </Field>
            <Field label="Voice hint" hint="Preferred voice name or gender, if the platform needs one.">
              <TextInput value={editing.ttsVoiceHint ?? ''} onChange={(e) => setEditing({ ...editing, ttsVoiceHint: e.target.value })} />
            </Field>
            <Field label="Order" hint="Lower appears first on the kiosk.">
              <TextInput type="number" min={0} max={999} value={editing.sortOrder ?? 0} onChange={(e) => setEditing({ ...editing, sortOrder: Number(e.target.value) })} />
            </Field>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <Button variant="primary" onClick={() => void save()}>
              Save language
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      <Card padded={false}>
        <table>
          <thead>
            <tr>
              <th>Language</th>
              <th>Code</th>
              <th>Status</th>
              <th>Translations</th>
              <th>Order</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(languages.data?.items ?? []).map((language) => (
              <tr key={language.id}>
                <td>
                  <strong>{language.name}</strong>
                  <div style={{ color: t.color.textMuted, fontSize: '0.78rem' }}>{language.nativeName}</div>
                </td>
                <td>{language.code.toUpperCase()}</td>
                <td>{language.enabled ? <Badge tone="success">enabled</Badge> : <Badge tone="neutral">disabled</Badge>}</td>
                <td>{language.translationCount}</td>
                <td>{language.sortOrder}</td>
                <td>
                  {can('settings:write') && (
                    <Button size="sm" variant="ghost" onClick={() => setEditing(language)}>
                      Edit
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {can('settings:write') && (
          <div style={{ padding: 14 }}>
            <Button size="sm" variant="secondary" icon={<Icon name="plus" size={15} />} onClick={() => setEditing({})}>
              Add language
            </Button>
          </div>
        )}
      </Card>

      <Alert tone="info" title="Adding a language is only half the work">
        Every question in the bank needs a translation in the new language before a job can offer it. The question bank
        shows missing translations per question ({titleCase('NEEDS_TRANSLATION')}).
      </Alert>
    </div>
  );
}
