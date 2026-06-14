import { useState, Fragment } from 'react'
import { MapPin, Trash2, Plus, X, Loader2, GripVertical } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { buildTimeline } from '../../lib/tripUtils'
import { api } from '../../services/api'
import { useT } from '../../contexts/LanguageContext'
import PlaceCard from './PlaceCard'
import PlaceSearch from './PlaceSearch'
import TransitSegment from './TransitSegment'
import ActiveLegFocus from './ActiveLegFocus'

function SortablePlaceWrapper({ id, children, dragDisabled }) {
  const { t } = useT()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: dragDisabled })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative',
  }
  return (
    <div ref={setNodeRef} style={style}>
      {!dragDisabled && (
        <div
          {...attributes}
          {...listeners}
          className="absolute left-1 top-1/2 -translate-y-1/2 z-10 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-400 p-1 touch-none"
          title={t('dpDragReorder')}
        >
          <GripVertical size={14} />
        </div>
      )}
      {children}
    </div>
  )
}

function formatDayLabel(legs, t) {
  const placeCount = legs.length > 0 ? legs.length + 1 : 0
  if (placeCount === 0) return t('dpNoStopsYet')
  const cost = legs.reduce((s, l) => s + (l.cost_sgd ?? 0), 0)
  return `${t('tripStopsCount', placeCount)}${cost > 0 ? ` · S$${cost.toFixed(2)}` : ''}`
}

