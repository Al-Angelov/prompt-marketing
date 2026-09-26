import { useRef, useState, type ReactNode } from 'react';
import { Download, Search, Upload } from 'lucide-react';
import type { Opportunity } from './marketApi';
import { companyKey, exportLibrary, readLibraryBackup } from './reportLibrary';
import { EmptyResearch } from './ResearchViews';

type Props = {
  reports: Opportunity[]; ready: boolean; saving: boolean; storageError: boolean;
  onResearch: () => void; onImport: (reports: Opportunity[]) => Promise<void>;
  renderCompany: (report: Opportunity, rank: number) => ReactNode;
};

export function LibraryPage({ reports, ready, saving, storageError, onResearch, onImport, renderCompany }: Props) {
  const [query, setQuery] = useState(''), [sort, setSort] = useState('priority');
  const [feedback, setFeedback] = useState(''), [importing, setImporting] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const ranked = [...reports].sort((a, b) => (b.priority ?? -1) - (a.priority ?? -1) || a.company.localeCompare(b.company));
  const ranks = new Map(ranked.map((p, index) => [companyKey(p), index]));
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const visible = ranked.filter(p => terms.every(term => [p.company, p.country, p.industry].join(' ').toLocaleLowerCase().includes(term)));
  if (sort === 'newest') visible.sort((a, b) => Date.parse(b.report.generated_at) - Date.parse(a.report.generated_at) || a.company.localeCompare(b.company));
  if (sort === 'name') visible.sort((a, b) => a.company.localeCompare(b.company));
  function download() {
    const url = URL.createObjectURL(new Blob([exportLibrary(reports)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `mergero-library-${new Date().toISOString().slice(0, 10)}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setFeedback('Library exported with company reports, regional metrics, and source evidence. Keep this file to restore your research later.');
  }
  return <div className="context-page library-page"><p className="eyebrow"><span /> Your research library</p><h1>Potential sellers.</h1><p className="intro">Your researched companies, ranked for a considered approach.</p>
    <p className="library-status" role="status">{!ready ? 'Loading saved research…' : saving ? 'Saving reports on this device…' : storageError ? 'Device storage is unavailable. New reports are kept for this session only; export your library to keep a copy.' : 'Saved on this device. Completed investigations are added automatically.'}</p>
    <div className="library-backup"><button onClick={download} disabled={!reports.length || !ready || importing}><Download size={15} />Export library</button><button onClick={() => upload.current?.click()} disabled={!ready || importing || saving}><Upload size={15} />{importing ? 'Importing…' : 'Import library'}</button>
      <input ref={upload} type="file" accept=".json,application/json" aria-label="Import library" hidden onChange={async e => {
        const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
        setImporting(true); setFeedback('');
        try { const incoming = await readLibraryBackup(file); await onImport(incoming); setFeedback(`Imported ${incoming.length} ${incoming.length === 1 ? 'company' : 'companies'}. Duplicate companies are merged; newer research is kept.`) }
        catch (error) { setFeedback(error instanceof Error ? error.message : 'The import could not be saved. Your existing library is unchanged.') }
        finally { setImporting(false) }
      }} />
    </div><p className="muted ranking-note">Export a backup to keep or transfer your research. This library is stored in this browser, without shared account sync. Clearing browser data removes the local copy.</p>
    {feedback && <p className="library-feedback" role="status">{feedback}</p>}
    {reports.length ? <>
      <div className="library-controls"><label className="library-search"><span>Search saved companies</span><div><Search size={17} /><input type="search" aria-label="Search saved companies" placeholder="Company, country or industry" value={query} onChange={e => setQuery(e.target.value)} /></div></label>
      <label className="library-sort"><span>Sort saved companies</span><select aria-label="Sort saved companies" value={sort} onChange={e => setSort(e.target.value)}><option value="priority">Highest priority</option><option value="newest">Latest research</option><option value="name">Company name</option></select></label></div>
      <div className="library-toolbar"><span>{visible.length} of {reports.length} {reports.length === 1 ? 'company' : 'companies'}</span><span>Ranked by saved Priority Score</span></div>
      <p className="muted ranking-note">Rank indicates research priority, not a probability of becoming a client or an owner's willingness to sell. Review confidence, contradictions and contact readiness in each report. Unscored companies appear last.</p>
      {visible.length ? visible.map(p => <div className="saved-company" key={companyKey(p)}><p className="saved-market">{p.country} · {p.industry} · {new Date(p.report.generated_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</p>{renderCompany(p, ranks.get(companyKey(p))!)}</div>) : <section className="no-matches"><h2>No matching companies.</h2><p>Try a company name, country or industry in your saved research.</p><button onClick={() => setQuery('')}>Clear search</button></section>}
    </> : ready && <EmptyResearch sellers onResearch={onResearch} />}
  </div>;
}
