// @ts-ignore: Cannot find module or type declarations for side-effect import of './App.css'
import './App.css';
import React, { useMemo, useState } from 'react';

type IconName = 'calendar' | 'chevron' | 'copy' | 'download' | 'external' | 'flag' | 'group' | 'medal' | 'pencil' | 'refresh' | 'route' | 'sparkles' | 'tick' | 'trophy';

type Result = {
  athleteId?: string;
  name: string;
  event: string;
  time: string;
  totalRuns: number;
  eventRuns?: number;
  coursePb?: boolean;
  allTimePb?: boolean;
  firstTimer?: boolean;
  position?: number;
  verified?: boolean;
};

type Milestone = {
  result: Result;
  count: number;
  kind: 'overall' | 'event';
};

type ReportSuggestion = {
  id: string;
  title: string;
  text: string;
  reason: string;
};

type ReportStatus = {
  phase: string;
  message: string;
  completed?: number;
  total?: number;
  browserUrl?: string | null;
};

const CLUB_NUMBER = '22631';

function latestSaturday() {
  const today = new Date();
  const saturday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  saturday.setDate(saturday.getDate() - ((saturday.getDay() + 1) % 7));
  const year = saturday.getFullYear();
  const month = String(saturday.getMonth() + 1).padStart(2, '0');
  const day = String(saturday.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function todayIso() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const LATEST_PARKRUN_DATE = latestSaturday();
const TODAY = todayIso();

const milestoneNumbers = new Set([10, 25, 50, 100, 250, 300, 400, 500]);

function findMilestones(items: Result[]): Milestone[] {
  return items.flatMap((result) => {
    const found: Milestone[] = [];
    if (milestoneNumbers.has(result.totalRuns)) found.push({ result, count: result.totalRuns, kind: 'overall' });
    if (result.eventRuns && milestoneNumbers.has(result.eventRuns)) found.push({ result, count: result.eventRuns, kind: 'event' });
    return found;
  });
}

function findSuggestions(items: Result[]): ReportSuggestion[] {
  const coincidences = items.flatMap((item) => {
    const parts = item.time.split(':').map(Number);
    if (parts.length !== 2) return [];
    const [minutes, seconds] = parts;
    if (minutes === seconds && item.position === minutes) {
      return [{ id: `triple-${item.name}`, title: 'A perfect triple', text: `${item.name} ran ${item.time} and finished in ${item.position}st place 😅`, reason: 'Matching time and finish position' }];
    }
    if (minutes === seconds) {
      return [{ id: `mirror-${item.name}`, title: 'A satisfying finish time', text: `${item.name} crossed the line in a perfectly matching ${item.time} ⏱️`, reason: 'Matching minutes and seconds' }];
    }
    return [];
  });

  const eventGroups = items.reduce<Record<string, number>>((groups, item) => {
    groups[item.event] = (groups[item.event] || 0) + 1;
    return groups;
  }, {});
  const biggestGroup = Object.entries(eventGroups).sort((a, b) => b[1] - a[1])[0];
  return [...coincidences, ...(biggestGroup && biggestGroup[1] >= 10 ? [{
    id: 'biggest-group',
    title: 'Big NBRG turnout',
    text: `${biggestGroup[1]} NBRG runners took part at ${biggestGroup[0]} this week 👏`,
    reason: 'The largest NBRG group at one event',
  }] : [])];
}

function suggestionDefaults(items: ReportSuggestion[]) {
  return items.reduce<Record<string, boolean>>((choices, suggestion) => {
  choices[suggestion.id] = suggestion.id.startsWith('triple-');
  return choices;
  }, {});
}

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
    download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 21h14"/></>,
    external: <><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/></>,
    flag: <><path d="M5 21V4"/><path d="M5 5c5-3 7 3 14 0v9c-7 3-9-3-14 0"/></>,
    group: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    medal: <><circle cx="12" cy="14" r="6"/><path d="m8 9-3-6h5l2 5 2-5h5l-3 6M12 11v6"/></>,
    pencil: <><path d="m4 20 4.2-1 10.9-10.9a2.1 2.1 0 0 0-3-3L5.2 16Z"/><path d="m14.5 6.5 3 3"/></>,
    refresh: <><path d="M20 6v6h-6"/><path d="M4 18v-6h6"/><path d="M18.5 9a7 7 0 0 0-11.8-2.3L4 9M20 15l-2.7 2.3A7 7 0 0 1 5.5 15"/></>,
    route: <><circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h3a3 3 0 0 0 0-6h2a3 3 0 0 0 3-3V8"/></>,
    sparkles: <><path d="m12 3 1.3 3.7L17 8l-3.7 1.3L12 13l-1.3-3.7L7 8l3.7-1.3Z"/><path d="m6 14 .8 2.2L9 17l-2.2.8L6 20l-.8-2.2L3 17l2.2-.8Z"/><path d="m18.5 14 .6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6Z"/></>,
    tick: <path d="m5 12 4 4L19 6"/>,
    trophy: <><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0Z"/><path d="M7 6H4v2a4 4 0 0 0 4 4M17 6h3v2a4 4 0 0 1-4 4"/></>,
  };
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
}

