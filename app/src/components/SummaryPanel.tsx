import type { ScoreSummary } from '../../../shared/analysis/summary';

export function SummaryPanel({ summary }: { summary: ScoreSummary }) {
  const s = summary;
  return (
    <section className="card summary">
      <h2>What the app understood</h2>
      <dl>
        <dt>Title</dt>
        <dd>{s.title}{s.composer ? ` — ${s.composer}` : ''}</dd>
        <dt>Key</dt>
        <dd>{s.key}</dd>
        <dt>Doh</dt>
        <dd>{s.doh}</dd>
        <dt>Time</dt>
        <dd>{s.time}</dd>
        <dt>Tempo</dt>
        <dd>{s.tempo}</dd>
        <dt>Bars</dt>
        <dd>{s.bars}{s.pickup ? ' + a pickup bar' : ''}</dd>
        <dt>Parts</dt>
        <dd>{s.parts.join(', ') || 'none'}</dd>
        <dt>Structure</dt>
        <dd>
          <ul>{s.structure.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </dd>
        {s.changes.length > 0 && (
          <>
            <dt>Changes</dt>
            <dd><ul>{s.changes.map((x, i) => <li key={i}>{x}</li>)}</ul></dd>
          </>
        )}
        <dt>Checks</dt>
        <dd>
          <span className={s.counts.error ? 'pill pill-error' : 'pill'}>{s.counts.error} errors</span>{' '}
          <span className={s.counts.warning ? 'pill pill-warning' : 'pill'}>{s.counts.warning} warnings</span>{' '}
          <span className="pill">{s.counts.info} notes</span>
        </dd>
      </dl>
    </section>
  );
}
