import fs from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const LEAGUE_TABLE = 'league_store';
const LEAGUE_ROW_ID = 'league_db';

let cachedAdminClient: SupabaseClient | null = null;
let cachedClientKey = '';
let bucketEnsured = false;

export function getSupabaseServerUrl(): string {
  return (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
    .trim()
    .replace(/\/+$/, '');
}

export function getSupabaseServiceRoleKey(): string {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
}

export function getSupabaseStorageBucket(): string {
  return (process.env.SUPABASE_STORAGE_BUCKET || 'lma-uploads').trim() || 'lma-uploads';
}

export function isSupabaseDbConfigured(): boolean {
  const url = getSupabaseServerUrl();
  const key = getSupabaseServiceRoleKey();
  return Boolean(
    url &&
      key &&
      !url.includes('TU-PROYECTO') &&
      !key.includes('TU_CLAVE') &&
      !key.includes('MY_')
  );
}

export function getSupabaseAdmin(): SupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error('getSupabaseAdmin() nunca debe ejecutarse en el navegador.');
  }
  const url = getSupabaseServerUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) {
    throw new Error(
      'Faltan variables de entorno del servidor: configurá SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.'
    );
  }
  const cacheKey = `${url}::${key.slice(0, 12)}`;
  if (!cachedAdminClient || cachedClientKey !== cacheKey) {
    cachedAdminClient = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    cachedClientKey = cacheKey;
    bucketEnsured = false;
  }
  return cachedAdminClient;
}

export interface StoredLeagueRow<T> {
  data: T;
  version: number;
  updatedAt: string;
}

export async function readLeagueDbFromSupabase<T>(): Promise<StoredLeagueRow<T> | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(LEAGUE_TABLE)
    .select('data, version, updated_at')
    .eq('id', LEAGUE_ROW_ID)
    .maybeSingle();

  if (error) {
    throw new Error(`Error leyendo base de datos en Supabase (${error.message})`);
  }
  if (!data || !data.data) {
    return null;
  }
  return {
    data: data.data as T,
    version: typeof data.version === 'number' ? data.version : Number(data.version) || 1,
    updatedAt: String(data.updated_at || new Date().toISOString()),
  };
}

export async function writeLeagueDbToSupabase<T>(payload: T): Promise<{ updatedAt: string }> {
  const supabase = getSupabaseAdmin();
  const updatedAt = new Date().toISOString();

  const { error } = await supabase.from(LEAGUE_TABLE).upsert(
    {
      id: LEAGUE_ROW_ID,
      data: payload as Record<string, unknown>,
      updated_at: updatedAt,
    },
    { onConflict: 'id' }
  );

  if (error) {
    throw new Error(`Error guardando base de datos en Supabase (${error.message})`);
  }
  return { updatedAt };
}

export async function ensureUploadsBucket(): Promise<void> {
  if (bucketEnsured) return;
  const supabase = getSupabaseAdmin();
  const bucket = getSupabaseStorageBucket();

  const { data: existing, error: getError } = await supabase.storage.getBucket(bucket);
  if (!getError && existing) {
    bucketEnsured = true;
    return;
  }

  const { error: createError } = await supabase.storage.createBucket(bucket, {
    public: true,
    fileSizeLimit: 104857600,
  });

  if (createError && !/already exists/i.test(createError.message)) {
    throw new Error(`No se pudo verificar/crear el bucket "${bucket}" en Supabase Storage: ${createError.message}`);
  }
  bucketEnsured = true;
}

export function getSupabasePublicObjectUrl(storageRelPath: string): string {
  const cleanRel = storageRelPath.replace(/^\/+/, '');
  const baseUrl = getSupabaseServerUrl();
  const bucket = getSupabaseStorageBucket();
  return `${baseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${cleanRel
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;
}

export function inferMimeTypeFromPath(filePath: string, fallbackMime?: string): string {
  if (fallbackMime && fallbackMime !== 'application/octet-stream') {
    return fallbackMime;
  }
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.jfif': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.avif': 'image/avif',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
  };
  return map[ext] || fallbackMime || 'application/octet-stream';
}

export async function uploadBufferToSupabaseStorage(
  buffer: Buffer,
  storageRelPath: string,
  contentType?: string
): Promise<string> {
  await ensureUploadsBucket();
  const supabase = getSupabaseAdmin();
  const bucket = getSupabaseStorageBucket();
  const cleanRel = storageRelPath.replace(/^\/+/, '');
  const resolvedType = inferMimeTypeFromPath(cleanRel, contentType);

  const { error } = await supabase.storage.from(bucket).upload(cleanRel, buffer, {
    contentType: resolvedType,
    upsert: true,
    cacheControl: '31536000',
  });

  if (error) {
    throw new Error(`Error subiendo archivo "${cleanRel}" a Supabase Storage: ${error.message}`);
  }

  return getSupabasePublicObjectUrl(cleanRel);
}

export async function uploadFileToSupabaseStorage(
  localFilePath: string,
  subdir: string,
  filename: string,
  contentType?: string
): Promise<string> {
  const buffer = fs.readFileSync(localFilePath);
  const relPath = `${subdir.replace(/^\/+|\/+$/g, '')}/${filename.replace(/^\/+/, '')}`;
  return uploadBufferToSupabaseStorage(buffer, relPath, contentType);
}
