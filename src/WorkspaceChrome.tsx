import { Building2, ChevronLeft, ChevronRight, Globe2, Layers3, Search } from 'lucide-react';

export type WorkspaceView = 'engine' | 'signals' | 'buyers';
const navigation = [
  { id: 'engine' as const, label: 'MGX Deal Engine', icon: Layers3 },
  { id: 'signals' as const, label: 'Regional Intent Signals', icon: Globe2 },
  { id: 'buyers' as const, label: 'Potential Sellers', icon: Building2 },
];

export function Sidebar({ collapsed, onToggle, view, onNavigate, country, industry }: {
  collapsed: boolean; onToggle: () => void; view: WorkspaceView; onNavigate: (view: WorkspaceView) => void; country: string; industry: string;
}) {
  return <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Workspace navigation">
    <a className="brand" href="#" onClick={e => { e.preventDefault(); onNavigate('engine') }} aria-label="Mergero home"><span className="brand-symbol">M<span>↗</span></span><img src="/mergero-logo.svg" alt="Mergero" /></a>
    <div className="sidebar-caption">Intelligence platform <span>01</span></div>
    <nav>{navigation.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${view === id ? 'active' : ''}`} title={label} aria-label={label} aria-current={view === id ? 'page' : undefined} onClick={() => onNavigate(id)}><Icon size={18} /><span>{label}</span>{id === 'engine' && <span className="nav-indicator" />}</button>)}</nav>
    <div className="sidebar-context"><span className="micro-label">Your research scope</span><div><Globe2 size={15} /><span>{country || 'Market not selected'}</span></div><div><Building2 size={15} /><span>{industry || 'Industry not selected'}</span></div><p>Public evidence.<br />A more informed approach.</p></div>
    <div className="sidebar-bottom"><div className="workspace-identity"><span>MG</span><div>Mergero workspace<small>Private market intelligence</small></div></div><button className="collapse-button" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}>{collapsed ? <ChevronRight size={17} /> : <><ChevronLeft size={17} /><span>Collapse navigation</span></>}</button></div>
  </aside>;
}

export function WorkspaceHeader({ view, onSearch, researching }: { view: WorkspaceView; onSearch: () => void; researching: boolean }) {
  return <header className="masthead"><div className="breadcrumb">Workspace <span>/</span> <strong>{navigation.find(item => item.id === view)?.label}</strong></div><div className="header-actions"><span className="workspace-tag"><span /> {researching ? 'Research in progress' : 'Research workspace'}</span><button className="icon-button" onClick={onSearch} disabled={researching} aria-label="Search markets and industries" title={researching ? 'Investigation in progress' : 'Search markets and industries'}><Search size={18} /></button><span className="avatar" aria-label="Mergero workspace">M</span></div></header>;
}
