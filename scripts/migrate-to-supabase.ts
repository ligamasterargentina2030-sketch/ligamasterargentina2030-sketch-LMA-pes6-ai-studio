import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import {
  ensureUploadsBucket,
  getSupabaseAdmin,
  getSupabasePublicObjectUrl,
  getSupabaseServerUrl,
  getSupabaseStorageBucket,
  inferMimeTypeFromPath,
  isSupabaseDbConfigured,
  readLeagueDbFromSupabase,
  uploadBufferToSupabaseStorage,
  writeLeagueDbToSupabase,
} from '../src/server/supabaseBackend.ts';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const ROOT_DIR = process.cwd();
const DB_PATH = path.join(ROOT_DIR, 'data', 'league.json');
const UPLOADS_DIR = path.join(ROOT_DIR, 'data', 'uploads');

function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

interface LegacyLeagueData {
  settings?: {
    adminId?: string;
    adminClave?: string;
    adminClaveHash?: string;
    adminTokenVersion?: number;
    crestUrl?: string;
    coverUrl?: string;
    faviconUrl?: string;
    backgroundUrl?: string;
    featuredVideo?: { videoUrl?: string; downloadUrl?: string } | null;
    [key: string]: unknown;
  };
  teams?: Array<{
    id: string;
    clave?: string;
    claveHash?: string;
    accountStatus?: string;
    tokenVersion?: number;
    crestUrl?: string;
    celebrationImageUrl?: string;
    personalMusic?: Array<{ audioUrl?: string; coverUrl?: string }>;
    lastListenedTrack?: { audioUrl?: string; coverUrl?: string };
    [key: string]: unknown;
  }>;
  matches?: Array<{ proofImageUrl?: string; scorerImageUrl?: string; [key: string]: unknown }>;
  claims?: Array<{ cardPhotoUrl?: string; videoUrl?: string; [key: string]: unknown }>;
  videos?: Array<{ videoUrl?: string; downloadUrl?: string; [key: string]: unknown }>;
  topGoals?: Array<{ videoUrl?: string; [key: string]: unknown }>;
  champions?: Array<{ celebrationImageUrl?: string; [key: string]: unknown }>;
  music?: Array<{ audioUrl?: string; coverUrl?: string; [key: string]: unknown }>;
  news?: Array<{ imageUrl?: string; videoUrl?: string; celebrationImageUrl?: string; [key: string]: unknown }>;
  calendarEvents?: Array<{ homeCrestUrl?: string; awayCrestUrl?: string; [key: string]: unknown }>;
  cup?: Record<string, unknown>;
  [key: string]: unknown;
}

function rewriteUploadUrls(value: unknown, urlMap: Map<string, string>): unknown {
  if (typeof value === 'string') {
    const clean = value.trim();
    if (urlMap.has(clean)) {
      return urlMap.get(clean)!;
    }
    if (clean.startsWith('/LMA-pes6-ai-studio/uploads/')) {
      const normalized = clean.slice('/LMA-pes6-ai-studio'.length);
      if (urlMap.has(normalized)) return urlMap.get(normalized)!;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteUploadUrls(item, urlMap));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = rewriteUploadUrls(v, urlMap);
    }
    return out;
  }
  return value;
}