function weekday(value: string) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
}

function britishNumericDate(value: string) {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function buildPost(date: string, items: Result[], memberCount: number, eventCount: number, reportSuggestions: ReportSuggestion[], suggestionChoices: Record<string, boolean>, customNote = '') {
  const milestones = findMilestones(items);
  const pbs = items.filter((item) => item.coursePb && !item.firstTimer);
  const byEvent = (items: Result[]) => items.reduce<Record<string, Result[]>>((groups, item) => {
    (groups[item.event] ||= []).push(item);
    return groups;
  }, {});
  const eventLines = (items: Result[], label: (item: Result) => string) => Object.entries(byEvent(items))
    .map(([event, people]) => `${event}\n${people.map(label).join('\n')}`).join('\n\n');
  const milestoneGroups = milestones.reduce<Record<string, Milestone[]>>((groups, milestone) => {
    (groups[milestone.result.event] ||= []).push(milestone);
    return groups;
  }, {});
  const milestoneLines = Object.entries(milestoneGroups).map(([event, achievements]) => `${event}\n${achievements.map(({ result, count, kind }) =>
    kind === 'overall'
      ? `${result.name} — ${count}th parkrun 🎈`
      : `${result.name} — ${count}th at this event 🎯`
  ).join('\n')}`).join('\n\n');
  const selectedExtras = reportSuggestions.filter((suggestion) => suggestionChoices[suggestion.id]).map((suggestion) => suggestion.text);
  const pbLines = eventLines(pbs, (r) => `${r.name} — ${r.time}${r.allTimePb ? ' · ALL-TIME PB 🌟' : ' · course PB'}`);
  const sections = [
    milestoneLines ? `🏆 MILESTONES\n${milestoneLines}` : '',
    pbLines ? `🎉 PERSONAL BESTS\n${pbLines}` : '',
    selectedExtras.length ? `✨ EXTRA HIGHLIGHTS\n${selectedExtras.map((line) => `• ${line}`).join('\n')}` : '',
    customNote.trim() ? `📝 MOMENT OF THE WEEK\n${customNote.trim()}` : '',
  ].filter(Boolean);

  return `Good afternoon! Here is this week's parkrun report for ${formatDate(date)} 🏃\n\nThere were ${memberCount} NBRG family members across ${eventCount} events.${sections.length ? `\n\n${sections.join('\n\n')}` : ''}\n\nWell done to everyone! If we've missed your PB or milestone, please let us know.\n\n😇 parkrun can't happen without volunteers. Please consider missing a run now and then to help out, or combine your run with a volunteer role. 😇`;
}

function SectionHeading({ icon, title, count, tone }: { icon: IconName; title: string; count: number; tone: string }) {
  return <div className="section-heading">
    <span className={`section-icon ${tone}`}><Icon name={icon} size={19} /></span>
    <h3>{title}</h3>
    <span className="count">{count}</span>
  </div>;
}

const App: React.FC = () => {
  const [date, setDate] = useState(LATEST_PARKRUN_DATE);
  const [generated, setGenerated] = useState(false);
  const [reportResults, setReportResults] = useState<Result[]>([]);
  const [memberCount, setMemberCount] = useState(0);
  const [eventCount, setEventCount] = useState(0);
  const [suggestions, setSuggestions] = useState<ReportSuggestion[]>([]);
  const [suggestionChoices, setSuggestionChoices] = useState<Record<string, boolean>>({});
  const [post, setPost] = useState('');
  const [copied, setCopied] = useState(false);
  const [customNote, setCustomNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<ReportStatus>({ phase: 'idle', message: 'Checking the club results and athlete histories.' });
  const [error, setError] = useState('');
  const [profileFailures, setProfileFailures] = useState(0);

  const milestones = useMemo(() => findMilestones(reportResults), [reportResults]);
  const pbs = useMemo(() => reportResults.filter((item) => item.coursePb && !item.firstTimer), [reportResults]);
  const allTimePbs = useMemo(() => pbs.filter((item) => item.allTimePb), [pbs]);

  const generate = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setLoadingStatus({ phase: 'starting', message: 'Starting the parkrun report.' });
    setError('');
    const checkStatus = async () => {
      try {
        const response = await fetch('/api/parkrun-report/status', { cache: 'no-store' });
        if (!response.ok) return;
        const next = await response.json();
        if (next.phase !== 'idle') setLoadingStatus(next);
      } catch {
        // The main report request will surface any server/network error.
      }
    };
    const statusTimer = window.setInterval(checkStatus, 1500);
    try {
      const response = await fetch(`/api/parkrun-report?date=${encodeURIComponent(date)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load the parkrun report');
      const results = data.results as Result[];
      const liveSuggestions = findSuggestions(results);
      const choices = suggestionDefaults(liveSuggestions);
      setReportResults(results);
      setMemberCount(data.memberCount);
      setEventCount(data.eventCount);
      setSuggestions(liveSuggestions);
      setSuggestionChoices(choices);
      setProfileFailures(data.profileFailures?.length || 0);
      setPost(buildPost(date, results, data.memberCount, data.eventCount, liveSuggestions, choices, customNote));
      setGenerated(true);
      window.setTimeout(() => document.getElementById('report')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load the parkrun report');
    } finally {
      window.clearInterval(statusTimer);
      setLoading(false);
    }
  };

  const refreshPreview = () => {
    setPost(buildPost(date, reportResults, memberCount, eventCount, suggestions, suggestionChoices, customNote));
  };

  const toggleSuggestion = (id: string) => {
    const next = { ...suggestionChoices, [id]: !suggestionChoices[id] };
    setSuggestionChoices(next);
    setPost(buildPost(date, reportResults, memberCount, eventCount, suggestions, next, customNote));
  };

  const applyCustomNote = () => setPost(buildPost(date, reportResults, memberCount, eventCount, suggestions, suggestionChoices, customNote));

  const copyPost = async () => {
    try {
      await navigator.clipboard.writeText(post);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      const textarea = document.getElementById('post-copy') as HTMLTextAreaElement | null;
      textarea?.select();
      document.execCommand('copy');
      setCopied(true);
    }
  };

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="https://www.nbrg.uk/" target="_blank" rel="noreferrer" aria-label="North Bristol Running Group website">
        <img src="https://www.nbrg.uk/content/images/logowhite.png" alt="North Bristol Running Group logo" />
        <span><b>NBRG</b><small>weekly report</small></span>
      </a>
      <div className="club-chip"><span className="club-dot" /> North Bristol Running Group</div>
    </header>

    <main id="top">
      <section className="hero">
        <form className="generator-card" onSubmit={generate}>
          <div className="card-title">
            <span><Icon name="flag" size={20} /></span>
            <div><h2>NBRG parkrun report</h2><p>Choose a parkrun date</p></div>
          </div>
          <label htmlFor="date">parkrun date</label>
          <div className="input-wrap date-input">
            <span className="date-display" aria-hidden="true">{britishNumericDate(date)}</span>
            <Icon name="calendar" size={18} />
            <input
              id="date"
              type="date"
              aria-label={`parkrun date, ${britishNumericDate(date)}`}
              value={date}
              max={TODAY}
              onClick={(event) => (event.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.()}
              onChange={(event) => {
                setDate(event.target.value || LATEST_PARKRUN_DATE);
                setGenerated(false);
                setError('');
              }}
            />
          </div>
          <label htmlFor="custom-note">Moment of the week <span className="optional">Optional</span></label>
          <div className="input-wrap note-input">
            <Icon name="pencil" size={18} />
            <input id="custom-note" type="text" placeholder="e.g. Fancy dress at Three Brooks" value={customNote} onChange={(e) => setCustomNote(e.target.value)} />
          </div>
          <div className="live-connect">
            <span><i className="live-dot" /> Live parkrun data</span>
            <p>Uses the NBRG club report and each runner’s full result history.</p>
            <a className="official-report-button" href={`https://www.parkrun.com/results/consolidatedclub/?clubNum=${CLUB_NUMBER}&eventdate=${date}`} target="_blank" rel="noreferrer">View official NBRG report <Icon name="external" size={13}/></a>
          </div>
          {error && <div className="load-error">{error}</div>}
          <button className="primary-button" type="submit" disabled={loading}><Icon name={loading ? 'refresh' : 'sparkles'} size={18} /> {loading ? 'Checking club and athlete results…' : 'Generate live report'}</button>
          {loading && <div className="loading-status" role="status" aria-live="polite">
            <span className="loading-spinner" />
            <div>
              <strong>{loadingStatus.phase === 'waiting_for_captcha' ? 'Security check needs you' : 'Building the report'}</strong>
              <small>{loadingStatus.message}{loadingStatus.total ? ` (${loadingStatus.completed || 0}/${loadingStatus.total})` : ''}</small>
              {loadingStatus.phase === 'waiting_for_captcha' && loadingStatus.browserUrl && <a className="browser-console-link" href={loadingStatus.browserUrl} target="_blank" rel="noreferrer">Open secure browser <Icon name="external" size={13}/></a>}
            </div>
          </div>}
        </form>
      </section>

      {generated && <section className="report-section" id="report">
        <div className="report-header">
          <div>
            <h2>{weekday(date)}'s roundup</h2>
            <p>{formatDate(date)} · {memberCount} real result rows analysed</p>
          </div>
        </div>

        <div className={`coverage-banner ${profileFailures ? 'partial' : ''}`}>
          <span><Icon name={profileFailures ? 'refresh' : 'tick'} size={14}/></span>
          <strong>{profileFailures ? 'Report partially checked' : 'Live data verified'}</strong>
          <small>{profileFailures ? `${profileFailures} athlete profiles could not be checked` : 'All athlete profiles matched'}</small>
        </div>

        <div className="stats-grid">
          <div className="stat-card"><span className="stat-icon green"><Icon name="group" /></span><div><strong>{memberCount}</strong><span>members ran</span></div><small>From the club report</small></div>
          <div className="stat-card"><span className="stat-icon blue"><Icon name="route" /></span><div><strong>{eventCount}</strong><span>different events</span></div><small>Unique event names</small></div>
          <div className="stat-card"><span className="stat-icon amber"><Icon name="medal" /></span><div><strong>{milestones.length}</strong><span>milestones</span></div><small>Worth celebrating</small></div>
          <div className="stat-card"><span className="stat-icon coral"><Icon name="trophy" /></span><div><strong>{pbs.length}</strong><span>course PBs</span></div><small>{allTimePbs.length} all-time best</small></div>
        </div>

        <div className="content-grid">
          <div className="findings-card">
            <div className="findings-top"><div><h2>This week's highlights</h2><p>Confirmed from the club report and dated athlete histories</p></div></div>

            {milestones.length > 0 && <div className="findings-section">
              <SectionHeading icon="medal" title="Milestones" count={milestones.length} tone="amber" />
              <div className="milestone-list">
                {milestones.map(({ result, count, kind }) => <div className="person-row" key={`${result.name}-${kind}`}>
                  <span className="avatar">{result.name.split(' ').map((n) => n[0]).join('')}</span>
                  <div><strong>{result.name}</strong><span>{result.event}</span></div>
                  <span className={`milestone-badge ${kind === 'event' ? 'event-badge' : ''}`}>{count}<small>{kind === 'overall' ? 'total runs' : `at event`}</small></span>
                </div>)}
              </div>
            </div>}

            {pbs.length > 0 && <div className="findings-section">
              <SectionHeading icon="trophy" title="Personal bests" count={pbs.length} tone="coral" />
              <div className="pb-table">
                {pbs.map((item) => <div className="pb-row" key={item.name}>
                  <div><strong>{item.name}</strong><span>{item.event}</span></div>
                  <strong className="time">{item.time}</strong>
                  <span className={item.allTimePb ? 'tag alltime' : 'tag'}>{item.allTimePb ? '★ All-time PB' : 'Course PB'}</span>
                </div>)}
              </div>
              <div className="first-timer-note"><Icon name="tick" size={15}/><span>First-time visits are excluded from PBs</span></div>
            </div>}

            <div className="findings-section suggestions-section">
              <div className="suggestions-heading">
                <div>
                  <span className="suggestion-kicker"><Icon name="sparkles" size={14}/> Suggested extras</span>
                  <h3>Anything unusual in the results?</h3>
                  <p>Include or dismiss each suggestion.</p>
                </div>
                <span className="review-count">{suggestions.length} found</span>
              </div>
              <div className="suggestion-list">
                {suggestions.map((suggestion) => <div className={`suggestion-row ${suggestionChoices[suggestion.id] ? 'included' : ''}`} key={suggestion.id}>
                  <span className="suggestion-symbol">{suggestion.id === 'volunteers' ? '💜' : suggestion.id === 'tourism' ? '🌍' : '✨'}</span>
                  <div><strong>{suggestion.title}</strong><p>{suggestion.text}</p><small>{suggestion.reason}</small></div>
                  <button type="button" className={suggestionChoices[suggestion.id] ? 'include-button active' : 'include-button'} onClick={() => toggleSuggestion(suggestion.id)}>
                    {suggestionChoices[suggestion.id] ? <><Icon name="tick" size={13}/> Included</> : 'Include'}
                  </button>
                </div>)}
              </div>
              <div className="custom-highlight">
                <div><strong>Moment of the week</strong><span>Manually add something the results cannot tell us</span></div>
                <input aria-label="Moment of the week" value={customNote} onChange={(e) => setCustomNote(e.target.value)} placeholder="Type a moment…" />
                <button type="button" onClick={applyCustomNote}>Update report</button>
              </div>
            </div>

          </div>

          <aside className="post-card">
            <div className="post-card-head">
              <div className="post-card-title"><span>Facebook post</span><strong>Ready to share</strong></div>
              <div className="post-head-actions">
                <button className="refresh-button" type="button" onClick={refreshPreview}><Icon name="refresh" size={16} /> Refresh preview</button>
              </div>
            </div>
            <textarea id="post-copy" aria-label="Facebook post text" value={post} onChange={(e) => setPost(e.target.value)} />
            <div className="post-actions">
              <button className="copy-button" onClick={copyPost}><Icon name={copied ? 'tick' : 'copy'} size={17}/>{copied ? 'Copied!' : 'Copy for Facebook'}</button>
              <button className="download-button" aria-label="Download report" onClick={() => {
                const blob = new Blob([post], { type: 'text/plain' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = `nbrg-parkrun-${date}.txt`;
                link.click();
                URL.revokeObjectURL(link.href);
              }}><Icon name="download" size={18}/></button>
            </div>
            <p className="edit-hint"><Icon name="pencil" size={13}/> Click in the report to make any final edits</p>
          </aside>
        </div>
      </section>}
    </main>

    <footer><span><img src="https://www.nbrg.uk/content/images/logowhite.png" alt="" /> Built for North Bristol Running Group</span><span>Data sourced from public parkrun results · Not affiliated with parkrun</span></footer>
  </div>;
};

export default App;
