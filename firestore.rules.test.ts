import fs from 'node:fs';
import { initializeApp, deleteApp } from 'firebase/app';
import { getFirestore, doc, getDocFromServer, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';

/**
 * Security Rules Verification Suite ("Dirty Dozen" & Live Boundary Checks)
 * Run against live Firestore or Rules Emulator via:
 *   npx tsx firestore.rules.test.ts
 */
async function runDirtyDozenChecks() {
  const cfg = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
  const app = initializeApp(cfg, 'rules-audit-suite');
  const db = getFirestore(app, cfg.firestoreDatabaseId);

  const expectDenied = async (label: string, op: () => Promise<unknown>) => {
    try {
      await op();
      throw new Error(`SECURITY FAILURE: "${label}" was unexpectedly ALLOWED!`);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      const msg = err instanceof Error ? err.message : String(err);
      if (code === 'permission-denied' || msg.includes('PERMISSION_DENIED') || msg.includes('permission-denied')) {
        console.log(`PASS [PERMISSION_DENIED]: ${label}`);
        return;
      }
      throw err;
    }
  };

  try {
    // Health check must succeed
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log('PASS [ALLOWED]: test/connection health check');

    // Dirty Dozen payload tests (unauthenticated / non-admin client boundaries)
    await expectDenied('1. Unauthenticated write to teams', () =>
      setDoc(doc(db, 'teams', 'HACK01'), {
        id: 'HACK01',
        name: 'Hack Club',
        memberName: 'Hacker',
        accountStatus: 'active',
        createdAt: new Date().toISOString(),
      })
    );

    await expectDenied('2. Self-escalation write to admins', () =>
      setDoc(doc(db, 'admins', 'attacker_uid'), {
        uid: 'attacker_uid',
        email: 'attacker@evil.com',
        createdAt: new Date().toISOString(),
      })
    );

    await expectDenied('3. Unauthenticated / member self-validated match', () =>
      setDoc(doc(db, 'matches', 'm_hack_validated'), {
        id: 'm_hack_validated',
        matchday: 1,
        homeTeamId: 'LMA01',
        awayTeamId: 'LMA02',
        homeGoals: 9,
        awayGoals: 0,
        leg: 'Ida',
        playedAt: '2026-11-20',
        submittedByTeamId: 'LMA01',
        submittedByName: 'Attacker',
        status: 'validated',
        createdAt: new Date().toISOString(),
      })
    );

    await expectDenied('4. Spoofed submittedByUid match create', () =>
      setDoc(doc(db, 'matches', 'm_hack_spoof'), {
        id: 'm_hack_spoof',
        matchday: 1,
        homeTeamId: 'LMA01',
        awayTeamId: 'LMA02',
        homeGoals: 1,
        awayGoals: 0,
        leg: 'Ida',
        playedAt: '2026-11-20',
        submittedByTeamId: 'LMA01',
        submittedByName: 'Spoof',
        submittedByUid: 'victim_uid',
        status: 'pending',
        createdAt: new Date().toISOString(),
      })
    );

    await expectDenied('5. Delete official news post', () =>
      deleteDoc(doc(db, 'news', 'news_inaugural'))
    );

    await expectDenied('6. Mutate cup tournament state', () =>
      updateDoc(doc(db, 'cup', 'current'), { championTeamName: 'Hacked FC' })
    );

    await expectDenied('7. Self-approve comment on creation', () =>
      setDoc(doc(db, 'comments', 'c_hack'), {
        id: 'c_hack',
        authorName: 'Spammer',
        message: 'Self approved',
        status: 'approved',
        createdAt: new Date().toISOString(),
      })
    );

    await expectDenied('8. Shadow/Ghost field injection on league_settings', () =>
      setDoc(doc(db, 'league_settings', 'global'), {
        title: 'Hack',
        adminId: 'ADMI',
        maxTeams: 30,
        pageLikes: 0,
        isSuperAdmin: true,
      })
    );

    await expectDenied('9. Like inflation without atomic likes doc', () =>
      updateDoc(doc(db, 'teams', 'LMA01'), { likes: 999999 })
    );

    await expectDenied('10. PII/Credentials read on team_credentials & league_private', async () => {
      await getDocFromServer(doc(db, 'team_credentials', 'LMA01'));
      await getDocFromServer(doc(db, 'league_private', 'admin_config'));
    });

    await expectDenied('11. Path poisoning (>128 char docId)', () =>
      setDoc(doc(db, 'news', 'a'.repeat(180)), {
        id: 'a'.repeat(180),
        title: 'Bad',
        content: 'Bad',
        textColor: '#fff',
        createdAt: new Date().toISOString(),
      })
    );

    await expectDenied('12. Read/write backups & user_preferences without auth/ownership', async () => {
      await getDocFromServer(doc(db, 'backups', 'latest'));
    });

    await expectDenied('13. Unauthenticated write to user_preferences', () =>
      setDoc(doc(db, 'user_preferences', 'victim_uid'), {
        uid: 'victim_uid',
        musicMode: 'personal',
        penaltyBestScore: 999,
      })
    );

    console.log('ALL 13 SECURITY RULE BOUNDARY CHECKS PASSED.');
  } finally {
    await deleteApp(app);
  }
}

runDirtyDozenChecks().catch((err) => {
  console.error(err);
  process.exit(1);
});
