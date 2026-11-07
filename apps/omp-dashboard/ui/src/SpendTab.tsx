import { Card, CardTitle, ContentSkeleton, SegmentedControl } from '@kirocrew/app-sdk/ui'
import { ApiEquivalentNote, BreakdownTable, SpendStats, SpendUnavailable } from './spend/SpendBlocks'
import { SPEND_WINDOWS, type SpendWindow } from './spend/spend'
import { useSpend } from './spend/useSpend'

export default function SpendTab({ window, onWindow }: { window: SpendWindow; onWindow: (w: SpendWindow) => void }) {
  const { data, error } = useSpend(window)
  const failure = error ? (error instanceof Error ? error.message : String(error)) : null
  return (
    <div className="od-scroll" data-testid="spend-tab">
      <div className="od-toolbar">
        <SegmentedControl<SpendWindow>
          segments={SPEND_WINDOWS.map(w => ({ key: w, label: w }))}
          value={window}
          onChange={onWindow}
          layoutId="omp-dashboard-spend-window"
          ariaLabel="Spend window"
          collapse={false}
        />
        <ApiEquivalentNote inline />
      </div>
      {failure && <div className="oa-error">Could not load spend: {failure}</div>}
      {!data && !failure && <ContentSkeleton rows={6} />}
      {data && !(data.available && data.summary) && <SpendUnavailable payload={data} />}
      {data?.available && data.summary && (
        <>
          <SpendStats summary={data.summary} />
          <div className="od-grid-even">
            <Card className="oa-card-flush">
              <div className="oa-card-title-pad"><CardTitle>By provider</CardTitle></div>
              <BreakdownTable rows={data.byProvider ?? []} nameLabel="Provider" testId="spend-by-provider" />
            </Card>
            <Card className="oa-card-flush">
              <div className="oa-card-title-pad"><CardTitle>By agent type</CardTitle></div>
              <BreakdownTable rows={data.byAgentType ?? []} nameLabel="Agent type" testId="spend-by-agent-type" />
            </Card>
          </div>
          <Card className="oa-card-flush">
            <div className="oa-card-title-pad"><CardTitle>By model</CardTitle></div>
            <BreakdownTable rows={data.byModel ?? []} nameLabel="Model" testId="spend-by-model" />
          </Card>
        </>
      )}
    </div>
  )
}