export default function DayPlan({
  day,
  legs,
  tripId,
  onLegUpdated,
  placesById = {},
  placeIds = [],
  // Active leg props (tripStarted mode)
  isActiveDay = false,
  activeLegIndex = 0,
  position = null,
  onArrive,
  weatherAlert,
  transitAlert,
  transitVariant = 'mrt',
  onSwitchToBus,
  onApproveSwap,
  onDismissWeather,
  onDismissTransit,
  virtualStartLeg = null,
  onVirtualArrive,
}) {
  const { t } = useT()
  const [expanded, setExpanded] = useState({ place: null })
  const [notes, setNotes] = useState({})
  const [dayNotes, setDayNotes] = useState('')
  const [showAddSearch, setShowAddSearch] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [reordering, setReordering] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const timeline = buildTimeline(legs ?? [], placesById, placeIds)
  const dayLabel = formatDayLabel(legs ?? [], t)
  const placeItems = timeline.filter(t => t.type === 'place').map(t => t.data.id)

  const handleDragEnd = async (event) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = placeItems.indexOf(active.id)
    const newIndex = placeItems.indexOf(over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const newOrder = arrayMove(placeItems, oldIndex, newIndex)
    setReordering(true)
    try {
      await api.reorderPlaces(tripId, day, newOrder)
      await onLegUpdated()
    } catch { /* revert on error — refresh will restore original */ }
    finally { setReordering(false) }
  }

  const togglePlace = (id) =>
    setExpanded((e) => ({ place: e.place === id ? null : id }))

  return (
    <div className="space-y-1 animate-fade-up">
      {/* Section header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-baseline gap-2">
          <h2 className="font-display font-extrabold text-[20px] text-slate-900">{t('tripDay', day)}</h2>
          <span className="text-slate-300">·</span>
          <span className="text-[14px] text-slate-600">{dayLabel}</span>
        </div>
      </div>

      {/* Active leg view (tripStarted mode) */}
      {isActiveDay ? (
        <ActiveLegFocus
          legs={legs ?? []}
          placesById={placesById}
          position={position}
          activeLegIndex={activeLegIndex}
          onArrive={onArrive}
          weatherAlert={weatherAlert}
          transitAlert={transitAlert}
          transitVariant={transitVariant}
          onSwitchToBus={onSwitchToBus}
          onApproveSwap={onApproveSwap}
          onDismissWeather={onDismissWeather}
          onDismissTransit={onDismissTransit}
          virtualStartLeg={virtualStartLeg}
          onVirtualArrive={onVirtualArrive}
        />
      ) : (
        <>
          {/* Empty state */}
          {timeline.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white/40 p-10 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400 mb-2">
                <MapPin size={20} />
              </div>
              <div className="font-display font-bold text-[15px] text-slate-700">{t('dpNoPlaces')}</div>
              <div className="text-[12.5px] text-slate-500 mt-1">
                {t('dpNoPlacesDesc')}
              </div>
            </div>
          )}

          {/* Timeline — drag-and-drop enabled when tripId present */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={placeItems} strategy={verticalListSortingStrategy}>
          {timeline.map((item, i) => (
            <Fragment key={`${item.type}-${i}`}>
              {item.type === 'place' ? (
                <SortablePlaceWrapper id={item.data.id} dragDisabled={!tripId || isActiveDay || reordering}>
                <div className="relative group/place">
                  <PlaceCard
                    place={item.data}
                    index={item.index}
                    expanded={expanded.place === item.data.id}
                    onToggle={() => togglePlace(item.data.id)}
                    notes={notes[item.data.id]}
                    onNotesChange={(v) => setNotes((n) => ({ ...n, [item.data.id]: v }))}
                  />
                  {/* Delete button — appears on hover */}
                  {tripId && onLegUpdated && (
                    <button
                      onClick={async () => {
                        if (deletingId) return
                        setDeletingId(item.data.id)
                        try {
                          await api.removePlaceFromDay(tripId, item.data.id)
                          await onLegUpdated()
                        } catch { /* leave UI unchanged on error */ }
                        finally { setDeletingId(null) }
                      }}
                      disabled={deletingId === item.data.id}
                      className="absolute top-2 right-2 grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-500 transition opacity-0 group-hover/place:opacity-100"
                      title={t('tripRemovePlace')}
                    >
                      {deletingId === item.data.id
                        ? <Loader2 size={11} className="animate-spin" />
                        : <Trash2 size={11} />}
                    </button>
                  )}
                </div>
                </SortablePlaceWrapper>
              ) : (
                <TransitSegment
                  leg={item.data}
                  tripId={tripId}
                  fromPlace={placesById[item.data.from_place_id]}
                  toPlace={placesById[item.data.to_place_id]}
                  onUpdated={onLegUpdated}
                />
              )}
            </Fragment>
          ))}
            </SortableContext>
          </DndContext>

          {/* Add place button */}
          {tripId && !isActiveDay && (
            <div className="pl-12 mt-2">
              {showAddSearch ? (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-semibold text-indigo-700">{t('dpAddPlaceToDay', day)}</span>
                    <button
                      onClick={() => setShowAddSearch(false)}
                      className="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-slate-200"
                    >
                      <X size={12} />
                    </button>
                  </div>
                  <PlaceSearch
                    addedIds={new Set((timeline.filter(t => t.type === 'place').map(t => t.data.id)))}
                    onAdd={async (place) => {
                      setShowAddSearch(false)
                      try {
                        await api.addPlaceToDay(tripId, { place_id: place.id, day })
                        await onLegUpdated()
                      } catch { /* ignore */ }
                    }}
                  />
                </div>
              ) : (
                <button
                  onClick={() => setShowAddSearch(true)}
                  className="w-full h-9 rounded-xl border-2 border-dashed border-slate-300 text-[13px] font-semibold text-slate-500 hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50/30 transition inline-flex items-center justify-center gap-2"
                >
                  <Plus size={13} /> {t('tripAddPlace')}
                </button>
              )}
            </div>
          )}

          {/* Day notes (only if there are places) */}
          {timeline.length > 0 && (
            <div className="relative pl-12 mt-5">
              <div className="rounded-2xl border border-slate-200 bg-white shadow-card p-4">
                <label className="text-[12.5px] font-semibold text-slate-600 block mb-2">{t('dpDayNotes')}</label>
                <textarea
                  rows={2}
                  value={dayNotes}
                  onChange={(e) => setDayNotes(e.target.value)}
                  placeholder={t('dpDayNotesPlaceholder')}
                  className="w-full rounded-md border border-slate-200 bg-slate-50/30 px-3 py-2 text-[13px] placeholder:text-slate-400 focus-ring focus:border-indigo-400 resize-none"
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
