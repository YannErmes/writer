import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type Flag = {
  id: string
  name: string
  color: string
  prompt: string
}

type FlaggedRange = {
  id: string
  start: number
  end: number
  flagId: string
  note: string
  context: string
  currentText: string
  originalText: string
  swapped: boolean
}

type Session = {
  id: string
  title: string
  keywords: string[]
  body: string
  flags: Flag[]
  ranges: FlaggedRange[]
  vocabulary: string[]
  copyVocabularyWithContent: boolean
}

const PALETTE = ['#b25b41', '#7a8f6d', '#a77e2d', '#5c7a8f', '#8c5b4e', '#6d7c5c']
const STORAGE_KEY = 'speak-straight-sessions'
const VOCABULARY_COPY_PROMPT = 'If any of the words in this vocabulary list could fit well, please reuse them. If not, offer other strong and relevant alternatives.'

function createId() {
  return Math.random().toString(36).slice(2, 10)
}

function readSessions() {
  if (typeof window === 'undefined') {
    return [] as Session[]
  }

  const saved = window.localStorage.getItem(STORAGE_KEY)
  if (!saved) {
    return [] as Session[]
  }

  try {
    const parsed = JSON.parse(saved)
    if (!Array.isArray(parsed)) {
      return [] as Session[]
    }

    return parsed.map((session: any) => ({
      id: typeof session.id === 'string' ? session.id : createId(),
      title: typeof session.title === 'string' ? session.title : '',
      keywords: Array.isArray(session.keywords)
        ? (session.keywords as unknown[]).filter((keyword): keyword is string => typeof keyword === 'string')
        : [],
      body: typeof session.body === 'string' ? session.body : '',
      flags: Array.isArray(session.flags) ? session.flags : [],
      ranges: Array.isArray(session.ranges) ? session.ranges : [],
      vocabulary: Array.isArray(session.vocabulary)
        ? (session.vocabulary as unknown[]).filter((item): item is string => typeof item === 'string')
        : [],
      copyVocabularyWithContent: typeof session.copyVocabularyWithContent === 'boolean' ? session.copyVocabularyWithContent : false,
    })) as Session[]
  } catch {
    return [] as Session[]
  }
}

function buildSegments(body: string, ranges: FlaggedRange[]) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const segments: Array<{ text: string; range?: FlaggedRange }> = []
  let cursor = 0

  sorted.forEach((range) => {
    if (range.start < cursor) {
      return
    }

    if (range.start > cursor) {
      segments.push({ text: body.slice(cursor, range.start) })
    }

    segments.push({ text: body.slice(range.start, range.end), range })
    cursor = range.end
  })

  if (cursor < body.length) {
    segments.push({ text: body.slice(cursor) })
  }

  return segments
}

function overlap(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && endA > startB
}

function getSelectionOffsets(selection: Selection | null, container: HTMLElement | null) {
  if (!selection || !container || selection.rangeCount === 0) {
    return null
  }

  try {
    const range = selection.getRangeAt(0)
    const beforeStart = document.createRange()
    beforeStart.setStart(container, 0)
    beforeStart.setEnd(range.startContainer, range.startOffset)
    const beforeEnd = document.createRange()
    beforeEnd.setStart(container, 0)
    beforeEnd.setEnd(range.endContainer, range.endOffset)

    return {
      start: beforeStart.toString().length,
      end: beforeEnd.toString().length,
    }
  } catch {
    return null
  }
}

function normalizeOffsets(body: string, start: number, end: number, selectionText: string) {
  const candidate = body.slice(start, end)
  if (candidate === selectionText) {
    return { start, end }
  }

  const index = body.indexOf(selectionText, Math.max(0, start - 20))
  if (index !== -1) {
    return { start: index, end: index + selectionText.length }
  }

  return { start, end }
}

