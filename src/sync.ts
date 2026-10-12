import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { collection, doc, initializeFirestore, onSnapshot, setDoc, type Firestore } from 'firebase/firestore';
import { applySharedConfig, getOwner, getSharedConfig, onDuoChange, type SyncStatus } from './db/duo';
import { db, type DuoSession, type DuoWeight, type WeightLog } from './db/schema';
import { canon, hasConfirmedSets, mergeSession } from './domain/duo';

/**
 * Shared store for the couple workout.
 *
 * Dexie stays the source of truth on each phone: everything is saved locally
 * first and this layer only copies records to and from Firestore. It adds and
 * updates, and never deletes anything on either side, so a dropped signal,
 * a failed upload or a restart cannot remove a workout. Whatever failed to
 * upload is simply re-sent next time: every launch, every reconnect, every
 * change.
 *
 * Only sessions, bodyweight and the shared deload/season settings travel.
 * Sleep, work, food and the rest of Atlas never leave the phone.
 *
 * These web config values are public by design; access is controlled by the
 * Firestore rules plus the household code that namespaces the data.
 */
const CONFIG = {
  apiKey: 'AIzaSyCVsSb3gIvwO2shI9HqNPVoQmKbpw915hs',
  authDomain: 'atlas-a688f.firebaseapp.com',
  projectId: 'atlas-a688f',
  storageBucket: 'atlas-a688f.firebasestorage.app',
  messagingSenderId: '628008011465',
  appId: '1:628008011465:web:9decaa7c52afc17dcc6f18',
};

/** Firestore rejects undefined fields. */
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export async function startSync(
  code: string,
  onStatus: (s: SyncStatus) => void,
): Promise<() => void> {
  const app = initializeApp(CONFIG, `atlas-${code}`);
  await signInAnonymously(getAuth(app));
  // Auto-detect long polling so networks and proxies that break Firestore's
  // streaming connection still work.
  const fs: Firestore = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
  const base = `households/${code}`;
  const owner = getOwner();
  const unsubs: (() => void)[] = [];

  // ── Push everything local that has something worth sharing ──────────────
  async function pushAll(): Promise<void> {
    try {
      const sessions = await db.duoSessions.toArray();
      await Promise.all(
        sessions
          .filter(hasConfirmedSets) // an opened-but-empty session isn't a record yet
          .map((s) => setDoc(doc(fs, `${base}/sessions/${s.key}`), clean(s))),
      );
      const own = await db.weightLogs.toArray();
      const other = await db.duoWeights.toArray();
      await Promise.all([
        ...own.map((w) =>
          setDoc(doc(fs, `${base}/weights/${owner}_${w.date}`), {
            profile: owner, date: w.date, kg: w.kg, updatedAt: w.updatedAt ?? w.createdAt ?? 0,
          }),
        ),
        ...other.map((w) =>
          setDoc(doc(fs, `${base}/weights/${w.profile}_${w.date}`), {
            profile: w.profile, date: w.date, kg: w.kg, updatedAt: w.updatedAt,
          }),
        ),
      ]);
      const cfg = await getSharedConfig();
      if (cfg) await setDoc(doc(fs, `${base}/config/shared`), clean(cfg));
    } catch {
      onStatus('error'); // local data is untouched; the next push retries
    }
  }

  let timer: number | undefined;
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void pushAll(), 300);
  };
  unsubs.push(onDuoChange(schedule));
  window.addEventListener('online', schedule);
  unsubs.push(() => window.removeEventListener('online', schedule));
  unsubs.push(() => window.clearTimeout(timer));

  // ── Pull ────────────────────────────────────────────────────────────────
  unsubs.push(
    onSnapshot(
      collection(fs, `${base}/sessions`),
      async (snap) => {
        for (const ch of snap.docChanges()) {
          const remote = ch.doc.data() as DuoSession;
          const local = await db.duoSessions.get(remote.key);
          const merged = local ? mergeSession(local, remote) : remote;
          if (!local || canon(merged) !== canon(local)) await db.duoSessions.put(merged);
          // This phone had sets the other copy lacked: send them back.
          if (canon(merged) !== canon(remote)) schedule();
        }
        onStatus(snap.metadata.fromCache ? 'connecting' : 'synced');
      },
      () => onStatus('error'),
    ),
  );

  unsubs.push(
    onSnapshot(collection(fs, `${base}/weights`), async (snap) => {
      for (const ch of snap.docChanges()) {
        const r = ch.doc.data() as DuoWeight;
        if (r.profile === owner) {
          const l = await db.weightLogs.get(r.date);
          if (!l || r.updatedAt > (l.updatedAt ?? 0)) {
            const row: WeightLog = { date: r.date, kg: r.kg, createdAt: l?.createdAt ?? r.updatedAt, updatedAt: r.updatedAt };
            await db.weightLogs.put(row);
          }
        } else {
          const key = `${r.profile}:${r.date}`;
          const l = await db.duoWeights.get(key);
          if (!l || r.updatedAt > l.updatedAt) await db.duoWeights.put({ key, profile: r.profile, date: r.date, kg: r.kg, updatedAt: r.updatedAt });
        }
      }
    }),
  );

  unsubs.push(
    onSnapshot(doc(fs, `${base}/config/shared`), async (d) => {
      if (d.exists()) await applySharedConfig(d.data() as Parameters<typeof applySharedConfig>[0]);
    }),
  );

  void pushAll();
  return () => unsubs.forEach((u) => u());
}
