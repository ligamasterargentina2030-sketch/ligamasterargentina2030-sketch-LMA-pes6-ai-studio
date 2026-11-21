# Security Specification (Phase 0 — Payload-First Security TDD)

## 1. Data Invariants
1. **Master Admin Authority**: Only verified administrator accounts (`ligamasterargentina2030@gmail.com` or `cristiandiazdevelez@gmail.com` with `email_verified == true`, or a document in `/admins/{request.auth.uid}`) may create, edit, or delete teams, fixtures, calendar events, news, rules, cup brackets, official music, official videos, top goals, champions, backups, audit logs, or private league configuration.
2. **No Self-Privilege Escalation**: No non-admin user may write to `/admins/{uid}` or `/league_private/{docId}` or `/team_credentials/{teamId}` or set `role: 'admin'`.
3. **Member Submission Boundaries**:
   - Members may ONLY submit `matches` with `status == 'pending'` and `submittedByUid == request.auth.uid`. They CANNOT self-validate (`status == 'validated'`), edit, or delete matches.
   - Members may ONLY submit `claims` with `status == 'pending'` and `reporterUid == request.auth.uid`. They CANNOT resolve or delete claims.
   - Verified users may ONLY submit `comments` with `status == 'pending'` and `authorUid == request.auth.uid`. They CANNOT self-approve (`status == 'approved'`) or delete comments.
   - Verified users may ONLY submit `videos_comunidad` with `authorUid == request.auth.uid` and a valid `.mp4` / CDN URL. Only Admin may delete or feature videos.
4. **Team Profile Isolation**:
   - Members mapped to `teamId` via `/members/{request.auth.uid}` (with `status == 'active'`) may ONLY update `bio`, `celebrationImageUrl`, `celebrationStatus`, `celebrationUploadedAt`, `personalMusic`, `lastListenedTrack`, `trophies`, and `updatedAt` on their own `/teams/{teamId}` document — never `id`, `name`, `memberName`, `accountStatus`, or `likes` arbitrarily.
5. **Atomic Likes**:
   - Page, team, and news likes require creating `/likes/{uid}_{targetType}_{targetId}` atomically in the same batch as incrementing `pageLikes` / `likes` by `+1`. Direct arbitrary edits to `likes` or `pageLikes` by non-admins are forbidden.
6. **PII & Secret Isolation**:
   - Private admin configuration (`/league_private/*`), member credential hashes (`/team_credentials/*`), backups (`/backups/*`), and security audit logs (`/audit_log/*`) are strictly restricted to `isAdmin()`.
7. **Temporal & Structural Integrity**:
   - All single-document path IDs match `^[a-zA-Z0-9_\-]+$` (`size() <= 128`).
   - All strings have explicit `.size()` bounds and arrays have `.size()` bounds.
   - Unrecognized/ghost fields are blocked on both `create` and `update` via `keys().hasOnly(...)` and `affectedKeys().hasOnly(...)`.

## 2. The "Dirty Dozen" Attack Payloads
1. **Unauthenticated Write to Teams**: Unauthenticated client calls `setDoc(doc(db, 'teams', 'HACK01'), { ... })` -> MUST return `PERMISSION_DENIED`.
2. **Member Admin-Escalation**: Non-admin user attempts `setDoc(doc(db, 'admins', memberUid), { uid: memberUid, email: 'x@test.com', createdAt: serverTimestamp() })` -> MUST return `PERMISSION_DENIED`.
3. **Member Self-Validated Match**: Verified member submits `matches/m_hack` with `status: 'validated'` -> MUST return `PERMISSION_DENIED`.
4. **Member Impersonating Another User on Match Submit**: Member submits `matches/m_hack2` with `status: 'pending'` and `submittedByUid: 'someone_else'` -> MUST return `PERMISSION_DENIED`.
5. **Member Deleting Official News**: Verified member calls `deleteDoc(doc(db, 'news', 'news_1'))` -> MUST return `PERMISSION_DENIED`.
6. **Member Editing Cup Bracket**: Verified member calls `updateDoc(doc(db, 'cup', 'current'), { championTeamName: 'My Team' })` -> MUST return `PERMISSION_DENIED`.
7. **Member Approving Own Comment**: Verified member creates `comments/c_hack` with `status: 'approved'` -> MUST return `PERMISSION_DENIED`.
8. **Shadow/Ghost Field Injection**: User or admin attempt injects unknown key `isSuperAdmin: true` into `/teams/LMA01` or `/comments/c1` -> MUST return `PERMISSION_DENIED`.
9. **Like Inflation Attack**: Verified user calls `updateDoc(doc(db, 'teams', 'LMA01'), { likes: 999999 })` without atomic `/likes/{id}` write -> MUST return `PERMISSION_DENIED`.
10. **PII / Credential Leak Read**: Non-admin user calls `getDoc(doc(db, 'team_credentials', 'LMA01'))` or `getDoc(doc(db, 'league_private', 'admin_config'))` -> MUST return `PERMISSION_DENIED`.
11. **Path Variable Poisoning**: Request uses oversized >128 char or special-char doc ID (`a`.repeat(200) or `../bad`) -> MUST return `PERMISSION_DENIED`.
12. **Unverified Email Spoof**: Auth context has `email: 'ligamasterargentina2030@gmail.com'` with `email_verified: false` -> `isAdmin()` returns `false` and writes return `PERMISSION_DENIED`.