function App() {
  const [sessions, setSessions] = useState<Session[]>(() => readSessions())
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftKeywords, setDraftKeywords] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [bodyMode, setBodyMode] = useState<'compose' | 'preview'>('compose')
  const [selectionState, setSelectionState] = useState<{
    x: number
    y: number
    start: number
    end: number
    text: string
  } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [newFlagName, setNewFlagName] = useState('')
  const [activeRangeId, setActiveRangeId] = useState<string | null>(null)
  const [contextMode, setContextMode] = useState(false)
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number } | null>(null)
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [newVocabularyTerm, setNewVocabularyTerm] = useState('')
  const textContainerRef = useRef<HTMLDivElement | null>(null)

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  )

  const activeRange = useMemo(() => {
    if (!activeSession || !activeRangeId) {
      return null
    }

    return activeSession.ranges.find((range) => range.id === activeRangeId) ?? null
  }, [activeRangeId, activeSession])

  const wordCount = useMemo(() => {
    const text = bodyMode === 'compose' ? draftBody : activeSession?.body ?? ''
    const m = text.trim().match(/\S+/g)
    return m ? m.length : 0
  }, [bodyMode, draftBody, activeSession?.body])

  const segments = useMemo(() => {
    return buildSegments(activeSession?.body ?? '', activeSession?.ranges ?? [])
  }, [activeSession])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  }, [sessions])

  useEffect(() => {
    if (sessions.length > 0 && !activeSessionId) {
      setActiveSessionId(sessions[0].id)
    }
  }, [activeSessionId, sessions])

  useEffect(() => {
    if (!activeSession) {
      return
    }

    if (activeRangeId && !activeSession.ranges.some((range) => range.id === activeRangeId)) {
      setActiveRangeId(null)
    }
  }, [activeRangeId, activeSession])

  useEffect(() => {
    if (!activeRange) {
      setNoteDraft('')
      return
    }

    setNoteDraft(activeRange.note)
  }, [activeRange])

  const patchSession = (updater: (session: Session) => Session) => {
    if (!activeSessionId) {
      return
    }

    setSessions((prev) => prev.map((session) => (session.id === activeSessionId ? updater(session) : session)))
  }

  const createSession = () => {
    const title = draftTitle.trim()
    if (!title) {
      setMessage('Give the session a title before continuing.')
      return
    }

    const newSession: Session = {
      id: createId(),
      title,
      keywords: draftKeywords
        .split(',')
        .map((keyword) => keyword.trim())
        .filter(Boolean),
      body: '',
      flags: [],
      ranges: [],
      vocabulary: [],
      copyVocabularyWithContent: false,
    }

    setSessions((prev) => [newSession, ...prev])
    setActiveSessionId(newSession.id)
    setDraftTitle('')
    setDraftKeywords('')
    setDraftBody('')
    setBodyMode('compose')
    setMessage('Session created. Paste your draft and save it to begin flagging.')
  }

  const saveDraftBody = () => {
    if (!activeSession) {
      return
    }

    patchSession((session) => ({ ...session, body: draftBody }))
    setBodyMode('preview')
    setSelectionState(null)
    setMessage('Text saved. Select a passage to flag it.')
  }

  const reopenEditor = () => {
    if (!activeSession) {
      return
    }

    setDraftBody(activeSession.body)
    setBodyMode('compose')
    setSelectionState(null)
  }

  const handleSelection = () => {
    if (!activeSession || bodyMode !== 'preview') {
      return
    }

    const selection = window.getSelection()
    const selectionText = selection?.toString() ?? ''
    if (!selectionText.trim()) {
      setSelectionState(null)
      return
    }

    const offsets = getSelectionOffsets(selection, textContainerRef.current)
    if (!offsets) {
      return
    }

    const start = Math.min(offsets.start, offsets.end)
    const end = Math.max(offsets.start, offsets.end)
    const rect = selection?.getRangeAt(0).getBoundingClientRect()
    const popupX = rect ? rect.left + rect.width / 2 : 120
    const popupY = rect ? rect.top - 14 : 120

    if (contextMode && activeRange) {
      updateRangeContext(selectionText)
      setContextMode(false)
      setSelectionState(null)
      setMessage('Context attached from the selection.')
      return
    }

    const overlaps = activeSession.ranges.some((range) => overlap(start, end, range.start, range.end))
    if (overlaps) {
      setSelectionState(null)
      setMessage('That selection overlaps an existing flag.')
      return
    }

    const normalized = normalizeOffsets(activeSession.body, start, end, selectionText)
    setSelectionState({ x: popupX, y: popupY, start: normalized.start, end: normalized.end, text: selectionText })
  }

  const applyFlag = (flagId: string) => {
    if (!activeSession || !selectionState) {
      return
    }

    const newRange: FlaggedRange = {
      id: createId(),
      start: selectionState.start,
      end: selectionState.end,
      flagId,
      note: '',
      context: '',
      currentText: activeSession.body.slice(selectionState.start, selectionState.end),
      originalText: activeSession.body.slice(selectionState.start, selectionState.end),
      swapped: false,
    }

    patchSession((session) => ({
      ...session,
      ranges: [...session.ranges, newRange],
    }))
    setSelectionState(null)
    setNewFlagName('')
    setMessage('Flag added.')
  }

  const createFlagAndApply = () => {
    const name = newFlagName.trim()
    if (!activeSession || !selectionState || !name) {
      return
    }

    const nextColor = PALETTE[activeSession.flags.length % PALETTE.length]
    const newFlag: Flag = {
      id: createId(),
      name,
      color: nextColor,
      prompt: 'Find a better word or phrase to express this.',
    }

    const newRange: FlaggedRange = {
      id: createId(),
      start: selectionState.start,
      end: selectionState.end,
      flagId: newFlag.id,
      note: '',
      context: '',
      currentText: activeSession.body.slice(selectionState.start, selectionState.end),
      originalText: activeSession.body.slice(selectionState.start, selectionState.end),
      swapped: false,
    }

    patchSession((session) => ({
      ...session,
      flags: [...session.flags, newFlag],
      ranges: [...session.ranges, newRange],
    }))
    setSelectionState(null)
    setNewFlagName('')
    setMessage(`Flag “${name}” created and applied.`)
  }

  const openNote = (range: FlaggedRange, event: React.MouseEvent<HTMLSpanElement> | React.TouchEvent<HTMLSpanElement>) => {
    if (!activeSession) {
      return
    }

    const rect = event.currentTarget.getBoundingClientRect()
    let x = rect.left + rect.width / 2
    let y = rect.top - 24

    const popupWidth = Math.min(416, window.innerWidth - 32)
    const popupHeight = 400

    x = Math.max(0, Math.min(x - popupWidth / 2, window.innerWidth - popupWidth))
    y = Math.max(0, Math.min(y, window.innerHeight - popupHeight))

    setActiveRangeId(range.id)
    setPopupPosition({ x, y })
    setDragOffset(null)
    setContextMode(false)
    setMessage('Edit the replacement and swap it into the manuscript.')
  }

  const buildCopyPayload = (range: FlaggedRange, includeVocabulary = false) => {
    const flag = activeSession?.flags.find((item) => item.id === range.flagId)
    if (!flag) {
      return ''
    }

    const lines: string[] = [
      `Flagged text: ${range.currentText}`,
      `Prompt: ${flag.prompt}`,
    ]

    if (range.note) {
      lines.push(`Replacement: ${range.note}`)
    }

    if (range.context) {
      lines.push(`Context: ${range.context}`)
    }

    if (includeVocabulary && activeSession?.vocabulary.length) {
      lines.push(`Vocabulary: ${activeSession.vocabulary.join(', ')}`)
      lines.push(VOCABULARY_COPY_PROMPT)
    }

    return lines.join('\n')
  }

  const copyRange = async (range: FlaggedRange, includeVocabulary = false) => {
    const body = buildCopyPayload(range, includeVocabulary)
    if (!body) {
      return
    }

    await navigator.clipboard.writeText(body)
    setMessage('Copied to clipboard.')
  }

  const updateActiveRangeNote = (value: string) => {
    if (!activeRangeId) {
      return
    }

    patchSession((session) => ({
      ...session,
      ranges: session.ranges.map((range) => (range.id === activeRangeId ? { ...range, note: value } : range)),
    }))
  }

  const updateRangeContext = (value: string) => {
    if (!activeRangeId) {
      return
    }

    patchSession((session) => ({
      ...session,
      ranges: session.ranges.map((range) => (range.id === activeRangeId ? { ...range, context: value } : range)),
    }))
  }

  const addActiveRangeToVocabulary = () => {
    if (!activeSession || !activeRange) {
      return
    }

    const term = activeRange.currentText.trim()
    if (!term) {
      return
    }

    patchSession((session) => ({
      ...session,
      vocabulary: Array.from(new Set([term, ...session.vocabulary])),
    }))
    setMessage('Added to vocabulary list.')
  }

  const toggleCopyVocabularyWithContent = () => {
    if (!activeSession) {
      return
    }

    patchSession((session) => ({
      ...session,
      copyVocabularyWithContent: !session.copyVocabularyWithContent,
    }))
  }

  const copyAllForFlag = async (flagId: string) => {
    if (!activeSession) {
      return
    }

    const ranges = activeSession.ranges.filter((range) => range.flagId === flagId)
    if (!ranges.length) {
      setMessage('No flagged items found for that tag.')
      return
    }

    const body = ranges
      .map((range, index) => `Item ${index + 1}:\n${buildCopyPayload(range, activeSession.copyVocabularyWithContent)}`)
      .join('\n\n---\n\n')

    await navigator.clipboard.writeText(body)
    setMessage('Copied all items for that tag.')
  }

  const copyAllFlagged = async () => {
    if (!activeSession) {
      return
    }

    if (!activeSession.ranges.length) {
      setMessage('No flagged items to copy.')
      return
    }

    const body = activeSession.ranges
      .map((range, index) => `Item ${index + 1}:\n${buildCopyPayload(range, activeSession.copyVocabularyWithContent)}`)
      .join('\n\n===\n\n')

    await navigator.clipboard.writeText(body)
    setMessage('Copied all flagged content.')
  }

  const swapRange = () => {
    if (!activeSession || !activeRange) {
      return
    }

    const replacement = noteDraft.trim() || activeRange.currentText
    const start = activeRange.start
    const end = activeRange.end
    const before = activeSession.body.slice(0, start)
    const after = activeSession.body.slice(end)
    const newBody = before + replacement + after
    const delta = replacement.length - (end - start)

    patchSession((session) => ({
      ...session,
      body: newBody,
      ranges: session.ranges.map((range) => {
        if (range.id === activeRange.id) {
          return {
            ...range,
            start,
            end: start + replacement.length,
            currentText: replacement,
            originalText: range.currentText,
            note: range.currentText,
            swapped: true,
          }
        }

        if (range.start >= end) {
          return {
            ...range,
            start: range.start + delta,
            end: range.end + delta,
          }
        }

        return range
      }),
    }))

    setActiveRangeId(null)
    setPopupPosition(null)
    setContextMode(false)
    setMessage('Swap applied. The original wording is preserved in the note history.')
  }

  const deleteRange = () => {
    if (!activeSession || !activeRange) {
      return
    }

    patchSession((session) => ({
      ...session,
      ranges: session.ranges.filter((range) => range.id !== activeRange.id),
    }))
    setActiveRangeId(null)
    setPopupPosition(null)
    setContextMode(false)
    setMessage('Flag removed from this instance.')
  }

  const reassignRangeFlag = (flagId: string) => {
    if (!activeRangeId) {
      return
    }

    patchSession((session) => ({
      ...session,
      ranges: session.ranges.map((range) => (range.id === activeRangeId ? { ...range, flagId } : range)),
    }))
  }

  const updateFlag = (flagId: string, patch: Partial<Flag>) => {
    patchSession((session) => ({
      ...session,
      flags: session.flags.map((flag) => (flag.id === flagId ? { ...flag, ...patch } : flag)),
    }))
  }

  return (
    <div className="app-shell">
      <header className="hero-card">
        <div>
          <p className="eyebrow">Speak Straight</p>
          <h1>Make every line feel a little less borrowed.</h1>
          <p className="hero-copy">
            Flag weak phrasing, collect better alternatives, and swap them back into your draft without losing the original wording.
          </p>
        </div>
        <div className="hero-panel">
          <h2>Sessions</h2>
          {sessions.length === 0 ? (
            <p className="muted">No sessions yet. Start with a title and a few keywords.</p>
          ) : (
            <ul className="session-list">
              {sessions.map((session) => (
                <li key={session.id}>
                  <button type="button" className={session.id === activeSession?.id ? 'session-pill active' : 'session-pill'} onClick={() => { setActiveSessionId(session.id); setBodyMode(session.body ? 'preview' : 'compose'); setSelectionState(null); setMessage(null) }}>
                    <strong>{session.title}</strong>
                    <span>{session.body ? 'Draft ready' : 'New draft'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      <main className="workspace-grid">
        <aside className="panel create-panel">
          <h2>New session</h2>
          <label>
            <span>Title</span>
            <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="A speech, essay, or note" />
          </label>
          <label>
            <span>Keywords</span>
            <input value={draftKeywords} onChange={(event) => setDraftKeywords(event.target.value)} placeholder="filler, cliché, weak verb" />
          </label>
          <button type="button" className="primary" onClick={createSession}>Create session</button>
          {activeSession && (
            <div className="session-meta">
              <h3>{activeSession.title}</h3>
              <p>{activeSession.keywords.length > 0 ? activeSession.keywords.join(', ') : 'No keywords yet.'}</p>
            </div>
          )}
        </aside>

        <section className="panel editor-panel">
          {activeSession ? (
            <>
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Active draft</p>
                  <h2>{activeSession.title}</h2>
                  <div className="word-count">Words: {wordCount}</div>
                </div>
                <div className="button-row">
                  {bodyMode === 'preview' ? (
                    <button type="button" className="secondary" onClick={reopenEditor}>Edit text</button>
                  ) : (
                    <button type="button" className="secondary" onClick={saveDraftBody}>Save text</button>
                  )}
                </div>
              </div>

              {bodyMode === 'compose' ? (
                <>
                  <textarea value={draftBody} onChange={(event) => setDraftBody(event.target.value)} placeholder="Paste or write your draft here..." />
                  <p className="hint">Once you save it, the manuscript becomes selectable so you can flag any phrase.</p>
                  <p className="draft-count">Current words: {wordCount}</p>
                </>
              ) : (
                <div className="text-shell">
                  <div
                    ref={textContainerRef}
                    className="text-body"
                    onMouseUp={handleSelection}
                    onTouchEnd={handleSelection}
                    onBlur={() => setSelectionState(null)}
                  >
                    {segments.map((segment, index) => {
                      if (!segment.range) {
                        return <span key={`plain-${index}`}>{segment.text}</span>
                      }

                      const flag = activeSession.flags.find((item) => item.id === segment.range?.flagId)
                      const isCurrentlySwapped = segment.range && segment.range.currentText !== segment.range.originalText
                      return (
                        <span
                          key={`${segment.range.id}-${index}`}
                          className={isCurrentlySwapped ? 'flagged swapped' : 'flagged'}
                          style={{ borderColor: flag?.color ?? '#b25b41' }}
                          onClick={(event) => {
                            event.stopPropagation()
                            copyRange(segment.range!)
                          }}
                          onDoubleClick={(event) => {
                            event.stopPropagation()
                            openNote(segment.range!, event)
                          }}
                          onTouchStart={(event) => {
                            const timer = window.setTimeout(() => {
                              openNote(segment.range!, event)
                            }, 450)
                            event.currentTarget.dataset.timer = String(timer)
                          }}
                          onTouchEnd={(event) => {
                            const timer = Number(event.currentTarget.dataset.timer || 0)
                            if (timer) {
                              window.clearTimeout(timer)
                            }
                            copyRange(segment.range!, activeSession?.copyVocabularyWithContent)
                          }}
                          onMouseEnter={() => setMessage(`${flag?.name ?? 'Flagged'} — ${flag?.prompt ?? ''}`)}
                        >
                          {segment.text}
                          {isCurrentlySwapped ? <span className="flag-label">swap</span> : null}
                        </span>
                      )
                    })}
                  </div>

                  {selectionState ? (
                    <div className="selection-popup" style={{ left: selectionState.x, top: selectionState.y }}>
                      <p>Apply a flag to this selection</p>
                      <div className="chip-row">
                        {activeSession.flags.map((flag) => (
                          <button key={flag.id} type="button" className="flag-chip" onClick={() => applyFlag(flag.id)} style={{ backgroundColor: `${flag.color}22`, color: flag.color }}>
                            {flag.name}
                          </button>
                        ))}
                      </div>
                      <div className="popup-actions">
                        <input value={newFlagName} onChange={(event) => setNewFlagName(event.target.value)} placeholder="New flag name" />
                        <button type="button" className="primary small" onClick={createFlagAndApply}>Create & apply</button>
                      </div>
                    </div>
                  ) : null}

                  {popupPosition && activeRange ? (
                    <div
                      className="note-popup"
                      style={{ left: popupPosition.x, top: popupPosition.y }}
                      onPointerDown={(event) => {
                        const element = event.currentTarget as HTMLDivElement
                        const bounds = element.getBoundingClientRect()
                        setDragOffset({ x: event.clientX - bounds.left, y: event.clientY - bounds.top })
                      }}
                      onPointerMove={(event) => {
                        if (!dragOffset || !popupPosition) {
                          return
                        }

                        const element = event.currentTarget as HTMLDivElement
                        const bounds = element.getBoundingClientRect()
                        let nextX = event.clientX - dragOffset.x
                        let nextY = event.clientY - dragOffset.y

                        const minX = 0
                        const maxX = window.innerWidth - bounds.width
                        const minY = 0
                        const maxY = window.innerHeight - bounds.height

                        nextX = Math.max(minX, Math.min(nextX, maxX))
                        nextY = Math.max(minY, Math.min(nextY, maxY))

                        event.preventDefault()
                        setPopupPosition({ x: nextX, y: nextY })
                      }}
                      onPointerUp={() => setDragOffset(null)}
                      onPointerCancel={() => setDragOffset(null)}
                    >
                      <div className="note-header">
                        <strong>{activeSession.flags.find((flag) => flag.id === activeRange.flagId)?.name ?? 'Flag'}</strong>
                        <div className="header-actions">
                          <button type="button" className="secondary" onClick={() => copyRange(activeRange, activeSession?.copyVocabularyWithContent)}>Copy</button>
                          <button type="button" className="secondary" onClick={addActiveRangeToVocabulary}>Add to vocabulary</button>
                          <button type="button" className="ghost" onClick={() => { setActiveRangeId(null); setPopupPosition(null); setContextMode(false) }}>Close</button>
                        </div>
                      </div>
                      <label>
                        <span>Current flagged text</span>
                        <textarea value={activeRange.currentText} readOnly />
                      </label>
                      <label>
                        <span>Replacement</span>
                        <textarea value={noteDraft} onChange={(event) => { setNoteDraft(event.target.value); updateActiveRangeNote(event.target.value) }} placeholder="Paste the better word or phrase you found" />
                      </label>
                      <label>
                        <span>Context</span>
                        <textarea value={activeRange.context} onChange={(event) => updateRangeContext(event.target.value)} placeholder="Add surrounding texture if the phrase feels abstract" />
                      </label>
                      <div className="popup-actions">
                        <button type="button" className="secondary" onClick={() => { setContextMode(true); setMessage('Select any other text to attach as context.') }}>Add context</button>
                        <button type="button" className="secondary" onClick={() => copyRange(activeRange, activeSession?.copyVocabularyWithContent)}>Copy block</button>
                      </div>
                      <div className="popup-actions">
                        <label className="compact">
                          <span>Change flag</span>
                          <select value={activeRange.flagId} onChange={(event) => reassignRangeFlag(event.target.value)}>
                            {activeSession.flags.map((flag) => (
                              <option key={flag.id} value={flag.id}>{flag.name}</option>
                            ))}
                          </select>
                        </label>
                        <button type="button" className="primary" onClick={swapRange}>Swap</button>
                      </div>
                      <button type="button" className="danger" onClick={deleteRange}>Delete flag</button>
                    </div>
                  ) : null}
                </div>
              )}

              {message ? <p className="message">{message}</p> : null}
            </>
          ) : (
            <p className="muted">Create a session to begin.</p>
          )}
        </section>
      </main>

      <section className="panel flags-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Flags</p>
            <h2>Manage the vocabulary you’re training.</h2>
          </div>
        </div>
        {activeSession && activeSession.flags.length > 0 ? (
          <div className="flags-list">
            {activeSession.flags.map((flag) => (
              <div key={flag.id} className="flag-card">
                <div className="flag-color-row">
                  {PALETTE.map((color) => (
                    <button key={color} type="button" className={flag.color === color ? 'swatch active' : 'swatch'} style={{ backgroundColor: color }} onClick={() => updateFlag(flag.id, { color })} />
                  ))}
                </div>
                <label>
                  <span>Name</span>
                  <input value={flag.name} onChange={(event) => updateFlag(flag.id, { name: event.target.value })} />
                </label>
                <label>
                  <span>Prompt</span>
                  <textarea value={flag.prompt} onChange={(event) => updateFlag(flag.id, { prompt: event.target.value })} />
                </label>
                <div className="popup-actions">
                  <button type="button" className="secondary" onClick={() => copyAllForFlag(flag.id)}>Copy all for “{flag.name}”</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No flags yet. Create one by selecting a passage.</p>
        )}
        {activeSession ? (
          <div className="panel vocabulary-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Vocabulary</p>
                <h2>Special vocabulary list</h2>
              </div>
            </div>
            <label className="compact">
              <span>Copy vocabulary with flagged content</span>
              <div className="button-row">
                <button type="button" className={activeSession.copyVocabularyWithContent ? 'primary' : 'secondary'} onClick={toggleCopyVocabularyWithContent}>
                  {activeSession.copyVocabularyWithContent ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            </label>
            <label>
              <span>Add a vocabulary term</span>
              <div className="popup-actions">
                <input value={newVocabularyTerm} onChange={(event) => setNewVocabularyTerm(event.target.value)} placeholder="useful, practical, nice" />
                <button type="button" className="primary small" onClick={() => {
                  if (!newVocabularyTerm.trim()) return
                  patchSession((session) => ({
                    ...session,
                    vocabulary: Array.from(new Set([newVocabularyTerm.trim(), ...session.vocabulary])),
                  }))
                  setNewVocabularyTerm('')
                  setMessage('Added vocabulary term.')
                }}>Add</button>
              </div>
            </label>
            <div className="flags-list">
              {activeSession.vocabulary.length > 0 ? (
                activeSession.vocabulary.map((term) => (
                  <div key={term} className="flag-card">
                    <div className="button-row">
                      <span>{term}</span>
                      <button type="button" className="ghost" onClick={() => {
                        patchSession((session) => ({
                          ...session,
                          vocabulary: session.vocabulary.filter((item) => item !== term),
                        }))
                      }}>Remove</button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="muted">Add important vocabulary that the model should try to reuse.</p>
              )}
            </div>
          </div>
        ) : null}
        <div className="panel-footer">
          <button type="button" className="secondary" onClick={copyAllFlagged}>Copy all flagged content</button>
        </div>
      </section>
    </div>
  )
}

export default App
