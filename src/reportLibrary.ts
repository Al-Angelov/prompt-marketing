import { validOpportunity, type Opportunity } from './marketApi';

const DATABASE = 'mergero-research';
const STORE = 'companies';
export const companyKey = (p: Opportunity) => JSON.stringify([p.company, p.country, p.industry].map(s => s.trim().toLocaleLowerCase()));

export function mergeReports(existing: Opportunity[], incoming: Opportunity[]) {
  const reports = new Map(existing.map(p => [companyKey(p), p]));
  for (const p of incoming) {
    const previous = reports.get(companyKey(p));
    if (!previous || Date.parse(p.report.generated_at) >= Date.parse(previous.report.generated_at)) reports.set(companyKey(p), p);
  }
  return [...reports.values()].sort((a, b) => Date.parse(b.report.generated_at) - Date.parse(a.report.generated_at) || a.company.localeCompare(b.company));
}

function openLibrary(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'key' });
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => db.close(); resolve(db) };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Saved research is currently unavailable.'));
  });
}

export async function loadReports(): Promise<Opportunity[]> {
  const db = await openLibrary();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).getAll();
      request.onsuccess = () => resolve(mergeReports([], request.result.map(row => row?.report).filter(validOpportunity)));
      request.onerror = () => reject(request.error);
    });
  } finally { db.close() }
}

export async function saveReports(reports: Opportunity[]): Promise<void> {
  const db = await openLibrary();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      for (const report of reports) {
        const key = companyKey(report);
        const request = store.get(key);
        request.onsuccess = () => {
          const previous: unknown = request.result?.report;
          if (!validOpportunity(previous) || Date.parse(report.report.generated_at) >= Date.parse(previous.report.generated_at)) store.put({ key, report });
        };
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close() }
}