async function main() {
  const forceOverwriteDb = process.argv.includes('--force');

  if (!isSupabaseDbConfigured()) {
    console.error('❌ Faltan variables de entorno de Supabase.');
    console.error('Definí SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env.local o en tu terminal antes de ejecutar este script.');
    process.exit(1);
  }

  console.log(`🔗 Conectando a Supabase: ${getSupabaseServerUrl()}`);
  getSupabaseAdmin();

  if (!fs.existsSync(DB_PATH)) {
    console.error(`❌ No se encontró el archivo ${DB_PATH}`);
    process.exit(1);
  }

  const rawText = fs.readFileSync(DB_PATH, 'utf8');
  const parsed = JSON.parse(rawText) as LegacyLeagueData;

  // Preservar administrador y contraseñas cifradas (si hubiera alguna clave vieja en texto plano, cifrarla)
  if (parsed.settings) {
    if (!parsed.settings.adminClaveHash) {
      const legacyAdminPlain = String(parsed.settings.adminClave || 'LMA2026').trim() || 'LMA2026';
      parsed.settings.adminClaveHash = hashPassword(legacyAdminPlain);
    }
    delete parsed.settings.adminClave;
    if (typeof parsed.settings.adminTokenVersion !== 'number') {
      parsed.settings.adminTokenVersion = 1;
    }
  }

  if (Array.isArray(parsed.teams)) {
    for (const t of parsed.teams) {
      if (!t.claveHash) {
        const legacyPlain = String(t.clave || t.id.toLowerCase()).trim() || t.id.toLowerCase();
        t.claveHash = hashPassword(legacyPlain);
      }
      delete t.clave;
      if (t.accountStatus !== 'active' && t.accountStatus !== 'blocked') {
        t.accountStatus = 'active';
      }
      if (typeof t.tokenVersion !== 'number') {
        t.tokenVersion = 1;
      }
    }
  }

  // 1. Subir todos los archivos existentes de data/uploads a Supabase Storage
  console.log(`📦 Verificando bucket de Supabase Storage "${getSupabaseStorageBucket()}"...`);
  await ensureUploadsBucket();

  const uploadFiles = walkFiles(UPLOADS_DIR);
  const urlMap = new Map<string, string>();
  console.log(`📤 Subiendo ${uploadFiles.length} archivos existentes desde data/uploads/...`);

  for (const absPath of uploadFiles) {
    const relPosix = path.relative(UPLOADS_DIR, absPath).split(path.sep).join('/');
    const buf = fs.readFileSync(absPath);
    const mime = inferMimeTypeFromPath(absPath);
    const publicUrl = await uploadBufferToSupabaseStorage(buf, relPosix, mime);
    urlMap.set(`/uploads/${relPosix}`, publicUrl);
    console.log(`   ✔ /uploads/${relPosix} → ${getSupabasePublicObjectUrl(relPosix)}`);
  }

  const normalizedDb = rewriteUploadUrls(parsed, urlMap) as LegacyLeagueData;

  // 2. Migrar league.json hacia public.league_store sin pisar datos existentes salvo --force
  let existingRow = null;
  try {
    existingRow = await readLeagueDbFromSupabase<LegacyLeagueData>();
  } catch (err) {
    console.error('❌ Error consultando la tabla public.league_store:', err instanceof Error ? err.message : err);
    console.error('👉 Primero ejecutá el archivo supabase/schema.sql en el SQL Editor de Supabase.');
    process.exit(1);
  }

  if (existingRow && !forceOverwriteDb) {
    console.log('ℹ️  La fila "league_db" ya existe en Supabase (public.league_store).');
    console.log('   Se conservaron los datos actuales de Supabase sin sobrescribirlos.');
    console.log('   Si querés reemplazar explícitamente Supabase con tu data/league.json local, ejecutá: npm run migrate:supabase -- --force');
    console.log(
      `   Resumen actual en Supabase: ${existingRow.data.teams?.length ?? 0} equipos, ${existingRow.data.matches?.length ?? 0} partidos, ${existingRow.data.champions?.length ?? 0} campeones, ${existingRow.data.music?.length ?? 0} pistas.`
    );
    return;
  }

  await writeLeagueDbToSupabase(normalizedDb);
  console.log('✅ Migración completa de data/league.json hacia Supabase (public.league_store).');
  console.log(
    `   Admin ID: ${normalizedDb.settings?.adminId || 'ADMI'} | Equipos/Miembros: ${normalizedDb.teams?.length ?? 0} | Partidos: ${normalizedDb.matches?.length ?? 0} | Campeones: ${normalizedDb.champions?.length ?? 0} | Música: ${normalizedDb.music?.length ?? 0} | Noticias: ${normalizedDb.news?.length ?? 0}`
  );
}

main().catch((err) => {
  console.error('❌ Falló la migración:', err);
  process.exit(1);
});
