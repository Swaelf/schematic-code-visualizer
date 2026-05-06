import type { AppTab } from '../../types'

type TabNavProps = {
  activeTab: AppTab
  setActiveTab: (tab: AppTab) => void
}

const TABS: Array<{ id: AppTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'board', label: 'Board' },
  { id: 'dependencies', label: 'Dependencies' },
  { id: 'diagnostics', label: 'Diagnostics' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'about', label: 'About' },
]

export function TabNav({ activeTab, setActiveTab }: TabNavProps) {
  return (
    <section className="panel tab-nav">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={activeTab === tab.id ? 'is-active' : ''}
          onClick={() => setActiveTab(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </section>
  )
}
