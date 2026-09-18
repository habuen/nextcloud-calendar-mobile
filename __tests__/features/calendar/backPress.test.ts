import { handleCalendarBack } from '@/features/calendar/utils/backPress';

describe('handleCalendarBack', () => {
  it('closes an open drawer first and keeps the app open, without touching the view history', () => {
    const closeDrawer = jest.fn();
    const goBack = jest.fn().mockReturnValue(true);

    const handled = handleCalendarBack({ drawerOpen: true, closeDrawer, goBack });

    expect(handled).toBe(true);
    expect(closeDrawer).toHaveBeenCalledTimes(1);
    expect(goBack).not.toHaveBeenCalled();
  });

  it('retraces the view history when the drawer is closed', () => {
    const closeDrawer = jest.fn();
    const goBack = jest.fn().mockReturnValue(true);

    expect(handleCalendarBack({ drawerOpen: false, closeDrawer, goBack })).toBe(true);
    expect(goBack).toHaveBeenCalledTimes(1);
    expect(closeDrawer).not.toHaveBeenCalled();
  });

  it('lets the app close when there is no drawer to close and no view to go back to', () => {
    const goBack = jest.fn().mockReturnValue(false);
    expect(handleCalendarBack({ drawerOpen: false, closeDrawer: jest.fn(), goBack })).toBe(false);
  });
});
