import { useCallback, useEffect, useRef, useState } from 'react';
import { useCalendarStore } from '@/stores/calendarStore';
import { trailingDebounce } from '@/utils/debounce';
import type { AgendaViewHandle } from '@/features/calendar/components/AgendaView';
import type { ViewMode } from '@/types';
import { isCalMode } from '../constants';

const FETCH_DATE_DEBOUNCE_MS = 150;
// How many earlier views Back can step through before it gives up and lets the
// app close.
const MAX_VIEW_HISTORY = 10;

export function useCalendarNavigation() {
  const viewMode = useCalendarStore((s) => s.viewMode);
  const setViewMode = useCalendarStore((s) => s.setViewMode);
  const isCalendarMode = isCalMode(viewMode);

  const [date, setDateState] = useState(() => new Date());
  const [anchorDate, setAnchorDate] = useState(date);
  const [fetchDate, setFetchDate] = useState(date);
  const [agendaVisibleDate, setAgendaVisibleDate] = useState(date);
  const [jump, setJump] = useState<{ nonce: number; target: Date }>(() => ({ nonce: 0, target: date }));
  const agendaRef = useRef<AgendaViewHandle>(null);

  const fetchDebounce = useRef(
    trailingDebounce((d: Date) => setFetchDate(d), FETCH_DATE_DEBOUNCE_MS)
  ).current;

  const dateRef = useRef(date); dateRef.current = date;
  const viewModeRef = useRef(viewMode); viewModeRef.current = viewMode;
  const agendaVisibleDateRef = useRef(agendaVisibleDate);
  agendaVisibleDateRef.current = agendaVisibleDate;

  const setDate = useCallback((d: Date) => {
    fetchDebounce.cancel();
    setDateState(d);
    setFetchDate(d);
    setJump((j) => ({ nonce: j.nonce + 1, target: d }));
  }, [fetchDebounce]);

  const onPageChange = useCallback((d: Date) => {
    setDateState(d);
    fetchDebounce.call(d);
  }, [fetchDebounce]);

  useEffect(() => { if (viewMode === 'schedule') setAgendaVisibleDate(date); }, [date, viewMode]);

  // Views the user has come from, most recent last, so Back can retrace them
  // instead of closing the app.
  const viewHistory = useRef<ViewMode[]>([]);
  const rememberCurrentView = useCallback((next: ViewMode) => {
    const current = viewModeRef.current;
    if (next === current) return;
    viewHistory.current.push(current);
    if (viewHistory.current.length > MAX_VIEW_HISTORY) viewHistory.current.shift();
  }, []);

  const applyMode = useCallback((target: ViewMode) => {
    const focus = viewModeRef.current === 'schedule'
      ? agendaVisibleDateRef.current
      : dateRef.current;
    if (target !== 'schedule') {
      setAnchorDate(focus);
      setDate(focus);
    }
    setViewMode(target);
  }, [setViewMode, setDate]);

  const switchMode = useCallback((target: ViewMode) => {
    rememberCurrentView(target);
    applyMode(target);
  }, [rememberCurrentView, applyMode]);

  // Steps back to the view the user came from, if any. Returns whether it
  // handled the Back press; false means there was nowhere to go back to, so the
  // caller should let the app close as usual.
  const goBack = useCallback((): boolean => {
    const history = viewHistory.current;
    const current = viewModeRef.current;
    while (history.length > 0 && history[history.length - 1] === current) history.pop();
    const previous = history.pop();
    if (!previous) return false;
    applyMode(previous);
    return true;
  }, [applyMode]);

  const goToday = useCallback(() => {
    const now = new Date();
    setDate(now);
    if (viewModeRef.current === 'schedule') {
      setAgendaVisibleDate(now);
      agendaRef.current?.scrollToToday();
    }
  }, [setDate]);

  // Like switchMode('day'), but focused on an explicit date rather than
  // whatever `date` currently holds — switchMode reads that through a ref,
  // which would still be stale immediately after a caller's own setDate(d)
  // in the same handler (the ref only updates on the next render).
  const goToDay = useCallback((d: Date) => {
    rememberCurrentView('day');
    setAnchorDate(d);
    setDate(d);
    setViewMode('day');
  }, [rememberCurrentView, setDate, setViewMode]);

  return {
    viewMode,
    isCalendarMode,
    date,
    anchorDate,
    jump,
    fetchDate,
    setDate,
    agendaVisibleDate,
    setAgendaVisibleDate,
    agendaRef,
    switchMode,
    goToday,
    goToDay,
    goBack,
    onPageChange,
  };
}
