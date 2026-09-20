import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { legacyBackedStorage } from '@/stores/legacyStorage';
import { getInitialLanguage, getInitialWeekStartsOn, type AppLanguage } from '@/utils/i18n';
import type { AllDayAlert, TimedAlert } from '@/features/notifications/alerts';
import type { TalkOpenMode } from '@/types';

export type ThemePreference = 'system' | 'light' | 'dark';
export type MonthEventDisplay = 'bars' | 'dots';

interface SettingsState {
  themePreference: ThemePreference;
  language: AppLanguage;
  weekStartsOn: 0 | 1;
  liveActivityEnabled: boolean;
  timedAlert: TimedAlert;
  allDayAlert: AllDayAlert;
  hapticsEnabled: boolean;
  reduceMotion: boolean;
  talkOpenMode: TalkOpenMode;
  monthEventDisplay: MonthEventDisplay;
  showWeekNumbers: boolean;
  // Diagnostic overlay; deliberately not persisted, so it is off after a restart.
  perfMeter: boolean;
  setThemePreference: (pref: ThemePreference) => void;
  setLanguage: (lang: AppLanguage) => void;
  setWeekStartsOn: (v: 0 | 1) => void;
  setLiveActivityEnabled: (v: boolean) => void;
  setTimedAlert: (v: TimedAlert) => void;
  setAllDayAlert: (v: AllDayAlert) => void;
  setHapticsEnabled: (v: boolean) => void;
  setReduceMotion: (v: boolean) => void;
  setTalkOpenMode: (v: TalkOpenMode) => void;
  setMonthEventDisplay: (v: MonthEventDisplay) => void;
  setShowWeekNumbers: (v: boolean) => void;
  setPerfMeter: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      themePreference: 'system',
      language: getInitialLanguage(),
      weekStartsOn: getInitialWeekStartsOn(),
      liveActivityEnabled: true,
      timedAlert: null,
      allDayAlert: null,
      hapticsEnabled: true,
      reduceMotion: false,
      talkOpenMode: 'app',
      monthEventDisplay: 'bars',
      showWeekNumbers: false,
      perfMeter: false,
      setTimedAlert: (v) => set({ timedAlert: v }),
      setAllDayAlert: (v) => set({ allDayAlert: v }),
      setThemePreference: (pref) => set({ themePreference: pref }),
      setLanguage: (lang) => set({ language: lang }),
      setWeekStartsOn: (v) => set({ weekStartsOn: v }),
      setLiveActivityEnabled: (v) => set({ liveActivityEnabled: v }),
      setHapticsEnabled: (v) => set({ hapticsEnabled: v }),
      setReduceMotion: (v) => set({ reduceMotion: v }),
      setTalkOpenMode: (v) => set({ talkOpenMode: v }),
      setMonthEventDisplay: (v) => set({ monthEventDisplay: v }),
      setShowWeekNumbers: (v) => set({ showWeekNumbers: v }),
      setPerfMeter: (v) => set({ perfMeter: v }),
    }),
    {
      name: 'settings-store',
      version: 1,
      migrate: (persisted) => {
        return persisted as Partial<SettingsState> | undefined;
      },
      storage: createJSONStorage(() =>
        legacyBackedStorage(['themePreference', 'language', 'weekStartsOn'])
      ),
      partialize: (state) => ({
        themePreference: state.themePreference,
        language: state.language,
        weekStartsOn: state.weekStartsOn,
        liveActivityEnabled: state.liveActivityEnabled,
        timedAlert: state.timedAlert,
        allDayAlert: state.allDayAlert,
        hapticsEnabled: state.hapticsEnabled,
        reduceMotion: state.reduceMotion,
        talkOpenMode: state.talkOpenMode,
        monthEventDisplay: state.monthEventDisplay,
        showWeekNumbers: state.showWeekNumbers,
      }),
    }
  )
);
