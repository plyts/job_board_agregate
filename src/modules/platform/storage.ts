import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** Stockage des documents (CV importés, offres en PDF, exports). S3 compatible en production. */
export interface ObjectStorage {
  put(key: string, body: Buffer, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

// Clés générées par le serveur uniquement : segments alphanumériques, jamais de « .. ».
const KEY_PATTERN = /^[a-z0-9-]+(\/[a-z0-9-]+)*(\.[a-z0-9]{1,8})?$/;

export function assertValidKey(key: string): void {
  if (!KEY_PATTERN.test(key) || key.length > 300) throw new Error(`Clé de stockage invalide : ${key}`);
}

export class LocalFsStorage implements ObjectStorage {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    assertValidKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Chemin hors du stockage");
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body, { flag: "wx" }); // jamais d'écrasement silencieux
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}

let storage: ObjectStorage | undefined;
export function getStorage(): ObjectStorage {
  storage ??= new LocalFsStorage(process.env.STORAGE_DIR ?? path.resolve(".data/storage"));
  return storage;
}
