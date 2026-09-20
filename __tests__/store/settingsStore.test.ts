import { useSettingsStore } from '../../src/stores/settingsStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

describe('settingsStore', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      themePreference: 'system',
      language: 'en',
      weekStartsOn: 0,
    });
  });

  it('defaults weekStartsOn to 0 (Sunday)', () => {
    expect(useSettingsStore.getState().weekStartsOn).toBe(0);
  });

  it('setWeekStartsOn(1) sets weekStartsOn to 1 (Monday)', () => {
    useSettingsStore.getState().setWeekStartsOn(1);
    expect(useSettingsStore.getState().weekStartsOn).toBe(1);
  });

  it('setWeekStartsOn(0) sets weekStartsOn back to 0 (Sunday)', () => {
    useSettingsStore.getState().setWeekStartsOn(1);
    useSettingsStore.getState().setWeekStartsOn(0);
    expect(useSettingsStore.getState().weekStartsOn).toBe(0);
  });

  it('setLanguage updates the language', () => {
    useSettingsStore.getState().setLanguage('de');
    expect(useSettingsStore.getState().language).toBe('de');
  });

  it('setThemePreference updates the theme', () => {
    useSettingsStore.getState().setThemePreference('dark');
    expect(useSettingsStore.getState().themePreference).toBe('dark');
  });

  it('defaults monthEventDisplay to bars', () => {
    expect(useSettingsStore.getState().monthEventDisplay).toBe('bars');
  });

  it('setMonthEventDisplay switches to dots and back', () => {
    useSettingsStore.getState().setMonthEventDisplay('dots');
    expect(useSettingsStore.getState().monthEventDisplay).toBe('dots');
    useSettingsStore.getState().setMonthEventDisplay('bars');
    expect(useSettingsStore.getState().monthEventDisplay).toBe('bars');
  });

  it('hides week numbers by default and can turn them on and off', () => {
    expect(useSettingsStore.getState().showWeekNumbers).toBe(false);
    useSettingsStore.getState().setShowWeekNumbers(true);
    expect(useSettingsStore.getState().showWeekNumbers).toBe(true);
    useSettingsStore.getState().setShowWeekNumbers(false);
    expect(useSettingsStore.getState().showWeekNumbers).toBe(false);
  });

  it('keeps the performance meter off by default, switchable, and out of what is saved', () => {
    expect(useSettingsStore.getInitialState().perfMeter).toBe(false);
    useSettingsStore.getState().setPerfMeter(true);
    expect(useSettingsStore.getState().perfMeter).toBe(true);
    const saved = useSettingsStore.persist.getOptions().partialize?.(useSettingsStore.getState()) as Record<string, unknown>;
    expect(saved).not.toHaveProperty('perfMeter');
    useSettingsStore.getState().setPerfMeter(false);
  });
});
