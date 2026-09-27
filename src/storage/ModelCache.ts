import type { ModelSource } from "../core/contracts";

const DATABASE_NAME = "taffy-motion-local";
const STORE_NAME = "model-folders";
const RECORD_KEY = "last-opened";

interface CachedFile {
  name: string;
  type: string;
  lastModified: number;
  relativePath: string;
  data: Blob;
}

interface CachedModelFolder {
  id: typeof RECORD_KEY;
  modelRelativePath: string;
  savedAt: number;
  files: CachedFile[];
}

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error("IndexedDB 请求失败。"));
});

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(DATABASE_NAME, 1);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: "id" });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error("无法打开本地模型缓存。"));
});

const withRelativePath = (cached: CachedFile): File => {
  const file = new File([cached.data], cached.name, { type: cached.type, lastModified: cached.lastModified });
  Object.defineProperty(file, "webkitRelativePath", { configurable: true, value: cached.relativePath });
  return file;
};

export async function saveModelFolder(source: ModelSource): Promise<void> {
  if (!globalThis.indexedDB) return;
  const database = await openDatabase();
  try {
    const files: CachedFile[] = source.referenceFiles.map((file) => ({
      name: file.name,
      type: file.type,
      lastModified: file.lastModified,
      relativePath: file.webkitRelativePath || file.name,
      data: file
    }));
    const record: CachedModelFolder = {
      id: RECORD_KEY,
      modelRelativePath: source.modelFile.webkitRelativePath || source.modelFile.name,
      savedAt: Date.now(),
      files
    };
    const transaction = database.transaction(STORE_NAME, "readwrite");
    await requestResult(transaction.objectStore(STORE_NAME).put(record));
  } finally {
    database.close();
  }
}

export async function loadLastModelFolder(): Promise<ModelSource | null> {
  if (!globalThis.indexedDB) return null;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const record = await requestResult(transaction.objectStore(STORE_NAME).get(RECORD_KEY)) as CachedModelFolder | undefined;
    if (!record?.files.length) return null;
    const files = record.files.map(withRelativePath);
    const modelFile = files.find((file) => (file.webkitRelativePath || file.name) === record.modelRelativePath);
    return modelFile ? { modelFile, referenceFiles: files } : null;
  } finally {
    database.close();
  }
}

export async function clearModelCache(): Promise<void> {
  if (!globalThis.indexedDB) return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    await requestResult(transaction.objectStore(STORE_NAME).delete(RECORD_KEY));
  } finally {
    database.close();
  }
}
