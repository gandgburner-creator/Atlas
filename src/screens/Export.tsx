import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '../components/Button';
import { PushHeader, YesNo } from '../components/Chrome';
import { SketchBorder, SketchCard } from '../components/Sketch';
import {
  backupFilename,
  buildBackup,
  isFromNewerBuild,
  looksLikeBackup,
  restoreBackup,
} from '../db/backup';
import { getExportReminder, saveExportReminder } from '../db/config';
import { buildAnalysisMarkdown, type AnalysisRange } from '../domain/analysis';

/**
 * Two formats, one screen: a full JSON backup (restorable exactly as it
 * was) and a plain-markdown analysis meant to be pasted straight into a
 * chat. Neither is gated behind "are you sure" except restore, which
 * overwrites everything currently stored.
 */
export function ExportScreen({ today }: { today: string }) {
  const [includePhotos, setIncludePhotos] = useState(true);
  const [backupBusy, setBackupBusy] = useState(false);

  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreDone, setRestoreDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [range, setRange] = useState<AnalysisRange>('30');
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [markdownBusy, setMarkdownBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const reminder = useLiveQuery(() => getExportReminder(), []);

  async function downloadBackup() {
    setBackupBusy(true);
    try {
      const data = await buildBackup(includePhotos);
      const filename = backupFilename(today);
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const file = new File([blob], filename, { type: 'application/json' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }
    } finally {
      setBackupBusy(false);
    }
  }

  function pickRestoreFile(file: File) {
    setRestoreFile(file);
    setConfirmingRestore(true);
    setRestoreError(null);
    setRestoreDone(false);
  }

  async function confirmRestore() {
    if (!restoreFile) return;
    setRestoreBusy(true);
    setRestoreError(null);
    try {
      const text = await restoreFile.text();
      const data: unknown = JSON.parse(text);
      if (!looksLikeBackup(data)) {
        setRestoreError("That file doesn't look like an Atlas backup.");
        return;
      }
      if (isFromNewerBuild(data)) {
        setRestoreError(
          'That backup was made by a newer version of Atlas. Update first — ' +
            'restoring it here would drop whatever this build does not know about.',
        );
        return;
      }
      await restoreBackup(data);
      setConfirmingRestore(false);
      setRestoreFile(null);
      setRestoreDone(true);
    } catch {
      setRestoreError('Could not read that file.');
    } finally {
      setRestoreBusy(false);
    }
  }

  async function generateMarkdown() {
    setMarkdownBusy(true);
    try {
      setMarkdown(await buildAnalysisMarkdown(range, today));
      setCopied(false);
    } finally {
      setMarkdownBusy(false);
    }
  }

  async function copyMarkdown() {
    if (!markdown) return;
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
  }

  async function shareMarkdown() {
    if (!markdown) return;
    if (navigator.share) {
      try {
        await navigator.share({ text: markdown, title: 'Atlas analysis' });
        return;
      } catch {
        /* user cancelled the share sheet — fall through to clipboard */
      }
    }
    await copyMarkdown();
  }

  return (
    <div className="flex flex-col gap-5">
      <PushHeader title="export" />

      <SketchCard className="px-4 pt-4 pb-4">
        <span className="hand text-[26px]">full backup</span>
        <p className="caption mt-0.5">
          Every table, as one JSON file — restorable exactly as it was.
          Filename: {backupFilename(today)}
        </p>
        <div className="mt-3 flex items-center justify-between">
          <span className="hand text-[19px] text-[var(--ink-muted)]">include photos</span>
          <YesNo value={includePhotos} onChange={setIncludePhotos} />
        </div>
        {!includePhotos && (
          <p className="caption mt-1">Photos will be left out — they dominate the file size.</p>
        )}
        <Button className="mt-3 w-full" onClick={downloadBackup} disabled={backupBusy}>
          {backupBusy ? 'Preparing…' : 'Export backup'}
        </Button>
      </SketchCard>

      <SketchCard filter="rough2" className="px-4 pt-4 pb-4">
        <span className="hand text-[26px]">restore from backup</span>
        <p className="caption mt-0.5">
          Rebuilds the database from a backup file — replaces everything
          currently stored.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) pickRestoreFile(file);
            e.target.value = '';
          }}
        />
        {confirmingRestore && restoreFile ? (
          <div className="mt-3 flex flex-col gap-2">
            <p className="caption text-[var(--accent)]">
              Replace everything currently stored with {restoreFile.name}?
              This can't be undone.
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => {
                  setConfirmingRestore(false);
                  setRestoreFile(null);
                }}
              >
                Cancel
              </Button>
              <Button className="flex-1" onClick={confirmRestore} disabled={restoreBusy}>
                {restoreBusy ? 'Restoring…' : 'Restore'}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" className="mt-3 w-full" onClick={() => fileRef.current?.click()}>
            Choose a backup file
          </Button>
        )}
        {restoreError && <p className="caption mt-2 text-[var(--accent)]">{restoreError}</p>}
        {restoreDone && (
          <p className="caption mt-2 text-[var(--success)]">Restored — everything's back.</p>
        )}
      </SketchCard>

      <SketchCard className="px-4 pt-4 pb-4">
        <span className="hand text-[26px]">analysis export</span>
        <p className="caption mt-0.5">
          A plain-markdown summary to paste straight into a chat — no ids,
          no timestamps, just readable numbers.
        </p>
        <div className="mt-3 flex gap-2">
          {(['7', '30', 'all'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className="relative flex-1 py-2 text-[13.5px] font-semibold"
              style={
                range === r
                  ? { background: 'var(--btn-fill)', color: 'var(--btn-text)', borderRadius: 999 }
                  : { color: 'var(--ink-muted)' }
              }
            >
              {range !== r && <SketchBorder radius={999} strokeWidth={1.8} stroke="var(--rule)" />}
              <span className="relative">{r === 'all' ? 'everything' : `last ${r} days`}</span>
            </button>
          ))}
        </div>
        <Button variant="secondary" className="mt-3 w-full" onClick={generateMarkdown} disabled={markdownBusy}>
          {markdownBusy ? 'Building…' : 'Generate'}
        </Button>
        {markdown && (
          <div className="mt-3 flex flex-col gap-2">
            <textarea
              readOnly
              value={markdown}
              rows={8}
              className="w-full bg-[var(--sunk)] p-3 text-[12px] font-mono leading-snug"
            />
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={copyMarkdown}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button className="flex-1" onClick={shareMarkdown}>
                Share
              </Button>
            </div>
          </div>
        )}
      </SketchCard>

      {reminder && (
        <SketchCard filter="rough2" className="px-4 pt-4 pb-4">
          <div className="flex items-center justify-between">
            <span className="hand text-[24px]">weekly reminder</span>
            <YesNo
              value={reminder.enabled}
              onChange={(v) => void saveExportReminder({ ...reminder, enabled: v })}
            />
          </div>
          <p className="caption mt-0.5">
            A Sunday nudge on the home screen to back up or paste an update
            into a chat.
          </p>
        </SketchCard>
      )}
    </div>
  );
}
